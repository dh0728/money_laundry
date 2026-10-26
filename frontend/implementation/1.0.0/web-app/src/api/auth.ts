import { clearCsrf, getJson, refreshCsrf, responseError } from './common'

export type SessionUser = { id: number; username: string; name: string; role: 'STAFF' | 'ADMIN' }

export const restoreSession = () => getJson<SessionUser>('/api/me')

export async function login(username: string, password: string): Promise<SessionUser> {
  const csrf = await refreshCsrf()
  const response = await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', [csrf.headerName]: csrf.token },
    body: new URLSearchParams({ username, password }).toString(),
  })
  if (!response.ok) throw await responseError(response, false)
  const user = await response.json() as SessionUser
  clearCsrf()
  await refreshCsrf()
  return user
}

export async function logout() {
  const csrf = await refreshCsrf()
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { [csrf.headerName]: csrf.token } })
  if (!response.ok) throw await responseError(response)
  clearCsrf()
}
