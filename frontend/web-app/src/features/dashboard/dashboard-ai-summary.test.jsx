import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchDashboardAiSummary } from '@/api/aiSummary';
import { DashboardAiSummary, useDashboardAiSummary } from './dashboard-ai-summary';

// 전체 대시보드 AI 요약(API.md §14). 지수는 서버가 계산하고 Claude 문장이 없으면 지표를 그대로 보여 준다.
vi.mock('@/api/aiSummary', () => ({ fetchDashboardAiSummary: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const index = {
  latestTxDate: '2023-09-10', businessDate: '2023-09-11', score: 58, level: '경계',
  indicators: [
    { key: 'suspiciousRate', label: '의심 거래 비율', weight: 30, current: '4.00% (40 / 1000건)', baseline: '2.00% (앞 30일 평균)', ratio: 2, score: 60 },
    { key: 'newAlerts', label: '오늘 생성 Alert', weight: 25, current: '6건', baseline: null, ratio: null, score: null },
  ],
};

it('지수와 Claude 의 결론·근거를 보여 준다', () => {
  render(<DashboardAiSummary reduced summary={{ index, headline: '종합 위험지수 58점으로 경계 단계임',
    points: [{ text: '의심 거래 비율이 평소의 2.00배임', sources: ['F2'] }], facts: [], model: 'm', generatedAt: '2026-11-26T00:00:00Z' }} />);
  expect(screen.getByLabelText('종합 위험지수 58점, 경계')).toBeInTheDocument();
  expect(screen.getByRole('meter', { name: '종합 위험지수' })).toHaveAttribute('aria-valuenow', '58');
  expect(within(screen.getByRole('list', { name: '위험 단계' })).getByText('경계').closest('li')).toHaveAttribute('aria-current', 'step');
  expect(screen.getByText('종합 위험지수 58점으로 경계 단계임')).toHaveAttribute('data-ai-summary', 'claude');
  expect(screen.getByText('의심 거래 비율이 평소의 2.00배임')).toBeInTheDocument();
});

it('Claude 문장이 없으면 지표를 그대로 읽어 준다', () => {
  render(<DashboardAiSummary reduced summary={{ index, headline: null, points: [], facts: [], model: 'm', generatedAt: '2026-11-26T00:00:00Z' }} />);
  const items = within(document.querySelector('.overview-summary-facts')).getAllByRole('listitem').map(item => item.textContent);
  expect(items).toEqual(['의심 거래 비율 4.00% (40 / 1000건) · 평소의 2배 · 지표 60점', '오늘 생성 Alert 6건 · 기준선 없음']);
});

function Probe({ enabled }) {
  const state = useDashboardAiSummary(enabled);
  return <p>{state.status}</p>;
}

it('서비스 모드에서만 읽고, 실패하면 failed 다', async () => {
  fetchDashboardAiSummary.mockRejectedValue(new Error('503'));
  const { rerender } = render(<Probe enabled={false} />);
  expect(screen.getByText('failed')).toBeInTheDocument();
  expect(fetchDashboardAiSummary).not.toHaveBeenCalled();
  fetchDashboardAiSummary.mockResolvedValue({ index });
  rerender(<Probe enabled />);
  expect(await screen.findByText('ready')).toBeInTheDocument();
});
