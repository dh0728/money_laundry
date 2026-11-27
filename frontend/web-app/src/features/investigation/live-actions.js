import { postJson } from '@/api/common';
import { serverIdFromCode } from './live-data.js';

// 서비스 모드에서 화면의 조사 동작을 서버로 보낸다. 결과 모양은 프리뷰 저장 함수와 같다.
const failure = (error, fallback) => ({ ok: false, error: error?.problem?.detail ?? error?.problem?.title ?? fallback });
const review = path => `/api/v1/review${path}`;

export function markLiveRead(row) {
  return postJson(review(`/cases/${row.caseId}/read`), {}).catch(() => undefined);
}

export async function startLiveReview(row) {
  try {
    await postJson(review(`/cases/${row.caseId}/start`), {});
    return { ok: true };
  } catch (error) {
    return failure(error, '처리 중 상태로 바꾸지 못했습니다.');
  }
}

export async function saveLiveJudgment(row, verdict, details, reasonCategory) {
  if (!row) return { ok: false, error: '담당자가 처리 중인 항목만 판정할 수 있습니다.' };
  try {
    const saved = await postJson(review(`/cases/${row.caseId}/judgment`), {
      verdict: verdict === 'normal' ? 'NORMAL' : 'SUSPICIOUS', reasonCategory,
      evidence: details.evidence, observations: details.observations, rationale: details.rationale,
    });
    return { ok: true, value: { ...saved, code: row.code, verdict }, judgment: saved };
  } catch (error) {
    return failure(error, '판정을 저장하지 못했습니다.');
  }
}

// target이 없으면 제외, 있으면 그 Alert로 이동이다.
export async function editLiveTransactions(row, transactionCodes, target, reason) {
  try {
    await postJson(review(`/cases/${row.caseId}/transaction-edits`), {
      txIds: transactionCodes.map(serverIdFromCode), targetAlertId: target?.caseId ?? null, reason,
    });
    return { ok: true, value: { transactionCodes } };
  } catch (error) {
    return failure(error, '변경을 적용하지 못했습니다. 선택한 항목을 확인해 주세요.');
  }
}

// Episode 새로 만들기, 기존 Episode에 편입, 연결 해제. 성공하면 대상 Episode ID를 돌려준다.
export async function changeLiveEpisode({ alertCodes, episodeCode, expectedNewCode, reason, unlink = false }) {
  const body = { alertIds: alertCodes.map(serverIdFromCode), reason };
  try {
    if (unlink) await postJson(review(`/episodes/${serverIdFromCode(episodeCode)}/unlink`), body);
    else if (episodeCode) await postJson(review(`/episodes/${serverIdFromCode(episodeCode)}/alerts`), body);
    else await postJson(review('/episodes'), { ...body, episodeId: serverIdFromCode(expectedNewCode) });
    return { ok: true, code: episodeCode || expectedNewCode };
  } catch (error) {
    return failure(error, 'Episode 변경을 저장하지 못했습니다.');
  }
}
