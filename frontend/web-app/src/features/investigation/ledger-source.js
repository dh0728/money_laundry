import { useEffect, useRef, useState } from 'react';
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions } from '../../api/liveLedger';
import { ACCOUNTS_PER_OWNER, OWNER_COUNT, accountCode, ownerName, sampleTransactions } from '../../mocks/transaction-fixtures';

export const LEDGER_PAGE_SIZE = 20;

const verdictFromJudgement = { SUSPICIOUS: 'abnormal', NORMAL: 'normal', UNANALYZED: 'unjudged' };
const kstTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** 서버 가명 UUID는 화면에 앞 8자리만 보이고, 요청에는 원래 ID를 그대로 사용한다. */
export const shortId = id => typeof id === 'string' && id.length > 12 ? id.slice(0, 8) : String(id ?? '');

export function pageOf(rows, page = 0, size = LEDGER_PAGE_SIZE) {
  const totalElements = rows.length;
  return {
    content: rows.slice(page * size, (page + 1) * size),
    page, size, totalElements, totalPages: Math.ceil(totalElements / size),
  };
}

const matches = (query, ...values) => {
  const needle = query?.trim().toLocaleLowerCase('ko-KR');
  return !needle || values.some(value => String(value ?? '').toLocaleLowerCase('ko-KR').includes(needle));
};

/** Sample 원장: 소유주 12명 × 계좌 12개 × 거래 6건을 서버와 같은 목록 계약으로 나눈다. */
export function createSampleLedgerSource(codes) {
  const owners = Array.from({ length: OWNER_COUNT }, (_, index) => ({ id: ownerName(index), name: ownerName(index), index }));
  const accounts = owners.flatMap(owner => Array.from({ length: ACCOUNTS_PER_OWNER }, (_, index) => ({
    id: accountCode(owner.index, index), label: accountCode(owner.index, index), ownerId: owner.id, ownerName: owner.name,
    ownerIndex: owner.index, index,
  })));
  const transactionsOf = list => list.flatMap(account => sampleTransactions(codes, account.ownerIndex, account.index)
    .map(record => ({ ...record, id: record.code, openable: true })));
  return {
    kind: 'sample',
    async owners({ query, page }) {
      return pageOf(owners.filter(owner => matches(query, owner.name)), page);
    },
    async accounts({ query, page, owner }) {
      return pageOf(accounts.filter(account => (!owner || account.ownerId === owner)
        && matches(query, account.id, account.ownerName)), page);
    },
    async transactions({ query, page, owner, account }) {
      const scope = account ? accounts.filter(item => item.id === account)
        : owner ? accounts.filter(item => item.ownerId === owner) : accounts;
      return pageOf(transactionsOf(scope).filter(record => matches(query, record.code,
        record.from.code, record.to.code, record.from.owner, record.to.owner, record.method)), page);
    },
    /** 딥링크한 Sample 거래가 보이도록 소유주·계좌·거래 선택과 각 페이지를 찾는다. */
    locate(code) {
      for (const account of accounts) {
        const index = sampleTransactions(codes, account.ownerIndex, account.index).findIndex(record => record.code === code);
        if (index < 0) continue;
        const owner = owners[account.ownerIndex];
        const record = sampleTransactions(codes, account.ownerIndex, account.index)[index];
        const transaction = { ...record, id: record.code, openable: true };
        return {
          owner, account, transaction,
          ownerPage: Math.floor(owner.index / LEDGER_PAGE_SIZE),
          accountPage: Math.floor(account.index / LEDGER_PAGE_SIZE),
          transactionPage: Math.floor(index / LEDGER_PAGE_SIZE),
        };
      }
      return undefined;
    },
  };
}

export function serverTransactionRecord(row, account) {
  const verdict = verdictFromJudgement[row.judgement] ?? 'unjudged';
  const incoming = Boolean(account) && row.toAccountId === account && row.fromAccountId !== account;
  const time = new Date(row.occurredAt);
  return {
    id: String(row.txId),
    code: `T-${row.txId}`,
    openable: false,
    timestamp: Number.isFinite(time.getTime()) ? kstTime.format(time) : String(row.occurredAt ?? ''),
    amount: row.amountPaid,
    currency: row.paymentCurrency,
    method: row.paymentFormat,
    verdict,
    incoming,
    from: { owner: row.fromOwnerName ?? '소유주 미상', code: shortId(row.fromAccountId), id: row.fromAccountId },
    to: { owner: row.toOwnerName ?? '소유주 미상', code: shortId(row.toAccountId), id: row.toAccountId },
    alertIds: row.alertIds ?? [],
    episodeIds: row.episodeIds ?? [],
  };
}

/** API.md §7.1·§9.8 원장 조회. page는 0부터, size는 20으로 고정한다. */
export function createServerLedgerSource(api = { fetchLedgerOwners, fetchLedgerAccounts, fetchLedgerTransactions }) {
  const filters = (query, page) => ({ query: query?.trim() || undefined, page, size: LEDGER_PAGE_SIZE });
  return {
    kind: 'server',
    async owners({ query, page }, active) {
      const result = await api.fetchLedgerOwners(filters(query, page), active);
      return { ...result, content: result.content.map(row => ({ id: row.id, name: row.name ?? '소유주 미상' })) };
    },
    async accounts({ query, page, owner }, active) {
      const result = await api.fetchLedgerAccounts(filters(query, page), owner, active);
      return { ...result, content: result.content.map(row => ({
        id: row.id, label: shortId(row.id), ownerId: row.ownerId, ownerName: row.ownerName ?? '소유주 미상', bankId: row.bankId,
      })) };
    },
    async transactions({ query, page, owner, account }, active) {
      // 계좌를 고르면 계좌 조건을 우선하고, 계좌가 없을 때만 소유주 조건을 보낸다.
      const result = await api.fetchLedgerTransactions(filters(query, page), account, account ? undefined : owner, active);
      return { ...result, content: result.content.map(row => serverTransactionRecord(row, account)) };
    },
    locate: () => undefined,
  };
}

/**
 * 한 목록을 20건씩 이어 붙여 보여 준다. 조건(key)이 바뀌면 처음부터 다시 조회하고,
 * 이전 조건·이전 요청의 응답은 버린다(active=false). loadMore는 다음 page를 요청한다.
 */
export function useLedgerList(load, key) {
  const [state, setState] = useState({ key, pages: [], status: 'loading' });
  const [request, setRequest] = useState({ key, page: 0, attempt: 0 });
  const current = request.key === key ? request : { key, page: 0, attempt: 0 };
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => {
    let active = true;
    const { page } = current;
    setState(previous => previous.key === key && page > 0
      ? { ...previous, pages: previous.pages.slice(0, page), status: 'loading-more' }
      : { key, pages: [], status: 'loading' });
    loadRef.current(page, () => active).then(
      data => {
        if (active) setState(previous => ({ key, status: 'success',
          pages: [...(previous.key === key ? previous.pages.slice(0, page) : []), data] }));
      },
      error => {
        if (!active || error?.name === 'AbortError') return;
        setState(previous => ({ ...(previous.key === key ? previous : { key, pages: [] }), status: 'error',
          message: error?.problem?.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : '목록을 불러오지 못했습니다.' }));
      },
    );
    return () => { active = false; };
    // current는 key·page·attempt로만 결정된다.
  }, [key, current.page, current.attempt]);
  const own = state.key === key ? state : { pages: [], status: 'loading' };
  const last = own.pages.at(-1);
  return {
    status: own.status,
    message: own.message,
    items: own.pages.flatMap(page => page.content),
    total: last?.totalElements ?? 0,
    loaded: own.pages.length,
    hasMore: Boolean(last) && own.pages.length < last.totalPages,
    loadMore: () => setRequest({ key, page: own.pages.length, attempt: 0 }),
    retry: () => setRequest({ ...current, attempt: current.attempt + 1 }),
  };
}

export function useDebouncedValue(value, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return undefined;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}
