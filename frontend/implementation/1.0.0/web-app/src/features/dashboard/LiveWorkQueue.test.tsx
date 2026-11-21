import { render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LiveWorkQueue } from './LiveWorkQueue'

const { fetchReviewCases } = vi.hoisted(() => ({ fetchReviewCases: vi.fn() }))
vi.mock('@/api/liveReview', () => ({ fetchReviewCases }))
vi.mock('@/app/session', () => ({ useCurrentUser: () => ({ userId: 11 }) }))

it.each([true, false])('업무 현황의 personal=%s 범위를 네 상태 조회에 적용한다', async personal => {
  fetchReviewCases.mockReset().mockResolvedValue({ content: [], totalElements: 0, totalPages: 0 })
  render(<LiveWorkQueue personal={personal} />)
  await waitFor(() => expect(fetchReviewCases).toHaveBeenCalledTimes(4))
  for (const [kind, status] of [['ALERT', 'OPEN'], ['EPISODE', 'OPEN'], ['ALERT', 'CLOSED'], ['EPISODE', 'CLOSED']]) {
    expect(fetchReviewCases).toHaveBeenCalledWith({ kind, statuses: [status], assigneeId: personal ? 11 : undefined, page: 0, size: 20 })
  }
  expect(screen.getAllByTestId('work-status-column')).toHaveLength(3)
})
