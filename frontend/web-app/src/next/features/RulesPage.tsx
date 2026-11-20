import { useMemo, useState, type FormEvent } from 'react'
import { Download, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { useWorkspace, type LedgerTransaction, type RuleInput, type RuleRecord, type RuleStatus } from '../workspace-store'
import { PageHeaderActions } from '../ui/PageHeaderActions'
import { WorkspaceDialog } from '../ui/WorkspaceDialog'
import { FilterTag } from '../ui/FilterTag'
import { PatternTag, ScoreTag } from '../ui/Tags'
import { downloadRulesCsv, filterRules, MAX_LOCAL_BACKTEST_TRANSACTIONS, ruleStatusLabels, ruleTransitions, runBacktest, validatePeriod, validateRule, rulesPagination, type RulePeriod } from './rules-logic'
import '../styles/rules.css'

const typeCodes: TypeCode[] = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const blankRule: RuleInput = { name: '', description: '', typeCode: null, scoreMin: .7, minTransactions: 2, windowHours: 24 }
const editable = (rule: RuleRecord) => ['DRAFT', 'REJECTED', 'STOPPED'].includes(rule.status)
const transitionLabels: Record<RuleStatus, string> = { DRAFT: '초안으로 되돌리기', PENDING_APPROVAL: '승인 요청', TESTING: '테스트 시작', ACTIVE: '운영 시작', STOPPED: '운영 중지', REJECTED: '반려' }
function navigate(route: URL, values: Record<string, string>) {
  const next = new URL(route)
  Object.entries(values).forEach(([key, value]) => value ? next.searchParams.set(key, value) : next.searchParams.delete(key))
  window.history.pushState(null, '', `#${next.pathname}${next.search}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
function Condition({ rule }: { rule: RuleInput }) {
  return <p data-ws="muted">{rule.typeCode === null ? '모든 유형' : typeDisplay(rule.typeCode).key} · 점수 {Number.isFinite(rule.scoreMin) ? rule.scoreMin.toFixed(2) : '값 없음'} 이상 · {Number.isFinite(rule.windowHours) ? rule.windowHours : '값 없음'}시간 내 {Number.isFinite(rule.minTransactions) ? rule.minTransactions : '값 없음'}건 이상</p>
}
function RulePagination({ total, pagination, onChange, unit }: { total: number; pagination: ReturnType<typeof rulesPagination>; onChange: (page: number, pageSize: number) => void; unit: string }) {
  return <nav aria-label="결과 페이지" data-ws="toolbar"><span>{pagination.start}–{pagination.end} / {total.toLocaleString('ko-KR')}{unit}</span><label>페이지당 행 수<select aria-label="페이지당 행 수" value={pagination.pageSize} onChange={event => onChange(1, Number(event.target.value))}>{[...new Set([25, 50, 100, pagination.pageSize])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}행</option>)}</select></label><div data-ws="actions"><Button variant="secondary" disabled={pagination.page === 1} onClick={() => onChange(pagination.page - 1, pagination.pageSize)}>이전 페이지</Button><span>{pagination.page} / {pagination.pageCount} 페이지</span><Button variant="secondary" disabled={pagination.page === pagination.pageCount} onClick={() => onChange(pagination.page + 1, pagination.pageSize)}>다음 페이지</Button></div></nav>
}
export function RulesPage({ route }: { route: URL }) {
  const { rules } = useWorkspace()
  if (route.pathname === '/rules/new') {
    const existingId = route.searchParams.get('edit')
    const rule = rules.find(item => item.id === existingId)
    return existingId && !rule ? <MissingRule /> : <RuleEditor key={existingId ?? 'new'} rule={rule} />
  }
  const backtestId = route.pathname.match(/^\/rules\/([^/]+)\/backtest$/)?.[1]
  if (backtestId) {
    let decodedId: string
    try { decodedId = decodeURIComponent(backtestId) } catch { return <MissingRule /> }
    const rule = rules.find(item => item.id === decodedId)
    return rule ? <RuleBacktest key={rule.id} rule={rule} route={route} /> : <MissingRule />
  }
  return <RuleList route={route} />
}
function MissingRule() {
  return <section data-ws="empty"><h2>룰을 찾을 수 없습니다</h2><p>목록에서 현재 룰을 선택해 주세요.</p><Button asChild variant="secondary"><a href="#/rules">룰 목록</a></Button></section>
}
function RuleList({ route }: { route: URL }) {
  const { rules, transitionRule } = useWorkspace()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [target, setTarget] = useState<RuleStatus | null>(null)
  const [reason, setReason] = useState('')
  const query = route.searchParams.get('q') ?? ''
  const rawStatus = route.searchParams.get('status') ?? ''
  const status = rawStatus in ruleStatusLabels ? rawStatus : ''
  const scenario = route.searchParams.get('state')
  const [snapshot, setSnapshot] = useState({ rules, empty: scenario === 'empty' })
  if (scenario !== 'error' && scenario !== 'loading' && (snapshot.rules !== rules || snapshot.empty !== (scenario === 'empty'))) setSnapshot({ rules, empty: scenario === 'empty' })
  const visible = (scenario === 'error' ? snapshot.empty : scenario === 'empty') ? [] : filterRules(scenario === 'error' ? snapshot.rules : rules, query, status)
  const pagination = rulesPagination(visible.length, route.searchParams.get('page'), route.searchParams.get('pageSize'))
  const pageRows = visible.slice(pagination.offset, pagination.offset + pagination.pageSize)
  const selected = rules.find(rule => rule.id === route.searchParams.get('selected'))
  const csv = () => downloadRulesCsv('aml-rules-sample.csv', [['룰 ID', '이름', '상태', '유형', '최소 점수', '최소 거래 건수', '시간 창(시간)', '작성자', '버전'], ...pageRows.map(rule => [rule.id, rule.name, ruleStatusLabels[rule.status], rule.typeCode === null ? '전체 유형' : typeDisplay(rule.typeCode).key, rule.scoreMin, rule.minTransactions, rule.windowHours, rule.author, rule.version])])
  const applySearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); navigate(route, { q: String(new FormData(event.currentTarget).get('q') ?? '').trim(), page: '1' }) }
  function transition() {
    if (!selected || !target || !reason.trim()) return
    const result = transitionRule(selected.id, target, reason.trim())
    if (!result.ok) { setError(result.error); return }
    setNotice(`${selected.id} 상태가 ${ruleStatusLabels[target]}(으)로 변경되었습니다.`); setError(''); setTarget(null); setReason('')
  }
  return <>
    <PageHeaderActions><Button variant="secondary" onClick={csv}><Download />현재 페이지 CSV</Button><Button asChild><a href="#/rules/new"><Plus />룰 만들기</a></Button></PageHeaderActions>
    <div data-ws="toolbar"><h2>룰 {visible.length}개</h2><form aria-label="룰 검색" data-ws="actions" onSubmit={applySearch}><input key={query} name="q" defaultValue={query} aria-label="룰 검색어" placeholder="룰 이름, ID, 작성자 검색" /><Button type="submit" variant="secondary">검색</Button></form><label>상태<select aria-label="룰 상태 필터" value={status} onChange={event => navigate(route, { status: event.target.value, page: '1' })}><option value="">전체 상태</option>{Object.entries(ruleStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    <div data-ws="actions">{query && <FilterTag label={`검색: ${query}`} onRemove={() => navigate(route, { q: '', page: '1' })} />}{status && <FilterTag label={`상태: ${ruleStatusLabels[status as RuleStatus]}`} onRemove={() => navigate(route, { status: '', page: '1' })} />}{query && status && <Button variant="ghost" onClick={() => navigate(route, { q: '', status: '', page: '1' })}>전체 해제</Button>}</div>
    <p data-ws="muted">샘플 룰 · 변경 사항은 현재 브라우저 세션에서 공유됩니다. 운영 데이터는 서버 검색과 커서 페이지 조회가 필요합니다.</p>
    {notice && <p role="status" data-ws="notice">{notice}</p>}{error && <p role="alert" data-ws="error">{error}</p>}
    {scenario === 'error' && <div role="alert" data-ws="notice">재조회에 실패했습니다. 마지막 룰 목록을 유지합니다. <Button variant="ghost" onClick={() => navigate(route, { state: '' })}>다시 시도</Button></div>}
    {scenario === 'loading' ? <p role="status" data-ws="empty">룰 목록을 불러오는 중입니다.</p> : <div data-rules="list-layout" data-detail={Boolean(selected)}><section aria-label="룰 목록">
      {visible.length === 0 ? <div data-ws="empty"><h3>조건에 맞는 룰이 없습니다</h3><p>검색 조건을 바꾸거나 새 룰을 만들어 주세요.</p><Button asChild><a href="#/rules/new">룰 만들기</a></Button></div> : <table data-ws="table" data-rules="rule-table"><thead><tr><th scope="col">룰 ID · 이름</th><th scope="col">조건</th><th scope="col">상태</th><th scope="col">작성자 · 수정일</th><th scope="col">작업</th></tr></thead><tbody>{pageRows.map(rule => <tr key={rule.id} data-selected={selected?.id === rule.id}><td><Button variant="ghost" onClick={() => navigate(route, { selected: selected?.id === rule.id ? '' : rule.id })} aria-pressed={selected?.id === rule.id}>{rule.id}</Button><strong>{rule.name}</strong><small>v{rule.version}</small></td><td><Condition rule={rule} /></td><td><span data-tag="pattern">{ruleStatusLabels[rule.status]}</span></td><td>{rule.author}<br /><time dateTime={rule.updatedAt}>{rule.updatedAt.slice(0, 10)}</time></td><td><Button variant="secondary" asChild><a href={`#/rules/${rule.id}/backtest`}>백테스트</a></Button></td></tr>)}</tbody></table>}
    </section>{selected && <aside data-ws="panel" data-rules="detail" aria-label="룰 상세 및 이력"><div data-ws="toolbar"><h3>{selected.id}</h3><Button variant="ghost" onClick={() => navigate(route, { selected: '' })}>닫기</Button></div><h2>{selected.name}</h2><span data-tag="pattern">{ruleStatusLabels[selected.status]} · v{selected.version}</span><p>{selected.description}</p><Condition rule={selected} /><div data-ws="actions">{editable(selected) && <Button asChild variant="secondary"><a href={`#/rules/new?edit=${selected.id}`}>룰 수정</a></Button>}{ruleTransitions[selected.status].map(next => <Button key={next} variant={next === 'REJECTED' || next === 'STOPPED' ? 'secondary' : 'default'} onClick={() => { setTarget(next); setReason(''); setError('') }}>{transitionLabels[next]}</Button>)}</div><h3>변경 사유 · 처리 이력 {selected.history.length}건</h3>{selected.history.length ? <ol data-rules="history">{[...selected.history].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><strong>{entry.action}</strong><p>{entry.reason}</p><small>{entry.actor} · <time dateTime={entry.at}>{entry.at.replace('T', ' ').slice(0, 16)}</time></small></li>)}</ol> : <p data-ws="muted">아직 처리 이력이 없습니다.</p>}</aside>}</div>}
    {scenario !== 'loading' && <RulePagination total={visible.length} pagination={pagination} unit="개" onChange={(page, pageSize) => navigate(route, { page: String(page), pageSize: String(pageSize) })} />}
    <WorkspaceDialog open={target !== null} onOpenChange={open => { if (!open) setTarget(null) }} title={target ? transitionLabels[target] : '상태 변경'} description={selected ? `${selected.id} · ${selected.name}` : undefined} footer={<><Button variant="secondary" onClick={() => setTarget(null)}>취소</Button><Button disabled={!reason.trim()} onClick={transition}>상태 변경 확인</Button></>}><label>변경 사유<textarea aria-label="변경 사유" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} /></label><p data-ws="muted">처리자와 변경 사유가 이력에 기록됩니다. 실제 운영에 반영되지 않는 샘플입니다.</p>{error && <p role="alert" data-ws="error">{error}</p>}</WorkspaceDialog>
  </>
}
function RuleEditor({ rule }: { rule?: RuleRecord }) {
  const { saveRule } = useWorkspace()
  const [input, setInput] = useState<RuleInput>(rule ?? blankRule)
  const [errors, setErrors] = useState<ReturnType<typeof validateRule>>({})
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  const [savedId, setSavedId] = useState(rule?.id)
  if (rule && !editable(rule)) return <section data-ws="empty"><h2>현재 상태에서는 수정할 수 없습니다</h2><p>초안, 반려, 중지 상태의 룰만 수정할 수 있습니다.</p><Button asChild variant="secondary"><a href={`#/rules?selected=${rule.id}`}>룰로 돌아가기</a></Button></section>
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFailure(''); setMessage('')
    const validation = validateRule(input); setErrors(validation)
    if (Object.keys(validation).length) return
    const result = saveRule({ ...input, name: input.name.trim(), description: input.description.trim() }, savedId)
    if (!result.ok) { setFailure(result.error); return }
    setSavedId(result.value.id); setMessage(`${result.value.id} 초안이 저장되었습니다. 목록에서 승인 요청을 진행할 수 있습니다.`)
  }
  return <>
    <PageHeaderActions><Button asChild variant="secondary"><a href="#/rules">목록</a></Button><Button type="submit" form="rules-editor">초안 저장</Button></PageHeaderActions>
    <form id="rules-editor" aria-label="룰 작성" onSubmit={submit} noValidate data-rules="editor"><section data-ws="panel"><h2>{rule ? '룰 수정' : '새 룰 작성'}</h2><p data-ws="muted">조건을 저장한 뒤 샘플 거래로 백테스트하고 승인 요청을 진행하세요.</p><div data-ws="fields"><label>룰 이름<input aria-label="룰 이름" value={input.name} maxLength={80} onChange={event => setInput({ ...input, name: event.target.value })} aria-invalid={Boolean(errors.name)} />{errors.name && <span data-ws="error">{errors.name}</span>}</label><label>목적과 근거<textarea aria-label="목적과 근거" value={input.description} maxLength={1000} onChange={event => setInput({ ...input, description: event.target.value })} aria-invalid={Boolean(errors.description)} />{errors.description && <span data-ws="error">{errors.description}</span>}</label><label>거래 유형<select aria-label="거래 유형" value={input.typeCode ?? 'any'} onChange={event => setInput({ ...input, typeCode: event.target.value === 'any' ? null : Number(event.target.value) as TypeCode })}><option value="any">전체 유형</option>{typeCodes.map(code => <option key={code} value={code}>{typeDisplay(code).key}</option>)}</select></label><div data-rules="numeric-fields"><label>최소 모델 점수<input aria-label="최소 모델 점수" type="number" min="0" max="1" step="0.01" value={Number.isNaN(input.scoreMin) ? '' : input.scoreMin} onChange={event => setInput({ ...input, scoreMin: event.target.valueAsNumber })} aria-invalid={Boolean(errors.scoreMin)} />{errors.scoreMin && <span data-ws="error">{errors.scoreMin}</span>}</label><label>최소 거래 건수 (건)<input aria-label="최소 거래 건수" type="number" min="1" step="1" value={Number.isNaN(input.minTransactions) ? '' : input.minTransactions} onChange={event => setInput({ ...input, minTransactions: event.target.valueAsNumber })} aria-invalid={Boolean(errors.minTransactions)} />{errors.minTransactions && <span data-ws="error">{errors.minTransactions}</span>}</label><label>시간 창 (시간)<input aria-label="시간 창" type="number" min="1" max="720" step="1" value={Number.isNaN(input.windowHours) ? '' : input.windowHours} onChange={event => setInput({ ...input, windowHours: event.target.valueAsNumber })} aria-invalid={Boolean(errors.windowHours)} />{errors.windowHours && <span data-ws="error">{errors.windowHours}</span>}</label></div></div></section><section data-ws="panel"><h3>조건 해석</h3><Condition rule={input} /><p>동일 계좌에서 점수와 유형을 만족하는 거래가 지정한 시간 창 안에 최소 건수 이상 발생한 경우를 찾습니다.</p><p data-ws="muted">NON_PATTERN은 패턴 없는 이상거래(유형 0)입니다. 사람의 정상 판정과 다릅니다. 룰 저장은 모델 실행이나 실제 운영 배포를 수행하지 않습니다.</p></section>{message && <p role="status" data-ws="notice">{message} <a href={`#/rules?selected=${savedId}`}>저장한 룰 보기</a> · <a href={`#/rules/${savedId}/backtest`}>백테스트</a></p>}{failure && <p role="alert" data-ws="error">{failure}</p>}</form>
  </>
}
function RuleBacktest({ rule, route }: { rule: RuleRecord; route: URL }) {
  const { transactions } = useWorkspace()
  if (transactions.length > MAX_LOCAL_BACKTEST_TRANSACTIONS) return <>
    <PageHeaderActions><Button asChild variant="secondary"><a href={`#/rules?selected=${rule.id}`}>룰 목록</a></Button></PageHeaderActions>
    <section data-ws="empty"><h2>서버 백테스트 작업이 필요합니다</h2><p>로컬 샘플 평가는 10,000건 이하에서만 지원합니다. 현재 거래는 브라우저에서 읽거나 평가하지 않았습니다.</p><p data-ws="muted">운영용 비동기 작업 생성·진행률·결과 페이지 조회 API 연결이 필요합니다. 서버 실행은 아직 시작되지 않았습니다.</p></section>
  </>
  return <RuleBacktestContent rule={rule} route={route} transactions={transactions} />
}
function RuleBacktestContent({ rule, route, transactions }: { rule: RuleRecord; route: URL; transactions: LedgerTransaction[] }) {
  const bounds = useMemo(() => {
    let start = ''; let end = ''
    for (const tx of transactions) {
      const date = tx.date
      if (!start || date < start) start = date
      if (!end || date > end) end = date
    }
    return { start: start || '2026-11-09', end: end || '2026-11-15' }
  }, [transactions])
  const initialPeriod = { start: route.searchParams.get('start') ?? bounds.start, end: route.searchParams.get('end') ?? bounds.end }
  const [period, setPeriod] = useState<RulePeriod>(initialPeriod)
  const [result, setResult] = useState<ReturnType<typeof runBacktest> | null>(null)
  const [applied, setApplied] = useState<RulePeriod | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [simulateError, setSimulateError] = useState(route.searchParams.get('state') === 'error')
  const pagination = rulesPagination(result?.matchedCount ?? 0, route.searchParams.get('page'), route.searchParams.get('pageSize'))
  const displayResult = useMemo(() => result && applied ? runBacktest(transactions, rule, applied, { offset: pagination.offset, limit: pagination.pageSize }) : null, [transactions, rule, applied, result, pagination.offset, pagination.pageSize])
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const validation = validatePeriod(period); setError(validation)
    if (validation) return
    setRunning(true)
    await new Promise(resolve => setTimeout(resolve, 150))
    try {
      if (simulateError) throw new Error('샘플 재실행에 실패했습니다. 이전 결과를 유지합니다.')
      setResult(runBacktest(transactions, rule, period, { limit: pagination.pageSize })); setApplied({ ...period }); navigate(route, { ...period, page: '1' })
    } catch (failure) { setError(failure instanceof Error ? failure.message : '실행에 실패했습니다.') }
    finally { setRunning(false) }
  }
  const csv = () => displayResult && downloadRulesCsv(`${rule.id}-backtest-sample.csv`, [['거래 ID', '거래 일시(KST)', '계좌 ID', '유형', '모델 점수', '거래 금액(USD)'], ...displayResult.transactions.map(tx => [tx.displayId, tx.occurredAt, tx.accountId, typeDisplay(tx.typeCode).key, tx.score, tx.amountUsd])])
  return <>
    <PageHeaderActions><Button asChild variant="secondary"><a href={`#/rules?selected=${rule.id}`}>룰 목록</a></Button><Button type="submit" form="rules-backtest" disabled={running}>{running ? '실행 중' : '샘플 백테스트 실행'}</Button></PageHeaderActions>
    <section data-ws="panel"><h2>{rule.id} · {rule.name}</h2><Condition rule={rule} /><p data-ws="muted">v{rule.version} · {ruleStatusLabels[rule.status]} · 10,000건 이하 로컬 샘플 거래의 조건 평가입니다. 운영 백테스트는 서버 비동기 작업 생성·진행률 조회·결과 페이지 조회가 필요합니다.</p></section>
    <form id="rules-backtest" aria-label="백테스트 기간" data-ws="toolbar" onSubmit={run} noValidate><label>시작일 (KST)<input aria-label="백테스트 시작일" type="date" value={period.start} onChange={event => setPeriod({ ...period, start: event.target.value })} /></label><label>종료일 (KST)<input aria-label="백테스트 종료일" type="date" value={period.end} onChange={event => setPeriod({ ...period, end: event.target.value })} /></label><label>실행 상태 (샘플)<select aria-label="백테스트 실행 상태" value={simulateError ? 'error' : 'success'} onChange={event => setSimulateError(event.target.value === 'error')}><option value="success">성공</option><option value="error">재실행 오류</option></select></label><Button type="submit" variant="secondary" disabled={running}>{running ? '실행 중' : '기간 적용 및 실행'}</Button></form>
    {error && <p role="alert" data-ws="error">{error}</p>}{running && <p role="status" data-ws="notice">조건에 맞는 샘플 거래를 조회하는 중입니다.</p>}
    {!result ? <section data-ws="empty"><h3>백테스트 실행 전입니다</h3><p>조회 기간을 선택하고 실행해 주세요. 날짜 수정은 실행 전까지 결과에 반영되지 않습니다.</p></section> : <><div data-ws="toolbar"><h2>샘플 결과 · {result.matchedCount}건</h2><p data-ws="muted">적용 기간: {applied?.start} ~ {applied?.end} (KST)</p><Button variant="secondary" onClick={csv}><Download />현재 페이지 CSV</Button></div><div data-rules="metrics"><div><span>기간 내 조회 거래</span><strong>{result.scannedCount.toLocaleString('ko-KR')}건</strong></div><div><span>조건 일치 거래</span><strong>{result.matchedCount.toLocaleString('ko-KR')}건</strong></div><div><span>조건 일치 계좌</span><strong>{result.accountCount.toLocaleString('ko-KR')}개</strong></div><div><span>조건 일치 금액</span><strong>{result.amountUsd.toLocaleString('ko-KR')} USD</strong></div></div><p data-ws="muted">동일 계좌의 순차 시간 창을 검사하고 겹치는 창의 거래는 한 번만 집계합니다. 정답 라벨 기반 정확도는 산출하지 않습니다.</p>{result.matchedCount === 0 ? <section data-ws="empty"><h3>조건에 일치하는 거래가 없습니다</h3><p>적용 기간과 룰의 유형·점수·시간 창·최소 건수를 확인해 주세요.</p></section> : <table data-ws="table" data-rules="result-table"><thead><tr><th scope="col">거래 ID</th><th scope="col">일시 (KST)</th><th scope="col">계좌 ID</th><th scope="col">추정 패턴 · 확률</th><th scope="col">모델 점수</th><th scope="col">금액 (USD)</th></tr></thead><tbody>{displayResult?.transactions.map(tx => <tr key={tx.id}><td>{tx.displayId}</td><td>{tx.occurredAt.replace('T', ' ').slice(0, 16)}</td><td>{tx.accountId}</td><td><PatternTag code={tx.typeCode} probability={tx.probability} /></td><td><ScoreTag score={tx.score} /></td><td>{tx.amountUsd.toLocaleString('ko-KR')}</td></tr>)}</tbody></table>}<RulePagination total={result.matchedCount} pagination={pagination} unit="건" onChange={(page, pageSize) => navigate(route, { page: String(page), pageSize: String(pageSize) })} /></>}
  </>
}
