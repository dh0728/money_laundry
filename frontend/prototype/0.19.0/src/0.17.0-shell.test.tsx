import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const searchSource = readFileSync(new URL('./GlobalSearch.tsx', import.meta.url), 'utf8')

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
    expect(appSource).toMatch(/SidebarBrandToggle[\s\S]*?toggleSidebar[\s\S]*?onClick=\{toggleSidebar\}/)
    // hover 시 RadarMark -> PanelLeft로 바뀐다(named group으로 스코프해 다른 nav hover와 섞이지 않는다)
    expect(appSource).toContain('group/brand')
    expect(appSource).toMatch(/RadarMark[^/]*group-hover\/brand:opacity-0/)
    expect(appSource).toMatch(/PanelLeft[^/]*group-hover\/brand:opacity-100/)
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

  it('검색은 헤더 중앙에서 최대 폭(약 420px)으로 제한되고, 결과 popover는 input 폭에 맞춘다', () => {
    expect(appSource).toMatch(/w-\[clamp\(140px,26vw,420px\)\][^"]*"[^>]*>\s*<GlobalSearch/)
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
  it('계정 페이지가 활성일 때 다른 nav button과 같은 스타일(공용 [data-active=true] 규칙)을 쓴다', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    const rules = [...css.matchAll(/\.account-button\[data-active=true\][^{]*\{[^}]*\}/g)].map(m => m[0])
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.at(-1)).toContain('var(--primary)')
    expect(rules.at(-1)).toContain('var(--primary-foreground)')
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
