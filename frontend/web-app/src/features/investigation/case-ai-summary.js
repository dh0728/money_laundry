import { useEffect, useState } from 'react';
import { fetchCaseAiSummary } from '@/api/aiSummary';

/**
 * Alert · Episode 개요의 Claude 요약을 읽는다(API.md §14). 키가 없거나 실패하면 'failed' 이고, 화면은 기존 규칙 문장을 쓴다.
 * @returns {{ status: 'loading' | 'ready' | 'failed', summary?: import('@/api/aiSummary').CaseAiSummary }}
 */
export function useCaseAiSummary(caseId) {
  const [state, setState] = useState({ caseId: undefined, status: 'loading' });
  useEffect(() => {
    if (caseId == null) return undefined;
    let current = true;
    fetchCaseAiSummary(caseId).then(summary => { if (current) setState({ caseId, status: 'ready', summary }); },
      () => { if (current) setState({ caseId, status: 'failed' }); });
    return () => { current = false; };
  }, [caseId]);
  // 다른 사건으로 옮기면 새로 읽을 때까지 앞 사건의 요약을 보여 주지 않는다
  return state.caseId === caseId ? state : { status: 'loading' };
}
