import { ApiError } from '@/api/common'
import type { Backtest, BacktestHead, RuleCatalog, RuleCheck, RuleDefinition, RuleDetail, RuleHitCard, RuleList } from '@/api/rules'
import { currentPreviewUser } from '@/features/auth/preview-session-user'
import { definitionFromTemplate, templateOf } from '@/features/rules/rule-definition'
import { ruleSampleData, type RuleSampleViewer } from './ruleSampleData'
import { previewRuleCheck } from './ruleSamplePreview'

// 서버 없이 실행할 때(VITE_API_MODE 가 live 가 아닐 때) 룰 API 대신 답한다. @/api/rules 가 부른다.
// 조회는 ruleSampleData(실제 서버 코드로 뜬 응답)를 그대로 돌려준다. 보기만 하는 샘플이라
// 만들기 · 저장 · 삭제 · 상태 명령 · 복제 · 백테스트 실행은 받지 않고 아래 문구로 거절한다.

export const sampleReadOnlyNote = '샘플 데이터입니다. 서버에 연결하지 않아 저장 · 실행되지 않습니다.'

const problem = (status: number, code: string, detail: string) => new ApiError({ type: 'about:blank', title: detail, status, code, detail })
const notFound = (what: string) => problem(404, 'NOT_FOUND', `${what}을(를) 찾을 수 없습니다.`)
/** 쓰기 요청은 모두 이것으로 끝난다. */
export const refuse = (): Promise<never> => Promise.reject(problem(403, 'SAMPLE_READ_ONLY', sampleReadOnlyNote))

/** 응답을 고쳐 써도 샘플이 바뀌지 않게 복사해서 준다. */
const copy = <T>(value: T): T => structuredClone(value)

/** 지금 로그인한 샘플 사용자. 상세의 명령(할 수 있는가 · 못 하는 이유)이 사람마다 다르다. */
function viewer(): RuleSampleViewer {
  const user = currentPreviewUser() as { role?: string; username?: string } | null
  return user?.role === 'ADMIN' ? 'admin' : user?.username === 'demo-staff-2' ? 'staff2' : 'staff'
}

/** 키 순서를 맞춰 늘어놓은 JSON. 값이 빈 칸(undefined)인 키는 빠진다. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const catalog = async (): Promise<RuleCatalog> => copy(ruleSampleData.catalog)
export const rules = async (): Promise<RuleList> => copy(ruleSampleData.rules)
export async function rule(ruleId: number): Promise<RuleDetail> {
  const found = ruleSampleData.details[viewer()][String(ruleId)]
  if (!found) throw notFound('룰')
  return copy(found)
}
/** 떠 둔 결과는 그대로 읽고, 편집한 정의는 저장 없이 화면 검토만 한다. */
export async function validate({ template: key, definition }: { template: string; definition: RuleDefinition }): Promise<RuleCheck> {
  const found = key === definition.template ? ruleSampleData.checks[canonical(definition)] : undefined
  if (found) return copy(found)

  const { catalog, checks } = ruleSampleData
  const template = templateOf(catalog, key)
  const baseline = template?.defaults ? checks[canonical(definitionFromTemplate(template))] : undefined
  const data = baseline?.items.find(item => item.key === 'DATA')?.message.match(/^원장 (\d+)일치/)?.[1]
  return previewRuleCheck(catalog, key, definition, data ? `샘플 원장 ${data}일치 기준입니다.` : '샘플 원장 기준입니다.')
}
export const backtests = async (ruleId: number): Promise<BacktestHead[]> => copy(ruleSampleData.backtestLists[String(ruleId)] ?? [])
export async function backtest(backtestId: number): Promise<Backtest> {
  const found = ruleSampleData.backtests[String(backtestId)]
  if (!found) throw notFound('백테스트')
  return copy(found)
}
/** 샘플 사건의 거래는 룰 평가를 돌린 원장의 거래가 아니라서 걸린 룰이 없다. */
export const caseRuleHits = async (): Promise<RuleHitCard[]> => []
