import type { AlertRow, AlertTransaction, HistoryRow } from './alerts'
import type { EpisodeResolution, EpisodeStatus, TypeCode, TypeRef } from './codes'
import { getJson, postJson, type IsoDateTime, type Page } from './common'

type User = { userId: number; name: string }

// API.md §4.1 GET /api/episodes 행
export type EpisodeRow = {
  episodeId: number
  riskScore: number
  alertCount: number
  txCount: number
  totalAmountUsd: number
  amountsByCurrency: { currency: string; total: number }[]
  primaryTypes: TypeRef[]
  assignee: User
  status: EpisodeStatus
  resolution: EpisodeResolution | null
  createdBy: User
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  closedAt: IsoDateTime | null
  ageDays: number
  /**
   * FE 제안: API.md에 없음. 9/28 회의에서 Episode는 생성 뒤 관리자에게 검수를 넘기는 기능만 두기로 했다.
   * 넘긴 시각이 있으면 "검수 요청됨"으로 보여 준다.
   */
  reviewRequestedAt?: IsoDateTime | null
}

export type PatternCheck = { key: string; label: string; passed: boolean; value: string }

// API.md §4.1 GET /api/episodes/{id}. 조사 블록 6종 중 flow·patternEvidence·accountHistory만 먼저 쓴다.
export type EpisodeDetail = EpisodeRow & {
  alerts: AlertRow[]
  history: HistoryRow[]
  flow: {
    periodFrom: IsoDateTime; periodTo: IsoDateTime
    inflowUsd: number; inflowCount: number; outflowUsd: number; outflowCount: number
    netRetainedUsd: number; passThroughRatio: number; medianDwellHours: number; txCount: number
  }
  patternEvidence: { alertId: number; typeClass: TypeCode; typeName: string; checks: PatternCheck[] }[]
  accountHistory: { account: string; bank: number; alerts: { alertId: number; status: AlertRow['status']; resolution: AlertRow['resolution']; episodeId: number | null; createdAt: IsoDateTime }[] }[]
}

/** API.md §4.1 GET /api/episodes/{id}/transactions 행: 거래 행 + 출처 Alert */
export type EpisodeTransaction = AlertTransaction & { alertId: number }

export type EpisodeQuery = { page?: number; size?: number; status?: EpisodeStatus; assigneeId?: number | 'me' }

export const fetchEpisodes = (query: EpisodeQuery = {}) => getJson<Page<EpisodeRow>>('/api/episodes', query)
export const fetchEpisode = (episodeId: number) => getJson<EpisodeDetail>(`/api/episodes/${episodeId}`)
export const fetchEpisodeTransactions = (episodeId: number) => getJson<Page<EpisodeTransaction>>(`/api/episodes/${episodeId}/transactions`, { size: 500 })

// API.md §4.2 — Alert 화면에서 새 Episode 생성·기존 Episode 연결 (comment 필수)
export type EpisodeCreated = { episodeId: number; assignee: User }

export const createEpisode = (alertIds: number[], comment: string) =>
  postJson<EpisodeCreated>('/api/episodes', { alertIds, comment })

export const linkAlertsToEpisode = (episodeId: number, alertIds: number[], comment: string) =>
  postJson<void>(`/api/episodes/${episodeId}/alerts`, { alertIds, comment })

export const commentEpisode = (episodeId: number, comment: string) =>
  postJson<void>(`/api/episodes/${episodeId}/comments`, { comment })
