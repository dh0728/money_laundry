import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import Transactions from './Transactions'
import { buildTransactionIndex } from './transactionIndex'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v22 Transactions three-section hierarchy', () => {
  it('renders every hierarchy stage in one document flow', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transactions-explorer"')
    expect(markup).toContain('data-testid="owner-section"')
    expect(markup).toContain('data-testid="account-section"')
    expect(markup).toContain('data-testid="transaction-section"')
    expect(markup).not.toContain('max-h-[610px]')
  })

  it('builds deterministic owner → account → transaction relationships', () => {
    const index = buildTransactionIndex(records)
    expect(index.owners.length).toBeGreaterThan(0)
    expect(index.accounts.length).toBeGreaterThan(0)
    expect(index.transactions.length).toBeGreaterThan(0)
    const owner = index.owners[0]
    expect(owner.accountIds.length).toBeGreaterThan(0)
    expect(owner.transactionIds.length).toBeGreaterThan(0)
    for (const accountId of owner.accountIds) {
      expect(index.accounts.some(account => account.id === accountId && account.owner === owner.name)).toBe(true)
    }
  })

  it('renders an exact transaction target through the four-stage explorer', () => {
    const transaction = buildTransactionIndex(records).transactions[0]
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(3)
    expect(markup).toContain('data-testid="selected-transaction"')
    expect(markup).toContain(transaction.fromOwner)
    expect(markup).toContain(transaction.fromAccount)
    expect(markup).toContain(transaction.id)
  })

  it('renders the Korean page title and explorer controls', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('>거래 내역</h1>')
    expect(markup).toContain('소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다.')
    expect(markup).toContain('aria-label="거래 내역 검색"')
    expect(markup).toContain('date-range-control')
    expect(markup).toContain('transaction-filter-trigger')
    expect(markup).toContain('data-testid="transactions-explorer"')
  })

  it('separates owner, account, transaction, and detail stages and exposes linked AML records', () => {
    const index = buildTransactionIndex(records)
    const transaction = index.transactions.find(item => item.recordIds.length > 0)!
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    expect(markup.indexOf('data-testid="owner-section"')).toBeLessThan(markup.indexOf('data-testid="account-section"'))
    expect(markup.indexOf('data-testid="account-section"')).toBeLessThan(markup.indexOf('data-testid="transaction-section"'))
    expect(markup.indexOf('data-testid="transaction-section"')).toBeLessThan(markup.indexOf('data-testid="transaction-detail"'))
    expect(markup).toContain(`aria-label="${transaction.recordIds[0]} 상세 보기"`)
  })

  it('uses three explicit panes without hierarchy icons or an empty checkbox gutter', () => {
    const transaction = buildTransactionIndex(records).transactions[0]
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    expect(markup).toContain('data-testid="owner-section"')
    expect(markup).toContain('data-testid="account-section"')
    expect(markup).toContain('data-testid="transaction-section"')
    expect(markup.indexOf('data-testid="owner-section"')).toBeLessThan(markup.indexOf('data-testid="account-section"'))
    expect(markup.indexOf('data-testid="account-section"')).toBeLessThan(markup.indexOf('data-testid="transaction-section"'))
    expect(markup).not.toContain('>계층<')
    expect(markup).not.toMatch(/lucide-(user-round|landmark|arrow-up-right|arrow-down-left)/)
  })

  it('keeps native scrolling on the owner list instead of the whole explorer', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transactions-explorer"')
    expect(markup).toContain('data-testid="owner-scroll-list"')
    expect(markup).toContain('transaction-owner-scroll')
    expect(markup).not.toContain('transactions-explorer-scroll')
  })

  it('separates Alert and Episode links and exposes period/filter controls', () => {
    const transaction = buildTransactionIndex(records).transactions.find(item => item.recordIds.some(id => id.startsWith('ALT-')) && item.recordIds.some(id => id.startsWith('EP-')))!
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} onOpenRecord={() => {}} />)
    expect(markup).toContain('>연결 Alert<')
    expect(markup).toContain('>연결 Episode<')
    expect(markup).not.toContain('선택 소유주는 고정하고 아래 목록을 탐색')
    expect(markup).toContain('border-foreground bg-foreground text-background')
    expect(markup).toContain('의 계좌')
    expect(markup).not.toContain('>—<')
    expect(markup).toContain('date-range-control')
    expect(markup).toContain('transaction-filter-trigger')
    expect(markup).toContain('transactions-flow')
    expect(markup).toContain('record-link')
  })

  it('applies transaction date, direction, status, and payment filters to transaction rows', async () => {
    const module = await import('./TransactionsV22') as unknown as {
      passesFilters?: (
        row: { at?: string; direction?: '송금' | '수취'; suspicious?: boolean; format?: string },
        range: { from?: Date; to?: Date } | undefined,
        filters: Array<{ field: 'direction' | 'status' | 'format'; value: string }>,
      ) => boolean
    }
    expect(module.passesFilters).toBeTypeOf('function')
    const row = { at: '2026-09-08 10:04', direction: '송금' as const, suspicious: true, format: 'ACH' }
    expect(module.passesFilters!(row, { from: new Date(2026, 8, 8), to: new Date(2026, 8, 8) }, [
      { field: 'direction', value: '송금' }, { field: 'status', value: '의심' }, { field: 'format', value: 'ACH' },
    ])).toBe(true)
    expect(module.passesFilters!(row, { from: new Date(2026, 8, 9), to: new Date(2026, 8, 9) }, [])).toBe(false)
    expect(module.passesFilters!(row, undefined, [{ field: 'status', value: '정상' }])).toBe(false)
  })

  it('opens the requested owner and account beyond the former owner-page boundary', () => {
    const index = buildTransactionIndex(records)
    const owner = index.owners[42]
    const markup = html(<Transactions records={records} target={{ type: 'owner', owner: owner.name }} />)
    expect(markup).toContain(`${owner.name}의 계좌`)
    expect(markup).toContain(owner.accountIds[0])
  })

  it('opens the requested account under its owner with that account’s transactions', () => {
    const index = buildTransactionIndex(records)
    const account = index.accounts[42]
    const markup = html(<Transactions records={records} target={{ type: 'account', account: account.id }} />)
    expect(markup).toContain(`${account.owner}의 계좌`)
    expect(markup).toContain(`${account.id}의 거래 내역`)
    expect(markup).toContain(account.transactionIds[0])
  })

  it('activates a table row with Enter only when the row itself owns focus', async () => {
    const module = await import('./components/data-table/data-table') as unknown as {
      shouldActivateTableRow?: (key: string, originatedOnRow: boolean) => boolean
      toggleSingleSelectedId?: (current: string | null | undefined, clicked: string) => string | null
    }
    expect(module.shouldActivateTableRow).toBeTypeOf('function')
    expect(module.shouldActivateTableRow!('Enter', true)).toBe(true)
    expect(module.shouldActivateTableRow!('Enter', false)).toBe(false)
    expect(module.shouldActivateTableRow!(' ', true)).toBe(false)
    expect(module.toggleSingleSelectedId).toBeTypeOf('function')
    expect(module.toggleSingleSelectedId!('TX-1', 'TX-1')).toBeNull()
    expect(module.toggleSingleSelectedId!(null, 'TX-1')).toBe('TX-1')
    expect(module.toggleSingleSelectedId!('TX-1', 'TX-2')).toBe('TX-2')
  })

  it('orders primary navigation as Dashboard / Transactions / Alerts / Episodes', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const dashboard = source.indexOf("name: 'Dashboard'")
    const transactions = source.indexOf("name: 'Transactions'")
    const alerts = source.indexOf("name: 'Alerts'")
    const episodes = source.indexOf("name: 'Episodes'")
    expect(dashboard).toBeGreaterThan(-1)
    expect(dashboard).toBeLessThan(transactions)
    expect(transactions).toBeLessThan(alerts)
    expect(alerts).toBeLessThan(episodes)
  })
})
