import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  NavLink,
  Tabs,
  Text,
  VisuallyHidden,
  useComputedColorScheme,
  useMantineColorScheme,
  useMantineTheme,
} from '@mantine/core'
import { useDisclosure, useMediaQuery, useReducedMotion } from '@mantine/hooks'
import {
  IconAdjustmentsHorizontal,
  IconCalendarStats,
  IconChartBar,
  IconClipboardList,
  IconLayoutKanban,
  IconMessageCircle,
  IconMoon,
  IconSun,
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { changesToApply, type ProposedOption } from './assistant/tools'
import { runPlan } from './engine/plan'
import { useAppState } from './state/store'
import { ChatPanel } from './ui/ChatPanel'
import { DecisionsView } from './ui/DecisionsView'
import { GanttView } from './ui/GanttView'
import { OutlookView } from './ui/OutlookView'
import { ProgressView } from './ui/ProgressView'
import { SettingsView } from './ui/SettingsView'

type Tab = 'outlook' | 'progress' | 'gantt' | 'decisions' | 'settings'

const TABS: { value: Tab; label: string; icon: ReactNode }[] = [
  { value: 'outlook', label: '今月の計画', icon: <IconCalendarStats size={16} /> },
  { value: 'progress', label: '進捗', icon: <IconChartBar size={16} /> },
  { value: 'gantt', label: 'ガント', icon: <IconLayoutKanban size={16} /> },
  { value: 'decisions', label: '判断の記録', icon: <IconClipboardList size={16} /> },
  { value: 'settings', label: '設定とデータ', icon: <IconAdjustmentsHorizontal size={16} /> },
]

function App() {
  const app = useAppState()
  const theme = useMantineTheme()
  // Below xl the panel would squeeze the progress table, and below md it covers the screen.
  const wide = useMediaQuery(`(min-width: ${theme.breakpoints.xl})`, true, { getInitialValueInEffect: false })
  const medium = useMediaQuery(`(min-width: ${theme.breakpoints.md})`, true, { getInitialValueInEffect: false })
  const [tab, setTab] = useState<Tab>('outlook')
  const [preview, setPreview] = useState<ProposedOption | null>(null)
  const [chatOpen, setChatOpen] = useState(wide)
  const [navOpened, nav] = useDisclosure(false)
  const reduceMotion = useReducedMotion()
  const bannerRef = useRef<HTMLDivElement>(null)
  const focusBanner = useRef(false)
  const { setColorScheme } = useMantineColorScheme()
  const dark = useComputedColorScheme('light') === 'dark'
  const { planState, saved } = app

  const plan = useMemo(
    () => runPlan(planState, preview ? changesToApply(preview, planState.adopted).changes : []),
    [planState, preview],
  )

  // The menu only exists below md.
  useEffect(() => {
    if (medium) nav.close()
  }, [medium, nav])

  // After a phone preview closes the panel, the pressed button is gone; move focus to the banner.
  useEffect(() => {
    if (preview && focusBanner.current) {
      focusBanner.current = false
      bannerRef.current?.focus()
    }
  }, [preview])

  function selectTab(value: Tab) {
    setTab(value)
    nav.close()
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
      navbar={{ width: 240, breakpoint: 'md', collapsed: { mobile: !navOpened, desktop: true } }}
      aside={{ width: 400, breakpoint: 'md', collapsed: { desktop: !chatOpen, mobile: !chatOpen } }}
      padding="md"
      transitionDuration={reduceMotion ? 0 : 200}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="md">
          <Group gap="lg" wrap="nowrap">
            <Burger
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="md"
              size="sm"
              aria-label="画面の一覧"
              aria-expanded={navOpened}
              aria-controls="app-menu"
            />
            <Group gap={8} wrap="nowrap">
              <img src="/favicon.svg" alt="" width={26} height={26} />
              <Text component="h1" fw={700} size="lg" style={{ whiteSpace: 'nowrap' }}>
                サキヨミ
              </Text>
              {saved.dataSource === 'sample' && (
                <Badge variant="light" color="gray" visibleFrom="lg">
                  サンプルデータ
                </Badge>
              )}
            </Group>
            <Tabs value={tab} onChange={(value) => value && selectTab(value as Tab)} variant="pills" visibleFrom="md">
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
            <ActionIcon
              variant="default"
              size="lg"
              onClick={() => setColorScheme(dark ? 'light' : 'dark')}
              aria-label={dark ? 'ライト表示にする' : 'ダーク表示にする'}
            >
              {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
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
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" id="app-menu" aria-label="画面の一覧" inert={!navOpened}>
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

      {/* On a phone the open menu or panel covers the page, so the page must not take focus (WCAG 2.4.11). */}
      <AppShell.Main inert={!medium && (navOpened || chatOpen)}>
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
          <OutlookView plan={plan} today={planState.today} onAdopt={preview ? undefined : app.adopt} />
        )}
        {tab === 'progress' && (
          <ProgressView plan={plan} today={planState.today} warningDays={saved.settings.stagnationWarningDays} />
        )}
        {tab === 'gantt' && <GanttView plan={plan} today={planState.today} highlight={preview} />}
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

export default App
