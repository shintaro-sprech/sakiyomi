import { ActionIcon, Loader, Title, useComputedColorScheme, VisuallyHidden } from '@mantine/core'
import { useMediaQuery, useReducedMotion } from '@mantine/hooks'
import { useProgress } from '@react-three/drei'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { equipmentCalendar, nextWorkingMinute, workingSegments } from '../engine/calendar'
import { addDays, daysBetween, MINUTES_PER_DAY } from '../engine/dates'
import { floorAt, type FloorLot, type FloorMachine, type MachineState } from '../engine/floor'
import type { Plan } from '../engine/plan'
import type { IsoDate, Part } from '../engine/types'
import { nextShiftStart } from '../engine/workingClock'
import { factoryLayout, PILE_MAX, stockKey, type FactoryLayout } from './factoryLayout'
import { shortDate, weekdayName } from './format'
import { FLOOR_MODELS, preloadModels } from './factoryModels'
import FactoryScene, { type FactoryColors, type ZoomLimit } from './FactoryScene'
import { useMinuteClock } from './useMinuteClock'

type Props = {
  plan: Plan
  today: IsoDate
}

const STATE_NAMES: Record<MachineState, string> = {
  running: '加工中',
  setup: '段取り中',
  idle: '空き',
  off: '休み',
  stopped: '停止',
}

// As the Gantt chart's bars say how their order stands against its due date.
const TONE_NAMES = { late: '、納期に遅れる', tight: '、納期まで1日以内', ok: '' }

// How many lots waiting a card lists: those standing in front of the machine, fewer in the card
// under the floor on a phone; a last line says how many more there are.
const CARD_ROWS = PILE_MAX
const DOCKED_ROWS = 3

const pad = (value: number) => String(value).padStart(2, '0')

// A minute of the plan (from 00:00 of today) as "08:00" on the day of the minute now, and as
// "11/9（月）08:00" on another day.
function momentLabel(today: IsoDate, minute: number, at: number): string {
  const day = Math.floor(at / MINUTES_PER_DAY)
  const within = at - day * MINUTES_PER_DAY
  const time = `${pad(Math.floor(within / 60))}:${pad(within % 60)}`
  if (day === Math.floor(minute / MINUTES_PER_DAY)) return time
  const date = addDays(today, day)
  return `${shortDate(date)}（${weekdayName(date)}）${time}`
}

// "2026-11-09T05:00" as a minute of the plan from 00:00 of today.
function minuteOf(today: IsoDate, dateTime: string): number {
  const [date, time] = dateTime.split('T')
  const [hours, minutes] = time.split(':').map(Number)
  return daysBetween(today, date) * MINUTES_PER_DAY + hours * 60 + minutes
}

// What a machine's card and the words for it say: its state; the lot on it, how much of its
// step's working time has gone, when the step ends, and when the machine starts again while it
// rests; and the lots waiting for it in the order it takes them.
type MachineFacts = {
  name: string
  state: MachineState
  current: { lot: FloorLot; done: number; until: string; resumes: string | null } | null
  waiting: FloorLot[]
}

function machineFacts(plan: Plan, today: IsoDate, minute: number, name: string, machine: FloorMachine | undefined): MachineFacts {
  if (!machine) return { name, state: 'idle', current: null, waiting: [] }
  const { current, state, waiting } = machine
  if (!current) return { name, state, current: null, waiting }
  const calendar = equipmentCalendar(plan.scenario, machine.equipmentId, today)
  const start = minuteOf(today, current.startAt)
  const end = minuteOf(today, current.endAt)
  // Working time only, so a step that runs over a night or a weekend does not creep on while
  // the machine rests.
  const worked = (to: number) => workingSegments(calendar, start, to).reduce((total, segment) => total + segment.end - segment.start, 0)
  const whole = worked(end)
  const done = whole > 0 ? worked(Math.min(Math.max(minute, start), end)) / whole : 0
  const resumes = state === 'off' ? nextWorkingMinute(calendar, minute) : null
  return {
    name,
    state,
    current: {
      lot: current,
      done,
      until: momentLabel(today, minute, end),
      resumes: resumes === null ? null : momentLabel(today, minute, resumes),
    },
    waiting,
  }
}

// The lots a card lists out of those waiting, and how many it leaves to "ほか N Lot".
function listed(waiting: FloorLot[], rows: number): { lots: FloorLot[]; more: number } {
  const lots = waiting.slice(0, rows)
  return { lots, more: waiting.length - lots.length }
}

const piecesOf = (lots: FloorLot[]) => lots.reduce((total, lot) => total + lot.quantity, 0)

function readColors(_scheme: string): FactoryColors {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return {
    floor: token('--sk-floor'),
    zone: token('--sk-floor-zone'),
    zoneLine: token('--sk-floor-line'),
    zoneText: token('--sk-floor-text'),
    ok: token('--sk-accent'),
    tight: token('--sk-tight-fill'),
    late: token('--sk-late-fill'),
    material: token('--sk-floor-material'),
    carton: token('--sk-floor-carton'),
    selected: token('--sk-focus'),
    heat: token('--mantine-color-orange-5'),
    states: {
      running: token('--sk-state-running'),
      setup: token('--sk-state-setup'),
      idle: token('--sk-state-idle'),
      off: token('--sk-state-idle'),
      stopped: token('--sk-state-stopped'),
    },
  }
}

// The floor now, in 3D: material at the left, each crew's machines in its area, finished goods at
// the right, the lot each machine runs and the lots waiting for it. The canvas says nothing to a
// screen reader, so the same is written out for it, in the floor's order from left to right.
export default function FactoryView({ plan, today }: Props) {
  const clock = useMinuteClock()
  const scheme = useComputedColorScheme('light')
  const reducedMotion = useReducedMotion(false, { getInitialValueInEffect: false })
  // A machine's id, or a pallet in a store.
  const [selected, setSelected] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  // On a phone the floor is too small for a card beside a machine: the card lies along the
  // bottom of the stage, under the floor, where it hides none of it. The same width as the
  // stylesheet's.
  const docked = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false })
  // The names over the floor go in the part screen readers skip, with the canvas.
  const drawing = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  // Zooms the floor in (above 1) or out (below 1) round the middle of the view, once the scene is ready.
  const zoom = useRef<((factor: number) => void) | null>(null)
  const zoomReady = useCallback((zoomBy: (factor: number) => void) => {
    zoom.current = zoomBy
  }, [])
  // Slides a zoomed-in view toward what the keyboard chose, so it stays in sight.
  const look = useRef<((x: number, z: number) => void) | null>(null)
  const lookReady = useCallback((lookAt: (x: number, z: number) => void) => {
    look.current = lookAt
  }, [])
  const [zoomLimit, setZoomLimit] = useState<ZoomLimit>('out')
  const title = useId()
  // Off screen the floor is not redrawn.
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // The wheel scrolls the page over the floor too; it zooms the floor with ⌘ or Ctrl held, as a
  // trackpad's pinch does. The − and ＋ in the corner zoom it as well.
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation()
      // Off the canvas, over the buttons or the time, a pinch does not zoom the whole page instead.
      else if (!(event.target instanceof HTMLCanvasElement)) event.preventDefault()
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => element.removeEventListener('wheel', onWheel, { capture: true })
  }, [])

  const clockDate = `${clock.getFullYear()}-${pad(clock.getMonth() + 1)}-${pad(clock.getDate())}`
  const minute = daysBetween(today, clockDate) * MINUTES_PER_DAY + clock.getHours() * 60 + clock.getMinutes()
  const machines = useMemo(() => floorAt(plan, minute), [plan, minute])
  const byId = useMemo(() => new Map(machines.map((machine) => [machine.equipmentId, machine])), [machines])
  const layout = useMemo(() => factoryLayout(plan.scenario.data), [plan])
  // Only the models the floor uses are fetched, all at once.
  const models = [...new Set(layout.machines.map((placed) => placed.model))].join(',')
  useEffect(() => preloadModels([...models.split(',').filter(Boolean), ...FLOOR_MODELS]), [models])
  const loading = useProgress((progress) => progress.active)
  // Colors follow the color scheme; read again when it changes.
  const colors = useMemo(() => readColors(scheme), [scheme])
  const { data } = plan.scenario

  const now = `${pad(clock.getHours())}:${pad(clock.getMinutes())}`
  // Out of working hours every machine rests; the time says when work starts again.
  const resumes = useMemo(() => nextShiftStart(plan, minute), [plan, minute])
  const resumesAt = resumes === null ? null : momentLabel(today, minute, resumes)
  const facts = useMemo(
    () =>
      new Map(
        layout.machines.map((placed) => [
          placed.equipment.id,
          machineFacts(plan, today, minute, placed.equipment.name, byId.get(placed.equipment.id)),
        ]),
      ),
    [layout, plan, today, minute, byId],
  )
  const rows = docked ? DOCKED_ROWS : CARD_ROWS
  const chosenFacts = selected === null ? undefined : facts.get(selected)

  // What can be chosen on the floor, in its order from left to right: material, the machines
  // crew by crew, finished goods; each with where it stands and what it says to a screen reader,
  // for a machine the same as its card.
  const choices = useMemo(() => {
    const at = (x: number, z: number): [number, number] => [x - layout.width / 2, z]
    return [
      ...data.parts.map((part, index) => ({
        key: stockKey('material', part.partNumber),
        at: at(layout.material.spots[index].x, layout.material.spots[index].z),
        words: `材料 ${part.partNumber} ${count(part.materialStock ?? 0)}個分`,
      })),
      ...layout.machines.map((placed) => ({
        key: placed.equipment.id,
        at: at(placed.x, placed.z),
        words: describeMachine(facts.get(placed.equipment.id), rows),
      })),
      ...data.parts.map((part, index) => ({
        key: stockKey('finished', part.partNumber),
        at: at(layout.finished.spots[index].x, layout.finished.spots[index].z),
        words: `完成品 ${part.partNumber} ${count(part.stock)}個`,
      })),
    ]
  }, [data.parts, layout, facts, rows])
  const chosen = choices.find((choice) => choice.key === selected)
  // A press anywhere off the floor, or Escape, lets the chosen one go.
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      if (!stage.current?.contains(event.target as Node)) setSelected(null)
    }
    document.addEventListener('pointerdown', onPress)
    return () => document.removeEventListener('pointerdown', onPress)
  }, [])
  // With the stage focused, the arrow keys go through the floor in its order.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && selected !== null) {
      setSelected(null)
      return
    }
    if (event.target instanceof HTMLButtonElement) return
    // An arrow with Alt, Ctrl or ⌘ held is the browser's (back, forward) or a screen reader's.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const at = choices.findIndex((choice) => choice.key === selected)
    const next = choices[at < 0 ? (step > 0 ? 0 : choices.length - 1) : (at + step + choices.length) % choices.length]
    setSelected(next.key)
    look.current?.(...next.at)
  }
  return (
    <div className="factory">
      <Title order={2} size="h4" id={title}>
        現場
      </Title>
      {/* Focusable for a keyboard to choose on the floor; a screen reader has the same in words below. */}
      <div className="factory-stage" ref={stage} tabIndex={0} role="group" aria-labelledby={title} onKeyDown={onKeyDown}>
        <div className="factory-view">
          <div className="factory-drawing" aria-hidden="true" ref={drawing}>
            {/* The chosen machine's card keeps off what is marked data-over-floor. */}
            <span className="factory-now tabular" data-over-floor>
              今 {now}
              {resumesAt && <span className="factory-resumes">次の始業 {resumesAt}</span>}
            </span>
            {loading && <Loader size="sm" className="factory-loading" />}
            <FactoryScene
              labels={drawing}
              onZoomReady={zoomReady}
              onLookReady={lookReady}
              onZoomLimit={setZoomLimit}
              layout={layout}
              floor={byId}
              parts={data.parts}
              colors={colors}
              selected={selected}
              onSelect={setSelected}
              card={chosenFacts && !docked && <MachineCard facts={chosenFacts} rows={rows} />}
              reducedMotion={reducedMotion}
              visible={visible}
            />
          </div>
          <div className="factory-zoom span-control" role="group" aria-label="現場の表示の大きさ" data-over-floor>
            {/* Shown as off at the limit while keeping focus, so a keyboard does not lose its place. */}
            <ActionIcon
              variant="default"
              size={32}
              aria-label="縮小"
              data-disabled={zoomLimit === 'out' || undefined}
              aria-disabled={zoomLimit === 'out'}
              onClick={() => zoomLimit !== 'out' && zoom.current?.(1 / 1.4)}
            >
              <IconMinus size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              size={32}
              aria-label="拡大"
              data-disabled={zoomLimit === 'in' || undefined}
              aria-disabled={zoomLimit === 'in'}
              onClick={() => zoomLimit !== 'in' && zoom.current?.(1.4)}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </div>
        </div>
        {/* Read out through the status line below, as the card beside a machine is. */}
        {chosenFacts && docked && (
          <div className="factory-card is-docked" aria-hidden="true">
            <MachineCard facts={chosenFacts} rows={rows} />
          </div>
        )}
      </div>
      {/* What was just chosen on the floor, read out as it changes. */}
      <VisuallyHidden role="status">{chosen?.words ?? ''}</VisuallyHidden>
      <FloorInWords
        label={resumesAt ? `現場の今 ${now}、次の始業 ${resumesAt}` : `現場の今 ${now}`}
        layout={layout}
        facts={facts}
        parts={data.parts}
      />
    </div>
  )
}

function count(value: number) {
  return value.toLocaleString('ja-JP')
}

// A lot as a card lists it: its number in the color of its order on the Gantt chart, its part and
// its pieces, with the step for the lot on the machine. Each part takes a column of the card's
// grid, so the lots line up.
function LotLine({ lot, step }: { lot: FloorLot; step?: boolean }) {
  return (
    <div className="factory-card-lot">
      <span className={`tone-${lot.tone}`}>{lot.lotId}</span>
      <span>{lot.partNumber}</span>
      <span className="factory-card-pieces">{count(lot.quantity)}個</span>
      {step && <span>{lot.stepName}</span>}
    </div>
  )
}

// The chosen machine's card on the floor: the machine and its state; the lot on it, how far its
// step has gone and when it ends (and when the machine starts again while it rests); then the
// lots waiting for it, how many and how many pieces, one a line in the order it takes them.
function MachineCard({ facts, rows }: { facts: MachineFacts; rows: number }) {
  const { current, waiting } = facts
  const list = listed(waiting, rows)
  return (
    <>
      <div className="factory-card-head">
        <span className={`factory-dot state-${facts.state}`} />
        <span className="factory-card-name">{facts.name}</span>
        <span>{STATE_NAMES[facts.state]}</span>
      </div>
      {current && (
        <>
          <LotLine lot={current.lot} step />
          <div className="factory-card-progress">
            <span className={`factory-card-bar state-${facts.state}`}>
              <span style={{ width: `${Math.round(current.done * 100)}%` }} />
            </span>
            <span>{current.until}まで</span>
          </div>
          {current.resumes && <div className="factory-card-line">再開 {current.resumes}</div>}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <div className={`factory-card-queue${current ? ' is-after' : ''}`}>
            待ち {waiting.length} Lot・{count(piecesOf(waiting))}個
          </div>
          {list.lots.map((lot) => (
            <LotLine key={`${lot.orderId}/${lot.lotId}`} lot={lot} />
          ))}
          {list.more > 0 && <div className="factory-card-line factory-card-more">ほか {list.more} Lot</div>}
        </>
      )}
    </>
  )
}

const lotWords = (lot: FloorLot) => `${lot.lotId} ${lot.partNumber} ${count(lot.quantity)}個${TONE_NAMES[lot.tone]}`

// The same as a machine's card in words: all the lots waiting, or as many as the card lists.
function describeMachine(facts: MachineFacts | undefined, rows = Infinity) {
  if (!facts) return ''
  const said = [facts.name, STATE_NAMES[facts.state]]
  const { current, waiting } = facts
  if (current) {
    said.push(`${current.lot.lotId} ${current.lot.partNumber} ${count(current.lot.quantity)}個 ${current.lot.stepName}${TONE_NAMES[current.lot.tone]}`)
    said.push(`${current.until}まで`)
    if (current.resumes) said.push(`再開 ${current.resumes}`)
  }
  if (waiting.length > 0) {
    const list = listed(waiting, rows)
    const more = list.more > 0 ? `、ほか ${list.more} Lot` : ''
    said.push(`待ち ${waiting.length} Lot・${count(piecesOf(waiting))}個：${list.lots.map(lotWords).join('、')}${more}`)
  }
  return said.join('、')
}

// What the floor shows, for screen readers: material, each crew's machines with what they run and
// the lots waiting for them in the order they take them, and finished goods.
function FloorInWords({ label, layout, facts, parts }: { label: string; layout: FactoryLayout; facts: Map<string, MachineFacts>; parts: Part[] }) {
  return (
    <VisuallyHidden component="section" aria-label={label}>
      <h3>材料</h3>
      <ul>
        {parts.map((part) => (
          <li key={part.partNumber}>
            {part.partNumber} {count(part.materialStock ?? 0)}個分
          </li>
        ))}
      </ul>
      {layout.zones.map((zone) => (
        <div key={zone.name || 'none'}>
          {zone.name && <h3>{zone.name}</h3>}
          <ul>
            {layout.machines
              .filter((placed) => zone.equipmentIds.includes(placed.equipment.id))
              .map((placed) => (
                <li key={placed.equipment.id}>{describeMachine(facts.get(placed.equipment.id))}</li>
              ))}
          </ul>
        </div>
      ))}
      <h3>完成品</h3>
      <ul>
        {parts.map((part) => (
          <li key={part.partNumber}>
            {part.partNumber} {count(part.stock)}個
          </li>
        ))}
      </ul>
    </VisuallyHidden>
  )
}
