import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detailSource = readFileSync(new URL('./Detail.tsx', import.meta.url), 'utf8')

const selectionTokens = (css: string, theme: 'light' | 'dark') => {
  const selector = theme === 'light' ? ':root' : '\\.dark'
  const block = [...css.matchAll(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]+)\\}`, 'g'))].map(match => match[1]).join('\n')
  return Object.fromEntries([...block.matchAll(/(--selection-[\w-]+):\s*([^;]+)/g)].map(([, name, value]) => [name, value.trim()]))
}

const neutralLuminance = (oklch: string) => {
  const lightness = Number(oklch.match(/oklch\((\.?\d+)/)?.[1])
  return lightness ** 3
}

const hexLuminance = (hex: string) => {
  const normalized = hex.length === 4 ? `#${[...hex.slice(1)].map(channel => channel.repeat(2)).join('')}` : hex
  const channels = normalized.slice(1).match(/.{2}/g)?.map(channel => Number.parseInt(channel, 16) / 255) ?? []
  const linear = channels.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
}

const contrast = (first: number, second: number) => (Math.max(first, second) + .05) / (Math.min(first, second) + .05)

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

describe('v23 거래 표·검토 의견 레이아웃', () => {
  it('선택된 거래 행은 primitive 반전 대신 semantic selection context를 쓴다', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    const selectedRow = css.match(/\[data-slot=table-row\]\[data-state=selected\][\s\S]{0,1200}/)?.[0] ?? ''
    expect(selectedRow).toContain('--foreground:var(--selection-foreground)')
    expect(selectedRow).toContain('--muted-foreground:var(--selection-muted-foreground)')
    expect(selectedRow).toContain('--border:var(--selection-border)')
    expect(selectedRow).toMatch(/\[data-slot=badge\]\[data-variant=outline\][^}]*border-color:var\(--selection-border\)/)
  })

  it.each(['light', 'dark'] as const)('%s theme selection colors maintain readable text contrast', (theme) => {
    const tokens = selectionTokens(readFileSync(new URL('./index.css', import.meta.url), 'utf8'), theme)
    const background = neutralLuminance(tokens['--selection-background'])
    expect(contrast(neutralLuminance(tokens['--selection-foreground']), background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(neutralLuminance(tokens['--selection-muted-foreground']), background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['light', 'dark'] as const)('%s theme selected destructive badges keep white-on-red contrast', (theme) => {
    const tokens = selectionTokens(readFileSync(new URL('./index.css', import.meta.url), 'utf8'), theme)
    expect(tokens['--selection-destructive-foreground']).toBe('#fff')
    expect(contrast(hexLuminance(tokens['--selection-destructive-foreground']), hexLuminance(tokens['--selection-destructive-background']))).toBeGreaterThanOrEqual(4.5)
  })

  it('중복 선택 상세 카드 없이 거래 표 자체가 전체 정보를 제공한다', () => {
    const txTable = readFileSync(new URL('./TxTable.tsx', import.meta.url), 'utf8')
    expect(detailSource).not.toContain('selected-transaction-card')
    expect(detailSource).toContain('data-testid="detail-transaction-table"')
    expect(txTable).not.toContain('toggleSingleSelectedId')
    expect(txTable).not.toContain('onRowClick')
  })

  it('검토 의견은 남은 화면 높이를 채우고 textarea 아래 구분선이 없다', () => {
    expect(detailSource).toContain('className="min-h-full flex flex-col gap-5"')
    const conclusion = detailSource.slice(detailSource.indexOf("tab === 'conclusion'"), detailSource.indexOf('<AlertDialog open={confirm}'))
    expect(conclusion).toContain('flex-1')
    expect(conclusion).not.toContain('justify-end gap-2 border-t')
  })
})
