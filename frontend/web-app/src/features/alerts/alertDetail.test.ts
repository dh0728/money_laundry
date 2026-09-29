import { describe, expect, it } from 'vitest'
import { routeFromHash } from '@/app/navigation'
import { josa } from '@/lib/format'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import { moneyMetrics } from './metrics'
import { verdictOptions, verdictResolution } from './verdict'

describe('Alert 판정 선택지 (9/28 회의)', () => {
  it('정상 1개와 이상거래 3개이며 오탐은 없다', () => {
    expect(verdictOptions.map(o => `${o.group}/${o.label}`)).toEqual([
      '정상/정상 · 종결', '이상거래/Alert 단독', '이상거래/기존 Episode 연결', '이상거래/새 Episode 생성',
    ])
    expect(JSON.stringify(verdictOptions)).not.toContain('오탐')
  })

  it('API에 없는 Alert 단독만 FE 제안으로 표시하고, Episode로 보내는 판정은 종결하지 않는다', () => {
    expect(verdictOptions.filter(o => o.proposal).map(o => o.value)).toEqual(['standalone'])
    expect(verdictResolution).toEqual({ normal: 'NORMAL', standalone: 'SUSPICIOUS' })
  })
})

describe('Alert 상세 mock', () => {
  it('목록 행과 같은 값에 거래·참여 계좌·이력을 붙인다', async () => {
    const { detail, history } = await loadMockAlertDetail(3000, 'normal')
    expect(detail.transactions).toHaveLength(detail.txCount)
    expect(detail.accounts).toHaveLength(detail.accountCount)
    expect(detail.accounts.filter(a => a.role === 'SUBJECT').map(a => a.account)).toEqual([detail.subjectAccount.account])
    expect(history.at(-1)?.action).toBe('ASSIGN')
  })

  it('없는 Alert는 404, 오류 시나리오는 500을 돌려준다', async () => {
    await expect(loadMockAlertDetail(1, 'normal')).rejects.toMatchObject({ problem: { status: 404, code: 'NOT_FOUND' } })
    await expect(loadMockAlertDetail(3000, 'empty')).rejects.toMatchObject({ problem: { status: 404 } })
    await expect(loadMockAlertDetail(3000, 'error')).rejects.toMatchObject({ problem: { status: 500 } })
  })
})

describe('금액 지표', () => {
  const tx = (txId: number, from: string, to: string, amountUsd: number) => ({ txId, fromAccount: from, toAccount: to, amountUsd }) as Parameters<typeof moneyMetrics>[0][number]

  it('A→B→C로 같은 돈이 지나가면 거래 총액은 두 번, 투입 원금은 한 번 센다', () => {
    const m = moneyMetrics([tx(1, 'A', 'B', 100), tx(2, 'B', 'C', 100)], 'B')
    expect(m).toEqual({ total: 200, principal: 100, netInflow: 0 })
  })

  it('같은 거래 ID는 한 번만 센다', () => {
    expect(moneyMetrics([tx(1, 'A', 'B', 50), tx(1, 'A', 'B', 50)]).total).toBe(50)
  })
})

describe('주소와 문구', () => {
  it('#alerts/3001은 Alert 상세, 잘못된 번호는 목록이다', () => {
    expect(routeFromHash('#alerts/3001')).toEqual({ page: 'alerts', id: 3001 })
    expect(routeFromHash('#alerts/abc')).toEqual({ page: 'alerts' })
    expect(routeFromHash('#nope/1')).toEqual({ page: 'dashboard' })
  })

  it('받침에 따라 이/가를 고른다', () => {
    expect(josa('오분석', '이', '가')).toBe('이')
    expect(josa('한검토', '이', '가')).toBe('가')
  })
})

describe('처리 상태 (9/28 표현 통일)', async () => {
  const { alertWorkStatus, episodeWorkStatus } = await import('@/lib/workStatus')
  it('Alert는 처리 전·중·완료로, Episode로 보낸 Alert는 처리 중으로 본다', () => {
    expect(['OPEN', 'ESCALATED', 'CLOSED'].map(s => alertWorkStatus(s as 'OPEN'))).toEqual(['PENDING', 'IN_PROGRESS', 'DONE'])
  })
  it('Episode는 조사 중이면 처리 중, 검수를 넘기거나 종결하면 처리 완료다', () => {
    expect(episodeWorkStatus('OPEN')).toBe('IN_PROGRESS')
    expect(episodeWorkStatus('OPEN', true)).toBe('DONE')
    expect(episodeWorkStatus('CLOSED')).toBe('DONE')
  })
})
