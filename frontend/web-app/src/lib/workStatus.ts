import type { AlertStatus, EpisodeStatus } from '@/api/codes'

// 화면에 보여 주는 처리 상태 (9/28 회의: Alert "검토 전·중·종결"과 Episode "조사 전·중·종결"을 한 표현으로).
// API 상태(OPEN·ESCALATED·CLOSED)와 이름을 일부러 다르게 둔다. 서버 값이 바뀌면 아래 대응만 고친다.
export type WorkStatus = 'UNSEEN' | 'PENDING' | 'IN_PROGRESS' | 'DONE'

export const workStatuses: Exclude<WorkStatus, 'UNSEEN'>[] =['PENDING', 'IN_PROGRESS', 'DONE']

// 재설계(10/11) 내 담당 업무 보드 4열. 미확인 = 안 열어 봄 / 처리 전 = 열어 봤지만 작업 없음 / 처리 중 = 작업 시작, 판정 전 / 처리 완료 = 종결
export const boardStatuses: WorkStatus[] = ['UNSEEN', 'PENDING', 'IN_PROGRESS', 'DONE']
export const boardStatusHints: Record<WorkStatus, string> = {
  UNSEEN: '배정됐지만 아직 열어 보지 않음',
  PENDING: '열어 봤지만 작업 없음',
  IN_PROGRESS: '의견 저장·거래 제외 등 작업 시작, 판정 전',
  DONE: '종결',
}

export const workStatusLabels: Record<WorkStatus, string> = {
  UNSEEN: '미확인',
  PENDING: '처리 전',
  IN_PROGRESS: '처리 중',
  DONE: '처리 완료',
}

// theme.css .semantic-status-badge[data-tone]
export const workStatusTone: Record<WorkStatus, 'unseen' | 'pending' | 'working' | 'closed'> = {
  UNSEEN: 'unseen',
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
