import { deleteJson, getJson, postJson, putJson, type IsoDateTime } from './common'

// 룰 엔진 API (API.md §12). 룰은 이름표(ruleId, 화면 번호 code)이고 조건은 버전(versionId)이 갖는다.
// 쓰기 요청은 화면 전체를 다시 읽게 하는 알림을 보내지 않는다. 룰 화면이 필요한 것만 다시 읽는다.

export type RuleStatus = 'DRAFT' | 'SHADOW' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
export type RuleThen = 'ATTACH_EVIDENCE' | 'CREATE_ALERT'
export type RuleOperator = 'ALL' | 'ANY'

// ── 룰 정의 (rules.rule_versions.definition) ────────────────────────────
/** 세는 거래의 조건 하나. "이면" 꼴 항목(처음 거래하는 상대 등)은 cmp · value 가 없다. 값이 빈 칸이면 value 가 없다. */
export type FilterCondition = { field: string; cmp?: string; value?: number }
export type FilterGroup = { op: 'ANY'; items: FilterCondition[] }
export type FilterItem = FilterCondition | FilterGroup
/** 적중 조건 하나. */
export type WhereCondition = { metric: string; cmp?: string; value?: number }
export type WhereGroup = { op: RuleOperator; items: WhereItem[] }
export type WhereItem = WhereCondition | WhereGroup
export type RulePath = { minHops?: number; maxHops?: number; stepRatioMin?: number; stepRatioMax?: number }
export type RuleDefinition = {
  schema: 2
  template: string
  /** 방향을 고르는 템플릿(분할 입·출금, 같은 금액 반복)만 */
  direction?: 'IN' | 'OUT'
  /** 단건 고액거래는 기간이 없다 */
  windowMinutes?: number
  filter: { op: 'ALL'; items: FilterItem[] }
  /** 경로형(CYCLE, RANDOM)만 */
  path?: RulePath
  where: WhereGroup
  then: RuleThen
}

// ── 템플릿 카탈로그 ─────────────────────────────────────────────────────
/** 대상 계좌가 거래의 어느 쪽인가에 따라 갈리는 문구 */
export type SidedText = string | Partial<Record<'FROM' | 'TO' | 'CYCLE' | 'RANDOM', string>>
export type RuleTemplate = {
  key: string
  name: string
  group: 'PATTERN' | 'GENERAL'
  /** false 면 이후 제공 템플릿. 아래 값이 없다. */
  available: boolean
  note?: string
  oracle?: string
  pattern?: number | null
  evaluator?: 'AGGREGATE' | 'TWO_HOP' | 'PATH'
  shape?: string
  axis?: string
  subject?: 'ACCOUNT' | 'TX'
  subjectLabel?: string
  trigger?: string
  side?: 'FROM' | 'TO' | null
  directionSelectable?: boolean
  windowRequired?: boolean
  maxWindowMinutes?: number | null
  alert?: { allowed: boolean; maxWindowMinutes?: number }
  references?: string[]
  filterFields?: string[]
  requiredFilterFields?: string[]
  metrics?: string[]
  whereMin?: number
  defaults?: Omit<RuleDefinition, 'schema' | 'template'>
  performance?: { dataset: string; period: string; precision: number; recall: number; pickedTransactions: number; recallBase: string }
}
export type RuleItemSpec = {
  label: SidedText
  short?: SidedText
  kind: 'number' | 'flag'
  type?: 'int' | 'decimal'
  unit?: string
  comparators?: string[]
  min?: number
  max?: number
  step?: number
  anyGroup?: boolean
  description?: string
}
export type RulePathSpec = { label: SidedText; type: 'int' | 'decimal'; unit?: string; min?: number; max?: number; default?: number }
export type RuleCatalog = {
  schema: number
  templates: RuleTemplate[]
  filterFields: Record<string, RuleItemSpec>
  metrics: Record<string, RuleItemSpec>
  path: Record<'minHops' | 'maxHops' | 'stepRatioMin' | 'stepRatioMax', RulePathSpec>
  windows: number[]
  comparators: string[]
  directions: { key: 'IN' | 'OUT'; label: string }[]
  then: { key: RuleThen; label: string; enabled: boolean; note?: string }[]
  limits: { whereDepth: number; whereConditions: number; filterConditions: number; nameLength: number }
}

// ── 목록 · 상세 ─────────────────────────────────────────────────────────
export type RuleRow = {
  ruleId: number
  code: string
  name: string
  template: string
  templateName: string
  summary: string
  /** 작업 중 버전이 시험 운영 · 승인 대기면 그 상태, 아니면 운영 버전의 상태, 운영 버전이 없으면 작성 중 */
  status: Exclude<RuleStatus, 'RETIRED'>
  then: RuleThen
  versionNo: number
  versionId: number
  operatingVersionNo: number | null
  /** 운영 버전의 상태와 조건 요약. 운영 버전이 없으면 null */
  operatingStatus: 'ACTIVE' | 'PAUSED' | null
  operatingSummary: string | null
  workingVersionNo: number | null
  workingStatus: 'DRAFT' | 'SHADOW' | 'PENDING' | null
  owner: string
  changedAt: IsoDateTime | null
  // 일일 실행이 붙기 전까지는 값이 없다
  hitCount: number | null
  lastHitDate: string | null
  linkedAlertCount: number | null
  normalRate: number | null
  alertedHitCount: number | null
  skippedBusySubjects: number | null
  lastRunFailed: boolean | null
}
export type RuleList = { content: RuleRow[]; counts: Record<Exclude<RuleStatus, 'RETIRED'>, number> }

export type RuleVersionLine = {
  versionId: number
  versionNo: number
  status: RuleStatus
  summary: string
  author: string
  createdAt: IsoDateTime
  submittedAt: IsoDateTime | null
  decidedAt: IsoDateTime | null
  decidedBy: string | null
}
export type RuleVersion = RuleVersionLine & {
  revision: number
  definition: RuleDefinition
  digest: string
  sentence: string
  /** 작성 중이고 내가 쓴 버전 */
  editable: boolean
  /** 작성 중이고(작성자 또는 관리자) 시험 운영 · 승인 요청을 한 적이 없는 버전 */
  deletable: boolean
}
export type RuleEvent = { at: IsoDateTime; actor: string | null; action: string; comment: string; versionNo: number | null }
export type RuleDetail = {
  ruleId: number
  code: string
  name: string
  template: string
  templateName: string
  owner: string
  createdAt: IsoDateTime
  status: Exclude<RuleStatus, 'RETIRED'> | null
  operating: RuleVersion | null
  working: RuleVersion | null
  versions: RuleVersionLine[]
  events: RuleEvent[]
}

// ── 검증 ────────────────────────────────────────────────────────────────
export type RuleCheckItem = { key: 'FORMAT' | 'CONDITIONS' | 'DATA' | 'COST'; label: string; ok: boolean; message: string; errors: string[] }
export type RuleCheck = {
  items: RuleCheckItem[]
  warnings: string[]
  /** 형식을 통과했다. 초안으로 저장할 수 있다. */
  canSave: boolean
  /** 네 항목을 모두 통과했다. 백테스트 · 시험 운영 · 승인 요청을 할 수 있다. */
  canRun: boolean
  /** 형식을 통과하지 못하면 null */
  sentence: string | null
  summary: string | null
}
export type RuleCreated = { ruleId: number; code: string; versionId: number; revision: number }
export type RuleSaved = RuleCheck & { ruleId: number; code: string; name: string; versionId: number; versionNo: number; status: 'DRAFT'; revision: number; definition: RuleDefinition }

const silent = { silent: true }

export const fetchRuleCatalog = () => getJson<RuleCatalog>('/api/v1/rule-templates')
export const fetchRules = () => getJson<RuleList>('/api/v1/rules')
export const fetchRule = (ruleId: number) => getJson<RuleDetail>(`/api/v1/rules/${ruleId}`)
/** 저장 없이 검증한다. 문장과 한 줄 요약도 여기서 받는다. */
export const validateRule = (input: { template: string; definition: RuleDefinition; ruleId?: number }) =>
  postJson<RuleCheck>('/api/v1/rules/validate', input, silent)
/** 룰과 v1 초안을 만든다. 정의를 안 주면 템플릿 기본값으로 채운다. */
export const createRule = (input: { name: string; template: string; definition?: RuleDefinition }) =>
  postJson<RuleCreated>('/api/v1/rules', input, silent)
/** 초안 저장. revision 이 서버와 다르면 409(INVALID_TRANSITION). */
export const saveRuleDraft = (ruleId: number, versionId: number, input: { name: string; definition: RuleDefinition; revision: number }) =>
  putJson<RuleSaved>(`/api/v1/rules/${ruleId}/versions/${versionId}`, input, silent)
export const deleteRuleDraft = (ruleId: number, versionId: number) =>
  deleteJson(`/api/v1/rules/${ruleId}/versions/${versionId}`, silent)
