import { useCallback, useMemo, useState } from 'react'
import './redesign.css'
import { Shell } from './layout/Shell'
import { CaseDetailPage } from './pages/CaseDetailPage'
import { DashboardPage } from './pages/DashboardPage'
import { InvestigatePage } from './pages/InvestigatePage'
import { RuleEnginePage } from './pages/RuleEnginePage'
import { useRoute, type ComingSoon, type Route } from './route'
import { groupOf, initialTabs, WorkspaceContext, type OpenTabs, type Workspace } from './workspace'

// 새 디자인(Figma "design · 2026-11-17") 화면. mock 데이터로만 동작하며 API 는 연결하지 않았다.
// 기존 화면은 주소에 ?ui=old 를 붙이면 그대로 볼 수 있다(main.tsx).

const soonNames: Record<ComingSoon, string> = { search: '검색', report: '보고서 작성', notifications: '알림', settings: '설정' }

/** 이번에 옮기지 않은 화면 자리. 시안에는 없는 임시 안내다. */
function ComingSoonPage({ route, name }: { route: Route; name: ComingSoon }) {
  return (
    <Shell route={route}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-(--rd-strong)">
        <p className="text-[16px] font-semibold">{soonNames[name]}</p>
        <p className="text-[14px] text-(--rd-mute)">이번 변환 범위에 들어 있지 않은 화면입니다.</p>
      </div>
    </Shell>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'dashboard': return <DashboardPage route={route} scope={route.scope} />
    case 'investigate': return <InvestigatePage route={route} tab={route.tab} view={route.view} />
    // key: 다른 Alert·Episode 로 옮기면 패널 펼침·선택 상태를 새로 시작한다
    case 'case': return <CaseDetailPage key={`${route.kind}:${route.id}`} route={route} kind={route.kind} id={route.id} tab={route.tab} view={route.view} />
    case 'rules': return <RuleEnginePage route={route} tab={route.tab} />
    case 'soon': return <ComingSoonPage route={route} name={route.name} />
  }
}

export default function RedesignApp() {
  const route = useRoute()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tabs, setTabs] = useState<OpenTabs>(initialTabs)
  const toggleSidebar = useCallback(() => setSidebarOpen(open => !open), [])
  const addTab = useCallback((id: string) => {
    setTabs(current => { const group = groupOf(id); return current[group].includes(id) ? current : { ...current, [group]: [...current[group], id] } })
    setSidebarOpen(true)
  }, [])
  const closeTab = useCallback((id: string) => setTabs(current => { const group = groupOf(id); return { ...current, [group]: current[group].filter(item => item !== id) } }), [])
  const workspace = useMemo<Workspace>(() => ({ sidebarOpen, toggleSidebar, tabs, addTab, closeTab }), [sidebarOpen, toggleSidebar, tabs, addTab, closeTab])

  return (
    <WorkspaceContext value={workspace}>
      <Page route={route} />
    </WorkspaceContext>
  )
}
