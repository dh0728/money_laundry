import { createContext, useCallback, useContext, useState, useSyncExternalStore, type SetStateAction } from 'react'
import { QueryCache } from './queryCache'

export class WorkspaceState {
  queries = new QueryCache()
  scroll = new Map<string, number>()
  private views = new Map<string, unknown>()
  private listeners = new Set<() => void>()
  get<T>(key: string, fallback: T): T { return this.views.has(key) ? this.views.get(key) as T : fallback }
  set<T>(key: string, value: T) { this.views.set(key, value); this.listeners.forEach(listener => listener()) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
}
export const WorkspaceContext = createContext<WorkspaceState | null>(null)
export type Period = { from: string; to: string }
export const PeriodContext = createContext<{ period: Period; businessDate?: string; setPeriod: (period: Period) => void } | null>(null)

export function useWorkspace() {
  const shared = useContext(WorkspaceContext)
  const [local] = useState(() => new WorkspaceState())
  return shared ?? local
}
export function useViewState<T>(key: string, initial: T) {
  const store = useWorkspace()
  const [fallback] = useState(initial)
  const value = useSyncExternalStore(store.subscribe, () => store.get(key, fallback))
  const set = useCallback((next: SetStateAction<T>) => {
    const previous = store.get(key, fallback)
    store.set(key, typeof next === 'function' ? (next as (value: T) => T)(previous) : next)
  }, [store, key, fallback])
  return [value, set] as const
}
export function useSharedPeriod(fallback: Period = { from: '', to: '' }) {
  const shared = useContext(PeriodContext)
  const [override, setOverride] = useState<Period | null>(null)
  const period = shared?.period ?? override ?? fallback
  const setPeriod = shared?.setPeriod ?? setOverride
  return { ...period, businessDate: shared?.businessDate, setPeriod,
    setFrom: (from: string) => { if (from && (!period.to || from <= period.to)) setPeriod({ ...period, from }) },
    setTo: (to: string) => { if (to && (!period.from || to >= period.from)) setPeriod({ ...period, to }) } }
}
