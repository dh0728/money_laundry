import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson, postJson } from './common'
import { login, logout, restoreSession } from './auth'

const user = { id: 11, username: 'reviewer', name: '오분석', role: 'STAFF' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => vi.restoreAllMocks())

describe('서버 세션', () => {
  it.each([
    null,
    { ...user, id: '11' },
    { ...user, id: 1.5 },
    { ...user, role: 'L1' },
    { ...user, name: null },
    { username: 'reviewer', role: 'STAFF' },
  ])('잘못된 200 응답을 정상 사용자로 복원하지 않는다: %j', async payload => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(payload))
    await expect(restoreSession()).rejects.toMatchObject({ problem: { status: 502, code: 'INVALID_SESSION_RESPONSE' } })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('허용된 관리자 응답만 복원하고 불필요한 서버 필드는 전달하지 않는다', async () => {
    const admin = { ...user, role: 'ADMIN' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ ...admin, internalNote: 'not-profile-data' }))
    expect(await restoreSession()).toEqual(admin)
  })

  it('로그인 HTTP 200이어도 사용자 계약이 틀리면 인증 성공으로 반환하지 않는다', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ headerName: 'X-CSRF-TOKEN', token: 'before-invalid' })).mockResolvedValueOnce(json({ ...user, role: 'UNKNOWN' }))
    await expect(login('reviewer', 'secret')).rejects.toMatchObject({ problem: { status: 502, code: 'INVALID_SESSION_RESPONSE' } })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

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
