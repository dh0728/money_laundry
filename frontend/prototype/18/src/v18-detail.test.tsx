import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detailSource = readFileSync(new URL('./Detail.tsx', import.meta.url), 'utf8')

describe('Figma v18 · R2 검토 의견 textarea 리사이즈', () => {
  it('id="reason" textarea는 resize-y를 갖고 resize-none이 아니다', () => {
    const tag = detailSource.match(/<Textarea id="reason"[\s\S]*?\/>/)?.[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('resize-y')
    expect(tag).not.toContain('resize-none')
    expect(tag).toContain('min-h-[280px]')
  })

  it('Detail에 다른 검토/의견 Textarea가 있다면 모두 리사이즈 가능해야 한다', () => {
    const tags = [...detailSource.matchAll(/<Textarea\b[\s\S]*?\/>/g)].map(m => m[0])
    expect(tags.length).toBeGreaterThanOrEqual(1)
    for (const tag of tags) {
      expect(tag).not.toContain('resize-none')
      expect(tag).toMatch(/\bresize-y\b|\bresize\b/)
    }
  })
})

describe('Figma v18 · Detail 거래 표 T3-like 폰트/행 한 단계', () => {
  it('거래 탭 TableCell은 text-sm + py-3 (text-xs 행 아님)', () => {
    const txBlock = detailSource.slice(
      detailSource.indexOf("tab === 'transactions'"),
      detailSource.indexOf("tab === 'conclusion'"),
    )
    expect(txBlock).toContain('TableCell')
    // 셀 본문 클래스가 text-sm / py-3 로 한 단계 커짐
    expect(txBlock).toMatch(/TableCell className="[^"]*text-sm[^"]*py-3/)
    expect(txBlock).not.toMatch(/TableCell className="[^"]*text-xs/)
  })
})


describe('Figma v18 · R1 저장본 없을 때 비활성', () => {
  it('저장본 목록 버튼에 disabled={drafts.length === 0} 이 있다', () => {
    expect(detailSource).toContain('disabled={drafts.length === 0}')
    expect(detailSource).toContain('저장본 목록')
  })
})
