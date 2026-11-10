import { useEffect, useState } from 'react'

import { currentTime } from '../state/clock'

// The time now, updated at the start of every minute.
export function useMinuteClock(): Date {
  const [clock, setClock] = useState(() => currentTime())
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(currentTime()), 60_000 - (clock.getSeconds() * 1000 + clock.getMilliseconds()))
    return () => window.clearTimeout(timer)
  }, [clock])
  return clock
}
