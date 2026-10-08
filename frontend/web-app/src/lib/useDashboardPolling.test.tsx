import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/common'
import { fetchLiveDashboard, type LiveDashboard } from '@/api/liveDashboard'
import { useDashboardPolling } from './useDashboardPolling'

vi.mock('@/api/liveDashboard', () => ({ fetchLiveDashboard: vi.fn() }))
const load = vi.mocked(fetchLiveDashboard)
const value = (pending: number) => ({ personal: { pending } }) as LiveDashboard
const flush = () => act(async () => { await Promise.resolve() })
beforeEach(() => { vi.useFakeTimers(); load.mockReset(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('polls each second and a 2.4-second request skips two ticks; manual refresh shares it', async () => {
  let finish!: (v: LiveDashboard) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(value(2))
  const { result, unmount } = renderHook(() => useDashboardPolling(1, '2023-09-01', '2023-09-10'))
  await act(async () => { await vi.advanceTimersByTimeAsync(2400); void result.current.refresh() })
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => { finish(value(1)) })
  expect(result.current.state).toEqual({ status: 'success', data: value(1) })
  await act(async () => { await vi.advanceTimersByTimeAsync(600) })
  expect(load).toHaveBeenCalledTimes(2)
  unmount()
})
it('late previous-period response cannot replace the new period', async () => {
  let finish!: (v: LiveDashboard) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(value(2))
  const { result, rerender, unmount } = renderHook(({ from }) => useDashboardPolling(1, from, '2023-09-10'), { initialProps: { from: '2023-09-01' } })
  const signal = load.mock.calls[0][2]!
  rerender({ from: '2023-09-02' }); await flush()
  expect(signal.aborted).toBe(true)
  await act(async () => { finish(value(1)) })
  expect(result.current.state).toEqual({ status: 'success', data: value(2) })
  unmount()
})
it('stops in hidden or offline views and refreshes once on return', async () => {
  load.mockResolvedValue(value(1))
  const { unmount } = renderHook(() => useDashboardPolling(1, '2023-09-01', '2023-09-10')); await flush()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) }); expect(load).toHaveBeenCalledTimes(1)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); expect(load).toHaveBeenCalledTimes(2)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) }); expect(load).toHaveBeenCalledTimes(2)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  await act(async () => { window.dispatchEvent(new Event('online')) }); expect(load).toHaveBeenCalledTimes(3)
  unmount()
})
it('keeps the last success and honors retry-after even for manual refresh', async () => {
  load.mockResolvedValueOnce(value(1)).mockRejectedValueOnce(new ApiError({ type: 'about:blank', title: 'busy', status: 503, code: 'BUSY' }, 7000)).mockResolvedValue(value(3))
  const { result, unmount } = renderHook(() => useDashboardPolling(1, '2023-09-01', '2023-09-10')); await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(result.current.state).toEqual({ status: 'success', data: value(1) })
  expect(result.current.refreshError).toBeTruthy()
  await act(async () => { await result.current.refresh(); await vi.advanceTimersByTimeAsync(6000) })
  expect(load).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) }); expect(load).toHaveBeenCalledTimes(3)
  unmount()
})
it('5-second timeout aborts a stalled body and fences its later result', async () => {
  let finish!: (v: LiveDashboard) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(value(2))
  const { result, unmount } = renderHook(() => useDashboardPolling(1, '2023-09-01', '2023-09-10'))
  const signal = load.mock.calls[0][2]!
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(signal.aborted).toBe(true); expect(result.current.state.status).toBe('error')
  await act(async () => { finish(value(1)); await vi.advanceTimersByTimeAsync(2000) })
  expect(result.current.state).toEqual({ status: 'success', data: value(2) })
  unmount()
})
it('authentication rejection stops retries and strict remount can recover an aborted request', async () => {
  load.mockRejectedValue(new ApiError({ type: 'about:blank', title: 'login', status: 401, code: 'UNAUTHENTICATED' }))
  const { result, unmount } = renderHook(() => useDashboardPolling(1, '2023-09-01', '2023-09-10')); await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); await result.current.refresh() })
  expect(load).toHaveBeenCalledTimes(1); unmount()
  load.mockReset().mockResolvedValue(value(3))
  const mounted = renderHook(() => useDashboardPolling(2, '2023-09-01', '2023-09-10'), { wrapper: StrictMode }); await flush()
  expect(mounted.result.current.state).toEqual({ status: 'success', data: value(3) }); mounted.unmount()
})
