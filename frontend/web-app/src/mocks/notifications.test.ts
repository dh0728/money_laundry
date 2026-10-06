import { describe, expect, it } from 'vitest'
import { loadMockNotifications, notificationsNormal } from './notifications'

describe('알림 시연 데이터', () => {
  it('합의한 네 종류를 관련 사건으로 연결한다', () => {
    expect(new Set(notificationsNormal.map(item => item.kind))).toEqual(new Set(['ALERT_ASSIGNED', 'EPISODE_LINKED', 'OPINION_ADDED', 'REVIEW_RESULT']))
    expect(notificationsNormal.every(item => item.target.id > 0 && item.code)).toBe(true)
  })

  it('정상·빈·오류 상태를 제공한다', async () => {
    expect(await loadMockNotifications('normal')).toHaveLength(7)
    expect(await loadMockNotifications('empty')).toEqual([])
    await expect(loadMockNotifications('error')).rejects.toThrow('알림을 불러오지 못했습니다.')
  })
})
