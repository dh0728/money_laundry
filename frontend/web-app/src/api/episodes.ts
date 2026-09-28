import { postJson } from './common'

// API.md §4.2 — Alert 화면에서 새 Episode 생성·기존 Episode 연결 (comment 필수)
export type EpisodeCreated = { episodeId: number; assignee: { userId: number; name: string } }

export const createEpisode = (alertIds: number[], comment: string) =>
  postJson<EpisodeCreated>('/api/episodes', { alertIds, comment })

export const linkAlertsToEpisode = (episodeId: number, alertIds: number[], comment: string) =>
  postJson<void>(`/api/episodes/${episodeId}/alerts`, { alertIds, comment })
