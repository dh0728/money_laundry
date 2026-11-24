import { deleteJson, getJson, postJson, putJson, type IsoDate, type IsoDateTime } from './common'

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
  /** 평가기가 있어 백테스트를 돌릴 수 있는 템플릿 키 */
  backtestTemplates?: string[]
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
  // 아래 숫자는 끝난 일일 실행, 끝난 분석의 적중만 센다
  /** 운영 적중(대상 × 날짜) 수 */
  hitCount: number | null
  /** 가장 최근 운영 적중의 거래 기준일 */
  lastHitDate: string | null
  /** 지금 시험 운영 중인 버전이 쌓은 적중 수. 그런 버전이 없으면 null */
  shadowHitCount?: number | null
  /** 운영 적중과 거래가 겹치는 Alert 수 */
  linkedAlertCount: number | null
  /** 그 Alert 가운데 사람이 종결한 것에서 정상 판정의 비율(%). 종결한 것이 없으면 null */
  normalRate: number | null
  alertedHitCount: number | null
  /** 가장 최근 일일 실행에서 바쁜 계좌라 평가하지 않은 대상 수, 그 실행이 실패했는지. 실행한 적이 없으면 null */
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
  /** 이 버전의 가장 최근 백테스트. currentDefinition 이 false 면 돌린 뒤에 조건을 고친 것이다 */
  backtest?: { backtestId: number; status: BacktestStatus; currentDefinition: boolean; finishedAt: IsoDateTime | null } | null
}
export type RuleEvent = {
  at: IsoDateTime; actor: string | null; action: string; comment: string; versionNo: number | null
  /** 작성자가 자기 버전을 승인했다 */
  selfApproved?: boolean
}
export type RuleCommandAction = 'START_SHADOW' | 'SUBMIT' | 'WITHDRAW' | 'APPROVE' | 'REJECT' | 'PAUSE' | 'RESUME'
/** 지금 상태에서 있는 명령. NEW_VERSION 은 운영 버전을 복사해 새 초안을 만드는 것이다(createRuleVersion) */
export type RuleCommand = {
  action: RuleCommandAction | 'NEW_VERSION'
  versionId: number
  revision: number
  /** 지금 로그인한 사람이 할 수 있는가. 못 하면 reason 에 이유가 있다 */
  enabled: boolean
  reason: string | null
  commentRequired: boolean
}
/** 일일 실행 한 번 = 분석 × 버전 */
export type RuleExecution = {
  versionNo: number
  mode: 'LIVE' | 'SHADOW'
  status: 'COMPLETED' | 'FAILED'
  analysisDate: IsoDate | null
  triggerCount: number | null
  hitCount: number | null
  skippedBusySubjects: number | null
  errorCode: 'TIMEOUT' | 'BUDGET' | 'INTERNAL' | 'INTERRUPTED' | null
  finishedAt: IsoDateTime | null
}
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
  commands?: RuleCommand[]
  versions: RuleVersionLine[]
  /** 최근 일일 실행 20건 */
  executions?: RuleExecution[]
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
/** 운영 버전을 복사해 새 초안을 만든다 */
export const createRuleVersion = (ruleId: number) =>
  postJson<{ ruleId: number; code: string; versionId: number; versionNo: number; revision: number }>(`/api/v1/rules/${ruleId}/versions`, {}, silent)
/** 상태 명령. 바뀐 룰 상세를 돌려준다 */
export const commandRule = (ruleId: number, input: {
  requestId?: string; action: RuleCommandAction; versionId: number; revision: number; comment?: string
}) => postJson<RuleDetail>(`/api/v1/rules/${ruleId}/commands`, input, silent)

export const deleteRuleDraft = (ruleId: number, versionId: number) =>
  deleteJson(`/api/v1/rules/${ruleId}/versions/${versionId}`, silent)

// ── 백테스트 ────────────────────────────────────────────────────────────
export type BacktestStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type BacktestKpis = {
  /** 적중 대상 수 */
  hits: number
  /** 비교 기준에 없다가 생긴 대상 수. 비교 기준이 없으면 null */
  added: number | null
  dropped: number | null
  /** 사람 판정이 붙은 대상 가운데 의심의 비율(%). 판정이 없으면 null */
  precision: number | null
  judged: number
  baseHits: number | null
  basePrecision: number | null
  baseJudged: number | null
}
export type BacktestSweepRow = { value: number; current: boolean; hits: number; txCount: number; alertOverlap: number; expectedNewAlerts: number }
export type BacktestCase = {
  subjectType: 'ACCOUNT' | 'TX'
  /** 가명 계좌 ID 앞 8자리 */
  subject: string
  /** HIT: 비교 기준 없음. ADDED: 새로 걸림. DROPPED: 빠짐. KEPT: 그대로 */
  state: 'HIT' | 'ADDED' | 'DROPPED' | 'KEPT'
  measured: Record<string, number>
  txCount: number
  alertId: number | null
  judgement: 'SUSPICIOUS' | 'NORMAL' | null
}
/** 백테스트의 머리. 실행 기록의 한 줄이기도 하다. */
export type BacktestHead = {
  backtestId: number
  status: BacktestStatus
  progress: number
  cancelRequested: boolean
  errorCode: 'TIMEOUT' | 'INTERNAL' | 'INTERRUPTED' | null
  ruleId: number
  code: string
  name: string
  template: string
  versionId: number
  versionNo: number
  summary: string
  /** false 면 백테스트를 돌린 뒤에 조건을 고쳤다 */
  currentDefinition: boolean
  baseline: { versionId: number; versionNo: number; summary: string } | null
  period: { from: IsoDate; to: IsoDate; days: number }
  requestedBy: string
  requestedAt: IsoDateTime
  startedAt: IsoDateTime | null
  finishedAt: IsoDateTime | null
  txCount?: number | null
}
/** 끝난(COMPLETED) 백테스트에만 오는 결과 */
export type BacktestResult = {
  kpis: BacktestKpis
  /** 검사한 거래 수 */
  txCount: number
  evidenceTxCount: number
  /** 검사한 거래 가운데 근거 거래의 비율(%) */
  evidenceShare: number | null
  hitDays: number
  alertOverlap: number
  /** 어느 Alert 와도 겹치지 않고 근거 거래가 2건 이상인 대상 수. 추정값이다 */
  expectedNewAlerts: number
  /** 근거 거래가 32건을 넘는 대상 수 */
  chunkedCount: number
  skippedBusySubjects: number
  busy: { maxTransactions: number; windowMinutes: number }
  sweep?: { metric: string; label: string; unit: string; rows: BacktestSweepRow[] }
  cases: BacktestCase[]
}
export type Backtest = BacktestHead & Partial<BacktestResult>

/** 백테스트를 접수한다. 비교 기준을 안 주면 그 룰의 운영 버전과 비교한다. */
export const requestBacktest = (input: { versionId: number; baselineVersionId?: number; from?: IsoDate; to?: IsoDate }) =>
  postJson<{ backtestId: number; status: BacktestStatus }>('/api/v1/rule-backtests', input, silent)
export const fetchBacktest = (backtestId: number) => getJson<Backtest>(`/api/v1/rule-backtests/${backtestId}`)
/** 한 룰의 백테스트 기록. 최근 것부터 20건 */
export const fetchBacktests = (ruleId: number) => getJson<BacktestHead[]>('/api/v1/rule-backtests', { ruleId })
export const cancelBacktest = (backtestId: number) => postJson<Backtest>(`/api/v1/rule-backtests/${backtestId}/cancel`, {}, silent)

// ---- 사건의 룰 적중 ----

/** 카드 한 장 = 사건 안의 Alert × 룰 버전 × 대상 계좌 */
export type RuleHitCard = {
  alertId: number
  ruleId: number
  code: string
  name: string
  template: string
  templateName: string
  pattern: number | null
  versionId: number
  versionNo: number
  /** 지금 그 버전의 상태. 중지했거나 물러난 버전이 운영 중일 때 만든 적중도 나온다 */
  versionStatus: RuleStatus
  summary: string
  subjectType: 'ACCOUNT' | 'TX'
  subjectLabel: string | null
  /** 가명 계좌 ID 앞 8자리 */
  subject: string
  /** 걸린 거래 기준일들 */
  hitDates: IsoDate[]
  windowMinutes: number | null
  /** 가장 최근 날의 측정값 */
  measured: Record<string, number | null>
  conditions: { metric: string; label: string; cmp: string | null; value: number | null; unit?: string | null; measured: number | null }[]
  roles: { role: string; accountId: string }[]
  /** 사건의 거래 가운데 이 적중의 근거 거래인 것 */
  matchedTxIds: number[]
  evidenceTxCount: number
}

/** Alert · Episode 의 현재 거래에 걸린 운영 룰 적중 */
export const fetchCaseRuleHits = (caseId: number) => getJson<RuleHitCard[]>(`/api/v1/review/cases/${caseId}/rule-hits`)
