import { ActionIcon, Loader, Paper, Text, Title, UnstyledButton, useComputedColorScheme } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { useProgress } from '@react-three/drei'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { addDays, daysBetween, MINUTES_PER_DAY } from '../engine/dates'
import { floorAt, type MachineState } from '../engine/floor'
import type { Plan } from '../engine/plan'
import type { IsoDate } from '../engine/types'
import { nextShiftStart } from '../engine/workingClock'
import { factoryLayout } from './factoryLayout'
import { shortDate, weekdayName } from './format'
import { preloadModels } from './factoryModels'
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

const pad = (value: number) => String(value).padStart(2, '0')

// "08:00" later the same day, "11/9（月）08:00" on another day.
function shiftStartLabel(today: IsoDate, minute: number, start: number): string {
  const day = Math.floor(start / MINUTES_PER_DAY)
  const within = start - day * MINUTES_PER_DAY
  const time = `${pad(Math.floor(within / 60))}:${pad(within % 60)}`
  if (day === Math.floor(minute / MINUTES_PER_DAY)) return time
  const date = addDays(today, day)
  return `${shortDate(date)}（${weekdayName(date)}）${time}`
}

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

// The floor now: each machine with the lot it runs and the lots waiting for it, material on
// the left and finished goods on the right. The list beside it says the same in words.
export default function FactoryView({ plan, today }: Props) {
  const clock = useMinuteClock()
  const scheme = useComputedColorScheme('light')
  const reducedMotion = useReducedMotion(false, { getInitialValueInEffect: false })
  const [selected, setSelected] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  // The names over the floor go in the part screen readers skip, with the canvas.
  const drawing = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  // Zooms the floor in (above 1) or out (below 1) round the middle of the view, once the scene is ready.
  const zoom = useRef<((factor: number) => void) | null>(null)
  const zoomReady = useCallback((zoomBy: (factor: number) => void) => {
    zoom.current = zoomBy
  }, [])
  const [zoomLimit, setZoomLimit] = useState<ZoomLimit>('out')
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
  useEffect(() => preloadModels([...models.split(',').filter(Boolean), 'pallet', 'material_rack']), [models])
  const loading = useProgress((progress) => progress.active)
  // Colors follow the color scheme; read again when it changes.
  const colors = useMemo(() => readColors(scheme), [scheme])
  const { data } = plan.scenario

  const now = `${pad(clock.getHours())}:${pad(clock.getMinutes())}`
  // Out of working hours every machine rests; the time says when work starts again.
  const resumes = useMemo(() => nextShiftStart(plan, minute), [plan, minute])
  const resumesAt = resumes === null ? null : shiftStartLabel(today, minute, resumes)
  return (
    <div className="factory">
      <Title order={2} size="h4">
        現場
      </Title>
      <div className="factory-stage" ref={stage}>
        <div className="factory-drawing" aria-hidden="true" ref={drawing}>
          <span className="factory-now tabular">
            今 {now}
            {resumesAt && <span className="factory-resumes">次の始業 {resumesAt}</span>}
          </span>
          {loading && <Loader size="sm" className="factory-loading" />}
          <FactoryScene
            labels={drawing}
            onZoomReady={zoomReady}
            onZoomLimit={setZoomLimit}
            layout={layout}
            floor={byId}
            parts={data.parts}
            colors={colors}
            selected={selected}
            onSelect={setSelected}
            reducedMotion={reducedMotion}
            visible={visible}
          />
        </div>
        <div className="factory-zoom span-control" role="group" aria-label="現場の表示の大きさ">
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
      {/* Material, the crews and finished goods from left to right, in the order of the floor above. */}
      <Paper withBorder className="factory-list" component="section" aria-label={resumesAt ? `現場の今 ${now}、次の始業 ${resumesAt}` : `現場の今 ${now}`}>
        <StoreList
          title="材料"
          rows={data.parts.map((part) => [
            part.partNumber,
            `${(part.materialStock ?? 0).toLocaleString('ja-JP')}個分`,
            part.materialStock === 0,
          ])}
        />
        {layout.zones.map((zone) => (
          <section key={zone.name || 'none'}>
            {zone.name && (
              <Text size="xs" c="dimmed" className="factory-list-head">
                {zone.name}
              </Text>
            )}
            <ul className="factory-machines">
              {zone.equipmentIds
                .map((id) => data.equipment.find((item) => item.id === id)!)
                .map((equipment) => {
                  const machine = byId.get(equipment.id)
                  const state = machine?.state ?? 'idle'
                  const waitingPieces = machine?.waiting.reduce((total, lot) => total + lot.quantity, 0) ?? 0
                  return (
                    <li key={equipment.id}>
                      <UnstyledButton
                        className="factory-machine"
                        data-selected={selected === equipment.id || undefined}
                        aria-pressed={selected === equipment.id}
                        onClick={() => setSelected((current) => (current === equipment.id ? null : equipment.id))}
                      >
                        <span className={`factory-dot state-${state}`} aria-hidden="true" />
                        <span className="factory-machine-name">{equipment.name}</span>
                        <span className="factory-machine-state">{STATE_NAMES[state]}</span>
                        {machine?.current && (
                          <span className={`factory-machine-lot tabular tone-${machine.current.tone}`}>
                            {machine.current.lotId}　{machine.current.partNumber}　{machine.current.quantity}個
                          </span>
                        )}
                        {machine && machine.waiting.length > 0 && (
                          <span className="factory-machine-wait tabular">
                            待ち {machine.waiting.length} Lot（{waitingPieces.toLocaleString('ja-JP')}個）
                          </span>
                        )}
                      </UnstyledButton>
                    </li>
                  )
                })}
            </ul>
          </section>
        ))}
        <StoreList
          title="完成品"
          rows={data.parts.map((part) => [part.partNumber, `${part.stock.toLocaleString('ja-JP')}個`, part.stock <= 0])}
        />
      </Paper>
    </div>
  )
}

// Each part's stock; an empty one reads in red and bold, as on the floor above.
function StoreList({ title, rows }: { title: string; rows: [string, string, boolean][] }) {
  return (
    <section>
      <Text size="xs" c="dimmed" className="factory-list-head">
        {title}
      </Text>
      <dl className="factory-store tabular">
        {rows.map(([part, pieces, empty]) => (
          <div key={part} className={empty ? 'tone-late is-empty' : undefined}>
            <dt>{part}</dt>
            <dd>{pieces}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
