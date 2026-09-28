import type { Page } from '@/app/navigation'

// 전역 검색의 화면·설정 바로가기(v24 GlobalSearch.tsx). 이름은 사이드바 메뉴와 같게 둔다.
export const pageLinks: { page: Page; label: string }[] = [
  { page: 'dashboard', label: '대시보드' },
  { page: 'transactions', label: '거래 내역' },
  { page: 'alerts', label: 'Alert 목록' },
  { page: 'episodes', label: 'Episode 목록' },
  { page: 'notifications', label: '알림' },
  { page: 'settings', label: '설정' },
  { page: 'account', label: '계정' },
]

export const settingItems: { page: Page; label: string }[] = [
  { label: '테마', page: 'settings' }, { label: '시스템 설정', page: 'settings' }, { label: '라이트 모드', page: 'settings' },
  { label: '다크 모드', page: 'settings' }, { label: '시간대', page: 'settings' }, { label: '날짜 형식', page: 'settings' },
  { label: '페이지당 행', page: 'settings' }, { label: '기본 정렬', page: 'settings' }, { label: '설정 초기화', page: 'settings' },
  { label: '프로필', page: 'account' }, { label: '세션 관리', page: 'account' }, { label: '로그아웃', page: 'account' },
]
