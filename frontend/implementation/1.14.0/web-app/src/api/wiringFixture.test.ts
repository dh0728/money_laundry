import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/apiMode', () => ({ fixture: true, live: true }))
import { getJson, postJson, refreshCsrf } from './common'
import { login, logout, restoreSession } from './auth'
afterEach(() => vi.unstubAllGlobals())
it('supplies explicit synthetic reads and blocks all HTTP writes/auth in fixture mode', async () => {
  const network = vi.fn(() => { throw new Error('fixture must not reach network') })
  vi.stubGlobal('fetch', network)
  expect(await restoreSession()).toMatchObject({ id: 11, username: 'fixture-staff', role: 'STAFF' })
  expect(await getJson('/api/v1/review/cases/1')).toMatchObject({ caseId: 1, alertId: 3001 })
  await expect(getJson('/api/unprepared')).rejects.toThrow()
  for (const command of [() => postJson('/api/v1/review/commands', {}), () => refreshCsrf(), () => login('unused', 'unused'), () => logout()]) {
    await expect(command()).rejects.toMatchObject({ problem: { code: 'FIXTURE_READ_ONLY' } })
  }
  expect(network).not.toHaveBeenCalled()
})

it('allows only notification read state in fixture memory without any HTTP or review write', async () => {
  const { fetchNotifications, setNotificationsRead } = await import('./notifications')
  const network = vi.fn(() => { throw new Error('fixture must not reach network') })
  vi.stubGlobal('fetch', network)
  const before = await fetchNotifications('', '', '', 0)
  const unread = before.content.find(row => !row.read)
  expect(unread).toBeDefined()
  if (!unread) return
  await setNotificationsRead([unread.id], true)
  expect((await fetchNotifications('', '', '', 0)).content.find(row => row.id === unread.id)?.read).toBe(true)
  await setNotificationsRead([unread.id], false)
  expect((await fetchNotifications('', '', '', 0)).content.find(row => row.id === unread.id)?.read).toBe(false)
  await expect(postJson('/api/v1/review/commands', {})).rejects.toMatchObject({ problem: { code: 'FIXTURE_READ_ONLY' } })
  expect(network).not.toHaveBeenCalled()
})
