import { Bell, Compass, FilePenLine, LayoutDashboard, List, LogOut, PanelLeftClose, PanelLeftOpen, Search, ScanLine, Settings, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { snapshot, type Scope } from '../dashboard-data'
import { ShellChrome } from './ShellChrome'
import { PageHeaderContext } from '../page-header-context'
import { caseHref, type WorkspaceCase } from '../workspace-store'

export type Theme = 'light' | 'dark' | 'solarized-light' | 'solarized-dark'
export type Accent = 'sky' | 'violet' | 'pink' | 'lime'
export function Appearance({ theme, accent, onTheme, onAccent }: { theme: Theme; accent: Accent; onTheme: (value: Theme) => void; onAccent: (value: Accent) => void }) {
  return <div data-part="appearance">
    <label>테마<select aria-label="테마" value={theme} onChange={e => onTheme(e.target.value as Theme)}>
      <option value="light">기본 라이트</option><option value="dark">기본 다크</option><option value="solarized-light">솔라라이즈드 라이트</option><option value="solarized-dark">솔라라이즈드 다크</option>
    </select></label>
    <label>브랜드<select aria-label="브랜드" value={accent} onChange={e => onAccent(e.target.value as Accent)}>
      <option value="sky">Sky</option><option value="violet">Violet</option><option value="pink">Pink</option><option value="lime">Lime</option>
    </select></label>
  </div>
}
export function AppShell({ scope, theme, accent, filters = '', sidebarOpen, onToggle, onLogout, appearance, query, onSearch, children, actions, pathname = '/dashboard/mine', openRecords = [], unreadCount = 0, onNotifications, onSettings, onAccount, onCloseCase }: {
  theme: Theme; accent: Accent
  scope: Scope; filters?: string; sidebarOpen: boolean; onToggle: () => void; onLogout: () => void
  appearance: React.ReactNode; query: string; onSearch: (value: string) => void
  children: React.ReactNode; actions: React.ReactNode
  pathname?: string; openRecords?: WorkspaceCase[]; unreadCount?: number
  onNotifications?: () => void; onSettings?: () => void; onAccount?: () => void; onCloseCase?: (id: number) => void
}) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [workPage, setWorkPage] = useState(1)
  const workPages = Math.max(1, Math.ceil(openRecords.length / 6))
  const currentPage = Math.min(workPage, workPages)
  const isDashboard = pathname.startsWith('/dashboard')
  const sidebar = <aside aria-label="사이드바" data-part="sidebar">
      <div data-part="sidebar-identity"><ScanLine aria-hidden="true" /><strong>AML RADAR</strong></div>
      <form role="search" aria-label="업무 검색" onSubmit={e => { e.preventDefault(); const value = new FormData(e.currentTarget).get('q'); onSearch(String(value ?? '')) }}>
        <label data-part="search-field"><Search aria-hidden="true" /><input key={query} name="q" defaultValue={query} placeholder="ID · 담당자 · 패턴 검색" aria-label="업무 검색어" /><Button variant="ghost" size="icon-sm" aria-label="검색 적용" type="submit"><Search /></Button></label>
      </form>
      <nav aria-label="주 메뉴">
        <a href={`#/dashboard/${scope}${isDashboard ? filters : ''}`} aria-current={isDashboard ? 'page' : undefined}><LayoutDashboard />대시보드</a>
        <a href="#/rules" aria-current={pathname.startsWith('/rules') ? 'page' : undefined}><List />룰 엔진</a>
        <a href="#/investigate/ledger" aria-current={pathname === '/investigate/ledger' ? 'page' : undefined}><Compass />거래 내역</a>
        <a href="#/investigate/alerts?view=cards" data-part="nav-child" aria-current={pathname === '/investigate/alerts' || pathname.startsWith('/alerts/') ? 'page' : undefined}>Alert 목록</a>
        <a href="#/investigate/episodes?view=cards" data-part="nav-child" aria-current={pathname === '/investigate/episodes' || pathname.startsWith('/episodes/') ? 'page' : undefined}>Episode 목록</a>
        <a href="#/report" aria-current={pathname === '/report' ? 'page' : undefined}><FilePenLine />보고서 작성</a>
      </nav>
      {!!openRecords.length && <section data-part="open-work" aria-label="열린 업무"><strong>열린 업무 {openRecords.length}건</strong>{openRecords.slice((currentPage - 1) * 6, currentPage * 6).map(c => <div key={c.caseId}><a href={caseHref(c)} aria-current={pathname.endsWith(`/${c.caseId}`) ? 'page' : undefined}>{c.displayId}</a><Button variant="ghost" size="icon-sm" aria-label={`${c.displayId} 탭 닫기`} onClick={() => onCloseCase?.(c.caseId)}><X /></Button></div>)}{workPages > 1 && <div><Button variant="ghost" disabled={currentPage === 1} onClick={() => setWorkPage(currentPage - 1)}>이전</Button><small>{currentPage}/{workPages}</small><Button variant="ghost" disabled={currentPage === workPages} onClick={() => setWorkPage(currentPage + 1)}>다음</Button></div>}</section>}
      <div data-part="sidebar-bottom"><div data-part="sidebar-utilities"><Button variant="ghost" onClick={onNotifications}><Bell />알림 {unreadCount > 0 && <span>{unreadCount}</span>}</Button><Button variant="ghost" size="icon-sm" aria-label="설정" onClick={onSettings}><Settings /></Button></div>{appearance}<div data-part="account"><Button variant="ghost" data-part="account-button" onClick={onAccount}><span><strong>{snapshot.userName} 님</strong><small>조사 담당자 · 샘플 계정</small></span></Button><Button variant="ghost" size="icon-sm" aria-label="로그아웃" onClick={onLogout}><LogOut /></Button></div></div>
    </aside>
  const pageHeader = <header data-part="page-header" aria-label="페이지 헤더">
        <Button variant="ghost" size="icon-sm" aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'} aria-expanded={sidebarOpen} onClick={onToggle}>{sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</Button>
        {!sidebarOpen && <LayoutDashboard aria-label="대시보드" />}
        {isDashboard && <nav data-part="scope-switch" aria-label="대시보드 범위"><a href={`#/dashboard/mine${filters}`} aria-current={scope === 'mine' ? 'page' : undefined}>내 담당</a><a href={`#/dashboard/all${filters}`} aria-current={scope === 'all' ? 'page' : undefined}>전체</a></nav>}
        <div data-part="feature-actions" ref={setHost} />
        <div data-part="page-actions">{actions}</div>
      </header>
  return <div data-part="workspace" data-sidebar-open={sidebarOpen}>
    <a data-part="skip-link" href="#workspace-main" onClick={e => { e.preventDefault(); document.getElementById('workspace-main')?.focus() }}>본문으로 이동</a>
    <PageHeaderContext.Provider value={host}><ShellChrome theme={theme} accent={accent} sidebarVisible={sidebarOpen} sidebar={sidebar} pageHeader={pageHeader}>{!sidebarOpen && <div data-part="collapsed-tools">{appearance}<Button variant="ghost" onClick={onNotifications}><Bell />알림</Button><Button variant="ghost" onClick={onSettings}><Settings />설정</Button><Button variant="ghost" onClick={onLogout}><LogOut />로그아웃</Button></div>}{children}</ShellChrome></PageHeaderContext.Provider>
  </div>
}
