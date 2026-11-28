import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import { PreviewEpisodeDialog } from './preview-episode-dialog';

vi.mock('./episode-bundle-graph', () => ({
  default: ({ rows }) => <p data-testid="bundle-graph">{rows.map(row => row.code).join(',')}</p>,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close() { this.open = false; };
});

const tx = (code, from, to) => ({ code, from: { code: from }, to: { code: to } });
const alert = (code, related, extra = {}) => ({
  code, kind: 'Alert', assigned: true, open: true, verdict: 'unjudged', episodeCode: '', status: '처리 중',
  pattern: 'FAN-OUT 80%', score: 70, elapsed: 2, amountByCurrency: { USD: 100 }, related, ...extra,
});
const cases = [
  alert('A-260901-000001', [tx('T-1', 'a', 'b')]),
  alert('A-260901-000002', [tx('T-2', 'b', 'c')], { pattern: 'CYCLE 100%' }),
  alert('A-260901-000003', [tx('T-3', 'x', 'y')]),
  alert('A-260901-000004', [tx('T-4', 'a', 'q')], { assigned: false }),
];

function checkbox(code) {
  return screen.getByRole('checkbox', { name: `${code} 선택` });
}

it('목록에서 열면 표에서 체크한 행을 미리 고르고, 기본은 새 Episode 생성이며 사유 칸·빠진 이유·연결 요약을 함께 보여 준다', async () => {
  render(<PreviewEpisodeDialog cases={cases} save={vi.fn()} onClose={vi.fn()}
    initialCodes={['A-260901-000001', 'A-260901-000004']} />);
  const dialog = screen.getByRole('dialog', { name: 'Episode로 묶기' });

  expect(within(dialog).getByRole('radio', { name: '새 Episode' })).toHaveAttribute('aria-checked', 'true');
  expect(checkbox('A-260901-000001')).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByRole('checkbox', { name: 'A-260901-000004 선택' })).toBeNull();
  expect(dialog).toHaveTextContent('묶기 불가A-260901-000004다른 담당자');
  expect(screen.getByLabelText('후보에서 빠진 Alert')).toHaveTextContent('제외 1건다른 담당자 1');
  expect(within(dialog).getByLabelText('변경 사유')).toBeInTheDocument();
  expect(dialog).toHaveTextContent('2건 이상 선택');
  expect(dialog).not.toHaveTextContent('·');

  fireEvent.click(checkbox('A-260901-000002'));
  expect(within(dialog).getByLabelText('생성 예정')).toBeInTheDocument();
  expect(dialog).toHaveTextContent('공유 계좌 1개공유 거래 0건');
  expect(await screen.findByTestId('bundle-graph')).toHaveTextContent('A-260901-000001,A-260901-000002');

  fireEvent.click(checkbox('A-260901-000003'));
  expect(dialog).toHaveTextContent('A-260901-000003 연결 없음');

  const confirm = within(dialog).getByRole('button', { name: '내용 확인' });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('변경 사유'), { target: { value: '같은 계좌 흐름' } });
  expect(confirm).toBeEnabled();
});

it('표 찾기 칸은 ID·패턴으로 행을 좁히고 고른 행은 유지한다', () => {
  render(<PreviewEpisodeDialog cases={cases} save={vi.fn()} onClose={vi.fn()} initialCodes={['A-260901-000001']} />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'ID 또는 패턴 검색' }), { target: { value: 'cycle' } });
  expect(screen.getByRole('checkbox', { name: 'A-260901-000002 선택' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'A-260901-000001 선택' })).toBeNull();
  expect(screen.getByLabelText('고른 Alert')).toHaveTextContent('A-260901-000001');
});

it('Alert 상세에서 열면 지금 Alert를 고정하고 계좌·거래를 공유하는 내 Alert만 공유 열과 함께 후보로 둔다', () => {
  render(<PreviewEpisodeDialog cases={cases} row={cases[0]} save={vi.fn()} onClose={vi.fn()} />);
  const table = screen.getByRole('table', { name: '묶을 Alert' });
  expect(within(table).getByRole('columnheader', { name: /공유 계좌/ })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'A-260901-000002 선택' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'A-260901-000003 선택' })).toBeNull();
  expect(screen.getByLabelText('고른 Alert')).toHaveTextContent('A-260901-000001기준');
});
