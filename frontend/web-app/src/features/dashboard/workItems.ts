import type { AlertRow } from '@/api/alerts'
import type { TypeCode } from '@/api/codes'
import type { EpisodeRow } from '@/api/episodes'
import { hrefFor } from '@/app/navigation'
import { usd } from '@/lib/format'
import type { WorkStatus } from '@/lib/workStatus'

// 대시보드 "업무 현황"은 Alert와 Episode를 한 보드에 둔다(9/28: 한 조사자가 판정과 Episode 생성을 이어서 한다).
//   처리 전   = 판정 전 Alert(OPEN)
//   처리 중   = 조사 중인 내 Episode. Episode로 보낸 Alert(ESCALATED)는 그 Episode 카드 하나로 보여 중복을 없앤다.
//   처리 완료 = 판정이 끝난 Alert(CLOSED), 관리자 검수를 넘기거나 종결한 Episode
export type WorkItem = {
  kind: 'Alert' | 'Episode'
  id: number
  code: string
  href: string
  status: WorkStatus
  riskScore: number
  ageDays: number
  createdAt: string
  totalAmountUsd: number
  types: TypeCode[]
  /** 태그로 나타내지 않는 짧은 요약(개수·금액) */
  summary: string
}

export function alertWorkItem(alert: AlertRow): WorkItem | null {
  if (alert.status === 'ESCALATED') return null
  return {
    kind: 'Alert', id: alert.alertId, code: `A-${alert.alertId}`, href: hrefFor('alerts', alert.alertId),
    status: alert.status === 'OPEN' ? 'PENDING' : 'DONE',
    riskScore: alert.riskScore, ageDays: alert.ageDays, createdAt: alert.createdAt, totalAmountUsd: alert.totalAmountUsd,
    types: [alert.primaryType.code],
    summary: `계좌 ${alert.accountCount} · 은행 ${alert.bankCount} · ${usd(alert.totalAmountUsd)}`,
  }
}

export function episodeWorkItem(episode: EpisodeRow): WorkItem {
  return {
    kind: 'Episode', id: episode.episodeId, code: `E-${episode.episodeId}`, href: hrefFor('episodes', episode.episodeId),
    status: episode.status === 'CLOSED' || episode.reviewRequestedAt ? 'DONE' : 'IN_PROGRESS',
    riskScore: episode.riskScore, ageDays: episode.ageDays, createdAt: episode.createdAt, totalAmountUsd: episode.totalAmountUsd,
    types: episode.primaryTypes.map(type => type.code),
    summary: `Alert ${episode.alertCount} · 거래 ${episode.txCount} · ${usd(episode.totalAmountUsd)}`,
  }
}

export const workItems = (alerts: AlertRow[], episodes: EpisodeRow[]) => [
  ...alerts.flatMap(alert => alertWorkItem(alert) ?? []),
  ...episodes.map(episodeWorkItem),
]

export const workSorts = {
  risk: { label: '위험 점수 높은 순', compare: (a: WorkItem, b: WorkItem) => b.riskScore - a.riskScore || b.ageDays - a.ageDays },
  age: { label: '경과일 긴 순', compare: (a: WorkItem, b: WorkItem) => b.ageDays - a.ageDays || b.riskScore - a.riskScore },
  recent: { label: '최근 탐지 순', compare: (a: WorkItem, b: WorkItem) => b.createdAt.localeCompare(a.createdAt) || b.riskScore - a.riskScore },
  amount: { label: '금액 큰 순', compare: (a: WorkItem, b: WorkItem) => b.totalAmountUsd - a.totalAmountUsd || b.riskScore - a.riskScore },
} as const
export type WorkSort = keyof typeof workSorts

export const sortWork = (items: WorkItem[], sort: WorkSort) => items.slice().sort(workSorts[sort].compare)

/** 오래 머문 업무 기준(일) */
export const STALE_DAYS = 3
