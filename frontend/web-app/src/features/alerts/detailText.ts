import type { HistoryAction } from '@/api/alerts'

// Alert·Episode 상세가 같이 쓰는 카드 모양과 이력 문구
export const card = 'h-full gap-4 py-4 shadow-none'
export const content = 'h-full px-4 [&>div:first-child]:mb-4'

export const historyLabels: Record<HistoryAction, string> = {
  REVIEW_START: '검토 시작', CLOSE: '종결', ESCALATE: 'Episode 생성', LINK: 'Episode 연결', UNLINK: 'Episode 연결 해제',
  ASSIGN: '담당자 배정', COMMENT: '의견', EPISODE_CREATE: 'Episode 생성', EPISODE_CLOSE: 'Episode 종결', REVIEW_REQUEST: '관리자 검수 요청', TX_RELABEL: '거래 판정 전환',
}
