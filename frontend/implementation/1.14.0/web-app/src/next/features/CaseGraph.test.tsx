import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerTransaction } from '../workspace-store'
import { CaseGraph, CaseTransactionTable } from './CaseGraph'

afterEach(cleanup)
function transactions(count: number): LedgerTransaction[] {
  return Array.from({ length: count }, (_, i) => ({ id: 7000 + i, displayId: `T-${7000 + i}`, date: '2026-11-15', occurredAt: `2026-11-15T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`, typeCode: 3, probability: .8, suspicious: true, score: .95, amountUsd: 100, currency: 'USD', accountId: 900 + i, ownerId: 600 + i, fromAccountId: 900 + i, toAccountId: 901 + i, humanVerdict: null }))
}
describe('bounded case evidence rendering', () => {
  it('steps through evidence in timestamp order even when the server page is unordered', () => {
    const sorted = transactions(3), rows = [sorted[2], sorted[0], sorted[1]]
    render(<CaseGraph rows={rows} ownershipLedger={new Map()} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '거래 재생 처음으로' }))
    fireEvent.click(screen.getByRole('button', { name: '다음 거래' }))
    expect(screen.getByRole('heading', { name: '분석 거래 1건' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sorted[0].displayId })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: sorted[2].displayId })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이전 거래' }))
    expect(screen.getByRole('heading', { name: '분석 거래 0건' })).toBeInTheDocument()
  })
  it('selects one directed connection and shows only its actual evidence', () => {
    const rows = transactions(3)
    render(<CaseGraph rows={rows} ownershipLedger={new Map()} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('연결 선택'), { target: { value: 'account:900>account:901' } })
    expect(screen.getByRole('heading', { name: '선택 연결 거래 1건' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: rows[0].displayId })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '연결 선택 해제' }))
    expect(screen.getByRole('heading', { name: '분석 거래 3건' })).toBeInTheDocument()
  })
  it('links keyboard node selection to its evidence and clears with Escape', () => {
    render(<CaseGraph rows={transactions(3)} ownershipLedger={new Map()} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    const node = screen.getByRole('button', { name: '계좌 900 선택' })
    fireEvent.keyDown(node, { key: 'Enter' })
    expect(screen.getByRole('heading', { name: '계좌 900 연결 거래 1건' })).toBeInTheDocument()
    fireEvent.keyDown(node, { key: 'Escape' })
    expect(screen.getByRole('heading', { name: '분석 거래 3건' })).toBeInTheDocument()
  })
  it('renders 25 rows by default, paginates and never offers more than 100', () => {
    const rows = transactions(130), select = vi.fn()
    render(<CaseTransactionTable rows={rows} name="sample" onSelect={select} />)
    expect(screen.getByRole('heading', { name: '근거 거래 130건' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26)
    expect(screen.getByText('총 130건 · 1–25건 표시')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('총 130건 · 26–50건 표시')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'T-7025' }))
    expect(select).toHaveBeenCalledWith(rows[25])
    fireEvent.change(screen.getByLabelText('페이지당 항목 수'), { target: { value: 100 } })
    expect(screen.getAllByRole('row')).toHaveLength(101)
    expect(screen.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['25', '50', '100'])
  })
  it('selects an actual account neighborhood and updates its evidence table', () => {
    const rows = transactions(3)
    render(<CaseGraph rows={rows} ownershipLedger={new Map(rows.map(tx => [tx.accountId, tx.ownerId]))} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '계좌 901 선택' }))
    expect(screen.getByRole('heading', { name: '계좌 901 연결 거래 2건' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '계좌 선택 해제' }))
    expect(screen.getByRole('heading', { name: '분석 거래 3건' })).toBeInTheDocument()
  })
  it('caps relationship nodes and distinguishes omitted evidence from the table total', () => {
    const rows = transactions(250)
    const { container } = render(<CaseGraph rows={rows} ownershipLedger={new Map(rows.map(tx => [tx.accountId, tx.ownerId]))} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    expect(container.querySelectorAll('[data-case="graph-node"]')).toHaveLength(200)
    expect(container.querySelectorAll('[data-case="edge"]').length).toBeLessThanOrEqual(400)
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('생략: 노드 51개, 연결 51개, 거래 51건'))).toBe(true)
    expect(screen.getByRole('heading', { name: '분석 거래 250건' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26)
  })
  it('applies analysis dates only after submit and retains the graph for an invalid period', () => {
    const rows = transactions(3)
    render(<CaseGraph rows={rows} ownershipLedger={new Map(rows.map(tx => [tx.accountId, tx.ownerId]))} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('거래 시작일'), { target: { value: '2026-11-16' } })
    expect(screen.getByRole('heading', { name: '분석 거래 3건' })).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('form', { name: '분석 기간' }))
    expect(screen.getByRole('heading', { name: '분석 거래 0건' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('거래 종료일'), { target: { value: '2026-11-14' } })
    fireEvent.submit(screen.getByRole('form', { name: '분석 기간' }))
    expect(screen.getByRole('alert')).toHaveTextContent('종료일은 시작일 이후')
    expect(screen.getByRole('heading', { name: '분석 거래 0건' })).toBeInTheDocument()
  })
  it('requests a server neighborhood for oversized input without touching transaction rows', () => {
    const inaccessible = new Proxy(new Array<LedgerTransaction>(10_001), {
      get(target, property) {
        if (property === 'length') return target.length
        throw new Error(`Oversized input was accessed: ${String(property)}`)
      },
    })
    const { container } = render(<CaseGraph rows={inaccessible} ownershipLedger={new Map()} lens="pattern" name="sample" editable onVerdict={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('서버에서 기간·계좌 범위를 좁힌 이웃 조회가 필요합니다')
    expect(container.querySelectorAll('[data-case="graph-node"], [data-case="edge"]')).toHaveLength(0)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
