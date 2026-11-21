import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentOpenByDefault } from './App'

describe('v24 AI 패널 기본 상태', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stubWidth = (narrow: boolean) => vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: narrow && query.includes('max-width: 767px') }) })

  it('세로(좁은) 화면에서는 닫힌 채로 시작한다', () => {
    stubWidth(true)
    expect(agentOpenByDefault()).toBe(false)
  })

  it('넓은 화면에서는 기존처럼 열린 채로 시작한다', () => {
    stubWidth(false)
    expect(agentOpenByDefault()).toBe(true)
  })
})
