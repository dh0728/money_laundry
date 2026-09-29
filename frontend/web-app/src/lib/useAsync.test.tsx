import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAsync } from './useAsync'

it('완료 시각부터 5분 뒤 갱신하고 수동 갱신하면 기한을 다시 계산한다', async () => {
  vi.useFakeTimers()
  try {
    const load = vi.fn().mockResolvedValue(1)
    const { result, unmount } = renderHook(() => useAsync(load, []))
    await act(async () => { await Promise.resolve() })
    expect(result.current.nextRefreshAt).toBe(Date.now() + 300_000)
    await act(async () => { await vi.advanceTimersByTimeAsync(299_000) })
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await result.current.refresh() })
    expect(result.current.nextRefreshAt).toBe(Date.now() + 300_000)
    await act(async () => { await vi.advanceTimersByTimeAsync(240_000) })
    expect(load).toHaveBeenCalledTimes(3)
    unmount()
  } finally { vi.useRealTimers() }
})

it('저장 뒤 refresh가 최신 데이터를 표시하고 조회 실패를 호출자에게 알린다', async () => {
  const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('offline'))
  const { result } = renderHook(() => useAsync(load, []))
  await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 1 }))
  await act(async () => { await result.current.refresh() })
  expect(result.current.state).toEqual({ status: 'success', data: 2 })
  await act(async () => { await expect(result.current.refresh()).rejects.toThrow('offline') })
  expect(result.current.state).toEqual({ status: 'success', data: 2 })
  expect(result.current.refreshError).toBeTruthy()
})

it('이전 조회가 늦게 끝나도 refresh 결과를 덮어쓰지 않는다', async () => {
  let resolveFirst!: (value: number) => void
  const first = new Promise<number>(resolve => { resolveFirst = resolve })
  const load = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(2)
  const { result } = renderHook(() => useAsync(load, []))
  await act(async () => { await result.current.refresh() })
  expect(result.current.state).toEqual({ status: 'success', data: 2 })
  await act(async () => { resolveFirst(1); await first })
  expect(result.current.state).toEqual({ status: 'success', data: 2 })
})
