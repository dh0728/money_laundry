import NotificationsPage from './NotificationsPage'

// 호환 진입점. mock과 동일한 화면을 사용한다.
export default function LiveNotificationsPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  return <NotificationsPage remote onOpen={item => onOpen(item.target.page === 'alerts' ? 'ALERT' : 'EPISODE', item.target.id)} />
}
