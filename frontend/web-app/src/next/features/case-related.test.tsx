import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerTransaction, WorkspaceCase } from '../workspace-store'
import { indexCaseLedger, relatedCases } from './case-selectors'
import { focusedRelatedCandidate, mergeRelatedEvidence, relatedEvidenceRows } from './case-related'
import { CaseRelated } from './CaseRelated'
vi.mock('./CaseGraph', async importOriginal => {
  const actual = await importOriginal<typeof import('./CaseGraph')>()
  return { ...actual, CaseGraph: ({ rows, scopeControls, editable, lens }: { rows: LedgerTransaction[]; scopeControls?: React.ReactNode; editable: boolean; lens: string }) => <div data-testid="reused-graph" data-editable={String(editable)} data-lens={lens}>{scopeControls}<output aria-label="그래프 거래">{rows.map(tx => tx.id).join(',')}</output></div> }
})
afterEach(cleanup)
function transaction(id: number, from: number, to: number, ownerId = id): LedgerTransaction {
  return { id, displayId: 'T-' + id, date: '2026-11-15', occurredAt: '2026-11-15T10:00:00+09:00', accountId: from, ownerId, fromAccountId: from, toAccountId: to, typeCode: 3, probability: .8, score: .8, amountUsd: 100, currency: 'USD', suspicious: true, humanVerdict: null }
}
function record(caseId: number, ids: number[], kind: 'ALERT' | 'EPISODE' = 'ALERT'): WorkspaceCase {
  return { caseId, sourceId: caseId, displayId: (kind === 'ALERT' ? 'A-' : 'E-') + caseId, kind, assigneeId: 7, assignee: '김OO', createdDate: '2026-11-15', ageDays: 1, status: 'OPEN', workState: 'pending', typeCode: 3, probability: .8, score: .8, transactionIds: ids, amountUsd: 100, verdict: null, revision: 1, alertCaseIds: [], history: [], comments: [] }
}
const transactions = [transaction(1, 10, 20, 100), transaction(2, 20, 30), transaction(3, 30, 40), transaction(4, 10, 50), transaction(5, 80, 90, 100)]
const index = indexCaseLedger(transactions)
const item = { ...record(1, [1, 1, 2, 999]), episodeCaseId: 9 }
const episode = { ...record(9, [2, 3, 3], 'EPISODE'), alertCaseIds: [1] }
const alert = record(10, [4])
const related = relatedCases(item, [item, episode, alert], index)
const props = { item, related, relatedFilter: 'all', page: 1, pageSize: 25, selectedIds: [9], viewerId: 7, editable: true, ledgerIndex: index, lens: 'pattern' as const, patternHref: '#/alerts/1?tab=related&view=pattern', ownerHref: '#/alerts/1?tab=related&view=owner', onFilter: vi.fn(), onPage: vi.fn(), onPageSize: vi.fn(), onToggleSelected: vi.fn(), onVerdict: vi.fn() }

describe('related evidence facts', () => {
  it('orders related evidence by actual time across timezone offsets with stable ID ties', () => {
    const rows = [
      { ...transaction(1, 10, 20), occurredAt: '2026-11-15T02:00:00Z' },
      { ...transaction(3, 20, 30), occurredAt: '2026-11-15T10:00:00+09:00' },
      { ...transaction(2, 30, 40), occurredAt: '2026-11-15T01:00:00Z' },
    ]
    expect(mergeRelatedEvidence(record(20, [1, 3]), record(21, [2]), indexCaseLedger(rows)).map(tx => tx.id)).toEqual([2, 3, 1])
  })
  it('merges only loaded current/candidate transactions and removes duplicate IDs', () => {
    expect(mergeRelatedEvidence(item, episode, index).map(tx => tx.id)).toEqual([1, 2, 3])
    expect(mergeRelatedEvidence(item, episode, index, { current: false, candidate: true }).map(tx => tx.id)).toEqual([2, 3])
    expect(mergeRelatedEvidence(item, episode, index, { current: false, candidate: false })).toEqual([])
  })
  it('reports actual shared account/transaction IDs and one direct Alert-Episode link without invented strength', () => {
    const rows = relatedEvidenceRows(item, episode, index)
    expect(rows.filter(row => row.kind === '공유 계좌').map(row => row.target)).toEqual(['20', '30'])
    expect(rows.find(row => row.kind === '공통 거래')?.target).toBe('T-2')
    expect(rows.filter(row => row.kind === 'Alert·Episode 연결')).toHaveLength(1)
    expect(rows.every(row => row.strength === '미제공')).toBe(true)
  })
  it('does not infer a relationship from a common owner on different accounts', () => {
    expect(relatedEvidenceRows(record(1, [1]), record(2, [5]), index)).toEqual([])
  })
  it('falls back to the first visible candidate after page/filter changes', () => {
    expect(focusedRelatedCandidate(related, null)?.item.caseId).toBe(9)
    expect(focusedRelatedCandidate(related, 10)?.item.caseId).toBe(10)
    expect(focusedRelatedCandidate([related[0]], 10)?.item.caseId).toBe(9)
    expect(focusedRelatedCandidate([], 10)).toBeNull()
  })
})

describe('related case inspection', () => {
  it('uses the first candidate and separates graph visibility from batch selection', () => {
    render(<CaseRelated {...props} />)
    expect(screen.getByLabelText('그래프 거래')).toHaveTextContent('1,2,3')
    expect(screen.getByTestId('reused-graph')).toHaveAttribute('data-editable', 'false')
    const selected = screen.getByRole('checkbox', { name: 'E-9 선택' })
    expect(selected).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'A-1 그래프 표시' }))
    expect(screen.getByLabelText('그래프 거래')).toHaveTextContent('2,3')
    expect(selected).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'E-9 그래프 표시' }))
    expect(screen.getByLabelText('그래프 거래')).toBeEmptyDOMElement()
  })
  it('changes the inspected relationship without navigating to the candidate detail', () => {
    render(<CaseRelated {...props} />)
    const candidates = screen.getByRole('region', { name: '연관 업무 후보' })
    expect(within(candidates).getByRole('link', { name: 'E-9' })).toHaveAttribute('href', '#/episodes/9?tab=overview')
    fireEvent.click(screen.getByRole('button', { name: 'A-10 관계 분석' }))
    expect(screen.getByLabelText('그래프 거래')).toHaveTextContent('1,2,4')
    expect(screen.getByRole('button', { name: 'A-10 관계 분석' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('table', { name: '연결 근거' })).toHaveTextContent('10')
    expect(screen.getByRole('link', { name: '소유주별' })).toHaveAttribute('href', props.ownerHref)
  })
  it('falls back and resets graph visibility when the inspected candidate disappears', () => {
    const view = render(<CaseRelated {...props} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'A-1 그래프 표시' }))
    view.rerender(<CaseRelated {...props} related={[related[1]]} lens="owner" />)
    expect(screen.getByLabelText('그래프 거래')).toHaveTextContent('1,2,4')
    expect(screen.getByTestId('reused-graph')).toHaveAttribute('data-lens', 'owner')
    expect(screen.getByRole('checkbox', { name: 'A-1 그래프 표시' })).toBeChecked()
  })
  it('keeps read-only and selection-count limits while leaving relationship inspection available', () => {
    const view = render(<CaseRelated {...props} editable={false} />)
    expect(screen.getByRole('checkbox', { name: 'E-9 선택' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'E-9 관계 분석' })).toBeEnabled()
    view.rerender(<CaseRelated {...props} selectedIds={Array.from({ length: 100 }, (_, i) => 1000 + i)} />)
    expect(screen.getByRole('checkbox', { name: 'E-9 선택' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'E-9 그래프 표시' })).toBeEnabled()
  })
})
