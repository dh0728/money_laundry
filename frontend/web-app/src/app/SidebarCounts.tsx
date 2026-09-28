import { useEffect, useState } from 'react'
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
  const [read] = useMemoryState<string[]>('notifications:read', [])
  const { state } = useAsync(loadMockNotifications, [])
  if (state.status !== 'success') return null
  const count = state.data.filter(item => !read.includes(item.id)).length
  if (!count) return null
  return <SidebarMenuBadge className={badgeClass} aria-label={`안 읽은 알림 ${count}건 · mock 데이터`} title="시연용 mock 알림 수">
    {count}<span className="ml-1 text-[9px] text-destructive-foreground/80 group-data-[collapsible=icon]:hidden">mock</span>
  </SidebarMenuBadge>
}

export function PendingWorkCount({ routeKey }: { routeKey: string }) {
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
    if (live) {
      const clock = await fetchDemoClock()
      const to = kstDate(clock.businessAt)
      return (await fetchLiveDashboard(daysBefore(to, 29), to)).personal.pending
    }
    const alerts = await loadMockMyAlerts()
    if (currentScenario() === 'empty') return 0
    const episodes = await loadMyEpisodes(user.userId, overrides, reviews)
    return workItems(alerts.content.map(row => withOverride(row, overrides)), episodes)
      .filter(item => item.status !== 'DONE').length
  }, [user.userId, routeKey, overrides, reviews, revision])
  if (state.status !== 'success' || !state.data) return null
  return <SidebarMenuBadge className={badgeClass} aria-label={`내 미처리 업무 ${state.data}건${live ? '' : ' · mock 데이터'}`} title={live ? '서버 집계 · 본인 담당 OPEN Alert와 Episode' : '시연용 mock · 내 담당 미처리 업무'}>
    {state.data}
  </SidebarMenuBadge>
}
