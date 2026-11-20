import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../dashboard-data'
import { PageHeaderContext } from '../page-header-context'
import { WorkspaceContext, type WorkspaceCase, type WorkspaceValue } from '../workspace-store'
import { InvestigationPage } from './InvestigationPage'

const alert: WorkspaceCase = { ...cases[0], transactionIds: [7100, 7101], revision: 1, alertCaseIds: [], comments: [], history: [] }
const episode: WorkspaceCase = { ...alert, caseId: 9900, displayId: 'E-261115-009900', kind: 'EPISODE', alertCaseIds: [8100, 8101] }
const transactions: WorkspaceValue['transactions'] = [
 { id: 7100, displayId: 'T-7100', date: '2026-11-14', occurredAt: '2026-11-14T16:00:00Z', typeCode: 3, probability: .82, suspicious: true, score: .96, amountUsd: 100, currency: 'USD', ownerId: 600, accountId: 900, fromAccountId: 900, toAccountId: 901, humanVerdict: null },
 { id: 7101, displayId: 'T-7101', date: '2026-11-15', occurredAt: '2026-11-15T10:00:00Z', typeCode: 3, probability: .82, suspicious: true, score: .96, amountUsd: 200, currency: 'USD', ownerId: 601, accountId: 901, fromAccountId: 901, toAccountId: 902, humanVerdict: null },
]
function mount(path: string, override: Partial<WorkspaceValue> = {}) {
 const header = document.createElement('div'); document.body.append(header)
 const unused = () => { throw new Error('Unexpected mutation') }
 const value: WorkspaceValue = { records: [alert, episode], transactions, viewerId: 7, rules: [], judgments: [], notifications: [], openCase: vi.fn(), bundleAlerts: unused, judgeCases: unused, addComment: unused, judgeTransaction: unused, saveRule: unused, transitionRule: unused, markNotificationRead: vi.fn(), ...override }
 render(<div data-ui="aml-app"><PageHeaderContext value={header}><WorkspaceContext value={value}><InvestigationPage route={new URL(path,'https://aml.test')} /></WorkspaceContext></PageHeaderContext></div>)
 return value
}
afterEach(() => { cleanup(); document.body.innerHTML = '' })
describe('investigation list evidence and panel layout', () => {
 it('renders received account pairs and a complete KST transaction period without replacing them with creation date', () => {
  mount('/investigate/alerts')
  const card = screen.getByTestId('investigation-card')
  expect(within(card).getByText('900 → 901 · 901 → 902')).toBeInTheDocument()
  const period = within(card).getByRole('group', {name:'거래 기간 · KST'})
  expect([...period.querySelectorAll('time')].map(node=>node.dateTime)).toEqual(['2026-11-14T16:00:00.000Z','2026-11-15T10:00:00.000Z'])
  expect(period).toHaveTextContent('2026. 11. 15.')
  const footer = card.querySelector('footer')!
  expect(within(footer).getByText(alert.createdDate)).toHaveAttribute('title','탐지일')
  expect(within(footer).getByText(alert.assignee)).toBeInTheDocument()
 })
 it('withholds an incomplete period and labels the observed account subset', () => {
  mount('/investigate/alerts', {transactions:[transactions[0]]})
  const card = screen.getByTestId('investigation-card')
  expect(within(card).getByRole('group',{name:'거래 기간 · KST'})).toHaveTextContent('미제공')
  expect(within(card).getByText('900 → 901')).toBeInTheDocument()
  expect(within(card).getByText('근거 거래 1/2건 확인')).toBeInTheDocument()
 })
 it('opens a case through the explicit new-tab control and retains the ordinary ID link', () => {
  const value = mount('/investigate/alerts')
  expect(screen.getByRole('link',{name:alert.displayId})).toHaveAttribute('href',`#/alerts/${alert.caseId}?tab=overview`)
  fireEvent.click(screen.getByRole('button',{name:`${alert.displayId} 새 탭으로 열기`}))
  expect(value.openCase).toHaveBeenCalledWith(alert.caseId)
 })
 it('shows actual Episode membership/account counts with filters inside its panel header', () => {
  mount('/investigate/episodes')
  const panel = screen.getByRole('region',{name:'Episode 목록'})
  expect(within(panel.querySelector('header')!).getByRole('form',{name:'조사 필터'})).toBeInTheDocument()
  const card = within(panel).getByTestId('investigation-card')
  expect(within(card).getByRole('group',{name:'Alert 수'})).toHaveTextContent('2건')
  expect(within(card).getByRole('group',{name:'관련 계좌'})).toHaveTextContent('3개')
 })
 it.each(['alerts','episodes'])('keeps the source column order and separate model/human signals in the %s table', kind => {
  mount(`/investigate/${kind}?view=table`)
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('columnheader').map(th=>th.textContent)).toEqual(kind==='alerts'
   ? ['ID','패턴','모델 점수·사람 판정','담당자','업무 상태','경과일','계좌','기간 · KST','거래','금액 (USD)']
   : ['ID','패턴','모델 점수·사람 판정','담당자','업무 상태','경과일','계좌','기간 · KST','Alert 수','관련 계좌','거래','금액 (USD)'])
  expect(within(table).getByText('미판정')).toBeInTheDocument()
 })
 it('leaves the Ledger related-card variant unchanged', () => {
  mount('/investigate/ledger?transaction=7100')
  const panel = screen.getByRole('region',{name:'선택 거래와 연결된 Alert·Episode'})
  for (const card of within(panel).getAllByTestId('investigation-card')) {
   expect(card.querySelector('footer')).toBeNull()
   expect(within(card).queryByRole('button',{name:/새 탭으로 열기/})).toBeNull()
   expect(within(card).getByText('모델 점수')).toBeInTheDocument()
  }
 })
})
