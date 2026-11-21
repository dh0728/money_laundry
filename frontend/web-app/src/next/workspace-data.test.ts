import { describe, expect, it } from 'vitest'
import { withinSampleBudget, createWorkspaceState, applyCaseVerdict, bundleCaseAlerts, updateTransactionVerdict, saveWorkspaceRule, transitionWorkspaceRule } from './workspace-data'

describe('shared mock workspace invariants', () => {
  it('rejects oversized snapshots before inspecting ledger rows', () => {
    const state = createWorkspaceState()
    state.transactions = new Proxy(state.transactions, { get(_target, key) { if (key === 'length') return 10_001; throw new Error('ledger row read') } })
    expect(withinSampleBudget(state)).toBe(false)
    const bounded = createWorkspaceState()
    expect(withinSampleBudget(bounded)).toBe(true)
    bounded.records[0].transactionIds = Array(10_001).fill(1)
    expect(withinSampleBudget(bounded)).toBe(false)
  })
  it('rejects other assignees, closed cases, missing reasons and stale revisions atomically', () => {
    const state = createWorkspaceState()
    expect(applyCaseVerdict(state, [8100, 8101], 'normal', '검토 근거').ok).toBe(false)
    expect(applyCaseVerdict(state, [8118], 'normal', '검토 근거').ok).toBe(false)
    expect(applyCaseVerdict(state, [8100], 'normal', '  ').ok).toBe(false)
    expect(applyCaseVerdict(state, [8100], 'normal', '근거', { expectedRevisions: {8100: 99} }).ok).toBe(false)
    expect(state.records.find(c => c.caseId === 8100)?.status).toBe('OPEN')
  })
  it('saves one frozen judgment and closes exactly the selected records', () => {
    const state = createWorkspaceState()
    const result = applyCaseVerdict(state, [8100, 8106], 'abnormal', '공통 거래 근거 확인')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.value.id).toMatch(/^J-\d{6}-\d{6}$/)
    expect(result.value.state.records.filter(c => [8100,8106].includes(c.caseId)).every(c => c.status === 'CLOSED' && c.verdict === 'abnormal')).toBe(true)
    expect(result.value.state.judgments.length).toBe(state.judgments.length + 1)
    expect(result.value.state.records.find(c => c.caseId === 8112)?.status).toBe('OPEN')
    expect(applyCaseVerdict(state, [8100], 'normal', '근거', {scenario:'error'}).ok).toBe(false)
    expect(applyCaseVerdict(state, [8100], 'normal', '근거', {scenario:'conflict'}).ok).toBe(false)
  })
  it('bundles owned open unbundled alerts without changing their work status', () => {
    const state=createWorkspaceState()
    const result=bundleCaseAlerts(state,[8100,8106],'공통 계좌 조사')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const episode=result.value.value
    expect(episode.kind).toBe('EPISODE')
    expect(episode.alertCaseIds).toEqual([8100,8106])
    expect(new Set(episode.transactionIds).size).toBe(episode.transactionIds.length)
    expect(result.value.state.records.find(c=>c.caseId===8100)?.workState).toBe(state.records.find(c=>c.caseId===8100)?.workState)
    expect(bundleCaseAlerts(result.value.state,[8100,8112],'다시 묶기').ok).toBe(false)
    expect(bundleCaseAlerts(state,[8100,8101],'다른 담당').ok).toBe(false)
  })
  it('requires a reason for transaction verdict changes and records the decision', () => {
    const state=createWorkspaceState()
    expect(updateTransactionVerdict(state,7000,'abnormal','').ok).toBe(false)
    const next=updateTransactionVerdict(state,7000,'abnormal','근거 거래 확인')
    expect(next.ok).toBe(true)
    if(next.ok) expect(next.value.state.transactions.find(t=>t.id===7000)?.humanVerdict).toBe('abnormal')
  })
  it('validates rule thresholds and legal transitions', () => {
    const state=createWorkspaceState()
    const input={name:'집중 송금 검토',description:'샘플',typeCode:1 as const,scoreMin:.8,minTransactions:2,windowHours:24}
    expect(saveWorkspaceRule(state,{...input,scoreMin:2}).ok).toBe(false)
    const saved=saveWorkspaceRule(state,input)
    expect(saved.ok).toBe(true)
    if(!saved.ok)return
    expect(transitionWorkspaceRule(saved.value.state,saved.value.value.id,'ACTIVE','즉시 실행').ok).toBe(false)
    expect(transitionWorkspaceRule(saved.value.state,saved.value.value.id,'PENDING_APPROVAL','근거 확인').ok).toBe(true)
  })
})
