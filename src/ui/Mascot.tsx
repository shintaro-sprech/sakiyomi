export type MascotState = 'idle' | 'thinking' | 'speaking'

type Props = {
  state: MascotState
  size?: number
  // Small avatars next to replies stay still.
  still?: boolean
}

const LABELS: Record<MascotState, string> = {
  idle: 'サキヨミのアシスタント',
  thinking: 'サキヨミのアシスタント（考えています）',
  speaking: 'サキヨミのアシスタント（話しています）',
}

// The app's own character, drawn for this project. Its states are driven by CSS classes in index.css.
export function Mascot({ state, size = 48, still = false }: Props) {
  return (
    <svg
      className={`mascot is-${state}${still ? ' is-still' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={LABELS[state]}
    >
      <g className="mascot-body">
        <line x1="32" y1="15" x2="32" y2="7" className="mascot-stem" />
        <circle cx="32" cy="6" r="3.2" className="mascot-lamp" />
        <rect x="7" y="29" width="6" height="12" rx="3" className="mascot-ear" />
        <rect x="51" y="29" width="6" height="12" rx="3" className="mascot-ear" />
        <rect x="10" y="14" width="44" height="42" rx="21" className="mascot-head" />
        <rect x="16" y="23" width="32" height="23" rx="11.5" className="mascot-face" />
        <g className="mascot-eyes">
          <ellipse cx="26" cy="33" rx="3" ry="4" className="mascot-eye" />
          <ellipse cx="38" cy="33" rx="3" ry="4" className="mascot-eye" />
        </g>
        <path d="M28 40 Q32 43.5 36 40" className="mascot-smile" />
        <ellipse cx="32" cy="41" rx="3" ry="2.2" className="mascot-mouth" />
      </g>
    </svg>
  )
}
