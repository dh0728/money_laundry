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

  it('keeps ownership metadata and the read-only responsibility notice inside the compact header', () => {
    const record = records.find(item => item.kind === 'Episode')!
    const markup = html(
      <Detail record={record} records={records} user="오검토" onUpdate={() => {}} onOpen={() => {}} />,
    )
    const headerEnd = markup.indexOf('</header>')
    const header = markup.slice(markup.indexOf('data-testid="detail-header"'), headerEnd)
    const afterHeader = markup.slice(headerEnd, markup.indexOf('underline-tabs'))

    expect(header).toContain('data-testid="owner-pill"')
    expect(header).toContain('data-testid="detected-pill"')
    expect(header).toContain('data-testid="age-pill"')
    expect(header).toContain('data-testid="responsibility-note"')
    expect(header).toContain('현재 오검토 계정으로 조회 중')
    expect(afterHeader).not.toContain('현재 오검토 계정으로 조회 중')
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

  it('restores legacy KPIs without duplicating the Episode linked-Alert header summary', () => {
    const alert = records.find(item => item.kind === 'Alert')!
    const episode = records.find(item => item.kind === 'Episode')!

    const alertMarkup = renderDetail(alert)
    const episodeMarkup = renderDetail(episode)
    const alertRow = alertMarkup.slice(alertMarkup.indexOf('data-testid="overview-kpi-row"'), alertMarkup.indexOf('data-testid="overview-flow-row"'))
    const episodeRow = episodeMarkup.slice(episodeMarkup.indexOf('data-testid="overview-kpi-row"'), episodeMarkup.indexOf('data-testid="overview-flow-row"'))
    expect(alertRow.match(/data-testid="overview-kpi-card"/g)).toHaveLength(6)
    expect(episodeRow.match(/data-testid="overview-kpi-card"/g)).toHaveLength(5)
    for (const row of [alertRow, episodeRow]) {
      expect(row).toContain('투입 원금')
      expect(row).toContain('거래 총액')
      expect(row).toContain('순유입')
      expect(row).not.toContain('의심 거래 금액')
      expect(row).toContain('근거 거래')
      expect(row).toContain('거래 기간')
    }
    expect(alertRow).toContain('의심 거래 참여 계좌')
    expect(episodeRow).not.toContain('연결 Alert')
  })

  it('uses four dense equal-height overview rows for both Alert and Episode', () => {
    const alert = records.find(item => item.kind === 'Alert')!
    const episode = records.find(item => item.kind === 'Episode')!

    for (const markup of [renderDetail(alert), renderDetail(episode)]) {
      const flowMarker = markup.indexOf('data-testid="overview-flow-row"')
      const contextMarker = markup.indexOf('data-testid="overview-context-row"')
      const flow = markup.slice(markup.lastIndexOf('<div', flowMarker), markup.indexOf('data-testid="overview-pattern-row"'))
      const context = markup.slice(markup.lastIndexOf('<div', contextMarker))

      expect(flow).toContain('일별 의심 거래 금액')
      expect(flow).toContain('상위 송금 계좌')
      expect(flow).toContain('items-stretch')
      expect(flow).not.toContain('결제 수단 구성')
      expect(context).toContain('탐지 근거')
      expect(context).toContain('조사 정보')
      expect(context).toContain('처리 이력')
      expect(context).toContain('items-stretch')
      expect(context).toContain('@3xl:grid-cols-3')
    }

    expect(renderDetail(alert)).toContain('@3xl:grid-cols-12 @6xl:grid-cols-6')
    expect(renderDetail(alert)).toContain('@3xl:col-span-4 @6xl:col-span-1')
    expect(renderDetail(episode)).toContain('@3xl:grid-cols-12 @6xl:grid-cols-5')
    expect(renderDetail(episode)).toContain('@3xl:col-span-4 @6xl:col-span-1')
    expect(renderDetail(episode)).toContain('data-testid="episode-pattern-grid" class="grid auto-rows-fr gap-4 @3xl:grid-cols-3')
  })
})

describe('v23 Alert·Episode transaction table', () => {
  const row: TxRow = {
    id: 'TX-RELATION', at: '2026-09-22 10:30', from: '100-01', fromOwner: '송금인', to: '200-02', toOwner: '수취인',
    usd: 11667, amount: 11667, currency: 'USD', format: 'Wire',
  }

  it('keeps a table and exposes sender owner/account before receiver owner/account', () => {
    const markup = html(<TxTable rows={[row]} onOpenTransaction={() => {}} />)
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

  it('uses the full-width table as the only transaction detail and links each entity in place', () => {
    const record = records.find(item => item.kind === 'Alert')!
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

    expect(markup).toContain('data-testid="detail-transaction-table"')
    expect(markup).not.toContain('selected-transaction-card')
    expect(markup).not.toContain('선택한 거래')
    expect(markup).toMatch(/aria-label="TX-[^"]+ 거래 보기"/)
    expect(markup).toMatch(/aria-label="[^"]+ 소유주 보기"/)
    expect(markup).toMatch(/aria-label="[A-Z0-9-]+ 계좌 보기"/)
    expect(markup).not.toContain('data-interactive="true"')
  })

  it('groups sender and receiver columns through shared surfaces without divider bars', () => {
    const markup = html(<TxTable rows={[row]} onOpenTransaction={() => {}} />)

    expect(markup.match(/data-column-boundary="header"/g)).toHaveLength(8)
    expect(markup.match(/data-column-boundary="cell"/g)).toHaveLength(8)
    expect(markup).toContain('bg-muted/15')
    expect(markup).toContain('bg-muted/30')
    expect(markup).not.toContain('border-l-2')
    expect(markup).toContain('data-column-group="sender"')
    expect(markup).toContain('data-column-group="receiver"')
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

describe('v23 Detail supporting context and Episode density', () => {
  it('restores concise review references with direct evidence shortcuts', () => {
    const record = records.find(item => item.kind === 'Alert')!
    const markup = html(
      <Detail record={record} records={records} user={record.owner} onUpdate={() => {}} onOpen={() => {}} initialTab="conclusion" />,
    )

    expect(markup).toContain('data-testid="review-reference"')
    expect(markup).toContain('참고 정보')
    expect(markup).toContain('최대 집중일')
    expect(markup).toContain('최다 송금 계좌')
    expect(markup).toContain('주 결제 수단')
    expect(markup).toContain('판단 전 확인')
    expect(markup).not.toContain('거래 근거 확인')
    expect(markup).not.toContain('자금 흐름 확인')
    const reference = markup.match(/<div[^>]*data-testid="review-reference"[^>]*>/)?.[0] ?? ''
    const reviewGrid = markup.match(/<div[^>]*data-testid="review-layout"[^>]*>/)?.[0] ?? ''
    expect(reviewGrid).toContain('items-stretch')
    expect(reviewGrid).not.toContain('items-start')
    expect(reference).toContain('h-full')
  })

  it('keeps Episode patterns in one dedicated row with direct Alert actions in each card header', () => {
    const episode = records.find(item => item.kind === 'Episode' && (item.alertIds?.length ?? 0) > 1)!
    const alert = records.find(item => item.kind === 'Alert')!
    const episodeMarkup = renderDetail(episode)
    const alertMarkup = renderDetail(alert)

    expect(episodeMarkup).toContain('data-testid="overview-pattern-row"')
    expect(episodeMarkup).toContain('data-testid="episode-pattern-grid"')
    expect(episodeMarkup).toContain('data-testid="episode-pattern-actions"')
    expect(episodeMarkup).not.toMatch(/[A-Z_-]+ · Alert \d+건/)
    expect(alertMarkup).toContain('data-testid="overview-pattern-row"')
  })
})
