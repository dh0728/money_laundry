import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../dashboard-data'
import { PageHeaderContext } from '../page-header-context'
import { WorkspaceContext, type LedgerTransaction, type WorkspaceCase, type WorkspaceValue } from '../workspace-store'
import { CasePage } from './CasePage'

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })
const item: WorkspaceCase = { ...cases[0], revision: 2, alertCaseIds: [], comments: [], history: [] }
const transactions: LedgerTransaction[] = item.transactionIds.map((id, i) => ({ id, displayId: `T-${id}`, date: '2026-11-15', occurredAt: `2026-11-15T12:0${i}:00Z`, typeCode: 3, probability: .8, suspicious: true, score: .95, amountUsd: 100, currency: 'USD', accountId: 900 + i, ownerId: 600 + i, fromAccountId: 900 + i, toAccountId: 901 + i, humanVerdict: null }))
function setup(record = item, query = '', snapshot: Partial<Pick<WorkspaceValue, 'records' | 'transactions'>> = {}) {
  const header = document.createElement('div'); document.body.append(header)
  const openCase = vi.fn()
  const value: WorkspaceValue = { records: [record], transactions, rules: [], judgments: [], notifications: [], viewerId: item.assigneeId,
    openCase, judgeCases: vi.fn(), bundleAlerts: vi.fn(), addComment: vi.fn().mockReturnValue({ ok: true, value: record }), judgeTransaction: vi.fn(), saveRule: vi.fn(), transitionRule: vi.fn(), markNotificationRead: vi.fn(), ...snapshot }
  const view = render(<WorkspaceContext.Provider value={value}><PageHeaderContext.Provider value={header}><CasePage route={new URL(`http://localhost/${record.kind === 'EPISODE' ? 'episodes' : 'alerts'}/${record.caseId}${query}`)} /></PageHeaderContext.Provider></WorkspaceContext.Provider>)
  return { value, view, header }
}
describe('case detail', () => {
  it('distinguishes entirely missing evidence from verified zero accounts in summary and KPI', () => {
    setup(item, '?tab=overview', { transactions: [] })
    const summary = screen.getByRole('heading', { name: '샘플 AI 요약' }).parentElement
    expect(summary).toHaveTextContent('근거 거래 3건을 불러오지 못해 계좌와 소유주를 확인할 수 없습니다.')
    expect(summary).not.toHaveTextContent('0건의 근거 거래와 0개 계좌를 확인')
    const metric = screen.getByRole('group', { name: '계좌 · 소유주' })
    expect(metric).toHaveTextContent('미제공')
    expect(metric).not.toHaveTextContent('0개 · 0명')
    expect(screen.getByRole('group', { name: '기간' })).toHaveTextContent('미제공')
  })
  it('qualifies a partial-evidence summary with deduplicated reference scope', () => {
    setup({ ...item, transactionIds: [transactions[0].id, transactions[0].id, transactions[1].id, 999999] }, '?tab=overview', { transactions: transactions.slice(0, 1) })
    const summary = screen.getByRole('heading', { name: '샘플 AI 요약' }).parentElement
    expect(summary).toHaveTextContent('근거 거래 3건 중 1건을 확인했습니다. 확인된 거래의 계좌는 2개입니다.')
    expect(screen.getByRole('group', { name: '계좌 · 소유주' })).toHaveTextContent('확인된 근거만 집계')
  })
  it('preserves a verified empty evidence set as zero rather than missing accounts', () => {
    setup({ ...item, transactionIds: [] })
    expect(screen.getByRole('group', { name: '계좌 · 소유주' })).toHaveTextContent('0개 · 0명')
    expect(screen.getByRole('heading', { name: '샘플 AI 요약' }).parentElement).toHaveTextContent('0건의 근거 거래와 0개 계좌를 확인했습니다.')
    expect(screen.getByRole('group', { name: '기간' })).toHaveTextContent('미제공')
  })
  it.each([
    ['2026-11-15T12:00:00Z', '0분'],
    ['2026-11-15T12:00:30Z', '1분 미만'],
    ['2026-11-15T13:01:00Z', '1시간 1분'],
  ])('shows duration without conflating zero with a missing interval: %s', (end, label) => {
    const rows = [{ ...transactions[0], occurredAt: '2026-11-15T12:00:00Z' }, { ...transactions[1], occurredAt: end }]
    setup({ ...item, transactionIds: rows.map(row => row.id) }, '?tab=overview', { transactions: rows })
    expect(screen.getByRole('group', { name: '기간' }).querySelector('strong')).toHaveTextContent(label)
  })
  it('shows only the case-level score and one pattern estimate before evidence', () => {
    setup({ ...item, score: 0.81, typeCode: 3, probability: 0.72 })
    const panel = screen.getByRole('region', { name: '탐지 근거' })
    expect(within(panel).getByText('업무 모델 점수').parentElement).toHaveTextContent('0.81')
    expect(within(panel).getByText('업무 추정 패턴').parentElement).toHaveTextContent('Gather-scatter 72%')
    for (const label of ['모델 기여요인', '탐지 임계값', '모델 버전']) {
      expect(within(panel).getByText(label).parentElement).toHaveTextContent('미제공')
    }
    expect(within(panel).getAllByText(/72%/)).toHaveLength(1)
    expect(panel).not.toHaveTextContent(/거래별 후보|정상 거래|탐지 원인/)
    expect(panel.compareDocumentPosition(screen.getByRole('heading', { name: '근거 거래 3건' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('adds a detection deep link without changing default or unknown-panel fallback', () => {
    const detection = setup(item, '?tab=overview&mode=per&panel=detection')
    expect(screen.getByLabelText('표시 패널')).toHaveValue('detection')
    expect(screen.getByRole('region', { name: '탐지 근거' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '근거 거래 3건' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('검토 의견')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('표시 패널'), { target: { value: 'accounts' } })
    expect(window.location.hash).toBe(`#/alerts/${item.caseId}?tab=overview&mode=per&panel=accounts`)
    detection.view.unmount(); detection.header.remove()
    for (const query of ['?tab=overview&mode=per', '?tab=overview&mode=per&panel=unknown']) {
      const fallback = setup(item, query)
      expect(screen.getByRole('heading', { name: '근거 거래 3건' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '탐지 근거' })).not.toBeInTheDocument()
      fallback.view.unmount(); fallback.header.remove()
    }
  })
  it.each([0, 1])('preserves the valid zero and one boundaries for model estimates: %s', number => {
    setup({ ...item, score: number, typeCode: 0, probability: number }, '?mode=per&panel=detection')
    const panel = screen.getByRole('region', { name: '탐지 근거' })
    expect(within(panel).getByText('업무 모델 점수').parentElement).toHaveTextContent(String(number))
    expect(within(panel).getByText('업무 추정 패턴').parentElement).toHaveTextContent(`NON_PATTERN ${number * 100}%`)
    expect(panel).not.toHaveTextContent('정상')
  })
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])('does not label invalid model estimates as zero or normal: %s', number => {
    setup({ ...item, score: number, probability: number }, '?mode=per&panel=detection')
    const panel = screen.getByRole('region', { name: '탐지 근거' })
    expect(within(panel).getByText('업무 모델 점수').parentElement).toHaveTextContent('미제공')
    expect(within(panel).getByText('업무 추정 패턴').parentElement).toHaveTextContent('미제공')
    expect(screen.getByLabelText('업무 상태')).not.toHaveTextContent(/낮음|NaN|Infinity/)
    expect(screen.queryByRole('heading', { name: '샘플 AI 요약' })).not.toBeInTheDocument()
    expect(panel).not.toHaveTextContent(/NaN|Infinity|110%|-10%/)
  })
  it('keeps an unknown pattern code unavailable rather than mapping it to NON_PATTERN', () => {
    setup({ ...item, typeCode: 99 as WorkspaceCase['typeCode'], probability: 0.8 }, '?mode=per&panel=detection')
    const panel = screen.getByRole('region', { name: '탐지 근거' })
    expect(within(panel).getByText('업무 추정 패턴').parentElement).toHaveTextContent('미제공')
    expect(screen.getByLabelText('업무 상태')).not.toHaveTextContent('NON_PATTERN')
  })
  it('keeps undefined external flows separate from known evidence and case score', () => {
    setup({ ...item, score: 0.81 })
    const metrics = screen.getByRole('region', { name: '개요 핵심 지표' })
    expect(within(metrics).getByRole('group', { name: '모델 점수' })).toHaveTextContent('0.81')
    for (const name of ['외부 유출', '외부 유입', '순유입', '경유 비율']) {
      const cell = within(metrics).getByRole('group', { name })
      expect(cell).toHaveTextContent('미제공')
      expect(cell).not.toHaveTextContent('300')
    }
    expect(within(metrics).getByRole('group', { name: '계좌 · 소유주' })).toHaveTextContent('4개 · 확인된 3명')
    expect(within(metrics).getByRole('group', { name: '계좌 · 소유주' })).toHaveTextContent('소유주 미확인 계좌 1개')
    expect(within(metrics).getByRole('group', { name: '기간' })).toHaveTextContent('2분')
    expect(screen.getByText(`담당자 ${item.assignee}`)).toBeInTheDocument()
  })
  it('does not present partial evidence as a complete time range', () => {
    setup(item, '?tab=overview&mode=per&panel=scope', { transactions: transactions.slice(0, 1) })
    expect(screen.getByRole('group', { name: '근거 거래 전체 기간' })).toHaveTextContent('미제공')
    expect(screen.getByRole('heading', { name: '데이터 범위 · 한계' })).toBeInTheDocument()
    expect(screen.getByText('1 / 3건')).toBeInTheDocument()
    expect(screen.getByText('미수신 2건')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /근거 거래 \d+건/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('검토 의견')).not.toBeInTheDocument()
  })
  it('opens evidence, matches the transaction count and keeps overview selector in URLs', () => {
    const { value } = setup()
    expect(value.openCase).toHaveBeenCalledWith(item.caseId)
    expect(screen.getByRole('heading', { name: '근거 거래 3건' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '패널별' })).toHaveAttribute('href', `#/alerts/${item.caseId}?mode=per`)
    expect(screen.getByRole('link', { name: '분석' })).toHaveAttribute('href', `#/alerts/${item.caseId}?tab=analysis`)
  })
  it('keeps three detail tabs and preserves review content below overview history', () => {
    const record = { ...item, comments: [{ id: 1, at: '2026-11-15T12:00:00Z', author: '김OO', text: '연결 계좌 확인 메모' }], history: [{ at: '2026-11-15T11:00:00Z', actor: '김OO', action: '열람', reason: '조사 시작' }] }
    const { header } = setup(record)
    const tabs = screen.getByRole('navigation', { name: '상세 탭' })
    expect(header).toContainElement(tabs)
    expect(within(header).getAllByRole('button', { name: '판정하기' })).toHaveLength(1)
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['개요', '분석', '연관 업무'])
    expect(screen.getByText('연결 계좌 확인 메모')).toBeInTheDocument()
    const history = screen.getByRole('heading', { name: '처리 이력 1건' })
    const comments = screen.getByRole('heading', { name: '검토 의견 1건' })
    expect(history.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: '의견 저장' })).toBeDisabled()
  })
  it.each(['transactions', 'accounts', 'history'])('shows the review form only within the history panel: %s', panel => {
    setup(item, `?tab=overview&mode=per&panel=${panel}`)
    if (panel === 'history') expect(screen.getByLabelText('검토 의견')).toBeInTheDocument()
    else expect(screen.queryByLabelText('검토 의견')).not.toBeInTheDocument()
  })
  it.each(['ALERT', 'EPISODE'] as const)('normalizes the old %s review deep link without losing case or query context', kind => {
    const record = { ...item, kind, comments: [{ id: 1, at: '2026-11-15T12:00:00Z', author: '김OO', text: '기존 검토 메모' }] }
    const path = `/${kind === 'EPISODE' ? 'episodes' : 'alerts'}/${record.caseId}`
    const query = '?tab=review&mode=per&panel=accounts&view=owner'
    window.history.replaceState({ previous: 'case-list' }, '', `#${path}${query}`)
    const historyLength = window.history.length
    const { value } = setup(record, query)
    const result = new URL(window.location.hash.slice(1), window.location.origin)
    expect(result.pathname).toBe(path)
    expect(result.searchParams.get('tab')).toBe('overview')
    expect(result.searchParams.get('mode')).toBe('per')
    expect(result.searchParams.get('panel')).toBe('history')
    expect(result.searchParams.get('view')).toBe('owner')
    expect(window.history.length).toBe(historyLength)
    expect(window.history.state).toEqual({ previous: 'case-list' })
    expect(screen.getByRole('link', { name: '개요' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('기존 검토 메모')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '추가 근거 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '의견 저장' }))
    expect(value.addComment).toHaveBeenCalledWith(record.caseId, '추가 근거 확인')
    expect(screen.getByRole('status')).toHaveTextContent('의견이 저장되었습니다')
  })
  it.each([{ assigneeId: 999 }, { status: 'CLOSED' as const }])('keeps overview review controls read-only for %o', restriction => {
    const { value } = setup({ ...item, ...restriction }, '?tab=overview&mode=per&panel=history')
    expect(screen.getByLabelText('검토 의견')).toBeDisabled()
    expect(screen.getByRole('button', { name: '의견 저장' })).toBeDisabled()
    expect(screen.queryByText(/사람 판정을 남겨 주세요/)).not.toBeInTheDocument()
    expect(value.addComment).not.toHaveBeenCalled()
  })
  it('distinguishes unavailable evidence from a confirmed empty account set', () => {
    const first = setup(item, '?tab=overview&mode=per&panel=accounts', { transactions: [] })
    expect(screen.getByText('근거 거래를 불러오지 못해 연결 계좌를 확인할 수 없습니다.')).toBeInTheDocument()
    expect(screen.queryByText('연결된 계좌가 없습니다.')).not.toBeInTheDocument()
    first.view.unmount(); first.header.remove()
    setup({ ...item, transactionIds: [] }, '?tab=overview&mode=per&panel=accounts', { transactions: [] })
    expect(screen.getByText('연결된 계좌가 없습니다.')).toBeInTheDocument()
  })
  it('disables verdict for another assignee and closed case', () => {
    const { view, header } = setup({ ...item, assigneeId: 999 })
    expect(screen.getByRole('button', { name: '판정하기' })).toBeDisabled()
    expect(screen.getByText(/다른 담당자의 업무/)).toBeInTheDocument()
    view.unmount(); header.remove()
    setup({ ...item, status: 'CLOSED' })
    expect(screen.getByRole('button', { name: '판정하기' })).toBeDisabled()
    expect(screen.getByText(/처리 완료된 업무/)).toBeInTheDocument()
  })
  it('saves review comments through the shared store', () => {
    const { value } = setup(item, '?tab=review')
    fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '증빙 자료 대조 완료' } })
    fireEvent.click(screen.getByRole('button', { name: '의견 저장' }))
    expect(value.addComment).toHaveBeenCalledWith(item.caseId, '증빙 자료 대조 완료')
    expect(screen.getByRole('status')).toHaveTextContent('의견이 저장되었습니다')
  })
  it('renders pattern and owner lens routes, risk toggles and timeline controls', () => {
    setup(item, '?tab=analysis')
    expect(screen.getByRole('link', { name: '소유주별' })).toHaveAttribute('href', `#/alerts/${item.caseId}?tab=analysis&view=owner`)
    expect(screen.getByLabelText('위험')).toBeChecked()
    expect(screen.getByLabelText('주의')).toBeChecked()
    expect(screen.getByLabelText('낮음')).toBeChecked()
    fireEvent.click(screen.getByLabelText('위험'))
    expect(screen.getAllByText('표시할 거래가 없습니다')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('위험'))
    fireEvent.change(screen.getByLabelText('거래 재생 위치'), { target: { value: 1 } })
    expect(screen.getByText('1 / 3건')).toBeInTheDocument()
  })
  it('rejects oversized transaction or record snapshots before row access and opening a case', () => {
    const inaccessible = <T,>(length: number) => new Proxy(new Array<T>(length), { get(target, property) {
      if (property === 'length') return target.length
      throw new Error(`Oversized snapshot row access: ${String(property)}`)
    } })
    const first = setup(item, '?tab=analysis', { transactions: inaccessible<LedgerTransaction>(10_001), records: inaccessible<WorkspaceCase>(1) })
    expect(screen.getByRole('status')).toHaveTextContent('서버 범위 조회가 필요합니다')
    expect(first.value.openCase).not.toHaveBeenCalled()
    first.view.unmount(); first.header.remove()
    const second = setup(item, '?tab=analysis', { records: inaccessible<WorkspaceCase>(10_001) })
    expect(screen.getByRole('status')).toHaveTextContent('서버 범위 조회가 필요합니다')
    expect(second.value.openCase).not.toHaveBeenCalled()
  })
  it('rejects excessive cumulative evidence references without reading transaction IDs', () => {
    const ids = new Proxy(new Array<number>(5_001), { get(target, property) {
      if (property === 'length') return target.length
      throw new Error(`Oversized evidence was scanned: ${String(property)}`)
    } })
    const { value } = setup(item, '?tab=analysis', { records: [{ ...item, transactionIds: ids }, { ...item, caseId: 2, transactionIds: ids }] })
    expect(screen.getByRole('status')).toHaveTextContent('서버 범위 조회가 필요합니다')
    expect(value.openCase).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('formats transaction and review timestamps in Asia/Seoul regardless of host timezone', () => {
    const format = vi.spyOn(Date.prototype, 'toLocaleString')
    const record = { ...item, comments: [{ id: 1, at: '2026-11-15T18:00:00Z', author: '김OO', text: '확인' }], history: [{ at: '2026-11-15T18:00:00Z', actor: '김OO', action: '열람', reason: '근거 확인' }] }
    try {
      setup(record)
      const tableCalls = format.mock.calls.length
      expect(tableCalls).toBeGreaterThan(0)
      expect(format.mock.calls.every(args => args[0] === 'ko-KR' && args[1]?.timeZone === 'Asia/Seoul')).toBe(true)
      cleanup()
      setup(record, '?tab=review')
      expect(format.mock.calls.length).toBeGreaterThan(tableCalls)
      expect(format.mock.calls.every(args => args[1]?.timeZone === 'Asia/Seoul')).toBe(true)
    } finally { format.mockRestore() }
  })
})
