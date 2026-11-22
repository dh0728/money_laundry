import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaseTransactionEdit } from './case-transaction-edit';

const row = { code: 'A-261111-000006', assigned: true, open: true, status: '처리 중' };
const destinations = [{ code: 'A-261111-000009', pattern: 'Fan-out 82%' }];
const selected = ['T-261111-00000002', 'T-261111-00000003'];

afterEach(() => vi.useRealTimers());

function open(container) {
  const dialog = container.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
  };
  fireEvent.click(screen.getByRole('button', { name: '선택 항목 편집 · 2건' }));
  return within(screen.getByRole('dialog', { name: '선택 항목 편집' }));
}

it('shows the exact IDs and requires an operation, reason and held confirmation before applying', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const apply = vi.fn().mockReturnValueOnce({ ok: false, error: '선택을 다시 확인해 주세요.' }).mockReturnValue({ ok: true });
  const { container } = render(<CaseTransactionEdit row={row} selected={selected} destinations={destinations}
    canEdit onApply={apply} onClear={() => {}} />);
  const modal = open(container);
  const targetList = within(modal.getByRole('list', { name: '선택 거래 ID' }));
  expect(targetList.getAllByRole('listitem').map(item => item.textContent)).toEqual(selected);
  const applyMove = modal.getByRole('button', { name: '적용', exact: true });
  const reason = modal.getByRole('textbox', { name: '변경 사유' });
  expect(applyMove).toBeDisabled();
  fireEvent.click(modal.getByRole('radio', { name: '다른 Alert로 이동' }));
  fireEvent.change(reason, { target: { value: '  동일 거래 묶음에 포함  ' } });
  expect(applyMove).toBeDisabled();
  fireEvent.change(modal.getByRole('combobox', { name: '이동할 Alert' }), { target: { value: destinations[0].code } });
  expect(applyMove).toBeEnabled();
  fireEvent.click(applyMove);
  expect(apply).toHaveBeenCalledWith({ codes: selected, targetCode: destinations[0].code, reason: '동일 거래 묶음에 포함' });
  expect(modal.getByRole('alert')).toHaveTextContent('선택을 다시 확인해 주세요.');
  expect(reason).toHaveValue('  동일 거래 묶음에 포함  ');
  act(() => vi.advanceTimersByTime(300));
  fireEvent.click(modal.getByRole('radio', { name: '이 Alert에서 제외' }));
  const hold = modal.getByRole('button', { name: '길게 눌러 적용' });
  fireEvent.keyDown(hold, { key: 'Enter' });
  act(() => vi.advanceTimersByTime(2100));
  expect(apply).toHaveBeenLastCalledWith({ codes: selected, targetCode: null, reason: '동일 거래 묶음에 포함' });
  expect(screen.queryByRole('dialog', { name: '선택 항목 편집' })).not.toBeInTheDocument();
});

it('keeps selection inspectable and clearable in read-only mode', () => {
  const clear = vi.fn();
  const apply = vi.fn();
  const { container } = render(<CaseTransactionEdit row={row} selected={selected} canEdit={false}
    blockedReason="현재 연결은 조회 전용입니다." onApply={apply} onClear={clear} />);
  const modal = open(container);
  expect(modal.getByText('현재 연결은 조회 전용입니다.')).toBeInTheDocument();
  expect(modal.queryByRole('radio')).not.toBeInTheDocument();
  expect(modal.queryByRole('button', { name: '길게 눌러 적용' })).not.toBeInTheDocument();
  fireEvent.click(modal.getByRole('button', { name: '선택 해제' }));
  expect(clear).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
});
