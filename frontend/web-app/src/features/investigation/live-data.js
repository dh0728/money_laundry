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
let loadedAt;
// 서버가 받아들인 조사 시작·판정을 board 를 다시 받기 전에 받아 둔 응답에 먼저 반영한다.
// 그 동작 전에 출발한 board 응답이 늦게 와도 덮이지 않게 두었다가, 서버 응답에 반영된 것이 보이면 지운다.
const startedLocally = new Map(); // Alert caseId → 착수 시각
const judgedLocally = new Map(); // 'ALERT:caseId' · 'EPISODE:caseId' → 판정 응답
const caseKey = (kind, caseId) => `${kind}:${caseId}`;

function applyLocalChanges() {
  for (const [caseId, at] of startedLocally) {
    const item = board?.cases.find(entry => entry.kind === 'ALERT' && entry.caseId === caseId);
    if (!item) continue;
    if (item.reviewStartedAt) startedLocally.delete(caseId);
    else {
      item.reviewStartedAt = at;
      item.readAt ??= at;
    }
  }
  for (const [key, judgment] of judgedLocally) {
    const item = board?.cases.find(entry => caseKey(entry.kind, entry.caseId) === key);
    if (!item) continue;
    if (item.status === 'CLOSED') judgedLocally.delete(key);
    else Object.assign(item, { status: 'CLOSED', outcome: judgment.verdict, closedAt: judgment.at, judgment });
  }
}

export function markLiveReviewStarted(caseId) {
  startedLocally.set(caseId, new Date().toISOString());
  applyLocalChanges();
}

/** judgment 는 서버의 판정 응답 그대로다(board 의 judgment 와 같은 모양). */
export function markLiveJudged(row, judgment) {
  judgedLocally.set(caseKey(row.kind === 'Episode' ? 'EPISODE' : 'ALERT', row.caseId), judgment);
  applyLocalChanges();
}

/** 사건마다 화면에 보이는 상태 값을 한 줄로 묶는다. 주기적으로 다시 받은 board 와 비교해 바뀐 건수를 센다. */
export function liveCaseSignatures() {
  return new Map((board?.cases ?? []).map(item => [caseKey(item.kind, item.caseId), [
    item.status, item.outcome, item.assigneeId, item.readAt, item.reviewStartedAt, item.closedAt, item.episodeId,
    item.dueOn, item.members?.length, item.edits?.length, item.judgment?.id,
  ].join('|')]));
}

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
    score: Math.round((row.launderingScore ?? 0) * 100), suspicious: Boolean(row.suspicious),
    account: from.code, counterparty: to.code, owner: from.owner, serial: row.txId, txId: row.txId,
  };
}

function caseStatus(item) {
  if (item.status === 'CLOSED') return '처리 완료';
  // Episode는 직원이 Alert를 묶어 만든 사건이라 생성 시점부터 조사 중이다.
  return item.kind === 'EPISODE' || item.reviewStartedAt ? '처리 중' : '처리 전';
}

function caseRow(item, transactions, userId, codes) {
  const code = caseCode(item);
  const status = caseStatus(item);
  const transactionCodes = ids => ids.flatMap(id => transactions.get(id)?.code ?? []);
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
    // 열람 여부는 서버가 기억한다. 방금 연 사건은 다시 받아 오기 전에도 읽은 것으로 보인다.
    unread: assigned && status === '처리 전' && !item.readAt && !wasPreviewCaseRead(code),
    date: dateFromCode(code), createdAt, assignedAt: item.assignedAt, completedAt: item.closedAt ?? undefined,
    hour: Number(kstTimestamp(createdAt).slice(11, 13)) - 9, elapsed: item.ageDays,
    score: Math.round((item.summary.riskScore ?? 0) * 100),
    pattern: `${item.summary.primaryType}${share == null ? '' : ` ${Math.round(share * 100)}%`}`,
    related,
    relatedAccounts: new Set(related.flatMap(record => [record.account, record.counterparty])).size,
    amountByCurrency: Object.fromEntries(Object.entries(item.summary.amountsByCurrency ?? {})
      .map(([currency, amount]) => [currency, Number(amount)])),
    caseId: item.caseId, assigneeId: item.assigneeId, assigneeName: item.assigneeName,
    assignee: item.assigneeUsername, reviewDueOn: item.dueOn ?? undefined,
    ...(item.episodeId && { episodeCode: codes.get(item.episodeId) }),
    ...(item.kind === 'EPISODE' && { linkedAlertCodes: item.linkedAlertIds.map(id => codes.get(id)), linkedAlertCodesComplete: true }),
    ...(item.edits?.length && { membershipHistory: item.edits.map(edit => ({
      action: edit.action === 'MOVE' ? 'move' : 'remove', sourceCode: codes.get(edit.sourceAlertId),
      targetCode: edit.targetAlertId ? codes.get(edit.targetAlertId) : null,
      transactionCodes: transactionCodes(edit.txIds), reason: edit.reason, reviewer: edit.editor, at: edit.at,
    })) }),
    ...(item.judgment && { judgment: { ...item.judgment, code, verdict: verdicts[item.judgment.verdict] } }),
  };
}

function build() {
  const userId = currentPreviewUser()?.id;
  const transactions = new Map(board.transactions.map(row => [row.txId, transactionRow(row)]));
  const codes = new Map(board.cases.map(item => [item.caseId, caseCode(item)]));
  const cases = board.cases.map(item => caseRow(item, transactions, userId, codes));
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
// 새 Episode가 받을 ID. 서버가 미리 잡아 준 번호와 지금 업무일로 만든다.
export const liveNextEpisodeCode = () => board
  ? caseCode({ kind: 'EPISODE', createdAt: board.businessAt, caseId: board.nextEpisodeId }) : '';
export const liveSourceLoaded = () => Boolean(source);
export const liveCodes = prefix => prefix === 'T' ? [] : liveSource().cases
  .filter(row => row.code.startsWith(`${prefix}-`)).map(row => row.code);

export function loadLiveSource() {
  loading ??= getJson('/api/v1/review/board').then(next => {
    board = next;
    loadedAt = Date.now();
    applyLocalChanges();
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

/** 마지막으로 board 를 받은 시각(ms). 화면의 'N분 전 기준' 표시에 쓴다. */
export const liveLoadedAt = () => loadedAt;

export function resetLiveSource() {
  board = undefined;
  loadedAt = undefined;
  source = undefined;
  startedLocally.clear();
  judgedLocally.clear();
}
