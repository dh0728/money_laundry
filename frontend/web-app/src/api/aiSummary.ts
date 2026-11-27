import { getJson, type IsoDate, type IsoDateTime } from './common'

// AI 요약 API (API.md §14). 서버가 만든 사실 목록(F1…)을 보고 Claude 가 쓴 결론 한 줄과 근거 문장이다.

export type AiSummaryPoint = { text: string; sources: string[] }
export type AiSummaryFact = { id: string; text: string }
export type CaseAiSummary = {
  caseId: number
  kind: 'ALERT' | 'EPISODE'
  headline: string
  points: AiSummaryPoint[]
  facts: AiSummaryFact[]
  model: string
  generatedAt: IsoDateTime
}

/** 종합 위험지수의 지표 하나. 기준선이 없으면 ratio · score 가 null 이고 지수에서 빠진다. */
export type RiskIndicator = {
  key: 'suspiciousRate' | 'highRiskShare' | 'newAlerts' | 'backlog'
  label: string
  weight: number
  current: string
  baseline: string | null
  ratio: number | null
  score: number | null
}
export type RiskIndex = {
  latestTxDate: IsoDate | null
  businessDate: IsoDate
  score: number | null
  level: '낮음' | '보통' | '경계' | '높음' | '심각' | null
  indicators: RiskIndicator[]
}
/** 대시보드 요약. Claude 가 실패하면 headline 이 null 이고 points 가 비어 있다. 지수는 늘 있다. */
export type DashboardAiSummary = {
  index: RiskIndex
  headline: string | null
  points: AiSummaryPoint[]
  facts: AiSummaryFact[]
  model: string
  generatedAt: IsoDateTime
}

const live = () => import.meta.env.VITE_API_MODE === 'live'

/** 샘플 모드에는 AI 요약이 없다. 화면은 실패와 같게 기존 문장을 보여 준다. */
export const fetchCaseAiSummary = (caseId: number) =>
  live()
    ? getJson<CaseAiSummary>(`/api/v1/ai-summary/cases/${caseId}`)
    : Promise.reject(new Error('AI 요약은 서비스 모드에서만 제공합니다.'))

export const fetchDashboardAiSummary = () =>
  live()
    ? getJson<DashboardAiSummary>('/api/v1/ai-summary/dashboard')
    : Promise.reject(new Error('AI 요약은 서비스 모드에서만 제공합니다.'))
