import { useEffect, useState } from 'react'
import { fetchNotifications } from '@/api/notifications'
import { fetchDemoClock, fetchLiveDashboard, daysBefore, kstDate } from '@/api/liveDashboard'
import { useCurrentUser } from '@/app/session'
import { SidebarMenuBadge } from '@/components/ui/sidebar'
import { useAlertOverrides } from '@/features/alerts/alertOverrides'
import { useReviewRequests } from '@/features/episodes/reviewStore'
import { loadMyEpisodes } from '@/features/dashboard/dataSource'
import { workItems } from '@/features/dashboard/workItems'
import { live } from '@/lib/apiMode'
import { useAsync } from '@/lib/useAsync'
import { useMemoryState } from '@/lib/memory'
import { loadMockMyAlerts } from '@/mocks/alerts'
import { loadMockNotifications } from '@/mocks/notifications'
import { currentScenario } from '@/mocks/scenario'
import { withOverride } from '@/features/alerts/alertOverrides'

const badgeClass = 'top-1/2! -translate-y-1/2 rounded-full bg-destructive text-destructive-foreground peer-hover/menu-button:text-destructive-foreground peer-data-[active=true]/menu-button:text-destructive-foreground group-data-[collapsible=icon]:right-0! group-data-[collapsible=icon]:top-0! group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:min-w-4 group-data-[collapsible=icon]:translate-x-1/4 group-data-[collapsible=icon]:translate-y-0 group-data-[collapsible=icon]:px-0.5 group-data-[collapsible=icon]:text-[10px]'

export function UnreadNotificationCount() {
  return live ? <LiveUnreadCount /> : <MockUnreadCount />
}

function LiveUnreadCount() {
  const { state } = useAsync(() => fetchNotifications('', '', '', 0), ['', '', '', 0], { key: 'notifications' })
  if (state.status !== 'success' || !state.data.unreadCount) return null
  return <SidebarMenuBadge className={badgeClass} aria-label={`안 읽은 알림 ${state.data.unreadCount}건`} title="서버 집계 · 본인 알림">
    {state.data.unreadCount}
  </SidebarMenuBadge>
}

function MockUnreadCount() {
  const [read] = useMemoryState<string[]>('notifications:read', [])
  const { state } = useAsync(loadMockNotifications, [])
  if (state.status !== 'success') return null
  const count = state.data.filter(item => !read.includes(item.id)).length
  if (!count) return null
  return <SidebarMenuBadge className={badgeClass} aria-label={`안 읽은 알림 ${count}건 · mock 데이터`} title="시연용 mock 알림 수">
    {count}<span className="ml-1 text-[9px] text-destructive-foreground group-data-[collapsible=icon]:hidden">mock</span>
  </SidebarMenuBadge>
}

export function PendingWorkCount({ routeKey }: { routeKey: string }) {
  return live ? <LivePendingCount /> : <MockPendingCount routeKey={routeKey} />
}

function LivePendingCount() {
  const clock = useAsync(fetchDemoClock, [], { key: 'clock' })
  const to = clock.state.status === 'success' ? kstDate(clock.state.data.businessAt) : ''
  const from = to ? daysBefore(to, 29) : ''
  const dashboard = useAsync(() => fetchLiveDashboard(from, to), [from, to], { key: 'dashboard', enabled: Boolean(from && to) })
  const pending = dashboard.state.status === 'success' ? dashboard.state.data.personal.pending : 0
  if (!pending) return null
  return <SidebarMenuBadge className={badgeClass} aria-label={`내 미처리 업무 ${pending}건`} title="서버 집계 · 본인 담당 OPEN Alert와 Episode">{pending}</SidebarMenuBadge>
}

function MockPendingCount({ routeKey }: { routeKey: string }) {
  const user = useCurrentUser()
  const [overrides] = useAlertOverrides()
  const [reviews] = useReviewRequests()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('review-command-saved', refresh)
    return () => window.removeEventListener('review-command-saved', refresh)
  }, [])
  const { state } = useAsync(async () => {
    const alerts = await loadMockMyAlerts()
    if (currentScenario() === 'empty') return 0
    const episodes = await loadMyEpisodes(user.userId, overrides, reviews)
    return workItems(alerts.content.map(row => withOverride(row, overrides)), episodes)
      .filter(item => item.status !== 'DONE').length
  }, [user.userId, routeKey, overrides, reviews, revision])
  if (state.status !== 'success' || !state.data) return null
  return <SidebarMenuBadge className={badgeClass} aria-label={`내 미처리 업무 ${state.data}건 · mock 데이터`} title="시연용 mock · 내 담당 미처리 업무">
    {state.data}
  </SidebarMenuBadge>
}
