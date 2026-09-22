import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Agent from './Agent'
import { Institution } from './Dashboard'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v23 institution dashboard report', () => {
  it('places the reduced main chart beside an evidence-backed AI Daily Report', () => {
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    expect(markup).toContain('data-testid="institution-primary-row"')
    expect(markup).toContain('grid-cols-[minmax(0,1.8fr)_minmax(18rem,0.8fr)]')
    expect(markup).toContain('data-testid="ai-daily-report"')
    expect(markup).toContain('생성 시각')
    expect(markup).toContain('변화 해석')
    expect(markup).toContain('우선 검토')
    expect(markup).toContain('근거 보기')
  })

  it('keeps the report interpretive instead of repeating the four summary card numbers', () => {
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    const report = markup.slice(markup.indexOf('data-testid="ai-daily-report"'), markup.indexOf('data-testid="ai-daily-report"') + 6000)
    for (const label of ['오늘 유입 Alert', '30일 처리율', '미처리 Alert', '3일 이상 경과']) expect(report).not.toContain(label)
  })

  it('marks RDR 9000 as demonstration-only in its header', () => {
    const markup = html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)
    const visibleName = markup.indexOf('>RDR 9000</div>')
    const header = markup.slice(visibleName, visibleName + 1000)
    expect(header).toContain('시연용')
  })
})
