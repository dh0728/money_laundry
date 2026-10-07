import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import TxTable, { type TxRow } from './TxTable'

const row = (index: number): TxRow => ({
  id: `TX-${String(index).padStart(2, '0')}`,
  at: '2026-09-22 10:30',
  from: '100-01',
  fromOwner: 'Corporation #10001',
  to: '200-02',
  toOwner: 'Partnership #20002',
  usd: 11667,
  amount: 11667,
  currency: 'USD',
  format: 'Wire',
})

const html = (rows: TxRow[] = [row(0)]) => renderToStaticMarkup(<TxTable rows={rows} onOpenTransaction={() => {}} />)

describe('v23 transaction table layout and horizontal scrolling', () => {
  it('keeps operational fields before the sender and receiver account groups', () => {
    const markup = html()
    const labels = ['거래 ID', '일시', '금액', '결제 수단', '송금 소유주', '송금 계좌', '수취 소유주', '수취 계좌']

    expect(labels.map(label => markup.indexOf(label))).toEqual([...labels.map(label => markup.indexOf(label))].sort((a, b) => a - b))
  })

  it('uses one fixed column model for both headers and cells', () => {
    const markup = html()

    expect(markup).toContain('<colgroup>')
    expect(markup.match(/<col style="width:[0-9]+px"/g)).toHaveLength(8)
    expect(markup.match(/data-column-boundary="header"/g)).toHaveLength(8)
    expect(markup.match(/data-column-boundary="cell"/g)).toHaveLength(8)
  })

  it('reserves owner identity width and keeps the payment column compact', () => {
    const source = readFileSync(new URL('./TxTable.tsx', import.meta.url), 'utf8')
    expect(source).toContain("accessorKey: 'format', size: 84")
    expect(source).toContain("accessorKey: 'fromOwner', size: 220")
    expect(source).toContain("accessorKey: 'toOwner', size: 220")
    expect(source).not.toContain('<span className="min-w-0 truncate">{label}</span>')
    expect(source).not.toContain('border-l-2')
  })

  it('renders one keyboard-focusable top scrollbar and hides the duplicate bottom track', () => {
    const markup = html()

    expect(markup).toContain('data-slot="table-top-scroll"')
    expect(markup).toContain('aria-label="거래 표 가로 스크롤"')
    expect(markup).toContain('tabindex="0"')
    const bodyScroller = markup.match(/<div[^>]*data-slot="table-container"[^>]*>/)?.[0] ?? ''
    expect(bodyScroller).toContain('scrollbar-width:none')
  })

  it('collapses the top scrollbar gutter when the table already fits', () => {
    const source = readFileSync(new URL('./components/data-table/data-table.tsx', import.meta.url), 'utf8')

    expect(source).toContain('body.scrollWidth > body.clientWidth + 1')
    expect(source).toContain('!hasHorizontalOverflow && "hidden"')
  })

  it('synchronizes the native top and body scroll positions in either direction', async () => {
    const module = await import('./components/data-table/data-table') as unknown as {
      syncHorizontalScroll?: (source: { scrollLeft: number }, target: { scrollLeft: number } | null) => void
    }
    expect(module.syncHorizontalScroll).toBeTypeOf('function')
    const top = { scrollLeft: 184 }
    const body = { scrollLeft: 0 }
    module.syncHorizontalScroll!(top, body)
    expect(body.scrollLeft).toBe(184)
    body.scrollLeft = 72
    module.syncHorizontalScroll!(body, top)
    expect(top.scrollLeft).toBe(72)
    const source = readFileSync(new URL('./components/data-table/data-table.tsx', import.meta.url), 'utf8')
    expect(source).toContain('topHorizontalScroll ? event => syncHorizontalScroll(event.currentTarget, topScrollRef.current) : undefined')
  })

  it('keeps link buttons inside their fixed cell and caps one page at 20 transactions', () => {
    const markup = html(Array.from({ length: 25 }, (_, index) => row(index)))
    const firstLink = markup.match(/<button[^>]*class="[^"]*"[^>]*aria-label="TX-00 거래 보기"[^>]*>/)?.[0] ?? ''
    const linkClasses = firstLink.match(/class="([^"]*)"/)?.[1].split(' ') ?? []
    const body = markup.slice(markup.indexOf('data-slot="table-body"'), markup.indexOf('</tbody>'))

    expect(linkClasses).toContain('w-full')
    expect(linkClasses).toContain('px-1')
    expect(body.match(/data-slot="table-row"/g)).toHaveLength(20)
    expect(body).not.toContain('TX-20')
  })
})
