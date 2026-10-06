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
  const cancel = screen.getByRole('button', { name: '선택 취소' })
  const unlinkButton = screen.getByRole('button', { name: '선택 Alert 연결 해제' })
  expect(cancel.nextElementSibling).toBe(unlinkButton)
  expect(screen.getByRole('textbox', { name: '연결 해제 사유' }).closest('label')?.parentElement).not.toContainElement(unlinkButton)
  fireEvent.click(within(screen.getByTestId('linked-alerts')).getByText(`A-${detail.alerts[0].alertId}`))
  expect(screen.getByRole('checkbox', { name: `연결 해제 Alert A-${detail.alerts[0].alertId}` })).toBeChecked()
  fireEvent.change(screen.getByRole('textbox', { name: '연결 해제 사유' }), { target: { value: '별도 조사 대상' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 Alert 연결 해제' }))
  expect(unlink).toHaveBeenCalledWith([detail.alerts[0].alertId], '별도 조사 대상')
})

it('Alert가 1건만 남으면 해체를 2차 확인한 뒤 전달한다', async () => {
  const { detail, graph, transactions } = await loadMockEpisode(800, undefined, 'normal')
  writeMemory(`episode:${detail.episodeId}:tab`, 'overview')
  const unlink = vi.fn()
  render(<EpisodeDetail episode={detail} graph={graph} transactions={transactions} history={detail.history}
    relabels={{}} onRelabel={() => {}} responsible onOpenAlert={() => {}} onComment={() => {}}
    onRequestReview={() => {}} onUnlinkAlerts={unlink} />)

  fireEvent.click(screen.getByRole('button', { name: '연결 Alert 선택' }))
  expect(screen.getByText('연결 해제 후 Alert가 1건 이하이면 Episode가 해체되고 모든 Alert가 단독으로 전환됩니다.')).toBeInTheDocument()
  for (const alert of detail.alerts.slice(0, -1)) {
    fireEvent.click(screen.getByRole('checkbox', { name: `연결 해제 Alert A-${alert.alertId}` }))
  }
  fireEvent.change(screen.getByRole('textbox', { name: '연결 해제 사유' }), { target: { value: '별도 조사 대상' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 Alert 연결 해제' }))
  expect(unlink).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Episode를 해체할까요?')
  fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
  expect(unlink).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '연결 해제 사유' })).toHaveValue('별도 조사 대상')
  fireEvent.click(screen.getByRole('button', { name: '선택 Alert 연결 해제' }))
  fireEvent.click(screen.getByRole('button', { name: 'Episode 해체 확인' }))
  expect(unlink).toHaveBeenCalledWith(detail.alerts.slice(0, -1).map(alert => alert.alertId), '별도 조사 대상')
})
