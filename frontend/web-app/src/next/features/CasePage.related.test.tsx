import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../dashboard-data'
import { PageHeaderContext } from '../page-header-context'
import { WorkspaceContext, type LedgerTransaction, type WorkspaceCase, type WorkspaceValue } from '../workspace-store'
import { CasePage } from './CasePage'

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })
const current: WorkspaceCase = { ...cases[0], caseId: 8100, assigneeId: 7, status: 'OPEN', workState: 'inProgress', revision: 1, transactionIds: [7000, 7001], alertCaseIds: [], comments: [], history: [] }
const candidate: WorkspaceCase = { ...current, caseId: 8200, kind: 'EPISODE', displayId: 'E-261115-000999', transactionIds: [7001, 7002], alertCaseIds: [current.caseId] }
const rows: LedgerTransaction[] = Array.from({ length: 3 }, (_, i) => ({ id: 7000 + i, displayId: `T-${7000 + i}`, date: '2026-11-15', occurredAt: `2026-11-15T12:0${i}:00Z`, typeCode: 3, probability: .8, suspicious: true, score: .95, amountUsd: 100, currency: 'USD', accountId: 900 + i, ownerId: 600 + i, fromAccountId: 900 + i, toAccountId: 901 + i, humanVerdict: null }))
function setup(query = '?tab=related', viewerId = 7) {
  const header = document.createElement('div'); document.body.append(header)
  const judgeTransaction = vi.fn()
  const value: WorkspaceValue = { records: [current, candidate], transactions: rows, rules: [], judgments: [], notifications: [], viewerId,
    openCase: vi.fn(), judgeCases: vi.fn(), bundleAlerts: vi.fn(), addComment: vi.fn(), judgeTransaction, saveRule: vi.fn(), transitionRule: vi.fn(), markNotificationRead: vi.fn() }
  const view = render(<WorkspaceContext.Provider value={value}><PageHeaderContext.Provider value={header}><CasePage route={new URL(`http://localhost/alerts/${current.caseId}${query}`)} /></PageHeaderContext.Provider></WorkspaceContext.Provider>)
  return { value, view, header }
}
describe('related investigation source layout', () => {
  it('opens actual shared evidence beside the candidate list and keeps graph scopes separate from verdict selection', () => {
    setup()
    expect(screen.getByRole('region', { name: '연관 업무 후보' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${candidate.displayId} 관계 분석` })).toBeInTheDocument()
    const graph = within(screen.getByRole('region', { name: '연관 그래프' }))
    expect(graph.getByRole('button', { name: '계좌 903 선택' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(`${candidate.displayId} 그래프 표시`))
    expect(graph.queryByRole('button', { name: '계좌 903 선택' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(`${candidate.displayId} 선택`)).not.toBeChecked()
    fireEvent.click(screen.getByLabelText(`${candidate.displayId} 선택`))
    expect(screen.getByRole('button', { name: '선택 1건 판정' })).toBeEnabled()
    expect(screen.getByLabelText(`${candidate.displayId} 그래프 표시`)).not.toBeChecked()
    const evidence = within(screen.getByRole('table', { name: '연결 근거' }))
    expect(evidence.getAllByText(/미제공/).length).toBeGreaterThan(0)
    expect(evidence.getAllByText(/7001/).length).toBeGreaterThan(0)
  })
  it('uses actual owner groups for the related owner view without permitting merged-graph transaction mutations', () => {
    setup('?tab=related&view=owner')
    const graph = within(screen.getByRole('region', { name: '연관 그래프' }))
    fireEvent.click(graph.getByRole('button', { name: '소유주 602 선택' }))
    expect(graph.getByRole('heading', { name: '소유주 602' })).toBeInTheDocument()
    expect(graph.getByRole('button', { name: '정상으로 판정' })).toBeDisabled()
    expect(graph.getByRole('button', { name: '이상으로 판정' })).toBeDisabled()
    fireEvent.click(graph.getByRole('button', { name: '거래 상세 닫기' }))
    expect(graph.queryByRole('button', { name: '거래 상세 닫기' })).not.toBeInTheDocument()
  })
  it('keeps another assignee read-only while allowing candidate relationship inspection', () => {
    setup('?tab=related', 99)
    expect(screen.getByLabelText(`${candidate.displayId} 선택`)).toBeDisabled()
    expect(screen.getByRole('button', { name: '판정하기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: `${candidate.displayId} 관계 분석` })).toBeEnabled()
    expect(screen.getByLabelText(`${candidate.displayId} 그래프 표시`)).toBeEnabled()
  })
})
