import { postJson } from '@/api/common';
import { fetchReviewCase, submitReviewCommand } from '@/api/liveReview';
import { serverIdFromCode } from './live-data.js';

// 서비스 모드에서 화면의 조사 동작을 서버 명령으로 보낸다. 결과 모양은 프리뷰 저장 함수와 같다.
const failure = (error, fallback) => ({ ok: false, error: error?.problem?.detail ?? error?.problem?.title ?? fallback });
const whole = row => ({ caseId: row.caseId, revision: row.revision, groupId: 0, txIds: [] });

export async function startLiveReview(row) {
  try {
    await submitReviewCommand({ action: 'REVIEW_START', selections: [whole(row)], comment: '조사 착수' });
    return { ok: true };
  } catch (error) {
    return failure(error, '처리 중 상태로 바꾸지 못했습니다.');
  }
}

export async function saveLiveJudgment(row, verdict, details, reasonCategory) {
  if (!row) return { ok: false, error: '담당자가 처리 중인 항목만 판정할 수 있습니다.' };
  try {
    const saved = await postJson(`/api/v1/review/cases/${row.caseId}/judgment`, {
      requestId: crypto.randomUUID(), revision: row.revision,
      verdict: verdict === 'normal' ? 'NORMAL' : 'SUSPICIOUS', reasonCategory,
      evidence: details.evidence, observations: details.observations, rationale: details.rationale,
    });
    return { ok: true, value: { ...saved, code: row.code, verdict } };
  } catch (error) {
    return failure(error, '판정을 저장하지 못했습니다.');
  }
}

export async function excludeLiveTransactions(row, transactionCodes, reason) {
  try {
    const txIds = transactionCodes.map(serverIdFromCode);
    const detail = await fetchReviewCase(row.caseId);
    const selections = detail.groups.flatMap(group => {
      const selected = group.members.filter(member => txIds.includes(member.txId)).map(member => member.txId);
      return selected.length ? [{ caseId: row.caseId, revision: detail.revision, groupId: group.groupId, txIds: selected }] : [];
    });
    if (selections.flatMap(selection => selection.txIds).length !== txIds.length) {
      return { ok: false, error: '선택한 거래가 이 Alert의 현재 구성에 없습니다. 다시 조회해 주세요.' };
    }
    await submitReviewCommand({ action: 'EXCLUDE', selections, comment: reason });
    return { ok: true, value: { transactionCodes } };
  } catch (error) {
    return failure(error, '변경을 적용하지 못했습니다. 선택한 항목을 확인해 주세요.');
  }
}
