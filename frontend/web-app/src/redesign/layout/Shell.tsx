import type { ReactNode } from 'react'
import { ChevronDown, CircleUser, Compass, Download, Inbox, LayoutDashboard, ListTree, PanelLeft, Plus, Search, Settings, SquarePen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, ButtonLink } from '../components/primitives'
import { caseHref, hrefFor, type Route } from '../route'
import { useWorkspace, type TabGroup } from '../workspace'

// Figma Sidebar (expanded 240). 고정 메뉴 5개 + 추가한 탭(거래·Alert·Episode) + 사용자.
const fixedNav = [
  { key: 'search', name: '검색', icon: <Search />, href: hrefFor({ page: 'soon', name: 'search' }) },
  { key: 'dashboard', name: '대시보드', icon: <LayoutDashboard />, href: hrefFor({ page: 'dashboard', scope: 'mine' }) },
  { key: 'rules', name: '룰 엔진', icon: <ListTree />, href: hrefFor({ page: 'soon', name: 'rules' }) },
  { key: 'investigate', name: '조사', icon: <Compass />, href: hrefFor({ page: 'investigate', tab: 'alerts', view: 'cards' }) },
  { key: 'report', name: '보고서 작성', icon: <SquarePen />, href: hrefFor({ page: 'soon', name: 'report' }) },
] as const

const groups: { key: TabGroup; name: string; listHref: string }[] = [
  { key: 'transactions', name: '거래', listHref: hrefFor({ page: 'investigate', tab: 'entities', view: 'cards' }) },
  { key: 'alerts', name: 'Alert', listHref: hrefFor({ page: 'investigate', tab: 'alerts', view: 'cards' }) },
  { key: 'episodes', name: 'Episode', listHref: hrefFor({ page: 'investigate', tab: 'episodes', view: 'cards' }) },
]

const navKeyOf = (route: Route) => (route.page === 'soon' ? route.name : route.page === 'case' ? '' : route.page)

function Sidebar({ route }: { route: Route }) {
  const { tabs, closeTab } = useWorkspace()
  const current = navKeyOf(route)
  const openId = route.page === 'case' ? route.id : ''
  return (
    <nav aria-label="주 메뉴" className="flex h-full w-60 shrink-0 flex-col items-start border-r border-(--rd-line) bg-(--rd-subtle)">
      <div className="flex w-full shrink-0 flex-col items-start gap-2 p-2">
        {fixedNav.map(item => {
          const active = item.key === current
          return (
            <ButtonLink key={item.key} href={item.href} aria-current={active ? 'page' : undefined} iconStart={item.icon}
              tone={active ? 'brand' : 'ghost'} className={cn('w-full justify-start font-medium', !active && item.key === 'search' && 'bg-(--rd-hover)')}>
              {item.name}
            </ButtonLink>
          )
        })}
      </div>
      <div className="rd-scroll-thin flex min-h-px w-full flex-1 flex-col items-start overflow-y-auto">
        {groups.map(group => (
          <div key={group.key} className="flex w-full shrink-0 flex-col items-start gap-2 p-2">
            <div className="flex w-full items-start justify-between">
              <Button size="sm" tone="plain" iconEnd={<ChevronDown />}>{group.name}</Button>
              <ButtonLink size="sm" href={group.listHref} aria-label={`${group.name} 탭 추가`} iconStart={<Plus />} />
            </div>
            {tabs[group.key].map(id => {
              const href = group.key === 'transactions' ? group.listHref : caseHref(id)
              return (
                <div key={id} className={cn('flex w-full items-center justify-between overflow-clip rounded-[6px] hover:bg-(--rd-hover)', id === openId && 'bg-(--rd-hover)')}>
                  <a href={href} aria-current={id === openId ? 'page' : undefined} className="min-w-0 flex-1 truncate p-2 text-[16px] font-medium leading-none text-(--rd-ink) outline-none">{id}</a>
                  <button type="button" aria-label={`${id} 탭 닫기`} onClick={() => closeTab(id)} className="flex shrink-0 cursor-pointer items-center p-2 text-(--rd-ink)">
                    <X className="size-4" />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex w-full shrink-0 items-start justify-between border-t border-(--rd-line) p-2">
        <Button tone="plain" iconStart={<CircleUser />}>오조사 ･ admin</Button>
        <ButtonLink href={hrefFor({ page: 'soon', name: 'settings' })} aria-label="설정" iconStart={<Settings />} />
      </div>
    </nav>
  )
}

// Figma Header. 왼쪽 232 블록(사이드바 토글 + 안읽음) | 화면별 전환 스위치 | filler | 화면별 버튼 + 내려받기
function Header({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { sidebarOpen, toggleSidebar } = useWorkspace()
  return (
    <header className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-(--rd-line) bg-(--rd-subtle) px-2">
      <div className="flex w-[232px] max-w-[232px] shrink-0 items-start justify-between border-r border-(--rd-line) py-2 pr-2">
        <Button aria-label="사이드바 열기/닫기" aria-expanded={sidebarOpen} onClick={toggleSidebar} iconStart={<PanelLeft />} />
        <ButtonLink href={hrefFor({ page: 'soon', name: 'notifications' })} iconEnd={<Inbox />}>안읽음 17건</ButtonLink>
      </div>
      <div className="flex shrink-0 items-center gap-2">{left}</div>
      <div className="h-full min-w-px flex-1" />
      <div className="flex shrink-0 items-center gap-2">
        {right}
        <Button aria-label="내려받기" className="w-8" iconStart={<Download />} />
      </div>
    </header>
  )
}

/** 화면 틀: (사이드바) + 머리줄 + 스크롤되는 본문 + (고정 바닥줄) */
export function Shell({ route, headerLeft, headerRight, footer, children }: { route: Route; headerLeft?: ReactNode; headerRight?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const { sidebarOpen } = useWorkspace()
  return (
    <div className="rd flex h-dvh w-full overflow-hidden">
      {sidebarOpen && <Sidebar route={route} />}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <Header left={headerLeft} right={headerRight} />
        <main className="rd-scroll min-h-0 flex-1 overflow-y-scroll bg-(--rd-bg)">{children}</main>
        {footer}
      </div>
    </div>
  )
}
