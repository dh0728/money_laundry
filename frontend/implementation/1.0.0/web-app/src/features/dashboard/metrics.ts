import { typeDisplay } from '@/api/codes'
import type { DashboardData } from '@/api/dashboard'
import type { SectionCardItem } from '@/components/SectionCards'
import { fmt } from '@/lib/format'


export const agreementStyles = [
  { code: 'STRONG', name: '모델 의심 · 패턴 있음', fill: 'var(--foreground)' },
  { code: 'ATYPICAL', name: '모델 의심 · 패턴 없음', fill: 'var(--muted-foreground)' },
  { code: 'PATTERN_ONLY', name: '모델 정상 · 패턴 있음', fill: 'var(--chart-3)' },
  { code: 'WEAK', name: '모델 정상 · 패턴 없음', fill: 'var(--chart-4)' },
]

export function agreementComposition(rows: { agreement: string; count: number }[]) {
  const counts = new Map(rows.map(row => [row.agreement, row.count]))
  return agreementStyles.map(({ code, name, fill }) => ({ name, fill, value: counts.get(code) ?? 0 }))
}

const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : undefined)

export function institutionCards(data: DashboardData): SectionCardItem[] {
  const days = data.dailyAlerts ?? []
  const today = days.at(-1)
  const yesterday = days.at(-2)
  // mock: 수신·의심 거래 수(API.md §7 pipeline.detection)
  const received = 115270, suspicious = data.latestJob?.suspiciousTxCount ?? 0
  return [
    // 기관 전체는 Alert와 Episode 현황을 함께 보인다. 모든 카드 이름에 대상(Alert·Episode)을 적는다.
    // 재설계 S1 KPI 4개(10/11): 오늘 신규 Alert / 오늘 의심 거래 탐지율 / 열린 Alert / 조사 중 Episode
    { label: '오늘 신규 Alert', value: fmt(today?.inflow ?? 0), delta: today && yesterday ? pct(today.inflow, yesterday.inflow) : undefined, favorableDirection: 'down', trend: '전일 대비', note: '모델이 의심으로 판별한 신규 Alert' },
    { label: '오늘 의심 거래 탐지율', value: received ? `${((suspicious / received) * 100).toFixed(2)}%` : '분석 진행 중', trend: `의심 ${fmt(suspicious)}건 / 수신 ${fmt(received)}건`, note: '대상 거래일 보고가 모두 들어온 뒤 확정' },
    { label: '열린 Alert', value: fmt(data.alertsByStatus.OPEN), trend: `3일 이상 경과 ${fmt(data.openAlertsAgedOver3Days ?? 0)}건`, note: 'Episode에 묶이지 않고 종결 전인 Alert' },
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
