import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError } from '@/api/common'
import { fetchLiveDashboard, type LiveDashboard } from '@/api/liveDashboard'
import { useWorkspace } from './workspaceState'

/** One summary request per active view; elapsed ticks are discarded, never queued. */
export function useDashboardPolling(userId: number, from: string, to: string) {
  const cache = useWorkspace().queries
  const key = JSON.stringify(['dashboard', userId, from, to])
  const enabled = Boolean(from && to)
  const snapshot = useSyncExternalStore(useCallback(listener => cache.subscribe(key, listener), [cache, key]), () => cache.snapshot<LiveDashboard>(key))
  const control = useRef<{ refresh: () => Promise<unknown> } | null>(null)
  const [schedule, setSchedule] = useState<{ key: string; at?: number }>({ key })
  useEffect(() => {
    if (!enabled) return
    const origin = performance.now()
    let nextTick = origin + 1000
    let retryAt = 0, failures = 0, stopped = false, disposed = false
    let active: Promise<unknown> | undefined
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout>
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine
    const updateSchedule = () => {
      if (!disposed) setSchedule({ key, at: stopped || !visible() ? undefined : Date.now() + Math.max(0, Math.max(nextTick, retryAt) - performance.now()) })
    }
    const refresh = (initial = false): Promise<unknown> => {
      if (active) return active
      if (disposed || stopped || !visible() || performance.now() < retryAt) return Promise.resolve()
      controller = new AbortController()
      const current = controller
      let cancel!: () => void
      const cancellation = new Promise<never>((_, reject) => {
        cancel = () => reject(current.signal.reason)
        current.signal.addEventListener('abort', cancel, { once: true })
      })
      const deadline = window.setTimeout(() => current.abort(new DOMException('Dashboard request timed out', 'TimeoutError')), 5000)
      active = cache.fetch(key, () => Promise.race([fetchLiveDashboard(from, to, current.signal), cancellation]), initial ? 1000 : 0)
        .then(() => { failures = 0; retryAt = 0 })
        .catch((error: unknown) => {
          if (disposed) return
          failures++
          stopped = error instanceof ApiError && [400, 401, 403].includes(error.problem.status)
          const backoff = Math.min(30_000, 2000 * 2 ** Math.min(failures - 1, 4))
          retryAt = performance.now() + Math.max(backoff + Math.random() * 250, error instanceof ApiError ? error.retryAfterMs ?? 0 : 0)
          throw error
        }).finally(() => {
          window.clearTimeout(deadline)
          current.signal.removeEventListener('abort', cancel)
          active = undefined
          updateSchedule()
        })
      return active
    }
    const tick = () => {
      if (disposed) return
      void refresh().catch(() => undefined)
      nextTick = origin + (Math.floor((performance.now() - origin) / 1000) + 1) * 1000
      timer = window.setTimeout(tick, Math.max(0, nextTick - performance.now()))
      updateSchedule()
    }
    const resume = () => { if (visible()) void refresh().catch(() => undefined) }
    control.current = { refresh }
    void refresh(true).catch(() => undefined)
    timer = window.setTimeout(tick, 1000)
    window.addEventListener('online', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('live-data-changed', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      controller?.abort(new DOMException('Dashboard view changed', 'AbortError'))
      if (active) cache.discardPending(key)
      control.current = null
      window.removeEventListener('online', resume)
      window.removeEventListener('focus', resume)
      window.removeEventListener('live-data-changed', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [cache, key, enabled, from, to])
  const refresh = () => control.current?.refresh() ?? Promise.resolve()
  const retry = () => { void refresh().catch(() => undefined) }
  return { state: snapshot.state, refreshing: snapshot.refreshing, refreshError: snapshot.refreshError,
    nextRefreshAt: enabled && schedule.key === key ? schedule.at : undefined, refresh, retry }
}
