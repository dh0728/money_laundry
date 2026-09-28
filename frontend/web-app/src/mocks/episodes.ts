import type { AlertRow } from '@/api/alerts'
import type { TypeRef } from '@/api/codes'
import { ApiError, type Page } from '@/api/common'
import type { EpisodeDetail, EpisodeRow, EpisodeTransaction } from '@/api/episodes'
import { detailOf } from './alertDetail'
import { allAlertsNormal } from './alerts'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

// Episode는 심층 조사(ESCALATED) Alert의 episodeId로 묶어 만든다. 목록·상세·거래가 같은 Alert에서 나오므로 서로 맞는다.
// alerts를 넘기면(mock에서 방금 연결·생성한 결과를 반영한 Alert) 그것으로 계산한다.
function groupsOf(alerts: AlertRow[]) {
  const map = new Map<number, AlertRow[]>()
  for (const row of alerts) if (row.episodeId != null) map.set(row.episodeId, [...(map.get(row.episodeId) ?? []), row])
  return map
}

const unique = (types: TypeRef[]) => [...new Map(types.map(t => [t.code, t])).values()]

function episodeRow(episodeId: number, alerts: AlertRow[]): EpisodeRow {
  const first = [...alerts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  const totalAmountUsd = alerts.reduce((s, a) => s + a.totalAmountUsd, 0)
  // 9/28 회의: 한 조사자가 Alert 판정과 Episode 생성을 이어서 한다. 그래서 담당자 = 만든 사람.
  const creator = first.assignee
  return {
    episodeId,
    riskScore: Math.max(...alerts.map(a => a.riskScore)),
    alertCount: alerts.length,
    txCount: alerts.reduce((s, a) => s + a.txCount, 0),
    totalAmountUsd,
    amountsByCurrency: [{ currency: 'USD', total: totalAmountUsd }],
    primaryTypes: unique(alerts.map(a => a.primaryType)),
    assignee: creator,
    status: 'OPEN',
    resolution: null,
    createdBy: creator,
    createdAt: first.lastTxAt,
    updatedAt: first.lastTxAt,
    closedAt: null,
    ageDays: Math.min(...alerts.map(a => a.ageDays)),
    reviewRequestedAt: episodeId === 802 ? first.lastTxAt : null,
  }
}

const pageOf = (alerts: AlertRow[]): Page<EpisodeRow> => {
  const content = [...groupsOf(alerts)].map(([id, members]) => episodeRow(id, members))
  return { content, page: 0, size: 200, totalElements: content.length, totalPages: 1 }
}
export const episodesNormal = pageOf(allAlertsNormal.content)
export const episodesEmpty: Page<EpisodeRow> = { content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 }

export function loadMockEpisodes(alerts = allAlertsNormal.content, scenario: MockScenario = currentScenario()): Promise<Page<EpisodeRow>> {
  if (scenario === 'error') return mockFailure('Episode 목록을 불러오지 못했습니다.')
  return Promise.resolve(scenario === 'empty' ? episodesEmpty : pageOf(alerts))
}

function transactionsOf(alerts: AlertRow[]): EpisodeTransaction[] {
  return alerts.flatMap(a => detailOf(a).transactions.map(t => ({ ...t, alertId: a.alertId })))
}

function detailOfEpisode(episodeId: number, alerts: AlertRow[]): EpisodeDetail {
  const row = episodeRow(episodeId, alerts)
  const tx = transactionsOf(alerts)
  const subject = [...alerts].sort((a, b) => b.riskScore - a.riskScore)[0].subjectAccount
  const inflow = tx.filter(t => t.toAccount === subject.account)
  const outflow = tx.filter(t => t.fromAccount === subject.account)
  const sum = (list: EpisodeTransaction[]) => list.reduce((s, t) => s + t.amountUsd, 0)
  const times = tx.map(t => t.txAt).sort()
  const system = { userId: 0, name: '시스템', role: 'SYSTEM' }
  const person = { ...row.createdBy, role: 'INVESTIGATOR' }
  const base = { targetType: 'EPISODE' as const, targetId: episodeId, from: null, to: 'OPEN', resolution: null }
  return {
    ...row,
    alerts,
    history: [
      ...alerts.slice(1).map((a, i) => ({ ...base, id: 10 + i, actor: person, action: 'LINK' as const, relatedIds: [episodeId, a.alertId], comment: '같은 대표 계좌 흐름이라 연결함.', at: a.lastTxAt })),
      { ...base, id: 2, actor: system, action: 'ASSIGN' as const, relatedIds: [row.assignee.userId], comment: null, at: row.createdAt },
      { ...base, id: 1, actor: person, action: 'EPISODE_CREATE' as const, relatedIds: [alerts[0].alertId], comment: '여러 Alert에 같은 소유주 흐름이 보여 Episode로 묶음.', at: row.createdAt },
    ],
    flow: {
      periodFrom: times[0], periodTo: times[times.length - 1],
      inflowUsd: sum(inflow), inflowCount: inflow.length, outflowUsd: sum(outflow), outflowCount: outflow.length,
      netRetainedUsd: sum(inflow) - sum(outflow), passThroughRatio: sum(inflow) ? Math.round((sum(outflow) / sum(inflow)) * 100) / 100 : 0,
      medianDwellHours: 9, txCount: tx.length,
    },
    patternEvidence: alerts.map(a => ({
      alertId: a.alertId, typeClass: a.primaryType.code, typeName: a.primaryType.name,
      checks: [
        { key: 'DISTINCT_COUNTERPARTIES', label: '상대 계좌 수', passed: a.accountCount >= 4, value: `${a.accountCount - 1}개` },
        { key: 'TIME_SPAN_DAYS', label: '거래 기간', passed: true, value: '3일 이내' },
        { key: 'ROUND_AMOUNTS', label: '1,000 단위 금액 반복', passed: a.alertId % 2 === 0, value: a.alertId % 2 === 0 ? '2건' : '0건' },
      ],
    })),
    accountHistory: [{
      account: subject.account, bank: subject.bank,
      alerts: alerts.map(a => ({ alertId: a.alertId, status: a.status, resolution: a.resolution, episodeId: a.episodeId, createdAt: a.createdAt })),
    }],
  }
}

const notFound = (episodeId: number) => new ApiError({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND', detail: `E-${episodeId} Episode를 찾을 수 없습니다.` })

export function loadMockEpisode(episodeId: number, alerts = allAlertsNormal.content, scenario: MockScenario = currentScenario()) {
  if (scenario === 'error') return mockFailure('Episode 상세를 불러오지 못했습니다.')
  const members = scenario === 'empty' ? [] : groupsOf(alerts).get(episodeId) ?? []
  if (!members.length) return Promise.reject(notFound(episodeId))
  return Promise.resolve({ detail: detailOfEpisode(episodeId, members), transactions: transactionsOf(members) })
}
