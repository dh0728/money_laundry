import { afterEach, expect, it, vi } from 'vitest'
import { locateLedgerTransaction } from './liveLedger'
afterEach(() => vi.restoreAllMocks())
const page = (ids: number[], number: number, totalPages: number) => ({ content: ids.map(txId => ({ txId })), page: number, size: 20, totalElements: totalPages * 20, totalPages })
it('부분 일치 첫 행을 열지 않고 정확한 ID의 페이지를 확인한다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(page([1101], 0, 2)))).mockResolvedValueOnce(new Response(JSON.stringify(page([101], 1, 2))))
  expect(await locateLedgerTransaction(101, { from: '2026-10-13', to: '2026-10-13', account: 'account-a' })).toEqual({ txId: 101, from: '2026-10-13', to: '2026-10-13', account: 'account-a', page: 1 })
  const urls = fetcher.mock.calls.map(([url]) => new URL(String(url), 'http://local'))
  expect(urls.map(url => url.searchParams.get('page'))).toEqual(['0', '1'])
  for (const url of urls) { expect(url.searchParams.get('query')).toBe('101'); expect(url.searchParams.get('account')).toBe('account-a'); expect(url.searchParams.get('from')).toBe('2026-10-13') }
})
it('과거 범위에 없으면 같은 인증의 현재 원장 검색으로 확인하고 잘못된 행은 선택하지 않는다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(page([], 0, 0)))).mockResolvedValueOnce(new Response(JSON.stringify(page([101], 0, 1))))
  expect(await locateLedgerTransaction(101, { account: 'old-account' })).toEqual({ txId: 101, page: 0 })
  expect(new URL(String(fetcher.mock.calls[1][0]), 'http://local').searchParams.has('account')).toBe(false)
})
it('403에서는 범위를 바꾸어 재시도하지 않고 실패를 보존한다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 403, title: '권한 없음', code: 'FORBIDDEN_ROLE' }), { status: 403 }))
  await expect(locateLedgerTransaction(101, { account: 'account-a' })).rejects.toMatchObject({ problem: { status: 403 } })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('대상을 찾지 못했거나 화면을 떠나면 다른 거래로 대체하지 않는다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(page([1101], 0, 1))))
  await expect(locateLedgerTransaction(101)).rejects.toThrow('T-101')
  fetcher.mockClear()
  await expect(locateLedgerTransaction(101, {}, () => false)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('화면 이탈 뒤 늦게 온 401은 현재 로그인 만료 이벤트를 보내지 않는다', async () => {
  const dispatched = vi.spyOn(window, 'dispatchEvent')
  let finish!: (response: Response) => void
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let active = true
  const pending = locateLedgerTransaction(101, {}, () => active)
  active = false
  finish(new Response(JSON.stringify({ title: 'expired' }), { status: 401 }))
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(dispatched.mock.calls.filter(([event]) => event.type === 'auth-expired')).toHaveLength(0)
})

it('401 본문 읽기 중 취소되어도 인증 알림을 보내지 않는다', async () => {
  const dispatched = vi.spyOn(window, 'dispatchEvent')
  let active = true
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401, json: async () => { active = false; return { title: 'expired' } } } as Response)
  await expect(locateLedgerTransaction(101, {}, () => active)).rejects.toMatchObject({ name: 'AbortError' })
  expect(dispatched.mock.calls.filter(([event]) => event.type === 'auth-expired')).toHaveLength(0)
})

it('현재 화면의 유효한 401은 기존 로그인 만료 처리를 유지한다', async () => {
  const dispatched = vi.spyOn(window, 'dispatchEvent')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ title: 'expired' }), { status: 401 }))
  await expect(locateLedgerTransaction(101)).rejects.toMatchObject({ problem: { status: 401 } })
  expect(dispatched.mock.calls.filter(([event]) => event.type === 'auth-expired')).toHaveLength(1)
})
