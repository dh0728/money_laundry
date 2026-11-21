import { describe, expect, it } from 'vitest'
import { canEditOpen, MOCK_USER } from './session'

describe('직원 수정 권한', () => {
  it('STAFF는 본인 담당 OPEN 사건만 수정한다', () => {
    expect(canEditOpen(MOCK_USER, MOCK_USER.userId, 'OPEN')).toBe(true)
    expect(canEditOpen(MOCK_USER, MOCK_USER.userId + 1, 'OPEN')).toBe(false)
    expect(canEditOpen(MOCK_USER, MOCK_USER.userId, 'CLOSED')).toBe(false)
    expect(canEditOpen({ ...MOCK_USER, role: 'ADMIN' }, MOCK_USER.userId, 'OPEN')).toBe(false)
  })
})
