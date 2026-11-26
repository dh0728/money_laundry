import { getJson, type IsoDateTime } from './common'

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

/** 샘플 모드에는 AI 요약이 없다. 화면은 실패와 같게 기존 문장을 보여 준다. */
export const fetchCaseAiSummary = (caseId: number) =>
  import.meta.env.VITE_API_MODE !== 'live'
    ? Promise.reject(new Error('AI 요약은 서비스 모드에서만 제공합니다.'))
    : getJson<CaseAiSummary>(`/api/v1/ai-summary/cases/${caseId}`)
