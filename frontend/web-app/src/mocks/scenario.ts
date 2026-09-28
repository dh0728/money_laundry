import { ApiError, type ProblemDetail } from '@/api/common'

// 화면 검수용: 주소 뒤에 ?mock=empty 또는 ?mock=error 를 붙이면 해당 상태를 본다.
export type MockScenario = 'normal' | 'empty' | 'error'

export function currentScenario(search = globalThis.location?.search ?? ''): MockScenario {
  const value = new URLSearchParams(search).get('mock')
  return value === 'empty' || value === 'error' ? value : 'normal'
}

export const mockServerError: ProblemDetail = {
  type: 'about:blank',
  title: 'Internal Server Error',
  status: 500,
  detail: '대시보드 집계를 불러오지 못했습니다.',
  code: 'INTERNAL',
}

export const mockFailure = () => Promise.reject(new ApiError(mockServerError))
