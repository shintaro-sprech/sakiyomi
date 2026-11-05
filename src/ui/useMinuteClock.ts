import { useEffect, useState } from 'react'

// The time now, updated at the start of every minute.
export function useMinuteClock(): Date {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(new Date()), 60_000 - (clock.getSeconds() * 1000 + clock.getMilliseconds()))
    return () => window.clearTimeout(timer)
  }, [clock])
  return clock
}
