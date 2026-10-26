import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/apiMode', () => ({ fixture: true, live: true }))
import RulesPage from './RulesPage'
import { fixtureGet } from '@/mocks/liveFixtureApi'
import type { ReviewCase } from '@/api/liveReview'
it('uses actual review case IDs for fixture rule navigation and does not claim real rule hits', async () => {
  render(<RulesPage />)
  expect(await screen.findByText('합성 조사 연결 예시 · 실제 룰 적중 결과 아님')).toBeInTheDocument()
  const links = await screen.findAllByRole('link', { name: /^A-\d+$/ })
  expect(links.length).toBeGreaterThan(0)
  for (const link of links) {
    const id = Number(link.getAttribute('href')?.split('/')[1])
    const item = fixtureGet(`/api/v1/review/cases/${id}`) as ReviewCase
    expect(link.textContent).toBe(`A-${item.alertId}`)
  }
})
