import { ArrowLeftRight, Bell, FolderSearch, LayoutDashboard, Settings, Siren } from 'lucide-react'

export type Page = 'dashboard' | 'transactions' | 'alerts' | 'episodes' | 'notifications' | 'settings' | 'account'

// v24 App.tsx 메뉴 구성
export const mainNav = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', name: 'Transactions', icon: ArrowLeftRight },
  { id: 'alerts', name: 'Alerts', icon: Siren },
  { id: 'episodes', name: 'Episodes', icon: FolderSearch },
] as const
export const utilityNav = [
  { id: 'notifications', name: '알림', icon: Bell },
  { id: 'settings', name: '설정', icon: Settings },
] as const

const pages: Page[] = ['dashboard', 'transactions', 'alerts', 'episodes', 'notifications', 'settings', 'account']

// 라우터를 들이기 전까지 주소의 # 뒤 값으로 화면을 고른다
export const pageFromHash = (hash: string): Page => {
  const id = hash.replace(/^#/, '')
  return (pages as string[]).includes(id) ? (id as Page) : 'dashboard'
}

type FullscreenDocument = {
  fullscreenElement: unknown
  exitFullscreen?: () => Promise<void>
  documentElement: { requestFullscreen?: () => Promise<void> }
}

// v24 App.tsx: 브라우저 전체화면이 막혀 있으면 앱 안에서 사이드바를 숨기는 방식으로 대신한다
export async function toggleDocumentFullscreen(doc: FullscreenDocument, fallbackActive: boolean, setFallback: (active: boolean) => void) {
  if (doc.fullscreenElement) return void (await doc.exitFullscreen?.())
  if (fallbackActive) return void setFallback(false)
  try {
    const request = doc.documentElement.requestFullscreen
    if (!request) throw new TypeError('Fullscreen API unavailable')
    await request.call(doc.documentElement)
  } catch {
    setFallback(true)
  }
}
