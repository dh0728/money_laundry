import { applyPreviewJudgment } from './case-judgment-data.js';
import { validWorkCode } from '../../app/preview-route.js';

export const membershipReasonLimit = 2000;
const storageKey = 'aml-live-layout-alert-membership';
const alertCode = code => validWorkCode(code) && code.startsWith('A-');
const transactionCode = code => validWorkCode(code) && code.startsWith('T-');
const deny = error => ({ ok: false, error });

function readMembership() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
    const evidence = new Map((Array.isArray(value.evidence) ? value.evidence : []).filter(entry =>
      Array.isArray(entry) && alertCode(entry[0]) && Array.isArray(entry[1]) && entry[1].every(transactionCode))
      .map(([code, transactions]) => [code, [...new Set(transactions)]]));
    const history = (Array.isArray(value.history) ? value.history : []).filter(edit =>
      edit && alertCode(edit.sourceCode) && (edit.targetCode === null || alertCode(edit.targetCode)) &&
      ['move', 'remove'].includes(edit.action) && Array.isArray(edit.transactionCodes) &&
      edit.transactionCodes.every(transactionCode) && typeof edit.reason === 'string' &&
      typeof edit.reviewer === 'string' && Number.isFinite(Date.parse(edit.at)));
    return { evidence, history };
  } catch {
    return { evidence: new Map(), history: [] };
  }
}

export function previewAlertEditUnavailable(row, user) {
  if (!row || row.kind !== 'Alert') return 'Alert의 근거 거래를 선택해 주세요.';
  if (!row.open || row.status === '처리 완료' || row.verdict !== 'unjudged' || row.judgment) {
    return '처리 완료된 Alert의 근거 거래는 수정할 수 없습니다.';
  }
  // 서버 계정(api)은 담당 직원만 편집한다. 서버 규칙과 같다.
  const server = user?.source === 'api';
  if ((user?.source !== 'fixture' && !server) || !['ADMIN', 'STAFF'].includes(user.role)) {
    return '거래 편집은 프리뷰 계정에서 사용할 수 있습니다.';
  }
  if ((user.role === 'STAFF' || server) && !row.assigned) return '내가 담당하는 Alert의 근거 거래만 수정할 수 있습니다.';
  return '';
}

export function previewAlertMembershipTargets(cases, sourceCode, user) {
  // 서버는 Alert 사이 거래 이동을 받지 않는다(409). 서버 계정에는 제외만 제공한다.
  if (user?.source === 'api') return [];
  const source = cases.find(row => row.code === sourceCode);
  if (previewAlertEditUnavailable(source && applyPreviewJudgment(source), user)) return [];
  return cases.filter(row => row.code !== sourceCode && !previewAlertEditUnavailable(applyPreviewJudgment(row), user));
}

export function editPreviewAlertTransactions({ cases, sourceCode, targetCode = null, transactionCodes, reason, user }) {
  // 이 함수는 브라우저에만 저장한다. 서버 계정의 편집은 live-actions.js가 서버로 보낸다.
  if (user?.source !== 'fixture') return deny('거래 편집은 프리뷰 계정에서 사용할 수 있습니다.');
  const source = cases.find(row => row.code === sourceCode);
  const unavailable = previewAlertEditUnavailable(source && applyPreviewJudgment(source), user);
  if (unavailable) return deny(unavailable);
  const target = targetCode === null ? null : cases.find(row => row.code === targetCode);
  if (targetCode !== null && (targetCode === sourceCode || previewAlertEditUnavailable(target && applyPreviewJudgment(target), user))) {
    return deny('거래를 옮길 수 있는 다른 Alert를 선택해 주세요.');
  }
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (!note || note.length > membershipReasonLimit) {
    return deny('변경 사유를 1~2,000자로 입력해 주세요.');
  }
  if (!Array.isArray(transactionCodes) || !transactionCodes.length || !transactionCodes.every(transactionCode)) {
    return deny('편집할 거래를 하나 이상 선택해 주세요.');
  }
  const { evidence, history } = readMembership();
  const currentCodes = row => evidence.get(row.code) ?? row.related.map(transfer => transfer.code);
  const selected = new Set(transactionCodes);
  const previous = currentCodes(source);
  const sourceCodes = new Set(previous);
  if ([...selected].some(code => !sourceCodes.has(code))) {
    return deny('선택한 거래가 현재 Alert에 모두 연결되어 있는지 확인해 주세요.');
  }

  evidence.set(source.code, previous.filter(code => !selected.has(code)));
  if (target) evidence.set(target.code, [...new Set([...currentCodes(target), ...selected])]);
  const edit = { action: target ? 'move' : 'remove', sourceCode, targetCode, transactionCodes: [...selected],
    reason: note, reviewer: user.name, at: new Date().toISOString() };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ evidence: [...evidence], history: [...history, edit] }));
  } catch {
    return deny('이 브라우저 탭에 거래 연결 변경을 저장할 수 없습니다.');
  }
  return { ok: true, value: edit };
}

export function applyPreviewAlertMembership(cases, transactions, summarize) {
  const { evidence, history } = readMembership();
  return cases.map(row => {
    const override = evidence.get(row.code);
    if (row.kind !== 'Alert' || !override) return row;
    const related = override.map(code => transactions.get(code));
    if (related.some(record => !record)) return row;
    return { ...row, related, ...summarize(related), membershipHistory: history.filter(edit =>
      edit.sourceCode === row.code || edit.targetCode === row.code) };
  });
}
