import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import Agent from './Agent'
import { Institution, buildInstitutionChartData } from './Dashboard'
import { buildPatternHierarchy } from './Dashboard'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v23 institution dashboard report', () => {
  it('uses a responsive three-column dashboard area with the report outside the date-filtered chart group', () => {
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    const outerGrid = markup.match(/<div[^>]*data-testid="institution-dashboard-grid"[^>]*>/)?.[0] ?? ''
    const group = markup.match(/<section[^>]*data-testid="institution-chart-group"[^>]*>/)?.[0] ?? ''
    const reportSection = markup.match(/<section[^>]*data-testid="ai-daily-report-section"[^>]*>/)?.[0] ?? ''
    const reportStart = markup.indexOf('data-testid="ai-daily-report"')
    const reportContent = markup.slice(reportStart, reportStart + 1200).match(/<div[^>]*data-slot="card-content"[^>]*>/)?.[0] ?? ''
    const hierarchyCard = markup.match(/<div[^>]*data-testid="transaction-pattern-hierarchy"[^>]*>/)?.[0] ?? ''
    const hierarchyFill = markup.match(/<div[^>]*data-testid="transaction-pattern-fill"[^>]*>/)?.[0] ?? ''
    expect(outerGrid).toContain('min-w-0')
    expect(outerGrid).toContain('@6xl:grid-cols-3')
    expect(outerGrid).toContain('items-stretch')
    expect(group).toContain('@6xl:col-span-2')
    expect(group).toContain('h-full')
    expect(group).toContain('flex-col')
    expect(group).toContain('gap-4')
    expect(group).not.toContain('space-y-4')
    expect(reportSection).toContain('@6xl:col-span-1')
    expect(reportSection).toContain('h-full')
    expect(reportContent).toContain('h-full')
    expect(reportContent).not.toContain('max-h-')
    expect(hierarchyCard).toContain('min-h-0')
    expect(hierarchyCard).toContain('flex-1')
    expect(hierarchyFill).toContain('min-h-0')
    expect(hierarchyFill).toContain('flex-1')
    const groupStart = markup.indexOf('data-testid="institution-chart-group"')
    const reportSectionStart = markup.indexOf('data-testid="ai-daily-report-section"')
    expect(groupStart).toBeGreaterThan(-1)
    expect(reportSectionStart).toBeGreaterThan(groupStart)
    expect(markup.slice(groupStart, reportSectionStart)).not.toContain('data-testid="ai-daily-report"')
    expect(markup).toContain('data-testid="ai-daily-report"')
    expect(markup).toContain('생성 시각')
    expect(markup).toContain('오늘의 변화')
    expect(markup).toContain('집중 패턴')
    expect(markup).toContain('권고 조치')
    expect(markup).toContain('우선 검토')
    expect(markup).toContain('근거 보기')
  })

  it('combines transaction composition and pattern distribution in one hierarchical chart', async () => {
    const module = await import('./Dashboard') as unknown as {
      PatternAxisTick?: (props: { x?: number; y?: number; payload?: { value?: string } }) => React.ReactNode
    }
    expect(module).not.toHaveProperty('dashboardPatternTones')
    expect(module.PatternAxisTick).toBeTypeOf('function')
    const patternLabel = html(<>{module.PatternAxisTick!({ x: 20, y: 12, payload: { value: 'FAN_OUT' } })}</>)
    expect(patternLabel).toContain('style="fill:var(--foreground)"')
    expect(patternLabel).toContain('font-weight="600"')
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    const hierarchy = markup.slice(markup.indexOf('data-testid="transaction-pattern-hierarchy"'))
    expect(hierarchy).toContain('aria-label="거래 구성과 패턴 분포 보기"')
    expect(hierarchy).toContain('>계층 막대</button>')
    expect(hierarchy).toContain('>이중 도넛</button>')
    expect(hierarchy).toContain('data-testid="transaction-pattern-bar"')
    expect(hierarchy).not.toContain('data-testid="transaction-pattern-donut"')
    expect(markup).not.toContain('data-testid="pattern-distribution-chart"')
    expect(markup).not.toContain('data-testid="laundering-composition-chart"')
  })

  it('confines every pattern type to the parent pattern-owned range', () => {
    const geometry = buildPatternHierarchy(
      [
        { name: '패턴 소속', value: 60, fill: 'parent' },
        { name: '패턴 외 · 다건 묶음', value: 30, fill: 'multi' },
        { name: '패턴 외 · 단일 거래', value: 10, fill: 'single' },
      ],
      [
        { pattern: 'FAN_OUT', alerts: 3, fill: 'fan' },
        { pattern: 'CYCLE', alerts: 1, fill: 'cycle' },
      ],
    )
    expect(geometry.patternShare).toBe(0.6)
    expect(geometry.patternSegments.map(item => item.value)).toEqual([3, 1])
    expect(geometry.patternSegments.map(item => item.name)).toEqual(['FAN_OUT', 'CYCLE'])
    expect(geometry.compositionArc).toEqual({ startAngle: 90, endAngle: -270 })
    expect(geometry.patternArc).toEqual({ startAngle: 90, endAngle: -126 })
    expect(geometry.nonPatternArc).toEqual({ startAngle: -126, endAngle: -270 })
    expect(geometry.nonPatternSegments.map(item => item.name)).toEqual(['패턴 외 · 다건 묶음', '패턴 외 · 단일 거래'])
    expect(geometry.donutOuter).toEqual(geometry.patternSegments)
    expect(geometry.donutOuter).toHaveLength(2)
    expect(geometry.donutOuter.some(item => item.fill === 'transparent')).toBe(false)
  })

  it('uses grayscale only for the three composition categories', () => {
    expect(buildInstitutionChartData(records).composition.map(item => item.fill)).toEqual([
      'var(--foreground)',
      'var(--foreground)',
      'var(--foreground)',
    ])
  })

  it('keeps rounded separate bars and removes redundant legends', async () => {
    const module = await import('./Dashboard') as unknown as {
      TransactionPatternHierarchy: (props: {
        composition: Array<{ name: string; value: number; fill: string }>
        distribution: Array<{ pattern: string; alerts: number; fill: string }>
        view: 'bar' | 'donut'
      }) => React.ReactNode
    }
    const composition = [
      { name: '패턴 소속', value: 60, fill: 'dark' },
      { name: '패턴 외 · 다건 묶음', value: 30, fill: 'mid' },
      { name: '패턴 외 · 단일 거래', value: 10, fill: 'light' },
    ]
    const distribution = [{ pattern: 'FAN_OUT', alerts: 3, fill: 'fan' }, { pattern: 'CYCLE', alerts: 1, fill: 'cycle' }]
    const bar = html(<>{module.TransactionPatternHierarchy({ composition, distribution, view: 'bar' })}</>)
    const donut = html(<>{module.TransactionPatternHierarchy({ composition, distribution, view: 'donut' })}</>)
    const compositionBar = bar.indexOf('data-testid="composition-bar"')
    const patternBar = bar.indexOf('data-testid="pattern-child-range"')
    expect(compositionBar).toBeGreaterThan(-1)
    expect(compositionBar).toBeLessThan(patternBar)
    const hierarchyGrid = bar.match(/<div[^>]*data-testid="hierarchy-bar-grid"[^>]*>/)?.[0] ?? ''
    const parentCell = bar.match(/<div[^>]*data-testid="pattern-parent-cell"[^>]*>/)?.[0] ?? ''
    const barLayout = bar.match(/<div[^>]*data-testid="transaction-pattern-bar"[^>]*>/)?.[0] ?? ''
    expect(barLayout).toContain('h-full')
    expect(barLayout).toContain('grid-rows-[24px_minmax(180px,1fr)]')
    expect(hierarchyGrid).toContain('grid-template-columns:60fr 30fr 10fr')
    expect(hierarchyGrid).toContain('gap-1.5')
    expect(hierarchyGrid).toContain('rounded-lg')
    expect(parentCell).toContain('row-span-2')
    expect(parentCell).toContain('grid-rows-2')
    expect((bar.match(/data-testid="composition-sibling-block"/g) ?? [])).toHaveLength(2)
    expect((bar.match(/data-testid="pattern-child-label"/g) ?? [])).toHaveLength(2)
    expect(bar).not.toContain('data-testid="composition-legend"')
    expect(bar).not.toContain('data-testid="pattern-legend"')
    expect(donut).toContain('data-testid="composition-legend"')
    expect(donut).not.toContain('data-testid="pattern-legend"')
    expect(donut).toContain('data-testid="transaction-pattern-donut-chart"')
    expect(donut).not.toContain('data-testid="donut-label-connector"')
  })

  it('keeps arc-following pattern labels readable on both sides of the donut', async () => {
    const module = await import('./Dashboard') as unknown as {
      patternArcLabelPath?: (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => string
    }
    expect(module.patternArcLabelPath).toBeTypeOf('function')
    expect(module.patternArcLabelPath?.(200, 200, 100, 90, 0)).toBe('M 200 100 A 100 100 0 0 1 300 200')
    expect(module.patternArcLabelPath?.(200, 200, 100, -90, -180)).toBe('M 100 200 A 100 100 0 0 0 200 300')
  })

  it('places the patterned child ring directly outside its parent', async () => {
    const module = await import('./Dashboard') as unknown as {
      dashboardDonutRadii: {
        parentInner: number
        parentOuter: number
        childInner: number
        childOuter: number
      }
      TransactionPatternHierarchy: (props: {
        composition: Array<{ name: string; value: number; fill: string }>
        distribution: Array<{ pattern: string; alerts: number; fill: string }>
        view: 'bar' | 'donut'
      }) => React.ReactNode
    }
    const radii = module.dashboardDonutRadii
    expect(radii.childInner).toBe(radii.parentOuter)
    expect(radii.childOuter).toBeGreaterThan(radii.childInner)

    const donut = html(<>{module.TransactionPatternHierarchy({
      composition: [
        { name: '패턴 소속', value: 60, fill: 'dark' },
        { name: '패턴 외 · 다건 묶음', value: 30, fill: 'mid' },
        { name: '패턴 외 · 단일 거래', value: 10, fill: 'light' },
      ],
      distribution: [{ pattern: 'FAN_OUT', alerts: 3, fill: 'fan' }, { pattern: 'CYCLE', alerts: 1, fill: 'cycle' }],
      view: 'donut',
    })}</>)
    const layout = donut.match(/<div[^>]*data-testid="transaction-pattern-donut"[^>]*>/)?.[0] ?? ''
    const chart = donut.match(/<div[^>]*data-testid="transaction-pattern-donut-chart"[^>]*>/)?.[0] ?? ''
    expect(layout).toContain('h-full')
    expect(layout).toContain('min-h-[320px]')
    expect(chart).toContain('h-full')
    expect(chart).toContain('aspect-square')
  })

  it('gives the expanded report evidence for three priority reviews without repeating KPI labels', () => {
    const markup = html(<Institution records={records} onOpen={() => {}} />)
    const report = markup.slice(markup.indexOf('data-testid="ai-daily-report"'), markup.indexOf('data-testid="ai-daily-report"') + 9000)
    expect((report.match(/data-testid="ai-priority-item"/g) ?? [])).toHaveLength(3)
    expect((report.match(/근거 ·/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(report).toContain('운영 해석')
    expect(report).toContain('교차 확인 질문')
    expect(report).toContain('다음 점검')
    expect(report).toContain('overflow-y-auto')
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
