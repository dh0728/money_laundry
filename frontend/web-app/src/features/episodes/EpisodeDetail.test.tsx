import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { writeMemory } from '@/lib/memory'
import { loadMockEpisode } from '@/mocks/episodes'
import EpisodeDetail from './EpisodeDetail'

it('연결 Alert를 선택해 사유와 함께 해제 요청한다', async () => {
  const { detail, graph, transactions } = await loadMockEpisode(800, undefined, 'normal')
  writeMemory(`episode:${detail.episodeId}:tab`, 'overview')
  const unlink = vi.fn()
  render(<EpisodeDetail episode={detail} graph={graph} transactions={transactions} history={detail.history}
    relabels={{}} onRelabel={() => {}} responsible onOpenAlert={() => {}} onComment={() => {}}
    onRequestReview={() => {}} onUnlinkAlerts={unlink} />)

  fireEvent.click(screen.getByRole('button', { name: '연결 Alert 선택' }))
  fireEvent.click(within(screen.getByTestId('linked-alerts')).getByText(`A-${detail.alerts[0].alertId}`))
  expect(screen.getByRole('checkbox', { name: `Alert A-${detail.alerts[0].alertId} 선택` })).toBeChecked()
  fireEvent.change(screen.getByRole('textbox', { name: '연결 해제 사유' }), { target: { value: '별도 조사 대상' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 Alert 연결 해제' }))
  expect(unlink).toHaveBeenCalledWith([detail.alerts[0].alertId], '별도 조사 대상')
})
