import type { TypeRef } from './codes'
import { getJson, type IsoDateTime } from './common'

// API.md §3.2 관계 그래프 (Alert) · §4.1 Episode 그래프(hops=0|1). 노드 = 계좌, 엣지 = 두 계좌 사이 거래 묶음.
export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW'

export type GraphNode = {
  id: string
  kind: 'ACCOUNT' | 'BANK'
  label: string
  riskLevel: RiskLevel
  role: string
  inAmountUsd: number
  outAmountUsd: number
  txCount: number
  /** Episode hops=1: Alert 밖 1-hop 이웃 */
  outside?: boolean
}

export type GraphEdge = {
  id: string
  from: string
  to: string
  txCount: number
  totalAmountUsd: number
  maxScore: number
  primaryType: TypeRef
  direction: 'IN' | 'OUT' | 'SELF'
  firstTxAt: IsoDateTime
  lastTxAt: IsoDateTime
  outside?: boolean
}

export type RelationGraph = { nodes: GraphNode[]; edges: GraphEdge[]; truncated?: boolean }

// BE 추천대로 상세와 분리된 조회를 쓴다(API.md §3.2 [미정: FE 시각화 라이브러리 — BE 추천: 분리])
export const fetchAlertGraph = (alertId: number) => getJson<RelationGraph>(`/api/alerts/${alertId}/graph`)
export const fetchEpisodeGraph = (episodeId: number, hops: 0 | 1 = 0) => getJson<RelationGraph>(`/api/episodes/${episodeId}/graph`, { hops })
