import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Table, TableHeader, TableRow } from '@/components/ui/table'
import { records } from './domain'
import { SortIcon, SortableHead } from './shared'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const alerts = records.filter(r => r.kind === 'Alert')

describe('Figma v18 · T1 정렬 아이콘을 알림 WideNarrow 세트로 통일', () => {
  it('내림차순은 arrow-down-wide-narrow, 오름차순은 arrow-up-narrow-wide다', () => {
    const desc = html(<SortIcon direction="desc" />)
    const asc = html(<SortIcon direction="asc" />)
    expect(desc).toContain('lucide-arrow-down-wide-narrow')
    expect(desc).toContain('data-sort="desc"')
    expect(asc).toContain('lucide-arrow-up-narrow-wide')
    expect(asc).toContain('data-sort="asc"')
    // 활성 상태는 단일 아이콘만 (이중 화살표 아님)
    expect(desc).not.toContain('lucide-arrow-down ')
    expect(desc).not.toContain('lucide-arrow-up ')
  })

  it('미정렬은 기존 비활성 이중 ArrowDown+ArrowUp(오른쪽) 아이콘을 유지한다', () => {
    const none = html(<SortIcon direction={null} />)
    expect(none).toContain('data-sort="none"')
    expect(none).toContain('lucide-arrow-down')
    expect(none).toContain('lucide-arrow-up')
    expect(none).not.toContain('wide-narrow')
    expect(none).not.toContain('narrow-wide')
    expect(none).toContain('bg-muted')
  })
})

describe('Figma v18 · T2 정렬 활성 상태가 색 반전으로 분명하다', () => {
  it('활성 SortIcon은 bg-foreground text-background 반전이다', () => {
    const desc = html(<SortIcon direction="desc" />)
    expect(desc).toContain('bg-foreground')
    expect(desc).toContain('text-background')
    expect(desc).not.toContain('bg-muted')
  })

  it('SortableHead 활성 열은 aria-sort ascending/descending을 내놓는다', () => {
    const head = (direction: 'desc' | 'asc' | null) =>
      html(<Table><TableHeader><TableRow><SortableHead label="금액" active={!!direction} direction={direction} onSort={() => {}} /></TableRow></TableHeader></Table>)
    expect(head('desc')).toContain('aria-sort="descending"')
    expect(head('asc')).toContain('aria-sort="ascending"')
    expect(head(null)).toContain('aria-sort="none"')
  })

  it('index.css의 aria-sort 머리글 반전 규칙이 유지된다', () => {
    const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf-8')
    expect(css).toMatch(/\[data-slot=table-head\]\[aria-sort=ascending\]/)
    expect(css).toMatch(/\[data-slot=table-head\]\[aria-sort=descending\]/)
    expect(css).toContain('background:var(--foreground)')
    expect(css).toContain('color:var(--background)')
  })
})

describe('Figma v18 · T3 표 행 높이·폰트 한 단계 키움(패널 높이 고정 금지)', () => {
  it('SortableHead 버튼은 text-sm, 머리글은 !h-12로 한 단계 크다', () => {
    const markup = html(<Table><TableHeader><TableRow><SortableHead label="위험도" active direction="desc" onSort={() => {}} /></TableRow></TableHeader></Table>)
    expect(markup).toContain('text-sm')
    expect(markup).toContain('!h-12')
  })
})
