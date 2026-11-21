import { createContext, useContext } from 'react'

// 사이드바에 "추가한 탭"(거래·Alert·Episode)과 사이드바 열림 상태. 서버 저장 없이 화면에서만 유지한다.
export type TabGroup = 'transactions' | 'alerts' | 'episodes'
export type OpenTabs = Record<TabGroup, string[]>

export type Workspace = {
  sidebarOpen: boolean
  toggleSidebar: () => void
  tabs: OpenTabs
  addTab: (id: string) => void
  closeTab: (id: string) => void
}

export const initialTabs: OpenTabs = {
  transactions: ['T-261111-00000001', 'T-261111-00000002', 'T-261111-00000003'],
  alerts: ['A-261111-001042', 'A-261111-001051', 'A-261111-001069'],
  episodes: ['E-261111-000001', 'E-261111-000002', 'E-261111-000003'],
}

export const groupOf = (id: string): TabGroup => (id.startsWith('E-') ? 'episodes' : id.startsWith('T-') ? 'transactions' : 'alerts')

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceContext 밖에서 useWorkspace 를 불렀습니다')
  return value
}
