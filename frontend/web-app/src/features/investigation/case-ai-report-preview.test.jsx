import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AiReportBody, useAiReport } from './case-ai-report-preview';

// 보고서 작성 화면의 AI 분석 보고서 미리보기(API.md §14).

const report = {
  reportId: 3, judgmentId: 1, caseId: 7, kind: 'ALERT', status: 'GENERATED', model: 'claude-sonnet-5-5', createdAt: '2026-11-27T01:00:00Z',
  facts: [{ id: 'F1', text: 'Alert 7, 상태 종결' }, { id: 'F2', text: '근거 거래 18건' }],
  needsBankCheck: ['거래자 성명, 실명번호, 직업 및 주소 (서식 II)'],
  narrative: { overview: [{ text: '자금이 한 계좌로 집중됨', sources: ['F2'] }], subject: [], dates: [], places: [], instruments: [], method: [],
    grounds: [{ text: '담당자 판단: 패턴 일치로 판단함', sources: ['F2'] }], opinion: [] },
};

it('저장된 보고서를 STR 서식 순서와 근거 번호로 보여 준다', () => {
  render(<AiReportBody report={report} />);
  expect(within(screen.getByRole('region', { name: '분석 요지' })).getByText(/자금이 한 계좌로 집중됨/)).toHaveTextContent('[F2]');
  expect(screen.getByRole('region', { name: '6) 혐의거래로 판단한 사유' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '1) 거래자' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '금융회사 확인 필요 사항' })).toHaveTextContent('거래자 성명');
  expect(screen.getByText('근거 사실 목록 (2개)')).toBeInTheDocument();
});

function Probe({ row, live, fetch }) {
  const state = useAiReport(row, { live, fetch });
  return <p>{state.status}{state.report ? ` · ${state.report.reportId}` : ''}{state.error ? ` · ${state.error}` : ''}</p>;
}

it("'이상' 판정은 서버 보고서를 읽고, 실패하면 이유를 보여 준다", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(report).mockRejectedValueOnce(new Error('503'));
  const { rerender } = render(<Probe live fetch={fetch} row={{ id: 'J-230916-000001', verdict: 'abnormal' }} />);
  expect(await screen.findByText('ready · 3')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(1);
  rerender(<Probe live fetch={fetch} row={{ id: 'J-230916-000002', verdict: 'abnormal' }} />);
  expect(await screen.findByText('failed · 503')).toBeInTheDocument();
});

it("'정상' 판정과 샘플 모드는 부르지 않는다", () => {
  const fetch = vi.fn();
  const { rerender } = render(<Probe live fetch={fetch} row={{ id: 'J-230916-000003', verdict: 'normal' }} />);
  expect(screen.getByText('not-applicable')).toBeInTheDocument();
  rerender(<Probe live={false} fetch={fetch} row={{ id: 'J-230916-000001', verdict: 'abnormal' }} />);
  expect(screen.getByText('sample')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
