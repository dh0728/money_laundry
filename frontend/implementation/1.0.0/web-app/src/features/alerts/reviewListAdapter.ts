import type { ReviewCase } from '@/api/liveReview'
import { typeDisplay, type TypeCode } from '@/api/codes'
import type { AlertListRow } from './AlertList'
import type { EpisodeListRow } from '@/features/episodes/EpisodeList'

export function reviewType(name: string) {
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const code = Array.from({ length: 9 }, (_, i) => i as TypeCode).find(i => normalize(typeDisplay(i).key) === normalize(name))
  // 알 수 없는 유형을 정상/0으로 바꾸지 않는다.
  return { code: code ?? null, name: code === undefined ? name : typeDisplay(code).key }
}
const amounts = (item: ReviewCase) => {
  const value = item.summary.totalAmountUsd
  return value == null || String(value).trim() === '' || !Number.isFinite(Number(value))
    ? 'USD 환산액 미제공'
    : `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} USD`
}
export function alertListRow(item: ReviewCase): AlertListRow {
  if (item.alertId == null) throw new Error('Alert 원본 ID가 없습니다.')
  return {
    alertId: item.alertId, riskScore: item.summary.riskScore, primaryType: reviewType(item.summary.primaryType),
    txCount: item.summary.txCount, assignee: { userId: item.assigneeId, name: item.assigneeName },
    status: item.episodeId != null ? 'ESCALATED' : item.status, createdAt: item.createdAt, ageDays: item.ageDays,
    episodeId: item.episodeId,
    amountLabel: amounts(item),
  }
}
export function episodeListRow(item: ReviewCase): EpisodeListRow {
  return {
    episodeId: item.caseId, riskScore: item.summary.riskScore, alertCount: item.sourceAlertIds.length,
    txCount: item.summary.txCount, primaryTypes: item.primaryTypes.map(reviewType), amountLabel: amounts(item),
    assignee: { userId: item.assigneeId, name: item.assigneeName }, status: item.status,
    createdAt: item.createdAt, ageDays: item.ageDays,
  }
}
