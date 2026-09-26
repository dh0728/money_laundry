import { typeDisplay } from '@/api/codes'
import type { DashboardData } from '@/api/dashboard'
import type { SectionCardItem } from '@/components/SectionCards'
import { fmt } from '@/lib/format'

type DailyFlow = { date: string; inflow: number; closed: number }

const sum = (rows: DailyFlow[], key: 'inflow' | 'closed') => rows.reduce((total, row) => total + row[key], 0)
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : undefined)
const rate = (rows: DailyFlow[]) => {
  const inflow = sum(rows, 'inflow')
  return inflow ? Math.round((sum(rows, 'closed') / inflow) * 1000) / 10 : 0
}

export function institutionCards(data: DashboardData): SectionCardItem[] {
  const days = data.dailyAlerts ?? []
  const today = days.at(-1)
  const yesterday = days.at(-2)
  const last30 = days.slice(-30)
  const prev30 = days.slice(-60, -30)
  return [
    { label: '오늘 유입 Alert', value: fmt(today?.inflow ?? 0), delta: today && yesterday ? pct(today.inflow, yesterday.inflow) : undefined, trend: '전일 대비', note: '모델이 의심으로 판별한 신규 건' },
    { label: '30일 처리율', value: `${rate(last30)}%`, delta: prev30.length ? Math.round((rate(last30) - rate(prev30)) * 10) / 10 : undefined, unit: '%p', trend: '직전 30일 대비', note: '종결 ÷ 유입' },
    { label: '미처리 Alert', value: fmt(data.alertsByStatus.OPEN), trend: '검토 전 상태', note: '종결·심층 조사로 넘기지 않은 Alert' },
    { label: '3일 이상 경과', value: fmt(data.openAlertsAgedOver3Days ?? 0), trend: '우선 처리 대상', note: '미처리 중 3일 이상 경과' },
  ]
}

export function chartInputs(data: DashboardData) {
  const composition = data.suspiciousTxComposition
  const fill = 'var(--foreground)'
  return {
    composition: composition
      ? [
          { name: '패턴 소속', value: composition.patterned, fill },
          { name: '패턴 없음 · Alert 묶음', value: composition.nonPatternGrouped, fill },
          { name: '패턴 없음 · 단일 거래', value: composition.nonPatternSingle, fill },
        ]
      : [],
    // 오른쪽은 "패턴 소속"의 하위 집합이라 코드 0(패턴 없는 이상거래)은 뺀다
    distribution: data.alertsByType
      .filter(item => item.code !== 0)
      .map(item => ({ pattern: typeDisplay(item.code).key, alerts: item.count, fill }))
      .sort((a, b) => b.alerts - a.alerts),
  }
}
