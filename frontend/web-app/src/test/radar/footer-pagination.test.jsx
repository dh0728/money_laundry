import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BenchmarkLedger } from '../../features/investigation/ibm-ledger';

const records = Array.from({ length: 65 }, (_, index) => ({
  code: `TEST-TRANSACTION-${index + 1}`,
  timestamp: index < 60 ? '2022-09-01 12:00' : '2022-09-02 12:00',
  from: { bank: 'A', account: '001' },
  to: { bank: 'B', account: '002' },
  paidAmount: 100,
  paidCurrency: 'USD',
  receivedAmount: 100,
  receivedCurrency: 'USD',
  method: '이체',
  labeled: true,
}));
const dataset = {
  source: '벤치마크',
  period: { start: '2022-09-01', end: '2022-09-02' },
  totals: { transactions: records.length },
  records,
};

it('keeps ledger table and cards on the footer page and resets pagination for filtered results', () => {
  const paginationHost = document.createElement('div');
  const { container, rerender, unmount } = render(<BenchmarkLedger dataset={dataset} paginationHost={paginationHost} />);
  const footer = within(paginationHost);
  const prev = footer.getByRole('button', { name: '이전' });
  const next = footer.getByRole('button', { name: '다음' });
  const scrollRegion = container.querySelector('.data-table-scroll');
  expect(container.querySelector('.footer-pagination')).toBeNull();
  expect(prev.disabled).toBe(true);
  expect(footer.getByText('1 / 3 페이지')).toBeTruthy();

  scrollRegion.scrollTop = 60;
  fireEvent.click(next);
  expect(footer.getByText('2 / 3 페이지')).toBeTruthy();
  expect(scrollRegion.scrollTop).toBe(0);
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-31 상세 열기' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'TEST-TRANSACTION-1 상세 열기' })).toBeNull();

  rerender(<BenchmarkLedger dataset={dataset} tableView={false} paginationHost={paginationHost} />);
  expect(footer.getByText('2 / 3 페이지')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-31 상세 열기' })).toBeTruthy();
  fireEvent.click(next);
  expect(footer.getByText('3 / 3 페이지')).toBeTruthy();
  expect(next.disabled).toBe(true);
  fireEvent.click(prev);
  expect(footer.getByText('2 / 3 페이지')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('거래일'), { target: { value: '2022-09-02' } });
  expect(footer.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-61 상세 열기' })).toBeTruthy();

  fireEvent.change(screen.getByLabelText('거래일'), { target: { value: '' } });
  expect(footer.getByText('1 / 3 페이지')).toBeTruthy();
  unmount();
  expect(footer.queryByRole('navigation')).toBeNull();
});
