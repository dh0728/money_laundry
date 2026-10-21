import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { login } from '@/api/auth'

const user = { id: 42, username: 'staff42', name: '김조사', role: 'STAFF' }

vi.mock('@/lib/apiMode', () => ({ live: true, fixture: false, mockSavedNote: 'mock' }))
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


it.each([true, false])('세션 만료 후 동일 직원 여부(%s)에 따라 조사 경로를 복귀하거나 초기화한다', async sameUser => {
  vi.mocked(login).mockResolvedValue({ ...user, id: sameUser ? user.id : 99, role: 'STAFF' })
  render(<App />)
  await screen.findByText('staff42')
  act(() => window.dispatchEvent(new Event('auth-expired')))
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'synthetic' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'synthetic-only' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await waitFor(() => expect(screen.queryByLabelText('아이디')).not.toBeInTheDocument())
  await waitFor(() => expect(window.location.hash).toBe(sameUser ? '#account' : '#dashboard'))
})
