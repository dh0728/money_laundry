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
    // v20 R7: 거래 표는 목록과 같은 data-table(TxTable). 셀 본문은 text-sm을 유지한다
    expect(txBlock).toContain('<TxTable')
    const txTable = readFileSync(new URL('./TxTable.tsx', import.meta.url), 'utf8')
    expect(txTable).toMatch(/text-sm/)
    expect(txTable).not.toMatch(/text-xs/)
  })
})


describe('Figma v18 · R1 저장본 없을 때 비활성', () => {
  it('저장본 목록 버튼에 disabled={drafts.length === 0} 이 있다', () => {
    expect(detailSource).toContain('disabled={drafts.length === 0}')
    expect(detailSource).toContain('저장본 목록')
  })
})

describe('v20 거래 선택·검토 의견 레이아웃', () => {
  it('선택된 거래 행은 전경·배경이 반전된다', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(css).toContain('[data-slot=table-row][data-state=selected] > [data-slot=table-cell]')
    expect(css).toContain('background:var(--foreground)!important; color:var(--background)!important;')
  })

  it('선택한 거래 카드는 현재 정렬 기준 선택 행 높이에 맞춘다', () => {
    const txTable = readFileSync(new URL('./TxTable.tsx', import.meta.url), 'utf8')
    expect(txTable).toContain('onSelectedIndexChange')
    expect(detailSource).toContain('selected-transaction-card')
    expect(detailSource).toContain("'--selected-row-offset': `${42 + selectedTxIndex * 49}px`")
  })

  it('검토 의견은 남은 화면 높이를 채우고 textarea 아래 구분선이 없다', () => {
    expect(detailSource).toContain('className="min-h-full flex flex-col gap-5"')
    const conclusion = detailSource.slice(detailSource.indexOf("tab === 'conclusion'"), detailSource.indexOf('<AlertDialog open={confirm}'))
    expect(conclusion).toContain('flex-1')
    expect(conclusion).not.toContain('justify-end gap-2 border-t')
  })
})
