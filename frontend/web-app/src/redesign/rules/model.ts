// 룰 엔진 화면이 다루는 값의 모양과, 조건 트리를 고치고 문장으로 읽는 함수.
// 화면(React)과 떨어뜨려 두어 API 를 붙일 때 이 모양만 맞추면 된다.
import type { TagTone } from '../components/tags'

// ── 룰 상태 ─────────────────────────────────────────────────────────────
// draft(작성 중)는 Figma 목록에 없는 상태다. 승인 대기 룰을 반려하면 돌아갈 곳이 필요해 넣었다.
export type RuleStatus = 'active' | 'trial' | 'pending' | 'paused' | 'draft'
export const statusLabel: Record<RuleStatus, string> = { active: '운영 중', trial: '시험 운영', pending: '승인 대기', paused: '중지', draft: '작성 중' }
export const statusTone: Record<RuleStatus, TagTone> = { active: 'positiveSubtle', trial: 'cautionSubtle', pending: 'cautionSubtle', paused: 'dangerSubtle', draft: 'gray' }
/** 목록 머리의 상태별 개수 태그를 놓는 순서 */
export const statusOrder: RuleStatus[] = ['active', 'trial', 'pending', 'paused', 'draft']

/** 사유를 적어야 하는 동작 */
export type RuleAction = 'approve' | 'reject' | 'pause'
export const actionLabel: Record<RuleAction, string> = { approve: '승인', reject: '반려', pause: '중지' }
export const statusAfter: Record<RuleAction, RuleStatus> = { approve: 'active', reject: 'draft', pause: 'paused' }

// ── 조건 트리 ───────────────────────────────────────────────────────────
export type Cmp = 'gte' | 'gt' | 'lte' | 'lt'
export const cmpSymbol: Record<Cmp, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<' }
const cmpWord: Record<Cmp, string> = { gte: '이상', gt: '초과', lte: '이하', lt: '미만' }
// 받침이 없는 말(초과 · 이하) 뒤에서는 조사가 달라진다
const open = (cmp: Cmp) => cmp === 'gt' || cmp === 'lte'
const toward = (cmp: Cmp) => cmpWord[cmp] + (open(cmp) ? '로' : '으로')
const object = (cmp: Cmp) => cmpWord[cmp] + (open(cmp) ? '를' : '을')
export const cmpOptions = (Object.keys(cmpSymbol) as Cmp[]).map(key => ({ key, label: cmpSymbol[key] }))

export const windowOptions: { key: number; label: string }[] = [
  { key: 60, label: '1시간' },
  { key: 360, label: '6시간' },
  { key: 1440, label: '24시간' },
  { key: 4320, label: '3일' },
  { key: 10080, label: '7일' },
  { key: 43200, label: '30일' },
]
const windowLabel = (minutes: number) => windowOptions.find(option => option.key === minutes)?.label ?? `${minutes}분`

export type MetricKey =
  | 'distinctSenders' | 'recvTotal' | 'distinctReceivers' | 'sentTotal' | 'txAmount' | 'txCount' | 'outflowRatio'
  | 'newAccount' | 'foreignMixed'

export type Condition = { kind: 'condition'; id: string; metric: MetricKey; cmp: Cmp; value: number | null; windowMinutes: number }
export type Group = { kind: 'group'; id: string; op: 'ALL' | 'ANY'; children: RuleNode[] }
export type RuleNode = Condition | Group

export type ThenAction = 'ATTACH_EVIDENCE' | 'CREATE_ALERT'
export const thenOptions: { key: ThenAction; label: string; note: string; sentence: string }[] = [
  { key: 'ATTACH_EVIDENCE', label: 'Alert에 근거로 표시', note: '룰은 Alert를 만들지 않고, 모델이 만든 Alert에 근거로 붙습니다', sentence: 'Alert에 이 룰을 근거로 표시합니다.' },
  { key: 'CREATE_ALERT', label: 'Alert 생성', note: '적중한 거래를 씨앗으로 Alert를 만듭니다', sentence: '적중한 거래를 씨앗으로 Alert를 만듭니다.' },
]

export type RuleDraft = { where: Group; then: ThenAction }

// 문장으로 읽을 때 조건 하나가 내는 말. 어간(stem)에 이어 붙일 어미를 자리(그리고 · 또는 · ~면)에 따라 고른다.
type Endings = { and: string; or: string; if: string }
type Clause = { stem: string; end: Endings }
export type MetricDef = {
  label: string
  /** number = 항목 · 비교 · 값, flag = 항목만 고르고 "이면" */
  kind: 'number' | 'flag'
  unit?: string
  /** 기간(…안에)을 고르는 항목 */
  windowed?: boolean
  initial: Pick<Condition, 'cmp' | 'value' | 'windowMinutes'>
  clause: (condition: Condition) => Clause
}

const amount = (value: number | null) => (value == null ? '?' : value.toLocaleString('en-US'))
const be: Endings = { and: '며', or: '거나', if: '면' }
const act: Endings = { and: '고', or: '거나', if: '면' }

export const metrics: Record<MetricKey, MetricDef> = {
  distinctSenders: {
    label: '서로 다른 송금 계좌 수', kind: 'number', unit: '개', windowed: true, initial: { cmp: 'gte', value: 5, windowMinutes: 1440 },
    clause: c => ({ stem: `${windowLabel(c.windowMinutes)} 안에 서로 다른 계좌 ${amount(c.value)}개 ${cmpWord[c.cmp]}에서 돈을 받`, end: { and: '고', or: '거나', if: '으면' } }),
  },
  recvTotal: {
    label: '받은 총액', kind: 'number', unit: 'USD', initial: { cmp: 'gte', value: 20000, windowMinutes: 1440 },
    clause: c => ({ stem: `받은 총액이 ${amount(c.value)} USD ${cmpWord[c.cmp]}이`, end: be }),
  },
  distinctReceivers: {
    label: '서로 다른 수취 계좌 수', kind: 'number', unit: '개', windowed: true, initial: { cmp: 'gte', value: 5, windowMinutes: 1440 },
    clause: c => ({ stem: `${windowLabel(c.windowMinutes)} 안에 서로 다른 계좌 ${amount(c.value)}개 ${toward(c.cmp)} 돈을 보내`, end: act }),
  },
  sentTotal: {
    label: '보낸 총액', kind: 'number', unit: 'USD', initial: { cmp: 'gte', value: 10000, windowMinutes: 1440 },
    clause: c => ({ stem: `보낸 총액이 ${amount(c.value)} USD ${cmpWord[c.cmp]}이`, end: be }),
  },
  txAmount: {
    label: '거래 금액', kind: 'number', unit: 'USD', initial: { cmp: 'gte', value: 10000, windowMinutes: 1440 },
    clause: c => ({ stem: `한 번에 ${amount(c.value)} USD ${object(c.cmp)} 거래하`, end: act }),
  },
  txCount: {
    label: '거래 횟수', kind: 'number', unit: '회', windowed: true, initial: { cmp: 'gte', value: 3, windowMinutes: 1440 },
    clause: c => ({ stem: `${windowLabel(c.windowMinutes)} 안에 거래가 ${amount(c.value)}회 ${cmpWord[c.cmp]}이`, end: be }),
  },
  outflowRatio: {
    label: '입금 대비 출금 비율', kind: 'number', unit: '%', windowed: true, initial: { cmp: 'gte', value: 90, windowMinutes: 60 },
    clause: c => ({ stem: `입금 뒤 ${windowLabel(c.windowMinutes)} 안에 ${amount(c.value)}% ${object(c.cmp)} 내보내`, end: act }),
  },
  newAccount: {
    label: '수취 계좌가 신규 계좌(개설 30일 이내)', kind: 'flag', initial: { cmp: 'gte', value: null, windowMinutes: 1440 },
    clause: () => ({ stem: '신규 계좌이', end: be }),
  },
  foreignMixed: {
    label: '해외 송금이 섞여 있음', kind: 'flag', initial: { cmp: 'gte', value: null, windowMinutes: 1440 },
    clause: () => ({ stem: '해외 송금이 섞여 있', end: { and: '고', or: '거나', if: '으면' } }),
  },
}

let serial = 0
const nextId = () => `n${++serial}`
export const newCondition = (metric: MetricKey, patch: Partial<Pick<Condition, 'cmp' | 'value' | 'windowMinutes'>> = {}): Condition =>
  ({ kind: 'condition', id: nextId(), metric, ...metrics[metric].initial, ...patch })
export const newGroup = (op: Group['op'], children: RuleNode[] = []): Group => ({ kind: 'group', id: nextId(), op, children })

// ── 트리 고치기 (원본을 바꾸지 않고 새 트리를 돌려준다) ──────────────────
const mapGroup = (group: Group, visit: (group: Group) => Group): Group => {
  const next = visit(group)
  return { ...next, children: next.children.map(child => (child.kind === 'group' ? mapGroup(child, visit) : child)) }
}

export const updateNode = (root: Group, id: string, change: (node: RuleNode) => RuleNode): Group => {
  if (root.id === id) return change(root) as Group
  return mapGroup(root, group => ({ ...group, children: group.children.map(child => (child.id === id ? change(child) : child)) }))
}

/** 맨 위 그룹은 지우지 않고 비운다 */
export const removeNode = (root: Group, id: string): Group =>
  root.id === id ? { ...root, children: [] } : mapGroup(root, group => ({ ...group, children: group.children.filter(child => child.id !== id) }))

export const addChild = (root: Group, groupId: string, node: RuleNode): Group =>
  mapGroup(root, group => (group.id === groupId ? { ...group, children: [...group.children, node] } : group))

const findNode = (node: RuleNode, id: string): RuleNode | undefined => {
  if (node.id === id) return node
  if (node.kind === 'condition') return undefined
  for (const child of node.children) { const found = findNode(child, id); if (found) return found }
  return undefined
}

/** 끌어 놓기: dragId 블록을 targetId 블록 바로 앞으로 옮긴다. 그룹을 자기 안으로 옮기는 것은 무시한다. */
export const moveBefore = (root: Group, dragId: string, targetId: string): Group => {
  if (dragId === targetId || dragId === root.id || targetId === root.id) return root
  const dragged = findNode(root, dragId)
  if (!dragged || findNode(dragged, targetId)) return root
  const without = removeNode(root, dragId)
  return mapGroup(without, group => {
    const index = group.children.findIndex(child => child.id === targetId)
    return index < 0 ? group : { ...group, children: [...group.children.slice(0, index), dragged, ...group.children.slice(index)] }
  })
}

export const conditionsOf = (node: RuleNode): Condition[] => (node.kind === 'condition' ? [node] : node.children.flatMap(conditionsOf))
/** 값을 적어야 하는 조건 중에 비어 있는 것이 있는가 */
export const hasEmptyValue = (root: Group) => conditionsOf(root).some(condition => metrics[condition.metric].kind === 'number' && condition.value == null)

// ── 문장으로 읽기 ───────────────────────────────────────────────────────
const hasCondition = (node: RuleNode): boolean => (node.kind === 'condition' ? true : node.children.some(hasCondition))

function phrase(node: RuleNode, ending: keyof Endings): string {
  if (node.kind === 'condition') { const { stem, end } = metrics[node.metric].clause(node); return stem + end[ending] }
  const children = node.children.filter(hasCondition)
  return children.map((child, index) => {
    if (index === children.length - 1) return phrase(child, ending)
    // 그룹 앞뒤는 쉼표로 끊어 읽는다
    const pause = child.kind === 'group' || children[index + 1].kind === 'group'
    return phrase(child, node.op === 'ALL' ? 'and' : 'or') + (pause ? ', ' : ' ')
  }).join('')
}

/** "거래가 생기면, … 이면 Alert에 이 룰을 근거로 표시합니다." */
export function readAsSentence(draft: RuleDraft): string {
  if (!hasCondition(draft.where)) return '조건을 하나 이상 넣어 주세요.'
  const then = thenOptions.find(option => option.key === draft.then) ?? thenOptions[0]
  return `거래가 생기면, ${phrase(draft.where, 'if')} ${then.sentence}`
}
