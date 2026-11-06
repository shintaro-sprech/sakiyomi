import { Center, Loader } from '@mantine/core'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'

import { moveFocus } from '../quietFocus'
import { Entrance } from './Entrance'
import { APP_PATH, isAppPath } from './route'

// The app loads apart from the entrance, so the entrance shows first and fast; while it shows,
// the app loads behind it, and the button opens it at once.
const loadApp = () => import('../../App.tsx')

// Swaps the entrance and the app, cross-fading where the browser can and motion is welcome.
function transition(swap: () => void) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !reduced) document.startViewTransition(swap)
  else swap()
}

export function Root() {
  const [inApp, setInApp] = useState(() => isAppPath(window.location.pathname))
  const [App, setApp] = useState<ComponentType<{ onLogout?: () => void }> | null>(null)
  const [entering, setEntering] = useState(false)
  // Where focus goes once the entrance or the app shows after a move between them: the app's
  // heading, or the entrance's button.
  const focusTo = useRef<'app' | 'entrance' | null>(null)

  useEffect(() => {
    let current = true
    loadApp().then(
      (module) => current && setApp(() => module.default),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [])

  // Back and forward move between the entrance and the app.
  useEffect(() => {
    const onPop = () => {
      const app = isAppPath(window.location.pathname)
      focusTo.current = app ? 'app' : 'entrance'
      setInApp(app)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const target = focusTo.current
    if (!target || (target === 'app' && (!inApp || !App)) || (target === 'entrance' && inApp)) return
    focusTo.current = null
    const element = document.querySelector<HTMLElement>(target === 'app' ? '#root h1' : '#root .entrance-button')
    if (element) moveFocus(element, { preventScroll: true })
  }, [inApp, App])

  const enter = async () => {
    if (entering) return
    setEntering(true)
    let module: Awaited<ReturnType<typeof loadApp>>
    try {
      module = await loadApp()
    } catch {
      // The app's files did not load: a full page load tries again.
      window.location.assign(APP_PATH)
      return
    }
    window.history.pushState(null, '', APP_PATH)
    focusTo.current = 'app'
    const swap = () =>
      flushSync(() => {
        setApp(() => module.default)
        setInApp(true)
        setEntering(false)
      })
    transition(swap)
  }

  // Logging out of the app goes back to the entrance.
  const leave = () => {
    window.history.pushState(null, '', '/')
    focusTo.current = 'entrance'
    transition(() => flushSync(() => setInApp(false)))
  }

  if (!inApp) return <Entrance onEnter={enter} entering={entering} appLoaded={App !== null} />
  if (!App) {
    return (
      <Center h="100dvh">
        <Loader size="sm" aria-label="読み込み中" />
      </Center>
    )
  }
  return <App onLogout={leave} />
}
