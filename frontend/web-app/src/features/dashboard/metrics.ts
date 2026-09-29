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
    // 기관 전체는 Alert와 Episode 현황을 함께 보인다. 모든 카드 이름에 대상(Alert·Episode)을 적는다.
    { label: '오늘 유입 Alert', value: fmt(today?.inflow ?? 0), delta: today && yesterday ? pct(today.inflow, yesterday.inflow) : undefined, favorableDirection: 'down', trend: '전일 대비', note: '모델이 의심으로 판별한 신규 Alert' },
    { label: '30일 Alert 처리율', value: `${rate(last30)}%`, delta: prev30.length ? Math.round((rate(last30) - rate(prev30)) * 10) / 10 : undefined, unit: '%p', favorableDirection: 'up', trend: '직전 30일 대비', note: '처리 완료 ÷ 유입 Alert' },
    { label: '처리 전 Alert', value: fmt(data.alertsByStatus.OPEN), trend: `3일 이상 경과 ${fmt(data.openAlertsAgedOver3Days ?? 0)}건`, note: '아직 판정하지 않은 Alert' },
    { label: '조사 중 Episode', value: fmt(data.episodesByStatus.OPEN), trend: `소속 Alert ${fmt(data.alertsByStatus.ESCALATED)}건`, note: `종결 Episode ${fmt(data.episodesByStatus.CLOSED)}건` },
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
