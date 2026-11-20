import { useEffect, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceContext, type WorkspaceValue, type RuleRecord, type LedgerTransaction } from '../workspace-store'
import { RulesPage } from './RulesPage'

afterEach(cleanup)
const seed: RuleRecord = { id: 'RULE-001', version: 1, name: '집중 거래', description: '샘플 거래 확인', typeCode: 3, scoreMin: .7, minTransactions: 2, windowHours: 24, status: 'DRAFT', author: '김OO', updatedAt: '2026-11-15', history: [] }
function Harness({ path, initialRules = [seed], transactions = [] }: { path: string; initialRules?: RuleRecord[]; transactions?: LedgerTransaction[] }) {
  const [rules, setRules] = useState(initialRules)
  const [route, setRoute] = useState(new URL(path, 'http://localhost'))
  useEffect(() => {
    const update = () => setRoute(new URL(window.location.hash.slice(1), 'http://localhost'))
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const unsupported = () => ({ ok: false as const, error: '이 테스트에서 사용하지 않는 작업입니다.' })
  const value: WorkspaceValue = { records: [], transactions, judgments: [], notifications: [], viewerId: 7, openCase: () => {}, judgeCases: unsupported, bundleAlerts: unsupported, addComment: unsupported, judgeTransaction: unsupported, markNotificationRead: () => {}, rules, saveRule: (input, existingId) => { const saved = { ...seed, ...input, id: existingId ?? 'RULE-002' }; setRules(previous => [...previous.filter(rule => rule.id !== saved.id), saved]); return { ok: true, value: saved } }, transitionRule: (id, status, reason) => { const saved = { ...seed, id, status, history: [{ at: '2026-11-15', actor: '김OO', action: '승인 요청', reason }] }; setRules([saved]); return { ok: true, value: saved } } }
  return <WorkspaceContext.Provider value={value}><RulesPage route={route} /></WorkspaceContext.Provider>
}
describe('rule form actions', () => {
  it('rejects oversized backtest input before reading any transaction row', () => {
    let rowReads = 0
    const transactions = new Proxy([] as LedgerTransaction[], {
      get(target, key, receiver) {
        if (key === 'length') return 100000001
        if (typeof key === 'string' && /^\d+$/.test(key)) { rowReads++; throw new Error('oversized transaction row read') }
        return Reflect.get(target, key, receiver)
      },
      has(_target, key) { return typeof key === 'string' && /^\d+$/.test(key) },
    })
    render(<Harness path="/rules/RULE-001/backtest" transactions={transactions} />)
    expect(screen.getByRole('heading', { name: '서버 백테스트 작업이 필요합니다' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '백테스트 기간' })).toBeNull()
    expect(rowReads).toBe(0)
  })
  it('finds unsorted fixture date bounds in one memoized pass', () => {
    let dateReads = 0
    const transactions = ['2026-11-15', '2026-11-09'].map((date, index): LedgerTransaction => ({
      id: index, displayId: `T-${index}`, get date() { dateReads++; return date }, occurredAt: `${date}T12:00:00+09:00`, typeCode: 3, probability: .8, suspicious: true, score: .8, amountUsd: 100, currency: 'USD', accountId: 10, ownerId: 2, fromAccountId: 10, toAccountId: 20, humanVerdict: null,
    }))
    render(<Harness path="/rules/RULE-001/backtest" transactions={transactions} />)
    expect(screen.getByLabelText('백테스트 시작일')).toHaveValue('2026-11-09')
    expect(screen.getByLabelText('백테스트 종료일')).toHaveValue('2026-11-15')
    expect(dateReads).toBe(2)
    fireEvent.change(screen.getByLabelText('백테스트 시작일'), { target: { value: '2026-11-10' } })
    expect(dateReads).toBe(2)
  })
  it('renders a safe missing result for malformed encoded rule IDs', () => {
    render(<Harness path="/rules/%/backtest" />)
    expect(screen.getByRole('heading', { name: '룰을 찾을 수 없습니다' })).toBeInTheDocument()
  })
  it('shows meaningful errors before saving and confirms a validated draft', () => {
    render(<Harness path="/rules/new" />)
    fireEvent.submit(screen.getByRole('form', { name: '룰 작성' }))
    expect(screen.getByText('룰 이름은 1~80자로 입력해 주세요.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('룰 이름'), { target: { value: '신규 집중 거래' } })
    fireEvent.change(screen.getByLabelText('목적과 근거'), { target: { value: '동일 계좌의 집중 거래 탐지' } })
    fireEvent.submit(screen.getByRole('form', { name: '룰 작성' }))
    expect(screen.getByRole('status')).toHaveTextContent('RULE-002')
  })
  it('requires a reason for approval and renders the resulting status and history', () => {
    render(<Harness path="/rules?selected=RULE-001" />)
    fireEvent.click(screen.getByRole('button', { name: '승인 요청' }))
    expect(screen.getByRole('button', { name: '상태 변경 확인' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '탐지 조건 검토 완료' } })
    fireEvent.click(screen.getByRole('button', { name: '상태 변경 확인' }))
    expect(screen.getByRole('status')).toHaveTextContent('승인 대기')
    expect(screen.getByText('탐지 조건 검토 완료')).toBeInTheDocument()
  })
  it('runs the applied period, distinguishes zero results and preserves the last result on rerun error', async () => {
    render(<Harness path="/rules/RULE-001/backtest" />)
    expect(screen.getByText('백테스트 실행 전입니다')).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('form', { name: '백테스트 기간' }))
    expect(screen.getByRole('status')).toHaveTextContent('조회하는 중')
    await screen.findByRole('heading', { name: '샘플 결과 · 0건' })
    expect(screen.getByText('조건에 일치하는 거래가 없습니다')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('백테스트 시작일'), { target: { value: '2026-11-10' } })
    expect(screen.getByText('적용 기간: 2026-11-09 ~ 2026-11-15 (KST)')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('백테스트 실행 상태'), { target: { value: 'error' } })
    fireEvent.submit(screen.getByRole('form', { name: '백테스트 기간' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('이전 결과를 유지')
    expect(screen.getByRole('heading', { name: '샘플 결과 · 0건' })).toBeInTheDocument()
  })
  it('renders only one bounded list page, clamps the URL page and resets it when searching', () => {
    const rules = Array.from({ length: 61 }, (_, index) => ({ ...seed, id: `RULE-${String(index + 1).padStart(3, '0')}` }))
    render(<Harness path="/rules?page=999&pageSize=25" initialRules={rules} />)
    expect(screen.getAllByRole('row')).toHaveLength(12)
    expect(screen.getByText('51–61 / 61개')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 페이지' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '이전 페이지' }))
    expect(screen.getAllByRole('row')).toHaveLength(26)
    expect(screen.getByText('26–50 / 61개')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('룰 검색어'), { target: { value: 'RULE-061' } })
    fireEvent.submit(screen.getByRole('form', { name: '룰 검색' }))
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText('1–1 / 1개')).toBeInTheDocument()
    expect(window.location.hash).toContain('page=1')
  })
  it('keeps a successful empty rule snapshot after a refetch error', () => {
    render(<Harness path="/rules?state=empty" />)
    expect(screen.queryByRole('table')).toBeNull()
    window.history.pushState(null, '', '#/rules?state=error')
    fireEvent.popState(window)
    expect(screen.getByRole('alert')).toHaveTextContent('마지막 룰 목록을 유지')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('조건에 맞는 룰이 없습니다')).toBeInTheDocument()
  })
})
