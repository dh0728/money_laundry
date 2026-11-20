import { z } from 'zod'
import { ApiError, clearCsrf, getJson, rejectFixtureWrite, refreshCsrf, responseError } from './common'

const sessionUserSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  username: z.string(), name: z.string(), role: z.enum(['STAFF', 'ADMIN']),
})
export type SessionUser = z.infer<typeof sessionUserSchema>

function parseSessionUser(value: unknown): SessionUser {
  const parsed = sessionUserSchema.safeParse(value)
  if (!parsed.success) throw new ApiError({ type: 'about:blank', title: '로그인 사용자 정보를 확인할 수 없습니다.', status: 502, code: 'INVALID_SESSION_RESPONSE' })
  return parsed.data
}
export const restoreSession = async () => parseSessionUser(await getJson<unknown>('/api/me'))

export async function login(username: string, password: string): Promise<SessionUser> {
  rejectFixtureWrite()
  const csrf = await refreshCsrf()
  const response = await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', [csrf.headerName]: csrf.token },
    body: new URLSearchParams({ username, password }).toString(),
  })
  if (!response.ok) throw await responseError(response, false)
  clearCsrf()
  const user = parseSessionUser(await response.json())
  await refreshCsrf()
  return user
}

export async function logout() {
  rejectFixtureWrite()
  const csrf = await refreshCsrf()
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { [csrf.headerName]: csrf.token } })
  if (!response.ok) throw await responseError(response)
  clearCsrf()
}
