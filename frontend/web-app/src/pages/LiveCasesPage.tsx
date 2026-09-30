import { CaseActivityCharts, type ActivityAmounts } from '@/features/alerts/CaseActivityCharts'
import { ReviewLayout } from '@/features/alerts/ReviewLayout'
import AlertTxTable from '@/features/alerts/AlertTxTable'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/common'
import { fetchReviewCase, fetchReviewCases, fetchReviewUsers, fetchReviewMoney, setReviewMoneyScope, submitReviewCommand, type ReviewAction, type ReviewCommand, type ReviewKind } from '@/api/liveReview'
import { CaseHeader, CaseStats } from '@/features/alerts/CasePresentation'
import { Badge } from '@/components/ui/badge'
import { RiskBadge } from '@/components/badges'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useCurrentUser, canEditOpen } from '@/app/session'
import { useAsync } from '@/lib/useAsync'
import { assertEditableAlert, buildAlertClose, buildAlertTransfer, buildEpisodeUnlink, episodeGroupSelection } from '@/api/reviewCommands'
import { toReviewGraphModel } from '@/features/graph/liveAdapter'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { typeDisplay, type TypeCode } from '@/api/codes'
import Graph from '@/features/graph/v24/Graph'
import type { DateRange } from 'react-day-picker'
import { isoDate } from '@/lib/format'
import AlertList from '@/features/alerts/AlertList'
import EpisodeList from '@/features/episodes/EpisodeList'
import type { AlertFilter } from '@/features/alerts/alertFilters'
import type { EpisodeFilter } from '@/features/episodes/episodeFilters'
import { alertListRow, episodeListRow } from '@/features/alerts/reviewListAdapter'

const moneyIntervals = [5, 15, 30, 60, 180, 360, 1440] as const
const moneyAmount = (value: number) => Number(value).toLocaleString('ko-KR')
const moneyPercent = (value: number | null) => value == null ? '산출 불가' : `${value.toFixed(1)}%`

function CaseDetail({ caseId, kind, onBack, onOpenEpisode, refreshList }: { caseId: number; kind: ReviewKind; onBack: () => void; onOpenEpisode: (id: number) => void; refreshList: () => Promise<unknown> }) {
  const [tab, setTab] = useState<'overview' | 'graph' | 'transactions' | 'review'>('overview')
  const user = useCurrentUser()
  const detail = useAsync(() => fetchReviewCase(caseId), [caseId], { key: 'case/detail', maxAge: 60_000 })
  const { state, retry, refresh } = detail
  const [comment, setComment] = useState('')
  const [excludeComment, setExcludeComment] = useState('')
  const [unlinkComment, setUnlinkComment] = useState('')
  const [unlinkGroups, setUnlinkGroups] = useState<number[]>([])
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
  const targets = useAsync(() => kind === 'ALERT' ? fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', page: targetPage, size: 20 }) : Promise.resolve(emptyPage), [kind, targetPage], { key: 'case/targets', maxAge: 60_000 })
  const money = useAsync(() => fetchReviewMoney(caseId, moneyMinutes), [caseId, moneyMinutes], { key: 'case/money', maxAge: 60_000 })

  if (state.status === 'loading') return <LoadingBlock label="조사 사건" />
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
  const activityAmounts: ActivityAmounts = {}
  for (const [key, amount] of Object.entries(item.summary.dailySuspiciousAmount ?? {})) {
    const split = key.lastIndexOf('|')
    const day = split < 0 ? key : key.slice(0, split)
    const currency = split < 0 ? '통화 미제공' : key.slice(split + 1)
    ;(activityAmounts[currency] ??= { daily: [], senders: [] }).daily.push({ day, amount })
  }
  for (const sender of item.summary.topSenders ?? []) {
    const split = sender.accountCurrency.lastIndexOf('|')
    const currency = split < 0 ? '통화 미제공' : sender.accountCurrency.slice(split + 1)
    const account = split < 0 ? sender.accountCurrency : sender.accountCurrency.slice(0, split)
    ;(activityAmounts[currency] ??= { daily: [], senders: [] }).senders.push({ name: account, v: sender.amount })
  }
  Object.values(activityAmounts).forEach(values => values.daily.sort((a, b) => a.day.localeCompare(b.day)))
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
    <CaseHeader id={item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`} title={item.kind === 'ALERT' ? item.summary.primaryType : `${item.primaryTypes.join(' · ')} · Alert ${item.sourceAlertIds.length}건`}
      tab={tab} onTab={setTab} count={item.summary.txCount} tags={<><Badge variant="outline">{item.status === 'OPEN' ? '진행 중' : '종결'}</Badge><RiskBadge score={item.summary.riskScore} /><Badge variant="outline">담당 {item.assigneeName}</Badge><Badge variant="outline">{item.createdAt ? new Date(item.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '—'}</Badge></>} />
    <div hidden={tab !== 'overview'} className="space-y-4">
    <CaseStats items={[
        ['거래 총액', Object.entries(item.summary.amountsByCurrency ?? {}).map(([currency, value]) => `${moneyAmount(value)} ${currency}`).join(' · ') || '—'],
        ['거래', `${item.summary.txCount}건`],
        ['조사 대상', `${item.summary.subjectCount}건`],
        [item.kind === 'EPISODE' ? '연결 Alert' : '씨앗 거래', `${item.kind === 'EPISODE' ? item.sourceAlertIds.length : item.summary.seedCount}건`],
        ['위험도', item.summary.riskScore?.toFixed(2) ?? '—'],
        ['거래 기간', `${item.summary.firstTxAt?.slice(5, 10) ?? '—'} ~ ${item.summary.lastTxAt?.slice(5, 10) ?? '—'}`],
      ].map(([label, value]) => ({ label, value }))} />
    <CaseActivityCharts amounts={activityAmounts} />
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
      {money.state.status === 'loading' ? <LoadingBlock label="자금 지표" /> : money.state.status === 'error' ? <ErrorBlock message={money.state.message} onRetry={money.retry} /> : <>
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
    {tab === 'graph' && <section aria-label="관계 그래프" className="space-y-2"><h2 className="font-semibold">관계 그래프</h2>{graphModel.edges.length ? <Graph model={graphModel} label={(item.kind === 'ALERT' ? `Alert A-${item.alertId}` : `Episode E-${item.caseId}`) + ' 관계 그래프'} nonSuspiciousLabel="의심 판정 없음 · 미분석 포함" /> : <EmptyBlock>표시할 거래가 없습니다.</EmptyBlock>}</section>}
    <div hidden={tab !== 'transactions'}>
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">조사 범위</h2>{item.kind === 'ALERT' && <Button size="sm" variant="outline" disabled={!editable || busy || !removableSelections.length || !excludeComment.trim()} onClick={() => void execute('EXCLUDE')}>선택 거래 제외</Button>}</div>{item.kind === 'ALERT' && <textarea aria-label="거래 제외 사유" className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} placeholder="선택 거래를 조사 범위에서 제외하는 이유" value={excludeComment} onChange={event => { setExcludeComment(event.target.value); setCanRetry(false) }} disabled={!editable || busy} />}{(item.groups ?? []).length ? item.groups?.map(group => <div key={group.groupId} className="rounded-xl border bg-card p-4"><h3 className="text-sm font-medium">{item.kind === 'EPISODE' && group.sourceAlertId != null ? `Alert A-${group.sourceAlertId} · ` : ''}{group.label} · 묶음 {group.groupId}</h3><AlertTxTable remote rows={group.members.map(member => ({
      txId: member.txId, txAt: new Date(member.transaction.occurredAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'),
      fromAccount: member.transaction.fromAccountId, toAccount: member.transaction.toAccountId,
      amountPaid: Number(member.transaction.amountPaid), paymentCurrency: member.transaction.paymentCurrency, paymentFormat: member.transaction.paymentFormat,
      launderingScore: member.transaction.scores?.p_laundering ?? null, role: member.transaction.role,
      reviewLabel: `${member.reviewRole} · ${member.state}${member.decision ? ` · ${member.decision}` : ''}`,
    }))} selection={{ ids: selected[group.groupId] ?? [], onToggle: id => toggleTx(group.groupId, id), disabled: id => { const member = group.members.find(row => row.txId === id)!; return !editable || busy || (item.kind === 'ALERT' ? !['PENDING','DECIDED'].includes(member.state) : member.state !== 'PENDING' || member.reviewRole !== 'SUBJECT') } }} /></div>) : <EmptyBlock>조사 범위가 없습니다.</EmptyBlock>}</section>
    </div>
    <div hidden={tab !== 'review'} className="space-y-4">
    <ReviewLayout reference={<dl className="space-y-4 text-xs"><div><dt>검토 범위</dt><dd>거래 {item.summary.txCount}건 · 조사 대상 {item.summary.subjectCount}건</dd></div><div><dt>유형</dt><dd>{item.kind === 'ALERT' ? item.summary.primaryType : item.primaryTypes.join(' · ')}</dd></div><div><dt>조사 대상 거래액</dt><dd>{Object.entries(item.summary.amountsByCurrency).map(([currency, amount]) => <p key={currency}>{currency} {moneyAmount(amount)}</p>)}</dd></div></dl>}><h2 className="font-semibold">조사 처리</h2><p className="mt-1 text-xs text-muted-foreground">본인 담당 진행 중 사건만 변경 가능 · 변경 뒤 최신 사건 정보 재조회</p><textarea aria-label="변경 사유" className="mt-3 min-h-[280px] w-full flex-1 resize-y rounded-md border bg-background p-3 text-sm leading-7" placeholder="조사 의견 또는 변경 사유" maxLength={4000} value={comment} onChange={event => { setComment(event.target.value); setCanRetry(false) }} disabled={!editable || busy} /><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('COMMENT')}>의견 저장</Button><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('REVIEW_START')}>검토 시작 기록</Button><Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'NORMAL')}>선택 범위 정상 판정</Button>{item.kind === 'EPISODE' && <Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'SUSPICIOUS')}>선택 범위 이상 판정</Button>}{item.kind === 'EPISODE' && <Button size="sm" variant="outline" disabled={!editable || busy || item.pendingCount > 0} onClick={() => void execute('CLOSE')}>사건 종결</Button>}{canRetry && <Button size="sm" variant="outline" disabled={busy} onClick={() => { const previous = previousRequest.current; if (previous) void submit(previous.command, previous.success) }}>같은 요청 재시도</Button>}</div>
      {item.kind === 'ALERT' && <div className="mt-4 space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">최종 처리</h3>
        {item.episodeId != null && <p className="text-xs text-muted-foreground">Episode E-{item.episodeId}에 편입된 Alert입니다. <Button size="sm" variant="link" onClick={() => onOpenEpisode(item.episodeId!)}>Episode E-{item.episodeId} 보기</Button></p>}
        {!hasSubject && item.status === 'OPEN' && <p className="text-xs text-destructive-text">조사 대상 거래가 없어 최종 종결할 수 없습니다.</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!editable || busy || !hasSubject} onClick={() => setConfirmDecision('NORMAL')}>정상 종결</Button><Button size="sm" variant="destructive" disabled={!editable || busy || !hasSubject} onClick={() => setConfirmDecision('SUSPICIOUS')}>단독 세탁 의심 종결</Button></div>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="편입할 Episode" className="rounded-md border bg-background p-2 text-xs" value={targetCaseId ?? ''} onChange={event => setTargetCaseId(event.target.value ? Number(event.target.value) : null)} disabled={!editable || busy}><option value="">진행 중 Episode 선택</option>{targets.state.status === 'success' && targets.state.data.content.map(row => <option key={row.caseId} value={row.caseId}>E-{row.caseId} · {row.assigneeName}</option>)}</select><Button size="sm" variant="outline" disabled={!editable || busy || targetCaseId == null} onClick={() => void finalizeAlert('EXISTING')}>기존 Episode에 전체 편입</Button></div>
        {targets.state.status === 'error' && <ErrorBlock message={targets.state.message} onRetry={targets.retry} />}
        {targets.state.status === 'success' && targets.state.data.totalPages > 1 && <div className="flex items-center gap-2 text-xs"><Button size="sm" variant="outline" aria-label="이전 Episode 목적지" disabled={targetPage === 0} onClick={() => { setTargetCaseId(null); setTargetPage(page => page - 1) }}>이전</Button><span>{targetPage + 1}/{targets.state.data.totalPages}쪽 · 전체 {targets.state.data.totalElements}건</span><Button size="sm" variant="outline" aria-label="다음 Episode 목적지" disabled={targetPage + 1 >= targets.state.data.totalPages} onClick={() => { setTargetCaseId(null); setTargetPage(page => page + 1) }}>다음</Button></div>}
        <p className="text-xs text-muted-foreground">새 Episode는 본인 담당 Alert를 최소 2개 선택해야 합니다.</p><Button size="sm" variant="outline" onClick={onBack}>목록에서 새 Episode 만들기</Button>
      </div>}
      {item.kind === 'EPISODE' && <div><Button size="sm" disabled title="관리자 검수 절차 준비 중">관리자 검수 넘기기</Button><p className="mt-2 text-xs text-muted-foreground">관리자 검수 절차는 준비 중입니다.</p></div>}
    </ReviewLayout>
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
    {!!item.history?.length && <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">처리 이력</h2>{item.history.map(row => <div key={row.eventId} className="border-b py-2 text-xs"><span className="font-semibold">{row.action}</span> · {row.actor ?? '시스템'} · {new Date(row.businessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}<p className="mt-1 text-muted-foreground">{row.comment}</p></div>)}</section>}
    </div>
  </div>
}

export default function LiveCasesPage({ kind, caseId, onOpen, onBack, onOpenEpisode }: { kind: ReviewKind; caseId?: number; onOpen: (id: number) => void; onBack: () => void; onOpenEpisode?: (id: number) => void }) {
  const user = useCurrentUser()
  const { from, to, businessDate, setPeriod } = useSharedPeriod()
  const [search, setSearch] = useViewState(`cases/${kind}/search`, '')
  const [alertFilters, setAlertFilters] = useViewState<AlertFilter[]>('cases/ALERT/filters', [{ field: 'assignee', value: user.userId }])
  const [episodeFilters, setEpisodeFilters] = useViewState<EpisodeFilter[]>('cases/EPISODE/filters', [{ field: 'assignee', value: user.userId }])
  const filters = kind === 'ALERT' ? alertFilters : episodeFilters
  const values = (field: string) => filters.filter(filter => filter.field === field).map(filter => filter.value)
  const typeNames = ['패턴 미특정','Fan-out','Fan-in','Gather-scatter','Scatter-gather','Cycle','Random','Bipartite','Stack']
  const filterQuery = { query: search, types: values('type').map(code => typeof code === 'string' ? code : typeNames[code]),
    statuses: values('status').map(value => value === 'IN_PROGRESS' ? 'OPEN' : value === 'DONE' ? 'CLOSED' : String(value)),
    assignees: values('assignee').map(Number), minAgeDays: values('age').length ? Math.min(...values('age').map(Number)) : undefined,
    risk: values('risk').length ? values('risk').join(',') : undefined }
  const scope = JSON.stringify([kind, from, to, filterQuery])
  const [page, setPage] = useViewState(`cases/${scope}/page`, 0)
  const users = useAsync(fetchReviewUsers, [], { key: 'users' })
  const [targetPage, setTargetPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const previous = useRef<{ payload: string; id: string } | null>(null)
  const busyRef = useRef(false)
  const list = useAsync(() => fetchReviewCases({ kind, from: from || undefined, to: to || undefined, ...filterQuery, page, size: 20 }), [scope, page], { key: 'cases', maxAge: 60_000 })
  const targets = useAsync(() => fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', assigneeId: user.userId, page: targetPage, size: 20 }), [user.userId, targetPage], { key: 'cases/targets', enabled: kind === 'ALERT' })
  const rows = list.state.status === 'success' ? list.state.data.content : []
  async function link(ids: number[], targetId: number | 'new', comment: string) {
    if (busyRef.current) throw new Error('처리 중입니다.')
    try {
      ids.forEach(id => { const row = rows.find(row => row.alertId === id); if (!row) throw new Error('목록을 다시 조회하세요.'); assertEditableAlert(row, user) })
      if (targetId !== 'new' && (targets.state.status !== 'success' || !targets.state.data.content.some(row => row.caseId === targetId))) throw new Error('편입할 Episode를 다시 조회하세요.')
    } catch (error) { toast.error((error as Error).message); throw error }
    const items = ids.map(id => { const row = rows.find(row => row.alertId === id); if (!row) throw new Error('목록을 다시 조회하세요.'); assertEditableAlert(row, user); return row })
    const target = targetId === 'new' ? null : targets.state.status === 'success' ? targets.state.data.content.find(row => row.caseId === targetId) : undefined
    if (target === undefined) throw new Error('편입할 Episode를 다시 조회하세요.')
    const command = buildAlertTransfer(items, target, comment)
    const payload = JSON.stringify(command)
    const requestId = previous.current?.payload === payload ? previous.current.id : crypto.randomUUID()
    previous.current = { payload, id: requestId }; busyRef.current = true; setBusy(true)
    try {
      await submitReviewCommand(command, requestId)
      previous.current = null
      window.dispatchEvent(new Event('review-command-saved'))
      await Promise.allSettled([list.refresh(), targets.refresh()])
      toast.success('Episode 편입 완료')
    } catch (error) {
      if (error instanceof ApiError) { previous.current = null; toast.error(error.message) }
      else toast.error('처리 여부가 불확실합니다. 같은 선택·의견으로 다시 제출하면 동일 요청으로 확인합니다.')
      throw error
    } finally { busyRef.current = false; setBusy(false) }
  }
  if (caseId) return <CaseDetail key={`${kind}-${caseId}`} caseId={caseId} kind={kind} onBack={onBack} onOpenEpisode={onOpenEpisode ?? onBack} refreshList={list.refresh} />
  const footer = list.state.status === 'success' ? <div className="flex items-center justify-between text-xs"><span>전체 {list.state.data.totalElements.toLocaleString()}건</span><div className="flex gap-2"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><span>{page + 1} / {Math.max(1, list.state.data.totalPages)}</span><Button disabled={page + 1 >= list.state.data.totalPages} onClick={() => setPage(page + 1)}>다음</Button></div></div> : null
  const remote = { query: search, onQuery: setSearch, assignees: users.state.status === 'success' ? users.state.data : [{ id: user.userId, name: user.name }], footer, busy, range: from ? { from: new Date(`${from}T00:00:00`), to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined, onRange: (range?: DateRange) => setPeriod({ from: range?.from ? isoDate(range.from) : '', to: range?.to ? isoDate(range.to) : '' }), targets: targets.state.status === 'success' ? targets.state.data.content.map(row => row.caseId) : [] }
  return <div className="space-y-4">
    <RefreshStatus queries={[list]} />

    {users.state.status === 'error' && <ErrorBlock message={users.state.message} onRetry={users.retry} />}
    {kind === 'ALERT' && targets.state.status === 'error' && <ErrorBlock message={targets.state.message} onRetry={targets.retry} />}
    {list.state.status === 'error' && <ErrorBlock message={list.state.message} onRetry={list.retry} />}
    {list.state.status === 'loading' && <LoadingBlock label="사건 목록" />}
    {kind === 'ALERT' ? <AlertList key={`${kind}/${page}`} rows={rows.map(alertListRow)} today={businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()} remote={{ ...remote, filters: alertFilters, onFilters: setAlertFilters }} onOpen={row => { const item = rows.find(item => item.alertId === row.alertId); if (item) onOpen(item.caseId) }} onLink={link} /> : <EpisodeList key={`${kind}/${page}`} rows={rows.map(episodeListRow)} today={businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()} remote={{ ...remote, filters: episodeFilters, onFilters: setEpisodeFilters }} onOpen={row => onOpen(row.episodeId)} />}
    {kind === 'ALERT' && targets.state.status === 'success' && targets.state.data.totalPages > 1 && <div className="flex gap-2 text-xs"><span>편입 대상 Episode 페이지</span><Button disabled={targetPage === 0} onClick={() => setTargetPage(targetPage - 1)}>이전 대상</Button><Button disabled={targetPage + 1 >= targets.state.data.totalPages} onClick={() => setTargetPage(targetPage + 1)}>다음 대상</Button></div>}
  </div>
}
