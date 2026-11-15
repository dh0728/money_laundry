import { cases, transactions, snapshot, patternName } from './dashboard-data'
import type { ActionResult, JudgmentRecord, LedgerTransaction, RuleInput, RuleRecord, RuleStatus, Verdict, WorkspaceCase, WorkspaceState } from './workspace-store'

type Mutation<T> = ActionResult<{ state: WorkspaceState; value: T }>
// This adapter is for bounded fixtures only. Production supplies server pages,
// aggregate DTOs and case neighborhoods instead of hydrating the full ledger.
export function withinSampleBudget(state: WorkspaceState) {
  if ([state.transactions.length, state.records.length, state.rules.length, state.judgments.length, state.notifications.length].some(length => length > 10_000)) return false
  let references = 0
  for (const record of state.records) {
    references += record.transactionIds.length + record.history.length + record.comments.length
    if (references > 10_000) return false
  }
  return true
}
const failure = (error: string, conflict = false) => ({ ok: false as const, error, conflict })
const stamp = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
const reasonValid = (reason: string) => reason.trim().length > 0 && reason.trim().length <= 2000
const event = (action: string, reason: string) => ({ at: stamp(), actor: snapshot.userName, action, reason })
function judgmentId(state: WorkspaceState) {
  const serial = Math.max(0, ...state.judgments.map(j => Number(j.id.split('-').at(-1)))) + 1
  return `J-261115-${String(serial).padStart(6, '0')}`
}
function reportText(rows: WorkspaceCase[], verdict: Verdict, reason: string) {
  return `샘플 AI 보고서 · 실제 모델 실행 없음\n대상: ${rows.map(c => c.displayId).join(', ')}\n사람 판정: ${verdict === 'normal' ? '정상' : '이상'}\n판정 사유: ${reason}\n` + rows.map(c => `${c.displayId}: ${c.transactionIds.length}건, ${c.amountUsd?.toLocaleString('ko-KR') ?? '값 없음'} USD, ${patternName(c.typeCode)} ${Math.round(c.probability * 100)}%, 모델 점수 ${c.score.toFixed(2)}`).join('\n')
}
export function createWorkspaceState(): WorkspaceState {
  const ledger: LedgerTransaction[] = transactions.map((t, i) => ({ ...t, ownerId: 600 + (t.accountId - 900) % 19,
    displayId: `T-${t.date.slice(2).replaceAll('-', '')}-${String(i + 1).padStart(8, '0')}`,
    occurredAt: `${t.date}T09:${String(i % 18 * 3).padStart(2, '0')}:00+09:00`,
    fromAccountId: t.accountId, toAccountId: 900 + (i + 7) % 47, probability: [0.82, 0.91, 0.76][i % 3], currency: 'USD', humanVerdict: null,
  }))
  const records: WorkspaceCase[] = cases.map(c => ({ ...c, transactionIds: [...c.transactionIds], revision: 1, alertCaseIds: [], comments: [],
    history: [{ at: `${c.createdDate}T10:00:00+09:00`, actor: '시스템', action: '생성', reason: '합성 거래에서 생성된 샘플 조사 건' }],
  }))
  records.forEach((c, i) => {
    if (c.kind !== 'EPISODE') return
    const alert = records[i % 2 === 0 ? i - 1 : i - 2]
    c.alertCaseIds = [alert.caseId]; alert.episodeCaseId = c.caseId
    c.transactionIds = [...alert.transactionIds]; c.amountUsd = alert.amountUsd
  })
  const judgments: JudgmentRecord[] = records.filter(c => c.verdict).map((c, i) => ({
    id: `J-261115-${String(i + 1).padStart(6, '0')}`, caseIds: [c.caseId], displayIds: [c.displayId], transactionIds: [...c.transactionIds],
    verdict: c.verdict!, reason: '거래 근거와 관련 계좌를 확인한 샘플 판정', reviewer: c.assignee,
    at: '2026-11-15T16:00:00+09:00', cases: [structuredClone(c)], reportText: reportText([c], c.verdict!, '거래 근거와 관련 계좌를 확인한 샘플 판정'),
  }))
  const inputs: RuleInput[] = [
    { name: '분산 송금 후보 검토', description: '모델 점수와 분산 송금 유형을 함께 검토하는 샘플 룰', typeCode: 1, scoreMin: .7, minTransactions: 1, windowHours: 24 },
    { name: '고위험 거래 모니터링', description: '유형과 별개로 높은 모델 점수의 거래를 검토', typeCode: null, scoreMin: .9, minTransactions: 2, windowHours: 72 },
    { name: '순환 거래 후보', description: '순환 거래 추정 결과를 검토', typeCode: 5, scoreMin: .8, minTransactions: 1, windowHours: 48 },
  ]
  const rules: RuleRecord[] = inputs.map((input, i) => ({ ...input, id: `RULE-${String(i + 1).padStart(3, '0')}`, version: 1,
    status: (['DRAFT', 'ACTIVE', 'REJECTED'] as const)[i], author: snapshot.userName, updatedAt: snapshot.at,
    history: [event('샘플 룰 등록', i === 2 ? '오래된 조건을 다시 검토해 주세요.' : '검수용 초기 조건')],
  }))
  return { records, transactions: ledger, rules, judgments, notifications: [
    { id: 1, title: `${records[0].displayId} 새 배정`, body: '김OO 님 담당 업무입니다.', at: snapshot.at, href: `#/alerts/${records[0].caseId}?tab=overview`, read: false },
    { id: 2, title: 'RULE-001 초안 검토', body: '샘플 룰 조건을 확인해 주세요.', at: snapshot.at, href: '#/rules?selected=RULE-001', read: false },
    { id: 3, title: `${records[2].displayId} 조사 중`, body: '연결 Alert와 거래 근거를 함께 확인하세요.', at: snapshot.at, href: `#/episodes/${records[2].caseId}?tab=overview`, read: true },
  ] }
}

export function applyCaseVerdict(state: WorkspaceState, ids: number[], verdict: Verdict, reason: string, options?: { expectedRevisions?: Record<number, number>; scenario?: 'success' | 'error' | 'conflict' }): Mutation<JudgmentRecord> {
  if (ids.length > 100) return failure('한 번에 최대 100건까지 판정할 수 있습니다.')
  if (!reasonValid(reason)) return failure('판정 사유를 1~2,000자로 입력해 주세요.')
  if (!['normal', 'abnormal'].includes(verdict)) return failure('정상 또는 이상을 선택해 주세요.')
  const unique = [...new Set(ids)]
  const index = new Map(state.records.map(c => [c.caseId, c]))
  const selected = unique.flatMap(id => index.get(id) ? [index.get(id)!] : [])
  if (!selected.length || selected.length !== unique.length) return failure('판정할 업무를 다시 선택해 주세요.')
  if (selected.some(c => c.assigneeId !== snapshot.userId)) return failure('다른 담당자의 업무는 판정할 수 없습니다.')
  if (selected.some(c => c.status === 'CLOSED')) return failure('이미 처리 완료된 업무가 포함되어 있습니다.')
  if (options?.scenario === 'conflict' || selected.some(c => options?.expectedRevisions?.[c.caseId] !== undefined && options.expectedRevisions[c.caseId] !== c.revision)) return failure('업무가 변경되었습니다. 최신 내용을 확인한 뒤 다시 판정해 주세요.', true)
  if (options?.scenario === 'error') return failure('샘플 저장 실패입니다. 입력은 유지됩니다. 다시 시도해 주세요.')
  const when = stamp()
  const chosen = new Set(unique)
  const updated = state.records.map(c => chosen.has(c.caseId) ? { ...c, status: 'CLOSED' as const, workState: 'done' as const, verdict, revision: c.revision + 1, history: [...c.history, event('판정 완료', reason.trim())] } : c)
  const frozen = structuredClone(updated.filter(c => chosen.has(c.caseId)))
  const judgment: JudgmentRecord = { id: judgmentId(state), caseIds: unique, displayIds: frozen.map(c => c.displayId), transactionIds: [...new Set(frozen.flatMap(c => c.transactionIds))],
    verdict, reason: reason.trim(), reviewer: snapshot.userName, at: when, cases: frozen, reportText: reportText(frozen, verdict, reason.trim()) }
  return { ok: true, value: { value: judgment, state: { ...state, records: updated, judgments: [...state.judgments, judgment], notifications: [{ id: Math.max(0, ...state.notifications.map(n => n.id)) + 1, title: `${judgment.id} 판정 완료`, body: `${unique.length}건의 샘플 판정을 저장했습니다.`, at: when, href: `#/report?selected=${judgment.id}`, read: false }, ...state.notifications] } } }
}
export function bundleCaseAlerts(state: WorkspaceState, ids: number[], reason: string): Mutation<WorkspaceCase> {
  if (ids.length > 100) return failure('한 번에 최대 100건의 Alert를 묶을 수 있습니다.')
  const unique = [...new Set(ids)]
  if (unique.length < 2 || !reasonValid(reason)) return failure('Alert 2건 이상을 선택하고 묶는 사유를 입력해 주세요.')
  const lookup = new Map(state.records.map(c => [c.caseId, c]))
  const rows = unique.flatMap(id => lookup.has(id) ? [lookup.get(id)!] : [])
  if (rows.length !== unique.length || rows.some(c => c.kind !== 'ALERT' || c.status === 'CLOSED' || c.assigneeId !== snapshot.userId || c.episodeCaseId)) return failure('본인 담당의 미종결·미편입 Alert만 묶을 수 있습니다.')
  const txIds = [...new Set(rows.flatMap(c => c.transactionIds))]
  const txSet = new Set(txIds)
  const highest = rows.reduce((a, b) => a.score >= b.score ? a : b)
  const serial = Math.max(0, ...state.records.map(c => Number(c.displayId.split('-').at(-1)))) + 1
  const episode: WorkspaceCase = { ...highest, caseId: Math.max(...state.records.map(c => c.caseId)) + 101, sourceId: Math.max(...state.records.map(c => c.sourceId)) + 107,
    displayId: `E-261115-${String(serial).padStart(6, '0')}`, kind: 'EPISODE', createdDate: snapshot.date, ageDays: 0, status: 'OPEN', workState: 'pending', verdict: null,
    transactionIds: txIds, amountUsd: state.transactions.filter(t => txSet.has(t.id)).reduce((n, t) => n + t.amountUsd, 0), revision: 1, episodeCaseId: undefined, alertCaseIds: unique, comments: [], history: [event('Episode 생성', reason.trim())] }
  return { ok: true, value: { value: episode, state: { ...state, records: [...state.records.map(c => unique.includes(c.caseId) ? { ...c, episodeCaseId: episode.caseId, revision: c.revision + 1, history: [...c.history, event('Episode 편입', reason.trim())] } : c), episode] } } }
}
export function appendCaseComment(state: WorkspaceState, id: number, text: string): Mutation<WorkspaceCase> {
  const record = state.records.find(c => c.caseId === id)
  if (!record || record.assigneeId !== snapshot.userId || record.status === 'CLOSED') return failure('본인 담당의 미종결 업무에만 의견을 남길 수 있습니다.')
  if (!reasonValid(text)) return failure('의견을 1~2,000자로 입력해 주세요.')
  const comment = { id: Math.max(0, ...record.comments.map(c => c.id)) + 1, author: snapshot.userName, at: stamp(), text: text.trim() }
  const next = { ...record, revision: record.revision + 1, comments: [...record.comments, comment], history: [...record.history, event('검토 의견', text.trim())] }
  return { ok: true, value: { value: next, state: { ...state, records: state.records.map(c => c.caseId === id ? next : c) } } }
}
export function updateTransactionVerdict(state: WorkspaceState, id: number, verdict: Verdict, reason: string): Mutation<LedgerTransaction> {
  if (!reasonValid(reason)) return failure('거래 판정 사유를 입력해 주세요.')
  const row = state.transactions.find(t => t.id === id)
  if (!row || !['normal', 'abnormal'].includes(verdict)) return failure('거래와 판정을 다시 확인해 주세요.')
  const related = state.records.filter(c => c.transactionIds.includes(id))
  if (!related.length || related.some(c => c.assigneeId !== snapshot.userId || c.status === 'CLOSED')) return failure('다른 담당자 또는 종결 업무와 연결된 거래는 변경할 수 없습니다.')
  const next = { ...row, humanVerdict: verdict }
  return { ok: true, value: { value: next, state: { ...state, transactions: state.transactions.map(t => t.id === id ? next : t), records: state.records.map(c => c.transactionIds.includes(id) ? { ...c, revision: c.revision + 1, history: [...c.history, event(`거래 ${row.displayId} ${verdict === 'normal' ? '정상' : '이상'} 판정`, reason.trim())] } : c) } } }
}
export function saveWorkspaceRule(state: WorkspaceState, input: RuleInput, existingId?: string): Mutation<RuleRecord> {
  if (!input.name.trim() || input.name.length > 100 || input.description.length > 2000 || !Number.isFinite(input.scoreMin) || input.scoreMin < 0 || input.scoreMin > 1 || !Number.isInteger(input.minTransactions) || input.minTransactions < 1 || !Number.isFinite(input.windowHours) || input.windowHours <= 0 || input.windowHours > 24 * 365 || (input.typeCode !== null && (!Number.isInteger(input.typeCode) || input.typeCode < 0 || input.typeCode > 8))) return failure('룰 이름, 유형, 점수(0~1), 최소 거래 수와 시간 범위를 확인해 주세요.')
  const existing = existingId ? state.rules.find(r => r.id === existingId) : undefined
  if (existingId && (!existing || !['DRAFT', 'REJECTED', 'STOPPED'].includes(existing.status))) return failure('현재 상태의 룰은 수정할 수 없습니다.')
  const id = existingId ?? `RULE-${String(Math.max(0, ...state.rules.map(r => Number(r.id.slice(5)))) + 1).padStart(3, '0')}`
  const next: RuleRecord = { ...input, name: input.name.trim(), id, version: existing ? existing.version + 1 : 1, status: 'DRAFT', author: snapshot.userName, updatedAt: stamp(), history: [...(existing?.history ?? []), event(existing ? '초안 수정' : '초안 생성', input.description.trim() || '샘플 룰 조건 저장')] }
  return { ok: true, value: { value: next, state: { ...state, rules: existing ? state.rules.map(r => r.id === id ? next : r) : [...state.rules, next] } } }
}
export function transitionWorkspaceRule(state: WorkspaceState, id: string, status: RuleStatus, reason: string): Mutation<RuleRecord> {
  const rule = state.rules.find(r => r.id === id)
  const allowed: Record<RuleStatus, RuleStatus[]> = { DRAFT: ['PENDING_APPROVAL'], PENDING_APPROVAL: ['TESTING', 'REJECTED'], TESTING: ['ACTIVE', 'REJECTED', 'STOPPED'], ACTIVE: ['STOPPED'], STOPPED: ['TESTING'], REJECTED: ['DRAFT'] }
  if (!rule || !allowed[rule.status].includes(status)) return failure('허용되지 않은 룰 상태 변경입니다.')
  if (!reasonValid(reason)) return failure('상태 변경 사유를 입력해 주세요.')
  const next = { ...rule, status, version: rule.version + 1, updatedAt: stamp(), history: [...rule.history, event(`모의 상태 변경: ${status}`, reason.trim())] }
  return { ok: true, value: { value: next, state: { ...state, rules: state.rules.map(r => r.id === id ? next : r) } } }
}
