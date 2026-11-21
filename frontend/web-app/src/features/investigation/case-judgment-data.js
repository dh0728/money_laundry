import { validWorkCode } from '../../app/radar/preview-route.js';

const startedStorageKey = 'aml-live-layout-started-reviews';
const isCaseCode = code => validWorkCode(code) && !code.startsWith('T-');
const started = new Set();
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
  if (Array.isArray(saved)) saved.filter(isCaseCode).forEach(code => started.add(code));
} catch {
  // Keep review progress available in memory when storage is unavailable.
}

function canReview(row) {
  return Boolean(row && isCaseCode(row.code) && row.assigned && row.open && row.verdict === 'unjudged');
}

export function canStartPreviewReview(row) {
  return canReview(row) && row.status === '처리 전' && !row.unread;
}

export function canJudgePreviewCase(row) {
  return canReview(row) && row.status === '처리 중';
}

export function startPreviewReview(row) {
  if (!canStartPreviewReview(row) || started.has(row.code) || judgments.has(row.code)) return false;
  started.add(row.code);
  try {
    sessionStorage.setItem(startedStorageKey, JSON.stringify([...started]));
  } catch {
    // The current session can continue in memory.
  }
  return true;
}

export function applyPreviewJudgment(row) {
  const judgment = judgments.get(row.code);
  if (!canReview(row)) return row;
  if (judgment) return { ...row, status: '처리 완료', open: false, unread: false,
    verdict: judgment.verdict, completedAt: judgment.at, judgment };
  return started.has(row.code) ? { ...row, status: '처리 중', unread: false } : row;
}

export function validJudgmentDetails(details) {
  return ['evidence', 'observations', 'rationale'].every(field =>
    typeof details?.[field] === 'string' && details[field].trim().length > 0 && details[field].trim().length <= judgmentTextLimit);
}

export function savePreviewJudgment(row, verdict, details, reasonCategory, reviewer) {
  if (!canJudgePreviewCase(row) || judgments.has(row.code)) {
    return { ok: false, error: '담당자가 처리 중인 항목만 판정할 수 있습니다.' };
  }
  if (!verdicts.includes(verdict)) return { ok: false, error: '정상 또는 이상을 선택하세요.' };
  if (!Object.hasOwn(judgmentReasonLabels, reasonCategory)) {
    return { ok: false, error: '판정 사유 유형을 선택하세요.' };
  }
  if (!validJudgmentDetails(details)) {
    return { ok: false, error: '확인한 근거 자료, 관찰한 사실, 판정 사유를 각각 입력하세요.' };
  }
  const now = new Date();
  const date = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(2, 10).replaceAll('-', '');
  // Keep session IDs separate from the original numbered sample judgments.
  const id = `J-${date}-${100001 + judgments.size}`;
  const record = {
    id, code: row.code, verdict, reasonCategory, at: now.toISOString(),
    evidence: details.evidence.trim(), observations: details.observations.trim(), reason: details.rationale.trim(),
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
