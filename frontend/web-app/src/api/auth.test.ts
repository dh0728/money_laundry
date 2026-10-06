import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson, postJson } from './common'
import { login, logout, restoreSession } from './auth'

const user = { id: 11, username: 'reviewer', name: '오분석', role: 'STAFF' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => vi.restoreAllMocks())

describe('서버 세션', () => {
  it('로그인 전후 CSRF를 받고 양식 본문과 쿠키를 보낸다', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ headerName: 'X-CSRF-TOKEN', token: 'before' })).mockResolvedValueOnce(json(user)).mockResolvedValueOnce(json({ headerName: 'X-CSRF-TOKEN', token: 'after' })).mockResolvedValueOnce(json({ ok: true }))
    expect(await login('reviewer', 'secret')).toEqual(user)
    const [, options] = fetcher.mock.calls[1]
    expect(options).toMatchObject({ method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-TOKEN': 'before' }) })
    expect(options?.body).toBe('username=reviewer&password=secret')
    await postJson('/api/test', {})
    expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({ 'X-CSRF-TOKEN': 'after' })
  })

  it('복원은 /api/me를 읽고 401은 로그인 필요로 처리한다', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(user)).mockResolvedValueOnce(json({ code: 'UNAUTHENTICATED' }, 401))
    expect(await restoreSession()).toEqual(user)
    await expect(getJson('/api/test')).rejects.toMatchObject({ problem: { status: 401 } })
    expect(fetcher.mock.calls[0][0]).toBe('/api/me')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('업무 요청의 401은 세션 만료를 알린다', async () => {
    const expired = vi.fn()
    window.addEventListener('auth-expired', expired, { once: true })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ code: 'UNAUTHENTICATED' }, 401))
    await expect(getJson('/api/alerts')).rejects.toMatchObject({ problem: { status: 401 } })
    expect(expired).toHaveBeenCalledOnce()
  })

  it('로그아웃은 현재 CSRF로 요청한다', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ headerName: 'X-CSRF-TOKEN', token: 'bye' })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await logout()
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include', headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'bye' }) })
  })
})
