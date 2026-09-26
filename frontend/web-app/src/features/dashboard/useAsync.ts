import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/api/common'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

type Settled<T> = { key: string; state: AsyncState<T> }

// deps가 바뀌면 다시 불러온다. 결과가 지금 요청의 것이 아니면 loading으로 본다.
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([...deps, attempt])
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  useEffect(() => {
    let active = true
    load().then(
      data => active && setSettled({ key, state: { status: 'success', data } }),
      (error: unknown) =>
        active &&
        setSettled({ key, state: { status: 'error', message: error instanceof ApiError ? error.message : '알 수 없는 오류가 발생했습니다.' } }),
    )
    return () => {
      active = false
    }
    // key가 deps와 attempt를 모두 담는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const retry = useCallback(() => setAttempt(n => n + 1), [])
  const state: AsyncState<T> = settled?.key === key ? settled.state : { status: 'loading' }
  return { state, retry }
}
