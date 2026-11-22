import { getJson, postJson } from '@/api/common';
import { caseCode } from './live-data.js';
import { sharedCaseEvidence } from './case-graph-scope';
import { previewCaseAssignee, setRequestPeople } from './preview-work-requests';

// 서비스 모드에서 업무 요청을 서버와 주고받는다. 요청 모양과 결과 모양은 프리뷰 저장 함수와 같다.
const path = '/api/v1/review/work-requests';
const statusLabels = { PENDING: '처리 전', IN_PROGRESS: '처리 중', CLOSED: '처리 완료' };
const statusKeys = { '처리 전': 'PENDING', '처리 중': 'IN_PROGRESS' };
const verdicts = { NORMAL: 'normal', SUSPICIOUS: 'abnormal' };
const failure = (error, fallback) => ({ ok: false, error: error?.problem?.detail ?? error?.problem?.title ?? fallback });
let requests;

function requestItem(item) {
  return {
    ...item, id: `request-${item.id}`, requestId: item.id,
    code: caseCode({ kind: item.caseKind, createdAt: item.caseCreatedAt, caseId: item.caseId }),
    reviewStatus: statusLabels[item.reviewStatus],
    before: item.before && {
      verdict: verdicts[item.before.outcome] ?? 'unjudged', status: statusLabels[item.before.reviewStatus],
      assignee: item.before.assignee, judgment: item.before.judgment, completedAt: item.before.completedAt,
    },
  };
}

export const liveWorkRequestsReady = () => Boolean(requests);
export const liveWorkRequests = () => requests ?? [];
export function resetLiveWorkRequests() {
  requests = undefined;
}

export async function loadLiveWorkRequests() {
  const result = await getJson(path);
  setRequestPeople(result.admin, result.staff);
  requests = result.requests.map(requestItem);
  return requests;
}

export function readLiveWorkRequests(actor, ids) {
  const unread = liveWorkRequests().filter(item => ids.includes(item.id) && item.unreadFor.includes(actor.username));
  if (!unread.length) return;
  requests = requests.map(item => unread.includes(item)
    ? { ...item, unreadFor: item.unreadFor.filter(username => username !== actor.username) } : item);
  void postJson(`${path}/read`, { ids: unread.map(item => item.requestId) }).catch(() => undefined);
}

export async function sendLiveWorkRequest({ cases, typeKey, code, recipient, reason, deadline, reviewStatus, relatedCodes }) {
  const row = cases.find(item => item.code === code);
  if (!row) return { ok: false, error: '대상 업무와 사유를 확인해 주세요.' };
  let related;
  if (typeKey === 'relationReview') {
    const codes = [...new Set(relatedCodes ?? [])].sort();
    related = codes.flatMap(candidateCode => {
      const candidate = cases.find(item => item.code === candidateCode && item.code !== code);
      const evidence = candidate && sharedCaseEvidence(row, candidate);
      return evidence && (evidence.transactions.length || evidence.accounts.length) ? [{
        code: candidate.code, verdict: candidate.verdict, status: candidate.status,
        assignee: previewCaseAssignee(candidate), ...evidence,
      }] : [];
    });
    if (!related.length || related.length !== codes.length) {
      return { ok: false, error: '연결 근거가 있는 비교 후보를 다시 선택해 주세요.' };
    }
  }
  try {
    await postJson(path, {
      type: typeKey, caseId: row.caseId, recipient, reason, deadline: deadline || null,
      reviewStatus: statusKeys[reviewStatus] ?? null, related,
    });
    return { ok: true };
  } catch (error) {
    return failure(error, '요청을 보내지 못했습니다.');
  }
}

export async function resolveLiveWorkRequest({ id, action, note, assignee, reviewStatus }) {
  const item = liveWorkRequests().find(entry => entry.id === id);
  if (!item) return { ok: false, error: '처리 대기 중인 받은 요청과 처리 내용을 확인해 주세요.' };
  try {
    await postJson(`${path}/${item.requestId}/resolve`, {
      action, note, assignee: assignee || null, reviewStatus: statusKeys[reviewStatus] ?? null,
    });
    return { ok: true };
  } catch (error) {
    return failure(error, '처리 결과를 보내지 못했습니다.');
  }
}
