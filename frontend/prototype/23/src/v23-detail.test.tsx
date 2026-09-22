import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Detail from './Detail'
import TxTable, { type TxRow } from './TxTable'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const renderDetail = (record: (typeof records)[number], initialTab: 'overview' | 'transactions' = 'overview') => html(
  <Detail record={record} records={records} user={record.owner} onUpdate={() => {}} onOpen={() => {}} initialTab={initialTab} />,
)

describe('v23 detail information hierarchy', () => {
  it('orders the shared header by id, title with linked-record action, then grouped metadata without overview duplication', () => {
    const record = records.find(item => item.kind === 'Alert')!
    const markup = renderDetail(record)
    const header = markup.slice(markup.indexOf('data-testid="detail-header"'), markup.indexOf('underline-tabs'))
    const investigation = markup.slice(markup.indexOf('data-testid="investigation"'), markup.indexOf('처리 이력'))
    const idPosition = header.indexOf('data-testid="detail-id"')
    const titlePosition = header.indexOf(`>${record.title}</h1>`)
    const linkPosition = header.indexOf(`연결된 Episode 1개`)
    const tagsPosition = header.indexOf('data-testid="detail-tags"')

    expect(idPosition).toBeGreaterThan(-1)
    expect(titlePosition).toBeGreaterThan(idPosition)
    expect(linkPosition).toBeGreaterThan(titlePosition)
    expect(tagsPosition).toBeGreaterThan(linkPosition)
    expect(header).toContain(record.status)
    expect(header).toContain(record.owner)
    expect(header).toContain(record.date)
    expect(header).toContain(record.age === 0 ? '오늘' : `${record.age}일 경과`)
    expect(investigation).not.toContain(record.owner)
    expect(investigation).not.toContain(record.date)
    expect(investigation).not.toContain(record.age === 0 ? '오늘' : `${record.age}일 경과`)
  })

  it('renders one evidence card per unique Episode pattern without a representative header badge', () => {
    const episode = records.find(item => item.kind === 'Episode' && (item.alertIds?.length ?? 0) > 1)!
    const linked = episode.alertIds!.map(id => records.find(item => item.id === id)!)
    const uniquePatterns = new Set(linked.map(alert => alert.pattern)).size
    const markup = renderDetail(episode)
    const header = markup.slice(markup.indexOf('data-testid="detail-header"'), markup.indexOf('underline-tabs'))

    expect(markup.match(/data-testid="episode-pattern-card"/g)).toHaveLength(uniquePatterns)
    expect(header).not.toContain(`title="모델 판별 · ${episode.pattern}`)
    for (const alert of linked) {
      expect(markup).toContain(alert.id)
      expect(markup).toContain(`의심 ${alert.probability}%`)
    }
  })

  it('uses all three network money metrics for Alert and Episode', () => {
    const alert = records.find(item => item.kind === 'Alert')!
    const episode = records.find(item => item.kind === 'Episode')!
    const alertMarkup = renderDetail(alert)
    const episodeMarkup = renderDetail(episode)

    expect(alertMarkup).toContain('투입 원금')
    expect(alertMarkup).toContain('거래 총액')
    expect(alertMarkup).toContain('순유입')
    expect(alertMarkup).not.toContain('의심 거래 금액</p>')
    expect(episodeMarkup).not.toContain('대표 계좌 선택 필요')
  })
})

describe('v23 Alert·Episode transaction table', () => {
  const row: TxRow = {
    id: 'TX-RELATION', at: '2026-09-22 10:30', from: '100-01', fromOwner: '송금인', to: '200-02', toOwner: '수취인',
    usd: 11667, amount: 11667, currency: 'USD', format: 'Wire',
  }

  it('keeps a table and exposes sender owner/account before receiver owner/account', () => {
    const markup = html(<TxTable rows={[row]} onSelect={() => {}} />)
    const labels = ['송금 소유주', '송금 계좌', '수취 소유주', '수취 계좌']
    const positions = labels.map(label => markup.indexOf(label))

    expect(markup).toContain('data-testid="tx-table"')
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(markup).toContain('송금인')
    expect(markup).toContain('100-01')
    expect(markup).toContain('수취인')
    expect(markup).toContain('200-02')
    expect(markup).toContain('11,667$')
    expect(markup).not.toContain('$11,667')
  })

  it('shows only the current Alert transactions and the linked Alert union for an Episode', () => {
    const alert = records.find(item => item.kind === 'Alert')!
    const episode = records.find(item => item.kind === 'Episode' && item.alertIds?.includes(alert.id))!
    const alertMarkup = renderDetail(alert, 'transactions')
    const episodeMarkup = renderDetail(episode, 'transactions')

    expect(alertMarkup).toContain('data-testid="tx-table"')
    expect(episodeMarkup).toContain('data-testid="tx-table"')
    expect((episodeMarkup.match(/data-slot="table-row"/g) ?? []).length).toBeGreaterThanOrEqual((alertMarkup.match(/data-slot="table-row"/g) ?? []).length)
  })
})
