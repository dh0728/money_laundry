import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import { ApiError, clearCsrf } from './common'
import { createRule, deleteRuleDraft, fetchRule, fetchRuleCatalog, fetchRules, saveRuleDraft, validateRule, type RuleDefinition } from './rules'

const definition: RuleDefinition = {
  schema: 2, template: 'FAN_OUT', windowMinutes: 10080,
  filter: { op: 'ALL', items: [{ field: 'FIRST_PAIR' }] },
  where: { op: 'ALL', items: [{ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE', value: 6 }] },
  then: 'ATTACH_EVIDENCE',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// 쓰기 요청 앞의 CSRF 토큰 조회는 따로 답하고, 룰 API 호출만 센다.
let respond: () => Response
let fetcher: MockInstance<typeof fetch>
beforeEach(() => {
  clearCsrf()
  respond = () => json({})
  fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(url =>
    Promise.resolve(String(url) === '/api/auth/csrf' ? json({ headerName: 'X-XSRF-TOKEN', token: 'synthetic' }) : respond()))
})
afterEach(() => vi.restoreAllMocks())

const call = (index: number) => {
  const [url, init] = fetcher.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/'))[index] as [string, RequestInit | undefined]
  return { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

it('읽기 요청은 API.md §12 의 주소로 간다', async () => {
  await fetchRuleCatalog()
  await fetchRules()
  await fetchRule(3)
  expect([0, 1, 2].map(index => call(index))).toEqual([
    { url: '/api/v1/rule-templates', method: 'GET', body: undefined },
    { url: '/api/v1/rules', method: 'GET', body: undefined },
    { url: '/api/v1/rules/3', method: 'GET', body: undefined },
  ])
})

it('검증 · 만들기 · 초안 저장 · 초안 삭제를 POST · PUT · DELETE 로 보낸다', async () => {
  await validateRule({ template: 'FAN_OUT', definition, ruleId: 3 })
  await createRule({ name: '분산 송금 감시', template: 'FAN_OUT', definition })
  await saveRuleDraft(3, 7, { name: '분산 송금 감시', definition, revision: 2 })
  respond = () => new Response(null, { status: 204 })
  await expect(deleteRuleDraft(3, 7)).resolves.toBeUndefined()

  expect(call(0)).toEqual({ url: '/api/v1/rules/validate', method: 'POST', body: { template: 'FAN_OUT', definition, ruleId: 3 } })
  expect(call(1)).toEqual({ url: '/api/v1/rules', method: 'POST', body: { name: '분산 송금 감시', template: 'FAN_OUT', definition } })
  expect(call(2)).toEqual({ url: '/api/v1/rules/3/versions/7', method: 'PUT', body: { name: '분산 송금 감시', definition, revision: 2 } })
  expect(call(3)).toEqual({ url: '/api/v1/rules/3/versions/7', method: 'DELETE', body: undefined })
})

it('룰 쓰기 요청은 화면 전체를 다시 읽게 하는 알림을 보내지 않는다', async () => {
  const changed = vi.fn()
  window.addEventListener('live-data-changed', changed)
  try {
    await validateRule({ template: 'FAN_OUT', definition })
    await createRule({ name: '분산 송금 감시', template: 'FAN_OUT' })
    await saveRuleDraft(3, 7, { name: '분산 송금 감시', definition, revision: 0 })
    await deleteRuleDraft(3, 7)
    expect(changed).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('live-data-changed', changed)
  }
})

it('서버가 거절하면 사유를 담은 ApiError 를 던진다', async () => {
  respond = () => json({ title: 'Conflict', status: 409, code: 'INVALID_TRANSITION', detail: '다른 곳에서 먼저 저장했습니다. 새로 고친 뒤 다시 저장해 주세요.' }, 409)
  const failure = await saveRuleDraft(3, 7, { name: '분산 송금 감시', definition, revision: 0 }).catch(error => error)
  expect(failure).toBeInstanceOf(ApiError)
  expect((failure as ApiError).problem.code).toBe('INVALID_TRANSITION')
  expect((failure as ApiError).problem.detail).toBe('다른 곳에서 먼저 저장했습니다. 새로 고친 뒤 다시 저장해 주세요.')
})
