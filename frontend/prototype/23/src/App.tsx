import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react'
import { LayoutDashboard, ArrowLeftRight, Siren, FolderSearch, Bell, Settings as SettingsIcon, ArrowLeft, ListTodo, Maximize2, Minimize2, PanelLeft, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { linkAlertsToEpisode, records as fixtures, type RecordItem } from './domain'
import Lists, { type DataState } from './Lists'
import Dashboard from './Dashboard'
import Detail from './Detail'
import Agent, { AgentFab, type AgentMode } from './Agent'
import { Account, Settings, Notifications, useUnreadCount } from './UtilityPages'
import LoginNetwork from './LoginNetwork'
import { RadarMark, BrandWordmark } from './Brand'
import { SidebarSelection } from './shared'
import GlobalSearch from './GlobalSearch'
import Transactions from './Transactions'
import type { TransactionTarget } from './transactionIndex'

// 검수용: ?state=loading|empty|error|stale 로 목록의 예외 상태를 연다(화면에 시연 control을 두지 않음)
const initialState = (['loading', 'empty', 'error', 'stale'].find(v => v === new URLSearchParams(globalThis.location?.search ?? '').get('state')) ?? 'normal') as DataState

type Page = 'dashboard' | 'transactions' | 'alerts' | 'episodes' | 'notifications' | 'settings' | 'account'
const mainNav = [{ id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard }, { id: 'transactions', name: 'Transactions', icon: ArrowLeftRight }, { id: 'alerts', name: 'Alerts', icon: Siren }, { id: 'episodes', name: 'Episodes', icon: FolderSearch }] as const
const utilityNav = [{ id: 'notifications', name: '알림', icon: Bell }, { id: 'settings', name: '설정', icon: SettingsIcon }] as const

export function contentScreenKey(page: Page, selected: string | null, target?: TransactionTarget) {
  if (selected) return `${page}:record:${selected}`
  if (page === 'transactions' && target) {
    if (target.type === 'owner') return `${page}:owner:${target.owner}`
    if (target.type === 'account') return `${page}:account:${target.account}`
    return `${page}:transaction:${target.transactionId}`
  }
  return `${page}:list`
}

export function resetContentScroll(container: Pick<HTMLElement, 'scrollTop'> | null) {
  if (container) container.scrollTop = 0
}

type FullscreenDocument = {
  fullscreenElement: unknown
  exitFullscreen?: () => Promise<void>
  documentElement: { requestFullscreen?: () => Promise<void> }
}

export async function toggleDocumentFullscreen(doc: FullscreenDocument, fallbackActive: boolean, setFallback: (active: boolean) => void) {
  if (doc.fullscreenElement) return void await doc.exitFullscreen?.()
  if (fallbackActive) return void setFallback(false)
  try {
    const request = doc.documentElement.requestFullscreen
    if (!request) throw new TypeError('Fullscreen API unavailable')
    await request.call(doc.documentElement)
  } catch {
    setFallback(true)
  }
}

export function createSidebarNavigation({ isMobile, setOpenMobile, navigate }: { isMobile: boolean; setOpenMobile: (open: boolean) => void; navigate: () => void }) {
  return () => {
    navigate()
    if (isMobile) setOpenMobile(false)
  }
}

function SidebarDestinationButton({ onNavigate, ...props }: Omit<ComponentProps<typeof SidebarMenuButton>, 'onClick'> & { onNavigate: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return <SidebarMenuButton {...props} onClick={createSidebarNavigation({ isMobile, setOpenMobile, navigate: onNavigate })} />
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [showPassword, setShowPassword] = useState(false)
  return (
    <div className="login-screen relative min-h-screen overflow-hidden bg-[var(--radar-disc)] text-login-foreground">
      {/* 화면 전체를 노드 그래프 애니메이션으로 채우고, 오른쪽 절반 전체를 유리 패널로 나눈다 */}
      <div className="absolute inset-0 z-0"><LoginNetwork /></div>
      {/* 왼쪽만 살짝 어둡게 — 오른쪽 유리 영역은 덮지 않음(네트워크가 비쳐야 함) */}
      <div className="absolute inset-y-0 left-0 z-[1] w-[58%] pointer-events-none login-shade" aria-hidden />
      <div className="relative z-10 min-h-screen grid grid-cols-[1fr_minmax(380px,1fr)] login-layout">
        <div className="flex flex-col justify-between p-12 pointer-events-none">
          <div className="flex items-center gap-2.5"><RadarMark className="size-5" /><BrandWordmark /></div>
          <div className="max-w-md">
            <Badge variant="outline" className="font-normal mb-7 border-login-foreground/25 text-login-foreground bg-login-badge-background">자금세탁 의심 거래 조사</Badge>
            <h1 className="text-4xl leading-[1.4] tracking-tight font-semibold">탐지 신호에서<br />판단의 근거까지.</h1>
            <p className="mt-6 type-body text-login-foreground/65 leading-7">Alert를 검토하고, 연결된 거래를 추적하고,<br />Episode 단위로 조사를 이어갑니다.</p>
          </div>
          <p className="text-[11px] text-login-foreground/45">AML RADAR</p>
        </div>
        {/* 오른쪽 절반 = css.glass식 글래스모피즘(반투명+blur). 인풋만 불투명. 제목/화살표 없음 */}
        <div className="login-glass-panel relative flex items-center justify-center p-8 pointer-events-auto backdrop-blur-2xl">
          <form className="w-full max-w-[360px] space-y-5" onSubmit={e => { e.preventDefault(); onLogin() }}>
            <div className="space-y-2"><Label htmlFor="email" className="text-login-foreground/80">이메일</Label><Input id="email" type="email" defaultValue="reviewer@fss.or.kr" autoComplete="username" className="h-10 login-input-opaque border-login-foreground/15 text-login-foreground" /></div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-login-foreground/80">비밀번호</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} defaultValue="amlradar" autoComplete="current-password" className="h-10 pr-10 login-input-opaque border-login-foreground/15 text-login-foreground" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-login-foreground/55 hover:text-login-foreground" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPassword(v => !v)}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full h-11 bg-login-action-background text-login-action-foreground hover:bg-login-action-background/90">로그인</Button>
            <div className="text-center"><Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs font-normal text-login-foreground/55 hover:text-login-foreground">비밀번호를 잊으셨나요?</Button></div>
          </form>
        </div>
      </div>
    </div>
  )
}

// 사이드바 header의 로고: 평소엔 RadarMark, hover하면 사이드바 토글 아이콘(PanelLeft)으로 바뀌고
// 클릭하면 사이드바를 여닫는다(ChatGPT·Claude식). SidebarProvider 하위에서 렌더링되어야
// useSidebar 컨텍스트를 읽을 수 있으므로, App이 아니라 Sidebar 안의 별도 컴포넌트로 둔다.
function SidebarBrandToggle() {
  const { state, toggleSidebar } = useSidebar()
  return (
    <button type="button"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); toggleSidebar() }}
      onClick={event => { if (event.detail === 0) toggleSidebar() }}
      aria-label="사이드바 열기/닫기" aria-expanded={state === 'expanded'} title="사이드바 열기/닫기"
      className="group/brand absolute inset-0 m-2 z-10 flex touch-manipulation cursor-pointer select-none items-center gap-2.5 rounded-md px-3 text-sm font-semibold tracking-tight outline-hidden hover:bg-sidebar-accent active:bg-[var(--selection-background)] active:text-[var(--selection-foreground)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!">
      {/* header 전체가 하나의 버튼이며 접힌 상태에서도 아이콘을 64px 폭 중앙에 둔다. */}
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <RadarMark className="size-5 transition-opacity group-hover/brand:opacity-0 group-focus-visible/brand:opacity-0" />
        <PanelLeft className="absolute size-4 opacity-0 transition-opacity group-hover/brand:opacity-100 group-focus-visible/brand:opacity-100" />
      </span>
      <BrandWordmark className="truncate group-data-[collapsible=icon]:hidden" />
    </button>
  )
}

export default function App() {
  const [user, setUser] = useState<string | null>(null), [page, setPage] = useState<Page>('dashboard'), [records, setRecords] = useState(fixtures)
  const [selected, setSelected] = useState<string | null>(null), [logout, setLogout] = useState(false), [state, setState] = useState<DataState>(initialState)
  const [agentOpen, setAgentOpen] = useState(true), [agentMode, setAgentMode] = useState<AgentMode>('sidebar')
  const [listKey, setListKey] = useState(0), [nativeFullscreen, setNativeFullscreen] = useState(false), [appFullscreen, setAppFullscreen] = useState(false), [transactionTarget, setTransactionTarget] = useState<TransactionTarget>()
  const mainRef = useRef<HTMLElement>(null)
  const record = records.find(r => r.id === selected), role = user === '오검토' ? 'L1' : 'L2'
  const todo = records.filter(r => r.owner === user && r.status !== '종결').length
  const unread = useUnreadCount(records)
  // 페이지 이동은 RDR 9000의 열림·표시 방식·위치를 건드리지 않는다. 패널 상태는 사용자 조작만 따른다.
  const go = (p: Page) => { setPage(p); setSelected(null); setTransactionTarget(undefined); setState(initialState); if (p === 'alerts' || p === 'episodes') setListKey(k => k + 1) }
  const openRecord = (r: RecordItem) => { setPage(r.kind === 'Alert' ? 'alerts' : 'episodes'); setSelected(r.id) }
  const linkSelectedAlerts = (alertIds: string[], target: string) => setRecords(current => linkAlertsToEpisode(current, alertIds, target))
  const openTransaction = (target: TransactionTarget) => { setPage('transactions'); setSelected(null); setTransactionTarget(target) }
  const logoutNow = () => { setUser(null); setLogout(false); setAgentOpen(true); setSelected(null); setPage('dashboard') }
  const isFullscreen = nativeFullscreen || appFullscreen
  const fullscreen = useCallback(() => void toggleDocumentFullscreen(document, appFullscreen, setAppFullscreen), [appFullscreen])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest?.('input,textarea,[contenteditable=true]')
      if (e.key === '/' && !typing) { e.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="전역 검색"]')?.focus() }
      if (e.key === 'F11') { e.preventDefault(); fullscreen() }
    }
    const screen = () => { const active = Boolean(document.fullscreenElement); setNativeFullscreen(active); if (active) setAppFullscreen(false) }
    window.addEventListener('keydown', key); document.addEventListener('fullscreenchange', screen)
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', screen) }
  }, [fullscreen])

  const screenKey = contentScreenKey(page, selected, transactionTarget)
  useLayoutEffect(() => {
    if (user) resetContentScroll(mainRef.current)
  }, [screenKey, user])

  if (!user) return <Login onLogin={() => { setUser('오검토'); setPage('dashboard') }} />

  const agentSidebar = agentOpen && agentMode === 'sidebar'
  return (
    <SidebarProvider className={appFullscreen ? 'app-fullscreen-fallback' : undefined} style={{ '--sidebar-width': '210px', '--sidebar-width-icon': '4rem' } as CSSProperties}>
      <Sidebar collapsible="icon" className="app-sidebar">
        <SidebarSelection value={page}>
        {/* 로고 자리가 곧 사이드바 여닫기 button이다. 접힘·펼침 모두 nav icon과 같은 축(중심 32px) */}
        <SidebarHeader className="h-15 flex-row items-center p-0 overflow-hidden">
          <SidebarBrandToggle />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {mainNav.map(n => <SidebarMenuItem key={n.id}><SidebarDestinationButton data-nav-id={n.id} isActive={page === n.id} tooltip={n.name} onNavigate={() => go(n.id)} className="h-10 px-4 group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:px-4! group-data-[collapsible=icon]:[&>span]:hidden"><n.icon className="size-4" /><span>{n.name}</span></SidebarDestinationButton></SidebarMenuItem>)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-auto border-t">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {utilityNav.map(n => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarDestinationButton data-nav-id={n.id} isActive={page === n.id} tooltip={n.name} onNavigate={() => go(n.id)} className="h-10 px-4 group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:px-4! group-data-[collapsible=icon]:[&>span]:hidden">
                      {/* 접힌(icon) 모드에서는 label span이 숨겨지므로, 알림 개수는 아이콘 우측 위 작은 배지로 대신 보여준다(앱 아이콘 배지 방식) */}
                      <div className="relative inline-flex shrink-0">
                        <n.icon className="size-4" />
                        {n.id === 'notifications' && unread > 0 && <Badge variant="destructive" className="hidden group-data-[collapsible=icon]:flex absolute -top-1.5 -right-2 h-3.5 min-w-3.5 px-[3px] text-[9px] leading-none border-0 dark:bg-destructive">{unread}</Badge>}
                      </div>
                      <span>{n.name}</span>
                      {n.id === 'notifications' && unread > 0 && <Badge variant="destructive" className="ml-auto h-5 min-w-5 px-1.5 group-data-[collapsible=icon]:hidden dark:bg-destructive">{unread}</Badge>}
                    </SidebarDestinationButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-2 h-16 justify-center">
          <SidebarMenu>
            <SidebarMenuItem>
              {/* 드롭다운 없이 바로 계정 페이지로 이동. 로그아웃은 계정 페이지의 세션 관리에서 처리한다 */}
              <SidebarDestinationButton data-nav-id="account" size="lg" tooltip="계정" isActive={page === 'account'} data-account-active={page === 'account'} onNavigate={() => go('account')} className="account-button h-12 px-2 gap-2.5 group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent">
                <Avatar className="size-8 shrink-0"><AvatarFallback className="text-xs">{user[0]}</AvatarFallback></Avatar>
                <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden"><span className="block text-xs font-medium">{user}</span><span className={`block text-[10px] mt-0.5 ${page === 'account' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{role}</span></span>
              </SidebarDestinationButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        </SidebarSelection>
      </Sidebar>
      <SidebarInset className="min-w-0 h-svh overflow-hidden flex flex-col">
        {/* header는 조사 도우미 sidebar와 무관하게 전체 폭을 쓰고 오른쪽 묶음을 끝에 고정.
            폭이 1100px보다 좁아지면(세로 화면 포함) 글자 라벨들이 차례로 사라지고 아이콘만 남아 겹침을 막는다 */}
        <header className="app-header z-40 bg-background h-15 shrink-0 border-b grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] max-[900px]:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 min-[1100px]:gap-5 px-4 min-[1100px]:px-6 min-w-0">
          <div className="header-navigation flex items-center min-w-0 shrink-0">
            <SidebarTrigger className="rounded-full md:hidden" aria-label="메뉴 열기" />
            {record && (
              <Button variant="ghost" size="sm" className="-ml-2 h-8 rounded-full text-xs gap-1.5" aria-label={`${record.kind} 목록으로 돌아가기`} onClick={() => setSelected(null)}>
                <ArrowLeft className="size-3.5" /><span className="max-[1100px]:hidden">{record.kind} 목록</span>
              </Button>
            )}
          </div>
          {/* 로고는 sidebar로 옮겼다. 헤더 중앙에는 전역 검색만 pill 형태로 둔다. RDR 9000은 우하단 FAB */}
          <div className="header-search flex items-center justify-center gap-2 min-[1100px]:gap-3 min-w-0">
            {/* 양옆 칸을 같은 비율로 두어 뒤로가기 유무와 관계없이 검색창이 항상 화면 가운데 같은 자리에 온다 */}
            <div className="header-search-input">
              <GlobalSearch records={records} onOpenRecord={openRecord} onOpenTransaction={openTransaction} onNavigate={p => go(p as Page)} />
            </div>
          </div>
          <div className="header-actions justify-self-end flex items-center gap-1 min-[1100px]:gap-1.5 shrink-0" data-testid="header-actions">
            <Button variant="ghost" size="sm" className="h-8 rounded-full text-xs gap-1.5 px-2 min-[1100px]:px-3" aria-label={`할 일 ${todo}건`} onClick={() => go(user === '오검토' ? 'alerts' : 'episodes')}>
              <ListTodo className="size-4 hidden max-[1100px]:inline" /><span className="max-[1100px]:hidden">할 일</span><Badge variant="secondary" className="h-5 min-w-5 px-1.5">{todo}</Badge>
            </Button>
            {/* v20 R13: 역할(L1·L2)은 사이드바 계정에 이미 표시되고 버튼도 아니라 헤더에서 뺐다. 할 수 있는 일은 계정 > 권한 */}
            <Button variant="ghost" size="sm" className="h-8 rounded-full gap-2 px-2 min-[1100px]:px-3" aria-label={isFullscreen ? '전체화면 종료 · F11' : '전체화면 · F11'} aria-pressed={isFullscreen} onClick={fullscreen}>
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}<Kbd>F11</Kbd>
            </Button>
          </div>
        </header>
        <main ref={mainRef} className={`app-main @container flex-1 min-h-0 overflow-y-auto px-7 py-7 pb-10 min-w-0 ${agentSidebar ? 'agent-sidebar-space' : ''}`} style={{ scrollbarGutter: 'stable' }}>
          {record ? <Detail key={record.id} record={record} records={records} user={user} onUpdate={r => setRecords(p => p.map(x => x.id === r.id ? r : x))} onOpen={openRecord} onOpenTransaction={openTransaction} />
            : page === 'dashboard' ? <Dashboard records={records} user={user} onOpen={openRecord} />
              : page === 'transactions' ? <Transactions records={records} target={transactionTarget} onOpenRecord={openRecord} />
              : page === 'alerts' || page === 'episodes' ? <Lists key={`${page}-${listKey}`} kind={page === 'alerts' ? 'Alert' : 'Episode'} records={records} user={user} onOpen={openRecord} onLinkEpisode={linkSelectedAlerts} state={state} setState={setState} />
                : page === 'account' ? <Account user={user} onLogout={() => setLogout(true)} />
                  : page === 'settings' ? <Settings user={user} />
                    : <Notifications records={records} onOpen={openRecord} />}
        </main>
      </SidebarInset>
      <AgentFab open={agentOpen} onToggle={() => setAgentOpen(o => !o)} />
      <Agent open={agentOpen} setOpen={setAgentOpen} mode={agentMode} setMode={setAgentMode} record={record} records={records} />
      <AlertDialog open={logout} onOpenChange={setLogout}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>로그아웃할까요?</AlertDialogTitle><AlertDialogDescription>현재 세션을 종료하고 로그인 화면으로 돌아갑니다.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={logoutNow}>로그아웃</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
