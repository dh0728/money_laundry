import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { typeDisplay } from '@/api/codes'
import { patternName, riskBand, workStates } from '../dashboard-data'
import { PageHeaderActions } from '../ui/PageHeaderActions'
import { PatternTag, ScoreTag, StatusTag } from '../ui/Tags'
import { WorkspaceDialog } from '../ui/WorkspaceDialog'
import { useWorkspace, type LedgerTransaction, type Verdict, type WorkspaceCase } from '../workspace-store'
import { CaseGraph, CaseTablePagination, CaseTransactionDetail, CaseTransactionTable } from './CaseGraph'
import { CaseRelated } from './CaseRelated'
import { episodeAlertSources } from './case-alert-groups'
import { CaseVerdictDialog } from './CaseVerdictDialog'
import { canJudgeCase, caseDataBudget, caseEvidence, caseOverviewFacts, caseSnapshotWithinBudget, downloadCaseCsv, indexCaseLedger, relatedCases, type CaseOverviewFacts } from './case-selectors'
import '../styles/case-detail.css'
import '../styles/case-overview.css'

function isUnitInterval(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}
function hasPatternEstimate(item: WorkspaceCase) {
  return Number.isInteger(item.typeCode) && !!typeDisplay(item.typeCode) && isUnitInterval(item.probability)
}
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
function CaseContent({ item, route: requestedRoute }: { item: WorkspaceCase; route: URL }) {
  const legacyReview = requestedRoute.searchParams.get('tab') === 'review'
  const route = legacyReview ? new URL(requestedRoute) : requestedRoute
  if (legacyReview) {
    route.searchParams.set('tab', 'overview')
    route.searchParams.set('mode', 'per')
    route.searchParams.set('panel', 'history')
  }
  const canonicalHref = legacyReview ? routeHref(route, {}) : null
  useEffect(() => {
    if (!canonicalHref) return
    window.history.replaceState(window.history.state, '', canonicalHref)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [canonicalHref])
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
  const alertSources = useMemo(() => episodeAlertSources(item, records), [item, records])
  const evidence = useMemo(() => caseEvidence(item, ledgerIndex), [item, ledgerIndex])
  const related = useMemo(() => relatedCases(item, records, ledgerIndex), [item, records, ledgerIndex])
  const overviewFacts = useMemo(() => caseOverviewFacts(item, ledgerIndex), [item, ledgerIndex])
  const tab = ['overview', 'analysis', 'related'].includes(route.searchParams.get('tab') ?? '') ? route.searchParams.get('tab')! : 'overview'
  const relatedFilter = route.searchParams.get('related') ?? 'all'
  const visibleRelated = related.filter(row => relatedFilter === 'mine' ? row.item.assigneeId === viewerId : relatedFilter === 'open' ? row.item.status !== 'CLOSED' : true)
  const editable = canJudgeCase(item, viewerId)
  const eligibleSelected = selected.filter(id => visibleRelated.some(row => row.item.caseId === id && canJudgeCase(row.item, viewerId)))
  const verdictIds = tab === 'related' && eligibleSelected.length ? eligibleSelected : [item.caseId]
  const detail = evidence.find(tx => tx.id === detailId)
  const pendingTransaction = evidence.find(tx => tx.id === transactionVerdict?.id)
  const handleTransactionVerdict = (tx: LedgerTransaction, verdict: Verdict) => { setDetailId(null); setTransactionVerdict({ id: tx.id, verdict }) }
  return <div data-case="page" data-case-tab={tab} data-overview-mode={route.searchParams.get('mode') === 'per' ? 'per' : 'all'}>
    <PageHeaderActions>
      <nav data-part="scope-switch" aria-label="상세 탭">{([['overview', '개요'], ['analysis', '분석'], ['related', '연관 업무']] as const).map(([key, label]) => <a key={key} aria-current={tab === key ? 'page' : undefined} href={routeHref(route, { tab: key })}>{label}</a>)}</nav>
      <div data-case="header-verdict"><Button disabled={!editable} onClick={editable ? () => { setDialogIds(verdictIds); setVerdictOpen(true) } : undefined}>{tab === 'related' && eligibleSelected.length ? `선택 ${eligibleSelected.length}건 판정` : '판정하기'}</Button></div>
    </PageHeaderActions>
    {!editable && <p data-ws="notice">{item.assigneeId !== viewerId ? `다른 담당자의 업무입니다. ${item.assignee}님 담당 · 읽기 전용` : '처리 완료된 업무입니다. 저장된 판정과 근거를 확인할 수 있습니다.'}</p>}
    <div data-ws="actions" aria-label="업무 상태">
      <strong>{item.displayId}</strong><span>담당자 {item.assignee}</span>
      {item.verdict && <StatusTag preset={item.verdict}>{item.verdict === 'normal' ? '정상' : '이상'}</StatusTag>}
      <StatusTag preset={item.workState}>{workStates.find(state => state.key === item.workState)?.label}</StatusTag>
      {isUnitInterval(item.score) && <StatusTag preset={riskBand(item.score) === 'high' ? 'riskHigh' : riskBand(item.score) === 'medium' ? 'riskMedium' : 'riskLow'}>{riskBand(item.score) === 'high' ? '위험' : riskBand(item.score) === 'medium' ? '주의' : '낮음'}</StatusTag>}
      <StatusTag preset={item.ageDays <= 3 ? 'elapsedLow' : item.ageDays <= 7 ? 'elapsedMid' : 'elapsedHigh'}>{item.ageDays}일 경과</StatusTag>{isUnitInterval(item.score) ? <ScoreTag score={item.score} /> : <span>모델 점수 미제공</span>}{hasPatternEstimate(item) ? <PatternTag code={item.typeCode} probability={item.probability} /> : <span>업무 추정 패턴 미제공</span>}
    </div>
    {tab === 'overview' && <CaseOverview item={item} evidence={evidence} facts={overviewFacts} route={route} editable={editable} onSelect={tx => setDetailId(tx.id)} />}
    {tab === 'analysis' && <>
      <nav data-ws="toolbar" aria-label="분석 관점"><a aria-current={route.searchParams.get('view') !== 'owner' ? 'page' : undefined} href={routeHref(route, { view: 'pattern' })}>패턴별</a><a aria-current={route.searchParams.get('view') === 'owner' ? 'page' : undefined} href={routeHref(route, { view: 'owner' })}>소유주별</a></nav>
      <CaseGraph alertSources={item.kind === 'EPISODE' ? alertSources : undefined} rows={evidence} ownershipLedger={ledgerIndex.owners} lens={route.searchParams.get('view') === 'owner' ? 'owner' : 'pattern'} name={item.displayId} editable={editable} onVerdict={handleTransactionVerdict} />
    </>}
    {tab === 'related' && <CaseRelated item={item} related={visibleRelated} relatedFilter={relatedFilter} page={relatedPage} pageSize={relatedPageSize} selectedIds={eligibleSelected} viewerId={viewerId} editable={editable} ledgerIndex={ledgerIndex} lens={route.searchParams.get('view') === 'owner' ? 'owner' : 'pattern'} patternHref={routeHref(route, { view: 'pattern' })} ownerHref={routeHref(route, { view: 'owner' })} onFilter={value => { setSelected([]); setRelatedPage(1); window.location.hash = routeHref(route, { related: value }).slice(1) }} onPage={setRelatedPage} onPageSize={size => { setRelatedPageSize(size); setRelatedPage(1) }} onToggleSelected={(id, checked) => setSelected(previous => checked ? (previous.length < 100 ? [...previous, id] : previous) : previous.filter(value => value !== id))} onVerdict={handleTransactionVerdict} />}
    <CaseVerdictDialog ids={dialogIds} open={verdictOpen} onOpenChange={setVerdictOpen} />
    <WorkspaceDialog open={!!detail} onOpenChange={open => { if (!open) setDetailId(null) }} title="거래 상세">{detail && <CaseTransactionDetail tx={detail} editable={editable} onVerdict={handleTransactionVerdict} />}</WorkspaceDialog>
    {transactionVerdict && pendingTransaction && <TransactionVerdictDialog key={`${pendingTransaction.id}-${transactionVerdict.verdict}`} item={item} tx={pendingTransaction} verdict={transactionVerdict.verdict} onClose={() => setTransactionVerdict(null)} />}
  </div>
}

const overviewPanels = [
  ['summary', '판단 요약'], ['accounts', '핵심 계좌'], ['past', '과거 판단'], ['history', '처리 이력'],
  ['detection', '탐지 근거'], ['transactions', '씨앗 거래'], ['flow', '돈의 흐름'],
  ['rules', '룰 적중'], ['composition', '구성'], ['scope', '데이터 범위 · 한계'],
] as const
type OverviewPanelId = typeof overviewPanels[number][0]
function CaseOverview({ item, evidence, facts, route, editable, onSelect }: { item: WorkspaceCase; evidence: LedgerTransaction[]; facts: CaseOverviewFacts; route: URL; editable: boolean; onSelect: (tx: LedgerTransaction) => void }) {
  const perPanel = route.searchParams.get('mode') === 'per'
  const requestedPanel = route.searchParams.get('panel') ?? 'transactions'
  const panel: OverviewPanelId = overviewPanels.some(([id]) => id === requestedPanel) ? requestedPanel as OverviewPanelId : 'transactions'
  const panelIndex = overviewPanels.findIndex(([id]) => id === panel)
  const navigatePanel = (index: number) => { window.location.hash = routeHref(route, { mode: 'per', panel: overviewPanels[index][0] }).slice(1) }
  useEffect(() => {
    if (!perPanel) return
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return
      const next = event.key === 'ArrowLeft' ? panelIndex - 1 : event.key === 'ArrowRight' ? panelIndex + 1 : -1
      if (next < 0 || next >= overviewPanels.length) return
      event.preventDefault()
      window.location.hash = routeHref(route, { mode: 'per', panel: overviewPanels[next][0] }).slice(1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [perPanel, panelIndex, route])
  const unavailableEvidence = !facts.complete && facts.availableCount === 0
  const evidenceSummary = facts.complete
    ? `${facts.availableCount}건의 근거 거래와 ${facts.accountCount}개 계좌를 확인했습니다.`
    : unavailableEvidence
      ? `근거 거래 ${facts.referenceCount}건을 불러오지 못해 계좌와 소유주를 확인할 수 없습니다.`
      : `근거 거래 ${facts.referenceCount}건 중 ${facts.availableCount}건을 확인했습니다. 확인된 거래의 계좌는 ${facts.accountCount}개입니다.`
  const durationMs = facts.period ? Date.parse(facts.period.end) - Date.parse(facts.period.start) : null
  const minutes = durationMs === null ? null : Math.floor(durationMs / 60_000)
  const periodLabel = minutes === null ? '미제공' : minutes === 0 ? (durationMs === 0 ? '0분' : '1분 미만') : minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`
  const timestamp = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const missingFlow = (label: string) => <div data-ws="panel" role="group" aria-label={label}><span>{label}</span><strong>미제공</strong><small data-case="kpi-note">계산 범위 미제공</small></div>
  const missing = (detail: string) => <div data-overview="unavailable"><strong>미제공</strong><p data-ws="muted">{detail}</p></div>
  const bodies: Record<OverviewPanelId, React.ReactNode> = {
    summary: <><p>{evidenceSummary}</p><dl data-case="facts"><div><dt>사람 판정</dt><dd>{item.verdict ? <StatusTag preset={item.verdict}>{item.verdict === 'normal' ? '정상' : '이상'}</StatusTag> : '판정 전'}</dd></div><div><dt>담당자</dt><dd>{item.assignee}</dd></div></dl></>,
    accounts: <>{missing('중심·핵심 계좌 구분 미수신')}{perPanel ? <CaseAccounts item={item} evidence={evidence} complete={facts.complete} /> : <p>{unavailableEvidence ? '관련 계좌 미제공' : `확인된 관련 계좌 ${facts.accountCount}개`}</p>}</>,
    past: missing('현재 업무 이전에 종결된 동일 계좌·소유주의 판정 이력 미수신'),
    history: <><CaseHistory item={item} />{perPanel && <CaseReview item={item} editable={editable} />}</>,
    detection: <dl data-case="facts"><div><dt>업무 모델 점수</dt><dd>{isUnitInterval(item.score) ? item.score.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : '미제공'}</dd></div><div><dt>업무 추정 패턴</dt><dd>{hasPatternEstimate(item) ? <PatternTag code={item.typeCode} probability={item.probability} /> : '미제공'}</dd></div><div><dt>모델 기여요인</dt><dd>미제공</dd></div><div><dt>탐지 임계값</dt><dd>미제공</dd></div><div><dt>모델 버전</dt><dd>미제공</dd></div></dl>,
    transactions: <>{missing('씨앗 거래 구분 미수신 · 아래 표는 확인된 근거 거래')}<CaseTransactionTable rows={evidence} name={item.displayId} onSelect={onSelect} /></>,
    flow: <><dl data-overview="flow"><div><dt>외부 유입</dt><dd>미제공</dd></div><div><dt>핵심 계좌</dt><dd>미제공</dd></div><div><dt>외부 유출</dt><dd>미제공</dd></div></dl><p data-ws="muted">선택 계좌와 전체 입출금 계산 범위 미수신</p><dl data-case="facts"><div><dt>확인된 근거 거래 기간 · KST</dt><dd>{facts.period ? <><time dateTime={facts.period.start}>{timestamp(facts.period.start)}</time> ~ <time dateTime={facts.period.end}>{timestamp(facts.period.end)}</time></> : '미제공'}</dd></div></dl></>,
    rules: missing('탐지 시점의 룰 버전·적중 거래·조건별 관측값 미수신'),
    composition: <dl data-case="facts"><div><dt>확인된 근거 거래</dt><dd>{facts.availableCount} / {facts.referenceCount}건</dd></div><div><dt>씨앗 · 상류 · 하류 · 주변 맥락 구분</dt><dd>미제공</dd></div><div><dt>거래별 포함 사유</dt><dd>미제공</dd></div></dl>,
    scope: <dl data-case="facts"><div><dt>데이터 소스</dt><dd>공유 샘플 데이터</dd></div><div role="group" aria-label="근거 거래 전체 기간"><dt>근거 거래 전체 기간 · KST</dt><dd>{facts.period ? <><time dateTime={facts.period.start}>{timestamp(facts.period.start)}</time> ~ <time dateTime={facts.period.end}>{timestamp(facts.period.end)}</time></> : '미제공'}</dd></div><div><dt>근거 거래</dt><dd>{facts.availableCount} / {facts.referenceCount}건{facts.missingCount > 0 && <span data-case="cell-secondary">미수신 {facts.missingCount}건</span>}{facts.duplicateReferenceCount > 0 && <span data-case="cell-secondary">중복 참조 {facts.duplicateReferenceCount}건 제외</span>}{facts.invalidTimestampCount > 0 && <span data-case="cell-secondary">시각 미확인 {facts.invalidTimestampCount}건</span>}</dd></div><div><dt>은행별 수신 현황</dt><dd>미제공</dd></div><div><dt>모델 · 근거 버전</dt><dd>미제공</dd></div><div><dt>외부 자금 흐름 계산 범위</dt><dd>미제공</dd></div></dl>,
  }
  const renderPanel = (id: OverviewPanelId) => <section key={id} data-overview-panel={id} aria-label={overviewPanels.find(([key]) => key === id)![1]}><header data-overview="panel-header"><h2>{overviewPanels.find(([key]) => key === id)![1]}</h2></header><div data-overview="panel-body">{bodies[id]}</div></section>
  return <>
    {!perPanel && <><section data-part="ai-summary"><h2><Sparkles />샘플 AI 요약</h2><p>{item.displayId}에서 {evidenceSummary} {hasPatternEstimate(item) ? `${patternName(item.typeCode)} 추정 확률은 ${Math.round(item.probability * 100)}%입니다.` : '업무 추정 패턴은 미제공입니다.'} {editable ? '거래 방향과 증빙을 확인한 뒤 사람 판정을 남겨 주세요.' : '거래 방향과 저장된 근거를 확인할 수 있습니다.'}</p><p data-ws="muted">공유 샘플 데이터로 구성한 요약입니다. 모델 추정은 사람 판정과 별개입니다.</p></section>
      <section data-case="kpis" aria-label="개요 핵심 지표">
        <div data-ws="panel" role="group" aria-label="모델 점수"><span>모델 점수</span><strong>{isUnitInterval(item.score) ? item.score.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : '미제공'}</strong><small data-case="kpi-note">탐지 시점 임계값 미제공</small></div>{missingFlow('외부 유출')}
        <div data-ws="panel" role="group" aria-label="계좌 · 소유주"><span>계좌 · 소유주</span><strong>{unavailableEvidence ? '미제공' : <>{facts.accountCount}개 · {facts.unknownOwnerAccountCount ? '확인된 ' : ''}{facts.knownOwnerCount}명</>}</strong><small data-case="kpi-note">{unavailableEvidence ? '근거 거래 미수신' : facts.complete ? '근거 거래 기준' : '확인된 근거만 집계'}{facts.unknownOwnerAccountCount > 0 && <><br />소유주 미확인 계좌 {facts.unknownOwnerAccountCount}개</>}</small></div>
        <div data-ws="panel" role="group" aria-label="기간"><span>기간</span><strong>{periodLabel}</strong><small data-case="kpi-note">근거 거래 기준 · KST{facts.period && <><br /><time dateTime={facts.period.start}>{timestamp(facts.period.start)}</time><br />~ <time dateTime={facts.period.end}>{timestamp(facts.period.end)}</time></>}</small></div>{missingFlow('외부 유입')}{missingFlow('순유입')}{missingFlow('경유 비율')}
      </section></>}
    {!facts.complete && <p data-ws="notice">{unavailableEvidence ? '근거 거래를 불러오지 못했습니다. 계좌·소유주와 전체 기간은 미제공으로 표시합니다.' : '일부 근거 거래를 불러오지 못했습니다. 전체 기간은 미제공으로 표시합니다.'}</p>}
    <div data-ws="toolbar"><nav aria-label="개요 표시 방식" data-ws="actions"><a href={routeHref(route, { mode: 'all' })} aria-current={!perPanel ? 'page' : undefined}>전체 패널</a><a href={routeHref(route, { mode: 'per' })} aria-current={perPanel ? 'page' : undefined}>패널별</a></nav>{perPanel && <label>표시 패널<select value={panel} onChange={event => { window.location.hash = routeHref(route, { panel: event.target.value }).slice(1) }}>{overviewPanels.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>}</div>
    <div data-overview="panels" data-mode={perPanel ? 'per' : 'all'}>
      {perPanel ? renderPanel(panel) : <><div data-overview-row="short">{(['summary', 'accounts', 'past', 'history'] as const).map(renderPanel)}</div><div data-overview-row="paired">{(['detection', 'transactions'] as const).map(renderPanel)}</div>{renderPanel('flow')}<div data-overview-row="paired">{(['rules', 'composition'] as const).map(renderPanel)}</div>{renderPanel('scope')}</>}
    </div>
    {!perPanel && <section data-overview="supplementary" aria-label="근거 계좌 및 검토 의견"><CaseAccounts item={item} evidence={evidence} complete={facts.complete} /><CaseReview item={item} editable={editable} /></section>}
    {perPanel && <nav data-overview="pager" aria-label="개요 패널 이동"><Button variant="ghost" size="icon-sm" aria-label="첫 패널" disabled={panelIndex === 0} onClick={() => navigatePanel(0)}><ChevronsLeft /></Button><Button variant="ghost" size="icon-sm" aria-label="이전 패널" disabled={panelIndex === 0} onClick={() => navigatePanel(panelIndex - 1)}><ChevronLeft /></Button><span aria-live="polite">{panelIndex + 1} / {overviewPanels.length} · {overviewPanels[panelIndex][1]}</span><Button variant="ghost" size="icon-sm" aria-label="다음 패널" disabled={panelIndex === overviewPanels.length - 1} onClick={() => navigatePanel(panelIndex + 1)}><ChevronRight /></Button><Button variant="ghost" size="icon-sm" aria-label="마지막 패널" disabled={panelIndex === overviewPanels.length - 1} onClick={() => navigatePanel(overviewPanels.length - 1)}><ChevronsRight /></Button></nav>}
  </>
}

function CaseAccounts({ item, evidence, complete }: { item: WorkspaceCase; evidence: LedgerTransaction[]; complete: boolean }) {
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
  return <section data-case="overview-accounts"><header data-ws="toolbar"><h2>{complete ? '관련 계좌' : '확인된 관련 계좌'} {accounts.length}개</h2><Button variant="secondary" onClick={() => downloadCaseCsv(`${item.displayId}-accounts-page-${currentPage}.csv`, [['계좌 ID', '출금 (건)', '입금 (건)', '사람 이상 판정 거래 (건)'], ...rows.map(row => [row.id, row.outgoing, row.incoming, row.abnormal])])}><Download />현재 페이지 CSV</Button></header>
    {rows.length ? <table data-ws="table"><thead><tr><th>계좌 ID</th><th data-numeric>출금 거래</th><th data-numeric>입금 거래</th><th>사람 판정</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><a href={`#/investigate/ledger?account=${row.id}`}>{row.id}</a></td><td data-numeric>{row.outgoing}건</td><td data-numeric>{row.incoming}건</td><td>{row.abnormal ? <StatusTag preset="abnormal">이상 거래 {row.abnormal}건</StatusTag> : '이상 판정 없음'}</td></tr>)}</tbody></table> : <p data-ws="empty">{complete ? '연결된 계좌가 없습니다.' : '근거 거래를 불러오지 못해 연결 계좌를 확인할 수 없습니다.'}</p>}
    <CaseTablePagination total={accounts.length} page={currentPage} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />
  </section>
}
function CaseHistory({ item }: { item: WorkspaceCase }) {
  return <section data-case="overview-history"><header data-ws="toolbar"><h2>처리 이력 {item.history.length}건</h2><Button variant="secondary" onClick={() => downloadCaseCsv(`${item.displayId}-history.csv`, [['업무 ID', '시각', '담당자', '처리', '사유'], ...item.history.map(entry => [item.displayId, entry.at, entry.actor, entry.action, entry.reason])])}><Download />CSV 다운로드</Button></header>
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
    </section>
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
