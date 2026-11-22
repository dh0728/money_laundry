import { validWorkCode } from '../../app/preview-route.js';

const startedStorageKey = 'aml-live-layout-started-reviews';
const isCaseCode = code => validWorkCode(code) && !code.startsWith('T-');
const started = new Map();
const storageKey = 'aml-live-layout-case-judgments';
const verdicts = ['normal', 'abnormal'];
const reportCode = /^J-\d{6}-\d{6}$/;
export const judgmentTextLimit = 2000;
const judgments = new Map();

export const judgmentReasonLabels = Object.freeze({
  pattern: '패턴 일치',
  rule: '룰 적중',
  'normal-business': '정상 영업 거래',
  etc: '기타',
});

export function previewJudgmentReason({ reason, reasonCategory }) {
  const label = Object.hasOwn(judgmentReasonLabels, reasonCategory) ? judgmentReasonLabels[reasonCategory] : '';
  return label ? `${label} · ${reason}` : reason;
}

try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
  if (Array.isArray(saved)) {
    for (const record of saved) {
      if (record && typeof record.code === 'string' && reportCode.test(record.id) &&
          verdicts.includes(record.verdict) && typeof record.reason === 'string' &&
          record.reason.trim() && record.reason.length <= judgmentTextLimit &&
          typeof record.at === 'string' && Number.isFinite(Date.parse(record.at))) {
        judgments.set(record.code, record);
      }
    }
  }
} catch {
  // Continue with an empty session when storage isn't available.
}

try {
  const saved = JSON.parse(sessionStorage.getItem(startedStorageKey) ?? '[]');
  if (Array.isArray(saved)) {
    for (const entry of saved) {
      if (typeof entry === 'string' && isCaseCode(entry)) started.set(entry, '');
      if (Array.isArray(entry) && isCaseCode(entry[0]) && Number.isFinite(Date.parse(entry[1]))) started.set(...entry);
    }
  }
} catch {
  // Keep review progress available in memory when storage is unavailable.
}

function canReview(row, actor) {
  const canManage = actor?.source === 'fixture' && actor.role === 'ADMIN';
  return Boolean(row && isCaseCode(row.code) && (row.assigned || canManage) && row.open && row.verdict === 'unjudged');
}

export function canStartPreviewReview(row, actor) {
  return canReview(row, actor) && row.status === '처리 전' && !row.unread;
}

export function canJudgePreviewCase(row, actor) {
  return canReview(row, actor) && row.status === '처리 중';
}

export function startPreviewReview(row, actor) {
  if (!canStartPreviewReview(row, actor) || reviewStarted(row) || currentJudgment(row)) return false;
  started.set(row.code, new Date().toISOString());
  try {
    sessionStorage.setItem(startedStorageKey, JSON.stringify([...started]));
  } catch {
    // The current session can continue in memory.
  }
  return true;
}

function currentJudgment(row) {
  const judgment = judgments.get(row.code);
  return judgment && (!row.reviewStateAt || judgment.at > row.reviewStateAt) ? judgment : undefined;
}

function reviewStarted(row) {
  return started.has(row.code) && (!row.reviewStateAt || started.get(row.code) > row.reviewStateAt);
}

export function applyPreviewJudgment(row) {
  if (!row?.open || row.verdict !== 'unjudged') return row;
  const judgment = currentJudgment(row);
  if (judgment) return { ...row, status: '처리 완료', open: false, unread: false,
    verdict: judgment.verdict, completedAt: judgment.at, judgment };
  return reviewStarted(row) ? { ...row, status: '처리 중', unread: false } : row;
}

export function validJudgmentDetails(details) {
  return typeof details?.rationale === 'string' && details.rationale.trim().length > 0
    && details.rationale.trim().length <= judgmentTextLimit
    && ['evidence', 'observations'].every(field => details[field] == null
      || typeof details[field] === 'string' && details[field].trim().length > 0
        && details[field].trim().length <= judgmentTextLimit);
}

export function savePreviewJudgment(row, verdict, details, reasonCategory, reviewer, actor) {
  if (!canJudgePreviewCase(row, actor) || currentJudgment(row)) {
    return { ok: false, error: '담당자 또는 관리자가 처리 중인 항목을 판정할 수 있습니다.' };
  }
  if (!verdicts.includes(verdict)) return { ok: false, error: '정상 또는 이상을 선택하세요.' };
  if (!Object.hasOwn(judgmentReasonLabels, reasonCategory)) {
    return { ok: false, error: '판정 사유 유형을 선택하세요.' };
  }
  if (!validJudgmentDetails(details)) {
    return { ok: false, error: '판정 사유를 입력해 주세요.' };
  }
  const now = new Date();
  const date = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(2, 10).replaceAll('-', '');
  // Keep session IDs separate from the original numbered sample judgments.
  const sequence = Math.max(100000, ...Array.from(judgments.values(), record => Number(record.id.split('-').at(-1)))) + 1;
  const id = `J-${date}-${sequence}`;
  const record = {
    id, code: row.code, verdict, reasonCategory, at: now.toISOString(),
    evidence: details.evidence?.trim() ?? '', observations: details.observations?.trim() ?? '', reason: details.rationale.trim(),
    ...(typeof reviewer === 'string' && reviewer.trim() && { reviewer: reviewer.trim() }),
  };
  judgments.set(row.code, record);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...judgments.values()]));
  } catch {
    // The in-memory session remains available when storage isn't available.
  }
  return { ok: true, value: record };
}
