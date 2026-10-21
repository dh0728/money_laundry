import { afterEach, expect, it, vi } from 'vitest'
import { fetchLiveDashboard, type DashboardSummary } from './liveDashboard'

function summary(): DashboardSummary {
  return {
    businessAt: '2023-09-10T00:00:00Z', range: { from: '2023-08-31', to: '2023-09-10' },
    pipeline: { computedAt: '2026-10-08T00:00:00Z', data: { detection: { received: 115270, analyzed: 100000, suspicious: 20, deliveryDates: ['2023-08-31', '2023-09-01'] }, pendingReports: 2, agreements: [{ agreement: 'STRONG', count: 20 }], types: [{ type: 3, count: 20 }] } },
    investigation: { computedAt: '2026-10-08T00:00:01Z', data: { personal: { pending: 4, aged: 2, closed: 1 }, institution: { alerts: 7811, episodes: 1, aged: 8, today: 20, yesterday: 5 }, openAlertsAgedOver3Days: 7, daily: [], dailyAlertStatus: [{ date: '2023-09-01', pending: 2, inProgress: 1, done: 3 }], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, createdToday: 1, closedToday: 0 }, firstReview: { samples: 0, averageSeconds: null }, completion: { samples: 0, averageSeconds: null } } } },
  }
}
afterEach(() => vi.restoreAllMocks())
it('new summary fields supply existing cards without requesting unused lists', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(summary())))
  const controller = new AbortController()
  const data = await fetchLiveDashboard('2023-08-31', '2023-09-10', controller.signal)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('/api/v1/dashboard/summary?from=2023-08-31&to=2023-09-10', expect.objectContaining({ signal: controller.signal, credentials: 'include' }))
  expect(data.investigation?.institution.alerts).toBe(7811)
  expect(data.investigation?.personal.pending).toBe(4)
  expect(data.pipeline?.detection.deliveryDates).toEqual(['2023-08-31', '2023-09-01'])
  expect(data.pipeline?.detection.received).toBe(115270)
  expect(data.investigation?.dailyAlertStatus[0]).toEqual({ date: '2023-09-01', pending: 2, inProgress: 1, done: 3 })
  expect(data.investigation?.episodeWork.current.unreviewed).toBe(1)
  expect(data.investigation?.episodeWork.current.open).toBe(1)
  expect(data.pipelineComputedAt).toBe('2026-10-08T00:00:00Z')
  expect(data.investigationComputedAt).toBe('2026-10-08T00:00:01Z')
})
it('an unpublished pipeline preserves investigation without manufacturing zero', async () => {
  const data = summary(); data.pipeline = { computedAt: null, data: null }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data)))
  const result = await fetchLiveDashboard('2023-08-31', '2023-09-10')
  expect(result.pipeline).toBeNull()
  expect(result.investigation?.institution.today).toBe(20)
})
it('an unpublished investigation preserves pipeline and real zero counts', async () => {
  const data = summary(); data.investigation = { computedAt: null, data: null }; data.pipeline.data!.pendingReports = 0
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data)))
  const result = await fetchLiveDashboard('2023-08-31', '2023-09-10')
  expect(result.investigation).toBeNull()
  expect(result.pipeline?.pendingReports).toBe(0)
  expect(result.pipeline?.detection.received).toBe(115270)
})
it('retry-after and server error reach the polling policy', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'DASHBOARD_READ_UNAVAILABLE', title: '잠시 후 재시도' }), { status: 503, headers: { 'Retry-After': '7' } }))
  await expect(fetchLiveDashboard('2023-08-31', '2023-09-10')).rejects.toMatchObject({ problem: { status: 503 }, retryAfterMs: 7000 })
})

it('an aborted old 401 response cannot expire the current session', async () => {
  let finish!: (body: unknown) => void
  const response = new Response('', { status: 401 })
  vi.spyOn(response, 'json').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
  const notify = vi.spyOn(window, 'dispatchEvent')
  const controller = new AbortController()
  const request = fetchLiveDashboard('2023-08-31', '2023-09-10', controller.signal)
  await Promise.resolve()
  controller.abort(new Error('view changed'))
  finish({ code: 'UNAUTHENTICATED' })
  await expect(request).rejects.toThrow('view changed')
  expect(notify).not.toHaveBeenCalled()
})
