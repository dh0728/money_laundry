import { getJson } from '@/api/common';
import { dateFromCode } from '../../components/query-controls.jsx';
import { wasPreviewCaseRead } from './case-read-state.js';
import { currentPreviewUser } from '../auth/preview-session-user.js';

// 서버의 사건·거래를 화면이 읽는 행 모양으로 바꾼다. 화면 코드는 이 모양만 안다.
const kstParts = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const kstTimestamp = iso => kstParts.format(new Date(iso)).replace(',', '');
const stamp = iso => kstTimestamp(iso).slice(2, 10).replaceAll('-', '');
const verdicts = { NORMAL: 'normal', SUSPICIOUS: 'abnormal' };
const empty = { transactions: [], cases: [], mine: [], businessAt: undefined };
let board;
let source;
let loading;

export const caseCode = item =>
  `${item.kind === 'EPISODE' ? 'E' : 'A'}-${stamp(item.createdAt)}-${String(item.caseId).padStart(6, '0')}`;
export const transactionCode = row => `T-${stamp(row.occurredAt)}-${String(row.txId).padStart(8, '0')}`;
export const serverIdFromCode = code => Number(code.split('-')[2]);

function transactionRow(row) {
  const code = transactionCode(row);
  const timestamp = kstTimestamp(row.occurredAt);
  const from = { owner: row.fromOwnerName, code: row.fromAccountId };
  const to = { owner: row.toOwnerName, code: row.toAccountId };
  return {
    code, timestamp, amount: Number(row.amountPaid), currency: row.paymentCurrency, method: row.paymentFormat,
    incoming: false, verdict: 'unjudged', status: '처리 전', from, to,
    date: dateFromCode(code), hour: Number(timestamp.slice(11, 13)) - 9,
    score: Math.round((row.launderingScore ?? 0) * 100),
    account: from.code, counterparty: to.code, owner: from.owner, serial: row.txId, txId: row.txId,
  };
}

function caseStatus(item) {
  if (item.status === 'CLOSED') return '처리 완료';
  // Episode는 직원이 Alert를 묶어 만든 사건이라 생성 시점부터 조사 중이다.
  return item.kind === 'EPISODE' || item.reviewStartedAt ? '처리 중' : '처리 전';
}

function caseRow(item, transactions, userId) {
  const code = caseCode(item);
  const status = caseStatus(item);
  const related = item.members.flatMap(member => {
    const record = transactions.get(member.txId);
    if (!record) return [];
    const verdict = verdicts[member.decision] ?? 'unjudged';
    return [{ ...record, verdict, status: member.state === 'PENDING' ? status : '처리 완료', reviewRole: member.reviewRole }];
  });
  const createdAt = item.createdAt;
  const share = item.summary.typeShare;
  const assigned = item.assigneeId === userId;
  return {
    code, kind: item.kind === 'EPISODE' ? 'Episode' : 'Alert',
    verdict: verdicts[item.outcome] ?? 'unjudged', status, assigned, open: item.status === 'OPEN',
    unread: assigned && status === '처리 전' && !wasPreviewCaseRead(code),
    date: dateFromCode(code), createdAt, completedAt: item.closedAt ?? undefined,
    hour: Number(kstTimestamp(createdAt).slice(11, 13)) - 9, elapsed: item.ageDays,
    score: Math.round((item.summary.riskScore ?? 0) * 100),
    pattern: `${item.summary.primaryType}${share == null ? '' : ` ${Math.round(share * 100)}%`}`,
    related,
    relatedAccounts: new Set(related.flatMap(record => [record.account, record.counterparty])).size,
    amountByCurrency: Object.fromEntries(Object.entries(item.summary.amountsByCurrency ?? {})
      .map(([currency, amount]) => [currency, Number(amount)])),
    caseId: item.caseId, revision: item.revision, assigneeName: item.assigneeName, episodeId: item.episodeId,
    ...(item.judgment && { judgment: { ...item.judgment, code, verdict: verdicts[item.judgment.verdict] } }),
  };
}

function build() {
  const userId = currentPreviewUser()?.id;
  const transactions = new Map(board.transactions.map(row => [row.txId, transactionRow(row)]));
  const cases = board.cases.map(item => caseRow(item, transactions, userId));
  for (const row of cases) for (const record of row.related) {
    const shared = transactions.get(record.txId);
    if (record.verdict !== 'unjudged') shared.verdict = record.verdict;
  }
  const alerts = cases.filter(row => row.kind === 'Alert');
  for (const row of cases) {
    if (row.kind !== 'Episode') continue;
    const codes = new Set(row.related.map(record => record.code));
    row.overlappingAlerts = alerts.filter(alert => alert.related.some(record => codes.has(record.code)));
    row.linkedAlerts = row.overlappingAlerts.length;
  }
  return { transactions: [...transactions.values()], cases, mine: cases.filter(row => row.assigned), businessAt: board.businessAt };
}

export const liveSource = () => source ?? empty;
export const liveSourceLoaded = () => Boolean(source);
export const liveCodes = prefix => prefix === 'T' ? [] : liveSource().cases
  .filter(row => row.code.startsWith(`${prefix}-`)).map(row => row.code);

export function loadLiveSource() {
  loading ??= getJson('/api/v1/review/board').then(next => {
    board = next;
    source = build();
    return source;
  }).finally(() => { loading = undefined; });
  return loading;
}

// 읽음 표시처럼 브라우저에만 있는 상태가 바뀌면 받은 응답으로 행을 다시 만든다.
export function rebuildLiveSource() {
  if (board) source = build();
  return liveSource();
}

export function resetLiveSource() {
  board = undefined;
  source = undefined;
}
