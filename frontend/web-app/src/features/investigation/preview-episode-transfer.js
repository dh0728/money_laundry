import { validWorkCode } from '../../app/preview-route.js';

import { applyPreviewJudgment } from './case-judgment-data.js';
import { liveNextEpisodeCode } from './live-data.js';
import { sharedCaseEvidence } from './case-graph-scope.js';

const storageKey = 'aml-radar-preview-episode-transfers';
const isAlert = code => validWorkCode(code) && code.startsWith('A-');
const isEpisode = code => validWorkCode(code) && code.startsWith('E-');
const failure = error => ({ ok: false, error });

function readTransfers() {
  try {
    const rows = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(rows) ? rows.filter(row => isEpisode(row?.code)
      && Array.isArray(row.alerts) && row.alerts.every(isAlert)) : [];
  } catch {
    return [];
  }
}

function storeTransfers(rows, code) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(rows));
    return { ok: true, code };
  } catch {
    return failure('이 탭에 Episode 변경을 저장할 수 없습니다.');
  }
}

export function canManagePreviewEpisodes(user) {
  // 서버 계정(api)의 변경은 layout.js의 saveEpisode가 서버로 보낸다.
  return (user?.source === 'fixture' || user?.source === 'api') && (user.role === 'ADMIN' || user.role === 'STAFF');
}

export function canTransferAlert(row) {
  return row.kind === 'Alert' && row.assigned && row.open && row.verdict === 'unjudged' && !row.episodeCode;
}

// Episode로 묶을 수 없는 이유. 묶을 수 있으면 빈 문자열이다.
export function transferBlockReason(row) {
  if (!row || canTransferAlert(row)) return '';
  if (row.kind !== 'Alert') return 'Alert 아님';
  if (row.episodeCode) return '기존 Episode 소속';
  if (!row.open || row.verdict !== 'unjudged') return '판정 완료';
  return '다른 담당자';
}

// 이유별 개수. 표시 순서는 판정 완료 → 다른 담당자 → 기존 Episode 소속이다.
export function transferBlockCounts(rows) {
  const counts = new Map([['판정 완료', 0], ['다른 담당자', 0], ['기존 Episode 소속', 0]]);
  for (const row of rows) {
    const reason = transferBlockReason(row);
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 0);
}

// 고른 업무끼리 겹치는 계좌·거래와, 다른 어느 업무와도 겹치지 않는 업무. 2건 미만이면 떨어진 업무를 따지지 않는다.
export function bundleConnection(rows) {
  const accountOwners = new Map();
  const transactionOwners = new Map();
  const add = (map, key, code) => {
    const owners = map.get(key) ?? new Set();
    owners.add(code);
    map.set(key, owners);
  };
  for (const row of rows) {
    for (const record of row.related ?? []) {
      add(transactionOwners, record.code, row.code);
      add(accountOwners, record.from.code, row.code);
      add(accountOwners, record.to.code, row.code);
    }
  }
  const shared = map => [...map].filter(([, owners]) => owners.size > 1);
  const sharedAccounts = shared(accountOwners);
  const sharedTransactions = shared(transactionOwners);
  const linked = new Set([...sharedAccounts, ...sharedTransactions].flatMap(([, owners]) => [...owners]));
  return {
    accounts: sharedAccounts.map(([code]) => code),
    transactions: sharedTransactions.map(([code]) => code),
    isolated: rows.length > 1 ? rows.map(row => row.code).filter(code => !linked.has(code)) : [],
  };
}

// Alert와 계좌·거래를 공유하면서 함께 묶을 수 있는(내 담당·열림·미판정·미편입) Alert. 공유 거래가 많은 순, 그다음 공유 계좌 순.
export function previewEpisodeCompanions(cases, row) {
  return cases.filter(item => item.code !== row.code && canTransferAlert(item))
    .map(item => ({ item, ...sharedCaseEvidence(row, item) }))
    .filter(({ transactions, accounts }) => transactions.length || accounts.length)
    .sort((a, b) => b.transactions.length - a.transactions.length || b.accounts.length - a.accounts.length
      || a.item.code.localeCompare(b.item.code));
}

export function previewEpisodeWillDissolve(episode, unlinkCount) {
  return episode.linkedAlertCodesComplete && episode.linkedAlertCodes.length - unlinkCount < 2;
}

export function nextPreviewEpisodeCode(cases, alertCode, rows = readTransfers()) {
  if (!isAlert(alertCode)) return '';
  // 서버 데이터를 볼 때는 서버가 미리 잡아 준 번호를 쓴다.
  const reserved = liveNextEpisodeCode();
  if (reserved) return reserved;
  const date = alertCode.split('-')[1];
  const used = new Set([...cases, ...rows].map(row => row.code));
  let sequence = 900000 + rows.length;
  while (used.has(`E-${date}-${sequence}`)) sequence++;
  return `E-${date}-${sequence}`;
}

export function changePreviewEpisode({ cases, alertCodes, episodeCode, expectedNewCode, reason, unlink = false, user }) {
  if (!canManagePreviewEpisodes(user)) return failure('검수 계정에서 사용할 수 있습니다.');
  const comment = reason.trim();
  if (!comment || comment.length > 4000 || !alertCodes.length || new Set(alertCodes).size !== alertCodes.length) {
    return failure('Alert와 변경 사유를 확인해 주세요.');
  }
  const rows = readTransfers();
  const episode = cases.find(row => row.code === episodeCode && row.kind === 'Episode' && row.open);
  const saved = rows.find(row => row.code === episodeCode);
  const members = episode?.linkedAlertCodes ?? saved?.alerts ?? [];
  if (unlink) {
    if (!episode?.assigned || alertCodes.some(code => !members.includes(code))) return failure('연결된 Alert를 다시 선택해 주세요.');
    const remaining = members.filter(code => !alertCodes.includes(code));
    const dissolved = previewEpisodeWillDissolve(episode, alertCodes.length);
    const transfer = { ...saved, code: episodeCode, alerts: dissolved ? [] : remaining, fullMembership: true, dissolved, comment };
    return storeTransfers([...rows.filter(row => row.code !== episodeCode), transfer], episodeCode);
  }
  if (alertCodes.some(code => !cases.some(row => row.code === code && canTransferAlert(row)))) {
    return failure('내 담당 진행 중 Alert를 다시 선택해 주세요.');
  }
  if (episodeCode && !episode) return failure('진행 중인 Episode를 선택해 주세요.');
  if (!episodeCode && alertCodes.length < 2) return failure('새 Episode는 Alert가 2건 이상 필요합니다.');
  const first = cases.find(row => row.code === alertCodes[0]);
  const code = episodeCode || nextPreviewEpisodeCode(cases, first.code, rows);
  if (!episodeCode && code !== expectedNewCode) {
    return failure('생성 예정 ID가 바뀌었습니다. 내용을 다시 확인해 주세요.');
  }
  const transfer = { code, alerts: [...members, ...alertCodes], fullMembership: true, created: saved?.created ?? !episodeCode,
    seed: saved?.seed ?? first.code, comment };
  return storeTransfers([...rows.filter(row => row.code !== code), transfer], code);
}

export function applyPreviewEpisodeTransfers(cases, summarize) {
  const overrides = readTransfers();
  const overridden = new Set(overrides.map(row => row.code));
  const seeds = cases.filter(row => row.kind === 'Episode' && row.linkedAlertCodesComplete && !overridden.has(row.code))
    .map(row => ({ code: row.code, alerts: row.linkedAlertCodes, fullMembership: true, comment: row.episodeComment }));
  const byCode = new Map(cases.map(row => [row.code, row]));
  const memberships = new Map();

  for (const record of [...seeds, ...overrides]) {
    const seed = byCode.get(record.seed);
    const parent = record.created ? seed : byCode.get(record.code);
    if (!parent) continue;
    const complete = !!record.created || parent.linkedAlertCodesComplete === true;
    if (record.dissolved && !complete) continue;
    const previous = complete ? [] : parent.related;
    // Older preview sessions stored only the Alerts added by the user.
    const alerts = !record.fullMembership && !record.created && parent.linkedAlertCodesComplete
      ? [...new Set([...parent.linkedAlertCodes, ...record.alerts])] : record.alerts;
    const linked = alerts.map(code => byCode.get(code)).filter(Boolean);
    const related = record.dissolved ? [] : [...new Map([...previous, ...linked.flatMap(row => row.related)]
      .map(transaction => [transaction.code, transaction])).values()];
    for (const alert of linked) memberships.set(alert.code, record.code);
    byCode.set(record.code, applyPreviewJudgment({ ...parent, ...summarize(related), code: record.code, kind: 'Episode',
      related, linkedAlertCodes: alerts, linkedAlertCodesComplete: complete, episodeComment: record.comment,
      status: record.dissolved ? '처리 완료' : record.created ? '처리 중' : parent.status,
      open: !record.dissolved && (record.created || parent.open),
      unread: record.created ? false : parent.unread,
      completedAt: record.created ? null : parent.completedAt,
    }));
  }
  return [...byCode.values()].map(row => memberships.has(row.code)
    ? { ...row, open: false, unread: false, status: '처리 완료', episodeCode: memberships.get(row.code) }
    : row);
}
