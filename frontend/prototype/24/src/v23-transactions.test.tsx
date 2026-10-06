import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Transactions, { visibleAccountsForOwner, type TransactionView } from './TransactionsV22'
import { records } from './domain'
import { buildTransactionIndex } from './transactionIndex'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v23 Transactions four-stage explorer', () => {
  it('uses the account-query-filtered first account when selecting a multi-account owner', () => {
    const index = buildTransactionIndex(records)
    const owner = index.owners.find(item => item.accountIds.length >= 2)!
    const accountsByOwner = new Map(index.owners.map(item => [item.name, index.accounts.filter(account => item.accountIds.includes(account.id))]))
    const transactions = new Map(index.transactions.map(item => [item.id, item]))
    const viewsByAccount = new Map(index.accounts.map(account => [account.id, account.transactionIds.flatMap(id => {
      const transaction = transactions.get(id)
      if (!transaction) return []
      const outgoing = transaction.fromAccount === account.id
      return [{ ...transaction, contextAccount: account.id, direction: outgoing ? '송금' as const : '수취' as const, counterpartyOwner: outgoing ? transaction.toOwner : transaction.fromOwner, counterpartyAccount: outgoing ? transaction.toAccount : transaction.fromAccount } satisfies TransactionView]
    })]))
    const matchingAccount = accountsByOwner.get(owner.name)![1]

    expect(visibleAccountsForOwner(owner, accountsByOwner, viewsByAccount, matchingAccount.id, undefined, [])?.[0]?.id).toBe(matchingAccount.id)
  })

  it('includes several repeat owners with multiple accounts, including a three-account example', () => {
    const owners = buildTransactionIndex(records).owners

    expect(owners.filter(owner => owner.accountIds.length >= 2).length).toBeGreaterThanOrEqual(3)
    expect(owners.some(owner => owner.accountIds.length >= 3)).toBe(true)
  })

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

  it('shows the selected owner in the fixed preview and keeps its active row in original browse order', () => {
    const index = buildTransactionIndex(records)
    const originalOrder = index.owners.map(owner => owner.name)
    const selected = index.owners[42]
    const markup = html(<Transactions records={records} target={{ type: 'owner', owner: selected.name }} />)
    const ownerSection = markup.slice(markup.indexOf('data-testid="owner-section"'), markup.indexOf('data-testid="owner-account-connector"'))
    const fixed = ownerSection.slice(ownerSection.indexOf('data-testid="selected-owner-item"'), ownerSection.indexOf('data-testid="owner-scroll-list"'))
    const browse = ownerSection.slice(ownerSection.indexOf('data-testid="owner-scroll-list"'))
    const firstBrowseOwner = browse.slice(browse.indexOf('data-testid="owner-item"'), browse.indexOf('data-testid="owner-item"') + 500)

    expect(fixed).toContain(selected.name)
    expect(fixed).toContain('bg-foreground')
    expect(fixed).toContain('text-background')
    expect(browse).toContain(selected.name)
    expect(browse).toContain('aria-pressed="true"')
    expect(firstBrowseOwner).toContain(originalOrder[0])
    expect(ownerSection.indexOf('data-testid="selected-owner-item"')).toBeLessThan(ownerSection.indexOf('data-testid="owner-scroll-list"'))
    expect(ownerSection).not.toContain('선택 소유주는 고정하고 아래 목록을 탐색')
    expect(index.owners.map(owner => owner.name)).toEqual(originalOrder)
  })

  it('starts with an inactive owner preview before interaction and a stable connector origin', () => {
    const index = buildTransactionIndex(records)
    const markup = html(<Transactions records={records} />)
    const source = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    const fixed = markup.slice(markup.indexOf('data-testid="selected-owner-item"'), markup.indexOf('data-testid="owner-scroll-list"'))

    expect(fixed).toContain('소유주를 선택해 주세요')
    expect(fixed).toContain('bg-muted/10')
    expect(fixed).not.toContain(index.owners[0].name)
    expect(source).toContain('sourceIndex={0}')
    expect(source).not.toContain('selectedOwnerFirst')
    expect(source).not.toContain('scrollIntoView')
    expect(source).toContain('mt-4 border-t-2 border-border pt-4')
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

  it('gives the mini Sankey one figure label while hiding its decorative SVG and preserving text proportions', () => {
    const transaction = buildTransactionIndex(records).transactions[0]
    const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId: transaction.id }} />)
    const detail = markup.slice(markup.indexOf('data-testid="selected-transaction"'))

    expect(detail).toContain('data-testid="transaction-mini-sankey"')
    expect(detail).toContain('aria-labelledby="transaction-flow-')
    expect(detail).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(detail).not.toContain('preserveAspectRatio="none"')
    expect(detail).not.toContain('lucide-arrow-right')
    expect(detail).toContain(transaction.fromOwner)
    expect(detail).toContain(transaction.fromAccount)
    expect(detail).toContain(transaction.toOwner)
    expect(detail).toContain(transaction.toAccount)
    const afterSankey = detail.slice(detail.indexOf('</figure>'))
    expect(afterSankey).not.toContain('송금 소유주 · 계좌')
    expect(afterSankey).not.toContain('수취 소유주 · 계좌')
  })

  it('uses the FlowDetail risk color meaning for mini Sankey ribbons', () => {
    const index = buildTransactionIndex(records)
    const suspicious = index.transactions.find(item => item.suspicious)!
    const normal = index.transactions.find(item => !item.suspicious)!
    const sankey = (transactionId: string) => {
      const markup = html(<Transactions records={records} target={{ type: 'transaction', transactionId }} />)
      return markup.slice(markup.indexOf('data-testid="transaction-mini-sankey"'), markup.indexOf('</figure>'))
    }

    expect(sankey(suspicious.id)).toContain('fill-destructive/35')
    expect(sankey(normal.id)).toContain('fill-muted-foreground/35')
  })

  it('limits internal scrolling to owners and stacks detail below at narrow desktop widths', () => {
    const source = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

    expect(source).not.toContain('DataTable')
    expect(source).not.toContain('overflow-auto')
    expect(css).toMatch(/\.transactions-flow\s*\{[^}]*grid-template-columns:\s*13\.5rem 14\.5rem minmax\(16rem,1fr\) minmax\(18rem,1fr\)/s)
    expect(css).toMatch(/\.transaction-owner-scroll\s*\{[^}]*overflow-y:auto[^}]*scrollbar-gutter:stable/s)
    expect(css).toMatch(/@container\s*\(max-width:\s*1100px\)[\s\S]*\.transactions-flow\s*\{[^}]*grid-template-columns:\s*13\.5rem 14\.5rem minmax\(16rem,1fr\)[^}]*\}[\s\S]*\.transaction-detail\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s)
    expect(css).toMatch(/@container\s*\(max-width:\s*760px\)[\s\S]*\.transactions-flow\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)[^}]*\}[\s\S]*\.transaction-connector\s*\{[^}]*display:none/s)
    expect(css).not.toMatch(/\.transactions-flow[^}]*overflow-[xy]?:\s*(auto|scroll)/s)
  })
})
