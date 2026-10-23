import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearCsrf, postJson } from '@/api/common'
import { SharedPeriod, WorkspaceMain, WorkspaceProvider } from './WorkspaceProvider'
import { useAsync } from './useAsync'
import { useSharedPeriod, useViewState } from './workspaceState'

const { clock, load } = vi.hoisted(() => ({ clock: vi.fn(), load: vi.fn() }))
vi.mock('@/api/liveDashboard', async original => ({ ...await original<typeof import('@/api/liveDashboard')>(), fetchDemoClock: clock }))
beforeEach(() => {
  vi.clearAllMocks()
  clock.mockResolvedValue({ businessAt: '2023-09-10T09:00:00+09:00', revision: 1 })
  load.mockImplementation(async (page: string, from: string) => page + '/' + from)
})
afterEach(() => { vi.restoreAllMocks(); clearCsrf() })
function Page({ name }: { name: string }) {
  const { from, to, setFrom } = useSharedPeriod()
  const [filter, setFilter] = useViewState(name + '/filter', '')
  const query = useAsync<string>(() => load(name, from, to), [from, to], { key: name })
  return <><input aria-label="시작일" value={from} onChange={e => setFrom(e.target.value)} /><output>{to}</output>
    <input aria-label="필터" value={filter} onChange={e => setFilter(e.target.value)} />
    <div>{query.state.status === 'success' ? query.state.data : 'loading'}</div>
    <button onClick={query.retry}>새로고침</button></>
}
function Navigation() {
  const [page, setPage] = useState('dashboard')
  return <><nav>{['dashboard', 'ledger', 'alerts', 'episodes'].map(name => <button key={name} onClick={() => setPage(name)}>{name}</button>)}</nav>
    <WorkspaceMain route={page} className=""><SharedPeriod><Page key={page} name={page} /></SharedPeriod></WorkspaceMain></>
}
it('all four tabs share dates, preserve individual filters and immediately restore cached data and scroll', async () => {
  render(<WorkspaceProvider><Navigation /></WorkspaceProvider>)
  expect(await screen.findByText('dashboard/2023-08-12')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2023-09-01' } })
  await screen.findByText('dashboard/2023-09-01')
  fireEvent.change(screen.getByLabelText('필터'), { target: { value: 'mine' } })
  const main = screen.getByRole('main')
  main.scrollTop = 320; fireEvent.scroll(main)
  for (const name of ['ledger', 'alerts', 'episodes']) {
    fireEvent.click(screen.getByRole('button', { name }))
    expect(await screen.findByText(name + '/2023-09-01')).toBeInTheDocument()
    expect(screen.getByLabelText('시작일')).toHaveValue('2023-09-01')
    expect(screen.getByLabelText('필터')).toHaveValue('')
  }
  const calls = load.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'dashboard' }))
  expect(screen.getByText('dashboard/2023-09-01')).toBeInTheDocument()
  expect(screen.queryByText('loading')).not.toBeInTheDocument()
  expect(screen.getByLabelText('필터')).toHaveValue('mine')
  expect(main.scrollTop).toBe(320)
  expect(load).toHaveBeenCalledTimes(calls)
  expect(clock).toHaveBeenCalledTimes(1)
})

it('successful mutation refreshes mounted queries and invalidates the inactive tab', async () => {
  render(<WorkspaceProvider><Navigation /></WorkspaceProvider>)
  await screen.findByText('dashboard/2023-08-12')
  fireEvent.click(screen.getByRole('button', { name: 'alerts' }))
  await screen.findByText('alerts/2023-08-12')
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'synthetic-only' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ caseIds: [1], targetCaseId: null })))
  await act(async () => { await postJson('/api/v1/review/commands', { action: 'COMMENT', comment: '합성 갱신 검사', selections: [{ caseId: 1, revision: 1, groupId: 0, txIds: [] }] }) })
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
  fireEvent.click(screen.getByRole('button', { name: 'dashboard' }))
  expect(screen.getByText('dashboard/2023-08-12')).toBeInTheDocument()
  await waitFor(() => expect(load).toHaveBeenCalledTimes(4))
})

it('changing account discards shared dates, filters and query results', async () => {
  const { rerender } = render(<WorkspaceProvider key="one"><Navigation /></WorkspaceProvider>)
  await screen.findByText('dashboard/2023-08-12')
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2023-09-01' } })
  await screen.findByText('dashboard/2023-09-01')
  fireEvent.change(screen.getByLabelText('필터'), { target: { value: 'private' } })
  rerender(<WorkspaceProvider key="two"><Navigation /></WorkspaceProvider>)
  expect(screen.queryByText('dashboard/2023-09-01')).not.toBeInTheDocument()
  await screen.findByText('dashboard/2023-08-12')
  expect(screen.getByLabelText('필터')).toHaveValue('')
  expect(clock).toHaveBeenCalledTimes(2)
})

it('reauthentication carries only case comments and their tab, never cached data or selections', async () => {
  const { WorkspaceState } = await import('./workspaceState')
  const old = new WorkspaceState()
  old.set('case/ALERT/3/comment', '미제출 의견')
  old.set('case/ALERT/3/tab', 'review')
  old.set('ledger/transaction/selection', '101')
  old.set('period', { from: '2023-09-01', to: '2023-09-03' })
  old.scroll.set('alerts', 320)
  let finish!: (value: string) => void
  const late = old.queries.fetch('case/3', () => new Promise<string>(resolve => { finish = resolve }), 60_000)
  const fresh = old.forReauthentication()
  finish('late old case'); await late
  expect(fresh.get('case/ALERT/3/comment', '')).toBe('미제출 의견')
  expect(fresh.get('case/ALERT/3/tab', '')).toBe('review')
  expect(fresh.get('ledger/transaction/selection', null)).toBeNull()
  expect(fresh.get('period', null)).toBeNull()
  expect(fresh.scroll.size).toBe(0)
  expect(fresh.queries.snapshot('case/3').state.status).toBe('loading')
})
