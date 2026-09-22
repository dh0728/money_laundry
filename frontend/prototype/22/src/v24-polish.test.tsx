import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const transactions = readFileSync(new URL('./Transactions.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8')
const flowDetail = readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')

describe('v24 성능·표 밀도 마감', () => {
  it('조명은 전역 포인터 추적 없이 CSS hover/focus로만 동작한다', () => {
    expect(main).not.toContain('pointermove')
    expect(main).not.toContain('requestAnimationFrame')
    expect(main).not.toContain('getBoundingClientRect')
    expect(main).not.toContain("style.setProperty('--shine-x'")
    expect(css).not.toMatch(/\.app-header[^}]*radial-gradient/)
  })

  it('표면과 컨트롤은 foreground 기반의 지역 하이라이트·포커스 상태만 그린다', () => {
    const localLighting = css.slice(css.indexOf('/* 조작 컨트롤'))
    const inputRule = localLighting.match(/:is\(\[data-slot="input"\][^{}]+:is\(:hover, :focus-visible\)\s*\{[^}]+\}/)?.[0] ?? ''
    const reducedMotionRule = localLighting.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(localLighting).toContain('color-mix(in oklch, var(--foreground)')
    expect(localLighting).not.toContain('var(--shine-x')
    expect(localLighting).not.toContain('var(--shine-y')
    expect(localLighting).not.toContain('pointer-events: none')
    expect(localLighting).toMatch(/:focus-visible/)
    expect(localLighting).toMatch(/:focus-visible[^\{]*\{[^}]*outline:\s*2px solid var\(--ring\)[^}]*outline-offset:\s*2px/)
    expect(localLighting).toMatch(/:focus-within/)
    expect(localLighting).toMatch(/prefers-reduced-motion:\s*reduce/)
    expect(localLighting).not.toMatch(/#(?:ef|f)[0-9a-f]{4,}|particle/i)
    expect(inputRule).toContain('transition:')
    expect(reducedMotionRule).toContain('[data-slot="input"]')
    expect(reducedMotionRule).toContain('textarea')
  })

  it('차트 묶음과 실제 플로우 패널 루트는 명시적으로 조명 표면임을 표시한다', () => {
    expect(dashboard).toMatch(/data-testid="institution-chart-group"[^>]*data-shine="surface"/)
    expect(flowDetail).toMatch(/data-testid="flow-panel"[^>]*data-shine="surface"/)
  })

  it('Transactions의 소유주·계좌·거래 ID 셀에는 장식 아이콘을 반복하지 않는다', () => {
    expect(transactions).not.toMatch(/\b(UserRound|Landmark|ArrowUpRight|ArrowDownLeft)\b/)
    expect(transactions).toContain('data-testid="hierarchy-toggle-all"')
    expect(transactions).toContain("row.original.kind === 'owner' ? 'hierarchy-owner' : 'hierarchy-account'")
  })
})
