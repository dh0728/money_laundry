import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Detail from './Detail'
import { graphFor, laundering, records } from './domain'
import { buildTransactionIndex } from './transactionIndex'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v21 detail transaction shortcuts', () => {
  it('renders exact transaction and owner shortcuts in the selected-transaction card', () => {
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

    expect(markup).toContain(`aria-label="${senderOwner} 소유주 자세히 보기"`)
    const ownerShortcut = markup.match(new RegExp(`<button[^>]*aria-label="${senderOwner} 소유주 자세히 보기"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? ''
    expect(ownerShortcut).toContain(senderOwner)
    expect(ownerShortcut).toContain('lucide-external-link')
    expect(ownerShortcut).not.toContain('자세히 보기</span>')
    expect(ownerShortcut).toContain('max-w-full')
    expect(ownerShortcut).toContain('min-w-0')
    expect(ownerShortcut).toContain('truncate')
    expect(markup).toContain('flex-wrap')
    expect(markup).not.toContain('aria-label="Transactions에서 선택한 거래 보기"')
    expect(markup).toContain('aria-label="Transactions에서 거래 ID 보기"')
    expect(markup).toContain('aria-label="Transactions에서 송금 소유주 보기"')
    expect(markup).toContain('aria-label="Transactions에서 수취 소유주 보기"')

    const card = markup.slice(markup.indexOf('selected-transaction-card'))
    const sender = card.indexOf('송금 계좌')
    const currency = card.indexOf('원 통화 · 수단')
    const recipient = card.indexOf('수취 계좌')
    const amount = card.indexOf('>금액<')
    expect(sender).toBeGreaterThan(-1)
    expect(sender).toBeLessThan(currency)
    expect(currency).toBeLessThan(recipient)
    expect(recipient).toBeLessThan(amount)
  })
})
