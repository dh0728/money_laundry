import { postJson, type IsoDateTime } from './common'
import type { AiSummaryFact } from './aiSummary'

// 법정 STR 작성을 위한 분석 보고서 API (API.md §14). 저장된 보고서가 있으면 그것을, 없으면 서버가 Claude 로 만들어 저장한다.

export type AiReportSentence = { text: string; sources: string[] }
/** STR 서식 VII 의 1)~7) 과 분석 요지 */
export type AiReportNarrative = {
  overview: AiReportSentence[]
  subject: AiReportSentence[]
  dates: AiReportSentence[]
  places: AiReportSentence[]
  instruments: AiReportSentence[]
  method: AiReportSentence[]
  grounds: AiReportSentence[]
  opinion: AiReportSentence[]
}
export type AiReport = {
  reportId: number
  judgmentId: number
  caseId: number
  kind: 'ALERT' | 'EPISODE'
  status: 'GENERATED'
  facts: AiSummaryFact[]
  narrative: AiReportNarrative
  needsBankCheck: string[]
  model: string
  createdAt: IsoDateTime
}

export const fetchAiReport = (judgmentId: number, regenerate = false) =>
  postJson<AiReport>(`/api/v1/ai-reports/judgments/${judgmentId}${regenerate ? '?regenerate=true' : ''}`, {})
