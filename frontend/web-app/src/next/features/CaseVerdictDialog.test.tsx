import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../dashboard-data'
import { WorkspaceContext, type WorkspaceCase, type WorkspaceValue } from '../workspace-store'
import { CaseVerdictDialog } from './CaseVerdictDialog'

afterEach(cleanup)
const item: WorkspaceCase = { ...cases[0], revision: 2, alertCaseIds: [], comments: [], history: [] }
const saved = { id: 'J-261115-000001', caseIds: [item.caseId], transactionIds: item.transactionIds, displayIds: [item.displayId], verdict: 'abnormal' as const, reason: '분산 송금 근거 확인', reviewer: '김OO', at: '2026-11-15T12:00:00Z', cases: [item], reportText: '샘플 보고서' }
function setup(records = [item]) {
  const judgeCases = vi.fn<WorkspaceValue['judgeCases']>().mockReturnValue({ ok: true, value: saved })
  const value: WorkspaceValue = { records, transactions: [], rules: [], judgments: [], notifications: [], viewerId: item.assigneeId,
    openCase: vi.fn(), judgeCases, bundleAlerts: vi.fn(), addComment: vi.fn(), judgeTransaction: vi.fn(), saveRule: vi.fn(), transitionRule: vi.fn(), markNotificationRead: vi.fn() }
  render(<WorkspaceContext.Provider value={value}><CaseVerdictDialog ids={records.map(record => record.caseId)} open onOpenChange={vi.fn()} /></WorkspaceContext.Provider>)
  return judgeCases
}
describe('case verdict', () => {
  it('requires verdict, reason and explicit confirmation before saving, then enables returned report', () => {
    const save = setup()
    expect(screen.getByRole('button', { name: '판정 완료' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '보고서 다운로드' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('이상'))
    fireEvent.change(screen.getByLabelText('판정 사유'), { target: { value: '분산 송금 근거 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '판정 완료' }))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByText('최종 판정을 저장할까요?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '확인 후 저장' }))
    expect(save).toHaveBeenCalledWith([item.caseId], 'abnormal', '분산 송금 근거 확인', { expectedRevisions: { [item.caseId]: 2 }, scenario: 'success' })
    expect(screen.getByRole('status')).toHaveTextContent('판정이 저장되었습니다')
    expect(screen.getByRole('link', { name: '보고서 다운로드' })).toHaveAttribute('href', '#/report?selected=J-261115-000001')
  })
  it('preserves entered reason and verdict after a save conflict', () => {
    const save = setup()
    save.mockReturnValue({ ok: false, conflict: true, error: '다른 검토자가 변경했습니다.' })
    fireEvent.click(screen.getByLabelText('정상'))
    fireEvent.change(screen.getByLabelText('판정 사유'), { target: { value: '실제 거래 관계 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '판정 완료' }))
    fireEvent.click(screen.getByRole('button', { name: '확인 후 저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('다른 검토자가 변경했습니다')
    expect(screen.getByLabelText('판정 사유')).toHaveValue('실제 거래 관계 확인')
    expect(screen.getByLabelText('정상')).toBeChecked()
    expect(screen.getByRole('button', { name: '보고서 다운로드' })).toBeDisabled()
  })
  it('blocks both another assignee and closed items, including a mixed bulk selection', () => {
    const save = setup([item, { ...item, caseId: 999, assigneeId: item.assigneeId + 1 }])
    expect(screen.getByRole('button', { name: '판정 완료' })).toBeDisabled()
    expect(screen.getByText(/담당자이면서 처리 완료 전인 항목만/)).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })
})
