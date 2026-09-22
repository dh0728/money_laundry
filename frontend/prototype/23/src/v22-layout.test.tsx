import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { ThemeProvider } from 'next-themes'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Dashboard from './Dashboard'
import Lists from './Lists'
import Transactions from './Transactions'
import { Account, Notifications, Settings } from './UtilityPages'
import { records } from './domain'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const searchSource = readFileSync(new URL('./GlobalSearch.tsx', import.meta.url), 'utf8')

const html = (node: React.ReactNode) => renderToStaticMarkup(
  <ThemeProvider attribute="class" defaultTheme="dark">
    <NuqsTestingAdapter><TooltipProvider>{node}</TooltipProvider></NuqsTestingAdapter>
  </ThemeProvider>,
)

describe('v22 top-level page layout', () => {
  it('keeps settings at two columns and uses shared icon controls', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    const flow = readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')
    expect(css).toMatch(/\.settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)\s*\{\s*\.settings-grid\s*\{\s*grid-template-columns:\s*1fr;/)
    expect(flow).toContain('<IconButton label="축소"')
    expect(flow).toContain('<IconButton label="확대"')
    expect(flow).toContain('<IconButton label="상세 닫기"')
  })

  it('returns to the first page when a filter chip is removed', () => {
    const source = readFileSync(new URL('./Lists.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/onRemove=\{\(\) => \{\s*setFilters\([^}]+toFirst\(\)/s)
  })

  it.each([
    ['대시보드', <Dashboard records={records} user="오검토" onOpen={() => {}} />],
    ['거래 내역', <Transactions records={records} />],
    ['Alert 목록', <Lists kind="Alert" records={records} user="오검토" onOpen={() => {}} state="normal" setState={() => {}} />],
    ['Episode 목록', <Lists kind="Episode" records={records} user="오검토" onOpen={() => {}} state="normal" setState={() => {}} />],
    ['알림', <Notifications records={records} onOpen={() => {}} />],
    ['설정', <Settings user="오검토" />],
    ['계정', <Account user="오검토" onLogout={() => {}} />],
  ])('renders the shared page heading for %s', (title, component) => {
    const markup = html(component)
    expect(markup).toContain('data-testid="page-heading"')
    expect(markup).toContain(`<h1`)
    expect(markup).toContain(`>${title}</h1>`)
  })

  it('uses a two-column settings layout on wide screens', () => {
    const markup = html(<Settings user="오검토" />)
    expect(markup).toContain('data-testid="settings-grid"')
    expect(markup).toContain('settings-grid')
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(css).toContain('.settings-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }')
    expect(css).not.toContain('.settings-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }')
  })
})

describe('v22 transaction explorer', () => {
  it('uses a compact transaction list beside a separate detail stage', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transaction-list"')
    expect(markup).toContain('data-testid="transaction-detail"')
    expect(markup.indexOf('data-testid="transaction-list"')).toBeLessThan(markup.indexOf('data-testid="transaction-detail"'))
    expect(markup).not.toContain('data-testid="transaction-row-connector"')
  })

  it('uses one owner-list overflow region and natural-height later stages', () => {
    const source = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    expect(source.match(/bodyClassName="transaction-owner-scroll"/g)).toHaveLength(1)
    expect(source).not.toContain('overflow-auto')
    expect(source).toContain('StagePanel')
    expect(source).toContain('OrthogonalConnector')
  })

  it('keeps compact hierarchy columns and a wide transaction stage', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(css).toContain('--owner-stage-width: 13.5rem')
    expect(css).toContain('--account-stage-width: 14.5rem')
    expect(css).toContain('min-width: 180px')
  })

  it('presents owner, account, and transaction as three explicit sections', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transactions-explorer"')
    expect(markup).toContain('data-testid="owner-section"')
    expect(markup).toContain('data-testid="account-section"')
    expect(markup).toContain('data-testid="transaction-section"')
    expect(markup.indexOf('data-testid="owner-section"')).toBeLessThan(markup.indexOf('data-testid="account-section"'))
    expect(markup.indexOf('data-testid="account-section"')).toBeLessThan(markup.indexOf('data-testid="transaction-section"'))
    expect(markup).toContain('>소유주<')
    expect(markup).toContain('>계좌<')
    expect(markup).toContain('>거래<')
  })

  it('separates four stages and renders directional connectors without a horizontal minimum width', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transactions-flow"')
    expect(markup).toContain('data-testid="owner-account-connector"')
    expect(markup).toContain('data-testid="account-transaction-connector"')
    expect(markup).toContain('data-testid="owner-account-connector-edge-0"')
    expect(markup).toContain('data-testid="account-transaction-connector-edge-0"')
    expect(markup).toContain('transaction-connector-edge')
    expect(markup).not.toContain('<svg class="absolute inset-0')
    expect(markup).toContain('gap-3')
    expect(markup).toContain('transactions-flow grid')
    expect(markup).toContain('data-testid="transaction-detail"')
    expect(markup).not.toContain('min-w-[1156px]')
  })

  it('keeps viewport-bound scrolling local to the owner list', () => {
    const transactionSource = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(transactionSource).toContain('bodyClassName="transaction-owner-scroll"')
    expect(transactionSource).not.toContain('overflow-auto')
    expect(transactionSource).not.toContain('type="range"')
    expect(transactionSource).not.toContain('ResizeObserver')
    expect(transactionSource).not.toContain('requestAnimationFrame')
    expect(css).not.toContain('.floating-horizontal-range')
    expect(css).toMatch(/\.transaction-owner-scroll\s*\{[^}]*max-height:[^;}]+[^}]*overflow-y:auto[^}]*scrollbar-gutter:stable/s)
  })

  it('avoids horizontal-explorer compositing while retaining item rendering containment', () => {
    const markup = html(<Transactions records={records} />)
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(markup).toContain('transaction-stage-item')
    expect(css).not.toContain('.transactions-explorer-scroll')
    expect(css).toMatch(/\.transaction-stage-item\s*\{[^}]*content-visibility:auto[^}]*contain-intrinsic-block-size:64px/s)
  })

  it('keeps the TanStack Table data reference stable between unrelated renders', () => {
    const transactionSource = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    expect(transactionSource).toMatch(/const transactionRows = useMemo\(\(\) => account/)
  })
})

describe('v22 shell polish', () => {
  it('keeps the global-search shortcut visible while the input is focused', () => {
    expect(searchSource).toContain('<PopoverAnchor asChild>')
    expect(searchSource).not.toContain('<PopoverTrigger asChild>')
    expect(searchSource).toContain('onFocus={() => setOpen(true)}')
    expect(searchSource).not.toContain('onClick={() => setOpen(true)}')
    expect(searchSource).toContain('onInteractOutside={event =>')
    expect(searchSource).toContain('searchAnchorRef.current?.contains(event.target as Node)')
    expect(searchSource).toMatch(/<Kbd[^>]*data-testid="global-search-shortcut"[^>]*className="[^"]*z-10[^"]*pointer-events-none/)
  })

  it('does not add a white ring to the active account avatar', () => {
    const accountBlock = appSource.slice(appSource.indexOf('data-nav-id="account"'), appSource.indexOf('data-nav-id="account"') + 1000)
    expect(accountBlock).not.toContain('ring-2 ring-white')
  })
})
