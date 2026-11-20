import { afterEach, expect, it, vi } from 'vitest'
import { fetchLiveDashboard } from './liveDashboard'

// ReviewController.dashboard + DashboardService.view: the current backend wire shape.
const response = () => ({
  businessAt: '2023-09-10T00:00:00Z',
  personal: { pending: 4, aged: 2, closed: 1 },
  institution: { alerts: 8, episodes: 1, aged: 3, today: 2, yesterday: 1 },
  openAlertsAgedOver3Days: 3,
  detection: { received: 100, analyzed: 80, suspicious: 20 },
  deliveryDate: '2023-08-31, 2023-09-01',
  pendingReports: 2,
  daily: [{ day: '2023-09-01', incoming: 6, completed: 1 }],
  dailyAlertStatus: [{ date: '2023-09-01', pending: 2, inProgress: 1, done: 3 }],
  agreements: [{ agreement: 'STRONG', count: 20 }],
  types: [{ type: 3, count: 20 }],
  episodeWork: {
    asOf: '2023-09-10T00:00:00Z',
    current: { open: 1, aged: 0, unreviewed: 1, created_today: 1, closed_today: 0 },
    firstReview: { samples: 0, average_seconds: null },
    completion: { samples: 0, average_seconds: null },
    oldestOpen: [],
  },
  activities: [], priority: [],
})
afterEach(() => vi.restoreAllMocks())

it('현행 서버 경로와 평면 응답을 사용하고 업무 시각과 수치를 보존한다', async () => {
  const wire = response()
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(wire)))
  const data = await fetchLiveDashboard('2023-08-31', '2023-09-10')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('/api/v1/dashboard?from=2023-08-31&to=2023-09-10', expect.objectContaining({ credentials: 'include' }))
  expect(data).toEqual({
    businessAt: wire.businessAt, personal: wire.personal, institution: wire.institution,
    openAlertsAgedOver3Days: wire.openAlertsAgedOver3Days,
    detection: wire.detection, deliveryDate: wire.deliveryDate, pendingReports: wire.pendingReports,
    dailyAlertStatus: wire.dailyAlertStatus, agreements: wire.agreements, types: wire.types,
    episodeWork: { current: { unreviewed: 1 } },
  })
  // Completion events are not the same as the current status of a creation-date cohort.
  expect(data.dailyAlertStatus[0].done).toBe(3)
  expect(data).not.toHaveProperty('range')
})

it('0건과 빈 배열은 정상 응답으로 유지하고 없는 분포를 만들지 않는다', async () => {
  const wire = { ...response(),
    personal: { pending: 0, aged: 0, closed: 0 },
    institution: { alerts: 0, episodes: 0, aged: 0, today: 0, yesterday: 0 },
    openAlertsAgedOver3Days: 0, detection: { received: 0, analyzed: 0, suspicious: 0 },
    pendingReports: 0, dailyAlertStatus: [], agreements: [], types: [],
    episodeWork: { ...response().episodeWork, current: { open: 0, aged: 0, unreviewed: 0, created_today: 0, closed_today: 0 } },
  }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(wire)))
  expect(await fetchLiveDashboard('2023-08-31', '2023-09-10')).toMatchObject({
    personal: { pending: 0 }, detection: { received: 0 }, dailyAlertStatus: [], agreements: [], types: [],
    episodeWork: { current: { unreviewed: 0 } },
  })
})

it.each([
  ['없는 wrapper 계약', { businessAt: response().businessAt, pipeline: { data: null }, investigation: { data: null } }],
  ['누락된 집계', { ...response(), personal: undefined }],
  ['잘못된 집계 자료형', { ...response(), detection: { ...response().detection, received: '100' } }],
  ['누락된 상태 배열', { ...response(), dailyAlertStatus: null }],
])('%s를 0건으로 숨기지 않고 응답 오류로 전달한다', async (_label, wire) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(wire)))
  await expect(fetchLiveDashboard('2023-08-31', '2023-09-10')).rejects.toMatchObject({
    problem: { status: 502, code: 'INVALID_DASHBOARD_RESPONSE' },
  })
})

it('서버 오류를 빈 대시보드로 바꾸지 않는다', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    title: '집계 조회 실패', code: 'INTERNAL', status: 500,
  }), { status: 500 }))
  await expect(fetchLiveDashboard('2023-08-31', '2023-09-10')).rejects.toMatchObject({
    problem: { status: 500, code: 'INTERNAL', title: '집계 조회 실패' },
  })
})
