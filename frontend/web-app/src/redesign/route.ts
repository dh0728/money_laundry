import { useEffect, useState } from 'react'

// 새 UI의 화면 주소. 라우터 없이 주소의 # 뒤 값으로 화면을 고른다(기존 화면과 같은 방식).
//   #/dashboard/mine · #/dashboard/all
//   #/investigate/entities · #/investigate/alerts/cards · #/investigate/episodes/table
//   #/alert/A-261111-001042/overview · #/episode/E-261111-000001/analysis/owner
export type DashboardScope = 'mine' | 'all'
export type InvestigateTab = 'entities' | 'alerts' | 'episodes'
export type ListView = 'cards' | 'table'
export type CaseKind = 'alert' | 'episode'
export type CaseTab = 'overview' | 'analysis' | 'related'
export type GraphView = 'pattern' | 'owner'
export type ComingSoon = 'search' | 'rules' | 'report' | 'notifications' | 'settings'

export type Route =
  | { page: 'dashboard'; scope: DashboardScope }
  | { page: 'investigate'; tab: InvestigateTab; view: ListView }
  | { page: 'case'; kind: CaseKind; id: string; tab: CaseTab; view: GraphView }
  | { page: 'soon'; name: ComingSoon }

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback

export function parseRoute(hash: string): Route {
  const [head, a, b, c] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  if (head === 'investigate') {
    return { page: 'investigate', tab: oneOf(a, ['entities', 'alerts', 'episodes'], 'alerts'), view: oneOf(b, ['cards', 'table'], 'cards') }
  }
  if ((head === 'alert' || head === 'episode') && a) {
    return { page: 'case', kind: head, id: a, tab: oneOf(b, ['overview', 'analysis', 'related'], 'overview'), view: oneOf(c, ['pattern', 'owner'], 'pattern') }
  }
  if (head === 'soon') return { page: 'soon', name: oneOf(a, ['search', 'rules', 'report', 'notifications', 'settings'], 'search') }
  return { page: 'dashboard', scope: oneOf(a, ['mine', 'all'], 'mine') }
}

/** 화면 주소. 링크(<a href>)에 그대로 쓴다. */
export function hrefFor(route: Route): string {
  switch (route.page) {
    case 'dashboard': return `#/dashboard/${route.scope}`
    case 'investigate': return route.tab === 'entities' ? '#/investigate/entities' : `#/investigate/${route.tab}/${route.view}`
    case 'case': return `#/${route.kind}/${encodeURIComponent(route.id)}/${route.tab}${route.tab === 'overview' ? '' : `/${route.view}`}`
    case 'soon': return `#/soon/${route.name}`
  }
}

/** A- 로 시작하면 Alert, E- 로 시작하면 Episode */
export const caseKindOf = (id: string): CaseKind => (id.startsWith('E-') ? 'episode' : 'alert')
export const caseHref = (id: string, tab: CaseTab = 'overview') =>
  hrefFor({ page: 'case', kind: caseKindOf(id), id, tab, view: 'pattern' })

export function navigate(route: Route) { window.location.hash = hrefFor(route) }

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
