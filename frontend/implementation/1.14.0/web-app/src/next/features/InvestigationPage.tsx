import { useMemo, useState, type FormEvent } from 'react'
import { Download, Layers, LayoutGrid, List, LoaderCircle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TypeCode } from '@/api/codes'
import { number, patternName, snapshot, workStates } from '../dashboard-data'
import { caseHref, useWorkspace, type WorkspaceCase, type LedgerTransaction } from '../workspace-store'
import { PageHeaderActions } from '../ui/PageHeaderActions'
import { WorkspaceDialog } from '../ui/WorkspaceDialog'
import { FilterTag } from '../ui/FilterTag'
import { PatternTag, ScoreTag, StatusTag } from '../ui/Tags'
import { accountName, canBundle, downloadInvestigationCsv, ownerName, readInvestigationFilters, selectInvestigationCases, selectLedger, indexInvestigationLedger, paginateInvestigationRows, type InvestigationFilters } from './investigation-selectors'
import '../styles/investigation.css'
const emptyTransactions:LedgerTransaction[] = []
const filterKeys = ['q', 'start', 'end', 'mine', 'status', 'risk', 'type', 'abnormal']
function href(route: URL, changes: Record<string, string | null>) {
 const next = new URL(route)
 if (Object.keys(changes).some(key => [...filterKeys, 'sort', 'pageSize'].includes(key))) for (const key of ['page', 'ownerPage', 'accountPage', 'transactionPage']) next.searchParams.delete(key)
 for (const [key, value] of Object.entries(changes)) { if (value === null || value === '') next.searchParams.delete(key); else next.searchParams.set(key, value) }
 return `#${next.pathname}${next.search}`
}
function goToHash(value: string) { window.location.assign(value) }
function navigate(route: URL, changes: Record<string, string | null>) { goToHash(href(route, changes)) }
const riskLabels: Record<string, string> = { high: '위험', medium: '주의', low: '낮음' }
function CaseStatus({ item }: { item: WorkspaceCase }) {
 return <StatusTag preset={item.workState}>{workStates.find(s => s.key === item.workState)!.label}</StatusTag>
}
function HumanVerdict({ verdict }: { verdict: 'normal' | 'abnormal' | null }) {
 return verdict ? <StatusTag preset={verdict}>{verdict === 'normal' ? '정상' : '이상'}</StatusTag> : <span data-ws="muted">미판정</span>
}
function Age({ item }: { item: WorkspaceCase }) { return <StatusTag preset={item.ageDays <= 3 ? 'elapsedLow' : item.ageDays <= 7 ? 'elapsedMid' : 'elapsedHigh'}>{item.ageDays}일 경과</StatusTag> }
function InvestigationFiltersForm({ route, ledger }: { route: URL; ledger: boolean }) {
 const applied = readInvestigationFilters(route)
 const [draft, setDraft] = useState(applied)
 const [error, setError] = useState('')
 function change<K extends keyof InvestigationFilters>(key: K, value: InvestigationFilters[K]) { setDraft({ ...draft, [key]: value }); setError('') }
 function apply(event: FormEvent) {
  event.preventDefault()
  if (draft.start && draft.end && draft.start > draft.end) { setError('시작일은 종료일보다 늦을 수 없습니다.'); return }
  navigate(route, { q: draft.q.trim(), start: draft.start, end: draft.end, mine: draft.mine ? '1' : null, status: draft.status, risk: draft.risk, type: draft.type === '' ? null : String(draft.type), abnormal: draft.abnormal ? '1' : null, sort: draft.sort })
 }
 function preset(days: number) { const end = snapshot.date; const start = new Date(`${end}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - days + 1); setDraft({ ...draft, start: start.toISOString().slice(0, 10), end }) }
 return <form aria-label="조사 필터" data-ws="toolbar" onSubmit={apply}>
  <label data-inv="search"><Search aria-hidden="true" /><span data-ws="sr-only">검색</span><input aria-label="검색" value={draft.q} placeholder={ledger ? '소유주·계좌·거래 검색' : 'ID·담당자·패턴 검색'} onChange={e => change('q', e.target.value)} /></label>
  <details data-inv="filter-popover"><summary>기간·필터</summary><div data-inv="filter-options">
   <div data-ws="actions">{[1, 3, 7, 30].map(days => <Button key={days} type="button" variant="outline" size="sm" onClick={() => preset(days)}>{days === 1 ? '오늘' : `최근 ${days}일`}</Button>)}<Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, start: `${snapshot.date.slice(0, 7)}-01`, end: snapshot.date })}>이번 달</Button><Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ ...draft, start: '', end: '' })}>전체 기간</Button></div>
   <label>시작일<input type="date" value={draft.start} onChange={e => change('start', e.target.value)} /></label><label>종료일<input type="date" value={draft.end} onChange={e => change('end', e.target.value)} /></label>
   {!ledger && <><label data-inv="check"><input type="checkbox" checked={draft.mine} onChange={e => change('mine', e.target.checked)} />내 담당</label><label>업무 상태<select value={draft.status} onChange={e => change('status', e.target.value as InvestigationFilters['status'])}><option value="">전체 상태</option>{workStates.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label></>}
   <label>위험도<select value={draft.risk} onChange={e => change('risk', e.target.value)}><option value="">전체 위험도</option>{Object.entries(riskLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
   <label>추정 패턴<select value={draft.type} onChange={e => change('type', e.target.value === '' ? '' : Number(e.target.value) as TypeCode)}><option value="">전체 패턴</option>{Array.from({ length: 9 }, (_,code) => <option key={code} value={code}>{patternName(code as TypeCode)}</option>)}</select></label>
   {(ledger || route.pathname.endsWith('/episodes')) && <label data-inv="check"><input type="checkbox" checked={draft.abnormal} onChange={e => change('abnormal', e.target.checked)} />사람 판정 이상만</label>}
   <p data-ws="muted">기간과 조건은 적용을 누르면 목록에 반영됩니다.</p>
  </div></details>
  <label>정렬<select aria-label="정렬" value={draft.sort} onChange={e => change('sort', e.target.value)}><option value="newest">최신순</option><option value="oldest">오래된순</option><option value="score">모델 점수 높은순</option><option value="amount">거래 금액 높은순</option></select></label>
  <Button type="submit">적용</Button>{error && <p role="alert" data-ws="error">{error}</p>}
 </form>
}
function AppliedFilters({ route }: { route: URL }) {
 const f = readInvestigationFilters(route)
 const tags: { label: string; keys: string[] }[] = []
 if (f.q) tags.push({ label: `검색: ${f.q}`, keys: ['q'] })
 if (f.start || f.end) tags.push({ label: `${f.start || '처음'} ~ ${f.end || '현재'}`, keys: ['start', 'end'] })
 if (f.mine) tags.push({ label: '내 담당', keys: ['mine'] })
 if (f.status) tags.push({ label: workStates.find(s => s.key === f.status)!.label, keys: ['status'] })
 if (f.risk) tags.push({ label: `위험도: ${riskLabels[f.risk]}`, keys: ['risk'] })
 if (f.type !== '') tags.push({ label: `추정 패턴: ${patternName(f.type)}`, keys: ['type'] })
 if (f.abnormal) tags.push({ label: '사람 판정 이상만', keys: ['abnormal'] })
 return tags.length > 0 && <div data-ws="actions" aria-label="적용된 필터">{tags.map(tag => <FilterTag key={tag.label} label={tag.label} onRemove={() => navigate(route, Object.fromEntries(tag.keys.map(key => [key,null])))} />)}{tags.length >= 2 && <Button variant="ghost" onClick={() => navigate(route, Object.fromEntries(filterKeys.map(key => [key,null])))}>모두 해제</Button>}</div>
}
function InvestigationPagination({ route, pagination, pageKey, label }: { route:URL; pagination:ReturnType<typeof paginateInvestigationRows>; pageKey:string; label:string }) {
 return <nav data-ws="toolbar" aria-label={`${label} 페이지`}><span data-ws="muted">전체 {number(pagination.total)}건 중 {number(pagination.start)}–{number(pagination.end)}건 표시 · {pagination.page}/{pagination.pageCount}페이지</span><label>{label} 페이지당<select aria-label={`${label} 페이지당`} value={pagination.pageSize} onChange={e=>navigate(route,{pageSize:e.target.value})}>{[25,50,100].map(size=><option key={size} value={size}>{size}건</option>)}</select></label><Button variant="outline" size="sm" disabled={pagination.page<=1} onClick={()=>navigate(route,{[pageKey]:String(pagination.page-1)})}>이전</Button><Button variant="outline" size="sm" disabled={pagination.page>=pagination.pageCount} onClick={()=>navigate(route,{[pageKey]:String(pagination.page+1)})}>다음</Button></nav>
}
function CasesTable({ rows, bundle, selected, toggle }: { rows: WorkspaceCase[]; bundle: boolean; selected: number[]; toggle: (id: number) => void }) {
 const { viewerId, openCase } = useWorkspace()
 return <table data-ws="table" data-inv="cases-table" aria-label={`${rows[0]?.kind === 'EPISODE' ? 'Episode' : 'Alert'} 목록`}><colgroup>{bundle && <col data-inv-col="selection"/>}<col data-inv-col="id"/><col data-inv-col="status"/><col data-inv-col="verdict"/><col data-inv-col="pattern"/><col data-inv-col="score"/><col data-inv-col="count"/><col data-inv-col="amount"/><col data-inv-col="assignee"/><col data-inv-col="date"/></colgroup><thead><tr>{bundle && <th scope="col">선택</th>}<th scope="col">ID</th><th scope="col">업무 상태</th><th scope="col">사람 판정</th><th scope="col">추정 패턴·확률</th><th scope="col" data-numeric>모델 점수</th><th scope="col" data-numeric>거래</th><th scope="col" data-numeric>금액 (USD)</th><th scope="col">담당자</th><th scope="col">탐지일</th></tr></thead><tbody>{rows.map(item => <tr key={item.caseId} data-inv-row={!bundle} data-selected={bundle && selected.includes(item.caseId)} onClick={bundle ? undefined : event=>{if (!(event.target as HTMLElement).closest('a,input,button')) {openCase(item.caseId);goToHash(caseHref(item))}}}>
 {bundle && <td><input type="checkbox" aria-label={`${item.displayId} 선택`} checked={selected.includes(item.caseId)} disabled={!canBundle(item,viewerId) || (selected.length>=100 && !selected.includes(item.caseId))} onChange={() => toggle(item.caseId)} /></td>}
 <td><a href={caseHref(item)} onClick={() => openCase(item.caseId)}>{item.displayId}</a>{bundle && !canBundle(item,viewerId) && <small data-ws="muted">{item.episodeCaseId ? '묶인 Alert' : item.assigneeId !== viewerId ? '다른 담당자' : '처리 완료'}</small>}</td><td><CaseStatus item={item} /></td><td><HumanVerdict verdict={item.verdict} /></td><td><PatternTag code={item.typeCode} probability={item.probability} /></td><td data-numeric><ScoreTag score={item.score} /></td><td data-numeric>{number(item.transactionIds.length)}건</td><td data-numeric>{item.amountUsd === null ? '값 없음' : number(item.amountUsd)}</td><td>{item.assignee}</td><td>{item.createdDate}</td>
 </tr>)}</tbody></table>
}
function InvestigationCards({ rows, bundle, selected, toggle }: { rows: WorkspaceCase[]; bundle: boolean; selected: number[]; toggle: (id:number)=>void }) {
 const { viewerId, openCase } = useWorkspace()
 return <div data-inv="cards">{rows.map(item => <article key={item.caseId} data-bundle={bundle} data-inv="card" data-selected={bundle && selected.includes(item.caseId)} data-testid="investigation-card"><header>{bundle && <input type="checkbox" aria-label={`${item.displayId} 선택`} checked={selected.includes(item.caseId)} disabled={!canBundle(item,viewerId) || (selected.length>=100 && !selected.includes(item.caseId))} onChange={() => toggle(item.caseId)} />}<a href={caseHref(item)} onClick={() => openCase(item.caseId)}>{item.displayId}</a><CaseStatus item={item} /></header>
 <div data-inv="card-body"><div data-ws="actions"><HumanVerdict verdict={item.verdict} /><span data-ws="muted">모델 점수</span><ScoreTag score={item.score} /><Age item={item} /></div><div><PatternTag code={item.typeCode} probability={item.probability} /></div><dl><div><dt>거래 건수</dt><dd>{number(item.transactionIds.length)}건</dd></div><div><dt>거래 금액</dt><dd>{item.amountUsd === null ? '값 없음' : `${number(item.amountUsd)} USD`}</dd></div><div><dt>담당자</dt><dd>{item.assignee}</dd></div><div><dt>탐지일</dt><dd>{item.createdDate}</dd></div></dl>{bundle && !canBundle(item,viewerId) && <p data-ws="muted">{item.episodeCaseId ? '이미 Episode에 묶인 Alert입니다.' : item.assigneeId !== viewerId ? '다른 담당자의 Alert입니다.' : '처리 완료된 Alert입니다.'}</p>}</div></article>)}</div>
}
function Ledger({ route, transactions, records, empty }: { route: URL; transactions: LedgerTransaction[]; records: WorkspaceCase[]; empty: boolean }) {
 const { openCase } = useWorkspace()
 const routeHref = route.href
 const f = useMemo(()=>readInvestigationFilters(new URL(routeHref)),[routeHref])
 const source = empty ? emptyTransactions : transactions
 const idParam = (key:string) => /^\d+$/.test(route.searchParams.get(key) ?? '') ? Number(route.searchParams.get(key)) : null
 const rawOwner = idParam('owner'); const rawAccount = idParam('account')
 const base = useMemo(()=>indexInvestigationLedger(source,f),[source,f])
 const owner = rawOwner!==null && base.ownerIds.has(rawOwner) ? rawOwner : null
 const accounts = owner===null ? base.accounts : base.accountsByOwner.get(owner)??[]
 const account = accounts.some(a => a.id === rawAccount) ? rawAccount : null
 const direction = ['outgoing','incoming'].includes(route.searchParams.get('direction') ?? '') ? route.searchParams.get('direction')! : 'all'
 const data = useMemo(()=>selectLedger(source,f,owner,account,direction),[source,f,owner,account,direction])
 const ownerPage = paginateInvestigationRows(data.owners,route.searchParams.get('ownerPage'),route.searchParams.get('pageSize'))
 const accountPage = paginateInvestigationRows(data.accounts,route.searchParams.get('accountPage'),route.searchParams.get('pageSize'))
 const transactionPage = paginateInvestigationRows(data.transactions,route.searchParams.get('transactionPage'),route.searchParams.get('pageSize'))
 const txId = idParam('transaction'); const selected = data.transactions.find(t => t.id === txId)
 const related = (t:LedgerTransaction) => records.filter(r => r.transactionIds.includes(t.id))
 const txCsv = () => downloadInvestigationCsv('거래', [['거래 ID','시각','송금 계좌','수취 계좌','금액 (USD)','유형 코드','모델 확률','모델 점수','사람 판정','연관 caseId'], ...transactionPage.rows.map(t => [t.displayId,t.occurredAt,t.fromAccountId,t.toAccountId,t.amountUsd,t.typeCode,t.probability,t.score,t.humanVerdict,related(t).map(r=>r.caseId).join(';')])])
 if (data.serverQueryRequired) return <div role="status" data-ws="notice"><h2>서버 조회가 필요합니다</h2><p>샘플 원장은 10,000건까지 조회할 수 있습니다. 대량 거래는 서버 필터·집계·커서 페이지 API로 조회해야 합니다.</p></div>
 return <div data-inv="ledger">
 <section><div data-ws="toolbar"><h2>소유주 전체 {number(data.owners.length)}명</h2><Button variant="outline" size="sm" aria-label="소유주 현재 페이지 CSV" onClick={() => downloadInvestigationCsv('소유주', [['소유주 ID','소유주','계좌 수','원거래 건수','금액 (USD)'], ...ownerPage.rows.map(o=>[o.id,o.name,o.accountCount,o.transactionCount,o.amountUsd])])}><Download />현재 페이지 CSV</Button></div><table data-ws="table" aria-label="소유주 목록"><thead><tr><th scope="col">소유주</th><th scope="col" data-numeric>계좌</th><th scope="col" data-numeric>원거래</th></tr></thead><tbody>{ownerPage.rows.map(o => <tr key={o.id} data-selected={o.id===owner}><td><Button variant="ghost" aria-label={`${o.name} ${owner===o.id ? '선택 해제' : '선택'}`} aria-pressed={owner===o.id} onClick={() => navigate(route,{ owner: owner===o.id ? null : String(o.id), account:null,transaction:null,direction:null })}>{o.name}</Button></td><td data-numeric>{o.accountCount}개</td><td data-numeric>{o.transactionCount}건</td></tr>)}</tbody></table><InvestigationPagination route={route} pagination={ownerPage} pageKey="ownerPage" label="소유주"/>{!data.owners.length && <p data-ws="empty">조건에 맞는 소유주가 없습니다.</p>}</section>
 <section><div data-ws="toolbar"><h2>계좌 전체 {number(data.accounts.length)}개</h2><Button variant="outline" size="sm" aria-label="계좌 현재 페이지 CSV" onClick={() => downloadInvestigationCsv('계좌', [['계좌 ID','소유주 ID','거래 건수','입금 (USD)','출금 (USD)'], ...accountPage.rows.map(a=>[a.id,a.ownerId,a.transactionCount,a.incomingUsd,a.outgoingUsd])])}><Download />현재 페이지 CSV</Button></div><p data-ws="muted">{owner===null ? '전체 소유주' : ownerName(owner)}</p><table data-ws="table" aria-label="계좌 목록"><thead><tr><th scope="col">계좌</th><th scope="col" data-numeric>입금 (USD)</th><th scope="col" data-numeric>출금 (USD)</th></tr></thead><tbody>{accountPage.rows.map(a => <tr key={a.id} data-selected={a.id===account}><td><Button variant="ghost" aria-label={`${accountName(a.id)} ${account===a.id ? '선택 해제' : '선택'}`} aria-pressed={a.id===account} onClick={() => navigate(route,{ account:account===a.id ? null : String(a.id),transaction:null,direction:null })}>{accountName(a.id)}</Button></td><td data-numeric>{number(a.incomingUsd)}</td><td data-numeric>{number(a.outgoingUsd)}</td></tr>)}</tbody></table><InvestigationPagination route={route} pagination={accountPage} pageKey="accountPage" label="계좌"/>{!data.accounts.length && <p data-ws="empty">조건에 맞는 계좌가 없습니다.</p>}</section>
 <section data-inv="ledger-transactions"><div data-ws="toolbar"><h2>거래 전체 {number(data.transactions.length)}건</h2><label>거래 방향<select aria-label="거래 방향" disabled={account===null} value={account===null?'all':direction} onChange={e=>navigate(route,{direction:e.target.value==='all'?null:e.target.value,transaction:null})}><option value="all">입출금 전체</option><option value="outgoing">출금</option><option value="incoming">입금</option></select></label><Button variant="outline" size="sm" aria-label="거래 현재 페이지 CSV" onClick={txCsv}><Download />현재 페이지 CSV</Button></div><p data-ws="muted">{account===null ? '전체 선택 범위' : `${accountName(account)} 기준`} · 금액 단위 USD</p>
 <table data-ws="table" aria-label="거래 목록"><thead><tr><th scope="col">거래 ID·시각</th><th scope="col">송금 → 수취 계좌</th><th scope="col" data-numeric>금액 (USD)</th><th scope="col">사람 판정·모델</th><th scope="col">연관 업무</th></tr></thead><tbody>{transactionPage.rows.map(t=><tr key={t.id} data-selected={txId===t.id}><td><Button variant="ghost" aria-pressed={txId===t.id} aria-label={`${t.displayId} ${txId===t.id?'선택 해제':'선택'}`} onClick={()=>navigate(route,{transaction:txId===t.id?null:String(t.id)})}>{t.displayId}</Button><small data-ws="muted">{t.occurredAt.replace('T',' ').slice(0,19)}</small></td><td>{t.fromAccountId} → {t.toAccountId}</td><td data-numeric>{number(t.amountUsd)}</td><td><div data-ws="actions"><HumanVerdict verdict={t.humanVerdict}/><ScoreTag score={t.score}/></div><PatternTag code={t.typeCode} probability={t.probability}/></td><td>{related(t).length ? related(t).map(r=><a data-inv="related-link" key={r.caseId} href={caseHref(r)} onClick={()=>openCase(r.caseId)}>{r.displayId}</a>) : <span data-ws="muted">연관 업무 없음</span>}</td></tr>)}</tbody></table><InvestigationPagination route={route} pagination={transactionPage} pageKey="transactionPage" label="거래"/>{!data.transactions.length && <p data-ws="empty">조건에 맞는 거래가 없습니다.</p>}
 {selected && <aside data-ws="notice" aria-label="선택한 거래"><strong>{selected.displayId}</strong><p>{selected.fromAccountId} → {selected.toAccountId} · {number(selected.amountUsd)} USD</p><p>소유주 {ownerName(selected.ownerId)} · {selected.humanVerdict ? selected.humanVerdict==='normal'?'사람 판정 정상':'사람 판정 이상':'사람 미판정'}</p><Button variant="ghost" onClick={()=>navigate(route,{transaction:null})}>거래 선택 해제</Button></aside>}
 </section></div>
}
export function InvestigationPage({ route }: { route: URL }) {
 const { records, transactions, viewerId, bundleAlerts } = useWorkspace()
 const ledger = route.pathname.endsWith('/ledger'); const kind = route.pathname.endsWith('/episodes') ? 'EPISODE' : 'ALERT'
 const view = route.searchParams.get('view')==='table'?'table':'cards'; const bundle = !ledger && kind==='ALERT' && route.searchParams.get('mode')==='bundle'
 const rawState = route.searchParams.get('state') ?? new URLSearchParams(window.location.search).get('state') ?? 'ready'
 const [retried, setRetried] = useState('')
 const state = retried===route.href && rawState==='error' ? 'ready' : rawState
 const [lastSuccess,setLastSuccess] = useState({path:route.pathname,empty:state==='empty'})
 if (state!=='loading' && state!=='error' && (lastSuccess.path!==route.pathname || lastSuccess.empty!==(state==='empty'))) setLastSuccess({path:route.pathname,empty:state==='empty'})
 const empty = state==='empty' || (state==='error' && lastSuccess.path===route.pathname && lastSuccess.empty)
 const rows = selectInvestigationCases(empty?[]:records,kind,readInvestigationFilters(route),viewerId)
 const page = paginateInvestigationRows(rows,route.searchParams.get('page'),route.searchParams.get('pageSize'))
 const [selection,setSelection] = useState<number[]>([])
 const selected = selection.filter(id=>records.some(r=>r.caseId===id && canBundle(r,viewerId)))
 const [dialog,setDialog] = useState(false); const [reason,setReason] = useState(''); const [error,setError] = useState('')
 const toggle = (id:number) => setSelection(current => current.includes(id)?current.filter(value=>value!==id):current.length>=100?current:[...current,id])
 function createEpisode() {
  const result = bundleAlerts(selected,reason)
  if (!result.ok) { setError(result.error); return }
  setDialog(false); setReason(''); setError(''); setSelection([]); goToHash(caseHref(result.value))
 }
 const exportCases = () => downloadInvestigationCsv(kind==='ALERT'?'Alert':'Episode',[['caseId','표시 ID','업무 상태','사람 판정','유형 코드','패턴 확률','모델 점수','거래 건수','금액 (USD)','담당자','탐지일'],...rows.map(r=>[r.caseId,r.displayId,workStates.find(s=>s.key===r.workState)!.label,r.verdict,r.typeCode,r.probability,r.score,r.transactionIds.length,r.amountUsd,r.assignee,r.createdDate])])
 return <><PageHeaderActions>{!ledger && <nav data-ws="actions" aria-label="목록 보기"><a href={href(route,{view:'cards'})} aria-label="카드 보기" aria-current={view==='cards'?'page':undefined}><LayoutGrid/>카드</a><a href={href(route,{view:'table'})} aria-label="표 보기" aria-current={view==='table'?'page':undefined}><List/>표</a></nav>}{!ledger && <Button variant="outline" onClick={exportCases}><Download/>CSV 다운로드</Button>}{!ledger && kind==='ALERT' && (bundle ? <><Button variant="outline" onClick={()=>{setSelection([]);navigate(route,{mode:null})}}>묶기 취소</Button><Button disabled={selected.length<2} onClick={()=>setDialog(true)}><Layers/>Episode로 묶기 ({selected.length})</Button></> : <Button onClick={()=>navigate(route,{mode:'bundle'})}><Layers/>묶기 모드</Button>)}</PageHeaderActions>
 <section data-ws="page" data-inv="page"><InvestigationFiltersForm key={`${route.pathname}${route.search}`} route={route} ledger={ledger}/><AppliedFilters route={route}/>
 {bundle && <p data-ws="notice">내 담당·미종결·미묶음 Alert를 2건 이상 선택하세요. 최대 100건까지 묶을 수 있습니다. 선택 {selected.length}건{selected.some(id=>!rows.some(r=>r.caseId===id))?' (현재 필터 밖의 선택 포함)':''}</p>}
 {state==='error' && <div role="alert" data-ws="error">재조회하지 못했습니다. 마지막으로 불러온 데이터를 표시합니다.<Button variant="ghost" onClick={()=>{setRetried(route.href);navigate(route,{state:null})}}>다시 시도</Button></div>}
 {state==='loading' ? <div role="status" data-ws="empty"><LoaderCircle/>조사 데이터를 불러오는 중입니다.</div> : ledger ? <Ledger route={route} transactions={transactions} records={records} empty={empty}/> : <><div data-ws="toolbar"><h2>{kind==='ALERT'?'Alert':'Episode'} 전체 {number(rows.length)}건</h2><span data-ws="muted">모델 추정과 사람 판정은 별도로 표시됩니다.</span></div>{!rows.length ? <div data-ws="empty"><h3>조건에 맞는 업무가 없습니다</h3><p>검색어와 조회 조건을 확인해 주세요.</p><Button variant="outline" onClick={()=>navigate(route,Object.fromEntries([...filterKeys,'state'].map(key=>[key,null])))}>조건 초기화</Button></div> : view==='table' ? <CasesTable rows={page.rows} bundle={bundle} selected={selected} toggle={toggle}/> : <InvestigationCards rows={page.rows} bundle={bundle} selected={selected} toggle={toggle}/>}<InvestigationPagination route={route} pagination={page} pageKey="page" label={kind==='ALERT'?'Alert':'Episode'}/></>}
 </section><WorkspaceDialog open={dialog} onOpenChange={setDialog} title="Alert를 Episode로 묶기" description="선택한 Alert의 거래를 하나의 Episode로 모읍니다. 사람 판정은 변경하지 않습니다." footer={<><Button variant="outline" onClick={()=>setDialog(false)}>취소</Button><Button disabled={selected.length<2 || !reason.trim()} onClick={createEpisode}>Episode 만들기</Button></>}><p>선택 {selected.length}건</p><ul>{selected.map(id=><li key={id}>{records.find(r=>r.caseId===id)?.displayId}</li>)}</ul><label data-ws="field">묶기 사유<textarea aria-label="묶기 사유" value={reason} onChange={e=>{setReason(e.target.value);setError('')}}/></label>{error && <p role="alert" data-ws="error">{error}</p>}</WorkspaceDialog></>
}
