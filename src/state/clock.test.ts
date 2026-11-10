import { afterEach, describe, expect, it, vi } from 'vitest'

import { RECORDED } from '../assistant/preparedAnswers.recorded'

describe('clock', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('stays on the day the prepared answers were recorded, keeping the time of day', async () => {
    vi.stubEnv('VITE_SAKIYOMI_PREPARED_ANSWERS', '1')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-03T14:25:00'))
    const { appToday, currentTime } = await import('./clock')
    expect(appToday()).toBe(RECORDED.recordedOn)
    expect([currentTime().getHours(), currentTime().getMinutes()]).toEqual([14, 25])
  })

  it('follows the real date otherwise', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-03T14:25:00'))
    const { appToday } = await import('./clock')
    expect(appToday()).toBe('2027-03-03')
  })
})
