import { useCallback, useEffect, useEffectEvent, useId, useSyncExternalStore } from 'react'
import { useWorkspace } from './workspaceState'
export type { AsyncState } from './queryCache'

export function useAsync<T>(load: () => Promise<T>, deps: unknown[], options: { key?: string; maxAge?: number; enabled?: boolean } = {}) {
  const cache = useWorkspace().queries
  const id = useId()
  const key = JSON.stringify([options.key ?? id, ...deps])
  const maxAge = options.maxAge ?? 300_000
  const enabled = options.enabled ?? true
  const snapshot = useSyncExternalStore(useCallback(listener => cache.subscribe(key, listener), [cache, key]), () => cache.snapshot<T>(key))
  const latestLoad = useEffectEvent(() => load)
  useEffect(() => {
    if (!enabled) return
    const dueAt = (snapshot.settledAt ?? 0) + maxAge
    const ensure = () => {
      if (document.visibilityState !== 'hidden' && (!snapshot.settledAt || Date.now() >= dueAt))
        void cache.fetch(key, latestLoad(), maxAge).catch(() => undefined)
    }
    if (snapshot.refreshing) return
    ensure()
    const timer = window.setTimeout(ensure, Math.max(0, dueAt - Date.now()))
    window.addEventListener('focus', ensure)
    document.addEventListener('visibilitychange', ensure)
    return () => { clearInterval(timer); window.removeEventListener('focus', ensure); document.removeEventListener('visibilitychange', ensure) }
  }, [cache, key, maxAge, enabled, snapshot.invalidation, snapshot.settledAt, snapshot.refreshing])
  const refresh = () => cache.fetch(key, load, maxAge, true)
  const retry = () => { void refresh().catch(() => undefined) }
  return { state: snapshot.state, refreshing: snapshot.refreshing, refreshError: snapshot.refreshError, nextRefreshAt: enabled && snapshot.settledAt ? snapshot.settledAt + maxAge : undefined, retry, refresh }
}
