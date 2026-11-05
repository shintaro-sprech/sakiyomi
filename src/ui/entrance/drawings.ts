import { boardBars, CYCLE, RELEASE, STEPS } from './flow'

// The app's tokens (index.css, theme.ts), for the scene and its drawings, which do not read CSS.
export const COLORS = {
  page: '#FAF9F5',
  floor: '#F5F4ED',
  zone: '#E8E6DC',
  zoneLine: '#B0AEA5',
  card: '#FFFFFF',
  border: '#E8E6DC',
  ink: '#141413',
  slate: '#3D3D3A',
  dimmed: '#5E5D59',
  // Planned work, little time to spare, late: the Gantt chart's bars.
  accent: '#1F63B8',
  tight: '#FFD43B',
  late: '#FA5252',
  shift: '#87867F',
  // A machine's lamp: running, or not.
  running: '#73944F',
  idle: '#87867F',
  material: '#9C9A92',
  steel: '#9C9A92',
  clay: '#D97757',
  carton: '#C69C6D',
  muted: '#D1CFC5',
  // The plan board: a pane of pale glass with a darker edge, and the lines from it.
  glass: '#F6F8FB',
  glassEdge: '#D3DBE6',
  wire: '#8DA9D4',
}

// The plan board in meters: a card with the equipment down the left and their bars to the right.
export const BOARD = {
  width: 15.6,
  height: 5.5,
  pad: 0.22,
  header: 0.62,
  label: 2.5,
  radius: 0.16,
  rows: STEPS.length,
  // How many seconds of the plan the track shows, and where now stands across it.
  window: 22,
  now: 0.4,
}
export const ROW = (BOARD.height - 2 * BOARD.pad - BOARD.header) / BOARD.rows
export const TRACK = {
  left: -BOARD.width / 2 + BOARD.pad + BOARD.label,
  width: BOARD.width - 2 * BOARD.pad - BOARD.label,
  top: BOARD.height / 2 - BOARD.pad,
  height: BOARD.header + BOARD.rows * ROW,
}

const fontOf = () => getComputedStyle(document.body).fontFamily || 'sans-serif'

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2))
}

// The board's card: white with a hairline, the head row, and each equipment's name and process
// in the column on the left, as the Gantt chart shows them.
export function drawBoardFace(): HTMLCanvasElement {
  const scale = 120
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(BOARD.width * scale)
  canvas.height = Math.round(BOARD.height * scale)
  const context = canvas.getContext('2d')!
  const m = (meters: number) => meters * scale
  roundRect(context, m(0.02), m(0.02), canvas.width - m(0.04), canvas.height - m(0.04), m(BOARD.radius))
  context.fillStyle = COLORS.glass
  context.fill()
  context.lineWidth = m(0.03)
  context.strokeStyle = COLORS.glassEdge
  context.stroke()
  context.strokeStyle = COLORS.border
  const left = m(BOARD.pad)
  const top = m(BOARD.pad)
  const labelRight = left + m(BOARD.label)
  const right = canvas.width - m(BOARD.pad)
  context.lineWidth = m(0.02)
  // The line under the head row, the line between each row, and the column's edge.
  for (let row = 0; row <= BOARD.rows; row++) {
    const y = top + m(BOARD.header + row * ROW)
    context.beginPath()
    context.moveTo(left, y)
    context.lineTo(right, y)
    context.stroke()
  }
  context.beginPath()
  context.moveTo(labelRight, top)
  context.lineTo(labelRight, top + m(BOARD.header + BOARD.rows * ROW))
  context.stroke()
  const font = fontOf()
  context.textBaseline = 'alphabetic'
  STEPS.forEach((step, row) => {
    const y = top + m(BOARD.header + row * ROW)
    context.fillStyle = COLORS.ink
    context.font = `500 ${m(0.3)}px ${font}`
    context.fillText(step.name, left + m(0.16), y + m(ROW * 0.5))
    context.fillStyle = COLORS.dimmed
    context.font = `${m(0.2)}px ${font}`
    context.fillText(step.process, left + m(0.16), y + m(ROW * 0.84))
  })
  return canvas
}

// The board's track over one cycle: the days, the shifts in dashes, the hours under the head,
// and each lot's bar at each step in the color of its order. Shown through a window that moves
// along it and wraps round, so the plan only ever goes by to the left.
export const DAY = 3 * RELEASE
export function drawTimeline(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 512
  const context = canvas.getContext('2d')!
  const perSecond = canvas.width / CYCLE
  const perMeter = canvas.height / TRACK.height
  const header = BOARD.header * perMeter
  const row = ROW * perMeter
  context.lineWidth = 2
  // A shift's dashed line, a day's solid one.
  for (let time = 0; time < CYCLE; time += RELEASE) {
    const x = Math.round(time * perSecond) + 0.5
    const day = time % DAY === 0
    context.strokeStyle = day ? COLORS.border : COLORS.shift
    context.setLineDash(day ? [] : [6, 6])
    context.beginPath()
    context.moveTo(x, day ? 0 : header)
    context.lineTo(x, canvas.height)
    context.stroke()
  }
  context.setLineDash([])
  context.fillStyle = COLORS.dimmed
  for (let time = 0; time < CYCLE; time += RELEASE / 2) {
    const x = Math.round(time * perSecond)
    context.fillRect(x, header - 10, 2, 10)
  }
  const fills = { ok: COLORS.accent, tight: COLORS.tight }
  for (const bar of boardBars()) {
    const width = bar.length * perSecond
    const y = header + bar.step * row + row * (10 / 64)
    const height = row * (44 / 64)
    for (const x of [bar.start * perSecond, bar.start * perSecond - canvas.width]) {
      roundRect(context, x, y, width, height, height * (5 / 44))
      context.fillStyle = fills[bar.tone]
      context.fill()
    }
  }
  return canvas
}

// A deal: a card with its name and customer, and how sure it is, filled in below.
export function drawCard(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const context = canvas.getContext('2d')!
  roundRect(context, 3, 3, 294, 194, 18)
  context.fillStyle = COLORS.card
  context.fill()
  context.lineWidth = 4
  context.strokeStyle = COLORS.border
  context.stroke()
  context.fillStyle = COLORS.slate
  roundRect(context, 26, 30, 150, 22, 6)
  context.fill()
  context.fillStyle = COLORS.muted
  roundRect(context, 26, 70, 210, 14, 5)
  context.fill()
  roundRect(context, 26, 96, 120, 14, 5)
  context.fill()
  return canvas
}

// A soft shadow on the floor: dark in the middle, fading out to nothing at the edge.
export function drawShadow(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(20, 20, 19, 0.5)')
  gradient.addColorStop(0.5, 'rgba(20, 20, 19, 0.22)')
  gradient.addColorStop(1, 'rgba(20, 20, 19, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return canvas
}

// A soft round light, for the word running down a line.
export function drawGlow(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return canvas
}
