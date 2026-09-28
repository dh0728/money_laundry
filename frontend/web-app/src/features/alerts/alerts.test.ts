import { describe, expect, it } from 'vitest'
import { allAlertsNormal, loadMockAlerts } from '@/mocks/alerts'
import { matchesAlert } from './alertFilters'
import { applyEpisodeLink, episodeLinkReducer, initialLinkState, linkableEpisodes, nextEpisodeId } from './episodeLink'

const rows = allAlertsNormal.content

describe('Alert 목록 mock', () => {
  it('정상·빈 결과·오류를 돌려준다', async () => {
    expect((await loadMockAlerts('normal')).content.length).toBeGreaterThan(24)
    expect((await loadMockAlerts('empty')).content).toEqual([])
    await expect(loadMockAlerts('error')).rejects.toMatchObject({ problem: { detail: 'Alert 목록을 불러오지 못했습니다.' } })
  })

  it('심층 조사 Alert만 Episode ID를 가진다 (API.md §3.3)', () => {
    for (const row of rows) expect(row.episodeId != null).toBe(row.status === 'ESCALATED')
  })
})

describe('Alert 필터', () => {
  it('같은 항목은 또는, 다른 항목은 그리고로 묶는다', () => {
    const open = rows.filter(r => matchesAlert(r, [{ field: 'status', value: 'OPEN' }, { field: 'status', value: 'CLOSED' }], ''))
    expect(open.every(r => r.status !== 'ESCALATED')).toBe(true)
    const mine = rows.filter(r => matchesAlert(r, [{ field: 'status', value: 'OPEN' }, { field: 'assignee', value: 11 }], ''))
    expect(mine.every(r => r.status === 'OPEN' && r.assignee.userId === 11)).toBe(true)
  })

  it('A- 코드와 담당자 이름으로 검색한다', () => {
    expect(rows.filter(r => matchesAlert(r, [], 'A-3001')).map(r => r.alertId)).toEqual([3001])
    expect(rows.filter(r => matchesAlert(r, [], '한검토')).length).toBeGreaterThan(0)
  })
})

describe('Episode로 묶기', () => {
  it('선택을 켜고 끄며 완료하면 비운다', () => {
    let state = episodeLinkReducer(initialLinkState, { type: 'start' })
    state = episodeLinkReducer(state, { type: 'toggle', id: 3000 })
    state = episodeLinkReducer(state, { type: 'toggle', id: 3001 })
    state = episodeLinkReducer(state, { type: 'toggle', id: 3000 })
    expect([...state.selected]).toEqual([3001])
    expect(episodeLinkReducer(state, { type: 'complete' })).toEqual(initialLinkState)
  })

  it('검토 전 Alert만 연결하고 새 Episode 번호를 겹치지 않게 만든다', () => {
    const closed = rows.find(r => r.status === 'CLOSED')!
    const open = rows.find(r => r.status === 'OPEN')!
    const id = nextEpisodeId(rows)
    expect(linkableEpisodes(rows)).not.toContain(id)
    const next = applyEpisodeLink(rows, [open.alertId, closed.alertId], id)
    expect(next.find(r => r.alertId === open.alertId)).toMatchObject({ status: 'ESCALATED', episodeId: id })
    expect(next.find(r => r.alertId === closed.alertId)).toEqual(closed)
  })
})
