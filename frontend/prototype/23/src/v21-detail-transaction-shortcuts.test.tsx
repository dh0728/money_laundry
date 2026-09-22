import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Detail from './Detail'
import { graphFor, laundering, records } from './domain'
import { buildTransactionIndex } from './transactionIndex'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v23 detail transaction shortcuts', () => {
  it('renders exact transaction, owner, and account shortcuts inside the full-width table', () => {
    const record = records.find(item => item.kind === 'Alert')!
    const transactionId = laundering(graphFor(record, records)).slice().sort((a, b) => a.at.localeCompare(b.at))[0].id
    const senderOwner = buildTransactionIndex(records).transactions.find(item => item.id === transactionId)!.fromOwner
    const markup = html(
      <Detail
        record={record}
        records={records}
        user={record.owner}
        onUpdate={() => {}}
        onOpen={() => {}}
        onOpenTransaction={() => {}}
        initialTab="transactions"
      />,
    )

    expect(markup).toContain(`aria-label="${senderOwner} 소유주 보기"`)
    const ownerShortcut = markup.match(new RegExp(`<button[^>]*aria-label="${senderOwner} 소유주 보기"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? ''
    expect(ownerShortcut).toContain(senderOwner)
    expect(ownerShortcut).toContain('lucide-external-link')
    expect(ownerShortcut).toContain('min-w-0')
    expect(ownerShortcut).toContain('whitespace-nowrap')
    expect(ownerShortcut).not.toContain('truncate')
    expect(markup).toContain(`aria-label="${transactionId} 거래 보기"`)
    expect(markup).toMatch(/aria-label="[A-Z0-9]+ 계좌 보기"/)
    expect(markup).not.toContain('selected-transaction-card')
    expect(markup).toContain('table-fixed')
    expect(markup).toContain('[&amp;_td]:overflow-hidden')
    expect(markup).toContain('width:84px')
    expect(markup).toContain('width:220px')
  })
})
