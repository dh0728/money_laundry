// 로그인·인증 방식(API.md §5)이 정해지기 전까지 쓰는 가짜 사용자와 역할 설명.
// 9/28 회의: L1·L2 구분을 없애고 일반 조사자와 관리자 두 역할만 둔다. 역할 이름과 권한은 이 파일 한 곳에만 둔다.
// API.md는 아직 L1·L2·ADMIN이라 역할 코드는 FE 제안이다(Backend와 정리 예정).
export type Role = 'INVESTIGATOR' | 'ADMIN'

export const roleInfo: Record<Role, { label: string; can: string[]; cannot: string[] }> = {
  INVESTIGATOR: {
    label: '조사자',
    can: ['담당 Alert 조사 · 판정(정상 / 이상거래)', 'Alert를 기존 · 새 Episode로 연결', 'Episode 조사 의견 작성 · 관리자 검수 넘김'],
    cannot: ['다른 담당자의 건 판정', 'Episode 검수 · 종결(관리자)', '담당자 재배정(관리자)'],
  },
  ADMIN: {
    label: '관리자',
    can: ['Episode 검수 · 종결', '담당자 재배정', '전체 업무 조회'],
    cannot: ['Alert 판정(담당 조사자)'],
  },
}

export const MOCK_USER = {
  userId: 11,
  name: '오분석',
  role: 'INVESTIGATOR' as Role,
  organization: '금융감독원',
  email: 'reviewer@fss.or.kr',
  joinedAt: '2026. 08. 05',
}
