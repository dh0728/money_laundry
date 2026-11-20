import { useState, type FormEvent } from 'react'
import { Download, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { snapshot } from '../dashboard-data'
import { useWorkspace, caseHref, type JudgmentRecord } from '../workspace-store'
import { FilterTag } from '../ui/FilterTag'
import { PageHeaderActions } from '../ui/PageHeaderActions'
import { StatusTag } from '../ui/Tags'
import { downloadCsv, downloadJudgmentPdf, MAX_PDF_JUDGMENTS } from './report-io'
import { filterJudgments, paginateJudgments, selectedJudgments, validReportDate, verdictLabel, type ReportFilters } from './report-model'
import '../styles/report.css'

function readFilters(route: URL): ReportFilters {
  const verdict = route.searchParams.get('verdict')
  const start = route.searchParams.get('start') ?? ''
  const end = route.searchParams.get('end') ?? ''
  return { query: route.searchParams.get('q') ?? '', verdict: verdict === 'normal' || verdict === 'abnormal' ? verdict : '',
    start: validReportDate(start) ? start : '', end: validReportDate(end) ? end : '' }
}

function ReportPeriod({ start, end, onApply }: { start: string; end: string; onApply: (start: string, end: string) => void }) {
  const [draftStart, setStart] = useState(start)
  const [draftEnd, setEnd] = useState(end)
  const [error, setError] = useState('')
  const preset = (days: number | 'month') => {
    const today = snapshot.date
    const first = new Date(`${today}T00:00:00Z`)
    if (days === 'month') first.setUTCDate(1)
    else first.setUTCDate(first.getUTCDate() - days + 1)
    setStart(first.toISOString().slice(0, 10)); setEnd(today); setError('')
  }
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if ((draftStart && !validReportDate(draftStart)) || (draftEnd && !validReportDate(draftEnd)) || (draftStart && draftEnd && draftStart > draftEnd)) { setError('시작일과 종료일을 확인해 주세요.'); return }
    onApply(draftStart, draftEnd)
    event.currentTarget.closest('details')?.removeAttribute('open')
  }
  return <details data-part="period-popover">
    <summary>판정 기간: {start || end ? `${start || '전체'} ~ ${end || '전체'}` : '전체'}</summary>
    <form aria-label="보고서 판정 기간" onSubmit={apply}>
      <p data-ws="muted">샘플 기준일 {snapshot.date}</p>
      <div data-part="period-presets">{([['오늘', 1], ['최근 3일', 3], ['최근 7일', 7], ['최근 30일', 30], ['이번 달', 'month']] as const).map(([label, days]) => <Button key={label} type="button" variant="secondary" onClick={() => preset(days)}>{label}</Button>)}</div>
      <label>시작일<input type="date" value={draftStart} onChange={event => setStart(event.target.value)} /></label>
      <label>종료일<input type="date" value={draftEnd} onChange={event => setEnd(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <Button type="submit">적용</Button>
    </form>
  </details>
}

function ReportCases({ judgment }: { judgment: JudgmentRecord }) {
  return <div data-report="case-links">{judgment.displayIds.map((id, index) => {
    const record = judgment.cases.find(item => item.displayId === id)
    return record ? <a key={id} href={caseHref(record)}>{id}</a> : <span key={`${id}-${index}`}>{id}</span>
  })}</div>
}

export function ReportPage({ route }: { route: URL }) {
  const { judgments } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [retryFor, setRetryFor] = useState('')
  const filters = readFilters(route)
  const view = route.searchParams.get('view') === 'cards' ? 'cards' : 'table'
  const previewState = route.searchParams.get('state') ?? new URLSearchParams(window.location.search).get('state')
  if (previewState !== 'error' && retryFor) setRetryFor('')
  const refetchFailed = previewState === 'error' && retryFor !== route.href
  const loading = previewState === 'loading'
  const [lastSuccess, setLastSuccess] = useState({ records: judgments, empty: previewState === 'empty' })
  if (previewState !== 'error' && !loading && (lastSuccess.records !== judgments || lastSuccess.empty !== (previewState === 'empty'))) setLastSuccess({ records: judgments, empty: previewState === 'empty' })
  const source = refetchFailed ? lastSuccess.records : judgments
  const empty = previewState === 'empty' || (refetchFailed && lastSuccess.empty)
  const page = paginateJudgments(filterJudgments(empty || loading ? [] : source, filters), route.searchParams.has('page') ? Number(route.searchParams.get('page')) : null, Number(route.searchParams.get('pageSize') ?? 25), route.searchParams.get('selected') ?? '')
  const rows = page.rows
  const selected = selectedJudgments(rows, route.searchParams.get('selected') ?? '')
  const selectedIds = new Set(selected.map(row => row.id))
  const hasFilters = [filters.query, filters.verdict, filters.start || filters.end].filter(Boolean).length
  const update = (changes: Record<string, string>) => {
    const next = new URL(route)
    next.searchParams.set('page', String(page.page))
    Object.entries(changes).forEach(([key, value]) => { if (value) next.searchParams.set(key, value); else next.searchParams.delete(key) })
    if (Object.keys(changes).some(key => ['q', 'verdict', 'start', 'end', 'pageSize'].includes(key))) next.searchParams.set('page', '1')
    const visible = paginateJudgments(filterJudgments(judgments, readFilters(next)), Number(next.searchParams.get('page') ?? 1), Number(next.searchParams.get('pageSize') ?? 25)).rows
    const selection = selectedJudgments(visible, next.searchParams.get('selected') ?? '').map(row => row.id).join(',')
    if (selection) next.searchParams.set('selected', selection)
    else next.searchParams.delete('selected')
    window.location.assign(`#${next.pathname}${next.search}`)
  }
  const toggle = (row: JudgmentRecord) => update({ selected: selectedIds.has(row.id) ? selected.filter(item => item.id !== row.id).map(item => item.id).join(',') : [...selected.map(item => item.id), row.id].join(',') })
  const selectAll = () => update({ selected: selected.length === rows.length ? '' : rows.map(row => row.id).join(',') })
  const downloadPdf = async () => {
    setBusy(true); setMessage(null)
    try { await downloadJudgmentPdf(selected); setMessage({ text: `${selected.length}건의 판정 보고서를 하나의 PDF로 다운로드했습니다.` }) }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'PDF 다운로드에 실패했습니다. 다시 시도해 주세요.', error: true }) }
    finally { setBusy(false) }
  }
  const csv = () => {
    try {
      downloadCsv('AML-RADAR-판정기록.csv', ['판정 ID', '판정 시각', '검토자', '사람 판정', '대상 ID', '대상 거래 ID', '판정 사유', 'AI 보고서 샘플'], rows.map(row => [row.id, row.at, row.reviewer, verdictLabel(row.verdict), row.displayIds.join('; '), row.transactionIds.join('; '), row.reason, row.reportText]))
      setMessage({ text: `현재 페이지 ${rows.length}건을 CSV로 다운로드했습니다.` })
    } catch { setMessage({ text: 'CSV 다운로드에 실패했습니다. 다시 시도해 주세요.', error: true }) }
  }
  const viewHref = (nextView: string) => { const next = new URL(route); next.searchParams.set('view', nextView); next.searchParams.set('page', String(page.page)); return `#${next.pathname}${next.search}` }
  return <section data-report="page" aria-label="판정 보고서">
    <PageHeaderActions>
      <nav data-part="scope-switch" aria-label="보고서 보기"><a href={viewHref('table')} aria-current={view === 'table' ? 'page' : undefined}>표 보기</a><a href={viewHref('cards')} aria-current={view === 'cards' ? 'page' : undefined}>카드 보기</a></nav>
      <Button variant="secondary" disabled={!rows.length || busy} onClick={csv}><Download aria-hidden="true" />현재 페이지 CSV</Button>
      <Button disabled={!selected.length || selected.length > MAX_PDF_JUDGMENTS} aria-disabled={busy || undefined} onClick={selected.length && selected.length <= MAX_PDF_JUDGMENTS && !busy ? downloadPdf : undefined}><FileDown aria-hidden="true" />{busy ? 'PDF 만드는 중' : `선택 ${selected.length}건 PDF 다운로드`}</Button>
    </PageHeaderActions>
    <header data-report="title-row"><h2>판정 기록 {rows.length}건</h2><p data-ws="muted">전체 {page.total}건</p></header>
    <div data-report="filters">
    <div data-ws="toolbar" data-report="filter-controls">
      <label data-report="search"><span data-ws="sr-only">판정 기록 검색</span><input type="search" value={filters.query} placeholder="판정 ID, 대상 ID, 검토자, 사유" onChange={event => update({ q: event.target.value })} /></label>
      <label><span data-ws="sr-only">사람 판정</span><select value={filters.verdict} onChange={event => update({ verdict: event.target.value })}><option value="">전체</option><option value="normal">정상</option><option value="abnormal">이상</option></select></label>
      <ReportPeriod key={`${filters.start}-${filters.end}`} start={filters.start ?? ''} end={filters.end ?? ''} onApply={(start, end) => update({ start, end })} />
    </div>

    {hasFilters > 0 && <div data-ws="actions" aria-label="적용된 보고서 필터">
      {filters.query && <FilterTag label={`검색: ${filters.query}`} onRemove={() => update({ q: '' })} />}
      {filters.verdict && <FilterTag label={`판정: ${verdictLabel(filters.verdict)}`} onRemove={() => update({ verdict: '' })} />}
      {(filters.start || filters.end) && <FilterTag label={`기간: ${filters.start || '전체'} ~ ${filters.end || '전체'}`} onRemove={() => update({ start: '', end: '' })} />}
      {hasFilters >= 2 && <Button variant="ghost" onClick={() => update({ q: '', verdict: '', start: '', end: '' })}>필터 전체 해제</Button>}
    </div>}
    </div>
    <aside data-ws="notice" data-report="sample-notice"><p>AI 보고서 샘플입니다. 판정 당시의 고정된 근거로 구성하며 실제 AI 모델을 실행하지 않습니다.</p><p data-ws="muted">샘플 PDF는 한 번에 최대 {MAX_PDF_JUDGMENTS}건·100쪽입니다. 더 큰 범위의 PDF·CSV는 서버의 비동기 내보내기 작업이 필요합니다.</p></aside>
    {refetchFailed && <div role="alert" data-ws="error">재조회에 실패했습니다. 마지막으로 불러온 판정 기록을 표시합니다.<Button variant="ghost" onClick={() => setRetryFor(route.href)}>다시 시도</Button></div>}
    {message && <p role={message.error ? 'alert' : 'status'} data-ws={message.error ? 'error' : 'notice'}>{message.text}</p>}
    <section data-ws="panel" data-report="results" aria-label="판정 기록 목록">
    {!loading && rows.length > 0 && <header data-report="panel-header"><div data-ws="selection"><label data-report="checkbox"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={selected.length === rows.length} ref={node => { if (node) node.indeterminate = selected.length > 0 && selected.length < rows.length }} disabled={busy} onChange={selectAll} />현재 페이지 전체 선택</label><span aria-live="polite">현재 페이지 {rows.length}건 중 {selected.length}건 선택</span>{selected.length > 0 && <Button variant="ghost" onClick={() => update({ selected: '' })} disabled={busy}>선택 해제</Button>}</div></header>}
    <div data-report="panel-body">
    {loading ? <div data-ws="empty" role="status">판정 기록을 불러오는 중입니다.</div> : !rows.length ? <div data-ws="empty"><h3>조건에 맞는 판정 기록이 없습니다</h3><p>판정을 완료하거나 검색과 필터 조건을 변경해 주세요.</p></div> : <>
      {view === 'table' ? <table data-ws="table" data-report="table"><caption data-ws="sr-only">판정 기록 {rows.length}건</caption><thead><tr><th scope="col">선택</th><th scope="col">판정 ID</th><th scope="col">사람 판정</th><th scope="col">대상 ID</th><th scope="col">검토자</th><th scope="col">판정 시각</th><th scope="col">판정 사유</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-selected={selectedIds.has(row.id)}><td><input type="checkbox" aria-label={`${row.id} 선택`} checked={selectedIds.has(row.id)} disabled={busy} onChange={() => toggle(row)} /></td><th scope="row">{row.id}</th><td><StatusTag preset={row.verdict}>{verdictLabel(row.verdict)}</StatusTag></td><td><ReportCases judgment={row} /></td><td>{row.reviewer}</td><td><time dateTime={row.at}>{new Date(row.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time></td><td>{row.reason}</td></tr>)}</tbody></table> : <div data-report="cards">{rows.map(row => <article key={row.id} data-report="card" data-selected={selectedIds.has(row.id)} aria-label={row.id}>
        <header><label data-report="checkbox"><input type="checkbox" aria-label={`${row.id} 선택`} checked={selectedIds.has(row.id)} disabled={busy} onChange={() => toggle(row)} /><strong>{row.id}</strong></label><StatusTag preset={row.verdict}>{verdictLabel(row.verdict)}</StatusTag></header>
        <dl><div><dt>대상</dt><dd><ReportCases judgment={row} /></dd></div><div><dt>검토자</dt><dd>{row.reviewer}</dd></div><div><dt>판정 시각</dt><dd><time dateTime={row.at}>{new Date(row.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time></dd></div><div><dt>판정 사유</dt><dd>{row.reason}</dd></div></dl>
        <details><summary>AI 보고서 샘플 보기</summary><p data-report="text">{row.reportText}</p></details>
      </article>)}</div>}
    </>}
    </div></section>
    <nav data-ws="toolbar" data-report="table-footer" aria-label="판정 기록 페이지"><p>전체 {page.total}건 · {page.start}~{page.end}건 표시</p><label>페이지당 기록<select value={page.pageSize} onChange={event => update({ pageSize: event.target.value })}><option value="25">25건</option><option value="50">50건</option><option value="100">100건</option></select></label><Button variant="ghost" disabled={page.page <= 1 || busy} onClick={() => update({ page: String(page.page - 1) })}>이전 페이지</Button><span>{page.page} / {page.pageCount}페이지</span><Button variant="ghost" disabled={page.page >= page.pageCount || busy} onClick={() => update({ page: String(page.page + 1) })}>다음 페이지</Button></nav>
  </section>
}
