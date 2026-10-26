import { afterEach, expect, it, vi } from 'vitest'
import { fetchLiveDashboard } from './liveDashboard'

const summary = () => ({
  businessAt: '2023-09-10T00:00:00Z', range: { from: '2023-08-31', to: '2023-09-10' },
  pipeline: { computedAt: '2026-10-08T00:00:00Z', data: { detection: { received: 100, analyzed: 80, suspicious: 20, deliveryDates: ['2023-08-31', '2023-09-01'] }, pendingReports: 2, agreements: [{ agreement: 'STRONG', count: 20 }], types: [{ type: 3, count: 20 }] } },
  investigation: { computedAt: '2026-10-08T00:00:01Z', data: { personal: { pending: 4, aged: 2, closed: 1 }, institution: { alerts: 8, episodes: 1, aged: 3, today: 2, yesterday: 1 }, openAlertsAgedOver3Days: 3, daily: [], dailyAlertStatus: [{ date: '2023-09-01', pending: 2, inProgress: 1, done: 3 }], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, createdToday: 1, closedToday: 0 }, firstReview: { samples: 0, averageSeconds: null }, completion: { samples: 0, averageSeconds: null } } } },
})
afterEach(() => vi.restoreAllMocks())
it('현행 summary를 기존 카드에 매핑하고 폐기된 dashboard 경로를 요청하지 않는다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(summary())))
  const data = await fetchLiveDashboard('2023-08-31', '2023-09-10')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('/api/v1/dashboard/summary?from=2023-08-31&to=2023-09-10', expect.objectContaining({ credentials: 'include' }))
  expect(data.personal.pending).toBe(4); expect(data.institution.alerts).toBe(8)
  expect(data.deliveryDate).toBe('2023-08-31, 2023-09-01')
  expect(data.dailyAlertStatus[0]).toEqual({ date: '2023-09-01', pending: 2, inProgress: 1, done: 3 })
  expect(data.episodeWork.current.unreviewed).toBe(1)
})
it('아직 게시되지 않은 집계를 0으로 만들지 않는다', async () => {
  const data = { ...summary(), pipeline: { computedAt: null, data: null } }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data)))
  await expect(fetchLiveDashboard('2023-08-31', '2023-09-10')).rejects.toMatchObject({ problem: { status: 503, code: 'DASHBOARD_NOT_READY' } })
})
