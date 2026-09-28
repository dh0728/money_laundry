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
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as ProblemDetail | null
    throw new ApiError(
      problem ?? { type: 'about:blank', title: response.statusText, status: response.status, code: 'INTERNAL' },
    )
  }
  return (await response.json()) as T
}
