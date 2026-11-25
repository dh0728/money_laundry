import { typeDisplay } from '@/api/codes'
import type { LedgerTransaction, RuleInput, RuleRecord, RuleStatus } from '../workspace-store'
import { downloadCsv } from './report-io'

export const ruleStatusLabels: Record<RuleStatus, string> = { DRAFT: '초안', PENDING_APPROVAL: '승인 대기', TESTING: '테스트 중', ACTIVE: '운영 중', STOPPED: '중지', REJECTED: '반려' }
/** 룰 입력·사유 길이와 룰 ID 형식. 화면 검사, 샘플 저장, 나중의 서버 계약이 같은 값을 쓴다. */
export const RULE_LIMITS = Object.freeze({ name: 80, description: 1000, windowHours: 720, reason: 1000 })
export const RULE_ID_PATTERN = /^RULE-\d{3,}$/
export const isRuleId = (value: unknown): value is string => typeof value === 'string' && RULE_ID_PATTERN.test(value)
export const ruleReasonProblem = (reason: string) => !reason.trim() || reason.trim().length > RULE_LIMITS.reason
  ? `사유를 1~${RULE_LIMITS.reason.toLocaleString('ko-KR')}자로 입력해 주세요.` : ''

export type RuleTransitionAction = 'requestReview' | 'approve' | 'activate' | 'stop' | 'reject' | 'retest' | 'reopen'
export type RuleAction = RuleTransitionAction | 'edit' | 'delete' | 'archive' | 'duplicate' | 'backtest'
export type RuleActor = { name: string; role: string } | null | undefined
type ActionRule = Pick<RuleRecord, 'status' | 'author'>

/** 룰 상태 변경의 유일한 기준표. 허용 전이(ruleTransitions)와 버튼 활성 조건이 모두 여기서 나온다. */
export const ruleTransitionActions: Record<RuleTransitionAction, { from: RuleStatus[]; to: RuleStatus; label: string; verb: string }> = {
  requestReview: { from: ['DRAFT'], to: 'PENDING_APPROVAL', label: '승인 요청', verb: '승인을 요청할' },
  approve: { from: ['PENDING_APPROVAL'], to: 'TESTING', label: '승인', verb: '승인할' },
  activate: { from: ['TESTING'], to: 'ACTIVE', label: '운영 시작', verb: '운영을 시작할' },
  stop: { from: ['TESTING', 'ACTIVE'], to: 'STOPPED', label: '중지', verb: '중지할' },
  reject: { from: ['PENDING_APPROVAL', 'TESTING'], to: 'REJECTED', label: '반려', verb: '반려할' },
  retest: { from: ['STOPPED'], to: 'TESTING', label: '재테스트', verb: '다시 테스트할' },
  reopen: { from: ['REJECTED'], to: 'DRAFT', label: '초안으로 되돌리기', verb: '초안으로 되돌릴' },
}
export const ruleTransitions = Object.fromEntries((Object.keys(ruleStatusLabels) as RuleStatus[]).map(status => [status,
  Object.values(ruleTransitionActions).filter(action => action.from.includes(status)).map(action => action.to)])) as Record<RuleStatus, RuleStatus[]>

/** 초안·반려 룰은 작성자와 관리자, 그 밖의 상태(승인 대기·테스트 중·운영 중·중지)는 관리자만 다룬다. */
const authorStatuses: RuleStatus[] = ['DRAFT', 'REJECTED']
const editableStatuses: RuleStatus[] = ['DRAFT', 'REJECTED', 'STOPPED']
const statusList = (statuses: RuleStatus[]) => statuses.map(status => ruleStatusLabels[status]).join('·')

function permissionProblem(rule: ActionRule, user: NonNullable<RuleActor>, verb: string) {
  if (user.role === 'ADMIN') return ''
  if (!authorStatuses.includes(rule.status)) return `관리자만 ${verb} 수 있어요.`
  return rule.author === user.name ? '' : `초안·반려 상태에서는 작성자나 관리자만 ${verb} 수 있어요.`
}

/** 이 사람이 지금 이 룰에 할 수 있는 동작과, 못 하는 동작의 이유. 나중에는 서버가 allowedActions를 계산해 준다. */
export function ruleActionState(rule: ActionRule, user: RuleActor) {
  const reasons: Partial<Record<RuleAction, string>> = {}
  const check = (action: RuleAction, statuses: RuleStatus[] | null, verb: string, statusText?: string) => {
    if (!user) reasons[action] = '로그인한 뒤 사용할 수 있어요.'
    else if (statuses && !statuses.includes(rule.status)) reasons[action] = statusText ?? `${statusList(statuses)} 상태의 룰만 ${verb} 수 있어요.`
    else {
      const problem = statuses ? permissionProblem(rule, user, verb) : ''
      if (problem) reasons[action] = problem
    }
  }
  for (const [action, definition] of Object.entries(ruleTransitionActions) as [RuleTransitionAction, typeof ruleTransitionActions[RuleTransitionAction]][]) {
    check(action, definition.from, definition.verb)
  }
  check('edit', editableStatuses, '수정할')
  check('delete', Object.keys(ruleStatusLabels) as RuleStatus[], '삭제할')
  check('archive', Object.keys(ruleStatusLabels) as RuleStatus[], '보관할')
  check('duplicate', null, '복제할')
  check('backtest', null, '백테스트할')
  const actions = [...Object.keys(ruleTransitionActions), 'edit', 'delete', 'archive', 'duplicate', 'backtest'] as RuleAction[]
  return { allowedActions: actions.filter(action => !reasons[action]), blockedReasons: reasons }
}
export type RulePeriod = { start: string; end: string }
export type RuleBlockKind = 'typeCode' | 'scoreMin' | 'accountWindow'

export function ruleBlocksFor(input: RuleInput): RuleBlockKind[] {
  const blocks: RuleBlockKind[] = []
  if (input.typeCode !== null) blocks.push('typeCode')
  if (input.scoreMin !== 0) blocks.push('scoreMin')
  if (input.minTransactions !== 1 || input.windowHours !== 24) blocks.push('accountWindow')
  return blocks.length ? blocks : ['scoreMin']
}

export function compileRuleBlocks(input: RuleInput, blocks: RuleBlockKind[]): RuleInput {
  return {
    name: input.name,
    description: input.description,
    typeCode: blocks.includes('typeCode') ? input.typeCode : null,
    scoreMin: blocks.includes('scoreMin') ? input.scoreMin : 0,
    minTransactions: blocks.includes('accountWindow') ? input.minTransactions : 1,
    windowHours: blocks.includes('accountWindow') ? input.windowHours : 24,
  }
}

export function ruleConditionSummary(input: RuleInput) {
  const conditions = [
    input.typeCode === null ? '' : `거래 유형이 ‘${typeDisplay(input.typeCode).label}’`,
    input.scoreMin > 0 ? `모델 점수가 ${Number((input.scoreMin * 100).toFixed(2))}점 이상` : '',
    input.minTransactions > 1 ? `같은 송금 계좌에서 ${input.windowHours}시간 안에 조건에 해당하는 거래가 ${input.minTransactions}건 이상` : '',
  ].filter(Boolean)
  return conditions.length ? `${conditions.join(', ')}이면 검토 대상으로 표시합니다.` : '조회 기간의 모든 거래를 검토 대상으로 표시합니다.'
}

export function validateRule(input: RuleInput) {
  const errors: Partial<Record<keyof RuleInput, string>> = {}
  if (!input.name.trim() || input.name.trim().length > RULE_LIMITS.name) errors.name = `룰 이름은 1~${RULE_LIMITS.name}자로 입력해 주세요.`
  if (!input.description.trim() || input.description.length > RULE_LIMITS.description) errors.description = `목적과 근거를 1~${RULE_LIMITS.description.toLocaleString('ko-KR')}자로 입력해 주세요.`
  if (!Number.isFinite(input.scoreMin) || input.scoreMin < 0 || input.scoreMin > 1) errors.scoreMin = '모델 점수는 0~1 사이로 입력해 주세요.'
  if (!Number.isInteger(input.minTransactions) || input.minTransactions < 1) errors.minTransactions = '최소 거래는 1 이상의 정수로 입력해 주세요.'
  if (!Number.isInteger(input.windowHours) || input.windowHours < 1 || input.windowHours > RULE_LIMITS.windowHours) errors.windowHours = `시간 창은 1~${RULE_LIMITS.windowHours}시간의 정수로 입력해 주세요.`
  return errors
}
export function validatePeriod(period: RulePeriod) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  return !valid(period.start) || !valid(period.end) || period.start > period.end ? '유효한 시작일과 종료일을 순서대로 선택해 주세요.' : ''
}
export function filterRules(rules: RuleRecord[], query: string, status: string) {
  const search = query.trim().toLocaleLowerCase()
  return rules.filter(rule => (!(status in ruleStatusLabels) || rule.status === status) && (!search || `${rule.id} ${rule.name} ${rule.author} ${rule.description}`.toLocaleLowerCase().includes(search)))
}
export function rulesPagination(total: number, pageValue: string | null = null, sizeValue: string | null = null) {
  const requestedSize = Number(sizeValue)
  const pageSize = Number.isInteger(requestedSize) && requestedSize > 0 ? Math.min(100, requestedSize) : 25
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const requestedPage = Number(pageValue)
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(pageCount, requestedPage) : 1
  const offset = (page - 1) * pageSize
  return { page, pageSize, pageCount, offset, start: total ? offset + 1 : 0, end: Math.min(offset + pageSize, total) }
}
export const MAX_LOCAL_BACKTEST_TRANSACTIONS = 10000
export function runBacktest(transactions: LedgerTransaction[], input: RuleInput, period: RulePeriod, options: { offset?: number; limit?: number } = {}) {
  if (transactions.length > MAX_LOCAL_BACKTEST_TRANSACTIONS) throw new Error('로컬 샘플 평가 한도는 10,000건입니다. 대용량 평가는 서버 비동기 백테스트 작업으로 실행해야 합니다.')
  const periodError = validatePeriod(period)
  if (periodError || Object.keys(validateRule(input)).length) throw new Error(periodError || '룰 조건을 확인해 주세요.')
  const scanned = transactions.filter(tx => tx.date >= period.start && tx.date <= period.end)
  const candidates = scanned.filter(tx => (input.typeCode === null || tx.typeCode === input.typeCode) && tx.score >= input.scoreMin && Number.isFinite(Date.parse(tx.occurredAt))).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id)
  const accounts = new Map<number, LedgerTransaction[]>()
  candidates.forEach(tx => {
    const rows = accounts.get(tx.accountId)
    if (rows) rows.push(tx)
    else accounts.set(tx.accountId, [tx])
  })
  const matched = new Set<number>()
  accounts.forEach(rows => {
    const coverage = new Int32Array(rows.length + 1)
    let end = 0
    for (let start = 0; start < rows.length; start++) {
      while (end < rows.length && Date.parse(rows[end].occurredAt) - Date.parse(rows[start].occurredAt) <= input.windowHours * 3600000) end++
      if (end - start >= input.minTransactions) { coverage[start]++; coverage[end]-- }
    }
    let active = 0
    rows.forEach((tx, index) => { active += coverage[index]; if (active > 0) matched.add(tx.id) })
  })
  const limit = Number.isInteger(options.limit) && (options.limit ?? 0) > 0 ? Math.min(100, options.limit!) : 25
  const offset = Number.isInteger(options.offset) && (options.offset ?? 0) > 0 ? options.offset! : 0
  const rows: LedgerTransaction[] = []
  const matchedAccounts = new Set<number>()
  let amountUsd = 0; let matchedCount = 0
  candidates.forEach(tx => {
    if (!matched.has(tx.id)) return
    if (matchedCount >= offset && rows.length < limit) rows.push(tx)
    matchedCount++; amountUsd += tx.amountUsd; matchedAccounts.add(tx.accountId)
  })
  return { transactions: rows, matchedCount, scannedCount: scanned.length, accountCount: matchedAccounts.size, amountUsd, matchedAccountIds: [...matchedAccounts] }
}
/** Compare the complete sender-account result sets, independently of visible paging. */
export function compareBacktests(current: { matchedAccountIds: readonly number[] }, baseline: { matchedAccountIds: readonly number[] }) {
  const currentIds = new Set(current.matchedAccountIds)
  const baselineIds = new Set(baseline.matchedAccountIds)
  const retainedAccountCount = [...currentIds].filter(id => baselineIds.has(id)).length
  return {
    matchedAccountCount: currentIds.size,
    addedAccountCount: currentIds.size - retainedAccountCount,
    removedAccountCount: baselineIds.size - retainedAccountCount,
    retainedAccountCount,
    deltaAccountCount: currentIds.size - baselineIds.size,
  }
}
export function downloadRulesCsv(filename: string, rows: (string | number)[][]) {
  downloadCsv(filename, (rows[0] ?? []).map(String), rows.slice(1))
}
