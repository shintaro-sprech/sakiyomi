import { useReducedMotion } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'

// A number that runs from where it was to its new value, so a change in the plan is seen
// as it happens. It is the value itself when motion is reduced.
export function useCountUp(target: number, duration = 1200): number {
  // Read at once, so with motion reduced the first frame already shows the value.
  const reduceMotion = useReducedMotion(false, { getInitialValueInEffect: false })
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    if (reduceMotion) return
    const start = from.current
    const begin = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / duration)
      const value = Math.round(start + (target - start) * (1 - Math.pow(1 - t, 3)))
      from.current = value
      setShown(value)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, reduceMotion])

  return reduceMotion ? target : shown
}
