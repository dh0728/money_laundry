import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FooterPagination } from '../components/footer-pagination';
import { BenchmarkLedger } from '../features/investigation/ibm-ledger';

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

function chooseDate(key) {
  const date = screen.getByRole('combobox', { name: '거래일' });
  fireEvent.keyDown(date, { key: 'Enter' });
  fireEvent.keyDown(date, { key });
  fireEvent.keyDown(date, { key: 'Enter' });
}

it('shows adjacent controls with a live page label and keeps focus on refresh', () => {
  const onPageChange = vi.fn();
  const pagination = page => <FooterPagination compact label="보관함 페이지 이동" page={page} pageCount={4} onPageChange={onPageChange} />;
  const { rerender } = render(pagination(0));
  const footer = within(screen.getByRole('navigation', { name: '보관함 페이지 이동' }));
  const previous = footer.getByRole('button', { name: '이전으로 가기' });
  const next = footer.getByRole('button', { name: '다음으로 가기' });
  expect(footer.getAllByRole('button')).toHaveLength(2);
  expect(previous).toBeDisabled();
  next.focus();
  fireEvent.click(next);
  expect(onPageChange).toHaveBeenCalledWith(1);
  rerender(pagination(1));
  expect(footer.getByText('2 / 4 페이지')).toHaveAttribute('aria-live', 'polite');
  expect(next).toHaveFocus();
  fireEvent.click(previous);
  expect(onPageChange).toHaveBeenLastCalledWith(0);
  rerender(pagination(3));
  expect(next).toBeDisabled();
});

it('paginates the ledger table and loads more ledger cards without a footer', () => {
  const paginationHost = document.createElement('div');
  const { container, rerender, unmount } = render(<BenchmarkLedger dataset={dataset} paginationHost={paginationHost} />);
  const footer = within(paginationHost);
  const first = footer.getByRole('button', { name: '처음으로 가기' });
  const prev = footer.getByRole('button', { name: '이전으로 가기' });
  const next = footer.getByRole('button', { name: '다음으로 가기' });
  const last = footer.getByRole('button', { name: '마지막으로 가기' });
  const scrollRegion = container.querySelector('.data-table-scroll');
  expect(container.querySelector('.footer-pagination')).toBeNull();
  expect(first.disabled).toBe(true);
  expect(prev.disabled).toBe(true);
  expect(footer.getByText('1 / 3 페이지')).toBeTruthy();

  scrollRegion.scrollTop = 60;
  fireEvent.click(next);
  expect(footer.getByText('2 / 3 페이지')).toBeTruthy();
  expect(scrollRegion.scrollTop).toBe(0);
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-31 상세 열기' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'TEST-TRANSACTION-1 상세 열기' })).toBeNull();

  fireEvent.click(last);
  expect(footer.getByText('3 / 3 페이지')).toBeTruthy();
  expect(next.disabled).toBe(true);
  expect(last.disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-65 상세 열기' })).toBeTruthy();
  fireEvent.click(first);
  expect(footer.getByText('1 / 3 페이지')).toBeTruthy();
  fireEvent.click(next);

  rerender(<BenchmarkLedger dataset={dataset} tableView={false} paginationHost={paginationHost} />);
  expect(footer.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-31 상세 열기' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }));
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-65 상세 열기' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();

  chooseDate('End');
  expect(footer.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('button', { name: 'TEST-TRANSACTION-61 상세 열기' })).toBeTruthy();

  chooseDate('Home');
  rerender(<BenchmarkLedger dataset={dataset} tableView paginationHost={paginationHost} />);
  expect(footer.getByText('1 / 3 페이지')).toBeTruthy();
  unmount();
  expect(footer.queryByRole('navigation')).toBeNull();
});
