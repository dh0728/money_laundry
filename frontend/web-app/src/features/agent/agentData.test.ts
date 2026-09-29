import { describe, expect, it } from 'vitest'
import { mockAgentRecords, recordForRoute } from './agentData'

describe('RDR 9000 조사 맥락', () => {
  it('Alert와 Episode 상세 주소에 맞는 mock 요약을 선택한다', () => {
    const alert = recordForRoute({ page: 'alerts', id: 3000 }, mockAgentRecords)
    const episode = recordForRoute({ page: 'episodes', id: 800 }, mockAgentRecords)
    expect(alert).toMatchObject({ id: 'A-3000', count: 4, amount: 18000 })
    expect(episode).toMatchObject({ id: 'E-800', count: 22 })
    expect(recordForRoute({ page: 'dashboard' }, mockAgentRecords)).toBeUndefined()
  })
})
