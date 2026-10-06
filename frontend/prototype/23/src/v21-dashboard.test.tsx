import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records, TODAY } from './domain'
import { Institution, buildInstitutionChartData, dailyFlow } from './Dashboard'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v21 institution dashboard', () => {
  it('has one transactions implementation and one dashboard work-card definition', () => {
    const transactions = readFileSync(new URL('./Transactions.tsx', import.meta.url), 'utf8')
    const dashboard = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8')
    expect(transactions.trim()).toBe("export { default } from './TransactionsV22'")
    expect(dashboard.match(/function WorkCard/g)).toHaveLength(1)
    expect(dashboard.match(/<WorkCard/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('one date range visibly changes datasets for all three charts, including full history', () => {
    const broad = buildInstitutionChartData(records, undefined)
    const narrow = buildInstitutionChartData(records, { from: new Date(2026, 7, 18), to: TODAY })
    expect(broad.flow.length).toBeGreaterThan(narrow.flow.length)
    expect(broad.composition.map(item => item.value)).not.toEqual(narrow.composition.map(item => item.value))
    expect(broad.distribution.map(item => item.alerts)).not.toEqual(narrow.distribution.map(item => item.alerts))
  })

  it('keeps the default local-calendar range at exactly 30 days through TODAY', () => {
    const from = new Date(TODAY)
    from.setDate(from.getDate() - 29)
    const flow = buildInstitutionChartData(records, { from, to: TODAY }).flow
    expect(flow).toHaveLength(30)
    expect(flow[0]?.date).toBe('2026-08-18')
    expect(flow.at(-1)?.date).toBe('2026-09-16')
  })

  it('groups one period control and the two current chart regions in one bounded section', () => {
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    expect((markup.match(/date-range-control/g) ?? []).length).toBe(1)
    expect(markup).toContain('data-testid="institution-chart-group"')
    const group = markup.slice(markup.indexOf('data-testid="institution-chart-group"'), markup.indexOf('data-testid="institution-chart-group"') + 12000)
    expect(group).toContain('date-range-control')
    expect(group).toContain('data-testid="alert-flow-chart"')
    expect(group).toContain('data-testid="transaction-pattern-hierarchy"')
    expect(markup).toContain('data-testid="alert-flow-chart"')
    expect(markup).toContain('data-testid="transaction-pattern-hierarchy"')
  })

  it('lets every institution chart surface shrink inside a narrow app column', () => {
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    const chartGroup = markup.match(/<section[^>]*data-testid="institution-chart-group"[^>]*>/)?.[0] ?? ''
    const hierarchy = markup.match(/<div[^>]*data-testid="transaction-pattern-hierarchy"[^>]*>/)?.[0] ?? ''

    expect(chartGroup).toContain('min-w-0')
    expect(chartGroup).toContain('max-w-full')
    expect(hierarchy).toContain('min-w-0')
    expect(hierarchy).toContain('max-w-full')
  })

  it('uses foreground and muted foreground only for the daily inflow and closed series', async () => {
    const module = await import('./blocks/chart-area-interactive') as unknown as {
      dashboardChartTones?: { primary: string; secondary: string; active: string }
    }
    expect(module.dashboardChartTones).toEqual({
      primary: 'var(--foreground)', secondary: 'var(--muted-foreground)', active: 'var(--foreground)',
    })
  })

  it('uses dashboard category tokens rather than risk or status colors for categorical charts', async () => {
    const dashboard = await import('./Dashboard') as unknown as {
      dashboardPatternTones?: readonly string[]
    }
    const data = buildInstitutionChartData(records, { from: new Date(2026, 7, 18), to: TODAY })
    expect(dashboard.dashboardPatternTones).toEqual([
      'var(--dashboard-category-1)',
      'var(--dashboard-category-2)',
      'var(--dashboard-category-3)',
      'var(--dashboard-category-4)',
      'var(--dashboard-category-5)',
      'var(--dashboard-category-6)',
      'var(--dashboard-category-7)',
      'var(--dashboard-category-8)',
      'var(--dashboard-category-9)',
    ])
    expect(data.composition.map(item => item.fill)).toEqual([
      'var(--dashboard-composition-dark)',
      'var(--dashboard-composition-mid)',
      'var(--dashboard-composition-light)',
    ])
    expect(data.distribution.every(item => item.fill.startsWith('var(--dashboard-category-'))).toBe(true)
  })

  it('renders one inverse-color hover line without active dots and mirrors solid/dashed series in the legend', async () => {
    const module = await import('./blocks/chart-area-interactive') as unknown as {
      AlertFlowCursor?: (props: { points?: Array<{ x: number; y: number }>; height?: number }) => React.ReactNode
      AlertFlowLegend?: () => React.ReactNode
    }
    expect(module.AlertFlowCursor).toBeTypeOf('function')
    expect(module.AlertFlowLegend).toBeTypeOf('function')
    const cursor = html(<>{module.AlertFlowCursor!({ points: [{ x: 24, y: 0 }], height: 90 })}</>)
    expect(cursor).toContain('data-testid="alert-flow-hover-line"')
    expect(cursor).toContain('stroke="var(--foreground)"')
    expect(cursor).not.toContain('<circle')
    const legend = html(<>{module.AlertFlowLegend!()}</>)
    expect(legend).toContain('data-line-style="dashed"')
    expect(legend).toContain('data-line-style="solid"')
  })

  it('clearing the dashboard period keeps it cleared and exposes the full chart history', async () => {
    const module = await import('./Dashboard') as unknown as {
      institutionRangeAfterChange?: (next: undefined) => undefined
    }
    expect(module.institutionRangeAfterChange).toBeTypeOf('function')
    expect(module.institutionRangeAfterChange!(undefined)).toBeUndefined()
    expect(buildInstitutionChartData(records, undefined).flow).toHaveLength(dailyFlow.length)
  })
})
