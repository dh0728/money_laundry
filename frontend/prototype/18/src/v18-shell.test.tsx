import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const login = appSource.slice(appSource.indexOf('function Login'), appSource.indexOf('function SidebarBrandToggle'))

describe('v18 Figma 검수 · L1 로그인 우측 frosted glass', () => {
  it('오른쪽 패널은 login-glass-panel + backdrop-blur + 반투명 채움이다', () => {
    expect(login).toMatch(/login-glass-panel[^"]*backdrop-blur/)
    expect(login).toMatch(/login-glass-panel[^"]*bg-white\/\d/)
    // 불투명 단색 패널 금지(solid bg-black / opaque hex fill on the glass panel itself)
    const panelClass = login.match(/className="(login-glass-panel[^"]*)"/)?.[1] ?? ''
    expect(panelClass).toBeTruthy()
    expect(panelClass).not.toMatch(/bg-black(?!\/)/)
    expect(panelClass).not.toMatch(/bg-\[#[0-9a-fA-F]{3,8}\]/)
  })

  it('로그인 폼은 패널 안에 별도 opaque 박스(rounded·border·bg) 없이 놓인다', () => {
    const formMatch = login.match(/<form className="([^"]*)"/)
    expect(formMatch?.[1]).toBeTruthy()
    expect(formMatch?.[1]).not.toMatch(/rounded|border|bg-white|bg-black|bg-\[/)
  })

  it('index.css 끝 v18 L1 블록이 .login-glass-panel에 backdrop-filter와 반투명 배경을 준다', () => {
    const blockStart = css.lastIndexOf('/* v18 L1 */')
    expect(blockStart).toBeGreaterThan(-1)
    const block = css.slice(blockStart)
    expect(block).toMatch(/\.login-glass-panel\s*\{[^}]*backdrop-filter\s*:/)
    expect(block).toMatch(/\.login-glass-panel\s*\{[^}]*background\s*:\s*rgb\(255\s+255\s+255\s*\/\s*0\.0[1-9]/)
    // 불투명(alpha 1 / 생략) 단색 배경이 아니어야 한다
    expect(block).not.toMatch(/\.login-glass-panel\s*\{[^}]*background\s*:\s*#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\s*;/)
    expect(block).not.toMatch(/\.login-glass-panel\s*\{[^}]*background\s*:\s*rgb\(\s*\d+\s+\d+\s+\d+\s*\)\s*;/)
  })
})
