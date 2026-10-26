// API.md §0 공통 규칙: 목록 응답, 오류 응답(RFC 9457 ProblemDetail)
import { fixture } from '@/lib/apiMode'

export type Page<T> = {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type ProblemCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INTERNAL'
  | (string & {})

export type ProblemDetail = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  code: ProblemCode
}

export class ApiError extends Error {
  readonly problem: ProblemDetail
  readonly retryAfterMs?: number

  constructor(problem: ProblemDetail, retryAfterMs?: number) {
    super(problem.detail ?? problem.title)
    this.name = 'ApiError'
    this.problem = problem
    this.retryAfterMs = retryAfterMs
  }
}

let csrf: { headerName: string; token: string } | null = null

export function clearCsrf() { csrf = null }

export function rejectFixtureWrite() {
  if (fixture) throw new ApiError({ type: 'about:blank', title: '합성 데이터 검수에서는 저장·인증 요청을 보내지 않습니다.', status: 403, code: 'FIXTURE_READ_ONLY' })
}

export async function refreshCsrf() {
  rejectFixtureWrite()
  const response = await fetch('/api/auth/csrf', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await responseError(response)
  csrf = await response.json() as { headerName: string; token: string }
  return csrf
}

export async function responseError(response: Response, notifyUnauthorized: boolean | (() => boolean) = true, signal?: AbortSignal) {
  const problem = (await response.json().catch(() => null)) as ProblemDetail | null
  if (signal?.aborted) throw signal.reason
  if (response.status === 401 && (typeof notifyUnauthorized === 'function' ? notifyUnauthorized() : notifyUnauthorized)) {
    clearCsrf()
    window.dispatchEvent(new Event('auth-expired'))
  }
  const hint = response.headers.get('Retry-After')
  const delay = hint == null ? NaN : /^\d+$/.test(hint.trim()) ? Number(hint) * 1000 : Date.parse(hint) - Date.now()
  return new ApiError({ type: 'about:blank', title: response.statusText, code: response.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL', ...problem, status: response.status }, Number.isFinite(delay) ? Math.max(0, delay) : undefined)
}

/** 시각은 서울 오프셋(+09:00)이 붙은 ISO-8601 문자열 */
export type IsoDateTime = string
/** YYYY-MM-DD */
export type IsoDate = string

/** guard: AbortSignal (frontend) or an `active()` callback (fe/work) that turns false when the view is gone. */
export async function getJson<T>(path: string, params?: Record<string, string | number | undefined>, guard?: AbortSignal | (() => boolean)): Promise<T> {
  const signal = typeof guard === 'function' ? undefined : guard
  const active = typeof guard === 'function' ? guard : () => true
  const assertActive = () => {
    if (signal?.aborted) throw signal.reason
    if (!active()) throw new DOMException('화면 이동으로 조회를 중단했습니다.', 'AbortError')
  }
  assertActive()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) query.set(key, String(value))
  }
  const url = query.size ? `${path}?${query}` : path
  if (fixture) {
    const result = (await import('@/mocks/liveFixtureApi')).fixtureGet(url) as T
    assertActive()
    return result
  }
  const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) })
  assertActive()
  if (!response.ok) {
    const error = await responseError(response, () => path !== '/api/me' && active(), signal)
    assertActive()
    throw error
  }
  const result = (await response.json()) as T
  assertActive()
  return result
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  rejectFixtureWrite()
  const token = csrf ?? await refreshCsrf()
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', [token.headerName]: token.token },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await responseError(response)
  const result = (await response.json().catch(() => undefined)) as T
  if (path.startsWith('/api/v1/')) window.dispatchEvent(new Event(path === '/api/v1/notifications/read' ? 'notifications-changed' : 'live-data-changed'))
  return result
}
