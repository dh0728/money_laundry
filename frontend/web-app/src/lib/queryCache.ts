import { ApiError } from '@/api/common'

export type AsyncState<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; message: string; error: unknown }
export type QuerySnapshot<T> = { state: AsyncState<T>; refreshing: boolean; refreshError?: string; invalidation: number; settledAt?: number }
const EMPTY: QuerySnapshot<never> = { state: { status: 'loading' }, refreshing: false, invalidation: 0 }
type Entry = { snapshot: QuerySnapshot<unknown>; updated: number; generation: number; pending?: Promise<unknown> }
const message = (error: unknown) => error instanceof ApiError ? error.message : '데이터를 갱신하지 못했습니다. 다시 시도해 주세요.'

/** Session memory only: never write investigation data to browser storage. */
export class QueryCache {
  private entries = new Map<string, Entry>()
  private listeners = new Map<string, Set<() => void>>()
  snapshot<T>(key: string): QuerySnapshot<T> { return (this.entries.get(key)?.snapshot ?? EMPTY) as QuerySnapshot<T> }
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(listener); this.listeners.set(key, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key) }
  }
  private emit(key: string) { this.listeners.get(key)?.forEach(listener => listener()) }
  invalidate() {
    for (const [key, entry] of this.entries) {
      if (key.startsWith('["clock"') || key.startsWith('["payment-formats"')) continue
      entry.updated = 0; entry.generation++; entry.pending = undefined
      entry.snapshot = { ...entry.snapshot, refreshing: false, settledAt: undefined, invalidation: entry.snapshot.invalidation + 1 }
      this.emit(key)
    }
  }
  async fetch<T>(key: string, load: () => Promise<T>, maxAge: number, force = false): Promise<T> {
    let entry = this.entries.get(key)
    if (entry?.pending && !force) return entry.pending as Promise<T>
    if (!force && entry?.snapshot.state.status === 'success' && Date.now() - entry.updated < maxAge) return entry.snapshot.state.data as T
    if (!entry) { entry = { snapshot: EMPTY, updated: 0, generation: 0 }; this.entries.set(key, entry) }
    const current = entry
    const generation = ++current.generation
    current.snapshot = { ...current.snapshot, refreshing: true, refreshError: undefined }
    let response: Promise<T>
    try { response = load() } catch (error) { response = Promise.reject(error) }
    const pending = response.then(data => {
      if (current.generation === generation) {
        current.updated = Date.now()
        current.snapshot = { state: { status: 'success', data }, refreshing: false, invalidation: current.snapshot.invalidation }
      }
      return data
    }, error => {
      if (current.generation === generation) current.snapshot = current.snapshot.state.status === 'success'
        ? { ...current.snapshot, refreshing: false, refreshError: message(error) }
        : { state: { status: 'error', message: message(error), error }, refreshing: false, invalidation: current.snapshot.invalidation }
      throw error
    }).finally(() => {
      if (current.generation === generation) { current.pending = undefined; current.snapshot = { ...current.snapshot, settledAt: Date.now() }; this.emit(key) }
      for (const [oldKey, old] of this.entries) {
        if (this.entries.size <= 60) break
        if (oldKey !== key && !old.pending && !this.listeners.has(oldKey)) this.entries.delete(oldKey)
      }
    })
    current.pending = pending
    this.emit(key)
    return pending
  }
}
