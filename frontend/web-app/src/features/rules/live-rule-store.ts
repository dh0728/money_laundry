import { ApiError } from '@/api/common'
import { fetchRuleCatalog, fetchRules, type RuleCatalog, type RuleList, type RuleRow, type RuleStatus } from '@/api/rules'

// 서비스 모드의 룰 화면이 같이 쓰는 것: 서버에서 읽은 룰 목록, 상태 이름, 오류 문구.
// 프리뷰(샘플 데이터) 모드의 룰 화면은 예전 샘플 그대로이고 이 파일을 쓰지 않는다.

export const liveRules = import.meta.env.VITE_API_MODE === 'live'

export const ruleStatusNames: Record<RuleStatus, string> = {
  DRAFT: '작성 중', SHADOW: '시험 운영', PENDING: '승인 대기', ACTIVE: '운영 중', PAUSED: '중지', RETIRED: '교체됨',
}
/** StatusTag 의 preset */
export const ruleStatusPresets: Record<RuleStatus, string> = {
  DRAFT: 'pending', SHADOW: 'inProgress', PENDING: 'caution', ACTIVE: 'done', PAUSED: 'cancelled', RETIRED: 'neutral',
}
/** 목록 머리에 상태별 개수를 놓는 순서 */
export const ruleStatusOrder: Exclude<RuleStatus, 'RETIRED'>[] = ['ACTIVE', 'SHADOW', 'PENDING', 'PAUSED', 'DRAFT']

export const ruleEventNames: Record<string, string> = {
  CREATED: '룰 만듦', EDITED: '조건 저장', DRAFT_DELETED: '초안 삭제', SHADOW_STARTED: '시험 운영 시작', SUBMITTED: '승인 요청',
  WITHDRAWN: '되돌림', APPROVED: '승인', REJECTED: '반려', PAUSED: '중지', RESUMED: '재개', BACKTEST_DONE: '백테스트 완료',
}

/** 서버가 준 오류 사유. 없으면 fallback. */
export const problemText = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.problem.detail ?? error.problem.title ?? fallback : fallback

/** 화면 번호 RULE-003 → 서버의 ruleId 3. 모양이 다르면 undefined. */
export function codeToRuleId(code: string | null | undefined): number | undefined {
  const digits = /^RULE-(\d+)$/.exec(code ?? '')?.[1]
  return digits ? Number(digits) : undefined
}

let rows: RuleRow[] = []
/** 마지막으로 읽은 룰 목록. 아직 읽지 않았으면 빈 목록이다. */
export const liveRuleRows = () => rows

/** 룰 목록을 다시 읽는다. 룰을 만들거나 고치거나 지운 뒤에 부른다. */
export async function refreshLiveRules(): Promise<RuleList> {
  const list = await fetchRules()
  rows = list.content
  return list
}

/** Alert · Episode 상세의 "현재 운영 중인 룰". 운영 버전이 운영 중(ACTIVE)인 룰과 그 버전의 조건 요약이다. */
export const liveActiveRules = () => rows.filter(row => row.operatingStatus === 'ACTIVE')
  .map(row => ({ id: row.code, version: row.operatingVersionNo, name: row.name, conditions: row.operatingSummary ?? '' }))

let catalog: Promise<RuleCatalog> | undefined
/** 템플릿 카탈로그. 한 번 읽으면 화면을 옮겨도 다시 읽지 않는다. 실패하면 다음에 다시 시도한다. */
export function loadRuleCatalog(): Promise<RuleCatalog> {
  catalog ??= fetchRuleCatalog().catch(error => { catalog = undefined; throw error })
  return catalog
}
