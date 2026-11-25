import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseCsvDownloadEntry } from '../components/query-controls';
import { LedgerWorkspace, CaseCards } from '../features/investigation/investigation-components';
import { PreviewCaseTable } from '../features/investigation/preview-case-list-table';
import { createSampleLedgerSource, createServerLedgerSource, pageOf } from '../features/investigation/ledger-source';
import { dashboardRecordCodes } from '../mocks/dashboard-record-codes';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const owners = Array.from({ length: 45 }, (_, index) => ({ id: `owner-uuid-${index + 1}`, name: `소유주#${String(index + 1).padStart(5, '0')}` }));
const accountsFor = owner => Array.from({ length: 3 }, (_, index) => ({ id: `${owner}-account-${index + 1}`, label: `계좌-${index + 1}`, ownerId: owner }));

function fakeSource() {
  const calls = { owners: [], accounts: [], transactions: [] };
  return {
    calls,
    kind: 'server',
    locate: () => undefined,
    async owners(params) {
      calls.owners.push(params);
      return pageOf(owners.filter(row => !params.query || row.name.includes(params.query)), params.page);
    },
    async accounts(params) {
      calls.accounts.push(params);
      return pageOf(params.owner ? accountsFor(params.owner) : [], params.page);
    },
    async transactions(params) {
      calls.transactions.push(params);
      const rows = Array.from({ length: params.account ? 25 : 0 }, (_, index) => ({
        id: `${params.account}-${index}`, code: `T-${index + 1}`, openable: false, timestamp: '2026-11-22 09:00', amount: 10,
        currency: 'USD', method: '이체', verdict: 'unjudged', incoming: false,
        from: { owner: 'a', code: 'x' }, to: { owner: 'b', code: 'y' }, alertIds: [index + 100], episodeIds: [],
      }));
      return pageOf(rows, params.page);
    },
  };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('원장 서버 목록', () => {
  it('보내는 조회 조건: size=20, page, query, 계좌 우선', async () => {
    const api = {
      fetchLedgerOwners: vi.fn(async () => ({ content: [{ id: 'o1', name: '김#00001' }], page: 0, size: 20, totalElements: 1, totalPages: 1 })),
      fetchLedgerAccounts: vi.fn(async () => ({ content: [{ id: '12345678-aaaa-bbbb-cccc-1234567890ab', ownerId: 'o1', bankId: 7 }], page: 0, size: 20, totalElements: 1, totalPages: 1 })),
      fetchLedgerTransactions: vi.fn(async () => ({ content: [{
        txId: 9, occurredAt: '2026-11-21T15:30:00Z', fromAccountId: 'acc-from-uuid-0001', toAccountId: 'acc', fromOwnerName: '김#00001',
        amountPaid: 5, paymentCurrency: 'USD', paymentFormat: 'Wire', judgement: 'SUSPICIOUS', alertIds: [3], episodeIds: [4],
      }], page: 1, size: 20, totalElements: 21, totalPages: 2 })),
    };
    const source = createServerLedgerSource(api);
    await source.owners({ query: ' 김 ', page: 2 });
    expect(api.fetchLedgerOwners).toHaveBeenLastCalledWith({ query: '김', page: 2, size: 20 }, undefined);
    const accounts = await source.accounts({ query: '', page: 0, owner: 'o1' });
    expect(api.fetchLedgerAccounts).toHaveBeenLastCalledWith({ query: undefined, page: 0, size: 20 }, 'o1', undefined);
    expect(accounts.content[0]).toMatchObject({ id: '12345678-aaaa-bbbb-cccc-1234567890ab', label: '12345678' });
    await source.transactions({ page: 1, owner: 'o1' });
    expect(api.fetchLedgerTransactions).toHaveBeenLastCalledWith({ query: undefined, page: 1, size: 20 }, undefined, 'o1', undefined);
    const transactions = await source.transactions({ page: 1, owner: 'o1', account: 'acc' });
    expect(api.fetchLedgerTransactions).toHaveBeenLastCalledWith({ query: undefined, page: 1, size: 20 }, 'acc', undefined, undefined);
    expect(transactions.content[0]).toMatchObject({
      code: 'T-9', id: '9', verdict: 'abnormal', incoming: true, timestamp: '2026-11-22 00:30', alertIds: [3], episodeIds: [4],
    });
  });

  it('Sample 원장도 같은 계약으로 검색·분할한다', async () => {
    const source = createSampleLedgerSource(dashboardRecordCodes({ prefix: 'T', digits: 8 }));
    const all = await source.transactions({ page: 1 });
    expect(all).toMatchObject({ page: 1, size: 20, totalElements: 864, totalPages: 44 });
    expect(all.content).toHaveLength(20);
    expect((await source.owners({ query: '012', page: 0 })).content.map(row => row.name)).toEqual(['소유주-012']);
    expect((await source.accounts({ owner: '소유주-002', page: 0 })).totalElements).toBe(12);
    expect((await source.owners({ query: '없는 이름', page: 0 })).totalPages).toBe(0);
  });
});

describe('원장 화면 더 보기', () => {
  it('세 목록을 따로 20건씩 이어 붙이고, 검색·상위 선택이 바뀌면 page=0부터 다시 조회한다', async () => {
    vi.useFakeTimers();
    const source = fakeSource();
    render(<LedgerWorkspace source={source} tableView />);
    await flush();
    expect(source.calls.owners.at(-1)).toMatchObject({ page: 0 });
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(screen.getByText(/소유주 20 \/ 45명/)).toBeTruthy();
    expect(screen.queryByText('소유주#00021')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '소유주 20건 더 보기' }));
    await flush();
    expect(source.calls.owners.at(-1)).toMatchObject({ page: 1 });
    expect(screen.getByText('소유주#00001')).toBeTruthy();
    expect(screen.getByText('소유주#00021')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '소유주 20건 더 보기' }));
    await flush();
    expect(screen.getByText('소유주#00045')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '소유주 20건 더 보기' })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: '소유주 검색' }), { target: { value: '#0001' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(source.calls.owners.at(-1)).toEqual({ query: '#0001', page: 0 });
    expect(screen.queryByText('소유주#00021')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '소유주#00010의 계좌' }));
    await flush();
    expect(source.calls.accounts.at(-1)).toMatchObject({ owner: 'owner-uuid-10', page: 0 });
    fireEvent.click(screen.getByRole('button', { name: '계좌-2의 거래' }));
    await flush();
    expect(source.calls.transactions.at(-1)).toMatchObject({ account: 'owner-uuid-10-account-2', owner: 'owner-uuid-10', page: 0 });
    fireEvent.click(screen.getByRole('button', { name: '계좌-2 거래 20건 더 보기' }));
    await flush();
    expect(source.calls.transactions.at(-1)).toMatchObject({ page: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'T-22' }));
    expect(screen.getByText('Alert 1건')).toBeTruthy();
    expect(screen.getByText('Episode 0건')).toBeTruthy();

    const searchTarget = screen.getByRole('combobox', { name: '원장 검색 대상' });
    fireEvent.keyDown(searchTarget, { key: 'Enter' });
    fireEvent.keyDown(searchTarget, { key: 'End' });
    fireEvent.keyDown(searchTarget, { key: 'Enter' });
    fireEvent.change(screen.getByRole('searchbox', { name: '거래 검색' }), { target: { value: 'T-22' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(source.calls.owners.at(-1)).toMatchObject({ query: '', page: 0 });
    expect(source.calls.transactions.at(-1)).toMatchObject({ query: 'T-22', account: 'owner-uuid-10-account-2', page: 0 });

    // 소유주를 바꾸면 계좌·거래 선택과 페이지가 초기화된다.
    fireEvent.click(screen.getByRole('button', { name: '소유주#00011의 계좌' }));
    await flush();
    expect(screen.getByText('거래를 선택해 연결 업무를 확인하세요.')).toBeTruthy();
    expect(source.calls.transactions.at(-1)).toMatchObject({ account: undefined, owner: 'owner-uuid-11', page: 0 });
    expect(screen.getByRole('searchbox', { name: '소유주 검색' })).toHaveValue('');
  });

  it('소유주를 열기 전에도 검색 메뉴에서 계좌와 거래를 골라 바로 찾는다', async () => {
    vi.useFakeTimers();
    const source = createSampleLedgerSource(dashboardRecordCodes({ prefix: 'T', digits: 8 }));
    render(<LedgerWorkspace source={source} tableView />);
    const target = screen.getByRole('combobox', { name: '원장 검색 대상' });
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(target).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option', { hidden: true }).map(option => option.textContent)).toEqual(['소유주', '계좌', '거래']);
    fireEvent.keyDown(target, { key: 'ArrowDown' });
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.change(screen.getByRole('searchbox', { name: '계좌 검색' }), { target: { value: 'ACC-1002' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('button', { name: 'ACC-1002의 거래' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ACC-1001의 거래' })).toBeNull();

    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyDown(target, { key: 'End' });
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.change(screen.getByRole('searchbox', { name: '거래 검색' }), { target: { value: 'T-261111-00000002' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('button', { name: 'T-261111-00000002' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'T-261111-00000001' })).toBeNull();
  });

  it('늦게 도착한 이전 검색 응답이 현재 목록을 덮지 않는다', async () => {
    vi.useFakeTimers();
    const pending = [];
    const source = { ...fakeSource(), owners: params => new Promise(resolve => pending.push({ params, resolve })) };
    render(<LedgerWorkspace source={source} tableView />);
    const search = screen.getByRole('searchbox', { name: '소유주 검색' });
    fireEvent.change(search, { target: { value: '느린' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    fireEvent.change(search, { target: { value: '빠른' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(pending.map(entry => entry.params.query)).toEqual(['', '느린', '빠른']);
    await act(async () => { pending[2].resolve(pageOf([{ id: 'fast', name: '빠른 결과' }])); });
    await act(async () => { pending[1].resolve(pageOf([{ id: 'slow', name: '느린 결과' }])); });
    await act(async () => { pending[0].resolve(pageOf(owners)); });
    expect(screen.getByText('빠른 결과')).toBeTruthy();
    expect(screen.queryByText('느린 결과')).toBeNull();
    expect(screen.queryByText('소유주#00001')).toBeNull();
  });
});

describe('Alert·Episode 목록 페이지 이동', () => {
  const rows = Array.from({ length: 45 }, (_, index) => ({
    code: `A-261111-${String(index + 1).padStart(6, '0')}`, kind: 'Alert', verdict: 'unjudged', pattern: 'Fan-out', score: index,
    assigned: true, status: '처리 전', elapsed: 1, open: true, related: [], amountByCurrency: {},
  }));

  it('표는 정렬한 전체 결과를 20건씩 나누고 정렬을 바꾸면 첫 페이지로 돌아간다', () => {
    const host = document.createElement('div');
    const onPageChange = vi.fn();
    render(<PreviewCaseTable title="Alert 목록" rows={rows} pageSize={20} paginationHost={host} onPageChange={onPageChange} />);
    const footer = within(host);
    expect(footer.getByText('1 / 3 페이지')).toBeTruthy();
    expect(footer.getByText('전체 45건')).toBeTruthy();
    expect(footer.getByRole('button', { name: '이전으로 가기' })).toBeDisabled();
    fireEvent.click(footer.getByRole('button', { name: '다음으로 가기' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('button', { name: 'A-261111-000021 상세 열기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'A-261111-000001 상세 열기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^모델 점수 · 오름차순 정렬/ }));
    expect(footer.getByText('1 / 3 페이지')).toBeTruthy();
    expect(onPageChange).toHaveBeenLastCalledWith(0);
  });

  it('1페이지·0건 목록도 비활성 이전·다음 버튼을 보여 준다', () => {
    const host = document.createElement('div');
    render(<PreviewCaseTable title="Episode 목록" rows={[]} pageSize={20} paginationHost={host} episode />);
    const footer = within(host);
    expect(footer.getByText('1 / 1 페이지')).toBeTruthy();
    expect(footer.getByRole('button', { name: '이전으로 가기' })).toBeDisabled();
    expect(footer.getByRole('button', { name: '다음으로 가기' })).toBeDisabled();
  });

  it('카드는 공통 푸터 없이 그룹의 더 보기로 항목을 이어 붙인다', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    const host = document.createElement('div');
    const caseRows = new Map(rows.map(row => [row.code, row]));
    const onPageChange = vi.fn();
    render(<CaseCards codes={rows.map(row => row.code)} label="Alert 목록" caseRows={caseRows} initialPage={2}
      paginationHost={host} onPageChange={onPageChange} />);
    expect(host).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'A-261111-000001 상세 열기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'A-261111-000009 상세 열기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '검토 대기 업무 더 보기' }));
    expect(screen.getByRole('button', { name: 'A-261111-000009 상세 열기' })).toBeTruthy();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('업무 내보내기는 날짜를 지연해서 읽고, 누락된 탐지일을 업무 코드에서 얻는다', () => {
    const readDate = vi.fn(() => new Date(2026, 10, 12));
    const explicit = { ...rows[0], get date() { return readDate(); } };
    const unknown = { ...rows[2], code: 'A-261132-000003' };
    const entry = caseCsvDownloadEntry('검토 대기', 'review-pending', [explicit, rows[1], unknown]);
    expect(entry.count).toBe(3);
    expect(entry.csv.filename).toBe('aml-review-pending.csv');
    expect(readDate).not.toHaveBeenCalled();
    expect(entry.csv.rows.map(row => row[1])).toEqual(['2026-11-12', '2026-11-11', '']);
    expect(readDate).toHaveBeenCalledTimes(1);
  });
});
