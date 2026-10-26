import { fireEvent, render, screen } from '@testing-library/react'
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

  fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))
  expect(screen.getByRole('button', { name: '선택 0건 연결 해제' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: `A-${detail.alerts[0].alertId} 선택` }))
  fireEvent.change(screen.getByPlaceholderText('연결 해제 사유(필수)'), { target: { value: '취소할 입력' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 취소' }))
  expect(unlink).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))
  expect(screen.getByRole('checkbox', { name: `A-${detail.alerts[0].alertId} 선택` })).not.toBeChecked()
  expect(screen.getByRole('textbox', { name: '연결 해제 사유' })).toHaveValue('')
  fireEvent.click(screen.getByRole('checkbox', { name: `A-${detail.alerts[0].alertId} 선택` }))
  fireEvent.change(screen.getByRole('textbox', { name: '연결 해제 사유' }), { target: { value: '별도 조사 대상' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 1건 연결 해제' }))
  expect(unlink).toHaveBeenCalledWith([detail.alerts[0].alertId], '별도 조사 대상')
  expect(unlink).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('Alert가 1건만 남으면 해체를 2차 확인한 뒤 전달한다', async () => {
  const { detail, graph, transactions } = await loadMockEpisode(800, undefined, 'normal')
  writeMemory(`episode:${detail.episodeId}:tab`, 'overview')
  const unlink = vi.fn()
  render(<EpisodeDetail episode={detail} graph={graph} transactions={transactions} history={detail.history}
    relabels={{}} onRelabel={() => {}} responsible onOpenAlert={() => {}} onComment={() => {}}
    onRequestReview={() => {}} onUnlinkAlerts={unlink} />)

  fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))
  for (const alert of detail.alerts.slice(0, -1)) {
    fireEvent.click(screen.getByRole('checkbox', { name: `A-${alert.alertId} 선택` }))
  }
  fireEvent.change(screen.getByPlaceholderText('연결 해제 사유(필수)'), { target: { value: '별도 조사 대상' } })
  fireEvent.click(screen.getByRole('button', { name: `선택 ${detail.alerts.length - 1}건 연결 해제` }))
  expect(unlink).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Episode를 해체할까요?')
  fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
  expect(unlink).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '연결 해제 사유' })).toHaveValue('별도 조사 대상')
  fireEvent.click(screen.getByRole('button', { name: `선택 ${detail.alerts.length - 1}건 연결 해제` }))
  fireEvent.click(screen.getByRole('button', { name: 'Episode 해체 확인' }))
  expect(unlink).toHaveBeenCalledWith(detail.alerts.slice(0, -1).map(alert => alert.alertId), '별도 조사 대상')
  expect(unlink).toHaveBeenCalledTimes(1)
})

it('연결 Alert ID는 키보드로 실행할 수 있는 기존 행 안의 버튼이다', async () => {
  const { detail, graph, transactions } = await loadMockEpisode(800, undefined, 'normal')
  writeMemory(`episode:${detail.episodeId}:tab`, 'overview')
  const open = vi.fn()
  render(<EpisodeDetail episode={detail} graph={graph} transactions={transactions} history={detail.history}
    relabels={{}} onRelabel={() => {}} responsible onOpenAlert={open} onComment={() => {}} onRequestReview={() => {}} />)
  const id = detail.alerts[0].alertId
  fireEvent.click(screen.getByRole('button', { name: `A-${id}` }))
  expect(open).toHaveBeenCalledExactlyOnceWith(id)
})
