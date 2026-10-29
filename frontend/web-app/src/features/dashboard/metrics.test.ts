import { describe, expect, it } from 'vitest'
import { agreementComposition } from './metrics'

describe('agreementComposition', () => {
  it('API 순서와 무관하게 모델 판정 순서와 색상을 고정한다', () => {
    expect(agreementComposition([
      { agreement: 'NORMAL', count: 4 },
      { agreement: 'SUSPICIOUS', count: 1 },
    ])).toEqual([
      { name: '모델 의심', value: 1, fill: 'var(--foreground)' },
      { name: '모델 정상', value: 4, fill: 'var(--chart-4)' },
    ])
  })

  it('누락된 판정은 0건이며 다른 판정의 색상이 바뀌지 않는다', () => {
    const result = agreementComposition([{ agreement: 'NORMAL', count: 7 }])
    expect(result.map(row => row.value)).toEqual([0, 7])
    expect(result[1]).toEqual({ name: '모델 정상', value: 7, fill: 'var(--chart-4)' })
  })
})
