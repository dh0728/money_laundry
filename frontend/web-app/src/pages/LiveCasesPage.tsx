import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { toast } from 'sonner'
import { ApiError } from '@/api/common'
import { fetchReviewCase, fetchReviewCases, fetchReviewMoney, setReviewMoneyScope, submitReviewCommand, type ReviewAction, type ReviewCase, type ReviewCommand, type ReviewGroup, type ReviewKind, type ReviewQuery } from '@/api/liveReview'
import { EmptyBlock, ErrorBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useCurrentUser, canEditOpen } from '@/app/session'
import { useAsync } from '@/lib/useAsync'
import { assertEditableAlert, buildAlertClose, buildAlertTransfer, buildEpisodeUnlink, episodeGroupSelection } from '@/api/reviewCommands'
import { toReviewGraphModel } from '@/features/graph/liveAdapter'
import { focusTransactions } from '@/features/graph/relabel'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { typeDisplay, type TypeCode } from '@/api/codes'
import Graph from '@/features/graph/v24/Graph'
import { UnderTabs } from '@/components/UnderTabs'
import { Combine, Download, ListFilter, Search } from 'lucide-react'
import ReviewCaseTable from '@/components/ReviewCaseTable'
import { Skeleton } from '@/components/ui/skeleton'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangeButton } from '@/components/DateRangeButton'
import { FilterChip } from '@/components/FilterChip'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const moneyIntervals = [5, 15, 30, 60, 180, 360, 1440] as const
const moneyAmount = (value: number) => Number(value).toLocaleString('ko-KR')
const moneyPercent = (value: number | null) => value == null ? '산출 불가' : `${value.toFixed(1)}%`
const patternCode = (name: string): TypeCode | null => {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (let code = 0; code <= 8; code++) if (typeDisplay(code as TypeCode).key.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized) return code as TypeCode
  return null
}
const patternLabel = (name: string) => {
  const code = patternCode(name)
  return code == null ? name || '데이터 없음' : typeDisplay(code).label
}

function LiveReviewGroupTable({ group, kind, selectedIds, editable, busy, onToggle }: { group: ReviewGroup; kind: ReviewKind; selectedIds: number[]; editable: boolean; busy: boolean; onToggle: (txId: number) => void }) {
  return <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4" aria-label={`거래 묶음 ${group.groupId}`}>
    <h3 className="text-sm font-medium">{kind === 'EPISODE' && group.sourceAlertId != null ? `Alert A-${group.sourceAlertId} · ` : ''}{group.label} · 묶음 {group.groupId}</h3>
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[1080px] table-fixed text-left text-xs">
        <thead className="border-b bg-muted/35 text-muted-foreground"><tr>{['선택', '거래 ID', '일시', '금액', '결제 수단', '송금 소유주', '송금 계좌', '수취 소유주', '수취 계좌', '점수', '편입 역할'].map(label => <th key={label} scope="col" className="px-2 py-2.5 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y">{group.members.map(member => <tr key={member.txId} className="interactive-surface">
          <td className="px-2 py-2.5"><input type="checkbox" aria-label={`거래 T-${member.txId} 선택`} checked={selectedIds.includes(member.txId)} disabled={!editable || busy || (kind === 'ALERT' ? !['PENDING', 'DECIDED'].includes(member.state) : member.state !== 'PENDING' || member.reviewRole !== 'SUBJECT')} onChange={() => onToggle(member.txId)} /></td>
          <td className="px-2 py-2.5 font-mono">T-{member.txId}</td>
          <td className="px-2 py-2.5 tabular-nums">{member.transaction.occurredAt ? member.transaction.occurredAt.slice(5, 16).replace('T', ' ') : '데이터 없음'}</td>
          <td className="px-2 py-2.5 tabular-nums">{moneyAmount(member.transaction.amountPaid)} {member.transaction.paymentCurrency}</td>
          <td className="px-2 py-2.5">{member.transaction.paymentFormat || '데이터 없음'}</td>
          <td className="px-2 py-2.5 text-muted-foreground">데이터 없음</td><td className="truncate px-2 py-2.5 font-mono" title={member.transaction.fromAccountId}>{member.transaction.fromAccountId}</td>
          <td className="px-2 py-2.5 text-muted-foreground">데이터 없음</td><td className="truncate px-2 py-2.5 font-mono" title={member.transaction.toAccountId}>{member.transaction.toAccountId}</td>
          <td className="px-2 py-2.5 text-muted-foreground">데이터 없음</td><td className="px-2 py-2.5">{member.transaction.role === 'SEED' ? '시작 거래' : member.reviewRole === 'CONTEXT' ? '참고 맥락' : '조사 대상'} · {member.state}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>
}

function CaseDetail({ caseId, kind, onBack, onOpenEpisode, refreshList }: { caseId: number; kind: ReviewKind; onBack: () => void; onOpenEpisode: (id: number) => void; refreshList: () => Promise<unknown> }) {
  const [tab, setTab] = useState<'overview' | 'graph' | 'transactions' | 'review'>('overview')
  const user = useCurrentUser()
  const detail = useAsync(() => fetchReviewCase(caseId), [caseId], { key: 'case/detail' })
  const { state, retry, refresh } = detail
  const [comment, setComment] = useState('')
  const [excludeComment, setExcludeComment] = useState('')
  const [unlinkComment, setUnlinkComment] = useState('')
  const [unlinkGroups, setUnlinkGroups] = useState<number[]>([])
  const [selectingAlerts, setSelectingAlerts] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [selected, setSelected] = useState<Record<number, number[]>>({})
  const previousRequest = useRef<{ payload: string; id: string; command: ReviewCommand; success: string } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [confirmDecision, setConfirmDecision] = useState<'NORMAL' | 'SUSPICIOUS' | null>(null)
  const [targetCaseId, setTargetCaseId] = useState<number | null>(null)
  const [scoreTxId, setScoreTxId] = useState<number | null>(null)
  const [moneyMinutes, setMoneyMinutes] = useState(180)
  const [scopeDraft, setScopeDraft] = useState<string[] | null>(null)
  const [scopeComment, setScopeComment] = useState('')
  const [scopeBusy, setScopeBusy] = useState(false)
  const scopeBusyRef = useRef(false)
  const [scopeRetry, setScopeRetry] = useState(false)
  const scopePrevious = useRef<{ revision: number; accounts: string[]; comment: string; requestId: string } | null>(null)
  const [targetPage, setTargetPage] = useState(0)
  const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
  const targets = useAsync(() => kind === 'ALERT' ? fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', page: targetPage, size: 20 }) : Promise.resolve(emptyPage), [kind, targetPage], { key: 'case/targets' })
  const money = useAsync(() => fetchReviewMoney(caseId, moneyMinutes), [caseId, moneyMinutes], { key: 'case/money' })

  if (state.status === 'loading') return <div className="space-y-5" role="status" aria-label="조사 사건 불러오는 중">
    <Button variant="outline" size="sm" onClick={onBack}>목록으로</Button>
    <header data-testid="detail-header"><div data-testid="detail-id" className="font-mono text-xs text-muted-foreground">{kind === 'ALERT' ? <Skeleton className="h-4 w-16" /> : `E-${caseId}`}</div><Skeleton className="mt-2 h-7 w-64" /><div data-testid="detail-tags" className="mt-3 flex gap-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-24" /></div></header>
    <UnderTabs value={tab} onChange={setTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '그래프' }, { value: 'transactions', label: '거래' }, { value: 'review', label: '검토 의견' }]} />
    {tab === 'overview' ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{['투입 원금', '거래 총액', '순유입', '근거 거래', kind === 'EPISODE' ? '연결 Alert' : '조사 대상', '거래 기간'].map(label => <Card key={label}><CardContent className="px-4"><p className="text-xs text-muted-foreground">{label}</p><Skeleton className="mt-2 h-6 w-24" /></CardContent></Card>)}</div><div className="grid gap-4 lg:grid-cols-2">{['일별 거래 금액', '상위 송금 계좌'].map(label => <section key={label} className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{label}</h2><div className="mt-4 space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-3 w-3/4" /></div></section>)}</div></> : <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{tab === 'graph' ? '관계 그래프' : tab === 'transactions' ? '조사 범위' : '조사 처리'}</h2><Skeleton className="mt-4 h-40 w-full" /></section>}
  </div>
  if (state.status === 'error') return <div className="space-y-3">
    {state.error instanceof ApiError && state.error.problem.status === 404 && <Button variant="outline" size="sm" onClick={onBack}>목록으로</Button>}
    <ErrorBlock message={state.error instanceof ApiError && state.error.problem.status === 404 ? '이전 사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : state.message} onRetry={retry} />
  </div>
  const item = state.data
  if (item.kind !== kind) return <ErrorBlock message="요청한 종류와 사건 정보가 다릅니다." onRetry={retry} />
  const editable = canEditOpen(user, item.assigneeId, item.status) && (kind !== 'ALERT' || item.episodeId == null) && !scopeBusy
  const hasSubject = (item.groups ?? []).some(group => group.members.some(member => member.reviewRole === 'SUBJECT' && member.state !== 'EXCLUDED' && member.state !== 'TRANSFERRED'))
  const graphModel = toReviewGraphModel(item)
  const linkedGroups = (item.groups ?? []).filter(group => group.sourceAlertId != null)
  const willDissolve = linkedGroups.length - unlinkGroups.length < 2
  const scoredMembers = [...new Map((item.groups ?? []).flatMap(group => group.members)
    .filter(member => member.state !== 'EXCLUDED' && member.state !== 'TRANSFERRED' && member.transaction.scores != null)
    .map(member => [member.txId, member] as const)).values()]
    .sort((a, b) => Number(b.transaction.role === 'SEED') - Number(a.transaction.role === 'SEED') || a.txId - b.txId)
  const scoreMember = scoredMembers.find(member => member.txId === scoreTxId) ?? scoredMembers[0]
  const patternCandidates = Array.from({ length: 9 }, (_, code) => ({ code: code as TypeCode, score: scoreMember?.transaction.scores?.[`p_${code}`] }))
    .filter((candidate): candidate is { code: TypeCode; score: number } => typeof candidate.score === 'number' && Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1)
    .sort((a, b) => b.score - a.score || a.code - b.code)
  const chosenAccounts = scopeDraft ?? (money.state.status === 'success' ? money.state.data.selectedAccounts ?? [] : [])
  const toggleAccount = (account: string) => {
    setScopeDraft(current => {
      const accounts = current ?? (money.state.status === 'success' ? money.state.data.selectedAccounts ?? [] : [])
      return accounts.includes(account) ? accounts.filter(value => value !== account) : [...accounts, account]
    })
    setScopeRetry(false)
  }
  const activeSelections = (item.groups ?? []).map(group => ({
    caseId: item.caseId, revision: item.revision, groupId: group.groupId,
    txIds: (selected[group.groupId] ?? []).filter(id => group.members.some(member => member.txId === id && member.state === 'PENDING' && member.reviewRole === 'SUBJECT')),
  })).filter(group => group.txIds.length)
  const removableSelections = (item.groups ?? []).map(group => ({
    caseId: item.caseId, revision: item.revision, groupId: group.groupId,
    txIds: (selected[group.groupId] ?? []).filter(id => group.members.some(member => member.txId === id && (member.state === 'PENDING' || member.state === 'DECIDED'))),
  })).filter(group => group.txIds.length)
  const toggleTx = (groupId: number, txId: number) => setSelected(current => {
    if (item.kind === 'EPISODE') {
      const group = item.groups?.find(group => group.groupId === groupId)
      if (!group) return current
      const all = episodeGroupSelection(item, group).txIds
      return { ...current, [groupId]: all.every(id => current[groupId]?.includes(id)) ? [] : all }
    }
    const ids = current[groupId] ?? []
    return { ...current, [groupId]: ids.includes(txId) ? ids.filter(id => id !== txId) : [...ids, txId] }
  })
  async function execute(action: ReviewAction, decision?: 'NORMAL' | 'SUSPICIOUS') {
    if (!editable || busyRef.current || scopeBusyRef.current) return
    const wholeCase = ['COMMENT', 'REVIEW_START', 'CLOSE'].includes(action)
    const selections = wholeCase ? [{ caseId: item.caseId, revision: item.revision, groupId: 0, txIds: [] }] : item.kind === 'EPISODE' ? (item.groups ?? []).filter(group => selected[group.groupId]?.length).map(group => episodeGroupSelection(item, group)) : action === 'EXCLUDE' ? removableSelections : activeSelections
    const reason = action === 'EXCLUDE' ? excludeComment.trim() : comment.trim()
    if (!reason) { toast.error('변경 사유를 입력해 주세요.'); return }
    if (!selections.length) { toast.error('미판정 거래를 선택해 주세요.'); return }
    if (action === 'DECIDE' && selections.some(selection => !selection.txIds.length)) { toast.error('미판정 조사 대상이 없습니다.'); return }
    await submit({ action, selections, decision: action === 'CLOSE' ? null : decision, comment: reason }, action === 'EXCLUDE' ? '선택 거래 제외 완료' : action === 'CLOSE' ? 'Episode 조사 종결 완료' : '조사 결과 저장 완료')
  }
  async function finalizeAlert(mode: 'NORMAL' | 'SUSPICIOUS' | 'EXISTING') {
    if (!editable || busyRef.current || scopeBusyRef.current) return
    if (!comment.trim()) { toast.error('변경 사유를 입력해 주세요.'); return }
    if (comment.trim().length > 4000) { toast.error('변경 사유는 4,000자 이하로 입력해 주세요.'); return }
    try { assertEditableAlert(item, user) } catch (error) { toast.error((error as Error).message); return }
    if (mode === 'NORMAL' || mode === 'SUSPICIOUS') {
      if (!hasSubject) { toast.error('조사 대상 거래가 없어 종결할 수 없습니다.'); return }
      await submit(buildAlertClose(item, mode, comment), mode === 'NORMAL' ? '정상 종결 완료' : '단독 세탁 의심 종결 완료')
      return
    }
    const target = targets.state.status === 'success' ? targets.state.data.content.find(row => row.caseId === targetCaseId) : undefined
    if (!target) { toast.error('편입할 Episode를 선택해 주세요.'); return }
    await submit(buildAlertTransfer([item], target, comment), `Episode E-${target.caseId} 편입 완료`)
  }
  async function submit(command: ReviewCommand, success: string) {
    if (busyRef.current || scopeBusyRef.current) return
    const payload = JSON.stringify(command)
    const requestId = previousRequest.current?.payload === payload ? previousRequest.current.id : crypto.randomUUID()
    previousRequest.current = { payload, id: requestId, command, success }
    busyRef.current = true
    setBusy(true)
    try {
      await submitReviewCommand(command, requestId)
      setUnlinkGroups([]); setUnlinkComment('')
      previousRequest.current = null; setCanRetry(false); setComment(''); setExcludeComment(''); setSelected({})
      window.dispatchEvent(new Event('review-command-saved'))
      const refreshed = await Promise.allSettled([refresh(), money.refresh(), targets.refresh(), refreshList()])
      toast.success(refreshed.some(result => result.status === 'rejected') ? `${success}. 저장은 완료됐지만 최신 화면을 불러오지 못했습니다. 다시 조회해 주세요.` : success)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setCanRetry(true)
        toast.error('처리 여부가 불확실합니다. 같은 요청을 재시도해 확인해 주세요.')
      } else {
        previousRequest.current = null; setCanRetry(false)
        toast.error(error.problem.status === 403 ? '이 사건을 변경할 권한이 없습니다.' : error.problem.status === 404 ? '사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : error.problem.status === 409 ? '사건 정보가 변경됐습니다. 최신 내용을 확인한 뒤 다시 제출해 주세요.' : error.problem.status >= 500 ? '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' : error.message)
        if (error.problem.status === 409 || error.problem.status === 404) {
          setUnlinkGroups([])
          setSelected({}); void Promise.allSettled([refresh(), money.refresh(), targets.refresh(), refreshList()])
        }
      }
    } finally { busyRef.current = false; setBusy(false) }
  }
  async function unlink() {
    if (!editable || busyRef.current || scopeBusyRef.current) return
    let command: ReviewCommand
    try { command = buildEpisodeUnlink(item, unlinkGroups, unlinkComment) }
    catch (error) { toast.error((error as Error).message); return }
    await submit(command, willDissolve ? 'Episode 해체 완료 · 모든 Alert를 다시 열었습니다.' : '선택 Alert 연결 해제 완료')
  }
  async function saveMoneyScope(previous?: { revision: number; accounts: string[]; comment: string; requestId: string }) {
    if (scopeBusyRef.current || busyRef.current) return
    if (!previous && (!editable || money.state.status !== 'success')) return
    const commentText = scopeComment.trim()
    if (!previous && (!commentText || commentText.length > 4000)) { toast.error('계좌 선택 사유를 1~4,000자로 입력해 주세요.'); return }
    const request = previous ?? {
      revision: money.state.status === 'success' ? money.state.data.revision ?? item.revision : item.revision,
      accounts: [...chosenAccounts], comment: commentText, requestId: crypto.randomUUID(),
    }
    scopePrevious.current = request
    scopeBusyRef.current = true; setScopeBusy(true)
    try {
      await setReviewMoneyScope(item.caseId, request.revision, request.accounts, request.comment, request.requestId)
      scopePrevious.current = null; setScopeRetry(false); setScopeDraft(null); setScopeComment('')
      const refreshed = await Promise.allSettled([refresh(), money.refresh(), refreshList()])
      toast.success(refreshed.some(result => result.status === 'rejected') ? '계좌 선택 저장 완료. 저장은 완료됐지만 최신 화면을 불러오지 못했습니다. 다시 조회해 주세요.' : '조사 중심 계좌 저장 완료')
    } catch (error) {
      if (!(error instanceof ApiError)) { setScopeRetry(true); toast.error('계좌 선택 처리 여부가 불확실합니다. 같은 요청을 재시도해 확인해 주세요.') }
      else {
        scopePrevious.current = null; setScopeRetry(false)
        toast.error(error.problem.status === 403 ? '이 사건의 계좌 범위를 변경할 권한이 없습니다.' : error.problem.status === 404 ? '사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : error.problem.status === 409 ? '사건 정보가 변경됐습니다. 최신 계좌 범위를 확인한 뒤 다시 제출해 주세요.' : error.problem.status >= 500 ? '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' : error.message)
        if (error.problem.status === 409 || error.problem.status === 404) { setScopeDraft(null); void Promise.allSettled([refresh(), money.refresh(), refreshList()]) }
      }
    } finally { scopeBusyRef.current = false; setScopeBusy(false) }
  }
  return <div className="space-y-5"><RefreshStatus queries={[detail, money, targets]} />
    <Button variant="outline" size="sm" onClick={onBack}>목록으로</Button>
    <header data-testid="detail-header">
      <p data-testid="detail-id" className="font-mono text-xs text-muted-foreground">{item.kind === 'ALERT' ? `A-${item.alertId ?? item.caseId}` : `E-${item.caseId}`}</p>
      <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{item.kind === 'EPISODE' ? (item.primaryTypes.length ? item.primaryTypes.map(patternLabel).join(' · ') : patternLabel(item.summary.primaryType)) : patternLabel(item.summary.primaryType)} · {item.kind === 'EPISODE' ? `Alert ${item.sourceAlertIds.length}건` : '대표 계좌 데이터 없음'}</h1>
      <div data-testid="detail-tags" className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{item.status === 'OPEN' ? '진행 중' : '종결'}</Badge>
        <RiskBadge score={item.summary.riskScore} />
        {item.kind === 'EPISODE' ? item.primaryTypes.map(type => { const code = patternCode(type); return code == null ? <Badge key={type} variant="outline">{type}</Badge> : <PatternBadge key={type} code={code} /> }) : (() => { const code = patternCode(item.summary.primaryType); return code == null ? null : <PatternBadge code={code} /> })()}
        <Badge variant="outline" className="font-normal">담당 {item.assigneeName}</Badge>
        <Badge variant="outline" className="font-normal">{item.kind === 'ALERT' ? '탐지' : '생성'} {item.createdAt?.slice(0, 10) ?? '—'}</Badge>
        {item.kind === 'ALERT' && item.episodeId != null && <Badge variant="outline" className="font-mono">연결된 Episode E-{item.episodeId}</Badge>}
      </div>
    </header>
    <UnderTabs value={tab} onChange={setTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '그래프' }, { value: 'transactions', label: '거래', count: item.summary.txCount }, { value: 'review', label: '검토 의견' }]} />
    <div hidden={tab !== 'overview'} className="space-y-4">
    <section className="grid items-stretch gap-3 @3xl:grid-cols-12 @6xl:grid-cols-6" aria-label="사건 요약">
      {[
        ['투입 원금', '데이터 없음'],
        ['거래 총액', Object.entries(item.summary.amountsByCurrency ?? {}).map(([currency, value]) => `${moneyAmount(value)} ${currency}`).join(' · ') || '데이터 없음'],
        ['순유입 (대표 계좌)', '데이터 없음'],
        [item.kind === 'EPISODE' ? '연결 Alert' : '근거 거래', `${item.kind === 'EPISODE' ? item.sourceAlertIds.length : item.summary.txCount}건`],
        [item.kind === 'EPISODE' ? '근거 거래' : '참여 계좌', item.kind === 'EPISODE' ? `${item.summary.txCount}건` : '데이터 없음'],
        ['거래 기간', item.summary.firstTxAt && item.summary.lastTxAt ? `${item.summary.firstTxAt.slice(5, 10)} ~ ${item.summary.lastTxAt.slice(5, 10)}` : '데이터 없음'],
      ].map(([label, value]) => <Card key={label} className="min-w-0 @3xl:col-span-4 @6xl:col-span-1" data-testid="overview-kpi-card"><CardContent className="px-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 truncate text-lg font-semibold tabular-nums" title={value}>{value}</p></CardContent></Card>)}
    </section>
    {item.kind === 'EPISODE' && <section className="rounded-xl border bg-card p-4" aria-label="연결 Alert">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">연결 Alert</h2>{item.status === 'OPEN' && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => { setSelectingAlerts(value => !value); setUnlinkGroups([]); setUnlinkComment('') }}>{selectingAlerts ? '선택 취소' : '연결 Alert 선택'}</Button>{selectingAlerts && <Button size="sm" disabled={!editable || busy || !unlinkGroups.length || !unlinkComment.trim()} onClick={() => setConfirmUnlink(true)}>선택 Alert 연결 해제</Button>}</div>}</div>
      <p className="mt-1 text-xs text-muted-foreground">이 Episode를 이루는 Alert</p>
      {selectingAlerts && <textarea aria-label="연결 해제 사유 (개요)" className="mt-3 min-h-16 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} value={unlinkComment} onChange={event => { setUnlinkComment(event.target.value); setCanRetry(false) }} placeholder="선택 Alert를 연결 해제하는 이유" disabled={!editable || busy} />}
      {item.sourceAlertIds.length ? <div className="mt-3 divide-y rounded-md border">{item.sourceAlertIds.map(alertId => { const group = linkedGroups.find(row => row.sourceAlertId === alertId); return <div key={alertId} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs">{selectingAlerts && group && <input type="checkbox" aria-label={`Alert A-${alertId} 선택`} checked={unlinkGroups.includes(group.groupId)} disabled={!editable || busy} onChange={() => { setUnlinkGroups(ids => ids.includes(group.groupId) ? ids.filter(id => id !== group.groupId) : [...ids, group.groupId]); setCanRetry(false) }} />}<span className="font-mono">A-{alertId}</span><span className="text-muted-foreground">계좌·은행 수 데이터 없음</span></div> })}</div> : <p className="mt-3 text-xs text-muted-foreground">연결된 Alert가 없습니다.</p>}
      {selectingAlerts && <p className="mt-2 text-xs text-muted-foreground">연결 해제 후 남은 Alert가 2건 미만이면 Episode가 해체됩니다.</p>}
    </section>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">일별 거래 금액</h2><p className="mt-1 text-xs text-muted-foreground">사건 거래의 날짜별 USD 금액 · 서버 집계</p>{Object.keys(item.summary.dailySuspiciousAmount ?? {}).length ? <div className="mt-5 flex h-44 items-end gap-2 border-b pb-2" role="img" aria-label="일별 거래 금액 막대 그래프">{Object.entries(item.summary.dailySuspiciousAmount ?? {}).map(([day, value]) => { const max = Math.max(1, ...Object.values(item.summary.dailySuspiciousAmount ?? {})); return <div key={day} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center" title={`${day} · ${moneyAmount(value)} USD`}><div className="w-full rounded-t bg-foreground" style={{ height: `${Math.max(2, value / max * 100)}%` }} /><span className="truncate text-[10px] text-muted-foreground">{day.slice(5)}</span></div> })}</div> : <p className="mt-5 text-xs text-muted-foreground">일별 금액 집계 없음</p>}</section>
      <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">상위 송금 계좌</h2><p className="mt-1 text-xs text-muted-foreground">자금이 어디서 나왔는지</p>{item.summary.topSenders?.length ? <div className="mt-4 space-y-3">{item.summary.topSenders.map(row => { const max = Math.max(1, ...item.summary.topSenders!.map(sender => sender.amount)); return <div key={row.accountCurrency} className="grid grid-cols-[minmax(0,auto)_auto_minmax(50px,1fr)] items-center gap-2 text-xs"><span className="max-w-28 truncate font-mono" title={row.accountCurrency}>{row.accountCurrency}</span><span className="tabular-nums">{moneyAmount(row.amount)}</span><div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{ width: `${row.amount / max * 100}%` }} /></div></div> })}</div> : <p className="mt-5 text-xs text-muted-foreground">송금 계좌 집계 없음</p>}</section>
    </div>
    <section className="rounded-xl border bg-card p-4" aria-label="사건 개요">
      <h2 className="font-semibold">사건 개요</h2>
      <p className="mt-2 text-sm">조사 대상 {item.summary.subjectCount}건 · 씨앗 거래 {item.summary.seedCount}건</p>
      {item.summary.typeShare != null && <p className="mt-1 text-sm">대표 유형 비중 {(item.summary.typeShare * 100).toFixed(1)}% <span className="text-xs text-muted-foreground">· 씨앗 거래 중 유형의 비중, 사건 확률 아님</span></p>}
      <p className="mt-1 text-xs text-muted-foreground">거래 기간 {item.summary.firstTxAt ? new Date(item.summary.firstTxAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'} ~ {item.summary.lastTxAt ? new Date(item.summary.lastTxAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><h3 className="text-xs font-semibold">조사 대상 거래액 · 통화별 합계</h3>{Object.entries(item.summary.amountsByCurrency ?? {}).length ? Object.entries(item.summary.amountsByCurrency).map(([currency, amount]) => <p key={currency} className="mt-1 text-sm">{currency} {moneyAmount(amount)}</p>) : <p className="mt-1 text-xs text-muted-foreground">합계 없음</p>}</div>
        <div><h3 className="text-xs font-semibold">결제 수단 · 거래 건수</h3>{Object.entries(item.summary.paymentFormats ?? {}).length ? Object.entries(item.summary.paymentFormats ?? {}).map(([format, count]) => <p key={format} className="mt-1 text-sm">{format} {count}건</p>) : <p className="mt-1 text-xs text-muted-foreground">집계 없음</p>}</div>
      </div>
      {Object.entries(item.summary.typeDistribution ?? {}).length > 0 && <p className="mt-3 text-xs text-muted-foreground">모델 이상 거래 유형별 건수 {Object.entries(item.summary.typeDistribution ?? {}).map(([type, count]) => `${type} ${count}건`).join(' · ')}</p>}
    </section>
    <div className="grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-4">
      {item.kind === 'ALERT' ? <>
        <section className="rounded-xl border bg-card p-4" aria-label="묶음 근거"><h2 className="font-semibold">묶음 근거</h2><p className="mt-1 text-xs text-muted-foreground">이 거래들이 한 Alert가 된 이유</p><p className="mt-3 text-xs text-muted-foreground">데이터 없음</p></section>
        <section className="rounded-xl border bg-card p-4" aria-label="조사 정보"><h2 className="font-semibold">조사 정보</h2><dl className="mt-3 grid grid-cols-[90px_1fr] gap-y-3 text-xs"><dt className="text-muted-foreground">조사 단위</dt><dd>Alert 한 건</dd><dt className="text-muted-foreground">분석 날짜</dt><dd>데이터 없음</dd><dt className="text-muted-foreground">참여 은행</dt><dd>데이터 없음</dd></dl></section>
      </> : <>
        <section className="rounded-xl border bg-card p-4" aria-label="패턴 증거"><h2 className="font-semibold">패턴 증거</h2><p className="mt-1 text-xs text-muted-foreground">Alert별 유형 확인 항목</p><p className="mt-3 text-xs text-muted-foreground">데이터 없음</p></section>
        <section className="rounded-xl border bg-card p-4" aria-label="대표 계좌 이력"><h2 className="font-semibold">대표 계좌 이력</h2><p className="mt-1 text-xs text-muted-foreground">같은 계좌가 나온 Alert</p><p className="mt-3 text-xs text-muted-foreground">데이터 없음</p></section>
      </>}
      <section className="rounded-xl border bg-card p-4 @3xl:col-span-2 @6xl:col-span-2" aria-label="처리 이력"><h2 className="font-semibold">처리 이력</h2><p className="mt-1 text-xs text-muted-foreground">담당자 · 변경 사유 · 시각</p>{item.history?.length ? <div className="mt-2 divide-y">{item.history.map(row => <div key={row.eventId} className="flex gap-2.5 py-2 text-xs"><span className="w-11 shrink-0 tabular-nums text-muted-foreground">{row.businessAt.slice(5, 10)}</span><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" /><div className="min-w-0 flex-1"><p>{row.action}<span className="ml-2 text-muted-foreground">{row.actor ?? '시스템'}</span></p><p className="mt-1 truncate text-muted-foreground">{row.comment}</p></div></div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">처리 이력이 없습니다.</p>}</section>
    </div>
    {item.kind === 'ALERT' && <section className="rounded-xl border bg-card p-4" aria-label="패턴 후보 확률">
      <h2 className="font-semibold">거래별 패턴 후보</h2>
      <p className="mt-1 text-xs text-muted-foreground">선택한 거래의 모델 유형 점수입니다. Alert 전체 확률이 아닙니다. 위 대표 유형은 씨앗 거래에서 가장 많이 나온 유형입니다.</p>
      {scoredMembers.length ? <><label className="mt-3 block text-xs">확률을 볼 거래 <select aria-label="확률을 볼 거래" className="ml-2 min-w-48 rounded-md border bg-background py-2 pl-3 pr-8" value={scoreMember.txId} onChange={event => setScoreTxId(Number(event.target.value))}>{scoredMembers.map(member => <option key={member.txId} value={member.txId}>T-{member.txId}{member.transaction.role === 'SEED' ? ' · 씨앗 거래' : ''}</option>)}</select></label>
        <ol aria-label="거래 패턴 후보" className="mt-3 space-y-2">{patternCandidates.map((candidate, index) => <li key={candidate.code} className="flex items-center gap-2 text-sm"><span className="w-5 text-muted-foreground">{index + 1}.</span><span className="rounded-full bg-foreground px-2.5 py-0.5 font-mono text-xs text-background">{typeDisplay(candidate.code).key}</span><strong className="tabular-nums">{(candidate.score * 100).toFixed(1)}%</strong></li>)}</ol>
        {!patternCandidates.length && <p className="mt-3 text-sm text-muted-foreground">이 거래의 패턴 점수가 없습니다.</p>}</> : <p className="mt-3 text-sm text-muted-foreground">점수가 제공된 거래가 없습니다.</p>}
    </section>}
    <section className="rounded-xl border bg-card p-4" aria-label="조사 계좌 자금 지표">
      <h2 className="font-semibold">조사 계좌 자금 지표</h2>
      <p className="mt-1 text-xs text-muted-foreground">서버가 수신한 원장 기준 · 계좌 간 자금 흐름의 FIFO 추정</p>
      <label className="mt-3 inline-flex items-center gap-2 text-xs">단시간 유출 비교 기간
        <select aria-label="단시간 유출 비교 기간" className="rounded-md border bg-background p-2" value={item.status === 'CLOSED' ? 180 : moneyMinutes} onChange={event => setMoneyMinutes(Number(event.target.value))} disabled={item.status === 'CLOSED'}>
          {moneyIntervals.map(minutes => <option key={minutes} value={minutes}>{minutes === 1440 ? '24시간' : `${minutes}분`}</option>)}
        </select>
      </label>
      {item.status === 'CLOSED' && <p className="mt-1 text-xs text-muted-foreground">종결 당시 180분 지표가 고정 저장됩니다.</p>}
      {money.state.status === 'loading' ? <div role="status" aria-label="자금 지표 불러오는 중" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(index => <div key={index} className="space-y-2 rounded-lg border p-3"><Skeleton className="h-4 w-16" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-3/5" /></div>)}</div> : money.state.status === 'error' ? <ErrorBlock message={money.state.message} onRetry={money.retry} /> : <>
        <p className="mt-3 text-xs text-muted-foreground">조사 중심 계좌 {money.state.data.selectedAccounts?.length ?? 0}개{money.state.data.customScope ? ' · 직접 지정' : ' · 씨앗 거래 기준'}{money.state.data.requestedFrom && money.state.data.requestedTo ? ` · 대상 거래일 ${money.state.data.requestedFrom} ~ ${money.state.data.requestedTo}` : ''}{money.state.data.ledgerCount != null ? ` · 원장 거래 ${money.state.data.ledgerCount}건` : ''}</p>
        {!money.state.data.available ? <p className="mt-3 text-sm text-muted-foreground">{({ EMPTY_SUBJECT_SCOPE: '조사 거래 범위가 없습니다.', EMPTY_ACCOUNT_SCOPE: '조사 계좌를 선택해야 합니다.', WAITING_RECEIPTS: '원장 수신 완료를 기다리는 중입니다.', NO_CLOSED_SNAPSHOT: '저장된 종결 시점 지표가 없습니다.' } as Record<string, string>)[money.state.data.reason ?? ''] ?? '현재 산출할 수 없습니다.'}</p> : <>
          {money.state.data.complete === false && <p className="mt-2 text-xs text-muted-foreground">원장 관측 일부만 완료됨 · 표시된 기간까지만 계산</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{money.state.data.external?.map(row => <div key={row.currency} className="rounded-lg border p-3 text-xs"><strong>{row.currency}</strong><p className="mt-2">외부 유입 {moneyAmount(row.in)}</p><p>외부 유출 {moneyAmount(row.out)}</p><p>외부 순유입 {moneyAmount(row.net)}</p></div>)}</div>
          <h3 className="mt-4 text-sm font-semibold">계좌별 지표</h3>
          <p className="mt-1 text-xs text-muted-foreground">집중도는 같은 통화의 양의 순유입 비중이며 잔액 비중이 아닙니다. 단시간 유출은 입금 후 선택 기간 내 출금의 추정 비율입니다.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{money.state.data.accounts?.length ? money.state.data.accounts.map(row => <div key={`${row.accountId}-${row.currency}`} className="min-w-0 rounded-lg border p-3 text-xs"><strong className="break-all">{row.accountId}</strong><span> · {row.currency}</span><p className="mt-2">유입 {moneyAmount(row.in)} · 유출 {moneyAmount(row.out)} · 순유입 {moneyAmount(row.net)}</p><p className="mt-1">집중도 {moneyPercent(row.concentrationPercent)} · 단시간 유출 {moneyPercent(row.rapidOutflowPercent)}</p><p className="mt-1 text-muted-foreground">평가 가능 입금 {moneyAmount(row.eligibleIn)} · 기간 끝 미성숙 입금 {moneyAmount(row.excludedIn)} · 기간 내 대응액 {moneyAmount(row.matchedIn)}</p></div>) : <p className="text-xs text-muted-foreground">계좌별 지표가 없습니다.</p>}</div>
        </>}
        {money.state.data.candidateAccounts && <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-semibold">조사 중심 계좌 선택</h3>
          <p className="mt-1 text-xs text-muted-foreground">선택한 가명 계좌를 기준으로 자금 지표를 다시 계산합니다. 사건 거래의 소속과 판정은 바뀌지 않습니다.</p>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{money.state.data.candidateAccounts.length ? money.state.data.candidateAccounts.map(account => <label key={account} className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`조사 중심 계좌 ${account}`} checked={chosenAccounts.includes(account)} onChange={() => toggleAccount(account)} disabled={!editable || scopeBusy || busy} /><span className="break-all">{account}</span></label>) : <p className="text-xs text-muted-foreground">선택할 계좌 후보가 없습니다.</p>}</div>
          <textarea aria-label="계좌 선택 사유" className="mt-3 min-h-16 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} placeholder="계좌를 포함하거나 제외한 이유" value={scopeComment} onChange={event => { setScopeComment(event.target.value); setScopeRetry(false) }} disabled={!editable || scopeBusy || busy} />
          <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!editable || scopeBusy || busy} onClick={() => void saveMoneyScope()}>조사 중심 계좌 저장</Button>{scopeRetry && <Button size="sm" variant="outline" disabled={scopeBusy || busy} onClick={() => { if (scopePrevious.current) void saveMoneyScope(scopePrevious.current) }}>같은 계좌 선택 요청 재시도</Button>}</div>
        </div>}
      </>}
    </section>
    </div>
    {tab === 'graph' && <section aria-label="관계 그래프" className="space-y-2"><h2 className="sr-only">관계 그래프</h2>{graphModel.edges.length ? <Graph model={graphModel} label={(item.kind === 'ALERT' ? `Alert A-${item.alertId}` : `Episode E-${item.caseId}`) + ' 관계 그래프'} nonSuspiciousLabel="의심 판정 없음 · 미분석 포함" panelExtra={focus => <section className="mt-4 border-t pt-4" data-testid="tx-label-panel"><h4 className="text-sm font-semibold">거래 판정</h4><p className="mt-1 text-xs text-muted-foreground">선택한 계좌·흐름의 실제 조사 거래입니다. 판정은 거래 탭에서 범위를 선택한 뒤 검토 의견에서 저장합니다.</p><div className="mt-3 divide-y rounded-md border">{focusTransactions(graphModel, focus).map(tx => <div key={tx.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"><span className="font-mono">T-{tx.id}</span><span className="text-muted-foreground">{tx.at.slice(5)}</span><span className="ml-auto tabular-nums">{moneyAmount(tx.amount)} {tx.currency}</span><Badge variant="outline" className="font-normal">{tx.label === 1 ? '이상 거래' : '정상 거래'}</Badge></div>)}</div><Button className="mt-3" size="sm" variant="outline" onClick={() => setTab('transactions')}>거래 탭에서 조사하기</Button></section>} /> : <EmptyBlock>표시할 거래가 없습니다.</EmptyBlock>}</section>}
    <div hidden={tab !== 'transactions'}>
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">조사 범위</h2>{item.kind === 'ALERT' && <Button size="sm" variant="outline" disabled={!editable || busy || !removableSelections.length || !excludeComment.trim()} onClick={() => void execute('EXCLUDE')}>선택 거래 제외</Button>}</div>{item.kind === 'ALERT' && <textarea aria-label="거래 제외 사유" className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} placeholder="선택 거래를 조사 범위에서 제외하는 이유" value={excludeComment} onChange={event => { setExcludeComment(event.target.value); setCanRetry(false) }} disabled={!editable || busy} />}{(item.groups ?? []).length ? item.groups?.map(group => <LiveReviewGroupTable key={group.groupId} group={group} kind={item.kind} selectedIds={selected[group.groupId] ?? []} editable={editable} busy={busy} onToggle={txId => toggleTx(group.groupId, txId)} />) : <EmptyBlock>조사 범위가 없습니다.</EmptyBlock>}</section>
    </div>
    <div hidden={tab !== 'review'} className="space-y-4">
    <div className="grid items-stretch gap-4 @5xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="review-layout">
    <section className="h-full rounded-xl border bg-card p-5"><h2 className="font-semibold">{item.kind === 'ALERT' ? item.status === 'CLOSED' ? '판정 완료' : '검토 의견' : '조사 의견'}</h2><p className="mt-1 text-xs text-muted-foreground">본인 담당 진행 중 사건만 변경 가능 · 변경 뒤 최신 사건 정보 재조회</p><textarea aria-label="변경 사유" className="mt-4 min-h-[280px] w-full resize-y rounded-md border bg-background p-3 text-sm leading-7" placeholder={item.kind === 'ALERT' ? '확인한 거래, 계좌 간 관계, 판단 근거를 작성하세요.' : '연결한 Alert의 공통점과 조사 내용을 작성하세요.'} maxLength={4000} value={comment} onChange={event => { setComment(event.target.value); setCanRetry(false) }} disabled={!editable || busy} /><div className="mt-3 flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('COMMENT')}>의견 저장</Button><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('REVIEW_START')}>검토 시작 기록</Button><Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'NORMAL')}>선택 범위 정상 판정</Button>{item.kind === 'EPISODE' && <Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'SUSPICIOUS')}>선택 범위 이상 판정</Button>}{item.kind === 'EPISODE' && <Button size="sm" variant="outline" disabled={!editable || busy || item.pendingCount > 0} onClick={() => void execute('CLOSE')}>사건 종결</Button>}{canRetry && <Button size="sm" variant="outline" disabled={busy} onClick={() => { const previous = previousRequest.current; if (previous) void submit(previous.command, previous.success) }}>같은 요청 재시도</Button>}</div>
      {item.kind === 'ALERT' && <div className="mt-4 space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">최종 처리</h3>
        {item.episodeId != null && <p className="text-xs text-muted-foreground">Episode E-{item.episodeId}에 편입된 Alert입니다. <Button size="sm" variant="link" onClick={() => onOpenEpisode(item.episodeId!)}>Episode E-{item.episodeId} 보기</Button></p>}
        {!hasSubject && item.status === 'OPEN' && <p className="text-xs text-destructive-text">조사 대상 거래가 없어 최종 종결할 수 없습니다.</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!editable || busy || !hasSubject} onClick={() => setConfirmDecision('NORMAL')}>정상 종결</Button><Button size="sm" variant="destructive" disabled={!editable || busy || !hasSubject} onClick={() => setConfirmDecision('SUSPICIOUS')}>단독 세탁 의심 종결</Button></div>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="편입할 Episode" className="rounded-md border bg-background p-2 text-xs" value={targetCaseId ?? ''} onChange={event => setTargetCaseId(event.target.value ? Number(event.target.value) : null)} disabled={!editable || busy}><option value="">진행 중 Episode 선택</option>{targets.state.status === 'success' && targets.state.data.content.map(row => <option key={row.caseId} value={row.caseId}>E-{row.caseId} · {row.assigneeName}</option>)}</select><Button size="sm" variant="outline" disabled={!editable || busy || targetCaseId == null} onClick={() => void finalizeAlert('EXISTING')}>기존 Episode에 전체 편입</Button></div>
        {targets.state.status === 'error' && <ErrorBlock message={targets.state.message} onRetry={targets.retry} />}
        {targets.state.status === 'success' && targets.state.data.totalPages > 1 && <div className="flex items-center gap-2 text-xs"><Button size="sm" variant="outline" aria-label="이전 Episode 목적지" disabled={targetPage === 0} onClick={() => { setTargetCaseId(null); setTargetPage(page => page - 1) }}>이전</Button><span>{targetPage + 1}/{targets.state.data.totalPages}쪽 · 전체 {targets.state.data.totalElements}건</span><Button size="sm" variant="outline" aria-label="다음 Episode 목적지" disabled={targetPage + 1 >= targets.state.data.totalPages} onClick={() => { setTargetCaseId(null); setTargetPage(page => page + 1) }}>다음</Button></div>}
        <p className="text-xs text-muted-foreground">새 Episode는 본인 담당 Alert를 최소 2개 선택해야 합니다.</p><Button size="sm" variant="outline" onClick={onBack}>목록에서 새 Episode 만들기</Button>
      </div>}</section>
    <aside className="h-full rounded-xl border bg-card p-5" data-testid="review-reference"><h2 className="font-semibold">참고 정보</h2><p className="mt-1 text-xs text-muted-foreground">판단 전에 대조할 조사 요약</p><dl className="mt-5 space-y-4 text-xs"><div><dt className="text-muted-foreground">검토 범위</dt><dd className="mt-1 font-medium">거래 {item.summary.txCount}건 · 조사 대상 {item.summary.subjectCount}건</dd></div><div><dt className="text-muted-foreground">대표 계좌</dt><dd className="mt-1 font-medium">데이터 없음</dd></div><div><dt className="text-muted-foreground">참여 소유주</dt><dd className="mt-1 font-medium">데이터 없음</dd></div><div><dt className="text-muted-foreground">연결 Alert</dt><dd className="mt-1 font-medium">{item.kind === 'EPISODE' ? `${item.sourceAlertIds.length}건` : '해당 없음'}</dd></div></dl><div className="mt-5 border-t pt-4"><p className="text-xs font-medium">판단 전 확인</p><ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground"><li>거래 목적과 고객 프로필이 일치하는가</li><li>송금·수취 관계를 입증할 자료가 있는가</li><li>같은 소유주의 다른 Alert가 있는가</li></ul></div></aside>
    </div>
    {item.outcome === 'DISSOLVED' && <p role="status" className="rounded-lg border p-3 text-sm">해체된 Episode입니다. 현재 소속 Alert는 없으며 해제 당시 구성과 사유는 아래 이력에 보존됩니다.</p>}
    {item.kind === 'EPISODE' && item.status === 'OPEN' && <section aria-label="Alert 연결 해제" className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Alert 연결 해제</h2>
      <p className="mt-1 text-xs text-muted-foreground">해제된 Alert는 원래 담당자의 진행 중 업무로 돌아갑니다. 남는 Alert가 2개 미만이면 모두 연결 해제하고 Episode는 해체 종결 이력으로 보존합니다.</p>
      <div className="mt-3 space-y-2">{linkedGroups.map(group => <label key={group.groupId} className="flex items-center gap-2 text-sm">
        <input type="checkbox" aria-label={`연결 해제 Alert A-${group.sourceAlertId}`} disabled={!editable || busy} checked={unlinkGroups.includes(group.groupId)} onChange={() => { setUnlinkGroups(ids => ids.includes(group.groupId) ? ids.filter(id => id !== group.groupId) : [...ids, group.groupId]); setCanRetry(false) }} />
        Alert A-{group.sourceAlertId}
      </label>)}</div>
      <textarea aria-label="연결 해제 사유" className="mt-3 min-h-20 w-full rounded-md border bg-background p-3 text-sm" maxLength={4000} value={unlinkComment} disabled={!editable || busy} onChange={event => { setUnlinkComment(event.target.value); setCanRetry(false) }} placeholder="연결을 해제하는 이유 (필수)" />
      <Button size="sm" variant="outline" disabled={!editable || busy || !unlinkGroups.length || !unlinkComment.trim()} onClick={() => setConfirmUnlink(true)}>선택 Alert 연결 해제</Button>
    </section>}
    <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{willDissolve ? 'Episode를 해체할까요?' : '선택 Alert의 연결을 해제할까요?'}</AlertDialogTitle>
      <AlertDialogDescription>{willDissolve ? `소속 Alert ${linkedGroups.length}건 모두 OPEN으로 복원됩니다. Episode와 해제 사유는 종결 이력으로 보존됩니다.` : `선택한 Alert ${unlinkGroups.length}건을 원래 담당자의 OPEN 업무로 복원합니다.`}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={!editable || busy} onClick={() => { setConfirmUnlink(false); void unlink() }}>{willDissolve ? 'Episode 해체 확인' : '연결 해제 확인'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {!!item.detachments?.length && <section aria-label="연결 해제 이력" className="space-y-3"><h2 className="font-semibold">연결 해제 이력</h2>{item.detachments.map(entry => <details key={entry.eventId} className="rounded-lg border p-3 text-sm">
      <summary>{entry.action === 'DISSOLVE' ? 'Episode 해체' : 'Alert 연결 해제'} · {entry.comment}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{new Date(entry.businessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 아래 내용은 해제 당시 기록이며 현재 소속이 아닙니다.</p>
      {entry.snapshot.groups.map(group => <div key={group.groupId} className="mt-2"><strong>Alert A-{group.sourceAlertId}</strong>{group.members.map(member => <p key={member.txId} className="text-xs">T-{member.txId} · {member.reviewRole} · {member.state} · {member.decision ?? '미판정'}</p>)}</div>)}
    </details>)}</section>}
    <AlertDialog open={confirmDecision != null} onOpenChange={open => { if (!open) setConfirmDecision(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmDecision === 'NORMAL' ? '정상 종결' : '단독 세탁 의심 종결'}을 확정할까요?</AlertDialogTitle><AlertDialogDescription>제외되지 않은 조사 대상 전체에 최종 판정을 적용합니다. 참고 맥락·제외 거래에는 판정하지 않습니다. 기존 범위 판정은 최종 판정으로 바뀔 수 있으며 이전 내역은 감사 기록에 남습니다. 종결 후 직접 수정할 수 없습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { const decision = confirmDecision; setConfirmDecision(null); if (decision) void finalizeAlert(decision) }}>최종 종결 확정</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  </div>
}

export default function LiveCasesPage({ kind, caseId, onOpen, onBack, onOpenEpisode }: { kind: ReviewKind; caseId?: number; onOpen: (id: number) => void; onBack: () => void; onOpenEpisode?: (id: number) => void }) {
  const user = useCurrentUser()
  const [queryText, setQueryText] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [status, setStatus] = useViewState<ReviewQuery['status'] | 'ALL'>(`${kind}/status`, 'ALL')
  const [mine, setMine] = useViewState(`${kind}/mine`, false)
  const { from, to, setPeriod } = useSharedPeriod()
  const range: DateRange | undefined = from || to ? { from: from ? new Date(`${from}T00:00:00`) : undefined, to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined
  const scope = JSON.stringify([kind, from, to, status, mine])
  const [page, setPage] = useViewState(`${scope}/page`, 0)
  const [selectedIds, setSelectedIds] = useViewState<number[]>(`${scope}/${page}/selected`, [])

  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const previousRequest = useRef<{ payload: string; id: string; command: ReviewCommand } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const query: ReviewQuery = { kind, status: status === 'ALL' ? undefined : status, assigneeId: mine ? user.userId : undefined, from: from || undefined, to: to || undefined, page, size: 20 }
  const list = useAsync(() => fetchReviewCases(query), [kind, status, mine, from, to, page], { key: 'cases', enabled: Boolean(from && to) })
  const { state, retry, refresh } = list
  const selectedRows = state.status === 'success' ? state.data.content.filter(row => selectedIds.includes(row.caseId)) : []
  const eligible = (row: ReviewCase) => user.role === 'STAFF' && row.kind === 'ALERT' && row.status === 'OPEN' && row.assigneeId === user.userId && row.episodeId == null
  const toggleSelected = (row: ReviewCase) => {
    if (!eligible(row) || busy) return
    setSelectedIds(ids => ids.includes(row.caseId) ? ids.filter(id => id !== row.caseId) : [...ids, row.caseId])
    setCanRetry(false)
  }
  const clearSelection = () => { setSelectedIds([]); setCanRetry(false); previousRequest.current = null; setPage(0) }
  const visibleRows = state.status === 'success' ? state.data.content.filter(row => `${row.kind === 'ALERT' ? `A-${row.alertId ?? row.caseId}` : `E-${row.caseId}`} ${row.summary.primaryType} ${row.assigneeName}`.toLowerCase().includes(queryText.trim().toLowerCase())) : []
  const download = () => {
    if (state.status !== 'success') return
    const lines = ['ID,위험도,탐지 유형,거래,담당자,상태', ...visibleRows.map(row => `${row.kind === 'ALERT' ? `A-${row.alertId ?? row.caseId}` : `E-${row.caseId}`},${row.summary.riskScore ?? ''},${row.summary.primaryType},${row.summary.txCount},${row.assigneeName},${row.status}`)]
    const url = URL.createObjectURL(new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${kind.toLowerCase()}-cases.csv`; link.click(); URL.revokeObjectURL(url)
  }
  async function submitNew(command?: ReviewCommand) {
    if (busyRef.current) return
    if (!comment.trim() || comment.trim().length > 4000) { toast.error('변경 사유를 1~4,000자로 입력해 주세요.'); return }
    let next: ReviewCommand
    try {
      if (command) next = command
      else {
        selectedRows.forEach(row => assertEditableAlert(row, user))
        next = buildAlertTransfer(selectedRows, null, comment)
      }
    } catch (error) { toast.error((error as Error).message); return }
    const payload = JSON.stringify(next)
    const id = previousRequest.current?.payload === payload ? previousRequest.current.id : crypto.randomUUID()
    previousRequest.current = { payload, id, command: next }
    busyRef.current = true; setBusy(true)
    try {
      const result = await submitReviewCommand(next, id)
      previousRequest.current = null; setCanRetry(false); setSelectedIds([]); setComment('')
      window.dispatchEvent(new Event('review-command-saved'))
      try {
        await refresh()
        toast.success(`Episode E-${result.targetCaseId} 생성 완료`)
      } catch { toast.success('Episode 생성 완료. 저장은 완료됐지만 최신 화면을 불러오지 못했습니다. 다시 조회해 주세요.') }
    } catch (error) {
      if (!(error instanceof ApiError)) { setCanRetry(true); toast.error('처리 여부가 불확실합니다. 같은 요청을 재시도해 확인해 주세요.') }
      else {
        previousRequest.current = null; setCanRetry(false)
        toast.error(error.problem.status === 409 ? '사건 정보가 변경됐습니다. 최신 목록을 확인한 뒤 다시 제출해 주세요.' : error.problem.status === 403 ? '선택한 Alert를 변경할 권한이 없습니다.' : error.problem.status === 404 ? '사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : error.problem.status >= 500 ? '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' : error.message)
        if (error.problem.status === 409 || error.problem.status === 404) { setSelectedIds([]); void refresh().catch(() => undefined) }
      }
    } finally { busyRef.current = false; setBusy(false) }
  }
  if (caseId) return <CaseDetail key={`${kind}-${caseId}`} caseId={caseId} kind={kind} onBack={onBack} onOpenEpisode={onOpenEpisode ?? onBack} refreshList={() => { setSelectedIds([]); return refresh() }} />
  return <div className="max-w-[1320px] space-y-4"><RefreshStatus queries={[list]} />
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative mr-1 w-64 max-w-full"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="ID, 탐지 유형, 담당자 검색" className="h-9 pl-9 text-xs" placeholder="ID, 탐지 유형, 담당자 검색" value={queryText} onChange={event => setQueryText(event.target.value)} /></div>
      <DateRangeButton value={range} onChange={next => { setPeriod({ from: next?.from?.toLocaleDateString('sv-SE') ?? from, to: next?.to?.toLocaleDateString('sv-SE') ?? to }); clearSelection() }} today={new Date()} />
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><Button variant="outline" size="sm" className="filter-trigger date-range-control h-9"><ListFilter className="size-3.5" />필터{(status !== 'ALL' || mine) && <Badge className="ml-1 h-5 min-w-5 px-1.5">{Number(status !== 'ALL') + Number(mine)}</Badge>}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3"><label className="block text-xs font-medium">상태<select aria-label="상태" className="mt-2 w-full rounded-md border bg-background p-2" value={status} onChange={event => { setStatus(event.target.value as typeof status); clearSelection() }}><option value="ALL">전체</option><option value="OPEN">진행 중</option><option value="CLOSED">종결</option></select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); clearSelection() }} />내 담당</label></PopoverContent></Popover>
      {kind === 'ALERT' && !selecting && <Button variant="outline" size="sm" className="ml-auto" onClick={() => setSelecting(true)}><Combine className="size-4" />Episode로 묶기</Button>}
      <Button variant="outline" size="sm" className={kind === 'EPISODE' ? 'ml-auto' : ''} onClick={download}><Download className="size-4" />다운로드</Button>
    </div>
    {(status !== 'ALL' || mine) && <div className="flex flex-wrap gap-2">{status !== 'ALL' && <FilterChip onRemove={() => { setStatus('ALL'); clearSelection() }}>상태: {status === 'OPEN' ? '진행 중' : '종결'}</FilterChip>}{mine && <FilterChip onRemove={() => { setMine(false); clearSelection() }}>내 담당</FilterChip>}</div>}
    {selecting && kind === 'ALERT' && <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-3"><strong className="mr-auto text-sm">{selectedRows.length}건 선택</strong><input aria-label="새 Episode 생성 사유" className="h-9 min-w-52 flex-1 rounded-md border bg-background px-3 text-sm" maxLength={4000} value={comment} onChange={event => { setComment(event.target.value); setCanRetry(false) }} placeholder="Alert를 묶는 근거 (필수)" disabled={busy} /><Button size="sm" disabled={selectedRows.length < 2 || !comment.trim() || busy} onClick={() => void submitNew()}>새 Episode 생성</Button><Button size="sm" variant="outline" onClick={() => { setSelecting(false); clearSelection(); setComment('') }}>선택 취소</Button>{canRetry && <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (previousRequest.current) void submitNew(previousRequest.current.command) }}>같은 요청 재시도</Button>}</div>}
    {state.status === 'loading' ? <div role="status" aria-label="조사 사건 불러오는 중" className="overflow-x-auto rounded-md border"><table className="w-full min-w-[990px] table-fixed text-sm"><thead><tr className="border-b text-left">{[...(selecting && kind === 'ALERT' ? ['선택'] : []), 'ID / 구성', '위험도', '탐지 유형', '거래 총액', '거래', '담당자', '상태', kind === 'ALERT' ? '탐지일' : '생성일', kind === 'ALERT' ? 'Episode 연결' : 'Alert'].map(label => <th key={label} className="px-2.5 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{[0, 1, 2, 3, 4, 5].map(row => <tr key={row} className="border-b last:border-0">{Array.from({ length: selecting && kind === 'ALERT' ? 10 : 9 }, (_, cell) => <td key={cell} className="px-2.5 py-3"><Skeleton className={`h-4 ${cell === 0 ? 'w-14' : 'w-full'}`} /></td>)}</tr>)}</tbody></table></div> : state.status === 'error' ? <ErrorBlock message={state.message} onRetry={retry} /> : <>
      {visibleRows.length ? <ReviewCaseTable kind={kind} rows={visibleRows} selecting={selecting} selectedIds={selectedIds} busy={busy} eligible={eligible} onToggle={toggleSelected} onOpen={onOpen} /> : <EmptyBlock>조건에 맞는 조사 사건이 없습니다.</EmptyBlock>}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>총 {state.data.totalElements}건</span><div className="flex items-center gap-2"><span>{page + 1} / {Math.max(1, state.data.totalPages)}</span><Button size="sm" variant="outline" disabled={page === 0} onClick={() => { setSelectedIds([]); setPage(page - 1) }}>이전</Button><Button size="sm" variant="outline" disabled={page + 1 >= state.data.totalPages} onClick={() => { setSelectedIds([]); setPage(page + 1) }}>다음</Button></div></div>
    </>}

  </div>
}
