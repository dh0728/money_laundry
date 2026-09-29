// API.md §0 공통 규칙: 목록 응답, 오류 응답(RFC 9457 ProblemDetail)

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

  constructor(problem: ProblemDetail) {
    super(problem.detail ?? problem.title)
    this.name = 'ApiError'
    this.problem = problem
  }
}

let csrf: { headerName: string; token: string } | null = null

export function clearCsrf() { csrf = null }

export async function refreshCsrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await responseError(response)
  csrf = await response.json() as { headerName: string; token: string }
  return csrf
}

export async function responseError(response: Response, notifyUnauthorized = true) {
  const problem = (await response.json().catch(() => null)) as ProblemDetail | null
  if (response.status === 401 && notifyUnauthorized) {
    clearCsrf()
    window.dispatchEvent(new Event('auth-expired'))
  }
  return new ApiError({ type: 'about:blank', title: response.statusText, code: response.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL', ...problem, status: response.status })
}

/** 시각은 서울 오프셋(+09:00)이 붙은 ISO-8601 문자열 */
export type IsoDateTime = string
/** YYYY-MM-DD */
export type IsoDate = string

export async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) query.set(key, String(value))
  }
  const url = query.size ? `${path}?${query}` : path
  const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!response.ok) throw await responseError(response, path !== '/api/me')
  return (await response.json()) as T
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = csrf ?? await refreshCsrf()
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', [token.headerName]: token.token },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await responseError(response)
  const result = (await response.json().catch(() => undefined)) as T
  if (path.startsWith('/api/v1/')) window.dispatchEvent(new Event('live-data-changed'))
  return result
}
