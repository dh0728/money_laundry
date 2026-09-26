import { useCallback, useEffect, useState, type ComponentProps, type CSSProperties } from 'react'
import { Maximize2, Minimize2, PanelLeft } from 'lucide-react'
import { BrandWordmark, RadarMark } from '@/components/Brand'
import { SidebarSelection } from '@/components/SidebarSelection'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import ComingSoonPage from '@/pages/ComingSoonPage'
import DashboardPage from '@/pages/DashboardPage'
import { mainNav, pageFromHash, toggleDocumentFullscreen, utilityNav, type Page } from './navigation'

// 로그인·인증 방식이 정해지기 전까지 쓰는 가짜 사용자
const MOCK_USER = { name: '오분석', role: 'L1' }

const pageTitles: Record<Page, string> = {
  dashboard: '대시보드',
  transactions: 'Transactions',
  alerts: 'Alerts',
  episodes: 'Episodes',
  notifications: '알림',
  settings: '설정',
  account: '계정',
}

function usePage() {
  const [page, setPage] = useState(() => pageFromHash(window.location.hash))
  useEffect(() => {
    const update = () => setPage(pageFromHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const go = useCallback((next: Page) => { window.location.hash = next }, [])
  return [page, go] as const
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
  const [page, go] = usePage()
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [appFullscreen, setAppFullscreen] = useState(false)
  const isFullscreen = nativeFullscreen || appFullscreen
  const fullscreen = useCallback(() => void toggleDocumentFullscreen(document, appFullscreen, setAppFullscreen), [appFullscreen])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'F11') { event.preventDefault(); fullscreen() } }
    const screen = () => { const active = Boolean(document.fullscreenElement); setNativeFullscreen(active); if (active) setAppFullscreen(false) }
    window.addEventListener('keydown', key)
    document.addEventListener('fullscreenchange', screen)
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', screen) }
  }, [fullscreen])

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
                    <span className={`mt-0.5 block text-[10px] ${page === 'account' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{MOCK_USER.role}</span>
                  </span>
                </SidebarDestinationButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </SidebarSelection>
      </Sidebar>
      <SidebarInset className="flex h-svh min-w-0 flex-col overflow-hidden">
        {/* 가운데 전역 검색·할 일은 Alert·Episode 화면을 옮길 때 붙인다 */}
        <header className="app-header z-40 flex h-15 min-w-0 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 min-[1100px]:px-6">
          <SidebarTrigger className="rounded-full md:hidden" aria-label="메뉴 열기" />
          <div className="ml-auto flex items-center gap-1.5" data-testid="header-actions">
            <Button variant="ghost" size="sm" className="h-8 gap-2 rounded-full px-2 min-[1100px]:px-3" aria-label={isFullscreen ? '전체화면 종료 · F11' : '전체화면 · F11'} aria-pressed={isFullscreen} onClick={fullscreen}>
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              <Kbd>F11</Kbd>
            </Button>
          </div>
        </header>
        <main className="app-main @container min-h-0 min-w-0 flex-1 overflow-y-auto px-7 py-7 pb-10" style={{ scrollbarGutter: 'stable' }}>
          {page === 'dashboard' ? <DashboardPage /> : <ComingSoonPage title={pageTitles[page]} withThemePicker={page === 'settings'} />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
