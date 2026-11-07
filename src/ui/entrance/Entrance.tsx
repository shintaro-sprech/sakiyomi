import './entrance.css'

import { Button, Loader, Text, Title, VisuallyHidden } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { IconChevronRight } from '@tabler/icons-react'
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// three.js and the models load only here and on the floor tab, after the words and the button
// are already on screen.
const EntranceScene = lazy(() => import('./EntranceScene'))

type Props = {
  onEnter: () => void
  // Set while the app is still loading after the button was pressed.
  entering: boolean
  // Whether the app has loaded. The scene waits for it, so on a slow line the button opens
  // the app as soon as it can, and the scene comes after.
  appLoaded: boolean
}

// Whether the scene may move here: not when the visitor has asked for less motion or to save
// data. Then the still picture is all there is.
function mayMove(reducedMotion: boolean): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !reducedMotion && !connection?.saveData
}

// Whether this browser can draw the scene, tried on a canvas of its own that is let go at once,
// so without WebGL 2 not even three.js is fetched.
function canDraw(): boolean {
  try {
    const context = document.createElement('canvas').getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return Boolean(context)
  } catch {
    return false
  }
}

// The way in: a picture of the work flowing from deals to shipping on time, and over it a card of
// frosted glass with the mark, the name and one button into the app. Nothing to sign in to.
export function Entrance({ onEnter, entering, appLoaded }: Props) {
  const reducedMotion = useReducedMotion(false, { getInitialValueInEffect: false })
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  // Tried after the words and the button are on screen, not before.
  const [drawable, setDrawable] = useState(false)
  const root = useRef<HTMLElement>(null)
  const moves = mayMove(reducedMotion) && appLoaded
  useEffect(() => {
    if (!moves) return
    const frame = requestAnimationFrame(() => setDrawable(canDraw()))
    return () => cancelAnimationFrame(frame)
  }, [moves])
  const live = moves && drawable && !failed
  const onReady = useCallback(() => setReady(true), [])
  const onLost = useCallback(() => setFailed(true), [])
  return (
    <main ref={root} className="entrance">
      {/* The picture says nothing a screen reader needs; the words below say what this is. */}
      <div className="entrance-stage" aria-hidden="true">
        <picture>
          {/* The still picture for the nearest shape of screen (scripts/entrance/still.mjs). */}
          <source media="(max-height: 500px) and (min-aspect-ratio: 6/5)" srcSet="/entrance/still-low.webp" />
          <source media="(max-aspect-ratio: 1/2)" srcSet="/entrance/still-tall.webp" />
          <source media="(max-aspect-ratio: 2/3)" srcSet="/entrance/still-phone.webp" />
          <source media="(max-aspect-ratio: 1/1)" srcSet="/entrance/still-tablet.webp" />
          <source media="(max-aspect-ratio: 29/20)" srcSet="/entrance/still-classic.webp" />
          <source media="(min-aspect-ratio: 19/10)" srcSet="/entrance/still-widest.webp" />
          <source media="(min-aspect-ratio: 17/10)" srcSet="/entrance/still-wider.webp" />
          <img className="entrance-still" src="/entrance/still-wide.webp" alt="" decoding="async" fetchPriority="high" />
        </picture>
        {live && (
          <div className="entrance-scene" data-ready={ready}>
            <SceneBoundary onError={onLost}>
              <Suspense fallback={null}>
                <EntranceScene eventSource={root} onReady={onReady} onLost={onLost} />
              </Suspense>
            </SceneBoundary>
          </div>
        )}
      </div>
      <div className="entrance-copy">
        {/* The heading says the name; the mark above it is only a picture. */}
        <img className="entrance-mark" src="/sakiyomi-mark.svg" alt="" width={44} height={44} />
        <Title order={1} className="entrance-title">
          サキヨミ
        </Title>
        <Text className="entrance-lead">
          商談から出荷までを先読みする<wbr />
          生産計画アシスタント
        </Text>
        <Button
          fullWidth
          size="lg"
          color="ink"
          className="entrance-button"
          // While the app loads, a spinner in place of the chevron; the button stays enabled, so
          // focus stays on it.
          rightSection={entering ? <Loader size={18} color="white" /> : <IconChevronRight size={20} stroke={2} aria-hidden="true" />}
          aria-busy={entering}
          // The name as it reads, without the space a screen reader puts at the <wbr>.
          aria-label="アプリを見る"
          onClick={onEnter}
        >
          アプリを<wbr />
          見る
        </Button>
        {/* Says that the app is loading to a screen reader, which the spinner does not. */}
        <VisuallyHidden role="status">{entering ? '読み込み中' : ''}</VisuallyHidden>
      </div>
    </main>
  )
}

// If the scene cannot be drawn (no WebGL after all, or its files failed to load), the still
// picture stays and the button works as before.
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
