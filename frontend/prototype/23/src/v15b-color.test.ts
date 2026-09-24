import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { riskSteps, riskTone } from './domain'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// oklch(l c h) 문자열에서 채도(c) 값만 뽑아낸다
const resolveTone = (tone: string) => tone.replace(/var\((--risk-\d)\)/, (_, token: string) => source('./index.css').match(new RegExp(`${token}:\\s*([^;]+)`))?.[1] ?? '')
const chromaOf = (tone: string) => Number(resolveTone(tone).match(/oklch\([^\s]+ ([^\s]+) /)?.[1])

describe('위험도 10단계 색상(riskTone)', () => {
  it('returns semantic risk tokens at clamped score boundaries', () => {
    expect(riskTone(-1)).toBe('var(--risk-0)')
    expect(riskTone(50)).toBe('var(--risk-5)')
    expect(riskTone(101)).toBe('var(--risk-9)')
  })
  it('0~100점을 정확히 10개의 서로 다른 색으로 매핑한다', () => {
    const outputs = new Set(Array.from({ length: 101 }, (_, score) => riskTone(score)))
    expect(outputs.size).toBe(10)
    expect(riskSteps).toHaveLength(10)
  })

  it('bucket 0(0~9점)은 채도 0인 순수 회색이다', () => {
    expect(chromaOf(riskTone(0))).toBe(0)
    expect(chromaOf(riskTone(9))).toBe(0)
    expect(chromaOf(riskSteps[0])).toBe(0)
  })

  it('bucket이 올라갈수록 채도가 단조 증가한다', () => {
    const chromas = riskSteps.map(chromaOf)
    for (let i = 1; i < chromas.length; i++) {
      expect(chromas[i]).toBeGreaterThan(chromas[i - 1])
    }
  })

  it('95점이 가장 붉은(채도가 가장 높은) 색이다', () => {
    const reddest = chromaOf(riskTone(95))
    for (let score = 0; score <= 100; score++) {
      expect(chromaOf(riskTone(score))).toBeLessThanOrEqual(reddest)
    }
    // 90~100점 구간(bucket 9)은 모두 동일하게 가장 붉은 값이어야 한다
    expect(riskTone(95)).toBe(riskSteps[9])
    expect(riskTone(100)).toBe(riskSteps[9])
  })

  it('색은 red(hue 29.23) 계열이거나 무채색(chroma 0)이며, yellow/green/amber 계열이 아니다', () => {
    for (const step of riskSteps) {
      const chroma = chromaOf(step)
      if (chroma > 0) expect(resolveTone(step)).toMatch(/oklch\([^)]+ 29\.23\)/)
    }
  })
})

describe('금지 색상 사용 여부(정적 검사)', () => {
  it('Lists.tsx 소스에 amber 클래스가 남아있지 않다', () => {
    expect(source('./Lists.tsx')).not.toMatch(/amber/)
  })

  it('Lists.tsx, Dashboard.tsx, Detail.tsx 소스에 yellow/green/emerald/rose 계열이 없다', () => {
    for (const file of ['./Lists.tsx', './Dashboard.tsx', './Detail.tsx']) {
      const text = source(file)
      expect(text).not.toMatch(/yellow|green|emerald|rose/i)
    }
  })

  it('Dashboard.tsx의 Institution 차트 막대는 graph-l1을 쓰지 않는다', () => {
    const text = source('./Dashboard.tsx')
    const start = text.indexOf('function Institution')
    const end = text.indexOf('\nfunction ', start + 1)
    const institutionBody = text.slice(start, end === -1 ? undefined : end)
    // 패턴 대표 모양 갤러리(MiniGraph)는 이 슬라이스에서 제외하고, 그 앞부분(차트/지표)만 검사한다
    const galleryStart = institutionBody.indexOf('패턴 대표 모양')
    const chartsOnly = institutionBody.slice(0, galleryStart === -1 ? undefined : galleryStart)
    expect(chartsOnly).not.toMatch(/graph-l1/)
  })

  it('Detail.tsx의 일별 거래 금액 차트는 graph-l1을 쓰지 않는다', () => {
    const text = source('./Detail.tsx')
    const idx = text.indexOf('일별 의심 거래 금액')
    const chunk = text.slice(idx, idx + 800)
    expect(chunk).not.toMatch(/graph-l1/)
  })
})
