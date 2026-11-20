import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../dashboard-data'
import { PageHeaderContext } from '../page-header-context'
import { WorkspaceContext, type LedgerTransaction, type WorkspaceCase, type WorkspaceValue } from '../workspace-store'
import { CasePage } from './CasePage'

afterEach(cleanup)
const item: WorkspaceCase = { ...cases[0], revision: 2, alertCaseIds: [], comments: [], history: [] }
const transactions: LedgerTransaction[] = item.transactionIds.map((id, i) => ({ id, displayId: `T-${id}`, date: '2026-11-15', occurredAt: `2026-11-15T12:0${i}:00Z`, typeCode: 3, probability: .8, suspicious: true, score: .95, amountUsd: 100, currency: 'USD', accountId: 900 + i, ownerId: 600 + i, fromAccountId: 900 + i, toAccountId: 901 + i, humanVerdict: null }))
function setup(record = item, query = '', snapshot: Partial<Pick<WorkspaceValue, 'records' | 'transactions'>> = {}) {
  const header = document.createElement('div'); document.body.append(header)
  const openCase = vi.fn()
  const value: WorkspaceValue = { records: [record], transactions, rules: [], judgments: [], notifications: [], viewerId: item.assigneeId,
    openCase, judgeCases: vi.fn(), bundleAlerts: vi.fn(), addComment: vi.fn().mockReturnValue({ ok: true, value: record }), judgeTransaction: vi.fn(), saveRule: vi.fn(), transitionRule: vi.fn(), markNotificationRead: vi.fn(), ...snapshot }
  const view = render(<WorkspaceContext.Provider value={value}><PageHeaderContext.Provider value={header}><CasePage route={new URL(`http://localhost/alerts/${record.caseId}${query}`)} /></PageHeaderContext.Provider></WorkspaceContext.Provider>)
  return { value, view, header }
}
describe('case detail', () => {
  it('opens evidence, matches the transaction count and keeps overview selector in URLs', () => {
    const { value } = setup()
    expect(value.openCase).toHaveBeenCalledWith(item.caseId)
    expect(screen.getByRole('heading', { name: '근거 거래 3건' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '패널별' })).toHaveAttribute('href', `#/alerts/${item.caseId}?mode=per`)
    expect(screen.getByRole('link', { name: '분석' })).toHaveAttribute('href', `#/alerts/${item.caseId}?tab=analysis`)
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
