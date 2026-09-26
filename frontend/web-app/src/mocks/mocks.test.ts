import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/common'
import { alertResolutionLabels, formatScore, typeDisplay } from '@/api/codes'
import { loadMockDashboard } from './dashboard'
import { loadMockMyAlerts } from './alerts'
import { currentScenario } from './scenario'

describe('mock 시나리오', () => {
  it('주소의 ?mock= 값으로 시나리오를 고른다', () => {
    expect(currentScenario('')).toBe('normal')
    expect(currentScenario('?mock=empty')).toBe('empty')
    expect(currentScenario('?mock=error')).toBe('error')
    expect(currentScenario('?mock=zzz')).toBe('normal')
  })

  it('정상·빈 결과·오류를 모두 돌려준다', async () => {
    expect((await loadMockDashboard('normal')).alertsByType).toHaveLength(9)
    expect((await loadMockDashboard('empty')).latestJob).toBeNull()
    await expect(loadMockDashboard('error')).rejects.toBeInstanceOf(ApiError)
    expect((await loadMockMyAlerts('normal')).content.length).toBeGreaterThan(0)
    expect((await loadMockMyAlerts('empty')).content).toEqual([])
    await expect(loadMockMyAlerts('error')).rejects.toMatchObject({ problem: { status: 500 } })
  })

  it('점수는 API 원값 0~1 범위다', async () => {
    for (const row of (await loadMockMyAlerts('normal')).content) {
      expect(row.riskScore).toBeGreaterThanOrEqual(0)
      expect(row.riskScore).toBeLessThanOrEqual(1)
    }
  })
})

describe('표시 규칙', () => {
  it('유형 코드 0은 정상이 아니라 패턴 없는 이상거래로 표시한다', () => {
    expect(typeDisplay(0)).toEqual({ key: 'NON_PATTERN', label: '패턴 없는 이상거래' })
    expect(alertResolutionLabels.NORMAL).toBe('정상 판단')
  })

  it('점수는 소수 둘째 자리까지 보여 준다', () => {
    expect(formatScore(0.9876)).toBe('0.99')
    expect(formatScore(0.5)).toBe('0.50')
  })
})
