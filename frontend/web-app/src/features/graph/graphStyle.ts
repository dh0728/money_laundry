import type { GraphEdge, GraphNode } from '@/api/graph'

// API 그래프 값을 v24 그래프의 의심 2색(빨강 / 무채색)으로 나누는 기준

/** 의심 거래 임계. mock 점수(launderingScore) 기준이며 실제 값은 BE의 threshold_value를 따른다. */
export const SUSPICIOUS_SCORE = 0.5

export const isSuspiciousEdge = (e: Pick<GraphEdge, 'maxScore'>) => e.maxScore >= SUSPICIOUS_SCORE
/** API.md §3.2 riskLevel(기본 경계 0.9/0.7) 중 HIGH·MEDIUM */
export const isSuspiciousNode = (n: Pick<GraphNode, 'riskLevel'>) => n.riskLevel !== 'LOW'
