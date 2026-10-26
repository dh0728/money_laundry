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
  it('sweep 부채꼴(wedge)을 그리고, 이전 버전의 단일 바늘 path는 남아있지 않다', async () => {
    const { RadarMark } = await import('./Brand')
    const markup = html(<RadarMark />)
    // 이전 버전은 중심에서 12시 방향으로 뻗는 단일 직선(바늘) 하나뿐이었다
    expect(markup).not.toContain('M16 16 L16 4')
    // 새 버전은 호(A 커맨드)를 포함하는 부채꼴 본체 + 옅어지는 잔상 2겹을 채워진 도형으로 그린다
    expect(markup).toMatch(/M16 16 L16 2\.5 A13\.5 13\.5 0 0 1 27\.69 9\.25 Z/)
    const wedgeFills = markup.match(/<path[^>]*fill="currentColor"[^>]*>/g) ?? []
    expect(wedgeFills.length).toBeGreaterThanOrEqual(3) // 본체 + 잔상 2겹
    // 십자선은 사방으로 대칭이라(바늘처럼 한쪽으로만 뻗지 않는다) 링 3개도 함께 유지된다
    expect((markup.match(/<circle[^>]*stroke="currentColor"/g) ?? []).length).toBe(3)
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
