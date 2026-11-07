import { describe, expect, it } from 'vitest'

import { FIRST_VISIT, loadNavigation, openScreen, pickRole, ROLES, roleOf, saveNavigation, screensOf, type Screen } from './roles'

describe('roles', () => {
  it('gives each role its own screens, in the order of its day', () => {
    expect(ROLES.map((role) => role.label)).toEqual(['製造', '営業', '本部'])
    expect(screensOf('production')).toEqual(['outlook', 'progress', 'factory', 'gantt', 'decisions'])
    expect(screensOf('sales')).toEqual(['deals'])
    expect(screensOf('headOffice')).toEqual(['channels', 'demand'])
  })

  it('puts every screen but settings under exactly one role', () => {
    const screens: Screen[] = ['outlook', 'progress', 'factory', 'gantt', 'decisions', 'deals', 'channels', 'demand']
    for (const screen of screens) {
      expect(ROLES.filter((role) => screensOf(role.value).includes(screen))).toHaveLength(1)
    }
    expect(roleOf('channels')).toBe('headOffice')
    expect(roleOf('settings')).toBeNull()
  })

  it('opens production on its plan for this month the first time', () => {
    expect(FIRST_VISIT.role).toBe('production')
    expect(FIRST_VISIT.screen).toBe('outlook')
    expect(pickRole(FIRST_VISIT, 'sales').screen).toBe('deals')
    expect(pickRole(FIRST_VISIT, 'headOffice').screen).toBe('channels')
  })

  it('returns to the screen a role had open last', () => {
    let navigation = openScreen(FIRST_VISIT, 'gantt')
    navigation = pickRole(navigation, 'headOffice')
    navigation = openScreen(navigation, 'demand')
    navigation = pickRole(navigation, 'production')
    expect(navigation).toMatchObject({ role: 'production', screen: 'gantt' })
    expect(pickRole(navigation, 'headOffice').screen).toBe('demand')
  })

  it('brings the role along when a screen of another role opens', () => {
    const navigation = openScreen(FIRST_VISIT, 'channels')
    expect(navigation).toMatchObject({ role: 'headOffice', screen: 'channels' })
    expect(navigation.last.production).toBe('outlook')
  })

  it('keeps the role while settings are open, and goes back to its screen after', () => {
    const before = openScreen(FIRST_VISIT, 'progress')
    const settings = openScreen(before, 'settings')
    expect(settings).toMatchObject({ role: 'production', screen: 'settings' })
    expect(settings.last).toEqual(before.last)
    expect(pickRole(settings, 'production').screen).toBe('progress')
    expect(pickRole(settings, 'sales').screen).toBe('deals')
  })

  it('remembers the role and each role’s last screen, but not settings', () => {
    let navigation = openScreen(FIRST_VISIT, 'factory')
    navigation = openScreen(navigation, 'demand')
    navigation = openScreen(navigation, 'settings')
    expect(loadNavigation(saveNavigation(navigation))).toEqual({
      role: 'headOffice',
      screen: 'demand',
      last: { production: 'factory', sales: 'deals', headOffice: 'demand' },
    })
  })

  it('starts afresh from anything it does not know', () => {
    for (const saved of [null, '', '{', '[]', '"sales"', '{"role":"floor"}', '{"role":null,"last":3}']) {
      expect(loadNavigation(saved)).toEqual(FIRST_VISIT)
    }
    // A screen kept under the wrong role, or one no longer there, falls back to the role's first.
    expect(loadNavigation('{"role":"sales","last":{"sales":"gantt","headOffice":"inventory","production":"decisions"}}')).toEqual({
      role: 'sales',
      screen: 'deals',
      last: { production: 'decisions', sales: 'deals', headOffice: 'channels' },
    })
  })
})
