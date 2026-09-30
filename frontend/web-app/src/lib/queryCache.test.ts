import { afterEach, expect, it, vi } from 'vitest'
import { QueryCache } from './queryCache'

it('reading a notification invalidates only notification queries', async () => {
  const cache = new QueryCache()
  const dashboard = vi.fn().mockResolvedValue(1)
  const notifications = vi.fn().mockResolvedValue(2)
  await cache.fetch('["dashboard"]', dashboard, 300_000)
  await cache.fetch('["notifications"]', notifications, 300_000)
  cache.invalidate('notifications')
  await cache.fetch('["dashboard"]', dashboard, 300_000)
  await cache.fetch('["notifications"]', notifications, 300_000)
  expect(dashboard).toHaveBeenCalledTimes(1)
  expect(notifications).toHaveBeenCalledTimes(2)
})

afterEach(() => vi.restoreAllMocks())

it('fresh results are reused and expired results stay visible during refresh', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  const cache = new QueryCache()
  const load = vi.fn().mockResolvedValue(1)
  await cache.fetch('dashboard', load, 300_000)
  await cache.fetch('dashboard', load, 300_000)
  expect(load).toHaveBeenCalledTimes(1)
  now.mockReturnValue(1_300_001)
  let finish!: (value: number) => void
  const pending = cache.fetch('dashboard', () => new Promise<number>(resolve => { finish = resolve }), 300_000)
  expect(cache.snapshot('dashboard').state).toEqual({ status: 'success', data: 1 })
  expect(cache.snapshot('dashboard').refreshing).toBe(true)
  finish(2); await pending
  expect(cache.snapshot('dashboard').state).toEqual({ status: 'success', data: 2 })
})

it('same-key requests are deduplicated; different periods never share results', async () => {
  const cache = new QueryCache()
  let finish!: (value: number) => void
  const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve }))
  const a = cache.fetch('owners/august', load, 300_000)
  const b = cache.fetch('owners/august', load, 300_000)
  await cache.fetch('owners/september', async () => 9, 300_000)
  expect(load).toHaveBeenCalledTimes(1)
  finish(8); await Promise.all([a, b])
  expect(cache.snapshot('owners/september').state).toEqual({ status: 'success', data: 9 })
})

it('mutation invalidation fences an old response and preserves clock data', async () => {
  const cache = new QueryCache()
  let finish!: (value: number) => void
  const old = cache.fetch('["cases"]', () => new Promise<number>(resolve => { finish = resolve }), 60_000)
  const clock = vi.fn().mockResolvedValue('today')
  await cache.fetch('["clock"]', clock, 300_000)
  cache.invalidate()
  await cache.fetch('["cases"]', async () => 2, 60_000)
  finish(1); await old
  await cache.fetch('["clock"]', clock, 300_000)
  expect(cache.snapshot('["cases"]').state).toEqual({ status: 'success', data: 2 })
  expect(clock).toHaveBeenCalledTimes(1)
})

it('failed refresh retains successful data and exposes a refresh error', async () => {
  const cache = new QueryCache()
  await cache.fetch('cases', async () => 1, 60_000)
  await expect(cache.fetch('cases', async () => { throw new Error('offline') }, 60_000, true)).rejects.toThrow()
  expect(cache.snapshot('cases').state).toEqual({ status: 'success', data: 1 })
  expect(cache.snapshot('cases').refreshError).toBeTruthy()
})

it('refresh keeps unchanged rows by reference and replaces only changed rows', async () => {
  const cache = new QueryCache()
  const first = { content: [{ id: 1, status: 'OPEN' }, { id: 2, status: 'OPEN' }] }
  await cache.fetch('cases', async () => first, 60_000)
  await cache.fetch('cases', async () => ({ content: [{ id: 1, status: 'OPEN' }, { id: 2, status: 'CLOSED' }] }), 60_000, true)
  const state = cache.snapshot<typeof first>('cases').state
  expect(state.status).toBe('success')
  if (state.status !== 'success') return
  expect(state.data.content[0]).toBe(first.content[0])
  expect(state.data.content[1]).not.toBe(first.content[1])
})

it('new rows at the front do not replace unchanged visible rows', async () => {
  const cache = new QueryCache()
  const oldRow = { caseId: 2, status: 'OPEN' }
  await cache.fetch('cases', async () => ({ content: [oldRow] }), 60_000)
  await cache.fetch('cases', async () => ({ content: [{ caseId: 3, status: 'OPEN' }, { caseId: 2, status: 'OPEN' }] }), 60_000, true)
  const state = cache.snapshot<{ content: typeof oldRow[] }>('cases').state
  expect(state.status).toBe('success')
  if (state.status === 'success') expect(state.data.content[1]).toBe(oldRow)
})

it('session caches are isolated and inactive results are bounded', async () => {
  const first = new QueryCache(), second = new QueryCache()
  await first.fetch('personal', async () => 'first user', 300_000)
  expect(second.snapshot('personal').state.status).toBe('loading')
  for (let i = 0; i < 65; i++) await first.fetch('case/' + i, async () => i, 60_000)
  expect(first.snapshot('personal').state.status).toBe('loading')
  expect(first.snapshot('case/64').state).toEqual({ status: 'success', data: 64 })
})
