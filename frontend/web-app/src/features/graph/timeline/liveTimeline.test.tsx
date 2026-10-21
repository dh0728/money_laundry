import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReviewCase } from '@/api/liveReview'
import { buildTimeline, lanePlan, type TimeTx } from './timeLayout'
import TimeGraph from './TimeGraph'
import PairTimeline from './PairTimeline'

vi.mock('./PatternGraph', () => ({ default: ({ active }: { active?: boolean }) => <div data-testid="pattern-active" data-active={String(active)}>시안 패턴</div> }))
const row: TimeTx = { txId: 101, txAt: '2023-09-10T00:00:00Z', fromAccount: 'a', toAccount: 'b', fromBank: 1, toBank: 2, amountUsd: 10, amountPaid: 12, paymentCurrency: 'EUR', launderingScore: 0.7 }

it('live는 승인된 패턴과 소유주 보기를 유지하고 시안 변경 명령은 노출하지 않는다', () => {
  render(<TimeGraph rows={[row]} context={{ kind: 'alert', code: 'A-1' }} live={{ onInvestigate: vi.fn() }} />)
  expect(screen.getByRole('button', { name: '패턴' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: '계좌' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /범위에서 제거|Episode로 묶기|새 Alert로 분리/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '소유주' }))
  expect(screen.getByRole('button', { name: '소유주' })).toHaveAttribute('aria-pressed', 'true')
})

it('소유주 ID가 다른 두 사람은 같은 표시 이름이어도 합치지 않는다', () => {
  const rows = [{ ...row, fromOwnerId: 'owner-1', fromOwnerName: '같은 표시 이름', toOwnerId: 'owner-2', toOwnerName: '같은 표시 이름' }]
  const groups = lanePlan(buildTimeline(rows), 'owner').groups
  expect(groups.map(group => [group.key, group.accounts])).toEqual([['owner:owner-1', ['a']], ['owner:owner-2', ['b']]])
})

it('실제 조사 거래를 중복 없이 변환하고 문자열 금액과 미채점 값을 보존한다', async () => {
  const adapterPath = './liveTimelineAdapter'
  const module = await import(/* @vite-ignore */ adapterPath).catch(() => null)
  expect(module, 'live 조사 거래 adapter가 있어야 함').not.toBeNull()
  const member = { txId: 101, state: 'PENDING', decision: null, sources: [{ alertId: 7 }], transaction: { occurredAt: row.txAt, fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountUsd: '10.5', amountPaid: '12.75', paymentCurrency: 'EUR', scores: null } }
  const item = { groups: [{ sourceAlertId: 7, members: [member, { ...member, txId: 102, state: 'EXCLUDED' }] }, { sourceAlertId: 8, members: [member, { ...member, txId: 103, state: 'TRANSFERRED' }] }], accounts: [{ id: 'a', ownerId: 'owner-1', ownerName: '가상 소유주', bankId: 1 }] } as unknown as ReviewCase
  const rows = module!.toReviewTimelineRows(item)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ txId: 101, txAt: row.txAt, amountUsd: 10.5, amountPaid: 12.75, fromOwnerId: 'owner-1', fromOwnerName: '가상 소유주', launderingScore: null })
})

it('한 계좌의 재등장 선택과 연결선 선택에서 실제 거래 ID를 찾는다', async () => {
  const adapterPath = './liveTimelineAdapter'
  const module = await import(/* @vite-ignore */ adapterPath).catch(() => null)
  expect(module, 'live 조사 거래 adapter가 있어야 함').not.toBeNull()
  const g = buildTimeline([row, { ...row, txId: 102, txAt: '2023-09-10T01:00:00Z', fromAccount: 'b', toAccount: 'a' }, { ...row, txId: 103, fromAccount: 'c', toAccount: 'd' }])
  const secondA = g.apps.find(app => app.account === 'a' && app.nth === 2)!
  expect(module!.selectedTimelineTxIds(g, { nodes: [secondA.id], edges: [] })).toEqual([101, 102])
  expect(module!.selectedTimelineTxIds(g, { nodes: [], edges: [g.bundles[0].id] })).toEqual([101])
})

it('거래가 없으면 빈 결과를 표시하고 빈 시간축을 그리지 않는다', () => {
  render(<TimeGraph rows={[]} context={{ kind: 'alert', code: 'A-1' }} live={{ onInvestigate: vi.fn() }} />)
  expect(screen.getByText('조사 범위에 거래가 없습니다.')).toBeInTheDocument()
  expect(screen.queryByLabelText('시간순 관계 그래프')).not.toBeInTheDocument()
})

it('유효하지 않은 거래 시각을 정상 시간축으로 표시하지 않는다', () => {
  render(<TimeGraph rows={[{ ...row, txAt: 'invalid' }]} context={{ kind: 'alert', code: 'A-1' }} live={{ onInvestigate: vi.fn() }} />)
  expect(screen.getByRole('alert')).toHaveTextContent('거래 시각을 확인할 수 없어 시간순 그래프를 표시하지 못했습니다.')
})

it('번호 대응표로 실제 계좌를 고르고 그 계좌의 조사 거래로 이동한다', () => {
  const investigate = vi.fn()
  render(<TimeGraph rows={[row]} context={{ kind: 'alert', code: 'A-1' }} live={{ onInvestigate: investigate }} />)
  fireEvent.click(screen.getByRole('button', { name: '계좌 a 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '선택한 조사 거래 보기' }))
  expect(investigate).toHaveBeenCalledWith([101])
  expect(screen.queryByRole('button', { name: /범위에서 제거|Episode로 묶기|새 Alert로 분리/ })).not.toBeInTheDocument()
})

it('금액이 없는 거래가 섞여도 계좌쌍의 유효 거래 리본을 유지한다', () => {
  const { container } = render(<PairTimeline a="a" b="b" numbers={new Map([['a', 1], ['b', 2]])} all={[row, { ...row, txId: 102, amountUsd: Number.NaN, amountPaid: Number.NaN }]} />)
  const ribbons = [...container.querySelectorAll('svg g rect')]
  expect(ribbons).toHaveLength(2)
  for (const ribbon of ribbons) {
    expect(Number.isFinite(Number(ribbon.getAttribute('width')))).toBe(true)
    expect(Number(ribbon.getAttribute('width'))).toBeGreaterThan(0)
    expect(Number.isFinite(Number(ribbon.getAttribute('x')))).toBe(true)
  }
  expect(screen.getByText('금액 확인 불가 EUR')).toBeInTheDocument()
  expect(container.textContent).toContain('확인 불가')
})

it('같은 거래 ID의 구조가 정정되면 계좌 노드도 최신 계좌로 갱신한다', async () => {
  const live = { onInvestigate: vi.fn() }
  const { rerender, container } = render(<TimeGraph rows={[row]} context={{ kind: 'alert', code: 'A-1' }} live={live} />)
  fireEvent.click(screen.getByRole('button', { name: '소유주' }))
  await waitFor(() => expect(container.querySelector('[title="2번 b"]')).not.toBeNull())
  rerender(<TimeGraph rows={[{ ...row, toAccount: 'c' }]} context={{ kind: 'alert', code: 'A-1' }} live={live} />)
  await waitFor(() => expect(container.querySelector('[title="2번 c"]')).not.toBeNull())
  expect(container.querySelector('[title="2번 b"]')).toBeNull()
})

it('부모 조사 탭의 활성 상태를 패턴 캔버스에 전달한다', () => {
  const props = { rows: [row], context: { kind: 'alert' as const, code: 'A-1' }, live: { onInvestigate: vi.fn() } }
  const { rerender } = render(<TimeGraph {...props} active={false} />)
  expect(screen.getByTestId('pattern-active')).toHaveAttribute('data-active', 'false')
  rerender(<TimeGraph {...props} active />)
  expect(screen.getByTestId('pattern-active')).toHaveAttribute('data-active', 'true')
})
