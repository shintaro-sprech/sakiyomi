import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  Loader,
  NavLink,
  Tabs,
  Text,
  VisuallyHidden,
  useMantineTheme,
} from '@mantine/core'
import { useDisclosure, useMediaQuery, useReducedMotion } from '@mantine/hooks'
import {
  IconAdjustmentsHorizontal,
  IconBriefcase,
  IconBuildingFactory2,
  IconCalendarStats,
  IconChartBar,
  IconChartLine,
  IconClipboardList,
  IconLayoutKanban,
  IconLogout,
  IconMessageCircle,
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
import { ChatPanel } from './ui/ChatPanel'
import { nowAt } from './ui/clock'
import { DealsView } from './ui/DealsView'
import { DemandView } from './ui/DemandView'
import { DecisionsView } from './ui/DecisionsView'
import { GanttView } from './ui/GanttView'
import { OutlookView } from './ui/OutlookView'
import { ProgressView } from './ui/ProgressView'
import { SettingsView } from './ui/SettingsView'

// The floor in 3D loads three.js only when its tab opens.
const FactoryView = lazy(() => import('./ui/FactoryView'))

type Tab = 'outlook' | 'deals' | 'demand' | 'progress' | 'factory' | 'gantt' | 'decisions' | 'settings'

const TABS: { value: Tab; label: string; icon: ReactNode }[] = [
  // In the order of a planner's day: this month, where the work is, the floor and the
  // machines' schedule, then the deals and demand further ahead, and the record of calls.
  { value: 'outlook', label: '今月の計画', icon: <IconCalendarStats size={16} /> },
  { value: 'progress', label: '進捗', icon: <IconChartBar size={16} /> },
  { value: 'factory', label: '現場', icon: <IconBuildingFactory2 size={16} /> },
  { value: 'gantt', label: 'ガント', icon: <IconLayoutKanban size={16} /> },
  { value: 'deals', label: '商談', icon: <IconBriefcase size={16} /> },
  { value: 'demand', label: '需要予測', icon: <IconChartLine size={16} /> },
  { value: 'decisions', label: '判断の記録', icon: <IconClipboardList size={16} /> },
  { value: 'settings', label: '設定とデータ', icon: <IconAdjustmentsHorizontal size={16} /> },
]

function App({ onLogout }: { onLogout?: () => void }) {
  const app = useAppState()
  const theme = useMantineTheme()
  // Below xl the panel would squeeze the progress table, and below md it covers the screen.
  const wide = useMediaQuery(`(min-width: ${theme.breakpoints.xl})`, true, { getInitialValueInEffect: false })
  const medium = useMediaQuery(`(min-width: ${theme.breakpoints.md})`, true, { getInitialValueInEffect: false })
  const [tab, setTab] = useState<Tab>('outlook')
  // The smallest chance of a deal counted, chosen on the deals tab.
  const [dealThreshold, setDealThreshold] = useState(0.8)
  // A lot the Gantt chart asked the progress tab to show, until another tab is picked.
  const [progressFocus, setProgressFocus] = useState<{ orderId: string; lotId: string } | null>(null)
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

  // The menu only exists below xl, where the tabs do not fit the header.
  const closeNav = nav.close
  useEffect(() => {
    if (wide) closeNav()
  }, [wide, closeNav])

  // After a phone preview closes the panel, the pressed button is gone; move focus to the banner.
  useEffect(() => {
    if (preview && focusBanner.current) {
      focusBanner.current = false
      bannerRef.current?.focus()
    }
  }, [preview])

  function selectTab(value: Tab) {
    setTab(value)
    setProgressFocus(null)
    // Picked from the menu, which closes under the focus: the screen's heading takes it (WCAG 2.4.3).
    if (navOpened) {
      nav.close()
      requestAnimationFrame(() => {
        const heading = mainRef.current?.querySelector<HTMLElement>('h2')
        if (!heading) return
        heading.tabIndex = -1
        heading.focus()
      })
    }
  }

  // Escape closes the menu and puts focus back on the button that opened it.
  function closeNavByKey(event: React.KeyboardEvent) {
    if (event.key !== 'Escape' || !navOpened) return
    nav.close()
    burgerRef.current?.focus()
  }

  function showInProgress(orderId: string, lotId: string) {
    selectTab('progress')
    setProgressFocus({ orderId, lotId })
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

  const count = (value: Tab) =>
    value === 'decisions' && saved.decisions.length > 0 ? (
      <span className="tab-count">
        {saved.decisions.length}
        <VisuallyHidden>件</VisuallyHidden>
      </span>
    ) : undefined

  return (
    <AppShell
      header={{ height: 56 }}
      // The tabs fit the header from xl; below it they move into the menu.
      navbar={{ width: 240, breakpoint: 'xl', collapsed: { mobile: !navOpened, desktop: true } }}
      aside={{ width: 400, breakpoint: 'md', collapsed: { desktop: !chatOpen, mobile: !chatOpen } }}
      padding="md"
      transitionDuration={reduceMotion ? 0 : 200}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="md">
          <Group gap="lg" wrap="nowrap">
            <Burger
              ref={burgerRef}
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="xl"
              size="sm"
              aria-label="画面の一覧"
              aria-expanded={navOpened}
              aria-controls="app-menu"
            />
            <Group gap={8} wrap="nowrap">
              <img className="app-logo" src="/favicon.svg" alt="" width={26} height={26} />
              <Text component="h1" fw={700} size="lg" style={{ whiteSpace: 'nowrap' }}>
                サキヨミ
              </Text>
              {saved.dataSource === 'sample' && (
                <Badge variant="light" color="gray" fz="xs" visibleFrom="lg">
                  サンプルデータ
                </Badge>
              )}
              {/* Where the tabs are folded into the menu, the screen's name stays beside the logo. */}
              <Text fw={700} hiddenFrom="xl" aria-hidden="true" className="nowrap">
                ／{TABS.find((item) => item.value === tab)?.label}
              </Text>
            </Group>
            <Tabs
              value={tab}
              onChange={(value) => value && selectTab(value as Tab)}
              variant="pills"
              visibleFrom="xl"
            >
              <Tabs.List>
                {TABS.map((item) => (
                  <Tabs.Tab key={item.value} value={item.value} leftSection={item.icon} rightSection={count(item.value)}>
                    {item.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
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
            {onLogout && (
              <ActionIcon variant="default" size="lg" onClick={onLogout} aria-label="ログアウト">
                <IconLogout size={18} />
              </ActionIcon>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" id="app-menu" aria-label="画面の一覧" inert={!navOpened} onKeyDown={closeNavByKey}>
        {TABS.map((item) => (
          <NavLink
            key={item.value}
            component="button"
            label={item.label}
            leftSection={item.icon}
            rightSection={count(item.value)}
            active={tab === item.value}
            variant="filled"
            aria-current={tab === item.value ? 'page' : undefined}
            onClick={() => selectTab(item.value)}
          />
        ))}
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
        {tab === 'outlook' && (
          // While an option is previewed the outlook shows its plan, so nothing is added from it.
          <OutlookView
            plan={plan}
            today={planState.today}
            timingOf={timingOf}
            onAdopt={preview ? undefined : app.adopt}
            dealDemand={insights.handoffDemand}
            onShowOrder={(orderId) => showInProgress(orderId, '')}
          />
        )}
        {tab === 'deals' && (
          <DealsView app={app} today={planState.today} insights={insights} threshold={dealThreshold} onThreshold={setDealThreshold} />
        )}
        {tab === 'demand' && <DemandView app={app} today={planState.today} />}
        {tab === 'progress' && (
          <ProgressView
            plan={plan}
            today={planState.today}
            warningDays={saved.settings.stagnationWarningDays}
            focus={progressFocus}
          />
        )}
        {tab === 'factory' && (
          <Suspense fallback={<Loader size="sm" m="xl" />}>
            <FactoryView plan={plan} today={planState.today} />
          </Suspense>
        )}
        {tab === 'gantt' && (
          <GanttView plan={plan} today={planState.today} highlight={preview} onShowInProgress={showInProgress} />
        )}
        {tab === 'decisions' && <DecisionsView decisions={saved.decisions} onRemove={app.removeDecision} />}
        {tab === 'settings' && <SettingsView app={app} />}
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
