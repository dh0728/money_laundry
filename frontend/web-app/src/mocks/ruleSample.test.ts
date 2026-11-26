import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/common'
import {
  cancelBacktest, cloneRule, commandRule, createRule, createRuleVersion, deleteRuleDraft, fetchBacktest, fetchBacktestPeriod, fetchBacktests, fetchCaseRuleHits, fetchRule,
  fetchRuleCatalog, fetchRules, requestBacktest, saveRuleDraft, validateRule, type RuleDefinition,
} from '@/api/rules'
import { previewAdmin, previewStaff, setPreviewUser } from '@/features/auth/preview-session-user'
import { sampleReadOnlyNote } from './ruleSample'

// 서버 없이 실행할 때(VITE_API_MODE 가 live 가 아닐 때) 룰 API 가 주는 샘플 응답.
// 화면은 서버에 붙였을 때와 같은 것이고, 요청은 하나도 나가지 않는다.

const fetcher = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher)
  setPreviewUser(previewStaff)
})
afterEach(() => { vi.unstubAllGlobals(); fetcher.mockReset() })

const definitionOf = async (key: string): Promise<RuleDefinition> => {
  const template = (await fetchRuleCatalog()).templates.find(item => item.key === key)!
  return structuredClone({ schema: 2, template: key, ...template.defaults! })
}

it('목록의 룰마다 상세가 있고 상태별 개수가 목록과 맞는다', async () => {
  const list = await fetchRules()
  expect(list.content.map(row => row.code)).toEqual([
    'RULE-001', 'RULE-002', 'RULE-003', 'RULE-004', 'RULE-005', 'RULE-006', 'RULE-007', 'RULE-008', 'RULE-009',
  ])
  for (const [status, count] of Object.entries(list.counts)) expect(list.content.filter(row => row.status === status)).toHaveLength(count)
  for (const row of list.content) {
    const detail = await fetchRule(row.ruleId)
    expect(detail).toMatchObject({ code: row.code, name: row.name, status: row.status })
    // 룰 한 줄의 조건 요약은 그 줄이 보여 주는 버전(작업 중이 시험 운영 · 승인 대기면 그것, 아니면 운영, 없으면 작업 중)의 것이다
    expect([detail.operating?.summary, detail.working?.summary]).toContain(row.summary)
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it('고를 수 있는 템플릿은 모두 기본값의 검증 결과와 문장이 있다', async () => {
  const catalog = await fetchRuleCatalog()
  const available = catalog.templates.filter(template => template.available)
  expect(available).toHaveLength(10)
  for (const template of available) {
    const check = await validateRule({ template: template.key, definition: await definitionOf(template.key) })
    expect(check.canSave).toBe(true)
    expect(check.sentence).toBeTruthy()
  }
})

it('키 순서가 달라도 같은 조건이면 같은 검증 결과를 준다', async () => {
  const definition = await definitionOf('FAN_OUT')
  const reordered = Object.fromEntries(Object.entries(definition).reverse()) as RuleDefinition
  expect(await validateRule({ template: 'FAN_OUT', definition: reordered })).toEqual(await validateRule({ template: 'FAN_OUT', definition }))
})

it('샘플 룰의 버전 조건도 검증 결과가 있어 룰 만들기에서 이어서 열 수 있다', async () => {
  const draft = (await fetchRule(1)).working!
  expect(draft.status).toBe('DRAFT')
  const check = await validateRule({ template: 'FAN_OUT', definition: draft.definition, ruleId: 1 })
  expect(check.sentence).toBe(draft.sentence)
})

it('고친 조건의 값과 기간을 문장과 검토 항목에 반영한다', async () => {
  const definition = await definitionOf('FAN_OUT')
  definition.windowMinutes = 1440
  definition.where.items = [{ metric: 'DISTINCT_COUNTERPARTIES', value: 8, cmp: 'GT' }]
  const check = await validateRule({ template: 'FAN_OUT', definition })
  expect(check.sentence).toContain('한 송금 계좌에서 24시간 안에 서로 다른 수취 계좌 수가 8개 초과이면')
  expect(check.items).toEqual([
    expect.objectContaining({ key: 'FORMAT', ok: true }), expect.objectContaining({ key: 'CONDITIONS', ok: true }),
    expect.objectContaining({ key: 'DATA', ok: true, message: expect.stringContaining('샘플 원장') }),
    expect.objectContaining({ key: 'COST', ok: true, message: expect.stringContaining('24시간') }),
  ])
  expect(check.canRun).toBe(true)
  expect(fetcher).not.toHaveBeenCalled()
})

it('값이 비었거나 범위를 넘으면 조건 오류를 보여 주고 입력한 정의의 미리보기는 유지한다', async () => {
  const definition = await definitionOf('FAN_OUT')
  definition.where.items = [{ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE' }, { metric: 'TX_COUNT', value: 0, cmp: 'LTE' }]
  const check = await validateRule({ template: 'FAN_OUT', definition })
  expect(check).toMatchObject({ canSave: true, canRun: false })
  expect(check.sentence).toContain('서로 다른 수취 계좌 수가 ?개 이상이고 거래 건수가 0건 이하이면')
  expect(check.items.find(item => item.key === 'CONDITIONS')?.errors).toEqual([
    expect.stringContaining('값이 비어 있습니다'), expect.stringContaining('범위'),
  ])
})

it('묶음의 연결 방식, 경로 값과 실행 비용 오류도 반영한다', async () => {
  const definition = await definitionOf('RANDOM')
  definition.filter.items = [{ op: 'ANY', items: [{ field: 'FIRST_PAIR' }, { field: 'FX_FOLLOW' }] }]
  definition.path = { ...definition.path, maxHops: 13, stepRatioMin: 0.9 }
  const check = await validateRule({ template: 'RANDOM', definition })
  expect(check.sentence).toContain('(처음 거래하는 상대 또는 환전 직후 송금)인 거래만 세어')
  expect(check.sentence).toContain('금액 비 0.9 ~ 1.25로 이어진 거래가 3건 이상(13건까지 따라감)이면')
  expect(check).toMatchObject({ canSave: true, canRun: false })
  expect(check.items.find(item => item.key === 'COST')?.errors[0]).toContain('12건')
})

it('목록에 없는 비교를 입력하면 형식 오류로 처리한다', async () => {
  const definition = await definitionOf('FAN_OUT')
  definition.where.items = [{ metric: 'DISTINCT_COUNTERPARTIES', value: 8, cmp: 'UNKNOWN' }]
  const check = await validateRule({ template: 'FAN_OUT', definition })
  expect(check).toMatchObject({ canSave: false, canRun: false, sentence: null, summary: null })
  expect(check.items[0]).toMatchObject({ key: 'FORMAT', ok: false, errors: [expect.stringContaining('비교')] })
})

it('저장 · 명령 · 복제 · 백테스트 실행은 받지 않고 샘플이라고 알린다', async () => {
  const definition = await definitionOf('FAN_OUT')
  const original = await fetchRules()
  const writes = [
    () => createRule({ name: '새 룰', template: 'FAN_OUT' }), () => saveRuleDraft(1, 8, { name: '분산 송금 감시', definition, revision: 0 }),
    () => createRuleVersion(2), () => cloneRule(2), () => commandRule(4, { action: 'APPROVE', versionId: 4, revision: 0 }),
    () => deleteRuleDraft(7, 7), () => requestBacktest({ versionId: 6 }), () => cancelBacktest(1),
  ]
  for (const write of writes) {
    const failure = await write().catch(error => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.problem).toMatchObject({ code: 'SAMPLE_READ_ONLY', detail: sampleReadOnlyNote })
  }
  expect(await fetchRules()).toEqual(original)
  expect(fetcher).not.toHaveBeenCalled()
})

it('상세의 명령은 로그인한 샘플 사용자에 맞춰 온다', async () => {
  const approve = async () => (await fetchRule(4)).commands!.find(command => command.action === 'APPROVE')!
  expect(await approve()).toMatchObject({ enabled: false, reason: '관리자만 할 수 있습니다.' })
  setPreviewUser(previewAdmin)
  expect(await approve()).toMatchObject({ enabled: true, reason: null })
})

it('백테스트 기록의 줄마다 결과가 있고 운영 버전과 비교한 것도 있다', async () => {
  for (const row of (await fetchRules()).content) {
    for (const head of await fetchBacktests(row.ruleId)) {
      const run = await fetchBacktest(head.backtestId)
      expect(run).toMatchObject({ backtestId: head.backtestId, code: row.code, status: 'COMPLETED' })
      expect(run.cases!.filter(item => item.state !== 'DROPPED')).toHaveLength(run.kpis!.hits)
    }
  }
  expect(await fetchBacktests(7)).toEqual([])
  const compared = await fetchBacktest((await fetchBacktests(1))[0].backtestId)
  expect(compared.baseline).toMatchObject({ versionNo: 1 })
  expect(compared.kpis).toMatchObject({ hits: 3, added: 2, dropped: 0, baseHits: 1 })
})

it('고를 수 있는 검사 기간은 떠 둔 백테스트의 기간과 같다', async () => {
  const period = await fetchBacktestPeriod()
  expect(period).toEqual({ ledgerFrom: '2023-09-01', ledgerTo: '2023-09-12', earliest: '2023-09-08', from: '2023-09-08', to: '2023-09-12', days: 5, warmupDays: 7, maxDays: 90 })
  // 떠 둔 백테스트는 모두 이 기간(전체)으로 돌린 것이다
  for (const row of (await fetchRules()).content)
    for (const head of await fetchBacktests(row.ruleId)) expect(head.period).toEqual({ from: period.from, to: period.to, days: period.days })
  expect(fetcher).not.toHaveBeenCalled()
})

it('응답을 고쳐 써도 샘플은 그대로다', async () => {
  const original = await fetchRules()
  const list = await fetchRules()
  list.content.find(row => row.code === 'RULE-009')!.name = '응답에서 바꾼 이름'
  list.counts.ACTIVE = 0
  list.content.length = 0
  expect(await fetchRules()).toEqual(original)
})

it('없는 번호는 404 로 답하고 샘플 사건에는 걸린 룰이 없다', async () => {
  expect((await fetchRule(99).catch(error => error)).problem).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  expect((await fetchBacktest(99).catch(error => error)).problem).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  expect(await fetchCaseRuleHits(1)).toEqual([])
})
