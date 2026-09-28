import type { AlertRow } from '@/api/alerts'
import type { AlertStatus, TypeCode } from '@/api/codes'
import type { Page } from '@/api/common'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

const NAMES = ['NORMAL', 'FAN-OUT', 'FAN-IN', 'G-SCATTER', 'S-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK']
const statuses: AlertStatus[] = ['OPEN', 'OPEN', 'OPEN', 'ESCALATED', 'CLOSED']

// 목록 화면 검수용 다른 담당자. API.md §3.4 라운드로빈이라 한 사람에게만 몰리지 않는다.
const TEAMMATES = [{ userId: 12, name: '한검토' }, { userId: 13, name: '윤조사' }]

function alertRow(i: number, assignee = { userId: 11, name: '오분석' }): AlertRow {
  const code = (i % 9) as TypeCode
  const status = statuses[i % statuses.length]
  const accountCount = 3 + (i % 6)
  const bankCount = 1 + (i % 3)
  const totalAmountUsd = 18_000 + ((i * 7919) % 240_000)
  const ageDays = i % 6
  const created = new Date('2026-09-26T09:00:00+09:00')
  created.setDate(created.getDate() - ageDays)
  const createdAt = created.toISOString().replace('Z', '+00:00')
  const riskScore = Math.round((0.99 - (i % 17) * 0.021) * 100) / 100
  return {
    alertId: 3000 + i,
    riskScore,
    summary: `${NAMES[code]} · 계좌 ${accountCount} · 은행 ${bankCount} · ${1 + (i % 4)}일 · 총 USD ${Math.round(totalAmountUsd / 1000)}K`,
    primaryType: { code, name: NAMES[code] },
    subjectAccount: { bank: 10 + (i % 5), account: `acc-${(4200 + i).toString(16)}` },
    accountCount,
    bankCount,
    txCount: 4 + (i % 11),
    totalAmountUsd,
    amountsByCurrency: [{ currency: 'USD', total: totalAmountUsd }],
    scoreStats: { mean: Math.round((riskScore - 0.08) * 100) / 100, max: riskScore, aboveRatio: 0.5 + (i % 5) / 10 },
    weightedAmountUsd: Math.round(totalAmountUsd * riskScore),
    typeEntropy: Math.round(((i % 7) / 10) * 100) / 100,
    firstTxAt: createdAt,
    lastTxAt: createdAt,
    banks: Array.from({ length: bankCount }, (_, b) => 10 + ((i + b) % 5)),
    status,
    resolution: status === 'CLOSED' ? (i % 2 ? 'NORMAL' : 'FALSE_POSITIVE') : null,
    assignee,
    assignedAt: createdAt,
    // 심층 조사 Alert 2~3건씩 Episode 800·801·802로 묶는다
    episodeId: status === 'ESCALATED' ? 800 + (i % 3) : null,
    analysisDate: createdAt.slice(0, 10),
    createdAt,
    ageDays,
  }
}

export const myAlertsNormal: Page<AlertRow> = (() => {
  const content = Array.from({ length: 24 }, (_, i) => alertRow(i))
  return { content, page: 0, size: 200, totalElements: content.length, totalPages: 1 }
})()

export const myAlertsEmpty: Page<AlertRow> = { content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 }

export function loadMockMyAlerts(scenario: MockScenario = currentScenario()): Promise<Page<AlertRow>> {
  if (scenario === 'error') return mockFailure()
  return Promise.resolve(scenario === 'empty' ? myAlertsEmpty : myAlertsNormal)
}

// Alert 목록(전 담당자). 앞 24건은 내 담당(대시보드와 같은 행), 뒤 12건은 다른 담당자.
export const allAlertsNormal: Page<AlertRow> = (() => {
  const others = Array.from({ length: 12 }, (_, j) => alertRow(24 + j, TEAMMATES[j % TEAMMATES.length]))
  const content = [...myAlertsNormal.content, ...others]
  return { content, page: 0, size: 200, totalElements: content.length, totalPages: 1 }
})()

export function loadMockAlerts(scenario: MockScenario = currentScenario()): Promise<Page<AlertRow>> {
  if (scenario === 'error') return mockFailure('Alert 목록을 불러오지 못했습니다.')
  return Promise.resolve(scenario === 'empty' ? myAlertsEmpty : allAlertsNormal)
}
