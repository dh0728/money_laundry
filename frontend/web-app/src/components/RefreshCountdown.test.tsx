import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RefreshCountdown } from './RefreshCountdown'

afterEach(() => vi.useRealTimers())
it('남은 시간을 표시하고 갱신 중 및 완료 뒤 새 기한을 표시한다', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
  const { rerender } = render(<RefreshCountdown nextRefreshAt={Date.now() + 300_000} refreshing={false} />)
  expect(screen.getByText('자동 갱신까지 5:00')).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.getByText('자동 갱신까지 4:59')).toBeInTheDocument()
  rerender(<RefreshCountdown refreshing />)
  expect(screen.getByText('갱신 중…')).toBeInTheDocument()
  rerender(<RefreshCountdown nextRefreshAt={Date.now() + 300_000} refreshing={false} />)
  expect(screen.getByText('자동 갱신까지 5:00')).toBeInTheDocument()
})
