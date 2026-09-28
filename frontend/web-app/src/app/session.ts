// 로그인·인증 방식(API.md §5)이 정해지기 전까지 쓰는 가짜 사용자와 역할 설명.
// L1·L2 이름과 권한은 팀 논의 중이라 이 파일 한 곳에만 둔다.
export type Role = 'L1' | 'L2'

export const roleInfo: Record<Role, { label: string; can: string[]; cannot: string[] }> = {
  L1: {
    label: 'L1',
    can: ['담당 Alert 검토 · 의견 저장', '담당 Alert 종결(정상 판단 · 오탐)', 'Alert를 기존 · 새 Episode로 연결'],
    cannot: ['다른 담당자의 건 종결', 'Episode 조사 종결 · 보고 대상 확정(L2)', '담당자 재배정(관리자)'],
  },
  L2: {
    label: 'L2',
    can: ['담당 Episode 조사 · 종결', '의심 거래 보고 대상 확정', '상위 검토 요청'],
    cannot: ['다른 담당자의 건 처리', '담당자 재배정(관리자)'],
  },
}

export const MOCK_USER = {
  userId: 11,
  name: '오분석',
  role: 'L1' as Role,
  organization: '금융감독원',
  email: 'reviewer@fss.or.kr',
  joinedAt: '2026. 08. 05',
}
