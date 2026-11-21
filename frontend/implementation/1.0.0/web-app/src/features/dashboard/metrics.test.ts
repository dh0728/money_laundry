import { describe, expect, it } from 'vitest'
import { agreementComposition } from './metrics'

describe('agreementComposition', () => {
  it('API 순서와 무관하게 모델 조합 순서와 색상을 고정한다', () => {
    expect(agreementComposition([
      { agreement: 'ATYPICAL', count: 2 },
      { agreement: 'PATTERN_ONLY', count: 3 },
      { agreement: 'STRONG', count: 1 },
      { agreement: 'WEAK', count: 4 },
    ])).toEqual([
      { name: '모델 의심 · 패턴 있음', value: 1, fill: 'var(--foreground)' },
      { name: '모델 의심 · 패턴 없음', value: 2, fill: 'var(--muted-foreground)' },
      { name: '모델 정상 · 패턴 있음', value: 3, fill: 'var(--chart-3)' },
      { name: '모델 정상 · 패턴 없음', value: 4, fill: 'var(--chart-4)' },
    ])
  })

  it('누락된 조합은 0건이며 다른 조합의 색상이 바뀌지 않는다', () => {
    const result = agreementComposition([{ agreement: 'WEAK', count: 7 }])
    expect(result.map(row => row.value)).toEqual([0, 0, 0, 7])
    expect(result[3]).toEqual({ name: '모델 정상 · 패턴 없음', value: 7, fill: 'var(--chart-4)' })
  })
})
