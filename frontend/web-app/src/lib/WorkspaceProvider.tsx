import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { fetchDemoClock, daysBefore, kstDate } from '@/api/liveDashboard'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { useAsync } from './useAsync'
import { PeriodContext, WorkspaceContext, WorkspaceState, useViewState, useWorkspace, type Period } from './workspaceState'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new WorkspaceState())
  useEffect(() => {
    const changed = () => store.queries.invalidate()
    const notificationsChanged = () => store.queries.invalidate('notifications')
    window.addEventListener('live-data-changed', changed)
    window.addEventListener('notifications-changed', notificationsChanged)
    return () => { window.removeEventListener('live-data-changed', changed); window.removeEventListener('notifications-changed', notificationsChanged) }
  }, [store])
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>
}
export function SharedPeriod({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const clock = useAsync(fetchDemoClock, [], { key: 'clock', enabled })
  const [override, setPeriod] = useViewState<Period | null>('period', null)
  if (!enabled) return <>{children}</>
  if (clock.state.status === 'loading') return <LoadingBlock label="업무 시각" />
  if (clock.state.status === 'error') return <ErrorBlock message={clock.state.message} onRetry={clock.retry} />
  const to = kstDate(clock.state.data.businessAt)
  const period = override ?? { from: daysBefore(to, 29), to }
  return <PeriodContext.Provider value={{ period, businessDate: to, setPeriod }}>{children}</PeriodContext.Provider>
}
export function WorkspaceMain({ route, className, style, children }: { route: string; className: string; style?: CSSProperties; children: ReactNode }) {
  const store = useWorkspace()
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.scrollTop = store.scroll.get(route) ?? 0
  }, [store, route])
  return <main ref={ref} className={className} style={style} onScroll={event => store.scroll.set(route, event.currentTarget.scrollTop)}>{children}</main>
}
