import { describe, expect, it } from 'vitest'
import { allAlertsNormal } from '@/mocks/alerts'
import { episodesNormal, loadMockEpisode, loadMockEpisodes } from '@/mocks/episodes'
import { episodeLinkOverrides, nextEpisodeId } from '@/features/alerts/episodeLink'
import { withOverride } from '@/features/alerts/alertOverrides'

const alerts = allAlertsNormal.content

describe('Episode mock', () => {
  it('심층 조사 Alert를 Episode 3개로 묶고, 1건짜리 Episode는 없다', () => {
    expect(episodesNormal.content.map(e => e.episodeId).sort()).toEqual([800, 801, 802])
    for (const e of episodesNormal.content) expect(e.alertCount).toBeGreaterThan(1)
  })

  it('Episode 거래는 소속 Alert 거래의 합이고 출처 Alert를 가진다', async () => {
    const { detail, transactions } = await loadMockEpisode(800)
    expect(transactions).toHaveLength(detail.alerts.reduce((s, a) => s + a.txCount, 0))
    expect(new Set(transactions.map(t => t.alertId))).toEqual(new Set(detail.alerts.map(a => a.alertId)))
  })

  it('Alert 화면에서 만든 새 Episode가 목록과 상세에 나온다', async () => {
    const open = alerts.filter(a => a.status === 'OPEN').slice(0, 2).map(a => a.alertId)
    const id = nextEpisodeId(alerts)
    const overrides = episodeLinkOverrides(alerts, open, id)
    const next = alerts.map(a => withOverride(a, overrides))
    expect((await loadMockEpisodes(next, 'normal')).content.find(e => e.episodeId === id)?.alertCount).toBe(2)
    expect((await loadMockEpisode(id, next, 'normal')).detail.alerts.map(a => a.alertId)).toEqual(open)
  })

  it('빈 결과·없는 Episode·오류를 구분한다', async () => {
    expect((await loadMockEpisodes(alerts, 'empty')).content).toEqual([])
    await expect(loadMockEpisode(999, alerts, 'normal')).rejects.toMatchObject({ problem: { status: 404 } })
    await expect(loadMockEpisodes(alerts, 'error')).rejects.toMatchObject({ problem: { status: 500 } })
  })
})
