import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import Lists from './Lists'

const noop = () => {}
const html = (search = '') => renderToStaticMarkup(
  <NuqsTestingAdapter searchParams={search}><TooltipProvider>
    <Lists kind="Alert" records={records} user="오검토" onOpen={noop} state="normal" setState={noop} />
  </TooltipProvider></NuqsTestingAdapter>,
)
const rowCount = (m: string) => (m.match(/<tr[^>]*cursor-pointer/g) ?? []).length

// v20: 목록 표는 Dice UI data-table, 툴바는 이전 UI로 되돌림(R2).
describe('v19 목록 · data-table', () => {
  it('기본 페이지당 20행, 위험도 내림차순이 첫 정렬이다', () => {
    const m = html()
    expect(rowCount(m)).toBe(Math.min(20, records.filter(r => r.kind === 'Alert').length))
    const scores = [...m.matchAll(/<span class="font-mono">(\d+)<\/span><span class="text-\[10px\]/g)].map(x => Number(x[1]))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })
  it('v20 R2: 툴바는 이전 UI(검색 · 기간 · 필터 · 다운로드)이고 Dice UI 점선 필터 버튼은 없다', () => {
    const m = html()
    for (const label of ['ID, 탐지 내용, 담당자 검색', '기간', '필터', '다운로드']) expect(m).toContain(label)
    expect(m).not.toContain('border-dashed')
  })
  it('v20 R2: 열 숨기기는 뺐다(되돌릴 경로가 안 보임)', () => {
    expect(readFileSync(new URL('./Lists.tsx', import.meta.url), 'utf8')).toContain('defaultColumn: { enableHiding: false }')
  })
  it('페이지 문구가 한국어다', () => {
    const m = html()
    expect(m).toContain('페이지당 행'); expect(m).not.toContain('Rows per page')
  })
})
