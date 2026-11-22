import { useEffect, useState } from 'react'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases, transactions as fixtureTransactions } from '../dashboard-data'
import { PageHeaderContext } from '../page-header-context'
import { WorkspaceContext, type WorkspaceValue } from '../workspace-store'
import { InvestigationPage } from './InvestigationPage'
import * as investigationSelectors from './investigation-selectors'
const records = cases.map(c => ({ ...c, revision: 1, alertCaseIds: [], comments: [], history: [] }))
const txs: WorkspaceValue['transactions'] = [
 { id: 7000, displayId: 'T-7000', date: '2026-11-15', occurredAt: '2026-11-15T10:00:00Z', typeCode: 3, probability: .82, suspicious: true, score: .96, amountUsd: 100, currency: 'USD', ownerId: 600, accountId: 900, fromAccountId: 900, toAccountId: 901, humanVerdict: null },
 { id: 7001, displayId: 'T-7001', date: '2026-11-15', occurredAt: '2026-11-15T11:00:00Z', typeCode: 4, probability: .9, suspicious: true, score: .8, amountUsd: 200, currency: 'USD', ownerId: 601, accountId: 901, fromAccountId: 901, toAccountId: 900, humanVerdict: null },
]
function mount(path: string, override: Partial<WorkspaceValue> = {}) {
 window.history.replaceState(null, '', `/#${path}`)
 const header = document.createElement('div'); document.body.append(header)
 const unused = () => { throw new Error('Unexpected action') }
 const value: WorkspaceValue = { records, transactions: txs, viewerId: 7, rules: [], judgments: [], notifications: [], openCase: vi.fn(), bundleAlerts: unused, judgeCases: unused, addComment: unused, judgeTransaction: unused, saveRule: unused, transitionRule: unused, markNotificationRead: vi.fn(), ...override }
 function Harness() {
  const [route, setRoute] = useState(() => new URL(window.location.hash.slice(1), 'https://aml.test'))
  useEffect(() => { const sync = () => setRoute(new URL(window.location.hash.slice(1), 'https://aml.test')); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync) }, [])
  return <div data-ui="aml-app"><PageHeaderContext value={header}><WorkspaceContext value={value}><InvestigationPage route={route} /></WorkspaceContext></PageHeaderContext></div>
 }
 render(<Harness />)
 return value
}
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks() })
describe('investigation workflows', () => {
 it('shows only the selected transaction membership in the related-case panel', async () => {
  const alert = { ...records.find(r=>r.kind==='ALERT')!, transactionIds:[7000] }
  const episode = { ...records.find(r=>r.kind==='EPISODE')!, transactionIds:[7000] }
  const unrelated = { ...records.filter(r=>r.kind==='ALERT')[1], transactionIds:[7001] }
  mount('/investigate/ledger', { records:[alert,episode,unrelated] })
  const panel = screen.getByRole('region', { name:'선택 거래와 연결된 Alert·Episode' })
  expect(within(panel).getByText('거래를 선택하세요.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name:'T-7000 선택' }))
  await within(panel).findByRole('link', { name:alert.displayId })
  expect(within(panel).getByRole('link', { name:episode.displayId })).toBeInTheDocument()
  expect(within(panel).queryByRole('link', { name:unrelated.displayId })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name:'T-7000 선택 해제' }))
  await within(panel).findByText('거래를 선택하세요.')
  expect(within(panel).queryAllByRole('link')).toHaveLength(0)
 })
 it('keeps search draft until Apply, and card/table links use numeric case IDs', async () => {
  mount('/investigate/alerts')
  const count = screen.getAllByTestId('investigation-card').length
  fireEvent.change(screen.getByLabelText('검색'), { target: { value: records[0].displayId } })
  expect(screen.getAllByTestId('investigation-card')).toHaveLength(count)
  fireEvent.submit(screen.getByRole('form', { name: '조사 필터' }))
  await waitFor(() => expect(screen.getAllByTestId('investigation-card')).toHaveLength(1))
  expect(screen.getByRole('link', { name: records[0].displayId })).toHaveAttribute('href', `#/alerts/${records[0].caseId}?tab=overview`)
  fireEvent.click(screen.getByRole('link', { name: '표 보기' }))
  await screen.findByRole('table', { name: 'Alert 목록' })
  expect(screen.getAllByRole('row')).toHaveLength(2)
 })
 it('restricts checkboxes to bundle mode, validates reason and preserves selection on failure', () => {
  const value = mount('/investigate/alerts?mode=bundle', { bundleAlerts: () => ({ ok: false, error: '변경된 Alert를 확인하세요.' }) })
  const owned = records.filter(r => r.kind === 'ALERT' && r.assigneeId === 7 && r.status === 'OPEN')
  fireEvent.click(screen.getByRole('checkbox', { name: `${owned[0].displayId} 선택` }))
  fireEvent.click(screen.getByRole('checkbox', { name: `${owned[1].displayId} 선택` }))
  fireEvent.click(screen.getByRole('button', { name: 'Episode로 묶기 (2)' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: 'Episode 만들기' })).toBeDisabled()
  fireEvent.change(within(dialog).getByLabelText('묶기 사유'), { target: { value: '같은 거래 흐름을 함께 조사합니다.' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Episode 만들기' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('변경된 Alert')
  expect(within(dialog).getByLabelText('묶기 사유')).toHaveValue('같은 거래 흐름을 함께 조사합니다.')
  expect(value.records).toHaveLength(records.length)
 })
 it('closes the bundle dialog when history leaves bundle mode without reopening on return', async () => {
  const bundleAlerts = vi.fn(() => ({ ok: false as const, error: 'Unexpected mutation' }))
  mount('/investigate/alerts?mode=bundle', { bundleAlerts })
  const owned = records.filter(r => investigationSelectors.canBundle(r, 7))
  fireEvent.click(screen.getByRole('checkbox', { name: `${owned[0].displayId} 선택` }))
  fireEvent.click(screen.getByRole('checkbox', { name: `${owned[1].displayId} 선택` }))
  fireEvent.click(screen.getByRole('button', { name: 'Episode로 묶기 (2)' }))
  fireEvent.change(screen.getByLabelText('묶기 사유'), { target: { value: '같은 흐름 조사' } })
  window.location.hash = '/investigate/alerts'
  await screen.findByRole('button', { name: '묶기 모드' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Episode 만들기' })).toBeNull()
  window.location.hash = '/investigate/alerts?mode=bundle'
  await screen.findByRole('button', { name: 'Episode로 묶기 (2)' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Episode로 묶기 (2)' }))
  expect(screen.getByLabelText('묶기 사유')).toHaveValue('같은 흐름 조사')
  expect(bundleAlerts).not.toHaveBeenCalled()
 })
 it('selects owner and account, filters incoming transfers, and deselects hierarchy', async () => {
  mount('/investigate/ledger')
  fireEvent.click(screen.getByRole('button', { name: '김OO · 600 선택' }))
  await screen.findByRole('button', { name: '김OO · 600 선택 해제' })
  fireEvent.click(screen.getByRole('button', { name: '계좌 900 선택' }))
  await screen.findByRole('button', { name: '계좌 900 선택 해제' })
  fireEvent.change(screen.getByLabelText('거래 방향'), { target: { value: 'incoming' } })
  const table = screen.getByRole('table', { name: '거래 목록' })
  expect(within(table).getByText('T-7001')).toBeInTheDocument()
  await waitFor(() => expect(within(table).queryByText('T-7000')).toBeNull())
  expect(within(table).getByRole('link', { name: records[0].displayId })).toHaveAttribute('href', '#/alerts/8100?tab=overview')
  fireEvent.click(screen.getByRole('button', { name: '김OO · 600 선택 해제' }))
  await waitFor(() => expect(screen.getByLabelText('거래 방향')).toBeDisabled())
  expect(within(table).getAllByRole('row')).toHaveLength(3)
 })
 it('bounds transaction and account DOM while exposing total and next-page controls', async () => {
  mount('/investigate/ledger', { transactions: fixtureTransactions.map(t => ({...t, displayId:`T-${t.id}`, occurredAt:`${t.date}T12:00:00Z`, fromAccountId:t.accountId,toAccountId:900+(t.id%47),currency:'USD',probability:.8,humanVerdict:null})) })
  const transactionTable = screen.getByRole('table', {name:'거래 목록'})
  expect(within(transactionTable).getAllByRole('row')).toHaveLength(26)
  expect(within(screen.getByRole('table', {name:'계좌 목록'})).getAllByRole('row')).toHaveLength(26)
  const pages = screen.getByRole('navigation', {name:'거래 페이지'})
  expect(within(pages).getByText(/전체 126건 중 1–25건/)).toBeInTheDocument()
  fireEvent.click(within(pages).getByRole('button', {name:'다음'}))
  await waitFor(()=>expect(within(pages).getByText(/26–50건/)).toBeInTheDocument())
  expect(within(transactionTable).getAllByRole('row')).toHaveLength(26)
  fireEvent.change(screen.getByLabelText('거래 페이지당'), {target:{value:'100'}})
  await waitFor(()=>expect(within(transactionTable).getAllByRole('row')).toHaveLength(101))
 })
 it('distinguishes loading from empty and retains an empty snapshot on refetch failure', async () => {
  mount('/investigate/alerts?state=loading')
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
  expect(screen.queryByTestId('investigation-card')).toBeNull()
  window.location.hash='/investigate/alerts?state=empty'
  await screen.findByText('조건에 맞는 업무가 없습니다')
  window.location.hash='/investigate/alerts?state=error'
  await screen.findByRole('alert')
  expect(screen.queryByTestId('investigation-card')).toBeNull()
 })
 it('exports only visible account and transaction pages when more than 25 records match', () => {
  const download = vi.spyOn(investigationSelectors,'downloadInvestigationCsv').mockImplementation(()=>undefined)
  mount('/investigate/ledger', {transactions:fixtureTransactions.map(t=>({...t,displayId:`T-${t.id}`,occurredAt:`${t.date}T12:00:00Z`,fromAccountId:t.accountId,toAccountId:900+(t.id%47),currency:'USD',probability:.8,humanVerdict:null}))})
  fireEvent.click(screen.getByRole('button',{name:'거래 현재 페이지 CSV'}))
  const transactionExport = download.mock.calls[0]
  expect(transactionExport[0]).toBe('거래')
  expect(transactionExport[1]).toHaveLength(26)
  const visibleTransactions = within(screen.getByRole('table',{name:'거래 목록'})).getAllByRole('button').map(button=>button.textContent)
  expect(transactionExport[1].slice(1).map(row=>row[0])).toEqual(visibleTransactions)
  fireEvent.click(screen.getByRole('button',{name:'계좌 현재 페이지 CSV'}))
  expect(download.mock.calls[1][1]).toHaveLength(26)
  const visibleAccounts = within(screen.getByRole('table',{name:'계좌 목록'})).getAllByRole('button').map(button=>Number(button.textContent?.replace('계좌 ','')))
  expect(download.mock.calls[1][1].slice(1).map(row=>row[0])).toEqual(visibleAccounts)
  fireEvent.click(screen.getByRole('button',{name:'소유주 현재 페이지 CSV'}))
  expect(download.mock.calls[2][1].length).toBeLessThanOrEqual(26)
 })
 it.each(['alerts', 'episodes'])('exports only the visible %s page', kind => {
  const download = vi.spyOn(investigationSelectors, 'downloadInvestigationCsv').mockImplementation(() => undefined)
  const source = records.find(row => row.kind === (kind === 'alerts' ? 'ALERT' : 'EPISODE'))!
  const pagedRecords = Array.from({ length: 30 }, (_, index) => ({ ...source, caseId: 9000 + index, displayId: `${kind === 'alerts' ? 'A' : 'E'}-261115-${String(index).padStart(6, '0')}` }))
  mount(`/investigate/${kind}?view=table&page=2`, { records: pagedRecords })
  fireEvent.click(screen.getByRole('button', { name: '현재 페이지 CSV' }))
  const exported = download.mock.calls[0][1].slice(1).map(row => row[1])
  const visible = within(screen.getByRole('table')).getAllByRole('link').map(link => link.textContent)
  expect(exported).toEqual(visible)
  expect(exported).toHaveLength(5)
 })
 it('renders UTC ledger timestamps on the next KST calendar day', () => {
  mount('/investigate/ledger', { transactions: [{ ...txs[0], occurredAt: '2026-11-15T16:30:00Z' }] })
  const expected = new Date('2026-11-15T16:30:00Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  expect(within(screen.getByRole('table', { name: '거래 목록' })).getByText(expected)).toBeInTheDocument()
 })
 it('opens a selected transaction on its actual page and respects explicit pages and local filters', async () => {
  const transactions = fixtureTransactions.map(t=>({...t,displayId:`T-${t.id}`,occurredAt:`${t.date}T12:00:00Z`,fromAccountId:t.accountId,toAccountId:900+(t.id%47),currency:'USD' as const,probability:.8,humanVerdict:null}))
  mount(`/investigate/ledger?transaction=${transactions[0].id}`, { transactions })
  const table = screen.getByRole('table', { name: '거래 목록' })
  expect(within(table).getByRole('button', { name: `T-${transactions[0].id} 선택 해제` })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: '거래 페이지' })).toHaveTextContent('126–126건')
  window.location.hash=`/investigate/ledger?transaction=${transactions[0].id}&transactionPage=1`
  await waitFor(() => expect(within(table).queryByRole('button', { name: `T-${transactions[0].id} 선택 해제` })).toBeNull())
  window.location.hash=`/investigate/ledger?transaction=${transactions[0].id}&q=does-not-match`
  await screen.findByText('조건에 맞는 거래가 없습니다.')
  expect(screen.queryByRole('complementary', { name: '선택한 거래' })).toBeNull()
 })
 it.each(['owner', 'account'] as const)('opens a selected %s on its actual page without overriding explicit pages or filters', async kind => {
  const transactions = Array.from({ length: 40 }, (_, index) => ({ ...txs[0], id: 8000+index, displayId: `T-paging-${index}`, ownerId: 1000+index, accountId: 2000+index, fromAccountId: 2000+index, toAccountId: 3000+index }))
  const target = kind==='owner' ? 1039 : 2039
  const label = kind==='owner' ? '소유주' : '계좌'
  mount(`/investigate/ledger?${kind}=${target}`, { transactions })
  const table = screen.getByRole('table', { name: `${label} 목록` })
  expect(table.querySelectorAll('tr[data-selected="true"]')).toHaveLength(1)
  expect(screen.getByRole('navigation', { name: `${label} 페이지` })).toHaveTextContent('2/2페이지')
  window.location.hash=`/investigate/ledger?${kind}=${target}&${kind}Page=1`
  await waitFor(() => expect(table.querySelectorAll('tr[data-selected="true"]')).toHaveLength(0))
  window.location.hash=`/investigate/ledger?${kind}=${target}&q=does-not-match`
  await screen.findByText('조건에 맞는 거래가 없습니다.')
  expect(table.querySelectorAll('tr[data-selected="true"]')).toHaveLength(0)
 })
 it('shows server-query-required instead of a misleading empty ledger for oversized sources', () => {
  const oversized = new Proxy({length:10001} as WorkspaceValue['transactions'],{get(target,key){if (/^\d+$/.test(String(key))) throw new Error('Oversized source row read');return Reflect.get(target,key)}})
  mount('/investigate/ledger',{transactions:oversized})
  expect(screen.getByRole('status')).toHaveTextContent('서버 조회가 필요합니다')
  expect(screen.queryByRole('table',{name:'거래 목록'})).toBeNull()
 })
 it('keeps the loaded list after refetch error and retries it', async () => {
  mount('/investigate/episodes?state=error')
  const count = screen.getAllByTestId('investigation-card').length
  expect(screen.getByRole('alert')).toHaveTextContent('마지막으로 불러온')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.getAllByTestId('investigation-card')).toHaveLength(count)
 })
})
