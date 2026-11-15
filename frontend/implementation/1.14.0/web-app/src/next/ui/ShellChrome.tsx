import { useState } from 'react'
import {
  ChevronDown, Compass, Download, FilePenLine, Inbox, LayoutDashboard,
  List, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, UserCircle, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import '../styles/shell-chrome.css'

type ShellChromeProps = {
  theme?: 'light' | 'dark' | 'solarized-light' | 'solarized-dark'
  accent?: 'sky' | 'violet' | 'pink' | 'lime'
  children?: React.ReactNode
  pageHeader?: React.ReactNode
  sidebar?: React.ReactNode
  sidebarVisible?: boolean
}

const caseGroups = [
  { label: '거래', ids: ['T-261111-00000001', 'T-261111-00000002', 'T-261111-00000003'] },
  { label: 'Alert', ids: ['A-261111-001042', 'A-261111-001051', 'A-261111-001069'] },
  { label: 'Episode', ids: ['E-261111-000001', 'E-261111-000002', 'E-261111-000003'] },
]

export function ShellChrome({ theme = 'light', accent = 'sky', children, pageHeader, sidebar, sidebarVisible }: ShellChromeProps) {
  const [localSidebarOpen, setSidebarOpen] = useState(true)
  const sidebarOpen = sidebarVisible ?? localSidebarOpen

  return (
    <div data-ui="shell-chrome" data-theme={theme} data-accent={accent} data-sidebar-open={sidebarOpen}>
      {pageHeader ?? <header data-chrome-slot="common-header">
        <div data-chrome-slot="header-sidebar">
          <Button variant="ghost" size="icon-sm" aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          {sidebarOpen ? (
            <Button variant="ghost" size="sm" data-chrome-slot="unread">안읽음 17건 <Inbox /></Button>
          ) : (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="안읽음 목록"><Inbox /></Button>
              <Button size="sm" data-tone="brand"><LayoutDashboard />대시보드</Button>
            </>
          )}
        </div>
        <div data-chrome-slot="work-tabs" role="group" aria-label="작업 탭">
          {['개요', '분석', '관련', '검토 의견'].map((label, index) => (
            <Button key={label} variant="ghost" size="sm" aria-pressed={index === 0}>{label}</Button>
          ))}
        </div>
        <div data-chrome-slot="view-tabs" role="group" aria-label="표시 방식">
          {['카드 보기', '표 보기'].map((label, index) => (
            <Button key={label} variant="ghost" size="sm" aria-pressed={index === 0}>{label}</Button>
          ))}
        </div>
        <div data-chrome-slot="header-actions">
          <Button variant="ghost" size="sm">저장본 목록</Button>
          <Button variant="secondary" size="sm" data-tone="inverse">임시 저장</Button>
          <Button size="sm" data-tone="brand">판정</Button>
          <Button variant="ghost" size="icon-sm" aria-label="내보내기"><Download /></Button>
        </div>
      </header>}
      <div data-chrome-slot="shell-body">
        {sidebarOpen && (
          sidebar ?? <aside data-chrome-slot="shell-sidebar" aria-label="사이드바">
            <nav data-chrome-slot="fixed-navigation" aria-label="주 메뉴">
              <Button variant="ghost" size="sm" data-tone="muted"><Search />검색</Button>
              <Button size="sm" data-tone="brand" aria-current="page"><LayoutDashboard />대시보드</Button>
              <Button variant="ghost" size="sm"><List />룰 엔진</Button>
              <Button variant="ghost" size="sm"><Compass />조사</Button>
              <Button variant="ghost" size="sm"><FilePenLine />보고서 작성</Button>
            </nav>
            <div data-chrome-slot="case-groups">
              {caseGroups.map(({ label, ids }) => (
                <section key={label} data-chrome-slot="case-group" aria-label={label}>
                  <div data-chrome-slot="case-group-heading"><span>{label}</span><ChevronDown /><Button variant="ghost" size="icon-xs" aria-label={`${label} 추가`}><Plus /></Button></div>
                  {ids.map(id => <Button key={id} variant="ghost" size="sm" data-chrome-slot="case-row"><span>{id}</span><X /></Button>)}
                </section>
              ))}
            </div>
            <footer data-chrome-slot="sidebar-footer">
              <Button variant="ghost" size="sm"><UserCircle />오조사 ･ admin</Button>
              <Button variant="ghost" size="icon-sm" aria-label="설정"><Settings /></Button>
            </footer>
          </aside>
        )}
        <main data-chrome-slot="content-slot" id={children ? 'workspace-main' : undefined} tabIndex={children ? -1 : undefined} aria-label={children ? '업무 작업 영역' : '비어 있는 콘텐츠 슬롯'}>{children}</main>
      </div>
    </div>
  )
}
