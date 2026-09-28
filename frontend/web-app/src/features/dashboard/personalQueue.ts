import type { AlertRow } from '@/api/alerts'
import type { AlertStatus } from '@/api/codes'

export const personalSorts = {
  risk: { label: '위험 점수 높은 순', compare: (a: AlertRow, b: AlertRow) => b.riskScore - a.riskScore || b.ageDays - a.ageDays },
  age: { label: '경과일 긴 순', compare: (a: AlertRow, b: AlertRow) => b.ageDays - a.ageDays || b.riskScore - a.riskScore },
  recent: { label: '최근 탐지 순', compare: (a: AlertRow, b: AlertRow) => b.createdAt.localeCompare(a.createdAt) || b.riskScore - a.riskScore },
  amount: { label: '금액 큰 순', compare: (a: AlertRow, b: AlertRow) => b.totalAmountUsd - a.totalAmountUsd || b.riskScore - a.riskScore },
} as const
export type PersonalSort = keyof typeof personalSorts

// API 상태 3종(OPEN·ESCALATED·CLOSED)을 그대로 3열로 둔다
export const personalColumns: AlertStatus[] = ['OPEN', 'ESCALATED', 'CLOSED']

export const sortAlerts = (alerts: AlertRow[], sort: PersonalSort) => alerts.slice().sort(personalSorts[sort].compare)
