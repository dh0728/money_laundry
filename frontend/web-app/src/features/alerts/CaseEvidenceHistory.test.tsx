import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReviewCase } from '@/api/liveReview'
import CaseEvidenceHistory from './CaseEvidenceHistory'

const item = (extra: Partial<ReviewCase> = {}): ReviewCase => ({
  caseId: 101, kind: 'ALERT', alertId: 101, status: 'OPEN', outcome: null, revision: 1,
  assigneeId: 1, assigneeName: '', createdAt: '', assignedAt: '', closedAt: null, ageDays: 0,
  summary: { txCount: 0, subjectCount: 0, seedCount: 0, riskScore: 0, primaryType: '', amountsByCurrency: {}, firstTxAt: null, lastTxAt: null },
  pendingCount: 0, episodeId: null, sourceAlertIds: [], primaryTypes: [], groups: [], ...extra,
})
const expand = (name: RegExp) => {
  const summary = screen.getByText(name, { selector: 'summary' })
  fireEvent.click(summary)
  // jsdom does not implement the native details toggle.
  summary.parentElement!.setAttribute('open', '')
  return within(summary.parentElement!)
}

it('다른 사건 판정은 참고로 표시하고 정확한 사건 종류와 ID로만 이동한다', () => {
  const onOpenCase = vi.fn()
  const current = item({ relatedDecisions: [{ caseId: 700, kind: 'EPISODE', status: 'CLOSED', groupId: 9, txId: '900719925474099312345', decision: 'SUSPICIOUS' }] })
  const before = structuredClone(current)
  render(<CaseEvidenceHistory item={current} onOpenCase={onOpenCase} />)
  const section = expand(/다른 사건의 판정/)
  expect(section.getByText('같은 거래에 대한 참고 판정이며 현재 사건의 판정을 바꾸지 않습니다.')).toBeInTheDocument()
  expect(section.getByText(/900719925474099312345/)).toBeInTheDocument()
  expect(section.getByText(/묶음 9/)).toBeInTheDocument()
  expect(section.getByText(/의심/)).toBeInTheDocument()
  expect(section.getByText(/종결/)).toBeInTheDocument()
  fireEvent.click(section.getByRole('button', { name: 'Episode E-700 보기' }))
  expect(onOpenCase).toHaveBeenCalledExactlyOnceWith('EPISODE', 700)
  expect(current).toEqual(before)
})

it('철회된 거래의 보존 판정·역할·근거 버전을 현재 소속과 구분한다', () => {
  render(<CaseEvidenceHistory item={item({ withdrawnMembers: [{ txId: 83, evidenceVersion: 4, reviewRole: 'CONTEXT', state: 'DECIDED', decision: 'NORMAL' }] })} onOpenCase={vi.fn()} />)
  const section = expand(/현재 근거에서 빠진 거래/)
  expect(section.getByText('현재 조사 범위에 포함되지 않는 보존 기록입니다.')).toBeInTheDocument()
  expect(section.getByText('거래 83')).toBeInTheDocument()
  expect(section.getByText(/근거 버전 4/)).toBeInTheDocument()
  expect(section.getByText(/참고 맥락/)).toBeInTheDocument()
  expect(section.getByText(/판정 완료/)).toBeInTheDocument()
  expect(section.getByText(/정상/)).toBeInTheDocument()
  expect(section.queryByRole('button')).not.toBeInTheDocument()
})

it('대표 사건과 계보를 응답 ID 그대로 연결하고 관계 종류·이벤트를 보존한다', () => {
  const onOpenCase = vi.fn()
  render(<CaseEvidenceHistory item={item({ canonicalAlertId: 303, relations: [{ source_alert_id: 101, target_alert_id: 202, kind: 'SUCCESSOR', event_id: 55 }] })} onOpenCase={onOpenCase} />)
  fireEvent.click(screen.getByRole('button', { name: '대표 Alert A-303 보기' }))
  const section = expand(/이전·후속 Alert/)
  expect(section.getByText(/SUCCESSOR/)).toBeInTheDocument()
  expect(section.getByText(/이벤트 55/)).toBeInTheDocument()
  expect(section.getByText('A-101 · 현재 사건')).toBeInTheDocument()
  fireEvent.click(section.getByRole('button', { name: 'Alert A-202 보기' }))
  expect(onOpenCase.mock.calls).toEqual([['ALERT', 303], ['ALERT', 202]])
})

it('열린 제안은 미반영 안내와 ID만 표시하고 실행 버튼을 제공하지 않는다', () => {
  render(<CaseEvidenceHistory item={item({ pendingProposalIds: [91, 92], canonicalAlertId: 101 })} onOpenCase={vi.fn()} />)
  const section = expand(/열린 변경 제안/)
  expect(section.getByText('제안 91')).toBeInTheDocument()
  expect(section.getByText('제안 92')).toBeInTheDocument()
  expect(section.getByText(/현재 공개 범위 유지 · 미반영/)).toBeInTheDocument()
  expect(section.getByText(/제안 상세·동의 처리는 이 화면에 연결되지 않았습니다/)).toBeInTheDocument()
  expect(section.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText('A-101 · 현재 사건이 대표 Alert입니다.')).toBeInTheDocument()
})

it('미제공과 빈 이력을 구분하고 Episode에 Alert 전용 정보를 요구하지 않는다', () => {
  const { rerender } = render(<CaseEvidenceHistory item={item()} onOpenCase={vi.fn()} />)
  expect(expand(/다른 사건의 판정/).getByText('정보 미제공')).toBeInTheDocument()
  expect(expand(/현재 근거에서 빠진 거래/).getByText('정보 미제공')).toBeInTheDocument()
  expect(expand(/이전·후속 Alert/).getByText('정보 미제공')).toBeInTheDocument()
  expect(expand(/열린 변경 제안/).getByText('정보 미제공')).toBeInTheDocument()
  expect(screen.getByText('대표 Alert 정보 미제공')).toBeInTheDocument()
  rerender(<CaseEvidenceHistory item={item({ relatedDecisions: [], withdrawnMembers: [], relations: [], pendingProposalIds: [], canonicalAlertId: null })} onOpenCase={vi.fn()} />)
  expect(screen.getByText('다른 사건의 판정 없음')).toBeInTheDocument()
  expect(screen.getByText('철회된 거래 없음')).toBeInTheDocument()
  expect(screen.getByText('연결된 Alert 없음')).toBeInTheDocument()
  expect(screen.getByText('열린 변경 제안 없음')).toBeInTheDocument()
  expect(screen.getByText('대표 Alert 없음')).toBeInTheDocument()
  rerender(<CaseEvidenceHistory item={item({ kind: 'EPISODE', alertId: null })} onOpenCase={vi.fn()} />)
  expect(screen.queryByText(/대표 Alert/)).not.toBeInTheDocument()
  expect(screen.queryByText(/열린 변경 제안/)).not.toBeInTheDocument()
})
