import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Transactions from './Transactions'
import { records } from './domain'
import { buildTransactionIndex } from './transactionIndex'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v23 Transactions four-stage explorer', () => {
  it('renders owner, account, compact transaction list, and adjacent detail without a table', () => {
    const transaction = buildTransactionIndex(records).transactions.find(item => item.recordIds.length > 0)!
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} onOpenRecord={() => {}} />)

    expect(markup).toContain('data-testid="owner-scroll-list"')
    expect(markup).toContain('data-testid="transaction-list"')
    expect(markup).toContain('data-testid="transaction-detail"')
    expect(markup).not.toContain('<table')
    expect(markup).toContain(transaction.at)
    expect(markup).toContain('aria-label="송금"')
    expect(markup).toContain(`aria-label="${transaction.recordIds[0]} 상세 보기"`)

    const list = markup.slice(markup.indexOf('data-testid="transaction-list"'), markup.indexOf('data-testid="transaction-detail"'))
    expect(list).not.toContain('상세 보기')
  })

  it('derives selected-owner-first display order without mutating the transaction index', async () => {
    const index = buildTransactionIndex(records)
    const originalOrder = index.owners.map(owner => owner.name)
    const selected = index.owners[42]
    const markup = html(<Transactions records={records} target={{ type: 'owner', owner: selected.name }} />)
    const firstOwner = markup.slice(markup.indexOf('data-testid="owner-item"'), markup.indexOf('data-testid="owner-item"') + 500)

    expect(firstOwner).toContain(selected.name)
    expect(index.owners.map(owner => owner.name)).toEqual(originalOrder)

    const module = await import('./TransactionsV22') as unknown as {
      selectedOwnerFirst?: <T extends { name: string }>(owners: readonly T[], selected?: string) => readonly T[]
    }
    expect(module.selectedOwnerFirst).toBeTypeOf('function')
    expect(module.selectedOwnerFirst!(index.owners, selected.name)[0]).toBe(selected)
    expect(index.owners.map(owner => owner.name)).toEqual(originalOrder)
  })

  it('uses shared single-selection toggling and semantic inverse selection for every list stage', async () => {
    const transaction = buildTransactionIndex(records).transactions[0]
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    const { toggleSingleSelectedId } = await import('./components/data-table/data-table')

    expect(toggleSingleSelectedId('same', 'same')).toBeNull()
    expect(toggleSingleSelectedId(null, 'next')).toBe('next')
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(3)
    expect(css).toMatch(/\.transaction-stage-item\[aria-pressed="true"\][^{]*\{[^}]*--background:var\(--selection-background\)[^}]*--foreground:var\(--selection-foreground\)/s)
    expect(markup).toContain('data-testid="owner-account-connector-edge-0"')
    expect(markup).toContain('data-testid="account-transaction-connector-edge-0"')
    expect(markup.match(/data-active="true"/g)).toHaveLength(2)
    expect(markup).toContain('data-active="false"')
    expect(css).toMatch(/\.transaction-connector-edge\[data-active="false"\]\s*\{[^}]*color:var\(--muted-foreground\)/s)
    expect(css).toMatch(/\.transaction-connector-edge\[data-active="true"\]\s*\{[^}]*color:var\(--foreground\)[^}]*z-index:1/s)
    expect(css).not.toContain('.transaction-connector-edge > b::after')
  })

  it('surfaces linked records as pill actions at the top of selected transaction details', () => {
    const transaction = buildTransactionIndex(records).transactions.find(item => item.recordIds.some(id => id.startsWith('ALT-')) && item.recordIds.some(id => id.startsWith('EP-')))!
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} onOpenRecord={() => {}} />)
    const actions = markup.slice(markup.indexOf('data-testid="linked-record-actions"'), markup.indexOf('data-testid="selected-transaction"'))

    expect(actions).toContain('연결 Alert')
    expect(actions).toContain('연결 Episode')
    expect(actions).toContain('rounded-full')
    expect(actions).toContain('data-variant="outline"')
    expect(markup.slice(markup.indexOf('data-testid="selected-transaction"'))).not.toContain('연결 Alert')
    expect(markup.slice(markup.indexOf('data-testid="selected-transaction"'))).not.toContain('연결 Episode')
  })

  it('limits internal scrolling to owners and stacks detail below at narrow desktop widths', () => {
    const source = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

    expect(source).not.toContain('DataTable')
    expect(source).not.toContain('overflow-auto')
    expect(css).toMatch(/\.transactions-flow\s*\{[^}]*grid-template-columns:\s*13\.5rem 14\.5rem minmax\(16rem,1fr\) minmax\(18rem,1fr\)/s)
    expect(css).toMatch(/\.transaction-owner-scroll\s*\{[^}]*overflow-y:auto[^}]*scrollbar-gutter:stable/s)
    expect(css).toMatch(/@container\s*\(max-width:\s*1100px\)[\s\S]*\.transactions-flow\s*\{[^}]*grid-template-columns:\s*minmax\(12rem,\.8fr\) minmax\(13rem,\.9fr\) minmax\(16rem,1\.2fr\)[^}]*\}[\s\S]*\.transaction-detail\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s)
    expect(css).toMatch(/@container\s*\(max-width:\s*760px\)[\s\S]*\.transactions-flow\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s)
    expect(css).not.toMatch(/\.transactions-flow[^}]*overflow-[xy]?:\s*(auto|scroll)/s)
  })
})
