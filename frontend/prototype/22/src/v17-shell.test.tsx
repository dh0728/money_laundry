import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarInset } from '@/components/ui/sidebar'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const searchSource = readFileSync(new URL('./GlobalSearch.tsx', import.meta.url), 'utf8')

it('keeps exactly one main landmark inside the sidebar inset and scopes responsive page padding', () => {
  const markup = html(<SidebarInset><header>Header</header><main className="app-main">Page</main></SidebarInset>)
  expect(markup.match(/<main\b/g)).toHaveLength(1)
  expect(markup).toMatch(/^<div data-slot="sidebar-inset"/)
  expect(appSource.match(/<main\b/g)).toHaveLength(1)
  expect(readFileSync(new URL('./index.css', import.meta.url), 'utf8')).not.toMatch(/(?:^|[;}\s])main\s*\{/)
})

it('login decoration never follows the pointer or recursively schedules drawing', () => {
  const source = readFileSync(new URL('./LoginNetwork.tsx', import.meta.url), 'utf8')
  expect(source).not.toContain("addEventListener('pointermove'")
  expect(source).not.toContain('requestAnimationFrame(draw)')
})

describe('v17 Figma 검수 · 로고는 헤더에서 사이드바로', () => {
  it('헤더 markup에는 로고(BrandLogo·RadarMark)가 없다', () => {
    const header = appSource.slice(appSource.indexOf('<header'), appSource.indexOf('</header>'))
    expect(header).not.toContain('BrandLogo')
    expect(header).not.toContain('RadarMark')
    expect(appSource).not.toContain('<BrandLogo')
  })

  it('사이드바 header는 RadarMark를 그리는 SidebarBrandToggle을 쓰고, 클릭하면 사이드바를 여닫는다', async () => {
    const { RadarMark } = await import('./Brand')
    expect(html(<RadarMark />)).toContain('<svg')
    expect(appSource).toMatch(/<SidebarHeader[^>]*>\s*<SidebarBrandToggle/)
    expect(appSource).toContain('aria-label="사이드바 열기/닫기"')
    expect(appSource).toMatch(/SidebarBrandToggle[\s\S]*?toggleSidebar[\s\S]*?onPointerDown=/)
    // hover 시 RadarMark -> PanelLeft로 바뀐다(named group으로 스코프해 다른 nav hover와 섞이지 않는다)
    expect(appSource).toContain('group/brand')
    expect(appSource).toMatch(/RadarMark[^/]*group-hover\/brand:opacity-0/)
    expect(appSource).toMatch(/PanelLeft[^/]*group-hover\/brand:opacity-100/)
  })

  it('로고 토글은 헤더 영역 전체에서 pointer-down 즉시 한 번만 반응하고 키보드 click도 유지한다', () => {
    const brand = appSource.slice(appSource.indexOf('function SidebarBrandToggle'), appSource.indexOf('export default function App'))
    expect(brand).toContain('aria-expanded={state === \'expanded\'}')
    expect(brand).toContain('absolute inset-0')
    expect(brand).toContain('touch-manipulation')
    expect(brand).toMatch(/onPointerDown=\{event =>[\s\S]*?event\.preventDefault\(\)[\s\S]*?toggleSidebar\(\)/)
    expect(brand).toMatch(/onClick=\{event => \{ if \(event\.detail === 0\) toggleSidebar\(\) \}\}/)
    expect(appSource).toMatch(/<SidebarHeader className="h-15[^"\n]*p-0[^"\n]*">/)
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.app-sidebar \[data-slot=sidebar-(?:gap|container)\][\s\S]*transition-duration:\s*120ms/)
  })

  it('로그인 화면 좌상단 로고도 RadarMark(브랜드 마크)를 쓴다(예전 lucide Radar 아이콘 아님)', () => {
    const login = appSource.slice(appSource.indexOf('function Login'), appSource.indexOf('function SidebarBrandToggle'))
    expect(login).toContain('<RadarMark')
    expect(login).not.toMatch(/<Radar className/)
  })
})

describe('v17 Figma 검수 · 헤더 검색 pill', () => {
  it('전역 검색 input은 rounded-full이다', () => {
    expect(searchSource).toMatch(/aria-label="전역 검색"[\s\S]{0,400}/)
    const inputBlock = searchSource.slice(searchSource.indexOf('<Input'), searchSource.indexOf('<Input') + 400)
    expect(inputBlock).toContain('rounded-full')
  })

  it('검색은 헤더 중앙에서 최대 폭을 제한하되 좁은 데스크톱에서도 최소 폭을 보장하고, 결과 popover는 input 폭에 맞춘다', () => {
    expect(appSource).toMatch(/w-\[clamp\(280px,32vw,420px\)\][^"]*min-w-\[280px\][^"]*max-\[520px\]:w-\[clamp\(180px,46vw,280px\)\][^"]*max-\[520px\]:min-w-\[180px\][^"]*"[^>]*>\s*<GlobalSearch/)
    expect(searchSource).toMatch(/PopoverContent[^>]*className="w-\(--radix-popper-anchor-width\)/)
  })
})

describe('v17 Figma 검수 · 역할 표기', () => {
  it('역할 text는 "1차 검토"·"심층 조사" 없이 L1/L2만 쓴다', () => {
    expect(appSource).not.toContain('1차 검토')
    expect(appSource).not.toContain('심층 조사')
    expect(appSource).toMatch(/role = user === '오검토' \? 'L1' : 'L2'/)
  })
})

describe('v17 Figma 검수 · 알림 배지(펼친 사이드바)', () => {
  it('펼친 sidebar의 알림 개수 배지도 destructive(빨강 배경·흰 글자)이고, 0이면 숨긴다', () => {
    const utility = appSource.slice(appSource.indexOf('utilityNav.map'), appSource.indexOf('</SidebarGroup>', appSource.indexOf('utilityNav.map')))
    expect(utility).toMatch(/unread > 0 && <Badge variant="destructive"[^>]*group-data-\[collapsible=icon\]:hidden/)
    expect(utility).not.toContain('variant="secondary"')
  })
})

describe('v17 Figma 검수 · 계정 button 활성 상태', () => {
  it('all destinations share one pill and transparent active buttons with contrast text', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    expect(appSource.match(/<SidebarSelection\b/g)).toHaveLength(1)
    expect(appSource.match(/data-nav-id=\{n.id\}/g)).toHaveLength(2)
    expect(appSource).toContain('data-nav-id="account"')
    expect(css).toMatch(/\.app-sidebar-surface \[data-slot=sidebar-menu-button\]\[data-active=true\][^{]*\{[^}]*background:\s*transparent\s*!important[^}]*color:\s*var\(--primary-foreground\)/)
    expect(css).toMatch(/\.sidebar-indicator\s*\{[^}]*background:\s*var\(--primary\)/)
  })
})

describe('v17 Figma 검수 · 로그인 오른쪽 절반 glass', () => {
  it('오른쪽 절반 패널은 backdrop-blur를 쓰고, 로그인 폼은 그 안에 별도 박스 없이 놓인다', () => {
    expect(appSource).toMatch(/login-glass-panel[^"]*backdrop-blur/)
    const formMatch = appSource.match(/<form className="([^"]*)"/)
    expect(formMatch?.[1]).toBeTruthy()
    expect(formMatch?.[1]).not.toMatch(/rounded|border|bg-white/)
  })
})
