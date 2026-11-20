import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'
import { selectDashboard } from './dashboard-data'

afterEach(cleanup)
function setup() {
  const onRange = vi.fn()
  render(<Dashboard data={selectDashboard('mine', '2026-11-09', '2026-11-15', '')} scope="mine" start="2026-11-09" end="2026-11-15" query="" state="ready" onRetry={vi.fn()} onRange={onRange} onClear={vi.fn()} onClearSearch={vi.fn()} />)
  return { onRange, picker: screen.getByRole('form', { name: '조회 기간' }).closest('details')! }
}
describe('dashboard period edit lifecycle', () => {
  it('discards an unapplied date draft when the picker is dismissed', () => {
    const { picker, onRange } = setup()
    picker.open = true
    fireEvent(picker, new Event('toggle'))
    fireEvent.click(screen.getByRole('button', { name: '오늘' }))
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-11-15')
    picker.open = false
    fireEvent(picker, new Event('toggle'))
    picker.open = true
    fireEvent(picker, new Event('toggle'))
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-11-09')
    expect(onRange).not.toHaveBeenCalled()
  })
  it('closes on Escape without applying the draft', () => {
    const { picker, onRange } = setup()
    picker.open = true
    fireEvent(picker, new Event('toggle'))
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-12' } })
    fireEvent.keyDown(screen.getByLabelText('시작일'), { key: 'Escape' })
    expect(picker.open).toBe(false)
    expect(picker.querySelector('summary')).toHaveFocus()
    expect(onRange).not.toHaveBeenCalled()
  })
  it('applies a valid range once and closes the picker', () => {
    const { picker, onRange } = setup()
    picker.open = true
    fireEvent(picker, new Event('toggle'))
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-12' } })
    fireEvent.submit(screen.getByRole('form', { name: '조회 기간' }))
    expect(onRange).toHaveBeenCalledExactlyOnceWith('2026-11-12', '2026-11-15')
    expect(picker.open).toBe(false)
  })
  it('does not submit a blank or out-of-snapshot date', () => {
    const { onRange } = setup()
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('form', { name: '조회 기간' }))
    expect(onRange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-09' } })
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-20' } })
    fireEvent.submit(screen.getByRole('form', { name: '조회 기간' }))
    expect(onRange).not.toHaveBeenCalled()
  })
})
