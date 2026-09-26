import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { pageFromHash } from './navigation'

afterEach(() => window.history.replaceState({}, '', '/'))

describe('앱 틀', () => {
  it('처음에는 대시보드를 연다', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: '대시보드' })).toBeInTheDocument()
  })

  it('아직 옮기지 않은 메뉴는 준비 중으로 보여 준다', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }))
    expect(await screen.findByText('준비 중인 화면입니다.')).toBeInTheDocument()
  })

  it('예전 Episode 목록 골격은 메뉴에 없다', () => {
    render(<App />)
    expect(screen.queryByText('Episode 목록')).not.toBeInTheDocument()
  })

  it('모르는 주소는 대시보드로 보낸다', () => {
    expect(pageFromHash('#episodes')).toBe('episodes')
    expect(pageFromHash('#upload')).toBe('dashboard')
  })
})
