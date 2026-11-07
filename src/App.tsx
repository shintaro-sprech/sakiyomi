import {
  ActionIcon,
  Alert,
  AppShell,
  Burger,
  Button,
  Divider,
  Group,
  Loader,
  NavLink,
  SegmentedControl,
  Tabs,
  Text,
  Tooltip,
  VisuallyHidden,
  useMantineTheme,
} from '@mantine/core'
import { useDisclosure, useMediaQuery, useReducedMotion } from '@mantine/hooks'
import {
  IconBriefcase,
  IconBuildingFactory2,
  IconBuildingWarehouse,
  IconCalendarStats,
  IconChartBar,
  IconChartLine,
  IconClipboardList,
  IconLayoutKanban,
  IconLogout,
  IconMessageCircle,
  IconSettings,
} from '@tabler/icons-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { changesToApply, type ProposedOption } from './assistant/tools'
import type { Replenishment } from './engine/demand'
import { releaseTiming, runPlan } from './engine/plan'
import { ChangeError, describeChange, type Change } from './engine/scenario'
import type { PlantData } from './engine/types'
import { currentVersion, dealsVersion } from './engine/handoff'
import { useDealInsights } from './state/dealInsights'
import { useAppState } from './state/store'
import { ChannelsView } from './ui/ChannelsView'
import { ChatPanel } from './ui/ChatPanel'
import { nowAt } from './ui/clock'
import { DealsView } from './ui/DealsView'
import { DemandView } from './ui/DemandView'
import { DecisionsView } from './ui/DecisionsView'
import { GanttView } from './ui/GanttView'
import { OutlookView } from './ui/OutlookView'
import { ProgressView } from './ui/ProgressView'
import { SettingsView } from './ui/SettingsView'
import { moveFocus } from './ui/quietFocus'
import {
  FIRST_VISIT,
  loadNavigation,
  openScreen,
  pickRole,
  ROLES,
  saveNavigation,
  screensOf,
  type Navigation,
  type Role,
  type Screen,
} from './ui/roles'

// The floor in 3D loads three.js only when its tab opens.
const FactoryView = lazy(() => import('./ui/FactoryView'))

// Which role's screens come in which order is in roles.ts; these are their names.
const SCREENS: Record<Screen, { label: string; icon: ReactNode }> = {
  outlook: { label: '今月の計画', icon: <IconCalendarStats size={16} /> },
  progress: { label: '進捗', icon: <IconChartBar size={16} /> },
  factory: { label: '現場', icon: <IconBuildingFactory2 size={16} /> },
  gantt: { label: 'ガント', icon: <IconLayoutKanban size={16} /> },
  decisions: { label: '判断の記録', icon: <IconClipboardList size={16} /> },
  deals: { label: '商談', icon: <IconBriefcase size={16} /> },
  channels: { label: '代理店の在庫', icon: <IconBuildingWarehouse size={16} /> },
  demand: { label: '需要予測', icon: <IconChartLine size={16} /> },
  settings: { label: '設定とデータ', icon: <IconSettings size={16} /> },
}

// The role and each role's last screen are kept in the browser for the next visit. Storage can
// be missing or blocked; the app then starts as on a first visit and keeps working.
const NAVIGATION_KEY = 'sakiyomi:navigation'

function readNavigation(): Navigation {
  try {
    return loadNavigation(window.localStorage.getItem(NAVIGATION_KEY))
  } catch {
    return FIRST_VISIT
  }
}

function App({ onLogout }: { onLogout?: () => void }) {
  const app = useAppState()
  const theme = useMantineTheme()
  // Below xl the panel would squeeze the progress table, and below md it covers the screen.
  const wide = useMediaQuery(`(min-width: ${theme.breakpoints.xl})`, true, { getInitialValueInEffect: false })
  const medium = useMediaQuery(`(min-width: ${theme.breakpoints.md})`, true, { getInitialValueInEffect: false })
  // From this width the role switch and the tabs sit in the header; below it, in the menu.
  const roomy = useMediaQuery(`(min-width: ${theme.breakpoints.tabs})`, true, { getInitialValueInEffect: false })
  const [navigation, setNavigation] = useState<Navigation>(readNavigation)
  const { role, screen } = navigation
  // The smallest chance of a deal counted, chosen on the deals tab.
  const [dealThreshold, setDealThreshold] = useState(0.8)
  // A lot the Gantt chart asked the progress tab to show, until another tab is picked.
  const [progressFocus, setProgressFocus] = useState<{ orderId: string; lotId: string } | null>(null)
  // A distributor today's focus asked the head office's screen to show, likewise.
  const [channelFocus, setChannelFocus] = useState<{ customer: string; partNumber: string } | null>(null)
  const [preview, setPreview] = useState<ProposedOption | null>(null)
  // The title of an option closed because its changes no longer apply.
  const [lostPreview, setLostPreview] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(wide)
  const [navOpened, nav] = useDisclosure(false)
  const reduceMotion = useReducedMotion()
  const bannerRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)
  const focusBanner = useRef(false)
  const { planState, saved } = app
  useEffect(() => {
    try {
      window.localStorage.setItem(NAVIGATION_KEY, saveNavigation(navigation))
    } catch {
      // Keep working without remembering.
    }
  }, [navigation])
  const insights = useDealInsights(saved.data, planState.today, dealThreshold)
  // The deals' demand is handed to the plan once a day, and again that day when it changes.
  const { saveHandoff } = app
  const handoffs = saved.handoffs
  useEffect(() => {
    const current = currentVersion(handoffs ?? [], 'deals')
    const version = dealsVersion(insights.handoffDemand, planState.today, nowAt())
    if (current && current.baseDate === version.baseDate && JSON.stringify(current.rows) === JSON.stringify(version.rows)) return
    saveHandoff(version)
  }, [insights.handoffDemand, planState.today, handoffs, saveHandoff])

  const previewChanges = useMemo(
    () => (preview ? changesToApply(preview, planState.adopted).changes : []),
    [planState, preview],
  )
  // An option whose changes no longer apply, after a decision was adopted or undone since
  // Claude proposed it, shows the plan without it and closes.
  const planned = useMemo(() => {
    try {
      return { plan: runPlan(planState, previewChanges), previewFailed: false }
    } catch (error) {
      if (!(error instanceof ChangeError)) throw error
      return { plan: runPlan(planState), previewFailed: true }
    }
  }, [planState, previewChanges])
  const { plan } = planned
  if (planned.previewFailed && preview) {
    setLostPreview(preview.title)
    setPreview(null)
  }
  const timingOf = useCallback(
    (item: Replenishment) => releaseTiming(planState, item, planned.previewFailed ? [] : previewChanges),
    [planState, previewChanges, planned.previewFailed],
  )

  // The menu only exists where the tabs do not fit the header.
  const closeNav = nav.close
  useEffect(() => {
    if (roomy) closeNav()
  }, [roomy, closeNav])

  // After a phone preview closes the panel, the pressed button is gone; move focus to the banner.
  useEffect(() => {
    if (preview && focusBanner.current) {
      focusBanner.current = false
      bannerRef.current?.focus()
    }
  }, [preview])

  function selectScreen(value: Screen) {
    // A new screen opens at its top, not where the last one was scrolled to. A screen opened
    // to show a row or a lot scrolls to it after.
    if (value !== screen) window.scrollTo({ top: 0 })
    setNavigation((current) => openScreen(current, value))
    setProgressFocus(null)
    setChannelFocus(null)
    // Picked from the menu, which closes under the focus: the screen's heading takes it (WCAG 2.4.3).
    if (navOpened) {
      nav.close()
      // A screen loaded on first use has no heading yet; look again each frame for a second.
      let frames = 60
      const focusHeading = () => {
        const heading = mainRef.current?.querySelector<HTMLElement>('h2')
        if (heading) moveFocus(heading)
        else if ((frames -= 1) > 0) requestAnimationFrame(focusHeading)
      }
      requestAnimationFrame(focusHeading)
    }
  }

  // A role opens the screen it had open last. In the menu, the menu stays open on the role's
  // screens, so focus stays on the role switch.
  function selectRole(value: Role) {
    if (value !== role || screen === 'settings') window.scrollTo({ top: 0 })
    setNavigation((current) => pickRole(current, value))
    setProgressFocus(null)
    setChannelFocus(null)
  }

  // The role switch reports only a change of role. Clicking the role already chosen while
  // settings are open goes back to that role's screen.
  function pressRole(event: React.MouseEvent<HTMLDivElement>) {
    if (screen === 'settings' && event.target instanceof HTMLInputElement && event.target.value === role) selectRole(role)
  }

  // The gear opens settings from any role, and closes them back to the role's screen.
  function toggleSettings() {
    selectScreen(screen === 'settings' ? navigation.last[role] : 'settings')
  }

  // Escape closes the menu and puts focus back on the button that opened it.
  function closeNavByKey(event: React.KeyboardEvent) {
    if (event.key !== 'Escape' || !navOpened) return
    nav.close()
    burgerRef.current?.focus()
  }

  function showInProgress(orderId: string, lotId: string) {
    selectScreen('progress')
    setProgressFocus({ orderId, lotId })
  }

  // A distributor about to order is the head office's to deal with: its role and its row.
  function showChannel(customer: string, partNumber: string) {
    selectScreen('channels')
    setChannelFocus({ customer, partNumber })
  }

  // On a phone the menu and the panel both cover the screen, so only one is open at a time.
  function toggleNav() {
    if (!navOpened && !medium) setChatOpen(false)
    nav.toggle()
  }

  function toggleChat() {
    if (!chatOpen && !medium) nav.close()
    setChatOpen((open) => !open)
  }

  // On a phone the panel covers the plan, so close it to show the option being previewed.
  function showPreview(option: ProposedOption | null) {
    setPreview(option)
    setLostPreview(null)
    if (option && !medium) {
      setChatOpen(false)
      focusBanner.current = true
    }
  }

  const roleLabel = ROLES.find((item) => item.value === role)?.label
  const count = (value: Screen) =>
    value === 'decisions' && saved.decisions.length > 0 ? (
      <span className="tab-count">
        {saved.decisions.length}
        <VisuallyHidden>件</VisuallyHidden>
      </span>
    ) : undefined

  return (
    <AppShell
      header={{ height: 56 }}
      // The role switch and its tabs fit the header from the tabs breakpoint; below it they move into the menu.
      navbar={{ width: 240, breakpoint: 'tabs', collapsed: { mobile: !navOpened, desktop: true } }}
      aside={{ width: 400, breakpoint: 'md', collapsed: { desktop: !chatOpen, mobile: !chatOpen } }}
      padding="md"
      transitionDuration={reduceMotion ? 0 : 200}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="md">
          <Group gap="lg" wrap="nowrap" className="header-start">
            <Burger
              ref={burgerRef}
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="tabs"
              size="sm"
              aria-label="画面の一覧"
              aria-expanded={navOpened}
              aria-controls="app-menu"
            />
            <Group gap={8} wrap="nowrap" className="header-title">
              <img className="app-logo" src="/sakiyomi-mark.svg" alt="" width={26} height={26} />
              <Text component="h1" fw={700} size="lg" className="app-name">
                サキヨミ
              </Text>
              {/* Where the tabs are folded into the menu, the screen's name stays beside the logo. */}
              <Text fw={700} hiddenFrom="tabs" aria-hidden="true" className="nowrap screen-name">
                ／{SCREENS[screen].label}
              </Text>
            </Group>
            {/* The role comes first and its screens right after it; settings open from the gear. */}
            <Group gap="sm" wrap="nowrap" ml="xs" visibleFrom="tabs">
              <SegmentedControl
                data={ROLES}
                value={role}
                onChange={(value) => selectRole(value as Role)}
                onClick={pressRole}
                color="primary"
                aria-label="担当"
              />
              <Tabs value={screen === 'settings' ? null : screen} onChange={(value) => value && selectScreen(value as Screen)} variant="pills">
                <Tabs.List aria-label={`${roleLabel}の画面`}>
                  {screensOf(role).map((value) => (
                    <Tabs.Tab key={value} value={value} leftSection={SCREENS[value].icon} rightSection={count(value)}>
                      {SCREENS[value].label}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs>
            </Group>
          </Group>
          <Group gap={8} wrap="nowrap">
            <Button
              variant={chatOpen ? 'default' : 'filled'}
              leftSection={<IconMessageCircle size={18} />}
              onClick={toggleChat}
              aria-expanded={chatOpen}
              aria-controls="chat-panel"
              visibleFrom="sm"
            >
              {chatOpen ? '相談を閉じる' : 'Claude に相談'}
            </Button>
            <ActionIcon
              variant={chatOpen ? 'default' : 'filled'}
              size="lg"
              onClick={toggleChat}
              aria-expanded={chatOpen}
              aria-controls="chat-panel"
              aria-label={chatOpen ? '相談を閉じる' : 'Claude に相談'}
              hiddenFrom="sm"
            >
              <IconMessageCircle size={18} />
            </ActionIcon>
            {/* On a phone the gear has no room here; settings sit at the end of the menu instead. */}
            <Tooltip label={SCREENS.settings.label} withArrow events={{ hover: true, focus: true, touch: false }}>
              <ActionIcon
                variant={screen === 'settings' ? 'filled' : 'default'}
                size="lg"
                onClick={toggleSettings}
                aria-label={SCREENS.settings.label}
                aria-pressed={screen === 'settings'}
                visibleFrom="xs"
              >
                <IconSettings size={18} />
              </ActionIcon>
            </Tooltip>
            {onLogout && (
              <Tooltip label="ログアウト" withArrow>
                <ActionIcon variant="default" size="lg" onClick={onLogout} aria-label="ログアウト">
                  <IconLogout size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" id="app-menu" aria-label="画面の一覧" inert={!navOpened} onKeyDown={closeNavByKey}>
        <SegmentedControl
          data={ROLES}
          value={role}
          onChange={(value) => selectRole(value as Role)}
          onClick={pressRole}
          color="primary"
          aria-label="担当"
          fullWidth
          mb="sm"
        />
        {screensOf(role).map((value) => (
          <NavLink
            key={value}
            component="button"
            label={SCREENS[value].label}
            leftSection={SCREENS[value].icon}
            rightSection={count(value)}
            active={screen === value}
            variant="filled"
            aria-current={screen === value ? 'page' : undefined}
            onClick={() => selectScreen(value)}
          />
        ))}
        <Divider my="sm" hiddenFrom="xs" />
        <NavLink
          component="button"
          label={SCREENS.settings.label}
          leftSection={SCREENS.settings.icon}
          active={screen === 'settings'}
          variant="filled"
          aria-current={screen === 'settings' ? 'page' : undefined}
          onClick={() => selectScreen('settings')}
          hiddenFrom="xs"
        />
      </AppShell.Navbar>

      {/* The open menu covers the page, and so does the panel on a phone, so the page must not take focus then (WCAG 2.4.11). */}
      <AppShell.Main inert={navOpened || (!medium && chatOpen)} ref={mainRef}>
        {plan.skipped.length > 0 && (
          <Alert color="orange" variant="light" mb="md" title="計画に入れられない変更があります">
            <Text size="sm">
              判断の記録の次の変更は、もう当てられないので外して計画しています：
              {plan.skipped.map((change) => safeLabel(change, planState.data)).join('、')}
            </Text>
          </Alert>
        )}
        {lostPreview && (
          <Alert
            color="orange"
            variant="light"
            mb="md"
            role="status"
            withCloseButton
            closeButtonLabel="閉じる"
            onClose={() => setLostPreview(null)}
          >
            <Text size="sm">
              案「{lostPreview}」は、そのあとの判断で計画に当てられなくなったので、表示をやめました。Claude にもう一度相談してください。
            </Text>
          </Alert>
        )}
        {preview && (
          <Alert color="blue" variant="light" mb="md" role="status" ref={bannerRef} tabIndex={-1}>
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Text size="sm">案「{preview.title}」を表示中</Text>
              <Button size="xs" variant="default" onClick={() => setPreview(null)}>
                元の計画に戻す
              </Button>
            </Group>
          </Alert>
        )}
        {screen === 'outlook' && (
          // While an option is previewed the outlook shows its plan, so nothing is added from it.
          <OutlookView
            plan={plan}
            today={planState.today}
            timingOf={timingOf}
            onAdopt={preview ? undefined : app.adopt}
            dealDemand={insights.handoffDemand}
            onShowOrder={(orderId) => showInProgress(orderId, '')}
            onShowChannel={showChannel}
          />
        )}
        {screen === 'deals' && (
          <DealsView app={app} today={planState.today} insights={insights} threshold={dealThreshold} onThreshold={setDealThreshold} />
        )}
        {screen === 'channels' && <ChannelsView data={plan.scenario.data} today={planState.today} pointed={channelFocus} />}
        {screen === 'demand' && <DemandView app={app} today={planState.today} />}
        {screen === 'progress' && (
          <ProgressView
            plan={plan}
            today={planState.today}
            warningDays={saved.settings.stagnationWarningDays}
            focus={progressFocus}
          />
        )}
        {screen === 'factory' && (
          <Suspense fallback={<Loader size="sm" m="xl" />}>
            <FactoryView plan={plan} today={planState.today} />
          </Suspense>
        )}
        {screen === 'gantt' && (
          <GanttView plan={plan} today={planState.today} highlight={preview} onShowInProgress={showInProgress} />
        )}
        {screen === 'decisions' && <DecisionsView decisions={saved.decisions} onRemove={app.removeDecision} />}
        {screen === 'settings' && <SettingsView app={app} />}
      </AppShell.Main>

      <AppShell.Aside id="chat-panel" aria-label="Claude に相談" inert={!chatOpen}>
        <ChatPanel
          planState={planState}
          sampleData={saved.dataSource === 'sample'}
          decisions={saved.decisions}
          previewing={preview}
          onPreview={showPreview}
          onAdopt={app.adopt}
        />
      </AppShell.Aside>
    </AppShell>
  )
}

// A change described in words, or its kind when what it names is gone.
function safeLabel(change: Change, data: PlantData): string {
  try {
    return describeChange(change, data)
  } catch {
    return change.kind
  }
}

export default App
