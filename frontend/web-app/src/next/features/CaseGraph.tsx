import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, Maximize, Minimize, Pause, Play, RotateCcw, Scan, SkipBack, SkipForward, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { riskBand } from '../dashboard-data'
import { PatternTag, ScoreTag, StatusTag } from '../ui/Tags'
import type { LedgerTransaction, Verdict } from '../workspace-store'
import { buildCaseGraph, caseGraphBudget, downloadTransactionsCsv, type GraphLens } from './case-selectors'

import { CaseFlowCanvas, type CaseFlowControls } from './CaseFlowCanvas'
import type { CaseDirection } from './case-graph-layout'
import '../styles/case-graph-related.css'
import { graphAlertGroups, type AlertGroupSource } from './case-alert-groups'

const riskLabels = { high: '위험', medium: '주의', low: '낮음' }
type TransactionAction = (tx: LedgerTransaction, verdict: Verdict) => void
export function CaseTablePagination({ total, page, pageSize, onPage, onPageSize }: { total: number; page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div data-ws="toolbar" data-case="pagination"><span>총 {total}건 · {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)}건 표시</span><label>페이지당<select aria-label="페이지당 항목 수" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}><option value="25">25건</option><option value="50">50건</option><option value="100">100건</option></select></label><Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전</Button><span>{page} / {pages}페이지</span><Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>다음</Button></div>
}
export function CaseTransactionTable({ rows, name, title = '근거 거래', selectedId, onSelect }: {
  rows: LedgerTransaction[]; name: string; title?: string; selectedId?: number; onSelect: (tx: LedgerTransaction) => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  return <section data-case="transactions">
    <header data-ws="toolbar"><h2>{title} {rows.length}건</h2><Button variant="secondary" onClick={() => downloadTransactionsCsv(visible, `${name}-page-${currentPage}`)}><Download />현재 페이지 CSV</Button></header>
    {rows.length ? <table data-ws="table"><thead><tr><th>거래 ID / 시각</th><th>출금 → 입금 계좌</th><th data-numeric>금액 (USD)</th><th>추정 패턴</th><th>사람 판정 / 모델 점수</th></tr></thead><tbody>
      {visible.map(tx => <tr key={tx.id} data-selected={selectedId === tx.id || undefined}><td><Button variant="ghost" onClick={() => onSelect(tx)}>{tx.displayId}</Button><small data-case="cell-secondary">{new Date(tx.occurredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small></td><td>{tx.fromAccountId} → {tx.toAccountId}</td><td data-numeric>{tx.amountUsd.toLocaleString('ko-KR')}</td><td><PatternTag code={tx.typeCode} probability={tx.probability} /></td><td><div data-ws="actions">{tx.humanVerdict && <StatusTag preset={tx.humanVerdict}>{tx.humanVerdict === 'normal' ? '정상' : '이상'}</StatusTag>}<ScoreTag score={tx.score} /></div></td></tr>)}
    </tbody></table> : <p data-ws="empty">표시할 거래가 없습니다</p>}
    <CaseTablePagination total={rows.length} page={currentPage} pageSize={pageSize} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }} />
  </section>
}

export function CaseTransactionDetail({ tx, editable, onVerdict, onClose }: { tx: LedgerTransaction; editable: boolean; onVerdict: TransactionAction; onClose?: () => void }) {
  return <div data-case="transaction-detail">{onClose ? <header data-ws="toolbar"><h3>{tx.displayId}</h3><Button variant="ghost" size="icon-sm" aria-label="거래 상세 닫기" onClick={onClose}><X /></Button></header> : <h3>{tx.displayId}</h3>}<dl data-case="facts">
    <div><dt>거래 시각</dt><dd>{new Date(tx.occurredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</dd></div>
    <div><dt>출금 계좌</dt><dd>{tx.fromAccountId}</dd></div><div><dt>입금 계좌</dt><dd>{tx.toAccountId}</dd></div>
    <div><dt>금액</dt><dd>{tx.amountUsd.toLocaleString('ko-KR')} USD</dd></div>
    <div><dt>추정 패턴</dt><dd><PatternTag code={tx.typeCode} probability={tx.probability} /></dd></div>
    <div><dt>모델 점수</dt><dd><ScoreTag score={tx.score} /></dd></div>
    <div><dt>사람 판정</dt><dd>{tx.humanVerdict ? <StatusTag preset={tx.humanVerdict}>{tx.humanVerdict === 'normal' ? '정상' : '이상'}</StatusTag> : '판정 전'}</dd></div>
  </dl><div data-ws="actions">
    {tx.humanVerdict !== 'normal' && <Button variant="secondary" disabled={!editable} onClick={editable ? () => onVerdict(tx, 'normal') : undefined}>정상으로 판정</Button>}
    {tx.humanVerdict !== 'abnormal' && <Button variant="secondary" disabled={!editable} onClick={editable ? () => onVerdict(tx, 'abnormal') : undefined}>이상으로 판정</Button>}
  </div></div>
}

type CaseGraphProps = {
  rows: LedgerTransaction[]; ownershipLedger: Map<number, number>; lens: GraphLens; name: string; editable: boolean; onVerdict: TransactionAction
  alertSources?: { groups: AlertGroupSource[]; missingIds: number[] };
  layout?: 'analysis' | 'related'; scopeControls?: ReactNode; showTransactions?: boolean
}
export function CaseGraph(props: CaseGraphProps) {
  if (props.rows.length > caseGraphBudget.transactions) return <section data-ws="notice" role="status"><h2>서버 범위 조회가 필요합니다</h2><p>이 업무의 거래 {props.rows.length.toLocaleString('ko-KR')}건이 로컬 분석 한도 {caseGraphBudget.transactions.toLocaleString('ko-KR')}건을 초과했습니다. 서버에서 기간·계좌 범위를 좁힌 이웃 조회가 필요합니다. 현재 서버 조회는 연결되지 않았습니다.</p></section>
  return <BoundedCaseGraph {...props} />
}
function BoundedCaseGraph({ rows, ownershipLedger, lens, name, editable, onVerdict, layout = 'analysis', scopeControls, showTransactions = true, alertSources }: CaseGraphProps) {
  const [risks, setRisks] = useState({ high: true, medium: true, low: true })
  const [position, setPosition] = useState(rows.length)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [moving, setMoving] = useState(true)
  const [direction, setDirection] = useState<CaseDirection>('RIGHT')
  const [zoom, setZoom] = useState(1)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [selectedTx, setSelectedTx] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [message, setMessage] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [period, setPeriod] = useState({ start: '', end: '' })
  const [search, setSearch] = useState('')
  const analysis = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const controls = useRef<CaseFlowControls>(null)
  const transactionTrigger = useRef<HTMLButtonElement | null>(null)
  const filtered = useMemo(() => rows.filter(tx => risks[tx.humanVerdict === 'abnormal' ? 'high' : riskBand(tx.score)] && (!period.start || tx.date >= period.start) && (!period.end || tx.date <= period.end)).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id), [rows, risks, period])
  const cursor = Math.min(position, filtered.length)
  const visible = useMemo(() => filtered.slice(0, cursor), [filtered, cursor])
  const topology = useMemo(() => buildCaseGraph(filtered, lens, ownershipLedger), [filtered, lens, ownershipLedger])
  const graph = useMemo(() => buildCaseGraph(visible, lens, ownershipLedger), [visible, lens, ownershipLedger])
  const alertGroups = useMemo(() => graphAlertGroups(alertSources?.groups ?? [], graph.edges), [alertSources, graph.edges])
  const sharedNodes = graph.nodes.filter(node => alertGroups.filter(group => group.nodeIds.includes(node.id)).length > 1).length
  const sharedEdges = graph.edges.filter(edge => alertGroups.filter(group => group.edgeIds.includes(edge.id)).length > 1).length
  const sharedTransactions = visible.filter(tx => alertGroups.filter(group => group.transactionIds.includes(tx.id)).length > 1).length
  const chosenNode = graph.nodes.find(node => node.id === selectedNode)
  const chosenEdge = graph.edges.find(edge => edge.id === selectedEdge)
  const edgeIds = useMemo(() => new Set(chosenEdge?.transactionIds), [chosenEdge])
  const visibleRows = chosenEdge ? visible.filter(tx => edgeIds.has(tx.id)) : chosenNode ? visible.filter(tx => chosenNode.accountIds.includes(tx.fromAccountId) || chosenNode.accountIds.includes(tx.toAccountId)) : visible
  const explicitlySelectedTx = visibleRows.find(tx => tx.id === selectedTx)
  const chosenTx = explicitlySelectedTx ?? (chosenNode || chosenEdge ? visibleRows.at(-1) : undefined)
  const clearSelection = useCallback(() => { setSelectedNode(null); setSelectedEdge(null); setSelectedTx(null) }, [])
  const closeTransaction = () => {
    const trigger = selectedTx !== null ? transactionTrigger.current : null
    clearSelection()
    window.requestAnimationFrame(() => {
      const inFullscreen = document.fullscreenElement === surface.current
      const target = inFullscreen ? surface.current?.querySelector<HTMLSelectElement>('[aria-label="연결 선택"]') : trigger?.isConnected ? trigger : analysis.current?.querySelector<HTMLButtonElement>('[data-case="transactions"] tbody button') ?? (layout === 'related' || !showTransactions ? surface.current?.querySelector<HTMLSelectElement>('[aria-label="연결 선택"]') : null)
      if (target?.isConnected && !target.matches(':disabled, [aria-disabled="true"]') && !target.closest('[inert]')) target.focus({ preventScroll: !inFullscreen })
    })
  }
  const chooseNode = useCallback((id: string) => { setSelectedNode(id); setSelectedEdge(null); setSelectedTx(null) }, [])
  const chooseEdge = useCallback((id: string) => { setSelectedEdge(id); setSelectedNode(null); setSelectedTx(null) }, [])
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      setPosition(Math.min(cursor + 1, filtered.length))
      if (cursor + 1 >= filtered.length) setPlaying(false)
    }, 1000 / speed)
    return () => window.clearTimeout(timer)
  }, [playing, cursor, filtered.length, speed])
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === surface.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === surface.current) await document.exitFullscreen()
      else if (surface.current?.requestFullscreen) await surface.current.requestFullscreen()
      else setMessage('이 브라우저는 전체 화면을 지원하지 않습니다.')
    } catch { setMessage('전체 화면을 열 수 없습니다. 브라우저 설정을 확인해 주세요.') }
  }
  const step = (delta: number) => { setPlaying(false); setPosition(Math.min(filtered.length, Math.max(0, cursor + delta))) }
  return <div data-case="analysis" data-graph-layout={layout} ref={analysis}>
    <div data-case="analysis-layout" ref={surface}>
      <aside data-case="analysis-side">
        {scopeControls && <div data-case="graph-scope">{scopeControls}</div>}
        <h2>표시 조건</h2><fieldset data-case="risk-filters"><legend>거래 위험도</legend>{(['high', 'medium', 'low'] as const).map(risk => <label key={risk}><input type="checkbox" checked={risks[risk]} onChange={() => { setRisks(previous => ({ ...previous, [risk]: !previous[risk] })); setPlaying(false); setPosition(rows.length); clearSelection() }} />{riskLabels[risk]}</label>)}</fieldset>
        <form data-case="graph-period" aria-label="분석 기간" onSubmit={event => { event.preventDefault(); if (draftStart && draftEnd && draftStart > draftEnd) { setMessage('종료일은 시작일 이후여야 합니다.'); return } setPeriod({ start: draftStart, end: draftEnd }); setPlaying(false); setPosition(rows.length); clearSelection(); setMessage('') }}><label>거래 시작일<input type="date" value={draftStart} onChange={event => setDraftStart(event.target.value)} /></label><label>거래 종료일<input type="date" value={draftEnd} onChange={event => setDraftEnd(event.target.value)} /></label><Button variant="secondary" type="submit">기간 적용</Button></form>
        <form data-case="graph-period" aria-label="노드 찾기" onSubmit={event => { event.preventDefault(); const query = search.trim(); const node = graph.nodes.find(n => query && (n.id.split(':')[1] === query || n.label.includes(query))); if (!node) { setMessage('현재 표시 범위에서 계좌 또는 소유주를 찾을 수 없습니다.'); return } chooseNode(node.id); controls.current?.focus(node.id); setMessage('') }}><label>계좌·소유주 찾기<input value={search} onChange={event => setSearch(event.target.value)} placeholder={lens === 'owner' ? '소유주 ID' : '계좌 ID'} /></label><Button variant="secondary" type="submit">찾아서 이동</Button></form>
        <p data-ws="muted">계좌를 끌어 배치하고 빈 공간을 끌어 이동합니다. 휠로 확대하며, 연결을 선택하면 해당 거래만 확인합니다. 선 굵기는 USD 금액, 화살표는 자금 방향입니다.</p>
      </aside>
      <div data-case="graph-area">
        {message && <p role="alert" data-ws="error">{message}</p>}
        {graph.status === 'ready' && (graph.omittedNodes > 0 || graph.omittedEdges > 0) && <p data-ws="notice" role="status">선택 업무의 일부만 표시합니다: 노드 {graph.nodes.length}개 / 최대 200개, 연결 {graph.edges.length}개 / 최대 400개. 생략: 노드 {graph.omittedNodes}개, 연결 {graph.omittedEdges}개, 거래 {graph.omittedTransactions}건. 기간이나 계좌로 조회 범위를 좁혀 주세요.</p>}
        {alertSources && <section data-case="alert-group-legend" aria-label="Alert 그룹 소속">
          <strong>Alert 묶음 {alertSources.groups.length}개</strong><p>실제 소속 교집합: 공유 노드 {sharedNodes}개 · 공유 연결 {sharedEdges}개 · 공통 거래 {sharedTransactions}건</p>
          <p>외곽선은 묶음의 시각적 범위입니다. 겹친 면 자체는 관계의 근거가 아니며, 공유 소속은 노드·연결의 Alert 개수로 확인합니다.</p>
          {alertGroups.map((group,index) => <span key={group.id} data-group-tone={index % 3}>{group.label} · 표시 거래 {group.transactionIds.length}건 · 노드 {group.nodeIds.length}개</span>)}
          {!alertSources.groups.length && <p>확인 가능한 Alert 구성 정보가 없습니다.</p>}
          {!!alertSources.missingIds.length && <p role="status">연결된 Alert {alertSources.missingIds.join(', ')}의 상세가 없어 해당 영역을 표시하지 않습니다.</p>}
        </section>}
        <div data-case="graph-options"><label>배치 방향<select aria-label="배치 방향" value={direction} onChange={event => setDirection(event.target.value as CaseDirection)}><option value="RIGHT">왼쪽에서 오른쪽</option><option value="DOWN">위에서 아래</option></select></label><Button variant="secondary" onClick={() => controls.current?.arrange()}>다시 배치</Button><label>연결 선택<select aria-label="연결 선택" value={chosenEdge?.id ?? ''} onChange={event => event.target.value ? chooseEdge(event.target.value) : clearSelection()}><option value="">연결선 선택</option>{graph.edges.map(edge => <option key={edge.id} value={edge.id}>{graph.nodes.find(n => n.id === edge.source)?.label} → {graph.nodes.find(n => n.id === edge.target)?.label} · {edge.count}건</option>)}</select></label><label><input type="checkbox" checked={moving} onChange={event => setMoving(event.target.checked)} />흐름 애니메이션</label><span data-ws="muted">{graph.nodes.length}노드 · {graph.edges.length}연결</span></div>
        {topology.nodes.length ? <CaseFlowCanvas alertGroups={alertGroups} topology={topology} visible={graph} direction={direction} selectedNode={chosenNode?.id ?? null} selectedEdge={chosenEdge?.id ?? null} highlightedTransactionId={explicitlySelectedTx?.id} moving={moving} controls={controls} onNode={chooseNode} onEdge={chooseEdge} onClear={clearSelection} onZoom={setZoom} /> : <p data-ws="empty">표시할 거래가 없습니다</p>}
        {!cursor && topology.nodes.length > 0 && <p data-ws="notice" role="status">재생 시작 전입니다. 다음 거래 또는 재생을 눌러 주세요.</p>}
        <div data-case="graph-controls">
          <div data-case="playback">
            <Button variant="secondary" size="icon-sm" aria-label={playing ? '거래 재생 일시 정지' : '거래 재생'} disabled={!filtered.length} onClick={() => { if (cursor >= filtered.length) setPosition(0); setPlaying(!playing) }}>{playing ? <Pause /> : <Play />}</Button>
            <Button variant="ghost" size="icon-sm" aria-label="거래 재생 처음으로" onClick={() => { setPosition(0); setPlaying(false) }}><RotateCcw /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="이전 거래" disabled={cursor === 0} onClick={() => step(-1)}><SkipBack /></Button><Button variant="ghost" size="icon-sm" aria-label="다음 거래" disabled={cursor === filtered.length} onClick={() => step(1)}><SkipForward /></Button>
            <input type="range" min="0" max={filtered.length} value={cursor} aria-label="거래 재생 위치" onChange={event => { setPosition(Number(event.target.value)); setPlaying(false) }} />
            <span>{cursor} / {filtered.length}건</span><label data-case="speed">재생 속도<select aria-label="재생 속도" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value="1">1배</option><option value="2">2배</option><option value="4">4배</option></select></label>
          </div>
          <div data-case="zoom-controls">
            <Button variant="ghost" size="icon-sm" aria-label="축소" disabled={zoom <= .25} onClick={() => controls.current?.zoomBy(1 / 1.25)}><ZoomOut /></Button><span>{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon-sm" aria-label="확대" disabled={zoom >= 3} onClick={() => controls.current?.zoomBy(1.25)}><ZoomIn /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="화면에 맞추기" onClick={() => controls.current?.fit()}><Scan /></Button><Button variant="ghost" size="icon-sm" aria-label={fullscreen ? '전체 화면 종료' : '전체 화면'} onClick={toggleFullscreen}>{fullscreen ? <Minimize /> : <Maximize />}</Button>
          </div>
        </div>
      </div>
      {(layout === 'analysis' || chosenNode || chosenEdge || chosenTx) && <aside data-case="analysis-detail" aria-label="조사 상세">
        {chosenNode && <><h3>{chosenNode.label}</h3><p>연결 계좌 {chosenNode.accountIds.join(', ')}</p><Button variant="secondary" onClick={closeTransaction}>{chosenNode.id.startsWith('owner:') ? '소유주' : '계좌'} 선택 해제</Button></>}
        {chosenEdge && <><h3>선택 연결</h3><p>{graph.nodes.find(n => n.id === chosenEdge.source)?.label} → {graph.nodes.find(n => n.id === chosenEdge.target)?.label}</p><p>{chosenEdge.count}건 · {chosenEdge.amountUsd.toLocaleString('ko-KR')} USD · {riskLabels[chosenEdge.risk]}</p><Button variant="secondary" onClick={closeTransaction}>연결 선택 해제</Button></>}
        {chosenTx && <CaseTransactionDetail tx={chosenTx} editable={editable} onVerdict={onVerdict} onClose={closeTransaction} />}
        {!chosenNode && !chosenEdge && !chosenTx && <p data-ws="empty">계좌 또는 거래를 선택하세요.</p>}
      </aside>}
    </div>
    {showTransactions && <CaseTransactionTable rows={visibleRows} name={name} title={chosenEdge ? '선택 연결 거래' : chosenNode ? `${chosenNode.label} 연결 거래` : '분석 거래'} selectedId={chosenTx?.id} onSelect={tx => { transactionTrigger.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null; setSelectedTx(tx.id) }} />}
  </div>
}
