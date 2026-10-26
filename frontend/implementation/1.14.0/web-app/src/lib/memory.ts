import { useCallback, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
// In-memory prototype state survives navigation, and resets on a full reload.
const memory = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()
export const memorySnapshot = <T,>(key: string, initial: T): T => memory.has(key) ? memory.get(key) as T : initial
export const subscribeMemory = (key: string, listener: () => void) => {
  const group = listeners.get(key) ?? new Set<() => void>()
  group.add(listener)
  listeners.set(key, group)
  return () => { group.delete(listener); if (!group.size) listeners.delete(key) }
}
export const writeMemory = <T,>(key: string, value: T) => {
  memory.set(key, value)
  listeners.get(key)?.forEach(listener => listener())
}
export function useMemoryState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const fallback = useRef(initial)
  const subscribe = useCallback((listener: () => void) => subscribeMemory(key, listener), [key])
  const snapshot = useCallback(() => memorySnapshot(key, fallback.current), [key])
  const value = useSyncExternalStore(subscribe, snapshot, snapshot)
  // 같은 이벤트에서 화면이 unmount되어도 값이 남도록 effect가 아니라 setter에서 바로 저장한다
  const set = useCallback<Dispatch<SetStateAction<T>>>(next => {
    const previous = memorySnapshot(key, fallback.current)
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(previous) : next
    writeMemory(key, resolved)
  }, [key])
  return [value, set]
}
