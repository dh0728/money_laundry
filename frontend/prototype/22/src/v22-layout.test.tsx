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

  it('separates all three panes and renders directional connectors between them', () => {
    const markup = html(<Transactions records={records} />)
    expect(markup).toContain('data-testid="transactions-flow"')
    expect(markup).toContain('data-testid="owner-account-connector"')
    expect(markup).toContain('data-testid="account-transaction-connector"')
    expect(markup).toContain('data-testid="owner-account-connector-edge-0"')
    expect(markup).toContain('data-testid="account-transaction-connector-edge-0"')
    expect(markup).toMatch(/<path d="M 0 [^"]* H 16 V [^"]* H 37"/)
    expect(markup).not.toMatch(/<path d="M 0 [^"]* C /)
    expect(markup).toContain('<circle cx="2"')
    expect(markup).toContain('gap-3')
    expect(markup).toContain('min-w-[1700px]')
    expect(markup).toContain('grid-cols-[220px_36px_240px_36px_minmax(1136px,1fr)]')
    expect(markup).not.toContain('class="min-w-0 border-r"')
  })

  it('uses one native scroll owner with a viewport-bound height', () => {
    const transactionSource = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(transactionSource).toContain('max-h-[calc(100dvh-220px)]')
    expect(transactionSource).toContain('overflow-auto')
    expect(transactionSource).not.toContain('type="range"')
    expect(transactionSource).not.toContain('ResizeObserver')
    expect(transactionSource).not.toContain('requestAnimationFrame')
    expect(css).not.toContain('.floating-horizontal-range')
    expect(css).toContain('overscroll-behavior-inline:contain')
  })

  it('avoids expensive compositing inside the horizontally moving explorer', () => {
    const markup = html(<Transactions records={records} />)
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(markup).toContain('transaction-stage-item')
    expect(markup).toContain('data-shine="off"')
    expect(css).toContain('.transactions-explorer-scroll .glass-surface')
    expect(css).toContain('backdrop-filter:none!important')
    expect(css).toContain('content-visibility:auto')
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
