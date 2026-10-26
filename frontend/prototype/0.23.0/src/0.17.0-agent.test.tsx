import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { records } from './domain'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const source = readFileSync(new URL('./Agent.tsx', import.meta.url), 'utf8')

describe('v17 RDR 9000 도우미 · 전체화면 모드 제거', () => {
  it('소스에 전체화면 모드 텍스트/값이 남아있지 않다', () => {
    expect(source).not.toContain('전체화면')
    expect(source).not.toMatch(/['"]full['"]/)
  })
  it('렌더된 markup에도 전체화면 관련 문구/data-mode가 없다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).not.toContain('전체화면')
    expect(markup).not.toContain('data-mode="full"')
    expect(markup).toContain('data-mode="sidebar"')
  })
  it('표시 방식은 메뉴 없이 아이콘 한 번으로 사이드바·플로팅을 전환한다', async () => {
    expect(source).not.toContain('DropdownMenu')
    // Mode event orchestration is exercised in v21-agent-stability; keep this test about the rendered controls.
    const { default: Agent } = await import('./Agent')
    expect(html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)).toContain('aria-label="플로팅 패널로 보기"')
    const floating = html(<Agent open mode="floating" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(floating).toContain('aria-label="우측 사이드바로 보기"')
    expect(floating).toContain('data-mode="floating"')
  })
})

describe('v17 RDR 9000 도우미 · 사용자 말풍선', () => {
  it('사용자 메시지 bubble 클래스는 우측 정렬 compact bubble이다', () => {
    expect(source).toContain("'ml-auto max-w-[80%] w-fit rounded-2xl bg-muted px-4 py-2.5 text-sm'")
  })
  it('assistant 메시지는 여전히 좌측 정렬 plain text이다', () => {
    expect(source).toContain("'text-sm leading-7 py-2 whitespace-pre-wrap'")
  })
})

describe('v17 RDR 9000 도우미 · 리사이즈 핸들', () => {
  it('사이드바 모드에는 도우미 너비 조절 핸들이 있다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="sidebar" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).toContain('aria-label="도우미 너비 조절"')
    expect(markup).not.toContain('aria-label="도우미 높이 조절"')
    expect(markup).not.toContain('aria-label="도우미 크기 조절"')
  })
  it('플로팅 모드에는 너비·높이·모서리(크기) 핸들이 모두 있다', async () => {
    const { default: Agent } = await import('./Agent')
    const markup = html(<Agent open mode="floating" setOpen={() => {}} setMode={() => {}} records={records} />)
    expect(markup).toContain('aria-label="도우미 너비 조절"')
    expect(markup).toContain('aria-label="도우미 높이 조절"')
    expect(markup).toContain('aria-label="도우미 크기 조절"')
  })
  it('리사이즈 최소·최대값 상수가 스펙대로 설정되어 있다', () => {
    expect(source).toMatch(/SIDEBAR_MIN = 320, SIDEBAR_MAX = 720/)
    expect(source).toMatch(/FLOAT_MIN_W = 320, FLOAT_MIN_H = 360/)
  })
  it('플로팅 최대 크기는 뷰포트 비율(약 90vw x 85vh)로 계산된다', () => {
    // v18 R4: fitFloatSize가 globalThis.innerWidth/Height 기준으로 클램프
    expect(source).toMatch(/vw \* 0\.9/)
    expect(source).toMatch(/vh \* 0\.85/)
    expect(source).toContain('fitFloatSize')
  })
  it('사이드바 폭은 CSS 변수 --agent-width로 document.documentElement에 반영된다', () => {
    expect(source).toMatch(/setProperty\('--agent-width', `\$\{sidebarWidth\}px`\)/)
  })
})

describe('v17 RDR 9000 도우미 · 토글 pill 아이콘 여백', () => {
  // v18: 헤더 pill → Notion-style FAB. data-testid는 agent-toggle 유지.
  it('AgentFab은 fixed 우하단 rounded-full FAB이다', async () => {
    const { AgentFab } = await import('./Agent')
    const markup = html(<AgentFab open={false} onToggle={() => {}} />)
    expect(markup).toContain('data-testid="agent-toggle"')
    expect(markup).toContain('fixed')
    expect(markup).toContain('bottom-6')
    expect(markup).toContain('right-6')
    expect(markup).toContain('rounded-full')
    expect(markup).toContain('size-14')
    expect(markup).toContain('z-50')
    expect(markup).toMatch(/size-14 rounded-full/)
    expect(html(<AgentFab open onToggle={() => {}} />)).toBe('')
  })
})

describe('v17 RDR 9000 도우미 · index.css', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  it('.agent-sidebar-space는 --agent-width 변수를 따라간다', () => {
    expect(css).toContain('.agent-sidebar-space { margin-right:var(--agent-width, 390px); }')
  })
  it('리사이즈 핸들 스타일이 정의되어 있다', () => {
    expect(css).toContain('.agent-resize-handle')
  })
})
