import { act, fireEvent, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { mountWorkflows } from './workflow-components';

it('shares the investigation card structure while retaining judgment selection and target access', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
  const host = document.createElement('main');
  host.innerHTML = '<div data-workflow="report" data-report-view="card"></div>';
  document.body.append(host);
  const code = 'A-261111-000009';
  const cases = [
    { code, kind: 'Alert', verdict: 'abnormal', status: '처리 완료', pattern: 'FAN-OUT' },
    { code: 'A-261111-000010', kind: 'Alert', verdict: 'normal', status: '처리 완료', judgment: {
      id: 'J-261119-000009', verdict: 'normal', reviewer: '기관 검토자', at: '2026-11-19T01:30:00.000Z',
      reasonCategory: 'normal-business', evidence: '정산 원장', observations: '동일일 정산', reason: '검토한 사유',
    } },
  ];
  let workflows;
  try {
    await act(async () => { workflows = mountWorkflows(host, undefined, { reportData: { cases } }); });
    const saved = within(host).getByRole('article', { name: 'J-261119-000009' });
    expect(within(saved).getByText('기관 검토자')).toBeInTheDocument();
    expect(within(saved).getByText('2026-11-19 10:30 KST')).toHaveAttribute('datetime', '2026-11-19T01:30:00.000Z');
    expect(saved.querySelector('summary')).toHaveTextContent('검토한 사유');
    fireEvent.click(saved.querySelector('summary'));
    expect(saved.querySelector('details')).toHaveAttribute('open');
    expect(within(saved).getByText('정산 원장')).toBeInTheDocument();
    expect(within(saved).getByText('동일일 정산')).toBeInTheDocument();
    const card = within(host).getByRole('article', { name: 'J-261111-000001' });
    expect(within(card).getAllByText('기록 없음')).toHaveLength(3);
    expect(card).toHaveClass('preview-case-card');
    expect(card).toHaveAttribute('data-verdict', 'abnormal');
    expect(within(card).getByRole('heading', { name: 'J-261111-000001' }).closest('header'))
      .toHaveClass('card-header');
    const target = within(card).getByRole('button', { name: `${code} 상세 열기` });
    expect(target).toHaveAttribute('data-work-code', code);
    expect(target.closest('.preview-case-card-body')).not.toBeNull();
    const download = within(host).getByRole('button', { name: 'AI 보고서 다운로드' });
    expect(download).toBeDisabled();
    const selection = within(card).getByRole('checkbox', { name: 'J-261111-000001 선택' });
    fireEvent.click(selection);
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(download).toBeEnabled();
    fireEvent.click(selection);
    expect(card).not.toHaveAttribute('data-selected');
    expect(download).toBeDisabled();
  } finally {
    await act(async () => { workflows?.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  }
});
