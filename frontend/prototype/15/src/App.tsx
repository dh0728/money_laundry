import { useEffect, useState, type CSSProperties } from 'react'
import { Radar, LayoutDashboard, Siren, FolderSearch, Bell, Settings as SettingsIcon, ArrowLeft, ArrowRight, ListTodo, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { records as fixtures, type RecordItem } from './domain'
import Lists, { type DataState } from './Lists'
import Dashboard from './Dashboard'
import Detail from './Detail'
import Agent, { AgentToggle, type AgentMode } from './Agent'
import { Account, Settings, Notifications } from './UtilityPages'
import LoginNetwork from './LoginNetwork'
import { BrandLogo } from './Brand'
import GlobalSearch from './GlobalSearch'

// 검수용: ?state=loading|empty|error|stale 로 목록의 예외 상태를 연다(화면에 시연 control을 두지 않음)
const initialState = (['loading', 'empty', 'error', 'stale'].find(v => v === new URLSearchParams(globalThis.location?.search ?? '').get('state')) ?? 'normal') as DataState

type Page = 'dashboard' | 'alerts' | 'episodes' | 'notifications' | 'settings' | 'account'
const mainNav = [{ id: 'dashboard', name: '대시보드', icon: LayoutDashboard }, { id: 'alerts', name: 'Alert', icon: Siren }, { id: 'episodes', name: 'Episode', icon: FolderSearch }] as const
const utilityNav = [{ id: 'notifications', name: '알림', icon: Bell }, { id: 'settings', name: '설정', icon: SettingsIcon }] as const

function Login({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="login-screen relative min-h-screen overflow-hidden bg-[#070709] text-white">
      {/* 화면 전체를 노드 그래프 애니메이션으로 채우고, 로그인 박스는 그 위에 떠 있는 유리 패널로 둔다 */}
      <LoginNetwork />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_28%_50%,transparent_0%,rgba(7,7,9,.55)_70%)]" />
      <div className="relative z-10 min-h-screen grid grid-cols-[1fr_minmax(380px,1fr)] login-layout pointer-events-none">
        <div className="flex flex-col justify-between p-12">
          <div className="flex items-center gap-2.5 font-semibold tracking-tight"><Radar className="size-5" />AML RADAR</div>
          <div className="max-w-md">
            <Badge variant="outline" className="font-normal mb-7 border-white/25 text-white bg-black/20">자금세탁 의심 거래 조사</Badge>
            <h1 className="text-4xl leading-[1.4] tracking-tight font-semibold">탐지 신호에서<br />판단의 근거까지.</h1>
            <p className="mt-6 text-sm text-white/65 leading-7">Alert를 검토하고, 연결된 거래를 추적하고,<br />Episode 단위로 조사를 이어갑니다.</p>
          </div>
          <p className="text-[11px] text-white/45">AML RADAR · v15</p>
        </div>
        <div className="flex items-center justify-center p-8">
          <form className="login-glass backdrop-blur-xl backdrop-saturate-150 pointer-events-auto w-full max-w-[390px] rounded-2xl p-8 space-y-5" onSubmit={e => { e.preventDefault(); onLogin() }}>
            <h2 className="text-2xl font-semibold">로그인</h2>
            <div className="space-y-2"><Label htmlFor="email" className="text-white/80">이메일</Label><Input id="email" type="email" defaultValue="reviewer@fss.or.kr" autoComplete="username" className="h-10 bg-white/5 border-white/15 text-white" /></div>
            <div className="space-y-2"><Label htmlFor="password" className="text-white/80">비밀번호</Label><Input id="password" type="password" defaultValue="amlradar" autoComplete="current-password" className="h-10 bg-white/5 border-white/15 text-white" /></div>
            <Button type="submit" className="w-full h-11 bg-white text-black hover:bg-white/90">로그인<ArrowRight className="size-4" /></Button>
            <Button type="button" variant="link" className="w-full text-xs text-white/55 hover:text-white">비밀번호를 잊으셨나요?</Button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<string | null>(null), [page, setPage] = useState<Page>('dashboard'), [records, setRecords] = useState(fixtures)
  const [selected, setSelected] = useState<string | null>(null), [logout, setLogout] = useState(false), [state, setState] = useState<DataState>(initialState)
  const [agentOpen, setAgentOpen] = useState(true), [agentMode, setAgentMode] = useState<AgentMode>('sidebar')
  const [listKey, setListKey] = useState(0), [isFullscreen, setIsFullscreen] = useState(false)
  const record = records.find(r => r.id === selected), role = user === '오검토' ? 'L1' : 'L2', roleName = user === '오검토' ? 'L1 · 1차 검토' : 'L2 · 심층 조사'
  const todo = records.filter(r => r.owner === user && r.status !== '종결').length
  const go = (p: Page) => { setPage(p); setSelected(null); setState(initialState); setAgentOpen(p === 'dashboard'); if (p === 'alerts' || p === 'episodes') setListKey(k => k + 1); document.querySelector(".app-main")?.scrollTo(0, 0) }
  const openRecord = (r: RecordItem) => { setPage(r.kind === 'Alert' ? 'alerts' : 'episodes'); setSelected(r.id); setAgentOpen(false); document.querySelector(".app-main")?.scrollTo(0, 0) }
  const logoutNow = () => { setUser(null); setLogout(false); setAgentOpen(true); setSelected(null); setPage('dashboard') }
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest?.('input,textarea,[contenteditable=true]')
      if (e.key === '/' && !typing) { e.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="전역 검색"]')?.focus() }
      if (e.key === 'F11') { e.preventDefault(); fullscreen() }
    }
    const screen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    window.addEventListener('keydown', key); document.addEventListener('fullscreenchange', screen)
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', screen) }
  }, [])

  if (!user) return <Login onLogin={() => { setUser('오검토'); setPage('dashboard') }} />

  const agentSidebar = agentOpen && agentMode === 'sidebar'
  return (
    <SidebarProvider style={{ '--sidebar-width': '210px', '--sidebar-width-icon': '4rem' } as CSSProperties}>
      <Sidebar collapsible="icon" className="app-sidebar">
        {/* 여닫기 button 하나만. 접힘·펼침 모두 왼쪽 같은 축(메뉴 icon·avatar 중심 24px) */}
        <SidebarHeader className="h-15 flex-row items-center justify-start py-2 px-4">
          <SidebarTrigger className="size-8" aria-label="사이드바 여닫기" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {mainNav.map(n => <SidebarMenuItem key={n.id}><SidebarMenuButton isActive={page === n.id} tooltip={n.name} onClick={() => go(n.id)} className="h-10 px-4 group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:px-4! group-data-[collapsible=icon]:[&>span]:hidden"><n.icon className="size-4" /><span>{n.name}</span></SidebarMenuButton></SidebarMenuItem>)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-auto border-t">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {utilityNav.map(n => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton isActive={page === n.id} tooltip={n.name} onClick={() => go(n.id)} className="h-10 px-4 group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:px-4! group-data-[collapsible=icon]:[&>span]:hidden">
                      {/* 접힌(icon) 모드에서는 label span이 숨겨지므로, 알림 개수는 아이콘 우측 위 작은 배지로 대신 보여준다(앱 아이콘 배지 방식) */}
                      <div className="relative inline-flex shrink-0">
                        <n.icon className="size-4" />
                        {n.id === 'notifications' && <Badge variant="destructive" className="hidden group-data-[collapsible=icon]:flex absolute -top-1.5 -right-2 h-3.5 min-w-3.5 px-[3px] text-[9px] leading-none ring-2 ring-sidebar dark:bg-destructive">7</Badge>}
                      </div>
                      <span>{n.name}</span>
                      {n.id === 'notifications' && <Badge variant="secondary" className="ml-auto h-5 min-w-5 px-1.5 group-data-[collapsible=icon]:hidden">7</Badge>}
                    </SidebarMenuButton>
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
              <SidebarMenuButton size="lg" tooltip="계정" isActive={page === 'account'} data-account-active={page === 'account'} onClick={() => go('account')} className="account-button h-12 px-2 gap-2.5 group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent">
                <Avatar className={`size-8 shrink-0 ${page === 'account' ? 'ring-2 ring-white ring-offset-2 ring-offset-sidebar-accent' : ''}`}><AvatarFallback className="text-xs">{user[0]}</AvatarFallback></Avatar>
                <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden"><span className="block text-xs font-medium">{user}</span><span className="block text-[10px] text-muted-foreground mt-0.5">{roleName}</span></span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 h-svh overflow-hidden flex flex-col">
        {/* header는 조사 도우미 sidebar와 무관하게 전체 폭을 쓰고 오른쪽 묶음을 끝에 고정.
            폭이 1100px보다 좁아지면(세로 화면 포함) 글자 라벨들이 차례로 사라지고 아이콘만 남아 겹침을 막는다 */}
        <header className="app-header z-40 bg-background h-15 shrink-0 border-b flex items-center gap-3 min-[1100px]:gap-5 px-4 min-[1100px]:px-6 min-w-0">
          <div className="flex items-center min-w-0 shrink-0">
            {record && (
              <Button variant="ghost" size="sm" className="-ml-2 h-8 text-xs gap-1.5" aria-label={`${record.kind} 목록으로 돌아가기`} onClick={() => setSelected(null)}>
                <ArrowLeft className="size-3.5" /><span className="max-[1100px]:hidden">{record.kind} 목록</span>
              </Button>
            )}
          </div>
          {/* 로고 바로 오른쪽이 전역 검색, 그 오른쪽이 RDR 9000 토글이다: AI에게 묻는 것도 검색이라 같은 줄에 둔다 */}
          <div className="flex items-center gap-2 min-[1100px]:gap-3 min-w-0 flex-1">
            <BrandLogo />
            <div className="flex-1 min-w-40">
              <GlobalSearch records={records} onOpenRecord={openRecord} onNavigate={p => go(p as Page)} />
            </div>
            <AgentToggle open={agentOpen} onToggle={() => setAgentOpen(o => !o)} />
          </div>
          <div className="header-actions justify-self-end flex items-center gap-1 min-[1100px]:gap-1.5 shrink-0" data-testid="header-actions">
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 px-2 min-[1100px]:px-3" aria-label={`할 일 ${todo}건`} onClick={() => go(user === '오검토' ? 'alerts' : 'episodes')}>
              <ListTodo className="size-4 hidden max-[1100px]:inline" /><span className="max-[1100px]:hidden">할 일</span><Badge variant="secondary" className="h-5 min-w-5 px-1.5">{todo}</Badge>
            </Button>
            <Tooltip><TooltipTrigger asChild><Badge variant="outline" className="h-7 px-2.5 font-mono font-normal">{role}</Badge></TooltipTrigger><TooltipContent>{roleName}</TooltipContent></Tooltip>
            <Button variant="ghost" size="sm" className="h-8 gap-2 px-2 min-[1100px]:px-3" aria-label={isFullscreen ? '전체화면 종료 · F11' : '전체화면 · F11'} onClick={fullscreen}>
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}<Kbd className="max-[1100px]:hidden">F11</Kbd>
            </Button>
          </div>
        </header>
        <main className={`app-main @container flex-1 min-h-0 overflow-y-auto px-7 py-7 pb-10 min-w-0 ${agentSidebar ? 'agent-sidebar-space' : ''}`} style={{ scrollbarGutter: 'stable' }}>
          {record ? <Detail key={record.id} record={record} records={records} user={user} onUpdate={r => setRecords(p => p.map(x => x.id === r.id ? r : x))} onOpen={openRecord} />
            : page === 'dashboard' ? <Dashboard records={records} user={user} onOpen={openRecord} />
              : page === 'alerts' || page === 'episodes' ? <Lists key={`${page}-${listKey}`} kind={page === 'alerts' ? 'Alert' : 'Episode'} records={records} user={user} onOpen={openRecord} state={state} setState={setState} />
                : page === 'account' ? <Account user={user} onLogout={() => setLogout(true)} />
                  : page === 'settings' ? <Settings user={user} />
                    : <Notifications records={records} onOpen={openRecord} />}
        </main>
      </SidebarInset>
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
