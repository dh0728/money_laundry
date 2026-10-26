import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as shared from './shared'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('shared moving navigation', () => {
  it('renders exactly one decorative underline while preserving every tab and active value', () => {
    for (const value of ['overview', 'transactions']) {
      const markup = renderToStaticMarkup(<shared.UnderTabs value={value} onChange={() => {}} items={[{ value: 'overview', label: '개요' }, { value: 'transactions', label: '거래 12,345' }]} />)
      expect(markup.match(/data-slot="tab-indicator"/g)).toHaveLength(1)
      expect(markup).toMatch(/aria-hidden="true"[^>]*data-slot="tab-indicator"/)
      expect(markup.match(/role="tab"/g)).toHaveLength(2)
      expect(markup.match(/data-state="active"/g)).toHaveLength(1)
    }
  })

  it('measures unequal targets relative to the scrolling, bordered containing surface', () => {
    const measure = (shared as unknown as { indicatorGeometry: (root: unknown, target: unknown) => unknown }).indicatorGeometry
    expect(measure).toBeTypeOf('function')
    const root = { getBoundingClientRect: () => ({ left: 100, top: 60 }), clientLeft: 1, clientTop: 1, scrollLeft: 20, scrollTop: 10 }
    expect(measure(root, { closest: () => null, getBoundingClientRect: () => ({ left: 111, top: 71, width: 62, height: 40 }) })).toEqual({ x: 30, y: 20, width: 62, height: 40 })
    expect(measure(root, { closest: () => null, getBoundingClientRect: () => ({ left: 211, top: 501, width: 180, height: 48 }) })).toEqual({ x: 130, y: 450, width: 180, height: 48 })
    expect(measure(root, null)).toBeNull()
    expect(measure(root, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) })).toBeNull()
  })

  it('neutralizes trigger underlines and makes both shared indicators instant for reduced motion', () => {
    expect(css).toMatch(/\.underline-tabs \[data-slot=tabs-trigger\]::after\s*\{[^}]*display:\s*none/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.tab-indicator,\s*\.sidebar-indicator\s*\{[^}]*transition:\s*none/)
  })

  it('clips sidebar selection to the scrollable content so it cannot leak behind header or footer', () => {
    const root = { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0 } as HTMLElement
    const viewport = { getBoundingClientRect: () => ({ top: 60, bottom: 250 }) }
    const target = (top: number) => ({ getBoundingClientRect: () => ({ left: 8, top, bottom: top + 40, width: 194, height: 40 }), closest: () => viewport }) as unknown as HTMLElement
    expect(shared.indicatorGeometry(root, target(35))).toEqual({ x: 8, y: 35, width: 194, height: 40, clipTop: 25, clipBottom: 0 })
    expect(shared.indicatorGeometry(root, target(230))).toEqual({ x: 8, y: 230, width: 194, height: 40, clipTop: 0, clipBottom: 20 })
    expect(shared.indicatorGeometry(root, target(10))).toBeNull()
  })

  it('keeps one sidebar indicator with both primary and footer destinations in its coordinate surface', () => {
    const markup = renderToStaticMarkup(<shared.SidebarSelection value="account"><button data-nav-id="dashboard">Dashboard</button><footer><button data-nav-id="account" data-active="true">계정</button></footer></shared.SidebarSelection>)
    expect(markup.match(/data-slot="sidebar-indicator"/g)).toHaveLength(1)
    expect(markup).toMatch(/aria-hidden="true"[^>]*data-slot="sidebar-indicator"/)
    expect(markup).toContain('data-nav-id="account"')
    expect(markup).toContain('data-nav-id="dashboard"')
  })

  it('offers a visible narrow-screen opener for the mobile Sheet', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const header = source.slice(source.indexOf('<header'), source.indexOf('</header>'))
    expect(header).toMatch(/<SidebarTrigger[^>]*className="[^"]*md:hidden/)
  })

  it('animates deliberate selection only, while layout tracking and offscreen reentry are immediate', () => {
    type Geometry = { x: number; y: number; width: number; height: number; clipTop?: number; clipBottom?: number }
    type State = { geometry: Geometry | null; animate: boolean }
    const update = (shared as unknown as { updateIndicator: (previous: State, geometry: Geometry | null, reason: 'selection' | 'layout') => State }).updateIndicator
    expect(update).toBeTypeOf('function')
    const first = { x: 8, y: 70, width: 194, height: 40 }
    const next = { x: 8, y: 116, width: 194, height: 40 }
    const mounted = update({ geometry: null, animate: false }, first, 'selection')
    expect(mounted).toEqual({ geometry: first, animate: false })
    const selected = update(mounted, next, 'selection')
    expect(selected).toEqual({ geometry: next, animate: true })
    expect(update(selected, next, 'layout')).toBe(selected) // Observer's unchanged initial notification must not cancel motion.
    expect(update(selected, first, 'layout')).toEqual({ geometry: first, animate: false })
    const offscreen = update(selected, null, 'layout')
    expect(offscreen).toEqual({ geometry: null, animate: false })
    expect(update(offscreen, first, 'layout')).toEqual({ geometry: first, animate: false })
    const partial = { ...first, y: 35, clipTop: 25, clipBottom: 0 }
    expect(update(mounted, partial, 'selection')).toEqual({ geometry: partial, animate: false })
    expect(update({ geometry: partial, animate: false }, next, 'selection')).toEqual({ geometry: next, animate: false })
    expect(css).toMatch(/\.tab-indicator\[data-animate=false\],\s*\.sidebar-indicator\[data-animate=false\]\s*\{[^}]*transition:\s*none/)
  })

  it('gives narrow headers a full-width search row while retaining navigation and actions above it', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const header = source.slice(source.indexOf('<header'), source.indexOf('</header>'))
    expect(header).toContain('header-navigation')
    expect(header).toContain('header-search')
    expect(header).toContain('header-search-input')
    expect(header).toContain('min-w-[180px]')
    const narrow = css.slice(css.indexOf('@media (max-width:520px)'), css.indexOf('@media (max-width:767px)'))
    expect(narrow).toMatch(/\.app-header\s*\{[^}]*height:\s*auto[^}]*grid-template-columns:\s*minmax\(0,1fr\) auto/)
    expect(narrow).toMatch(/\.header-navigation\s*\{[^}]*grid-area:\s*1 \/ 1/)
    expect(narrow).toMatch(/\.header-actions\s*\{[^}]*grid-area:\s*1 \/ 2/)
    expect(narrow).toMatch(/\.header-search\s*\{[^}]*grid-area:\s*2 \/ 1 \/ 3 \/ -1/)
    expect(narrow).toMatch(/\.header-search-input\s*\{[^}]*width:\s*100%[^}]*min-width:\s*180px/)
  })
})
