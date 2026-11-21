import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
// In-memory prototype state survives navigation, and resets on a full reload.
const memory = new Map<string, unknown>()
export function useMemoryState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => memory.has(key) ? memory.get(key) as T : initial)
  // 같은 이벤트에서 화면이 unmount되어도 값이 남도록 effect가 아니라 setter에서 바로 저장한다
  const set = useCallback<Dispatch<SetStateAction<T>>>(next => {
    const previous = memory.has(key) ? memory.get(key) as T : value
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(previous) : next
    memory.set(key, resolved)
    setValue(resolved)
  }, [key, value])
  return [value, set]
}
