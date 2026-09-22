import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import Transactions from './Transactions'
import { buildTransactionIndex } from './transactionIndex'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v22 Transactions three-section hierarchy', () => {
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

  it('renders an exact transaction target in an expanded owner/account/transaction table', () => {
    const transaction = buildTransactionIndex(records).transactions[0]
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    expect(markup).toContain('<table')
    expect(markup).toContain('>소유주<')
    expect(markup).toContain('>계좌<')
    expect(markup).toContain('>거래 ID<')
    expect(markup).toContain(transaction.fromOwner)
    expect(markup).toContain(transaction.fromAccount)
    expect(markup).toContain(transaction.id)
    expect(markup).toContain('상대 소유주 · 계좌')
    expect(markup).toContain('방향')
    expect(markup).toContain('연결 Alert')
    expect(markup).toContain('연결 Episode')
    expect(markup).toContain('선택한 거래')
  })

  it('renders the Korean page title and explicit three-section explorer', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('>거래 내역</h1>')
    expect(markup).toContain('소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다.')
    expect(markup).toContain('페이지당 행')
    expect(markup).toContain('data-testid="transactions-explorer"')
  })

  it('separates owner, account, and transaction columns and exposes linked AML records', () => {
    const index = buildTransactionIndex(records)
    const transaction = index.transactions.find(item => item.recordIds.length > 0)!
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    expect(markup).toContain('>소유주<')
    expect(markup).toContain('>계좌<')
    expect(markup).toContain('>거래 ID<')
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

  it('uses one viewport-bound native scroll owner', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transactions-explorer"')
    expect(markup).toContain('max-h-[calc(100dvh-220px)]')
    expect(markup).toContain('overflow-auto')
    expect(markup).not.toContain('transactions-explorer-floating-scrollbar')
  })

  it('separates Alert and Episode links and exposes period/filter controls', () => {
    const transaction = buildTransactionIndex(records).transactions.find(item => item.recordIds.some(id => id.startsWith('ALT-')) && item.recordIds.some(id => id.startsWith('EP-')))!
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} onOpenRecord={() => {}} />)
    expect(markup).toContain('>연결 Alert<')
    expect(markup).toContain('>연결 Episode<')
    expect(markup).toContain('소유주를 선택해 계좌 확인')
    expect(markup).toContain('의 계좌')
    expect(markup).not.toContain('>—<')
    expect(markup).toContain('date-range-control')
    expect(markup).toContain('transaction-filter-trigger')
    expect(markup).toContain('min-w-[1700px]')
    expect(markup).toContain('record-link')
  })

  it('applies transaction date, direction, status, and payment filters to transaction rows', async () => {
    const module = await import('./Transactions') as unknown as {
      transactionPassesFilters?: (
        row: { at?: string; direction?: '송금' | '수취'; suspicious?: boolean; format?: string },
        range: { from?: Date; to?: Date } | undefined,
        filters: Array<{ field: 'direction' | 'status' | 'format'; value: string }>,
      ) => boolean
    }
    expect(module.transactionPassesFilters).toBeTypeOf('function')
    const row = { at: '2026-09-08 10:04', direction: '송금' as const, suspicious: true, format: 'ACH' }
    expect(module.transactionPassesFilters!(row, { from: new Date(2026, 8, 8), to: new Date(2026, 8, 8) }, [
      { field: 'direction', value: '송금' }, { field: 'status', value: '의심' }, { field: 'format', value: 'ACH' },
    ])).toBe(true)
    expect(module.transactionPassesFilters!(row, { from: new Date(2026, 8, 9), to: new Date(2026, 8, 9) }, [])).toBe(false)
    expect(module.transactionPassesFilters!(row, undefined, [{ field: 'status', value: '정상' }])).toBe(false)
  })

  it('resets local query and sorting while preserving the target owner page', async () => {
    const module = await import('./Transactions') as unknown as {
      transactionNavigationState?: (index: ReturnType<typeof buildTransactionIndex>, target: { type: 'owner'; owner: string }, pageSize: number) => {
        query: string; sorting: unknown[]; pagination: { pageIndex: number; pageSize: number }
      }
    }
    expect(module.transactionNavigationState).toBeTypeOf('function')
    const index = buildTransactionIndex(records)
    const owner = index.owners[42]
    const next = module.transactionNavigationState!(index, { type: 'owner', owner: owner.name }, 20)
    expect(next).toEqual(expect.objectContaining({
      query: '', sorting: [], pagination: { pageIndex: 2, pageSize: 20 },
    }))
  })

  it('does not re-run target synchronization when only rows per page changes', () => {
    const source = readFileSync(new URL('./Transactions.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('[index, target, pagination.pageSize]')
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*?transactionNavigationState\(index, target, pageSizeRef\.current\)[\s\S]*?\}, \[index, target\]\)/)
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
