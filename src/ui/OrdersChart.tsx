import { useElementSize } from '@mantine/hooks'
import { useState } from 'react'

import { pieces, yearMonth } from './format'

type Point = { month: string; quantity: number }

const HEIGHT = 150
const PAD = { left: 40, right: 40, top: 14, bottom: 24 }

// Orders of one part month by month: the months already taken as a solid line, the forecast
// as a dashed line of the same color going on from the last of them. One series, so the line
// ends carry its labels. The chart is drawn at the width it is given, so its text keeps its
// size; hovering a month shows its figure, and the table beside it has every figure.
export function OrdersChart({ actual, forecast, label }: { actual: Point[]; forecast: Point[]; label: string }) {
  const { ref, width: measured } = useElementSize()
  const [active, setActive] = useState<number | null>(null)
  const points = [...actual, ...forecast]
  const width = Math.max(240, Math.round(measured))
  const top = Math.max(1, ...points.map((point) => point.quantity))
  const step = 10 ** Math.floor(Math.log10(top))
  const ceiling = Math.ceil(top / step) * step
  const span = (width - PAD.left - PAD.right) / Math.max(1, points.length - 1)
  const x = (index: number) => PAD.left + index * span
  const y = (value: number) => PAD.top + (1 - value / ceiling) * (HEIGHT - PAD.top - PAD.bottom)
  const path = (from: number, to: number) =>
    points
      .slice(from, to)
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(from + index).toFixed(1)},${y(point.quantity).toFixed(1)}`)
      .join(' ')
  const last = actual.length - 1
  const shown = active === null ? null : points[active]
  return (
    <figure className="orders-chart" ref={ref}>
      {points.length > 0 && measured > 0 && (
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label={label}>
          {[0, 0.5, 1].map((share) => (
            <g key={share}>
              <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(ceiling * share)} y2={y(ceiling * share)} />
              <text className="chart-axis" x={PAD.left - 6} y={y(ceiling * share) + 4} textAnchor="end">
                {pieces(ceiling * share)}
              </text>
            </g>
          ))}
          {[0, points.length - 1].map((index, position) => (
            <text key={index} className="chart-axis" x={x(index)} y={HEIGHT - 6} textAnchor={position === 0 ? 'start' : 'end'}>
              {yearMonth(points[index].month)}
            </text>
          ))}
          <path className="chart-line" d={path(0, actual.length)} />
          {forecast.length > 0 && <path className="chart-line chart-line-forecast" d={path(Math.max(0, last), points.length)} />}
          {last >= 0 && (
            <text className="chart-label" x={x(last)} y={y(actual[last].quantity) - 8} textAnchor="middle">
              実績
            </text>
          )}
          {forecast.length > 0 && (
            <text className="chart-label" x={x(points.length - 1) + 4} y={y(forecast[forecast.length - 1].quantity) + 4}>
              予測
            </text>
          )}
          {shown && active !== null && (
            <g>
              <line className="chart-cross" x1={x(active)} x2={x(active)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
              <circle className="chart-dot" cx={x(active)} cy={y(shown.quantity)} r={4} />
            </g>
          )}
          {points.map((point, index) => (
            <rect
              key={point.month}
              x={x(index) - span / 2}
              y={PAD.top}
              width={span}
              height={HEIGHT - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
      )}
      <div className="chart-readout tabular">
        {shown ? `${yearMonth(shown.month)}　${active !== null && active > last ? '予測' : '実績'} ${pieces(shown.quantity)}個` : ' '}
      </div>
    </figure>
  )
}
