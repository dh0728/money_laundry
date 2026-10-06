import { WorkspaceProvider, WorkspaceMain, SharedPeriod } from '@/lib/WorkspaceProvider'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react'
import { login, logout as logoutSession, restoreSession, type SessionUser } from '@/api/auth'
import { ApiError } from '@/api/common'
import { live } from '@/lib/apiMode'
import { ArrowLeft, ArrowRight, Maximize2, Minimize2, PanelLeft, RotateCw } from 'lucide-react'
import { useWorkspace } from '@/lib/workspaceState'
import { BrandWordmark, RadarMark } from '@/components/Brand'
import GlobalSearch from '@/features/search/GlobalSearch'
import LiveGlobalSearch from '@/features/search/LiveGlobalSearch'
import Agent, { AgentTrigger, type AgentMode } from '@/features/agent/Agent'
import { mockAgentRecords, recordForRoute } from '@/features/agent/agentData'
import { useTransactionTarget } from '@/features/transactions/transactionTarget'
import { SidebarSelection } from '@/components/SidebarSelection'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { currentScenario } from '@/mocks/scenario'
import { CurrentUserContext, MOCK_USER, roleInfo, type CurrentUser } from './session'
import { mainNav, routeFromHash, toggleDocumentFullscreen, utilityNav, type Page } from './navigation'
import { PendingWorkCount, UnreadNotificationCount } from './SidebarCounts'

const ComingSoonPage = lazy(() => import('@/pages/ComingSoonPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const AccountPage = lazy(() => import('@/pages/AccountPage'))
const AlertsPage = lazy(() => import('@/pages/AlertsPage'))
const EpisodesPage = lazy(() => import('@/pages/EpisodesPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const TransactionsPage = lazy(() => import('@/pages/TransactionsPage'))
const LiveDashboardPage = lazy(() => import('@/pages/LiveDashboardPage'))
const LiveLedgerPage = lazy(() => import('@/pages/LiveLedgerPage'))
const LiveCasesPage = lazy(() => import('@/pages/LiveCasesPage'))
const LiveNotificationsPage = lazy(() => import('@/pages/LiveNotificationsPage'))

function PageChunkSkeleton({ page }: { page: Page }) {
  const line = (width = 'w-24') => <span className={`inline-block h-4 ${width} animate-pulse rounded bg-muted`} />
  if (page === 'dashboard') return <div role="status" aria-label="대시보드 준비 중" className="space-y-6"><div className="flex gap-5 border-b pb-3"><span>기관 전체</span><span>내 담당</span></div><div className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">{['오늘 유입 Alert', '오늘 의심 거래 탐지율', '열린 Alert', '조사 중 Episode'].map(label => <div key={label} className="space-y-4 rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p>{line('w-20')}{line('w-32')}</div>)}</div><div className="grid gap-4 @6xl:grid-cols-3"><section className="rounded-xl border bg-card p-5 @6xl:col-span-2"><h2 className="font-semibold">기관 탐지 현황</h2><div className="mt-5 h-64 animate-pulse rounded bg-muted" /></section><section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">RDR 9000 Daily Report</h2><div className="mt-5 space-y-5">{[0, 1, 2].map(index => <div key={index}>{line('w-full')}</div>)}</div></section></div></div>
  if (page === 'transactions') return <div role="status" aria-label="거래 내역 준비 중" className="space-y-5"><div className="flex gap-2">{line('w-64')}{line('w-32')}{line('w-32')}</div><div className="grid gap-3 @5xl:grid-cols-4">{['소유주', '계좌', '거래', '선택 거래 상세'].map(label => <section key={label} className="min-h-80 rounded-xl border bg-card p-4"><h2 className="font-semibold">{label}</h2><div className="mt-5 space-y-4">{[0, 1, 2].map(index => <div key={index}>{line('w-full')}</div>)}</div></section>)}</div></div>
  if (page === 'alerts' || page === 'episodes') return <div role="status" aria-label="조사 사건 준비 중" className="space-y-5"><div className="flex gap-2">{line('w-64')}{line('w-32')}{line('w-28')}</div><div className="overflow-hidden rounded-xl border bg-card"><div className="grid grid-cols-5 gap-4 border-b p-4 text-sm font-medium"><span>ID / 구성</span><span>위험도</span><span>탐지 유형</span><span>담당자</span><span>상태</span></div>{[0, 1, 2, 3].map(index => <div key={index} className="grid grid-cols-5 gap-4 border-b p-4">{[0, 1, 2, 3, 4].map(cell => <span key={cell}>{line('w-3/4')}</span>)}</div>)}</div></div>
  if (page === 'notifications') return <div role="status" aria-label="알림 준비 중" className="space-y-5"><h1 className="text-xl font-semibold">알림</h1><div className="flex gap-2">{line('w-64')}{line('w-28')}</div><div className="grid gap-6 @5xl:grid-cols-2">{['안 읽음', '읽음'].map(label => <section key={label}><h2 className="font-semibold">{label}</h2><div className="mt-4 space-y-3">{[0, 1, 2].map(index => <div key={index} className="rounded-xl border bg-card p-4">{line('w-1/2')}<div className="mt-3">{line('w-3/4')}</div></div>)}</div></section>)}</div></div>
  return <div role="status" aria-label="화면 준비 중" className="space-y-5">{line('w-32')}<div className="h-40 animate-pulse rounded-xl border bg-muted/30" /></div>
}


const pageTitles: Record<Page, string> = {
  dashboard: '대시보드',
  transactions: '거래 내역',
  alerts: 'Alert 목록',
  episodes: 'Episode 목록',
  notifications: '알림',
  settings: '설정',
  account: '계정',
}

function usePage() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const go = useCallback((next: Page, id?: number) => { window.location.hash = id ? `${next}/${id}` : next }, [])
  return [route, go] as const
}

function SidebarDestinationButton({ onNavigate, ...props }: Omit<ComponentProps<typeof SidebarMenuButton>, 'onClick'> & { onNavigate: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return <SidebarMenuButton {...props} onClick={() => { onNavigate(); if (isMobile) setOpenMobile(false) }} />
}

function SidebarBrandToggle() {
  const { state, toggleSidebar } = useSidebar()
  return (
    <button
      type="button"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); toggleSidebar() }}
      onClick={event => { if (event.detail === 0) toggleSidebar() }}
      aria-label="사이드바 열기/닫기"
      aria-expanded={state === 'expanded'}
      title="사이드바 열기/닫기"
      className="group/brand absolute inset-0 z-10 m-2 flex cursor-pointer touch-manipulation select-none items-center gap-2.5 rounded-md px-3 text-sm font-semibold tracking-tight outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring active:bg-[var(--selection-background)] active:text-[var(--selection-foreground)] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
    >
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <RadarMark className="size-5 transition-opacity group-hover/brand:opacity-0 group-focus-visible/brand:opacity-0" />
        <PanelLeft className="absolute size-4 opacity-0 transition-opacity group-hover/brand:opacity-100 group-focus-visible/brand:opacity-100" />
      </span>
      <BrandWordmark className="truncate group-data-[collapsible=icon]:hidden" />
    </button>
  )
}

const navButtonClass = 'h-10 px-4 group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:px-4! group-data-[collapsible=icon]:[&>span]:hidden'

function HeaderNavigation() {
  const { queries } = useWorkspace()
  const [, setNow] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const refreshing = queries.activeRefreshing()
  return <div className="flex items-center gap-0.5">
    <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="뒤로가기" title="뒤로가기" onClick={() => window.history.back()}><ArrowLeft className="size-4" /></Button>
    <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="앞으로가기" title="앞으로가기" onClick={() => window.history.forward()}><ArrowRight className="size-4" /></Button>
    <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="데이터 새로고침" title="현재 화면 데이터 새로고침" onClick={() => window.dispatchEvent(new Event('workspace-refresh'))}><RotateCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} /></Button>
  </div>
}

export default function App() {
  const [{ page, id }, go] = usePage()
  const [, setTransactionTarget] = useTransactionTarget()
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [appFullscreen, setAppFullscreen] = useState(false)
  const [logout, setLogout] = useState(false)
  const [user, setUser] = useState<CurrentUser | null>(live ? null : MOCK_USER)
  const [restoring, setRestoring] = useState(live)
  const [authMessage, setAuthMessage] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const currentUser = user ?? MOCK_USER
  const fromSession = (session: SessionUser): CurrentUser => ({ ...MOCK_USER, userId: session.id, name: session.name, role: session.role, username: session.username, organization: '—', email: '—', joinedAt: '—' })
  const [agentOpen, setAgentOpen] = useState(false)
  const closeAgentRef = useRef<() => void>(() => setAgentOpen(false))
  const [agentMode, setAgentMode] = useState<AgentMode>('sidebar')
  const agentSidebar = agentOpen && agentMode === 'sidebar'
  const agentRecords = live || currentScenario() !== 'normal' ? [] : mockAgentRecords
  const agentRecord = recordForRoute({ page, id }, agentRecords)
  const isFullscreen = nativeFullscreen || appFullscreen
  const fullscreen = useCallback(() => void toggleDocumentFullscreen(document, appFullscreen, setAppFullscreen), [appFullscreen])

  useEffect(() => {
    const narrow = window.matchMedia?.('(max-width: 1199px)')
    const closeOnNarrow = (event: MediaQueryListEvent) => { if (event.matches) setAgentOpen(false) }
    narrow?.addEventListener('change', closeOnNarrow)
    return () => narrow?.removeEventListener('change', closeOnNarrow)
  }, [])

  useEffect(() => {
    if (!live) return
    let active = true
    restoreSession().then(session => { if (active) setUser(fromSession(session)) }).catch(error => {
      if (active && !(error instanceof ApiError && error.problem.status === 401)) setAuthMessage('서버에 연결하지 못했습니다. 다시 로그인해 주세요.')
    }).finally(() => { if (active) setRestoring(false) })
    const expired = () => { setUser(null); setAuthMessage('로그인 시간이 만료됐습니다. 다시 로그인해 주세요.') }
    window.addEventListener('auth-expired', expired)
    return () => { active = false; window.removeEventListener('auth-expired', expired) }
  }, [])

  async function signIn(username: string, password: string) {
    if (!live) { setUser(MOCK_USER); go('dashboard'); return }
    const session = await login(username, password)
    setUser(fromSession(session)); setAuthMessage(''); go('dashboard')
  }

  async function signOut() {
    try {
      if (live) await logoutSession()
      setUser(live ? null : MOCK_USER); setLogout(false); setLogoutError(''); go('dashboard')
    } catch {
      setLogoutError('로그아웃하지 못했습니다. 다시 시도해 주세요.')
    }
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'F11') { event.preventDefault(); fullscreen() } }
    const screen = () => { const active = Boolean(document.fullscreenElement); setNativeFullscreen(active); if (active) setAppFullscreen(false) }
    window.addEventListener('keydown', key)
    document.addEventListener('fullscreenchange', screen)
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', screen) }
  }, [fullscreen])

  if (restoring) return <div role="status" className="p-6">로그인 상태 확인 중…</div>
  if (!user) return <Suspense fallback={<PageChunkSkeleton page="account" />}><LoginPage onLogin={signIn} message={authMessage} /></Suspense>

  return (
    <CurrentUserContext.Provider value={currentUser}>
    <WorkspaceProvider key={`${currentUser.userId}:${currentUser.role}`} >
    <SidebarProvider defaultOpen={false} className={appFullscreen ? 'app-fullscreen-fallback' : undefined} style={{ '--sidebar-width': '210px', '--sidebar-width-icon': '4rem' } as CSSProperties}>
      <Sidebar collapsible="icon" className="app-sidebar">
        <SidebarSelection value={page}>
          <SidebarHeader className="h-15 flex-row items-center overflow-hidden p-0">
            <SidebarBrandToggle />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {mainNav.map(item => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarDestinationButton data-nav-id={item.id} isActive={page === item.id} tooltip={item.name} onNavigate={() => go(item.id)} className={navButtonClass}>
                        <item.icon className="size-4" />
                        <span>{item.name}</span>
                      </SidebarDestinationButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup className="mt-auto border-t">
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {utilityNav.map(item => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarDestinationButton data-nav-id={item.id} isActive={page === item.id} tooltip={item.name} onNavigate={() => go(item.id)} className={navButtonClass}>
                        <item.icon className="size-4" />
                        <span>{item.name}</span>
                      </SidebarDestinationButton>
                      {item.id === 'notifications' && <UnreadNotificationCount />}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="h-16 justify-center p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarDestinationButton data-nav-id="account" size="lg" tooltip="계정" isActive={page === 'account'} data-account-active={page === 'account'} onNavigate={() => go('account')} className="account-button h-12 gap-2.5 px-2 hover:bg-sidebar-accent group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:p-2!">
                  <Avatar className="size-8 shrink-0"><AvatarFallback className="text-xs">{currentUser.name[0]}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                    <span className="block text-xs font-medium">{currentUser.name}</span>
                    <span className={`mt-0.5 block text-[10px] ${page === 'account' ? 'text-sidebar-primary-foreground' : 'text-muted-foreground'}`}>{roleInfo[currentUser.role].label}</span>
                  </span>
                </SidebarDestinationButton>
                <PendingWorkCount routeKey={`${page}/${id ?? ''}`} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </SidebarSelection>
      </Sidebar>
      <SidebarInset className="flex h-svh min-w-0 flex-col overflow-hidden">
        <header className="app-header z-40 grid h-15 min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b bg-background px-4 min-[1100px]:gap-5 min-[1100px]:px-6">
          <div className="header-navigation flex min-w-0 items-center">
          <SidebarTrigger className="size-9 rounded-full md:hidden" aria-label="메뉴 열기" />
          <HeaderNavigation />
          {/* 상세 화면에서는 머리 왼쪽에 목록으로 돌아가는 버튼을 둔다 */}
          {id && (page === 'alerts' || page === 'episodes') && (
            <Button variant="ghost" size="sm" className="h-9 gap-1.5 rounded-full px-3 text-xs" onClick={() => go(page)} data-testid="header-back">
              <ArrowLeft className="size-4" />{page === 'alerts' ? 'Alert 목록' : 'Episode 목록'}
            </Button>
          )}
          </div>
          <div className="header-search flex min-w-0 w-full max-w-[460px] items-center gap-2 justify-self-center" data-testid="header-search">
            {live ? <LiveGlobalSearch onNavigate={(next, nextId) => go(next, nextId)} /> : <GlobalSearch onNavigate={(next, nextId) => go(next, nextId)} onOpenTransaction={target => { setTransactionTarget(target); go('transactions') }} />}
            <AgentTrigger open={agentOpen} onToggle={() => { if (agentOpen) { closeAgentRef.current(); return } if (window.innerWidth < 1200) setAgentMode('floating'); setAgentOpen(true) }} />
          </div>
          <div className="header-actions flex items-center justify-self-end gap-1.5" data-testid="header-actions">
            <Button variant="ghost" size="sm" className="h-9 gap-2 rounded-full px-2 min-[1100px]:px-3" aria-label={isFullscreen ? '전체화면 종료 · F11' : '전체화면 · F11'} aria-pressed={isFullscreen} onClick={fullscreen}>
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              <Kbd>F11</Kbd>
            </Button>
          </div>
        </header>
        <WorkspaceMain route={`${page}/${id ?? "list"}`} className={`app-main @container min-h-0 min-w-0 flex-1 overflow-y-auto px-7 py-7 pb-10 ${agentSidebar ? 'agent-sidebar-space' : ''}`} style={{ scrollbarGutter: 'stable' }}>
          <SharedPeriod enabled={live && ['dashboard', 'transactions', 'alerts', 'episodes'].includes(page)}>
          <Suspense fallback={<PageChunkSkeleton page={page} />}>
          {page === 'dashboard' ? (live ? <LiveDashboardPage onOpen={(kind, caseId) => go(kind === 'ALERT' ? 'alerts' : 'episodes', caseId)} /> : <DashboardPage />)
            : page === 'transactions' ? (live ? <LiveLedgerPage onOpen={(kind, caseId) => go(kind === 'ALERT' ? 'alerts' : 'episodes', caseId)} /> : <TransactionsPage />)
            : page === 'alerts' ? (live ? <LiveCasesPage kind="ALERT" caseId={id} onOpen={caseId => go('alerts', caseId)} onBack={() => go('alerts')} onOpenEpisode={episodeId => go('episodes', episodeId)} /> : <AlertsPage alertId={id} onOpen={alertId => go('alerts', alertId)} onOpenEpisode={episodeId => go('episodes', episodeId)} />)
            : page === 'episodes' ? (live ? <LiveCasesPage kind="EPISODE" caseId={id} onOpen={caseId => go('episodes', caseId)} onBack={() => go('episodes')} /> : <EpisodesPage episodeId={id} onOpen={episodeId => go('episodes', episodeId)} onOpenAlert={alertId => go('alerts', alertId)} />)
            : page === 'notifications' ? (live ? <LiveNotificationsPage onOpen={(kind, caseId) => go(kind === 'ALERT' ? 'alerts' : 'episodes', caseId)} /> : <NotificationsPage onOpen={item => go(item.target.page, item.target.id)} />)
            : page === 'settings' ? <SettingsPage />
              : page === 'account' ? <AccountPage onLogout={() => setLogout(true)} />
                : <ComingSoonPage title={pageTitles[page]} />}
          </Suspense>
        </SharedPeriod>
        </WorkspaceMain>
      </SidebarInset>
      <Agent open={agentOpen} setOpen={setAgentOpen} closeRef={closeAgentRef} mode={agentMode} setMode={setAgentMode} record={agentRecord} records={agentRecords} />
      <AlertDialog open={logout} onOpenChange={setLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>로그아웃할까요?</AlertDialogTitle>
            <AlertDialogDescription>{live ? '현재 세션을 종료하고 로그인 화면으로 돌아갑니다.' : 'mock 시연 화면을 대시보드부터 다시 엽니다.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void signOut()}>로그아웃</AlertDialogAction>
          </AlertDialogFooter>
          {logoutError && <p role="alert" className="text-sm text-destructive-text">{logoutError}</p>}
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
    </WorkspaceProvider>
    </CurrentUserContext.Provider>
  )
}
