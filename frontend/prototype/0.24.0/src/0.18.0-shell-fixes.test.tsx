import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('v18 shell fixes from 명기', () => {
  it('세로/좁은 화면에서도 전체화면 버튼에 F11 표기가 남는다', () => {
    expect(app).toMatch(/<Kbd>\s*F11\s*<\/Kbd>/)
    expect(app).not.toMatch(/Kbd[^>]*(max-\[1100px\]:hidden|max-md:hidden|sm:hidden)[^>]*>F11/)
  })

  it('접힌 사이드바 알림 배지에 ring/검정 테두리가 없다', () => {
    const badge = app.match(/notifications[\s\S]{0,200}?Badge variant="destructive" className="[^"]+"/g)?.join('\n') ?? ''
    expect(badge).toContain('group-data-[collapsible=icon]:flex')
    expect(badge).not.toMatch(/ring-2|ring-sidebar/)
    expect(badge).toMatch(/border-0/)
  })

  it('로그인 오른쪽은 글래스모피즘(반투명+blur)·인풋 불투명·제목/화살표 없음', () => {
    expect(app).toContain('login-glass-panel')
    expect(app).toContain('login-input-opaque')
    expect(app).toContain('showPassword')
    expect(app).toContain('EyeOff')
    expect(app).not.toMatch(/로그인<ArrowRight/)
    expect(css).toMatch(/\.login-glass-panel\s*\{[\s\S]*?backdrop-filter:\s*blur\(/)
    expect(css).toMatch(/\.login-glass-panel\s*\{[^}]*background:\s*var\(--login-panel-background\)/)
    expect(css).toMatch(/--login-panel-background:\s*rgba\(255,\s*255,\s*255,\s*0?\.035\)/)
    expect(css).toMatch(/\.login-input-opaque\s*\{[^}]*background-color:\s*var\(--login-input-background\)/)
    expect(css).toMatch(/--login-input-background:\s*rgb\(22,\s*22,\s*28\)/)
  })
})
