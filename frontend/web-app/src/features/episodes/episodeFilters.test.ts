import { describe, expect, it } from 'vitest'
import type { TypeCode } from '@/api/codes'
import { episodesNormal } from '@/mocks/episodes'
import { matchesEpisode, type EpisodeFilter } from './episodeFilters'

const row = episodesNormal.content[0]

describe('Episode 목록 조건', () => {
  it('생성일 기간은 시작일과 종료일을 포함한다', () => {
    const day = new Date(`${row.createdAt.slice(0, 10)}T12:00:00`)
    expect(matchesEpisode(row, [], '', { from: day, to: day })).toBe(true)
    expect(matchesEpisode(row, [], '', { from: new Date(day.getTime() + 86400000) })).toBe(false)
  })

  it('같은 항목은 하나만 맞아도 되고 다른 항목은 모두 맞아야 한다', () => {
    const filters: EpisodeFilter[] = [
      { field: 'type', value: row.primaryTypes[0].code },
      { field: 'type', value: 99 as TypeCode },
      { field: 'assignee', value: row.assignee.userId },
    ]
    expect(matchesEpisode(row, filters, '')).toBe(true)
    expect(matchesEpisode(row, [...filters, { field: 'risk', value: 'low' }], '')).toBe(false)
  })

  it('검색과 위험도·경과일 조건을 함께 적용한다', () => {
    expect(matchesEpisode(row, [{ field: 'risk', value: 'high' }, { field: 'age', value: 1 }], `E-${row.episodeId}`)).toBe(row.riskScore >= 0.8 && row.ageDays >= 1)
    expect(matchesEpisode(row, [], '존재하지않는검색어')).toBe(false)
  })
})
