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

// v19: 목록은 Dice UI data-table(TanStack Table)로 교체. 직접 만든 표 대신 열 정의만 검증한다.
describe('v19 목록 · data-table', () => {
  it('기본 페이지당 20행, 위험도 내림차순이 첫 정렬이다', () => {
    const m = html()
    expect(rowCount(m)).toBe(Math.min(20, records.filter(r => r.kind === 'Alert').length))
    const scores = [...m.matchAll(/<span class="font-mono">(\d+)<\/span><span class="text-\[10px\]/g)].map(x => Number(x[1]))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })
  it('툴바에 검색·위험 점수·탐지 유형·담당자·처리 상태·탐지일 필터와 다운로드가 있다', () => {
    const m = html()
    for (const label of ['ID, 탐지 내용, 담당자 검색', '위험 점수', '탐지 유형', '담당자', '처리 상태', '탐지일', '다운로드']) expect(m).toContain(label)
  })
  it('URL 필터(담당자)가 브라우저에서 적용된다', () => {
    const mine = records.filter(r => r.kind === 'Alert' && r.owner === '김조사').length
    expect(mine).toBeGreaterThan(0)
    expect(rowCount(html(`?owner=${encodeURIComponent('김조사')}`))).toBe(Math.min(20, mine))
  })
  it('페이지 문구가 한국어다', () => {
    const m = html()
    expect(m).toContain('페이지당 행'); expect(m).not.toContain('Rows per page')
  })
})
