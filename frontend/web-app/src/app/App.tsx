import { useCallback, useEffect, useState, type ComponentProps, type CSSProperties } from 'react'
import { ArrowLeft, Maximize2, Minimize2, PanelLeft } from 'lucide-react'
import { BrandWordmark, RadarMark } from '@/components/Brand'
import { DataModeBadge } from '@/components/Provenance'
import GlobalSearch from '@/features/search/GlobalSearch'
import { useTransactionTarget } from '@/features/transactions/transactionTarget'
import { SidebarSelection } from '@/components/SidebarSelection'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import ComingSoonPage from '@/pages/ComingSoonPage'
import DashboardPage from '@/pages/DashboardPage'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import AccountPage from '@/pages/AccountPage'
import AlertsPage from '@/pages/AlertsPage'
import EpisodesPage from '@/pages/EpisodesPage'
import LoginPage from '@/pages/LoginPage'
import SettingsPage from '@/pages/SettingsPage'
import TransactionsPage from '@/pages/TransactionsPage'
import { MOCK_USER, roleInfo } from './session'
import { mainNav, routeFromHash, toggleDocumentFullscreen, utilityNav, type Page } from './navigation'


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

export default function App() {
  const [{ page, id }, go] = usePage()
  const [, setTransactionTarget] = useTransactionTarget()
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [appFullscreen, setAppFullscreen] = useState(false)
  const [logout, setLogout] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const isFullscreen = nativeFullscreen || appFullscreen
  const fullscreen = useCallback(() => void toggleDocumentFullscreen(document, appFullscreen, setAppFullscreen), [appFullscreen])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'F11') { event.preventDefault(); fullscreen() } }
    const screen = () => { const active = Boolean(document.fullscreenElement); setNativeFullscreen(active); if (active) setAppFullscreen(false) }
    window.addEventListener('keydown', key)
    document.addEventListener('fullscreenchange', screen)
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', screen) }
  }, [fullscreen])

  if (!signedIn) return <LoginPage onLogin={() => { setSignedIn(true); go('dashboard') }} />

  return (
    <SidebarProvider className={appFullscreen ? 'app-fullscreen-fallback' : undefined} style={{ '--sidebar-width': '210px', '--sidebar-width-icon': '4rem' } as CSSProperties}>
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
                  <Avatar className="size-8 shrink-0"><AvatarFallback className="text-xs">{MOCK_USER.name[0]}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                    <span className="block text-xs font-medium">{MOCK_USER.name}</span>
                    <span className={`mt-0.5 block text-[10px] ${page === 'account' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{roleInfo[MOCK_USER.role].label}</span>
                  </span>
                </SidebarDestinationButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </SidebarSelection>
      </Sidebar>
      <SidebarInset className="flex h-svh min-w-0 flex-col overflow-hidden">
                {/* 양옆 칸을 같은 비율로 두어 뒤로가기 유무와 관계없이 검색창이 늘 가운데 같은 자리에 온다(v24) */}
        <header className="app-header z-40 grid h-15 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-background px-4 min-[1100px]:gap-5 min-[1100px]:px-6">
          <div className="header-navigation flex min-w-0 items-center">
          <SidebarTrigger className="rounded-full md:hidden" aria-label="메뉴 열기" />
          {/* 상세 화면에서는 머리 왼쪽에 목록으로 돌아가는 버튼을 둔다 */}
          {id && (page === 'alerts' || page === 'episodes') && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full px-3 text-xs" onClick={() => go(page)} data-testid="header-back">
              <ArrowLeft className="size-4" />{page === 'alerts' ? 'Alert 목록' : 'Episode 목록'}
            </Button>
          )}
          </div>
          <div className="header-search w-[clamp(280px,32vw,420px)]">
            <GlobalSearch onNavigate={(next, nextId) => go(next, nextId)} onOpenTransaction={target => { setTransactionTarget(target); go('transactions') }} />
          </div>
          <div className="header-actions flex items-center justify-self-end gap-1.5" data-testid="header-actions">
            <DataModeBadge />
            <Button variant="ghost" size="sm" className="h-8 gap-2 rounded-full px-2 min-[1100px]:px-3" aria-label={isFullscreen ? '전체화면 종료 · F11' : '전체화면 · F11'} aria-pressed={isFullscreen} onClick={fullscreen}>
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              <Kbd>F11</Kbd>
            </Button>
          </div>
        </header>
        <main className="app-main @container min-h-0 min-w-0 flex-1 overflow-y-auto px-7 py-7 pb-10" style={{ scrollbarGutter: 'stable' }}>
          {page === 'dashboard' ? <DashboardPage />
            : page === 'transactions' ? <TransactionsPage />
            : page === 'alerts' ? <AlertsPage alertId={id} onOpen={alertId => go('alerts', alertId)} onOpenEpisode={episodeId => go('episodes', episodeId)} />
            : page === 'episodes' ? <EpisodesPage episodeId={id} onOpen={episodeId => go('episodes', episodeId)} onOpenAlert={alertId => go('alerts', alertId)} />
            : page === 'settings' ? <SettingsPage />
              : page === 'account' ? <AccountPage onLogout={() => setLogout(true)} />
                : <ComingSoonPage title={pageTitles[page]} />}
        </main>
      </SidebarInset>
      <AlertDialog open={logout} onOpenChange={setLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>로그아웃할까요?</AlertDialogTitle>
            <AlertDialogDescription>현재 세션을 종료하고 로그인 화면으로 돌아갑니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSignedIn(false); go('dashboard') }}>로그아웃</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
