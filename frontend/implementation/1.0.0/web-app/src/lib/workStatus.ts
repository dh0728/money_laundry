import type { AlertStatus, EpisodeStatus } from '@/api/codes'

// 화면에 보여 주는 처리 상태 (9/28 회의: Alert "검토 전·중·종결"과 Episode "조사 전·중·종결"을 한 표현으로).
// API 상태(OPEN·ESCALATED·CLOSED)와 이름을 일부러 다르게 둔다. 서버 값이 바뀌면 아래 대응만 고친다.
export type WorkStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE'

export const workStatuses: WorkStatus[] = ['PENDING', 'IN_PROGRESS', 'DONE']

export const workStatusLabels: Record<WorkStatus, string> = {
  PENDING: '처리 전',
  IN_PROGRESS: '처리 중',
  DONE: '처리 완료',
}

// theme.css .semantic-status-badge[data-tone]
export const workStatusTone: Record<WorkStatus, 'pending' | 'working' | 'closed'> = {
  PENDING: 'pending',
  IN_PROGRESS: 'working',
  DONE: 'closed',
}

// Episode로 보낸 Alert(ESCALATED)는 Episode 조사가 끝날 때까지 처리 중이다
const alertMap: Record<AlertStatus, WorkStatus> = { OPEN: 'PENDING', ESCALATED: 'IN_PROGRESS', CLOSED: 'DONE' }
export const alertWorkStatus = (status: AlertStatus) => alertMap[status]

/** reviewRequested: 관리자 검수 넘김(FE 제안). 넘기면 조사자 쪽 처리는 끝난다. */
export const episodeWorkStatus = (status: EpisodeStatus, reviewRequested = false): WorkStatus =>
  status === 'CLOSED' || reviewRequested ? 'DONE' : 'IN_PROGRESS'
