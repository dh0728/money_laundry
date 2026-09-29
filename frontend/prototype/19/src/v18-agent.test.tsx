import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const source = readFileSync(new URL('./Agent.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('Figma v18 · R1 저장본 의존 컨트롤 (Agent 범위)', () => {
  it('Agent에는 저장본 목록/불러오기 UI가 없다(해당 UI는 Detail 소유)', () => {
    expect(source).not.toContain('저장본')
    expect(source).not.toContain('drafts')
  })
})

describe('Figma v18 · R2 Agent textarea 리사이즈', () => {
  it('질문 Textarea는 resize-y를 갖고 resize-none이 아니다', () => {
    const tags = [...source.matchAll(/<Textarea\b[\s\S]*?\/>/g)].map(m => m[0])
    expect(tags.length).toBeGreaterThanOrEqual(1)
    for (const tag of tags) {
      expect(tag).not.toContain('resize-none')
      expect(tag).toMatch(/\bresize-y\b|\bresize\b/)
    }
  })
})

describe('Figma v18 · R3 불필요 구분선 제거', () => {
  it('히스토리·채팅 접합부의 이중 구분선(history right border / shadow-xl)이 없다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).toMatch(/agent-history[^"]*border-y border-l/)
    expect(markup).not.toMatch(/agent-history[^"]*shadow-xl/)
    // 컨텍스트 뱃지 줄의 중복 border-b 제거(헤더 border-b만 유지)
    expect(source).toMatch(/예시 응답[\s\S]*?대시보드 · 오늘 요약/)
    const badgeLine = source.match(/<div className="flex gap-2 items-center px-4 py-3 text-\[11px\] text-muted-foreground[^"]*"/)?.[0] ?? ''
    expect(badgeLine).toBeTruthy()
    expect(badgeLine).not.toContain('border-b')
  })
})

describe('Figma v18 · R4 플로팅 패널 뷰포트 클램프 + F11 유지', () => {
  it('fitFloatSize / fitFloatPosition으로 크기·위치를 화면 안에 클램프한다', () => {
    expect(source).toContain('fitFloatSize')
    expect(source).toContain('fitFloatPosition')
    expect(source).toMatch(/Math\.min\(vw - 16, vw \* 0\.9\)/)
    expect(source).toMatch(/Math\.min\(vh - 16, vh \* 0\.85\)/)
    expect(source).toMatch(/addEventListener\('resize', reclamp\)/)
  })

  it('플로팅 모드 렌더 시 max-h/max-w로 뷰포트 안에 묶인다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="floating" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).toContain('data-mode="floating"')
    expect(markup).toContain('max-h-[calc(100vh-16px)]')
    expect(markup).toContain('max-w-[calc(100vw-16px)]')
  })

  it('App 전체화면 버튼의 F11 표기·키 동작은 유지된다(Agent가 가로채지 않음)', () => {
    expect(appSource).toMatch(/aria-label=\{isFullscreen \? '전체화면 종료 · F11' : '전체화면 · F11'\}/)
    expect(appSource).toMatch(/<Kbd className="max-\[1100px\]:hidden">F11<\/Kbd>/)
    expect(appSource).toMatch(/if \(e\.key === 'F11'\)/)
    expect(source).not.toMatch(/e\.key === ['"]F11['"]/)
    expect(source).not.toContain('전체화면')
  })
})

describe('Figma v18 · R5 히스토리 슬라이드·너비', () => {
  it('히스토리 기본·최소·최대 너비가 충분히 넓다', () => {
    expect(source).toMatch(/HISTORY_DEFAULT = 360/)
    expect(source).toMatch(/HISTORY_MIN = 280/)
    expect(source).toMatch(/HISTORY_MAX = 560/)
  })

  it('히스토리는 본 패널 뒤(z-0 / right-full)에서 슬라이드하고, 열리면 채팅 왼쪽 모서리가 맞붙는다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).toMatch(/agent-history absolute top-0 bottom-0 right-full z-0/)
    expect(markup).toContain('data-open="false"')
    // 닫힌 기본: 채팅은 rounded-lg. 소스에 historyOpen 분기 존재
    expect(source).toMatch(/historyOpen \? 'rounded-r-lg rounded-l-none' : 'rounded-lg'/)
    expect(source).toMatch(/agent-chat relative z-10/)
  })
})
