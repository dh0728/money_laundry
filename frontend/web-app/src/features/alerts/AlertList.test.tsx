import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { NuqsAdapter } from 'nuqs/adapters/react'
import AlertList, { type AlertListRow } from './AlertList'
import { CurrentUserContext, MOCK_USER } from '@/app/session'
import { WorkspaceProvider } from '@/lib/WorkspaceProvider'

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn() })

const row: AlertListRow = { alertId: 3001, riskScore: 0.8, txCount: 1, assignee: { userId: 11, name: '조사자' }, status: 'OPEN', createdAt: '2023-09-10', ageDays: 1, episodeId: null, primaryType: { code: 1, name: 'Fan-out' } }
function list(scope: string, options: { loading?: boolean; userId?: number; role?: 'STAFF' | 'ADMIN'; onLink?: (ids: number[], target: 'new' | number, comment: string) => void | Promise<void>; rows?: AlertListRow[]; targets?: number[] } = {}) {
  const user = { ...MOCK_USER, userId: options.userId ?? 11, role: options.role ?? 'STAFF' }
  return <NuqsAdapter><CurrentUserContext.Provider value={user}><WorkspaceProvider sessionKey={`${user.userId}:${user.role}`}>
    <AlertList rows={options.loading ? [] : options.rows ?? [row]} today={new Date('2023-09-10')} onOpen={vi.fn()} onLink={options.onLink ?? vi.fn()} remote={{ draftScope: scope, loading: options.loading, filters: [], onFilters: vi.fn(), query: '', onQuery: vi.fn(), assignees: [], footer: null, targets: options.targets ?? [50], onRange: vi.fn() }} />
  </WorkspaceProvider></CurrentUserContext.Provider></NuqsAdapter>
}
async function enterDraft(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Episode로 묶기' }))
  fireEvent.click(screen.getByLabelText('A-3001 선택'))
  fireEvent.change(screen.getByLabelText('연결 의견'), { target: { value: text } })
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Episode 연결 방식' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: '기존 Episode · E-50' }))
}
it('401 restores the same scoped selection, target and comment only after fresh rows load', async () => {
  const first = render(list('restore-filter/page-2'))
  await enterDraft('private link reason')
  first.unmount()
  const onLink = vi.fn().mockResolvedValue(undefined)
  const second = render(list('restore-filter/page-2', { loading: true, onLink }))
  expect(screen.queryByLabelText('연결 의견')).not.toBeInTheDocument()
  expect(onLink).not.toHaveBeenCalled()
  second.rerender(list('restore-filter/page-2', { onLink }))
  expect(screen.getByLabelText('연결 의견')).toHaveValue('private link reason')
  expect(screen.getByLabelText('A-3001 선택')).toBeChecked()
  expect(screen.getByRole('combobox', { name: 'Episode 연결 방식' })).toHaveTextContent('E-50')
  expect(onLink).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '연결 완료' }))
  await waitFor(() => expect(onLink).toHaveBeenCalledWith([3001], 50, 'private link reason'))
  await waitFor(() => expect(screen.queryByLabelText('연결 의견')).not.toBeInTheDocument())
  second.unmount()
  render(list('restore-filter/page-2'))
  expect(screen.queryByLabelText('연결 의견')).not.toBeInTheDocument()
})
it('other users, roles and filter/page scopes never expose a stored link draft; cancel clears it', async () => {
  const first = render(list('isolated-filter/page-1'))
  await enterDraft('isolated private reason')
  first.unmount()
  for (const options of [{ userId: 99 }, { role: 'ADMIN' as const }]) {
    const view = render(list('isolated-filter/page-1', options))
    expect(screen.queryByLabelText('연결 의견')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('isolated private reason')).not.toBeInTheDocument()
    view.unmount()
  }
  const otherScope = render(list('different-filter/page-1'))
  expect(screen.queryByLabelText('연결 의견')).not.toBeInTheDocument()
  otherScope.unmount()
  const restored = render(list('isolated-filter/page-1'))
  expect(screen.getByLabelText('연결 의견')).toHaveValue('isolated private reason')
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  restored.unmount()
  render(list('isolated-filter/page-1'))
  expect(screen.queryByLabelText('연결 의견')).not.toBeInTheDocument()
})

it('fresh membership or target changes block a restored form and filter changes clear selection', async () => {
  const first = render(list('fresh-validation/page-1'))
  await enterDraft('validate latest membership')
  first.unmount()
  const onLink = vi.fn()
  const second = render(list('fresh-validation/page-1', { rows: [{ ...row, status: 'CLOSED' }], onLink }))
  expect(screen.getByRole('button', { name: '연결 완료' })).toBeDisabled()
  second.rerender(list('fresh-validation/page-1', { targets: [], onLink }))
  expect(screen.getByRole('button', { name: '연결 완료' })).toBeDisabled()
  expect(onLink).not.toHaveBeenCalled()
  second.rerender(list('fresh-validation/page-1', { onLink }))
  expect(screen.getByRole('button', { name: '연결 완료' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Alert 검색'), { target: { value: 'changed filter' } })
  expect(screen.getByLabelText('A-3001 선택')).not.toBeChecked()
  expect(screen.getByRole('button', { name: '연결 완료' })).toBeDisabled()
})
