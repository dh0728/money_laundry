import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { caseHref, type LedgerTransaction, type Verdict, type WorkspaceCase } from '../workspace-store'
import { CaseGraph, CaseTablePagination } from './CaseGraph'
import { canJudgeCase, downloadCaseCsv, type GraphLens } from './case-selectors'
import { focusedRelatedCandidate, mergeRelatedEvidence, relatedEvidenceRows, type RelatedCandidate, type RelatedLedgerIndex } from './case-related'

type Props = {
  item: WorkspaceCase; related: RelatedCandidate[]; relatedFilter: string; page: number; pageSize: number
  selectedIds: number[]; viewerId: number; editable: boolean; ledgerIndex: RelatedLedgerIndex; lens: GraphLens
  patternHref: string; ownerHref: string; onFilter: (value: string) => void; onPage: (value: number) => void
  onPageSize: (value: number) => void; onToggleSelected: (id: number, selected: boolean) => void
  onVerdict: (tx: LedgerTransaction, verdict: Verdict) => void
}
export function CaseRelated(props: Props) {
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const page = Math.min(props.page, Math.max(1, Math.ceil(props.related.length / props.pageSize)))
  const visible = props.related.slice((page-1)*props.pageSize, page*props.pageSize)
  const candidate = focusedRelatedCandidate(visible, focusedId)?.item ?? null
  return <section data-case="related">
    <header data-ws="toolbar"><h2>연관 업무 {props.related.length}건</h2><label>연관 업무 필터<select value={props.relatedFilter} onChange={event => props.onFilter(event.target.value)}><option value="all">전체</option><option value="mine">내 담당</option><option value="open">처리 완료 전</option></select></label></header>
    <section aria-label="연관 업무 후보" data-case="related-candidates">
      <p data-case="related-hint">체크박스는 일괄 판정용입니다. 관계 분석을 누르면 아래 그래프와 연결 근거가 바뀝니다.</p>
      <div data-case="related-candidate-scroll">
      {visible.length ? <table data-ws="table"><thead><tr><th>선택</th><th>업무 ID</th><th>담당자</th><th>공통 거래</th><th>공통 계좌</th><th>관계 분석</th></tr></thead><tbody>{visible.map(row => <tr key={row.item.caseId}><td><input type="checkbox" aria-label={`${row.item.displayId} 선택`} checked={props.selectedIds.includes(row.item.caseId)} disabled={!props.editable || !canJudgeCase(row.item, props.viewerId) || (!props.selectedIds.includes(row.item.caseId) && props.selectedIds.length >= 100)} onChange={event => props.onToggleSelected(row.item.caseId, event.target.checked)} /></td><td><a href={caseHref(row.item)}>{row.item.displayId}</a></td><td>{row.item.assignee}</td><td>{row.sharedTransactions}건</td><td>{row.sharedAccounts}개</td><td><Button variant="secondary" aria-label={`${row.item.displayId} 관계 분석`} aria-pressed={candidate?.caseId === row.item.caseId} onClick={() => setFocusedId(row.item.caseId)}>관계 분석</Button></td></tr>)}</tbody></table> : <p data-ws="empty">조건에 맞는 연관 업무가 없습니다.</p>}
      </div>
      <CaseTablePagination total={props.related.length} page={page} pageSize={props.pageSize} onPage={props.onPage} onPageSize={props.onPageSize} />
    </section>
    <RelatedInspection key={`${props.item.caseId}:${candidate?.caseId ?? 'none'}`} {...props} candidate={candidate} />
  </section>
}
function RelatedInspection(props: Props & { candidate: WorkspaceCase | null }) {
  const [scope, setScope] = useState({ current: true, candidate: true })
  const rows = mergeRelatedEvidence(props.item, props.candidate, props.ledgerIndex, scope)
  const evidence = relatedEvidenceRows(props.item, props.candidate, props.ledgerIndex)
  return <>
    <nav data-ws="toolbar" aria-label="연관 분석 관점"><a href={props.patternHref} aria-current={props.lens === 'pattern' ? 'page' : undefined}>패턴별</a><a href={props.ownerHref} aria-current={props.lens === 'owner' ? 'page' : undefined}>소유주별</a></nav>
    <section aria-label="연관 그래프"><CaseGraph rows={rows} ownershipLedger={props.ledgerIndex.owners} lens={props.lens} name={props.item.displayId} editable={false} onVerdict={props.onVerdict} layout="related" showTransactions={false} scopeControls={<><label><input type="checkbox" aria-label={`${props.item.displayId} 그래프 표시`} checked={scope.current} onChange={event => setScope({...scope, current:event.target.checked})} />{props.item.displayId}</label>{props.candidate && <label><input type="checkbox" aria-label={`${props.candidate.displayId} 그래프 표시`} checked={scope.candidate} onChange={event => setScope({...scope, candidate:event.target.checked})} />{props.candidate.displayId}</label>}</>} /></section>
    <header data-ws="toolbar"><h3>연결 근거</h3><Button variant="secondary" onClick={() => downloadCaseCsv(`${props.item.displayId}-related-evidence.csv`, [['유형','대상','내용','강도'], ...evidence.map(row => [row.kind,row.target,row.content,row.strength])])}>CSV 다운로드</Button></header>
    <table data-ws="table" aria-label="연결 근거"><thead><tr><th>유형</th><th>대상</th><th>내용</th><th>강도</th></tr></thead><tbody>{evidence.map(row => <tr key={row.id}><td>{row.kind}</td><td>{row.target}</td><td>{row.content}</td><td>{row.strength}</td></tr>)}</tbody></table>
    {!evidence.length && <p data-ws="empty">확인된 연결 근거가 없습니다.</p>}
  </>
}
