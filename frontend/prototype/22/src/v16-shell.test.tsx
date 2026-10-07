import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v16 Figma 검수 · Alert nav 아이콘', () => {
  it('Alert nav는 lucide Siren 아이콘을 쓴다(lucide-siren 클래스)', async () => {
    const { Siren } = await import('lucide-react')
    expect(html(<Siren className="size-4" />)).toContain('lucide-siren')
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/icon: Siren/)
    expect(source).not.toContain('TriangleAlert')
  })
})

describe('v16 Figma 검수 · RadarMark(로고)', () => {
  it('uses the existing library radar with a restrained monochrome sweep and target', async () => {
    const { RadarMark } = await import('./Brand')
    const markup = html(<RadarMark />)
    expect(markup).toContain('lucide-radar')
    expect(markup).toContain('currentColor')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('<circle')
    expect(markup).toContain('<path')
    expect((markup.match(/<(?:circle|path|line)\b/g) ?? []).length).toBeLessThanOrEqual(8)
    expect(markup).not.toMatch(/destructive|#e60000|fillOpacity/)
  })
})

describe('v16 Figma 검수 · 전역 검색 색인', () => {
  it('계좌 번호로 실제 업무 record를 찾을 수 있다', async () => {
    const { buildAccountIndex } = await import('./GlobalSearch')
    const index = buildAccountIndex(records)
    expect(index.length).toBeGreaterThan(0)
    const entry = index[0]
    expect(entry.recordIds.length).toBeGreaterThan(0)
    // 컴포넌트가 쓰는 것과 같은 부분 일치 검색으로 같은 계좌를 다시 찾아낼 수 있어야 한다
    const q = entry.account.slice(0, Math.max(3, entry.account.length - 2)).toLowerCase()
    const found = index.filter(e => e.account.toLowerCase().includes(q))
    expect(found.some(e => e.account === entry.account)).toBe(true)
    // recordIds가 가리키는 업무가 실제로 domain.records에 존재해야 한다
    for (const id of entry.recordIds) expect(records.some(r => r.id === id)).toBe(true)
  })

  it('설정 항목 "테마"를 화면·설정 그룹에서 찾을 수 있다', async () => {
    const { settingItems, pageLinks } = await import('./GlobalSearch')
    const all = [...pageLinks, ...settingItems]
    const q = '테마'
    const found = all.filter(s => s.label.toLowerCase().includes(q.toLowerCase()))
    expect(found).toContainEqual({ label: '테마', page: 'settings' })
  })
})
