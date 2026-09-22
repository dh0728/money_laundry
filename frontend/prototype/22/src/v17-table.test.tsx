import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { records } from './domain'
import { DateRangeButton, RiskBadge } from './shared'
import { useMemoryState } from './memory'
import Lists from './Lists'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const noop = () => {}

// memory.ts는 모듈 전역 Map을 쓰므로, 렌더 전에 값을 미리 심어두는 probe(v16-content.test.tsx·v17-utility.test.tsx와 동일 패턴)
function seedMemory<T>(key: string, value: T) {
  let setter: ((v: T) => void) | undefined
  const Probe = () => { const [, set] = useMemoryState<T>(key, value); setter = set; return null }
  renderToStaticMarkup(createElement(Probe))
  setter!(value)
}

const alerts = records.filter(r => r.kind === 'Alert')

describe('v20 정렬 머리글 직접 전환', () => {
  it('정렬 열은 반전 대신 살짝 밝아지고 본문 열도 구분된다', () => {
    const cssPath = fileURLToPath(new URL('./index.css', import.meta.url))
    const css = readFileSync(cssPath, 'utf-8')
    expect(css).toMatch(/\[data-slot=table-head\]\[aria-sort=ascending\][\s\S]{0,140}?color-mix/)
    expect(css).not.toMatch(/\[data-slot=table-head\]\[aria-sort=ascending\][^}]*background:var\(--foreground\)/)
    expect(css).toContain('[data-slot=table-cell][data-sorted=true]')
  })

  it('머리글 전체 버튼은 메뉴 없이 한 번 클릭으로 오름차순·내림차순을 전환한다', () => {
    const source = readFileSync(fileURLToPath(new URL('./components/data-table/data-table-column-header.tsx', import.meta.url)), 'utf-8')
    expect(source).toContain('data-slot="sortable-column-button"')
    expect(source).toContain('column.toggleSorting(column.getIsSorted() === "asc")')
    expect(source).not.toContain('DropdownMenu')
    expect(source).not.toContain('clearSorting')
    expect(source).not.toContain('정렬 해제')
  })

  it('공통 DataTable이 정렬 상태를 머리글과 본문 셀에 노출한다', () => {
    const source = readFileSync(fileURLToPath(new URL('./components/data-table/data-table.tsx', import.meta.url)), 'utf-8')
    const styleSource = readFileSync(fileURLToPath(new URL('./lib/data-table.ts', import.meta.url)), 'utf-8')
    expect(source).toContain('aria-sort={')
    expect(source).toContain('header.column.getIsSorted()')
    expect(source).toContain('data-sorted={cell.column.getIsSorted() ? "true" : undefined}')
    expect(styleSource).not.toContain('background: isPinned')
  })

  it('모든 본문 행은 hover 밝기, 선택행은 semantic selection context를 쓴다', () => {
    const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf-8')
    expect(css).toContain('[data-slot=table-body] > [data-slot=table-row]:not([data-state=selected]):hover > [data-slot=table-cell]')
    expect(css).toMatch(/\[data-slot=table-row\]\[data-state=selected\][\s\S]{0,300}?--background:var\(--selection-background\)[\s\S]{0,220}?--foreground:var\(--selection-foreground\)/)
    expect(css).toContain('background:var(--selection-background)!important; color:var(--selection-foreground)!important;')
  })
})

describe('Figma v17 수정사항 · RiskBadge는 outline이 아니라 채움이다', () => {
  it('배경은 riskTone 인라인 style이고 border가 없다', () => {
    const markup = html(<RiskBadge risk="고위험" score={92} />)
    expect(markup).toMatch(/style="background-color:/)
    expect(markup).not.toContain('data-variant="outline"')
    expect(markup).toContain('border-0')
    expect(markup).not.toMatch(/border-border/)
  })

  it('v20 B4: 위험 색을 투명하게 낮춰 전 구간 semantic 고대비 글씨를 쓴다', () => {
    for (const score of [92, 58, 12]) {
      const m = html(<RiskBadge risk="중위험" score={score} />)
      expect(m).toContain('text-selection-destructive-foreground'); expect(m).not.toContain('text-black')
      expect(m).toMatch(/background-color:color-mix\(in oklch,/)
    }
  })
})

describe('v20 툴바 control 높이·기간 hover', () => {
  it('기간 버튼은 검색창과 같은 36px이고 Popover data-slot과 무관한 glow class가 있다', () => {
    const markup = html(<DateRangeButton value={undefined} onChange={noop} />)
    expect(markup).toContain('date-range-control')
    expect(markup).toMatch(/date-range-control[^\"]*h-9/)
    const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf-8')
    expect(css).toMatch(/:is\([^)]*\[data-slot="button"\][^)]*\.date-range-control[^)]*\)/)
    expect(css).toMatch(/\.date-range-control\)[^{]*:is\(:hover, :focus-visible\)/)
  })

  it('선택 기간과 초기화는 분리되지 않은 하나의 연결형 control로 렌더링된다', () => {
    const markup = html(<DateRangeButton value={{ from: new Date(2026, 8, 10), to: new Date(2026, 8, 16) }} onChange={noop} />)
    expect(markup).toContain('data-testid="date-range-combined"')
    expect(markup).toContain('role="group"')
    expect(markup).toContain('rounded-r-none')
    expect(markup).toContain('rounded-l-none')
    expect(markup).toContain('aria-label="기간 초기화"')
  })

  it('기간과 필터 trigger가 같은 glow class를 쓴다', () => {
    const markup = html(<NuqsTestingAdapter><Lists kind="Alert" records={records} user="오검토" onOpen={noop} state="normal" setState={noop} /></NuqsTestingAdapter>)
    expect((markup.match(/date-range-control/g) ?? []).length).toBe(2)
    expect(markup).toContain('filter-trigger')
  })
})
