import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('v14 rejection regressions', () => {
  it('keeps the sidebar toggle visible without duplicating AML RADAR branding', () => {
    const app = source('App.tsx')
    const header = app.slice(app.indexOf('<SidebarHeader'), app.indexOf('</SidebarHeader>'))
    expect(header).toContain('SidebarTrigger')
    expect(header).not.toContain('AML RADAR')
    expect(header).not.toContain('<Radar')
  })

  it('uses a non-modal draggable agent with an internal conversation sidebar', () => {
    const agent = source('Agent.tsx')
    expect(agent).not.toMatch(/<Sheet|<Dialog/)
    expect(agent).toContain('onPointerDown')
    expect(agent).toContain('Menu')
    expect(agent).toContain('이전 대화')
    expect(agent).toContain('새 대화')
  })

  it('supports actual date filtering and keeps the period control whole', () => {
    const shared = source('shared.tsx')
    const utility = source('UtilityPages.tsx')
    expect(shared).toContain("value?.from?'rounded-r-none':''")
    expect(utility).toContain('setRange')
    expect(utility).not.toContain('value={undefined} onChange={()=>{}}')
    expect(utility).toContain('!p-0')
  })

  it('shows independent sort affordances on every data-table column', () => {
    const lists = source('Lists.tsx')
    expect(lists).toContain('SortableHead')
    expect(lists).toContain('sortKey')
    expect(lists).toContain('onSort')
  })

  it('uses the required graph controls, three hops, colored risks, and account lanes', () => {
    const graph = source('Graph.tsx')
    expect(graph.indexOf('전체화면')).toBeLessThan(graph.indexOf('화면 맞춤'))
    expect(graph).toContain('Minimize2')
    expect(graph).toContain('max={3}')
    expect(graph).not.toContain('<span>4</span>')
    expect(graph).toContain('riskColor[r]')
    expect(graph).toContain('account-lane')
  })

  it('moves list navigation into the global header and removes dashboard list shortcuts', () => {
    const app = source('App.tsx')
    const detail = source('Detail.tsx')
    const dashboard = source('Dashboard.tsx')
    expect(app).toContain('headerBackLabel')
    expect(app).toContain('F11')
    expect(app).toContain('fullscreenchange')
    expect(detail).not.toContain('← {record.kind} 목록')
    expect(dashboard).not.toContain('전체 목록')
  })

  it('renders an animated canvas network on the login screen', () => {
    const app = source('App.tsx')
    const network = source('LoginNetwork.tsx')
    expect(app).toContain('<LoginNetwork')
    expect(network).toContain('<canvas')
    expect(network).toContain('requestAnimationFrame')
    expect(network).toContain('prefers-reduced-motion')
  })
})
