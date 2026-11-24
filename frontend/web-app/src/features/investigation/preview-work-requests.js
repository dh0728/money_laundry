import { alternatePreviewStaff, previewAdmin, previewStaff } from '../auth/preview-session-user';
import { sharedCaseEvidence } from './case-graph-scope';

export const requestStaff = [previewStaff, alternatePreviewStaff];
const users = [previewAdmin, ...requestStaff];
export const requestAdmin = () => users[0];
// 서버 연결에서는 서버의 관리자·분석가 목록으로 바꾼다.
export function setRequestPeople(admin, staff) {
  requestStaff.splice(0, requestStaff.length, ...staff);
  users.splice(0, users.length, admin, ...staff);
}
const storageKey = 'aml-preview-work-requests';
export const activeReviewStatuses = ['처리 전', '처리 중'];

export const workRequestTypes = {
  reopen: { role: 'STAFF', label: '종결 판정 재검토 요청', effect: 'reopen' },
  changeAssignee: { role: 'STAFF', label: '담당 변경 요청', effect: 'assign' },
  opinion: { role: 'STAFF', label: '판정 의견 요청' },
  relationReview: { role: 'STAFF', label: '연관 업무 검토 요청' },
  evidenceRequest: { role: 'STAFF', label: '근거·자료 지원 요청' },
  extension: { role: 'STAFF', label: '처리 기한 연장 요청', deadline: true, effect: 'deadline' },
  assign: { role: 'ADMIN', label: '업무 배정·재배정', effect: 'assign' },
  reviewAgain: { role: 'ADMIN', label: '종결 판정 재검토 지시', effect: 'reopen' },
  changeStatus: { role: 'ADMIN', label: '처리 상태 변경', effect: 'status' },
  investigate: { role: 'ADMIN', label: '추가 조사 지시' },
  evidence: { role: 'ADMIN', label: '근거 보완 지시' },
  deadline: { role: 'ADMIN', label: '처리 기한 지정·변경', deadline: true, effect: 'deadline' },
};

export function workRequestUserName(username) {
  return users.find(user => user.username === username)?.name ?? username;
}

export function previewCaseAssignee(row) {
  return row.assignee ?? (row.assigned ? previewStaff.username : alternatePreviewStaff.username);
}

export function requestCases(cases, type, actor) {
  if (!type || !['fixture', 'api'].includes(actor?.source) || type.role !== actor.role) return [];
  return cases.filter(row => {
    if (type === workRequestTypes.relationReview) return true;
    if (actor.role === 'STAFF' && previewCaseAssignee(row) !== actor.username) return false;
    if (type.effect === 'reopen') {
      return !row.open && !row.episodeCode && ['normal', 'abnormal'].includes(row.verdict);
    }
    if (type.effect === 'status') return row.open && !row.episodeCode && row.verdict === 'unjudged';
    return row.open;
  });
}

function readRequests() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(stored) ? stored.filter(item => typeof item?.id === 'string' &&
      Object.hasOwn(workRequestTypes, item.type) && Array.isArray(item.unreadFor) &&
      Number.isFinite(Date.parse(item.at))) : [];
  } catch {
    return [];
  }
}

function writeRequests(rows) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

export function previewWorkRequests(actor) {
  if (actor?.source !== 'fixture') return [];
  return readRequests().filter(item => [item.sender, item.recipient, item.assignee,
    item.assignee ? item.before?.assignee : undefined].includes(actor.username));
}

export function readPreviewWorkRequests(actor, ids) {
  const visible = new Set(previewWorkRequests(actor).map(item => item.id));
  writeRequests(readRequests().map(item => visible.has(item.id) && ids.includes(item.id)
    ? { ...item, unreadFor: item.unreadFor.filter(username => username !== actor.username) } : item));
}

function snapshot(row) {
  return {
    verdict: row.verdict, status: row.status, assignee: previewCaseAssignee(row),
    judgment: row.judgment, completedAt: row.completedAt,
  };
}

const bad = error => ({ ok: false, error });
const storageError = '이 탭에 요청을 저장할 수 없습니다.';
const validMessage = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 2000;

export function sendPreviewWorkRequest({ actor, cases, typeKey, code, recipient, reason, deadline, reviewStatus, relatedCodes }) {
  const type = workRequestTypes[typeKey];
  const row = requestCases(cases, type, actor).find(item => item.code === code);
  if (!row || !validMessage(reason)) return bad('대상 업무와 사유를 확인해 주세요.');
  const isRelation = typeKey === 'relationReview';
  if (isRelation && !Array.isArray(relatedCodes)) return bad('비교 후보를 선택해 주세요.');
  const related = isRelation ? [...new Set(relatedCodes)].sort().map(candidateCode => {
    const candidate = cases.find(item => item.code === candidateCode && item.code !== code);
    if (!candidate) return null;
    const evidence = sharedCaseEvidence(row, candidate);
    return evidence.transactions.length || evidence.accounts.length ? {
      code: candidate.code, verdict: candidate.verdict, status: candidate.status,
      assignee: previewCaseAssignee(candidate), ...evidence,
    } : null;
  }) : undefined;
  if (isRelation && (!related.length || related.some(candidate => !candidate))) {
    return bad('연결 근거가 있는 비교 후보를 다시 선택해 주세요.');
  }
  if (type.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline ?? '')) return bad('처리 기한을 선택해 주세요.');
  const admin = actor.role === 'ADMIN';
  const setsReviewStatus = admin && ['reopen', 'status'].includes(type.effect);
  if (setsReviewStatus && (!activeReviewStatuses.includes(reviewStatus) || reviewStatus === row.status)) {
    return bad('변경할 처리 상태를 선택해 주세요.');
  }
  if (!admin) recipient = previewAdmin.username;
  else if (!requestStaff.some(staff => staff.username === recipient)) return bad('받는 분석가를 선택해 주세요.');
  else if (type.effect !== 'assign' && recipient !== previewCaseAssignee(row)) return bad('현재 담당자에게 보내 주세요.');
  else if (type.effect === 'assign' && recipient === previewCaseAssignee(row)) return bad('새 담당자를 선택해 주세요.');
  const rows = readRequests();
  if (rows.some(item => item.state === 'pending' && item.type === typeKey && item.code === code && item.sender === actor.username &&
    (!isRelation || (item.related?.length === related.length && item.related.every((entry, index) => entry.code === related[index].code))))) {
    return bad('같은 유형의 요청이 이미 처리 대기 중입니다.');
  }
  const at = new Date().toISOString();
  const effect = admin ? type.effect : undefined;
  const item = { id: crypto.randomUUID(), type: typeKey, code, sender: actor.username, recipient,
    related,
    reason: reason.trim(), deadline: type.deadline ? deadline : undefined, sentAt: at, at,
    state: 'pending', unreadFor: effect === 'assign' ? [recipient, previewCaseAssignee(row)] : [recipient],
    appliedAt: effect ? at : undefined, reviewStatus: setsReviewStatus ? reviewStatus : undefined,
    assignee: effect === 'assign' ? recipient : undefined, before: effect ? snapshot(row) : undefined };
  return writeRequests([...rows, item]) ? { ok: true } : bad(storageError);
}

export function resolvePreviewWorkRequest({ actor, cases, id, action, note, assignee, reviewStatus = '처리 중' }) {
  const rows = readRequests();
  const item = rows.find(entry => entry.id === id);
  const cancel = action === 'cancelled' && item?.sender === actor?.username && !item?.appliedAt;
  if (actor?.source !== 'fixture' || !item || item.state !== 'pending' ||
      (!cancel && (item.recipient !== actor.username || !validMessage(note)))) {
    return bad('처리 대기 중인 받은 요청과 처리 내용을 확인해 주세요.');
  }
  const type = workRequestTypes[item.type];
  const admin = actor.role === 'ADMIN';
  if (!cancel && !(admin ? ['approved', 'declined'] : ['completed', 'needs-discussion']).includes(action)) {
    return bad('처리 방법을 확인해 주세요.');
  }
  const row = cases.find(entry => entry.code === item.code);
  const effect = admin && action === 'approved' ? type.effect : undefined;
  if (effect === 'reopen' && (!row || row.open || row.episodeCode || !['normal', 'abnormal'].includes(row.verdict))) {
    return bad('업무 상태가 바뀌었습니다. 최신 판정 상태를 확인해 주세요.');
  }
  if (effect === 'reopen' && !activeReviewStatuses.includes(reviewStatus)) return bad('변경할 처리 상태를 선택해 주세요.');
  if (effect === 'assign' && (!row?.open || !requestStaff.some(staff => staff.username === assignee) ||
      previewCaseAssignee(row) === assignee)) return bad('진행 중인 업무와 새 담당자를 확인해 주세요.');
  if (effect === 'deadline' && !row?.open) return bad('진행 중인 업무만 기한을 변경할 수 있습니다.');
  const at = new Date().toISOString();
  const unreadFor = new Set([...item.unreadFor.filter(username => username !== actor.username),
    cancel ? item.recipient : item.sender]);
  if (effect === 'assign') {
    unreadFor.add(previewCaseAssignee(row));
    unreadFor.add(assignee);
  }
  const next = { ...item, state: action, note: cancel ? '' : note.trim(), at, unreadFor: [...unreadFor],
    ...(effect && { appliedAt: at, before: snapshot(row) }),
    ...(effect === 'reopen' && { reviewStatus }),
    ...(effect === 'assign' && { assignee }) };
  return writeRequests(rows.map(row => row === item ? next : row)) ? { ok: true } : bad(storageError);
}

export function previewWorkRequestEffects() {
  const effects = new Map();
  for (const item of readRequests().filter(item => item.appliedAt)
    .sort((left, right) => left.appliedAt.localeCompare(right.appliedAt))) {
    const current = effects.get(item.code) ?? {};
    const { effect } = workRequestTypes[item.type];
    if (effect === 'reopen' || effect === 'status') {
      current.reviewStateAt = item.appliedAt;
      current.reviewStatus = item.reviewStatus ?? '처리 중';
    }
    if (effect === 'deadline') current.reviewDueOn = item.deadline;
    if (item.assignee) {
      current.assignee = item.assignee;
      current.assignedAt = item.appliedAt;
    }
    effects.set(item.code, current);
  }
  return effects;
}
