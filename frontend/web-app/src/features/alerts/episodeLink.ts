import type { AlertRow } from '@/api/alerts'
import type { AlertOverrides } from './alertOverrides'

// v24 Lists.tsx의 "Episode로 묶기" 다중 선택. 처리 전(OPEN) Alert만 고를 수 있다(API.md §4.2).
export type EpisodeLinkState = { mode: 'browse' | 'link'; selected: Set<number> }
export type EpisodeLinkAction = { type: 'start' } | { type: 'cancel' } | { type: 'complete' } | { type: 'toggle'; id: number }
/** 'new' = 새 Episode 생성, 숫자 = 기존 Episode 연결 */
export type EpisodeTarget = 'new' | number

export const initialLinkState: EpisodeLinkState = { mode: 'browse', selected: new Set() }

export function episodeLinkReducer(state: EpisodeLinkState, action: EpisodeLinkAction): EpisodeLinkState {
  if (action.type === 'start') return { mode: 'link', selected: new Set() }
  if (action.type === 'cancel' || action.type === 'complete') return initialLinkState
  const selected = new Set(state.selected)
  if (selected.has(action.id)) selected.delete(action.id)
  else selected.add(action.id)
  return { ...state, selected }
}

export const canLink = (row: AlertRow) => row.status === 'OPEN'

/** 연결할 수 있는 기존 Episode: 목록에 보이는 심층 조사 Alert의 Episode */
export const linkableEpisodes = (rows: AlertRow[]) =>
  [...new Set(rows.flatMap(row => (row.status === 'ESCALATED' && row.episodeId != null ? [row.episodeId] : [])))].sort((a, b) => a - b)

/** mock 전용: 연결할 수 있는 Alert만 심층 조사로 바꾼 결과. 실제 API는 결과를 다시 조회한다. */
export function episodeLinkOverrides(rows: AlertRow[], alertIds: number[], episodeId: number): AlertOverrides {
  const ids = new Set(alertIds)
  return Object.fromEntries(rows.filter(row => ids.has(row.alertId) && canLink(row)).map(row => [row.alertId, { status: 'ESCALATED', resolution: null, episodeId }]))
}

export const nextEpisodeId = (rows: AlertRow[]) => Math.max(800, ...rows.map(row => row.episodeId ?? 0)) + 1
