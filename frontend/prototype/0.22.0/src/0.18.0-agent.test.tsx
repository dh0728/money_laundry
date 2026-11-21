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
  it('컨텍스트 뱃지 줄에 중복 구분선이 없다', () => {
    // 컨텍스트 뱃지 줄의 중복 border-b 제거(헤더 border-b만 유지)
    expect(source).toMatch(/조사 지원[\s\S]*?대시보드 · 오늘 요약/)
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
    expect(appSource).toMatch(/<Kbd>F11<\/Kbd>/)
    expect(appSource).toMatch(/if \(e\.key === 'F11'\)/)
    expect(source).not.toMatch(/e\.key === ['"]F11['"]/)
    expect(source).not.toContain('전체화면')
  })
})

describe('Figma v20 · RDR 9000 내비게이션 상태 유지', () => {
  it('사이드바 페이지 이동과 레코드 열기는 agentOpen을 변경하지 않는다', () => {
    const go = appSource.match(/const go =[^\n]*/)?.[0] ?? ''
    const openRecord = appSource.match(/const openRecord =[^\n]*/)?.[0] ?? ''
    expect(go).not.toContain('setAgentOpen')
    expect(openRecord).not.toContain('setAgentOpen')
  })
})

describe('v22 · RDR 동작 가능한 컨트롤', () => {
  it('사이드바와 플로팅 모드 모두 새 대화·모드 전환·닫기 컨트롤을 제공한다', async () => {
    const { default: Agent } = await import('./Agent')
    for (const mode of ['sidebar', 'floating'] as const) {
      const markup = html(<Agent open mode={mode} setOpen={() => {}} setMode={() => {}} records={records} />)
      expect(markup).toContain('aria-label="새 대화"')
      expect(markup).toContain('aria-label="RDR 9000 닫기"')
      expect(markup).toContain(mode === 'sidebar' ? '플로팅 패널로 보기' : '우측 사이드바로 보기')
    }
  })
})
