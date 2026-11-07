// Who works in the app and the screens each of them uses. Production plans the month and runs
// the floor, sales keeps the deals, and the head office watches the distributors' stock and
// hands demand to the plan. Settings and data belong to no one role.

export type Role = 'production' | 'sales' | 'headOffice'

export type Screen =
  | 'outlook'
  | 'progress'
  | 'factory'
  | 'gantt'
  | 'decisions'
  | 'deals'
  | 'channels'
  | 'demand'
  | 'settings'

export const ROLES: { value: Role; label: string }[] = [
  { value: 'production', label: '製造' },
  { value: 'sales', label: '営業' },
  { value: 'headOffice', label: '本部' },
]

// Each role's screens in the order of its day; the first is where the role starts.
const SCREENS: Record<Role, readonly Screen[]> = {
  production: ['outlook', 'progress', 'factory', 'gantt', 'decisions'],
  sales: ['deals'],
  headOffice: ['channels', 'demand'],
}

export function screensOf(role: Role): readonly Screen[] {
  return SCREENS[role]
}

// The role a screen belongs to; settings and data belongs to none.
export function roleOf(screen: Screen): Role | null {
  return ROLES.find(({ value }) => SCREENS[value].includes(screen))?.value ?? null
}

// The role chosen, the screen open, and the screen each role had open last.
export type Navigation = { role: Role; screen: Screen; last: Record<Role, Screen> }

// The first visit opens production's plan for this month.
export const FIRST_VISIT: Navigation = {
  role: 'production',
  screen: 'outlook',
  last: { production: 'outlook', sales: 'deals', headOffice: 'channels' },
}

// Picking a role opens the screen it had open last.
export function pickRole(navigation: Navigation, role: Role): Navigation {
  return { ...navigation, role, screen: navigation.last[role] }
}

// Opening a screen of another role brings that role along. Settings keeps the role chosen,
// so leaving them returns to its screen.
export function openScreen(navigation: Navigation, screen: Screen): Navigation {
  const role = roleOf(screen)
  if (!role) return { ...navigation, screen }
  return { role, screen, last: { ...navigation.last, [role]: screen } }
}

// What is kept for the next visit: the role and each role's last screen.
export function saveNavigation(navigation: Navigation): string {
  return JSON.stringify({ role: navigation.role, last: navigation.last })
}

// A kept navigation, read back. Anything unknown, as from an older version, falls back to
// the first visit's.
export function loadNavigation(saved: string | null): Navigation {
  if (!saved) return FIRST_VISIT
  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    return FIRST_VISIT
  }
  if (typeof parsed !== 'object' || parsed === null) return FIRST_VISIT
  const { role, last } = parsed as { role?: unknown; last?: unknown }
  const kept = typeof last === 'object' && last !== null ? (last as Record<string, unknown>) : {}
  const lastScreens = Object.fromEntries(
    ROLES.map(({ value }) => {
      const screen = kept[value]
      return [value, SCREENS[value].find((candidate) => candidate === screen) ?? FIRST_VISIT.last[value]]
    }),
  ) as Record<Role, Screen>
  const chosen = ROLES.find(({ value }) => value === role)?.value ?? FIRST_VISIT.role
  return { role: chosen, screen: lastScreens[chosen], last: lastScreens }
}
