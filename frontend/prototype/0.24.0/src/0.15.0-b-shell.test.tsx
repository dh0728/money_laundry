import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v15b 셸 정리 · RDR 9000 아이콘', () => {
  it('RadarSweep은 금속 그라디언트 없이 회전 sweep(SMIL)만 쓴다', async () => {
    const { RadarSweep, RdrEye, AgentFab, AGENT_NAME } = await import('./Agent')
    const markup = html(<RadarSweep />)
    expect(markup).not.toMatch(/-rim/)
    expect(markup).not.toMatch(/-lens/)
    expect(markup).toContain('animateTransform')
    expect(markup).toContain('type="rotate"')
    expect(RdrEye).toBe(RadarSweep) // 하위 호환 별칭
    expect(AGENT_NAME).toBe('RDR 9000')
    const toggle = html(<AgentFab open={false} onToggle={() => {}} />)
    expect(toggle).toContain('RDR 9000')
  })
})

describe('v15b 셸 정리 · Brand', () => {
  it('BrandLogo는 AML RADAR 글자와 마크를 함께 그린다', async () => {
    const { BrandLogo, RadarMark } = await import('./Brand')
    expect(html(<BrandLogo />)).toContain('AML RADAR')
    expect(html(<RadarMark />)).toContain('<svg')
  })
})

describe('v15b 셸 정리 · App 헤더·계정', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  it('계정 button은 DropdownMenu 없이 계정 페이지로 바로 이동한다', () => {
    expect(source).not.toContain('DropdownMenu')
    expect(source).toContain("go('account')")
  })
  it('Alert nav 아이콘은 Siren이다', () => {
    // v16: 사이렌(Siren)으로 교체됨(경보 성격을 더 분명히 드러낸다)
    expect(source).toContain('Siren')
    expect(source).not.toContain('ScanLine')
    expect(source).not.toContain('TriangleAlert')
  })
  it('v17: 로고는 헤더가 아니라 사이드바로 옮겨졌다', () => {
    // v17 Figma 검수: 로고는 헤더에서 빠지고 사이드바 여닫기 button 자리로 옮겨졌다(BrandLogo는 더는 헤더에서 쓰지 않는다)
    expect(source).not.toContain('<BrandLogo')
    const header = source.slice(source.indexOf('<header'), source.indexOf('</header>'))
    expect(header).not.toContain('RadarMark')
    expect(source).toContain('<RadarMark')
  })
})
