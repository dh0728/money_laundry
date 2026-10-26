import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const agentSrc = readFileSync(new URL('./Agent.tsx', import.meta.url), 'utf8')
const appSrc = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('v18 RDR 9000 · Notion-style FAB', () => {
  it('AgentFab는 닫힘일 때만 fixed 우하단 circular FAB를 렌더한다', async () => {
    const { AgentFab, AgentToggle } = await import('./Agent')
    expect(AgentToggle).toBe(AgentFab)
    const closed = html(<AgentFab open={false} onToggle={() => {}} />)
    expect(closed).toContain('data-testid="agent-toggle"')
    expect(closed).toContain('agent-fab')
    expect(closed).toContain('fixed')
    expect(closed).toContain('bottom-6')
    expect(closed).toContain('right-6')
    expect(closed).toContain('z-50')
    expect(closed).toContain('size-14')
    expect(closed).toContain('rounded-full')
    expect(closed).toContain('data-testid="rdr-eye"')
    expect(closed).toMatch(/aria-label="RDR 9000 열기"/)
    expect(html(<AgentFab open onToggle={() => {}} />)).toBe('')
  })

  it('App 헤더에는 AgentToggle/AgentFab가 없고 Agent 옆에 FAB가 뜬다', () => {
    expect(appSrc).not.toMatch(/header[\s\S]{0,800}<Agent(Toggle|Fab)\b/)
    expect(appSrc).toContain('<AgentFab open={agentOpen}')
    expect(appSrc).toContain('<Agent open={agentOpen}')
    expect(appSrc).toContain('우하단 FAB')
  })

  it('index.css에 v18 RDR fab 그림자가 있다', () => {
    expect(css).toContain('/* v18 RDR fab */')
    expect(css).toContain('.agent-fab')
  })

  it('Agent.tsx는 AgentFab를 export하고 AgentToggle 별칭을 유지한다', () => {
    expect(agentSrc).toContain('export function AgentFab')
    expect(agentSrc).toContain('export const AgentToggle = AgentFab')
  })
})

  it('AgentFab source has drag + full-bleed eye', () => {
    expect(agentSrc).toContain('aml-rdr-fab-pos')
    expect(agentSrc).toContain('onPointerDown')
    expect(agentSrc).toContain('size-14')
    expect(agentSrc).toContain('bg-transparent')
  })
