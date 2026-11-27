import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchCaseAiSummary } from '@/api/aiSummary';
import { useCaseAiSummary } from './case-ai-summary';

// Alert · Episode 개요의 Claude 요약(API.md §14). 실패하면 'failed' 로 두고 화면은 기존 규칙 문장을 쓴다.
vi.mock('@/api/aiSummary', () => ({ fetchCaseAiSummary: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const summary = {
  caseId: 7, kind: 'ALERT', headline: '씨앗 거래 2건이 한 계좌로 모임',
  points: [{ text: '근거 거래 3건이 같은 수취 계좌로 감', sources: ['F2'] }],
  facts: [{ id: 'F2', text: '근거 거래 3건' }], model: 'claude-haiku-5-5/case-summary-v1', generatedAt: '2026-11-26T00:00:00Z',
};

function Probe({ caseId }) {
  const state = useCaseAiSummary(caseId);
  return <p>{state.status}{state.summary ? ` · ${state.summary.headline}` : ''}</p>;
}

it('요약을 읽으면 ready 와 결론을 돌려준다', async () => {
  fetchCaseAiSummary.mockResolvedValue(summary);
  render(<Probe caseId={7} />);
  expect(screen.getByText('loading')).toBeInTheDocument();
  expect(await screen.findByText('ready · 씨앗 거래 2건이 한 계좌로 모임')).toBeInTheDocument();
  expect(fetchCaseAiSummary).toHaveBeenCalledWith(7);
});

it('키가 없거나 실패하면 failed 다', async () => {
  fetchCaseAiSummary.mockRejectedValue(new Error('503'));
  render(<Probe caseId={7} />);
  expect(await screen.findByText('failed')).toBeInTheDocument();
});

it('사건이 없으면 부르지 않는다', () => {
  render(<Probe caseId={undefined} />);
  expect(screen.getByText('loading')).toBeInTheDocument();
  expect(fetchCaseAiSummary).not.toHaveBeenCalled();
});
