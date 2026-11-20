import { useEffect, useMemo, useState } from 'react'
import { Download, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { patternName, riskBand, workStates } from '../dashboard-data'
import { PageHeaderActions } from '../ui/PageHeaderActions'
import { FilterTag } from '../ui/FilterTag'
import { PatternTag, ScoreTag, StatusTag } from '../ui/Tags'
import { WorkspaceDialog } from '../ui/WorkspaceDialog'
import { caseHref, useWorkspace, type LedgerTransaction, type Verdict, type WorkspaceCase } from '../workspace-store'
import { CaseGraph, CaseTablePagination, CaseTransactionDetail, CaseTransactionTable } from './CaseGraph'
import { CaseVerdictDialog } from './CaseVerdictDialog'
import { canJudgeCase, caseDataBudget, caseEvidence, caseSnapshotWithinBudget, downloadCaseCsv, indexCaseLedger, relatedCases } from './case-selectors'
import '../styles/case-detail.css'

function routeHref(route: URL, values: Record<string, string | null>) {
  const next = new URL(route)
  for (const [key, value] of Object.entries(values)) { if (value === null) next.searchParams.delete(key); else next.searchParams.set(key, value) }
  return `#${next.pathname}${next.search}`
}
export function CasePage({ route }: { route: URL }) {
  const { records, transactions } = useWorkspace()
  const withinBudget = useMemo(() => caseSnapshotWithinBudget(records, transactions), [records, transactions])
  if (!withinBudget) return <section data-ws="notice" role="status"><h2>서버 범위 조회가 필요합니다</h2><p>상세 조회의 로컬 한도는 거래 {caseDataBudget.transactions.toLocaleString('ko-KR')}건, 업무 {caseDataBudget.records.toLocaleString('ko-KR')}건, 누적 근거·연결 참조 {caseDataBudget.references.toLocaleString('ko-KR')}개입니다. 서버에서 기간·계좌 범위를 좁힌 업무·이웃 조회가 필요합니다. 현재 서버 조회는 연결되지 않았습니다.</p></section>
  const caseId = Number(route.pathname.split('/')[2])
  const kind = route.pathname.startsWith('/episodes/') ? 'EPISODE' : 'ALERT'
  const item = records.find(record => record.caseId === caseId && record.kind === kind)
  return item ? <CaseContent key={item.caseId} item={item} route={route} /> : <div data-ws="empty"><h2>업무를 찾을 수 없습니다</h2><p>업무 번호와 접근 권한을 확인해 주세요.</p><a href={`#/investigate/${kind === 'ALERT' ? 'alerts' : 'episodes'}`}>목록으로 돌아가기</a></div>
}
function CaseContent({ item, route }: { item: WorkspaceCase; route: URL }) {
  const { records, transactions, viewerId, openCase } = useWorkspace()
  const [verdictOpen, setVerdictOpen] = useState(false)
  const [dialogIds, setDialogIds] = useState<number[]>([item.caseId])
  const [selected, setSelected] = useState<number[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [relatedPage, setRelatedPage] = useState(1)
  const [relatedPageSize, setRelatedPageSize] = useState(25)
  const [transactionVerdict, setTransactionVerdict] = useState<{ id: number; verdict: Verdict } | null>(null)
  const caseId = item.caseId
  useEffect(() => { openCase(caseId) }, [caseId, openCase])
  // Only the bounded mock snapshot is indexed here. Production needs a case-scoped
  // evidence/neighborhood endpoint and server cursors, never the source ledger.
  const ledgerIndex = useMemo(() => indexCaseLedger(transactions), [transactions])
  const evidence = useMemo(() => caseEvidence(item, ledgerIndex), [item, ledgerIndex])
  const related = useMemo(() => relatedCases(item, records, ledgerIndex), [item, records, ledgerIndex])
  const tab = ['overview', 'analysis', 'related', 'review'].includes(route.searchParams.get('tab') ?? '') ? route.searchParams.get('tab')! : 'overview'
  const relatedFilter = route.searchParams.get('related') ?? 'all'
  const visibleRelated = related.filter(row => relatedFilter === 'mine' ? row.item.assigneeId === viewerId : relatedFilter === 'open' ? row.item.status !== 'CLOSED' : true)
  const currentRelatedPage = Math.min(relatedPage, Math.max(1, Math.ceil(visibleRelated.length / relatedPageSize)))
  const relatedPageRows = visibleRelated.slice((currentRelatedPage - 1) * relatedPageSize, currentRelatedPage * relatedPageSize)
  const editable = canJudgeCase(item, viewerId)
  const eligibleSelected = selected.filter(id => visibleRelated.some(row => row.item.caseId === id && canJudgeCase(row.item, viewerId)))
  const verdictIds = tab === 'related' && eligibleSelected.length ? eligibleSelected : [item.caseId]
  const detail = evidence.find(tx => tx.id === detailId)
  const pendingTransaction = evidence.find(tx => tx.id === transactionVerdict?.id)
  const handleTransactionVerdict = (tx: LedgerTransaction, verdict: Verdict) => { setDetailId(null); setTransactionVerdict({ id: tx.id, verdict }) }
  return <div data-case="page">
    <PageHeaderActions><Button disabled={!editable} onClick={editable ? () => { setDialogIds(verdictIds); setVerdictOpen(true) } : undefined}>{tab === 'related' && eligibleSelected.length ? `선택 ${eligibleSelected.length}건 판정` : '판정하기'}</Button></PageHeaderActions>
    <nav data-case="tabs" aria-label="상세 탭">{([['overview', '개요'], ['analysis', '분석'], ['related', '연관 업무'], ['review', '검토']] as const).map(([key, label]) => <a key={key} aria-current={tab === key ? 'page' : undefined} href={routeHref(route, { tab: key })}>{label}</a>)}</nav>
    {!editable && <p data-ws="notice">{item.assigneeId !== viewerId ? `다른 담당자의 업무입니다. ${item.assignee}님 담당 · 읽기 전용` : '처리 완료된 업무입니다. 저장된 판정과 근거를 확인할 수 있습니다.'}</p>}
    <div data-ws="actions" aria-label="업무 상태">
      {item.verdict && <StatusTag preset={item.verdict}>{item.verdict === 'normal' ? '정상' : '이상'}</StatusTag>}
      <StatusTag preset={item.workState}>{workStates.find(state => state.key === item.workState)?.label}</StatusTag>
      <StatusTag preset={riskBand(item.score) === 'high' ? 'riskHigh' : riskBand(item.score) === 'medium' ? 'riskMedium' : 'riskLow'}>{riskBand(item.score) === 'high' ? '위험' : riskBand(item.score) === 'medium' ? '주의' : '낮음'}</StatusTag>
      <StatusTag preset={item.ageDays <= 3 ? 'elapsedLow' : item.ageDays <= 7 ? 'elapsedMid' : 'elapsedHigh'}>{item.ageDays}일 경과</StatusTag><ScoreTag score={item.score} /><PatternTag code={item.typeCode} probability={item.probability} />
    </div>
    {tab === 'overview' && <CaseOverview item={item} evidence={evidence} route={route} onSelect={tx => setDetailId(tx.id)} />}
    {tab === 'analysis' && <>
      <nav data-ws="toolbar" aria-label="분석 관점"><a aria-current={route.searchParams.get('view') !== 'owner' ? 'page' : undefined} href={routeHref(route, { view: 'pattern' })}>패턴별</a><a aria-current={route.searchParams.get('view') === 'owner' ? 'page' : undefined} href={routeHref(route, { view: 'owner' })}>소유주별</a></nav>
      <CaseGraph rows={evidence} ownershipLedger={ledgerIndex.owners} lens={route.searchParams.get('view') === 'owner' ? 'owner' : 'pattern'} name={item.displayId} editable={editable} onVerdict={handleTransactionVerdict} />
    </>}
    {tab === 'related' && <section data-case="related">
      <header data-ws="toolbar"><h2>연관 업무 {visibleRelated.length}건</h2><label>연관 업무 필터<select value={relatedFilter} onChange={event => { setSelected([]); setRelatedPage(1); window.location.hash = routeHref(route, { related: event.target.value }).slice(1) }}><option value="all">전체</option><option value="mine">내 담당</option><option value="open">처리 완료 전</option></select></label><Button variant="secondary" onClick={() => downloadCaseCsv(`${item.displayId}-related.csv`, [['업무 ID', '담당자', '공통 거래 (건)', '공통 계좌 (개)', '직접 연결'], ...relatedPageRows.map(row => [row.item.displayId, row.item.assignee, row.sharedTransactions, row.sharedAccounts, row.linked ? '연결됨' : '없음'])])}><Download />현재 페이지 CSV</Button></header>
      {relatedFilter !== 'all' && <div data-ws="actions"><FilterTag label={relatedFilter === 'mine' ? '내 담당' : '처리 완료 전'} onRemove={() => { setSelected([]); window.location.hash = routeHref(route, { related: null }).slice(1) }} /></div>}
      {visibleRelated.length ? <table data-ws="table"><thead><tr><th>선택</th><th>업무 ID</th><th>담당자</th><th>사람 판정 / 모델 점수</th><th data-numeric>공통 거래</th><th data-numeric>공통 계좌</th><th>연결 근거</th></tr></thead><tbody>{relatedPageRows.map(row => <tr key={row.item.caseId} data-selected={eligibleSelected.includes(row.item.caseId) || undefined}><td><input type="checkbox" aria-label={`${row.item.displayId} 선택`} checked={eligibleSelected.includes(row.item.caseId)} disabled={!editable || !canJudgeCase(row.item, viewerId) || (!eligibleSelected.includes(row.item.caseId) && eligibleSelected.length >= 100)} onChange={event => setSelected(previous => event.target.checked ? (previous.length < 100 ? [...previous, row.item.caseId] : previous) : previous.filter(id => id !== row.item.caseId))} /></td><td><a href={caseHref(row.item)}>{row.item.displayId}</a></td><td>{row.item.assignee}</td><td><div data-ws="actions">{row.item.verdict && <StatusTag preset={row.item.verdict}>{row.item.verdict === 'normal' ? '정상' : '이상'}</StatusTag>}<ScoreTag score={row.item.score} /></div></td><td data-numeric>{row.sharedTransactions}건</td><td data-numeric>{row.sharedAccounts}개</td><td>{row.linked ? 'Episode 연결' : row.sharedTransactions ? '거래 중복' : '계좌 중복'}</td></tr>)}</tbody></table> : <p data-ws="empty">조건에 맞는 연관 업무가 없습니다.</p>}
      <CaseTablePagination total={visibleRelated.length} page={currentRelatedPage} pageSize={relatedPageSize} onPage={setRelatedPage} onPageSize={size => { setRelatedPageSize(size); setRelatedPage(1) }} />
    </section>}
    {tab === 'review' && <CaseReview item={item} editable={editable} />}
    <CaseVerdictDialog ids={dialogIds} open={verdictOpen} onOpenChange={setVerdictOpen} />
    <WorkspaceDialog open={!!detail} onOpenChange={open => { if (!open) setDetailId(null) }} title="거래 상세">{detail && <CaseTransactionDetail tx={detail} editable={editable} onVerdict={handleTransactionVerdict} />}</WorkspaceDialog>
    {transactionVerdict && pendingTransaction && <TransactionVerdictDialog key={`${pendingTransaction.id}-${transactionVerdict.verdict}`} item={item} tx={pendingTransaction} verdict={transactionVerdict.verdict} onClose={() => setTransactionVerdict(null)} />}
  </div>
}

function CaseOverview({ item, evidence, route, onSelect }: { item: WorkspaceCase; evidence: LedgerTransaction[]; route: URL; onSelect: (tx: LedgerTransaction) => void }) {
  const perPanel = route.searchParams.get('mode') === 'per'
  const panel = route.searchParams.get('panel') ?? 'transactions'
  const accounts = [...new Set(evidence.flatMap(tx => [tx.fromAccountId, tx.toAccountId]))]
  const complete = evidence.length === item.transactionIds.length
  return <>
    <section data-part="ai-summary"><h2><Sparkles />샘플 AI 요약</h2><p>{item.displayId}에서 {evidence.length}건의 근거 거래와 {accounts.length}개 계좌를 확인했습니다. {patternName(item.typeCode)} 추정 확률은 {Math.round(item.probability * 100)}%입니다. 거래 방향과 증빙을 확인한 뒤 사람 판정을 남겨 주세요.</p><p data-ws="muted">공유 샘플 데이터로 구성한 요약입니다. 모델 추정은 사람 판정과 별개입니다.</p></section>
    <div data-case="kpis">
      <div data-ws="panel"><span>근거 거래</span><strong>{evidence.length}건</strong></div><div data-ws="panel"><span>거래 금액</span><strong>{complete ? `${evidence.reduce((sum, tx) => sum + tx.amountUsd, 0).toLocaleString('ko-KR')} USD` : '값 없음'}</strong></div>
      <div data-ws="panel"><span>연결 계좌</span><strong>{accounts.length}개</strong></div><div data-ws="panel"><span>담당자</span><strong>{item.assignee}</strong></div>
    </div>
    {!complete && <p data-ws="notice">일부 근거 거래를 불러오지 못했습니다. 전체 금액은 값 없음으로 표시합니다.</p>}
    <div data-ws="toolbar"><nav aria-label="개요 표시 방식" data-ws="actions"><a href={routeHref(route, { mode: 'all' })} aria-current={!perPanel ? 'page' : undefined}>전체 패널</a><a href={routeHref(route, { mode: 'per' })} aria-current={perPanel ? 'page' : undefined}>패널별</a></nav>
      {perPanel && <label>표시 패널<select value={panel} onChange={event => { window.location.hash = routeHref(route, { panel: event.target.value }).slice(1) }}><option value="transactions">근거 거래</option><option value="accounts">관련 계좌</option><option value="history">처리 이력</option></select></label>}
    </div>
    {(!perPanel || !['accounts', 'history'].includes(panel)) && <CaseTransactionTable rows={evidence} name={item.displayId} onSelect={onSelect} />}
    {(!perPanel || panel === 'accounts') && <CaseAccounts item={item} evidence={evidence} />}
    {(!perPanel || panel === 'history') && <CaseHistory item={item} />}
  </>
}
function CaseAccounts({ item, evidence }: { item: WorkspaceCase; evidence: LedgerTransaction[] }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25)
  const accounts = useMemo(() => {
    const result = new Map<number, { id: number; incoming: number; outgoing: number; abnormal: number }>()
    for (const tx of evidence) {
      for (const id of new Set([tx.fromAccountId, tx.toAccountId])) {
        const row = result.get(id) ?? { id, incoming: 0, outgoing: 0, abnormal: 0 }
        if (tx.fromAccountId === id) row.outgoing++
        if (tx.toAccountId === id) row.incoming++
        if (tx.humanVerdict === 'abnormal') row.abnormal++
        result.set(id, row)
      }
    }
    return [...result.values()]
  }, [evidence])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(accounts.length / pageSize)))
  const rows = accounts.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  return <section><header data-ws="toolbar"><h2>관련 계좌 {accounts.length}개</h2><Button variant="secondary" onClick={() => downloadCaseCsv(`${item.displayId}-accounts-page-${currentPage}.csv`, [['계좌 ID', '출금 (건)', '입금 (건)', '사람 이상 판정 거래 (건)'], ...rows.map(row => [row.id, row.outgoing, row.incoming, row.abnormal])])}><Download />현재 페이지 CSV</Button></header>
    {rows.length ? <table data-ws="table"><thead><tr><th>계좌 ID</th><th data-numeric>출금 거래</th><th data-numeric>입금 거래</th><th>사람 판정</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><a href={`#/investigate/ledger?account=${row.id}`}>{row.id}</a></td><td data-numeric>{row.outgoing}건</td><td data-numeric>{row.incoming}건</td><td>{row.abnormal ? <StatusTag preset="abnormal">이상 거래 {row.abnormal}건</StatusTag> : '이상 판정 없음'}</td></tr>)}</tbody></table> : <p data-ws="empty">연결된 계좌가 없습니다.</p>}
    <CaseTablePagination total={accounts.length} page={currentPage} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />
  </section>
}
function CaseHistory({ item }: { item: WorkspaceCase }) {
  return <section><header data-ws="toolbar"><h2>처리 이력 {item.history.length}건</h2><Button variant="secondary" onClick={() => downloadCaseCsv(`${item.displayId}-history.csv`, [['업무 ID', '시각', '담당자', '처리', '사유'], ...item.history.map(entry => [item.displayId, entry.at, entry.actor, entry.action, entry.reason])])}><Download />CSV 다운로드</Button></header>
    {item.history.length ? <ol data-case="history">{item.history.map((entry, index) => <li key={`${entry.at}-${index}`}><strong>{item.displayId} · {entry.action}</strong><span>{entry.actor} · {new Date(entry.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span><p>{entry.reason}</p></li>)}</ol> : <p data-ws="empty">기록된 처리 이력이 없습니다.</p>}
  </section>
}
function CaseReview({ item, editable }: { item: WorkspaceCase; editable: boolean }) {
  const { addComment } = useWorkspace()
  const [text, setText] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const valid = editable && !!text.trim()
  return <div data-case="review">
    <section data-ws="panel"><h2>검토 의견 {item.comments.length}건</h2>{item.comments.length ? <ol data-case="history">{item.comments.map(comment => <li key={comment.id}><strong>{comment.author} · {new Date(comment.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</strong><p>{comment.text}</p></li>)}</ol> : <p data-ws="empty">저장된 검토 의견이 없습니다.</p>}
      <form onSubmit={event => { event.preventDefault(); if (!valid) return; const response = addComment(item.caseId, text.trim()); if (response.ok) { setText(''); setMessage({ ok: true, text: '의견이 저장되었습니다.' }) } else setMessage({ ok: false, text: response.error }) }}>
        <label>검토 의견<Textarea value={text} disabled={!editable} maxLength={2000} onChange={event => setText(event.target.value)} placeholder="검토 근거와 후속 확인 사항을 입력하세요" /></label><Button type="submit" variant="secondary" disabled={!valid}>의견 저장</Button>
      </form>{message && <p role={message.ok ? 'status' : 'alert'} data-ws={message.ok ? 'notice' : 'error'}>{message.text}</p>}
    </section><CaseHistory item={item} />
  </div>
}
function TransactionVerdictDialog({ item, tx, verdict, onClose }: { item: WorkspaceCase; tx: LedgerTransaction; verdict: Verdict; onClose: () => void }) {
  const { judgeTransaction, viewerId } = useWorkspace()
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const valid = canJudgeCase(item, viewerId) && reason.trim().length > 0
  const save = () => {
    if (!valid) return
    const response = judgeTransaction(tx.id, verdict, reason.trim())
    if (response.ok) setSuccess(true); else { setError(response.error); setConfirm(false) }
  }
  return <WorkspaceDialog open onOpenChange={open => { if (!open) onClose() }} title={`거래 ${verdict === 'normal' ? '정상' : '이상'} 판정`} description={tx.humanVerdict && tx.humanVerdict !== verdict ? '기존 사람 판정과 반대 판정입니다. 사유와 변경 내용을 확인해 주세요.' : '거래의 사람 판정을 공유 샘플 작업 공간에 기록합니다.'}
    footer={<><Button variant="secondary" onClick={onClose}>{success ? '닫기' : '취소'}</Button>{!success && <Button disabled={!valid} onClick={valid ? (confirm ? save : () => setConfirm(true)) : undefined}>{confirm ? '확인 후 변경' : '변경 내용 확인'}</Button>}</>}>
    <div data-case="verdict-body"><p>{tx.displayId} · {tx.fromAccountId} → {tx.toAccountId}</p>
      {success ? <p role="status" data-ws="notice">거래 판정이 저장되었습니다. 처리 이력에서 사유와 담당자를 확인할 수 있습니다.</p> : <>
        {error && <p role="alert" data-ws="error">{error}</p>}
        {confirm ? <div data-ws="notice"><p>사람 판정을 {verdict === 'normal' ? '정상' : '이상'}으로 저장할까요?</p><p>{reason}</p><Button variant="secondary" onClick={() => setConfirm(false)}>사유 수정</Button></div> : <label>거래 판정 사유<Textarea value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>}
      </>}
    </div>
  </WorkspaceDialog>
}
