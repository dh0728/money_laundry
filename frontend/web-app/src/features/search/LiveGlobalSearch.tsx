import { useEffect, useState } from 'react'
import { fetchReviewCases } from '@/api/liveReview'
import { fetchNotifications } from '@/api/notifications'
import type { Page } from '@/app/navigation'
import { useAsync } from '@/lib/useAsync'
import { useViewState } from '@/lib/workspaceState'
import GlobalSearch, { type ResultGroup } from './GlobalSearch'

export default function LiveGlobalSearch({ onNavigate }: { onNavigate: (page: Page, id?: number) => void }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [, setNotificationSearch] = useViewState('notifications/query', '')
  const [, setLedgerSearch] = useViewState('ledger/search', '')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  const result = useAsync(async () => {
    const [alerts, episodes, notifications] = await Promise.all([
      fetchReviewCases({ kind: 'ALERT', query: search, size: 5 }),
      fetchReviewCases({ kind: 'EPISODE', query: search, size: 5 }),
      fetchNotifications('', '', search, 0),
    ])
    return { alerts, episodes, notifications }
  }, [search], { key: 'global-search', enabled: !!search })
  const groups: ResultGroup[] = search === query.trim() && result.state.status === 'success' ? [
    { id: 'alerts', label: 'Alert', items: result.state.data.alerts.content.map(row => ({
      key: `a-${row.caseId}`, primary: `A-${row.alertId}`, secondary: row.assigneeName,
      onSelect: () => onNavigate('alerts', row.caseId),
    })) },
    { id: 'episodes', label: 'Episode', items: result.state.data.episodes.content.map(row => ({
      key: `e-${row.caseId}`, primary: `E-${row.caseId}`, secondary: row.assigneeName,
      onSelect: () => onNavigate('episodes', row.caseId),
    })) },
    { id: 'notifications', label: '알림', items: result.state.data.notifications.content.slice(0, 5).map(row => ({
      key: row.id, primary: row.title, secondary: row.code,
      onSelect: () => { setNotificationSearch(search); onNavigate('notifications') },
    })) },
  ] : []
  if (query.trim()) groups.push({ id: 'ledger', label: '거래 탐색', items: [{
    key: 'ledger-search', primary: '거래 내역에서 소유주·계좌·거래 식별자로 검색',
    secondary: query.trim(), onSelect: () => { setLedgerSearch(query.trim()); onNavigate('transactions') },
  }] })
  return <GlobalSearch onNavigate={onNavigate} remote={{
    groups, onQuery: setQuery, loading: query.trim() !== search || result.state.status === 'loading',
    error: search === query.trim() && result.state.status === 'error' ? result.state.message : undefined,
  }} />
}
