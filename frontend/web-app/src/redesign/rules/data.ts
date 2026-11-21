// 룰 엔진 화면 확인용 mock 데이터. API 는 아직 연결하지 않는다.
// Figma 시안에 적힌 값은 그대로 옮겼다. 시안에 없는 값(RULE-003 이 아닌 룰의 상세, 첫 줄이 아닌 백테스트 사례의 상세,
// FAN-IN 이 아닌 템플릿의 기본 조건)은 화면이 비지 않도록 채운 값이라 // 채움 으로 표시했다.
import type { Kpi } from '../components/summary'
import { newCondition, newGroup, type MetricKey, type RuleDraft, type RuleStatus } from './model'

// ── 룰 목록 ─────────────────────────────────────────────────────────────
export type MiniLine = { tag?: 'WHEN' | 'ALL' | 'ANY' | 'THEN'; text: string; indent?: boolean }
export type LogItem = { when: string; text: string }
export type RuleDetail = {
  notice?: string
  change?: { before: { tag: string; text: string }; after: { tag: string; text: string } }
  tree: MiniLine[]
  backtest?: { title: string; stats: { label: string; value: string }[] }
  versions: LogItem[]
  changes: LogItem[]
}
export type RuleRow = {
  id: string
  name: string
  pattern: string
  status: RuleStatus
  alerts: number
  /** 정상 판정(오탐) 비율(%). 아직 판정이 없으면 null */
  falsePositive: number | null
  lastHit: string
  version: number
  owner: string
  detail: RuleDetail
}

const evidence: MiniLine = { tag: 'THEN', text: 'Alert에 근거로 표시' }
const when: MiniLine = { tag: 'WHEN', text: '거래 발생' }
const all: MiniLine = { tag: 'ALL', text: '다음 조건을 모두 만족', indent: true }

export const ruleRows: RuleRow[] = [
  {
    id: 'RULE-001', name: '단건 고액거래', pattern: '한 번에 10,000 USD 이상', status: 'active', alerts: 128, falsePositive: 72, lastHit: '10-31', version: 3, owner: '김본석',
    detail: { // 채움
      tree: [when, all, { text: '거래 금액 ≥ 10,000 USD' }, evidence],
      versions: [{ when: 'v3 · 10-02', text: '김OO 작성 · 운영 중' }, { when: 'v2 · 08-11', text: '김OO 작성 · 종료' }],
      changes: [{ when: '10-02 09:30', text: '오OO · 승인' }, { when: '10-01 16:05', text: '김OO · 승인 요청' }],
    },
  },
  {
    id: 'RULE-002', name: '분할 입·출금', pattern: '24시간 안 9,000 USD 미만 3회 이상', status: 'active', alerts: 64, falsePositive: 58, lastHit: '10-31', version: 2, owner: '이수진',
    detail: { // 채움
      tree: [when, all, { text: '거래 금액 < 9,000 USD' }, { text: '거래 횟수 ≥ 3 (24시간 안에)' }, evidence],
      versions: [{ when: 'v2 · 09-20', text: '이OO 작성 · 운영 중' }, { when: 'v1 · 08-04', text: '이OO 작성 · 종료' }],
      changes: [{ when: '09-20 11:10', text: '오OO · 승인' }, { when: '09-19 17:42', text: '이OO · 승인 요청' }],
    },
  },
  {
    id: 'RULE-003', name: 'FAN-OUT · 분산 송금', pattern: '보낸 계좌 5개 이상', status: 'pending', alerts: 21, falsePositive: 41, lastHit: '10-30', version: 2, owner: '박지훈',
    detail: {
      notice: 'RULE-002와 같은 대상 3건을 잡습니다',
      change: {
        before: { tag: 'v1 운영 중', text: '보낸 계좌 3개 이상 · 24시간' },
        after: { tag: 'v2 새 버전', text: '보낸 계좌 5개 이상 · 24시간 · 보낸 총액 10,000 USD 이상 추가' },
      },
      tree: [when, all, { text: '보낸 계좌 수 ≥ 5 (24시간 안에)' }, { text: '보낸 총액 ≥ 10,000 USD' }, evidence],
      backtest: {
        title: '백테스트 요약 · 최근 44일',
        stats: [{ label: '적중 대상', value: '12 → 9' }, { label: '새로 걸림', value: '1' }, { label: '빠짐', value: '4' }, { label: '정확도', value: '41% → 63%' }],
      },
      versions: [{ when: 'v2 · 11-01', text: '박OO 작성 · 승인 대기' }, { when: 'v1 · 09-02', text: '김OO 작성 · 운영 중' }],
      changes: [{ when: '11-01 14:20', text: '박OO · 승인 요청' }, { when: '11-01 13:55', text: '박OO · 보낸 계좌 3 → 5' }, { when: '10-30 09:10', text: '시스템 · 백테스트 실행' }],
    },
  },
  {
    id: 'RULE-004', name: 'FAN-IN · 집중 수취', pattern: '받은 총액 20,000 USD 이상', status: 'trial', alerts: 7, falsePositive: null, lastHit: '10-29', version: 2, owner: '김본석',
    detail: { // 채움
      change: {
        before: { tag: 'v1 운영 중', text: '송금 계좌 3개 이상 · 24시간' },
        after: { tag: 'v2 새 버전', text: '송금 계좌 5개 이상 · 24시간 · 받은 총액 20,000 USD 이상 추가' },
      },
      tree: [when, all, { text: '서로 다른 송금 계좌 수 ≥ 5 (24시간 안에)' }, { text: '받은 총액 ≥ 20,000 USD' }, evidence],
      backtest: {
        title: '백테스트 요약 · 최근 44일',
        stats: [{ label: '적중 대상', value: '12 → 9' }, { label: '새로 걸림', value: '1' }, { label: '빠짐', value: '4' }, { label: '정확도', value: '41% → 63%' }],
      },
      versions: [{ when: 'v2 · 11-01', text: '김OO 작성 · 시험 운영' }, { when: 'v1 · 09-08', text: '김OO 작성 · 운영 중' }],
      changes: [{ when: '11-01 20:10', text: '김OO · 송금 계좌 3 → 5' }, { when: '11-01 13:40', text: '김OO · 백테스트 실행' }],
    },
  },
  {
    id: 'RULE-005', name: '급속 자금 통과', pattern: '입금 1시간 안 90% 이상 출금', status: 'active', alerts: 33, falsePositive: 64, lastHit: '10-28', version: 1, owner: '이수진',
    detail: { // 채움
      tree: [when, all, { text: '입금 대비 출금 비율 ≥ 90% (1시간 안에)' }, evidence],
      versions: [{ when: 'v1 · 09-15', text: '이OO 작성 · 운영 중' }],
      changes: [{ when: '09-15 10:05', text: '오OO · 승인' }, { when: '09-14 15:30', text: '이OO · 승인 요청' }],
    },
  },
  {
    id: 'RULE-006', name: '휴면계좌 활성화', pattern: '180일 휴면 뒤 고액 입금', status: 'active', alerts: 9, falsePositive: 80, lastHit: '10-21', version: 1, owner: '박지훈',
    detail: { // 채움
      tree: [when, all, { text: '휴면 기간 ≥ 180일' }, { text: '입금 금액 ≥ 10,000 USD' }, evidence],
      versions: [{ when: 'v1 · 09-22', text: '박OO 작성 · 운영 중' }],
      changes: [{ when: '09-22 14:00', text: '오OO · 승인' }, { when: '09-21 18:12', text: '박OO · 승인 요청' }],
    },
  },
  {
    id: 'RULE-007', name: '왕복 송금', pattern: '같은 상대와 7일 안 왕복', status: 'paused', alerts: 0, falsePositive: 90, lastHit: '09-14', version: 1, owner: '김본석',
    detail: { // 채움
      tree: [when, all, { text: '같은 상대와 주고받음 (7일 안에)' }, evidence],
      versions: [{ when: 'v1 · 08-25', text: '김OO 작성 · 중지' }],
      changes: [{ when: '09-15 09:00', text: '오OO · 중지' }, { when: '08-25 13:20', text: '오OO · 승인' }],
    },
  },
]
/** 시안에서 상세가 열려 있는 룰 */
export const initialRuleId = 'RULE-003'

// ── 룰 만들기 ───────────────────────────────────────────────────────────
export type TemplateKey = 'single' | 'structuring' | 'fanIn' | 'fanOut' | 'passThrough' | 'dormant' | 'surge' | 'cycle' | 'repeat'
export type RuleTemplate = {
  key: TemplateKey
  name: string
  /** 템플릿이 보는 축(카드 둘째 줄) */
  axis: string
  available: boolean
  /** WHEN 블록 설명 */
  whenNote: string
  /** "조건 블록" 맨 위 줄에 쓰는 작성 중 표시 */
  draftLabel: string
  /** 이 템플릿에서 고를 수 있는 항목 */
  metrics: MetricKey[]
}

const later = { available: false, whenNote: '', draftLabel: '', metrics: [] as MetricKey[] }
export const templates: RuleTemplate[] = [
  { key: 'single', name: '단건 고액거래', axis: '금액', available: true, whenNote: '거래가 생길 때마다 검사', draftLabel: '새 룰 작성 중', metrics: ['txAmount', 'newAccount', 'foreignMixed'] },
  { key: 'structuring', name: '분할 입·출금', axis: '계좌 × 기간', available: true, whenNote: '거래가 생길 때마다 검사', draftLabel: '새 룰 작성 중', metrics: ['txAmount', 'txCount', 'sentTotal', 'recvTotal', 'foreignMixed'] },
  { key: 'fanIn', name: 'FAN-IN · 집중 수취', axis: '수취 계좌 × 기간', available: true, whenNote: '입금 거래가 들어올 때마다 검사', draftLabel: 'v2 작성 중', metrics: ['distinctSenders', 'recvTotal', 'newAccount', 'foreignMixed'] },
  { key: 'fanOut', name: 'FAN-OUT · 분산 송금', axis: '송금 계좌 × 기간', available: true, whenNote: '출금 거래가 나갈 때마다 검사', draftLabel: '새 룰 작성 중', metrics: ['distinctReceivers', 'sentTotal', 'newAccount', 'foreignMixed'] },
  { key: 'passThrough', name: '급속 자금 통과', axis: '유입 → 유출 시간', available: true, whenNote: '출금 거래가 나갈 때마다 검사', draftLabel: '새 룰 작성 중', metrics: ['outflowRatio', 'recvTotal', 'newAccount', 'foreignMixed'] },
  { key: 'dormant', name: '휴면계좌 활성화', axis: '휴면 기간', ...later },
  { key: 'surge', name: '평소 대비 급증', axis: '평균 대비 배수', ...later },
  { key: 'cycle', name: '순환거래', axis: '경로 길이', ...later },
  { key: 'repeat', name: '반복 상대방 거래', axis: '상대방 × 횟수', ...later },
]
export const initialTemplate: TemplateKey = 'fanIn'

/** 템플릿을 처음 골랐을 때의 조건. FAN-IN 은 시안 값이고 나머지는 채움이다. */
export function initialDraft(key: TemplateKey): RuleDraft {
  const then = 'ATTACH_EVIDENCE' as const
  switch (key) {
    case 'fanIn':
      return { then, where: newGroup('ALL', [newCondition('distinctSenders'), newCondition('recvTotal'), newGroup('ANY', [newCondition('newAccount'), newCondition('foreignMixed')])]) }
    case 'fanOut': return { then, where: newGroup('ALL', [newCondition('distinctReceivers'), newCondition('sentTotal')]) }
    case 'structuring': return { then, where: newGroup('ALL', [newCondition('txAmount', { cmp: 'lt', value: 9000 }), newCondition('txCount')]) }
    case 'passThrough': return { then, where: newGroup('ALL', [newCondition('outflowRatio')]) }
    default: return { then, where: newGroup('ALL', [newCondition('txAmount')]) }
  }
}

export type WorkLog = { at: string; who: string; what: string }
/** 적용 절차 아래 기록. FAN-IN(v2 작성 중)의 시안 값 */
export const fanInLog: WorkLog[] = [
  { at: '11-01 20:10', who: '김OO', what: 'v2 작성 시작 (계좌 3개 → 5개)' },
  { at: '09-08 03:00', who: '시스템', what: 'v1 실행 · 적중 3' },
]
export const applySteps = ['작성', '시험 운영', '승인 요청', 'ADMIN 승인', '운영']

/** 검토 체크리스트. 겹침 경고는 FAN-IN 초안에만 있다. */
export const overlapWarning: Partial<Record<TemplateKey, string[]>> = { fanIn: ['운영 중 RULE-002와 조건이 겹칩니다.', '(계좌 3개 → 5개)'] }
export const checkItems = [
  { key: 'format', name: '형식', text: '템플릿 범위 안의 값입니다.' },
  { key: 'values', name: '조건', text: '값이 모두 채워졌습니다.' },
  { key: 'fields', name: '데이터', text: '금액·계좌·시각 필드가 있습니다.' },
  { key: 'cost', name: '실행 비용', text: '최근 44일 13만 건을 2분 안에 돌립니다.' },
] as const

/** 화면을 보고 있는 사람 (Shell 사이드바의 사용자와 같다) */
export const currentUser = '오조사'

// ── 백테스트 ────────────────────────────────────────────────────────────
export const backtestTarget = { key: 'RULE-004', label: 'RULE-004 FAN-IN · v2 새 버전', base: '비교 기준 · v1 운영 중', scope: '최근 44일 · 13만 건', runLabel: 'v2 · 44일 · 13만 건' }

export const backtestKpis: Kpi[] = [
  { label: '적중 대상', value: '9', caption: 'v1 대비 −3' },
  { label: '새로 걸림', value: '1', caption: 'v1에 없던 대상' },
  { label: '빠짐', value: '4', caption: 'v1에만 걸린 대상' },
  { label: '사람 판정 기준 정확도', value: '63%', caption: 'v1 41% → +22%p' },
]

export type SensitivityRow = { threshold: string; subjects: number; evidence: number; overlap: number; newAlerts: number }
export const sensitivityRows: SensitivityRow[] = [
  { threshold: '2개 이상', subjects: 4, evidence: 14, overlap: 3, newAlerts: 1 },
  { threshold: '3개 이상 (운영 v1)', subjects: 2, evidence: 10, overlap: 2, newAlerts: 0 },
  { threshold: '4개 이상', subjects: 1, evidence: 7, overlap: 1, newAlerts: 0 },
  { threshold: '5개 이상 (이번 값)', subjects: 1, evidence: 7, overlap: 1, newAlerts: 0 },
]

export type CaseKind = 'added' | 'dropped'
export const caseKindLabel: Record<CaseKind, string> = { added: '새로 걸림', dropped: '빠짐' }
export type BacktestCase = {
  account: string
  role: string
  kind: CaseKind
  evidence: string
  alert: string
  verdict: '의심' | '정상'
  detail: { risk: string; period: string; evidence: string; judge: string; overlap?: { rule: string; text: string } }
}
export const backtestCases: BacktestCase[] = [
  {
    account: '47c0b93e', role: '수취', kind: 'added', evidence: '송금 계좌 6개 · 65,700 USD', alert: 'A-261111-001042', verdict: '의심',
    detail: { risk: '0.82', period: '09-03 18:40 ~ 21:15', evidence: '송금 계좌 6개에서 65,700 USD 수취', judge: '김OO', overlap: { rule: 'RULE-001 단건 고액거래', text: '같은 거래 2건' } },
  },
  { // 아래 네 건의 detail 은 채움
    account: '9a12f0c4', role: '수취', kind: 'dropped', evidence: '송금 계좌 3개 · 21,000 USD', alert: 'A-261111-000988', verdict: '정상',
    detail: { risk: '0.41', period: '09-05 10:12 ~ 14:30', evidence: '송금 계좌 3개에서 21,000 USD 수취', judge: '이OO' },
  },
  {
    account: 'b33e7d10', role: '수취', kind: 'dropped', evidence: '송금 계좌 4개 · 24,500 USD', alert: 'A-261111-000971', verdict: '정상',
    detail: { risk: '0.38', period: '09-09 09:05 ~ 16:48', evidence: '송금 계좌 4개에서 24,500 USD 수취', judge: '박OO' },
  },
  {
    account: 'c81a2e55', role: '수취', kind: 'dropped', evidence: '송금 계좌 4개 · 30,200 USD', alert: 'A-261111-000965', verdict: '정상',
    detail: { risk: '0.47', period: '09-12 13:20 ~ 19:02', evidence: '송금 계좌 4개에서 30,200 USD 수취', judge: '김OO' },
  },
  {
    account: 'd07f6b21', role: '수취', kind: 'dropped', evidence: '송금 계좌 3개 · 20,800 USD', alert: 'A-261111-000950', verdict: '의심',
    detail: { risk: '0.74', period: '09-16 20:31 ~ 23:10', evidence: '송금 계좌 3개에서 20,800 USD 수취', judge: '이OO', overlap: { rule: 'RULE-002 분할 입·출금', text: '같은 거래 1건' } },
  },
]

export const initialRuns: LogItem[] = [
  { when: '11-01 13:40', text: 'v2 · 44일 · 13만 건 · 김OO' },
  { when: '10-31 17:05', text: 'v2 초안 · 44일 · 김OO' },
  { when: '10-29 10:12', text: 'v1 기준 · 44일 · 시스템' },
]
