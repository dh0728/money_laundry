import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageHeaderContext } from '../page-header-context'
import type { JudgmentRecord } from '../workspace-store'
import { ReportPage } from './ReportPage'
import { downloadCsv, downloadJudgmentPdf } from './report-io'

const judgments = vi.hoisted(() => [
  { id: 'J-261115-000001', caseIds: [8100], transactionIds: [7000], displayIds: ['A-261109-000041'], verdict: 'normal', reason: '반복 거래 확인', reviewer: '김OO', at: '2026-11-15T10:00:00+09:00', cases: [], reportText: '첫 번째 고정 보고서' },
  { id: 'J-261114-000002', caseIds: [8101], transactionIds: [7001], displayIds: ['E-261110-000042'], verdict: 'abnormal', reason: '출처 확인 필요', reviewer: '박OO', at: '2026-11-14T11:00:00+09:00', cases: [], reportText: '두 번째 고정 보고서' },
] satisfies JudgmentRecord[])
vi.mock('../workspace-store', () => ({ useWorkspace: () => ({ judgments }), caseHref: () => '#/alerts/8100' }))
vi.mock('./report-io', () => ({ downloadCsv: vi.fn(), downloadJudgmentPdf: vi.fn().mockResolvedValue(undefined), MAX_PDF_JUDGMENTS: 25 }))
afterEach(() => { cleanup(); vi.clearAllMocks(); judgments.splice(2); document.querySelector('[data-test-header]')?.remove() })
function setup(search = '') {
  const header = document.createElement('div'); header.dataset.testHeader = ''; document.body.append(header)
  const page = (query: string) => <PageHeaderContext value={header}><ReportPage route={new URL(`https://aml.local/report${query}`)} /></PageHeaderContext>
  const view = render(page(search))
  return { ...view, reroute: (query: string) => view.rerender(page(query)) }
}

describe('report selection journey', () => {
  it('uses the same visible selection in table, card, and one PDF download', async () => {
    const { reroute } = setup()
    expect(screen.getByRole('button', { name: '선택 0건 PDF 다운로드' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '현재 페이지 전체 선택' }))
    expect(new URL(`https://aml.local/${window.location.hash}`).hash).toContain('selected=J-261115-000001%2CJ-261114-000002')
    reroute('?selected=J-261115-000001,J-261114-000002&verdict=normal')
    expect(screen.getByText('판정 기록 1건', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'J-261115-000001 선택' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '선택 1건 PDF 다운로드' }))
    await waitFor(() => expect(downloadJudgmentPdf).toHaveBeenCalledExactlyOnceWith([judgments[0]]))
    reroute('?view=cards&selected=J-261115-000001,J-261114-000002&verdict=normal')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'J-261115-000001 선택' })).toBeChecked()
    expect(screen.getByRole('button', { name: '선택 1건 PDF 다운로드' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '현재 페이지 CSV' }))
    expect(downloadCsv).toHaveBeenCalledOnce()
    expect(vi.mocked(downloadCsv).mock.calls[0][2]).toHaveLength(1)
    expect(vi.mocked(downloadCsv).mock.calls[0][2][0][0]).toBe(judgments[0].id)
  })
  it.each(['success', 'failure'])('keeps the PDF invoker focusable during a pending download and after %s', async outcome => {
    let finish!: () => void
    let fail!: (error: Error) => void
    vi.mocked(downloadJudgmentPdf).mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }))
    setup('?selected=J-261115-000001')
    const download = screen.getByRole('button', { name: '선택 1건 PDF 다운로드' })
    download.focus()
    fireEvent.click(download)
    expect(download).toHaveAttribute('aria-disabled', 'true')
    expect(download).toBeEnabled()
    expect(download).toHaveFocus()
    fireEvent.click(download)
    expect(downloadJudgmentPdf).toHaveBeenCalledTimes(1)
    await act(async () => { if (outcome === 'success') finish(); else fail(new Error('PDF 만들기 실패')) })
    expect(download).toHaveFocus()
    expect(download).not.toHaveAttribute('aria-disabled', 'true')
    expect(download).toBeEnabled()
    expect(screen.getByRole(outcome === 'success' ? 'status' : 'alert')).toHaveTextContent(outcome === 'success' ? '1건의 판정 보고서' : 'PDF 만들기 실패')
  })
  it.each(['success', 'failure'])('does not reclaim focus after the user moves during a PDF %s', async outcome => {
    let finish!: () => void
    let fail!: (error: Error) => void
    vi.mocked(downloadJudgmentPdf).mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }))
    setup('?selected=J-261115-000001')
    const download = screen.getByRole('button', { name: '선택 1건 PDF 다운로드' })
    download.focus()
    fireEvent.click(download)
    const search = screen.getByRole('searchbox')
    search.focus()
    await act(async () => { if (outcome === 'success') finish(); else fail(new Error('PDF 만들기 실패')) })
    expect(search).toHaveFocus()
  })
  it('keeps an invalid selection disabled after a pending PDF finishes without reclaiming focus', async () => {
    let finish!: () => void
    vi.mocked(downloadJudgmentPdf).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const { reroute } = setup('?selected=J-261115-000001')
    fireEvent.click(screen.getByRole('button', { name: '선택 1건 PDF 다운로드' }))
    const search = screen.getByRole('searchbox')
    search.focus()
    reroute('?selected=missing')
    await act(async () => finish())
    expect(search).toHaveFocus()
    expect(screen.getByRole('button', { name: '선택 0건 PDF 다운로드' })).toBeDisabled()
    expect(downloadJudgmentPdf).toHaveBeenCalledExactlyOnceWith([judgments[0]])
  })
  it('does not restore report focus after leaving the report while a PDF finishes', async () => {
    let finish!: () => void
    vi.mocked(downloadJudgmentPdf).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const { rerender } = setup('?selected=J-261115-000001')
    const download = screen.getByRole('button', { name: '선택 1건 PDF 다운로드' })
    download.focus()
    fireEvent.click(download)
    rerender(<button>이전 화면</button>)
    const destination = screen.getByRole('button', { name: '이전 화면' })
    destination.focus()
    await act(async () => finish())
    expect(destination).toHaveFocus()
    expect(download).not.toBeInTheDocument()
  })
  it.each(['table', 'cards'])('renders UTC judgment timestamps on the next KST day in %s view', view => {
    const at = '2026-11-15T16:30:00Z'
    judgments.push({ ...judgments[0], id: 'J-261116-000003', at })
    setup(`?view=${view}`)
    const time = document.querySelector(`time[datetime="${at}"]`)
    expect(time).toHaveTextContent(new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))
  })
  it('keeps the last empty snapshot on refetch error and retries without data fabrication', () => {
    const { reroute } = setup('?state=empty')
    expect(screen.getByText('조건에 맞는 판정 기록이 없습니다')).toBeInTheDocument()
    reroute('?state=error')
    expect(screen.getByRole('alert')).toHaveTextContent('마지막으로 불러온 판정 기록')
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
  it('renders only one bounded page and excludes selected IDs on other pages', () => {
    judgments.push(...Array.from({ length: 26 }, (_, index) => ({ ...judgments[0], id: `J-261115-${String(index + 3).padStart(6, '0')}` })))
    setup('?page=2&selected=J-261115-000001,J-261115-000026')
    expect(screen.getByText('전체 28건 · 26~28건 표시')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '선택 1건 PDF 다운로드' })).toBeEnabled()
    expect(screen.queryByRole('checkbox', { name: 'J-261115-000001 선택' })).toBeNull()
  })
  it('opens a direct judgment link on its bounded page while respecting later explicit page navigation', async () => {
    judgments.push(...Array.from({ length: 26 }, (_, index) => ({ ...judgments[0], id: `J-261115-${String(index + 3).padStart(6, '0')}` })))
    const { reroute } = setup('?selected=J-261115-000026')
    expect(screen.getByText('전체 28건 · 26~28건 표시')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'J-261115-000026 선택' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '선택 1건 PDF 다운로드' }))
    await waitFor(() => expect(downloadJudgmentPdf).toHaveBeenCalledExactlyOnceWith([judgments[25]]))
    fireEvent.click(screen.getByRole('checkbox', { name: 'J-261115-000027 선택' }))
    const selectedRoute = new URL(window.location.hash.slice(1), 'https://aml.local')
    expect(selectedRoute.searchParams.get('page')).toBe('2')
    expect(selectedRoute.searchParams.get('selected')).toBe('J-261115-000026,J-261115-000027')
    reroute(selectedRoute.search)
    fireEvent.click(screen.getByRole('button', { name: '이전 페이지' }))
    const previousRoute = new URL(window.location.hash.slice(1), 'https://aml.local')
    expect(previousRoute.searchParams.get('page')).toBe('1')
    expect(previousRoute.searchParams.has('selected')).toBe(false)
    reroute('?page=1&selected=J-261115-000026')
    expect(screen.getByText('전체 28건 · 1~25건 표시')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '선택 0건 PDF 다운로드' })).toBeDisabled()
  })
  it('disables a PDF batch larger than the sample rendering ceiling', () => {
    judgments.push(...Array.from({ length: 24 }, (_, index) => ({ ...judgments[0], id: `J-261115-${String(index + 3).padStart(6, '0')}` })))
    setup(`?pageSize=100&selected=${judgments.map(row => row.id).join(',')}`)
    expect(screen.getByRole('button', { name: '선택 26건 PDF 다운로드' })).toBeDisabled()
    expect(downloadJudgmentPdf).not.toHaveBeenCalled()
  })
})
