import { act, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'

const user = { id: 42, username: 'staff42', name: '김조사', role: 'STAFF' }

vi.mock('@/lib/apiMode', () => ({ live: true, mockSavedNote: 'mock' }))
vi.mock('@/api/auth', () => ({ restoreSession: () => Promise.resolve(user), login: vi.fn(), logout: vi.fn() }))
vi.mock('@/components/LoginNetwork', () => ({ default: () => null }))

beforeEach(() => { window.location.hash = 'account' })

it('서버 세션을 복원하고 만료되면 로그인 화면으로 돌린다', async () => {
  render(<App />)
  expect(await screen.findByText('staff42')).toBeInTheDocument()
  expect(screen.getAllByText('김조사').length).toBeGreaterThan(0)
  act(() => window.dispatchEvent(new Event('auth-expired')))
  expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
  expect(screen.getByText('로그인 시간이 만료됐습니다. 다시 로그인해 주세요.')).toBeInTheDocument()
})
