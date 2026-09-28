import { createContext, useContext } from 'react'
import type { SessionUser } from '@/api/auth'

export type Role = SessionUser['role']

export const roleInfo: Record<Role, { label: string; can: string[]; cannot: string[] }> = {
  STAFF: {
    label: '조사자',
    can: ['담당 Alert 조사 · 판정(정상 / 이상거래)', 'Alert를 기존 · 새 Episode로 연결', 'Episode 조사 의견 작성 · 관리자 검수 넘김'],
    cannot: ['다른 담당자의 건 판정', '종결된 건 수정', '관리자 전용 시연 조작'],
  },
  ADMIN: {
    label: '관리자',
    can: ['전체 업무 조회', '업무 시각 변경 · 분석 관리'],
    cannot: ['다른 직원의 사건 수정', '담당자 재배정'],
  },
}

export const MOCK_USER = {
  userId: 11,
  name: '오분석',
  role: 'STAFF' as Role,
  organization: '금융감독원',
  email: 'reviewer@fss.or.kr',
  joinedAt: '2026. 08. 05',
}

export type CurrentUser = typeof MOCK_USER & { username?: string }
export const CurrentUserContext = createContext<CurrentUser>(MOCK_USER)
export const useCurrentUser = () => useContext(CurrentUserContext)
export const canEditOpen = (user: CurrentUser, assigneeId: number, status: string) => user.role === 'STAFF' && user.userId === assigneeId && status === 'OPEN'
