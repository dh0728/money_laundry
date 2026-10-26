import type { AlertAccount, AlertAccountRole, AlertDetail, AlertRow, AlertTransaction, HistoryRow } from '@/api/alerts'
import { ApiError } from '@/api/common'
import { allAlertsNormal } from './alerts'
import { graphOf } from './graph'
import type { RelationGraph } from '@/api/graph'
import { seoulIso } from './time'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

// 소유주 이름은 예시이며 FE 제안 필드(fromOwnerName·toOwnerName)에만 쓴다.
const OWNERS = ['해오름무역', '김세탁', '바다물류', '박환전', '새벽상사', '이송금', '한강홀딩스', '최분산']
const FORMATS = ['Wire', 'ACH', 'Cheque', 'Cash', 'Bitcoin']
const REASONS = ['SEED_SCORE', 'SAME_ACCOUNT', 'WITHIN_2_DAYS', 'PATH_HOP']

export function detailOf(row: AlertRow): AlertDetail {
  const subject = row.subjectAccount.account
  const others = Array.from({ length: row.accountCount - 1 }, (_, k) => `acc-${(0x5000 + row.alertId * 7 + k).toString(16)}`)
  const accounts = [subject, ...others]
  const bankOf = (account: string) => row.banks[accounts.indexOf(account) % row.banks.length]
  const ownerOf = (account: string) => OWNERS[(accounts.indexOf(account) + row.alertId) % OWNERS.length]
  const start = new Date(row.createdAt).getTime() - 3 * 86_400_000
  const share = Math.round(row.totalAmountUsd / row.txCount)
  const secondType = (row.primaryType.code + 4) % 9
  const thirdType = (row.primaryType.code + 6) % 9

  const transactions: AlertTransaction[] = Array.from({ length: row.txCount }, (_, i) => {
    // 대표 계좌로 모였다가 다른 계좌로 흩어지는 모양. 앞쪽 상대 계좌는 보내기만, 뒤쪽은 받기만 한다.
    // (같은 계좌가 주고받기를 모두 하면 순환이 과하게 많아진다)
    const inbound = i % 2 === 0
    const half = Math.max(1, Math.ceil(others.length / 2))
    const pool = inbound ? others.slice(0, half) : others.slice(half).length ? others.slice(half) : others
    const other = pool[Math.floor(i / 2) % pool.length]
    const from = inbound ? other : subject
    const to = inbound ? subject : other
    const amountUsd = share + ((i * 431) % 900) - 450
    // 임계(0.5) 이상이면 의심 거래. 세 건 중 한 건은 임계 아래의 연결 거래다.
    const suspicious = i % 3 !== 2
    const score = suspicious ? Math.max(0.5, Math.round((row.scoreStats.max - (i % 5) * 0.04) * 100) / 100) : Math.round((0.2 + (i % 4) * 0.06) * 100) / 100
    const topScore = 0.6 + (i % 4) / 10
    return {
      txId: row.alertId * 100 + i,
      txAt: seoulIso(start + i * 9 * 3_600_000),
      fromBank: bankOf(from), fromAccount: from, toBank: bankOf(to), toAccount: to,
      amountReceived: amountUsd, receivingCurrency: 'USD', amountPaid: amountUsd, paymentCurrency: 'USD', amountUsd,
      paymentFormat: FORMATS[(i + row.alertId) % FORMATS.length],
      launderingScore: score, scorePercentile: Math.round(score * 1000) / 10, thresholdRatio: Math.round((score / 0.5) * 100) / 100,
      isSuspicious: suspicious,
      typeClass: row.primaryType.code, typeName: row.primaryType.name, typeScore: topScore,
      typeProbabilities: { [row.primaryType.code]: topScore, [secondType]: (1 - topScore) * 0.7, [thirdType]: (1 - topScore) * 0.3 },
      role: i === 0 ? 'SEED' : 'SUPPORTING', includedReason: REASONS[i % REASONS.length],
      direction: inbound ? 'IN' : 'OUT',
      fromOwnerName: ownerOf(from), toOwnerName: ownerOf(to),
    }
  })

  const accountRows: AlertAccount[] = accounts.map(account => {
    const incoming = transactions.filter(t => t.toAccount === account)
    const outgoing = transactions.filter(t => t.fromAccount === account)
    const role: AlertAccountRole = account === subject ? 'SUBJECT' : incoming.length && outgoing.length ? 'INTERMEDIARY' : incoming.length ? 'DESTINATION' : 'SOURCE'
    return {
      account, bank: bankOf(account), role,
      inCount: incoming.length, inAmountUsd: incoming.reduce((s, t) => s + t.amountUsd, 0),
      outCount: outgoing.length, outAmountUsd: outgoing.reduce((s, t) => s + t.amountUsd, 0),
      maxScore: Math.max(0, ...[...incoming, ...outgoing].map(t => t.launderingScore)),
      counterpartyCount: new Set([...incoming.map(t => t.fromAccount), ...outgoing.map(t => t.toAccount)]).size,
      firstSeenAt: '2025-11-02T09:00:00+09:00',
    }
  })

  return {
    ...row,
    transactions,
    typeDistribution: { [row.primaryType.code]: 0.7, [secondType]: 0.3 },
    accounts: accountRows,
    scoreTimeline: transactions.map(t => ({ txAt: t.txAt, score: t.launderingScore })),
    groupingBasis: [{ basis: 'ACCOUNT', value: subject }, { basis: 'TIME', value: '2일 이내 연속 거래' }],
  }
}

function historyOf(row: AlertRow): HistoryRow[] {
  const base = { targetType: 'ALERT' as const, targetId: row.alertId, relatedIds: [], resolution: null, comment: null }
  const system = { userId: 0, name: '시스템', role: 'SYSTEM' }
  const person = { ...row.assignee, role: 'INVESTIGATOR' }
  const rows: HistoryRow[] = [
    { ...base, id: 1, actor: system, action: 'ASSIGN', from: null, to: 'OPEN', at: row.assignedAt, relatedIds: [row.assignee.userId] },
    { ...base, id: 2, actor: person, action: 'REVIEW_START', from: 'OPEN', to: 'OPEN', at: row.assignedAt },
  ]
  if (row.status === 'CLOSED') rows.push({ ...base, id: 3, actor: person, action: 'CLOSE', from: 'OPEN', to: 'CLOSED', resolution: row.resolution, comment: '거래 목적과 계좌 관계를 대조해 판단함.', at: row.lastTxAt })
  if (row.status === 'ESCALATED') rows.push({ ...base, id: 3, actor: person, action: 'ESCALATE', from: 'OPEN', to: 'ESCALATED', relatedIds: [row.episodeId ?? 0], comment: '같은 계좌 흐름이 이어져 Episode로 묶음.', at: row.lastTxAt })
  return rows.reverse()
}

const notFound = (alertId: number) => new ApiError({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND', detail: `A-${alertId} Alert를 찾을 수 없습니다.` })

export function loadMockAlertDetail(alertId: number, scenario: MockScenario = currentScenario()): Promise<{ detail: AlertDetail; history: HistoryRow[]; graph: RelationGraph }> {
  if (scenario === 'error') return mockFailure('Alert 상세를 불러오지 못했습니다.')
  const row = scenario === 'empty' ? undefined : allAlertsNormal.content.find(r => r.alertId === alertId)
  if (!row) return Promise.reject(notFound(alertId))
  const detail = detailOf(row)
  return Promise.resolve({ detail, history: historyOf(row), graph: graphOf(detail.transactions, detail.accounts, detail.subjectAccount.account) })
}
