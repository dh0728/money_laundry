import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'
import { RiskBadge } from './shared'
import { useMemoryState } from './memory'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const noop = () => {}

// memory.ts는 모듈 전역 Map을 쓰므로, 렌더 전에 값을 미리 심어두는 probe(v16-content.test.tsx·v17-utility.test.tsx와 동일 패턴)
function seedMemory<T>(key: string, value: T) {
  let setter: ((v: T) => void) | undefined
  const Probe = () => { const [, set] = useMemoryState<T>(key, value); setter = set; return null }
  renderToStaticMarkup(createElement(Probe))
  setter!(value)
}

const alerts = records.filter(r => r.kind === 'Alert')

describe('Figma v17 수정사항 · 정렬 머리글 반전', () => {
  it('index.css에 aria-sort 기반 머리글 반전(bg-foreground/text-background) 규칙이 있다', () => {
    const cssPath = fileURLToPath(new URL('./index.css', import.meta.url))
    const css = readFileSync(cssPath, 'utf-8')
    expect(css).toMatch(/\[data-slot=table-head\]\[aria-sort=ascending\][\s\S]{0,80}?var\(--foreground\)/)
    expect(css).toContain('[data-slot=table-cell][data-sorted=true]')
  })
})

describe('Figma v17 수정사항 · RiskBadge는 outline이 아니라 채움이다', () => {
  it('배경은 riskTone 인라인 style이고 border가 없다', () => {
    const markup = html(<RiskBadge risk="고위험" score={92} />)
    expect(markup).toMatch(/style="background-color:/)
    expect(markup).not.toContain('data-variant="outline"')
    expect(markup).toContain('border-0')
    expect(markup).not.toMatch(/border-border/)
  })

  it('고위험(진한 색)은 흰 글자, 저위험(옅은 회색)은 대비를 위해 어두운 글자를 쓴다', () => {
    const high = html(<RiskBadge risk="고위험" score={92} />)
    const low = html(<RiskBadge risk="저위험" score={12} />)
    expect(high).toContain('text-white')
    expect(low).not.toContain('text-white')
    expect(low).toContain('text-foreground')
  })
})
