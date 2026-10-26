import { hrefFor } from '@/app/navigation'
import { LinkedAlerts } from '@/features/episodes/LinkedAlerts'
import { Panel } from '@/features/alerts/DetailPanels'
import LiveOverviewViews, { FocusPanel, type OverviewSection } from '@/features/alerts/LiveOverviewViews'
import { AlertVerdictForm } from '@/features/alerts/AlertVerdictForm'
import type { AlertVerdict } from '@/features/alerts/verdict'
import { SectionTitle } from '@/components/page'
import { CaseActivityCharts } from '@/features/alerts/CaseActivityCharts'
import { dailyMemberAmounts, dailyMemberUsdByCurrency, memberAmountsByCurrency } from '@/features/alerts/activityAmounts'
import { caseEvidence } from '@/features/alerts/caseEvidence'
import { ReviewLayout } from '@/features/alerts/ReviewLayout'
import AlertTxTable, { type TxRow } from '@/features/alerts/AlertTxTable'
import ReviewAccounts from '@/features/alerts/ReviewAccounts'
import CaseEvidenceHistory from '@/features/alerts/CaseEvidenceHistory'
import { useSharedPeriod, useViewState, useWorkspace } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/common'
import { fetchAlertEvidence, fetchReviewCase, fetchReviewCases, fetchReviewUsers, fetchReviewMoney, setReviewMoneyScope, submitReviewCommand, type ReviewAction, type ReviewCommand, type ReviewKind } from '@/api/liveReview'
import { CaseHeader } from '@/features/alerts/CasePresentation'
import { Badge } from '@/components/ui/badge'
import { RiskBadge, StatusBadge } from '@/components/badges'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useCurrentUser, canEditOpen } from '@/app/session'
import { useAsync } from '@/lib/useAsync'
import { assertEditableAlert, buildAlertClose, buildAlertTransfer, buildEpisodeUnlink, episodeGroupSelection } from '@/api/reviewCommands'
import { toReviewTimelineRows } from '@/features/graph/timeline/liveTimelineAdapter'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { typeDisplay, type TypeCode } from '@/api/codes'
import TimeGraph from '@/features/graph/timeline/TimeGraph'
import type { DateRange } from 'react-day-picker'
import { isoDate } from '@/lib/format'
import AlertList from '@/features/alerts/AlertList'
import EpisodeList, { EpisodeStatusBadge } from '@/features/episodes/EpisodeList'
import type { AlertFilter } from '@/features/alerts/alertFilters'
import type { EpisodeFilter } from '@/features/episodes/episodeFilters'
import { alertListRow, episodeListRow } from '@/features/alerts/reviewListAdapter'
import { fixture } from '@/lib/apiMode'
import { formatMoney } from '@/features/transactions/transactionIndex'

const moneyIntervals = [5, 15, 30, 60, 180, 360, 1440] as const
const moneyAmount = (value: number | string | null) => formatMoney(value, '', true)
const moneyPercent = (value: number | null) => value == null ? '산출 불가' : `${value.toFixed(1)}%`
const activeMember = (state: string) => state !== 'EXCLUDED' && state !== 'TRANSFERRED'
const transactionRole = (role: string) => ({ SEED: '씨앗', CONNECTION: '경로 연결', CONTEXT: '주변 맥락' })[role as 'SEED' | 'CONNECTION' | 'CONTEXT'] ?? role
const decisionLabel = (decision: string | null | undefined) => decision === undefined ? '판정 상태 미제공' : decision === 'NORMAL' ? '정상' : decision === 'SUSPICIOUS' ? '의심' : decision === null ? '미판정' : decision
const businessTime = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
const elapsedTime = (milliseconds: number) => {
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return milliseconds === 0 ? '같은 시각' : '1분 미만'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes % 1440 / 60)
  const rest = minutes % 60
  return [days && `${days}일`, hours && `${hours}시간`, rest && `${rest}분`].filter(Boolean).join(' ')
}

// Static prototype examples from aml-overview-responsive-states.html; never treated as a case's rule evaluation.
const ruleExamples = [
  { id: 'rapid', name: '급속 자금 통과', result: '걸림', observed: '81%', threshold: '70% · 180분', reason: '기준보다 11%p 높아 걸림.', condition: '입금 후 180분 이내 유출액 / 비교 가능한 입금액 ≥ 70%', scope: '10/10~10/13 KST · AC-204 · USD', explanation: '입금 USD 10,000 중 180분 안 유출 USD 8,100. 다음 날 유출 USD 1,900은 검사 시간 밖입니다. 먼저 들어온 금액부터 대응시킨 추정이며 같은 돈의 이동을 증명하지 않습니다.', fill: 81, marker: 70, transactions: ['TX-R01 · 10/10 09:00 · AC-102 → AC-204 · USD 9,000 · 입금', 'TX-R02 · 10/10 09:10 · AC-103 → AC-204 · USD 1,000 · 입금', 'TX-R03 · 10/10 09:40 · AC-204 → AC-481 · USD 6,500 · 유출', 'TX-R04 · 10/10 10:00 · AC-204 → AC-482 · USD 1,600 · 유출', 'TX-R05 · 10/11 10:00 · AC-204 → AC-483 · USD 1,900 · 검사 시간 밖'] },
  { id: 'large', name: '단건 고액', result: '안 걸림', observed: '최대 USD 9,900', threshold: 'USD 10,000', reason: '예시 기준보다 USD 100 낮아 안 걸림.', condition: '한 건의 송금액 ≥ USD 10,000', scope: '10/10~10/13 KST · A-2240 거래 19건 · USD', explanation: '최대 단건 USD 9,900은 예시 기준보다 낮습니다. 다른 의심 근거가 없다는 뜻은 아닙니다.', fill: 99, marker: 100, transactions: ['TX-L01 · 10/11 14:20 · AC-510 → AC-600 · USD 9,900 · 최댓값'] },
  { id: 'split', name: '분할 입출금', result: '확인 불가', observed: '현금 입금 3건', threshold: '7일·회사 기준금액 미확인', reason: '회사 기준금액과 앞선 4일 보고가 없어 비교 불가.', condition: '7일간 회사 기준금액의 90% 이상~100% 미만 현금 입금 ≥ 3회', scope: '10/6~10/13 KST · AC-481 · USD 현금 입금', explanation: '비교 불가: 회사 기준금액과 10/6~10/9 보고가 없습니다. 0이나 안 걸림으로 바꾸지 않습니다.', fill: null, marker: null, transactions: ['TX-S01 · 10/10 11:00 · AC-405 → AC-481 · USD 2,000', 'TX-S02 · 10/11 11:00 · AC-406 → AC-481 · USD 2,000', 'TX-S03 · 10/12 11:00 · AC-407 → AC-481 · USD 2,000'] },
] as const

function CaseDetail({ caseId, kind, onBack, onOpenEpisode, onOpenAlert, refreshList }: { caseId: number; kind: ReviewKind; onBack: () => void; onOpenEpisode: (id: number) => void; onOpenAlert?: (id: number) => void; refreshList: () => Promise<unknown> }) {
  const [tab, setTab] = useViewState<'overview' | 'graph' | 'transactions' | 'review'>(`case/${kind}/${caseId}/tab`, 'overview')
  const workspace = useWorkspace()
  useEffect(() => {
    const showSelectedPanel = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      if (id?.startsWith('case.overview')) setTab('overview')
      if (id?.startsWith('case.transactions')) setTab('transactions')
    }
    window.addEventListener('aml-wiring-focus', showSelectedPanel)
    return () => window.removeEventListener('aml-wiring-focus', showSelectedPanel)
  }, [])
  const [graphVisited, setGraphVisited] = useState(tab === 'graph')
  const [transactionView, setTransactionView] = useState<'transactions' | 'accounts'>('transactions')
  const [reconsiderGroupId, setReconsiderGroupId] = useState<number | null>(null)
  const changeTab = (next: typeof tab) => { if (next === 'graph') setGraphVisited(true); setTab(next) }
  const user = useCurrentUser()
  const detail = useAsync(() => fetchReviewCase(caseId), [caseId], { key: 'case/detail', maxAge: 60_000 })
  const { state, retry, refresh } = detail
  const graphRows = useMemo(() => state.status === 'success' && state.data.caseId === caseId && state.data.kind === kind ? toReviewTimelineRows(state.data) : [], [state, caseId, kind])
  const alertId = state.status === 'success' && state.data.kind === 'ALERT' ? state.data.alertId : null
  const publishedVersion = state.status === 'success' ? state.data.publishedVersion : null
  const alertEvidence = useAsync(() => fetchAlertEvidence(alertId!, publishedVersion), [alertId, publishedVersion], {
    key: 'case/alert-evidence', maxAge: 60_000, enabled: !fixture && kind === 'ALERT' && alertId != null,
  })
  const intentKey = `case-intent/${user.userId}/${user.role}/${kind}/${caseId}`
  const [verdict, setVerdict] = useViewState<AlertVerdict>(`${intentKey}/verdict`, 'normal')
  const [comment, setComment] = useViewState(`${intentKey}/comment`, '')
  const [excludeComment, setExcludeComment] = useState('')
  const [unlinkComment, setUnlinkComment] = useState('')
  const [selectingAlerts, setSelectingAlerts] = useState(false)
  const [unlinkGroups, setUnlinkGroups] = useState<number[]>([])
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [ruleExampleId, setRuleExampleId] = useState<string | null>(null)
  const ruleExampleOpener = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [selected, setSelected] = useState<Record<number, number[]>>({})
  const previousRequest = useRef<{ payload: string; id: string; command: ReviewCommand; success: string } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [confirmDecision, setConfirmDecision] = useState<'NORMAL' | 'SUSPICIOUS' | null>(null)
  const [confirmIncompleteClose, setConfirmIncompleteClose] = useState(false)
  const [sourceAssignees, setSourceAssignees] = useState<Record<number, { status: 'loading' | 'loaded' | 'missing' | 'error'; name?: string }>>({})
  const [targetCaseId, setTargetCaseId] = useViewState<number | null>(`${intentKey}/target`, null)
  const [scoreTxId, setScoreTxId] = useState<number | null>(null)
  const [evidenceFocus, setEvidenceFocus] = useState<number[] | null>(null)
  const [moneyMinutes, setMoneyMinutes] = useState(180)
  const [scopeDraft, setScopeDraft] = useViewState<string[] | null>(`${intentKey}/scope`, null)
  const [scopeComment, setScopeComment] = useViewState(`${intentKey}/scope-comment`, '')
  const [scopeBusy, setScopeBusy] = useState(false)
  const scopeBusyRef = useRef(false)
  const [scopeRetry, setScopeRetry] = useState(false)
  const scopePrevious = useRef<{ revision: number; accounts: string[]; comment: string; requestId: string } | null>(null)
  const [targetPage, setTargetPage] = useViewState(`${intentKey}/target-page`, 0)
  const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
  const targets = useAsync(() => kind === 'ALERT' ? fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', page: targetPage, size: 20 }) : Promise.resolve(emptyPage), [kind, targetPage], { key: 'case/targets', maxAge: 60_000 })
  const money = useAsync(() => fetchReviewMoney(caseId, moneyMinutes), [caseId, moneyMinutes], { key: 'case/money', maxAge: 60_000 })

  if (state.status === 'loading') return <div className="space-y-4">
    <SectionTitle title={kind === 'ALERT' ? 'Alert 상세' : 'Episode 상세'} description="조사 사건을 불러오는 중입니다." />
    <div role="status" className="grid gap-4 lg:grid-cols-2">{(kind === 'ALERT'
      ? ['판단 요약', '돈의 흐름', '핵심 계좌', '다른 사건과의 연결', '진행과 최근 처리']
      : ['연결 Alert와 연결 근거', '이어지는 계좌', '통합 판단과 돈의 흐름']).map(label => <section key={label} className="rounded-xl border bg-card p-4"><h2 className="text-base font-semibold">{label}</h2><Skeleton className="mt-4 h-24 w-full" /></section>)}</div>
  </div>
  if (state.status === 'error') return <div className="space-y-3">
    <ErrorBlock message={state.error instanceof ApiError && state.error.problem.status === 403 ? '이 사건을 조회할 권한이 없습니다.' : state.error instanceof ApiError && state.error.problem.status === 404 ? '이전 사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : state.message} onRetry={retry} />
  </div>
  const item = state.data
  if (item.kind !== kind) return <ErrorBlock message="요청한 종류와 사건 정보가 다릅니다." onRetry={retry} />
  if (item.caseId !== caseId) return <ErrorBlock message="요청한 사건과 조회된 정보가 다릅니다. 다시 조회해 주세요." onRetry={retry} />
  const incompleteAlertCoverage = item.kind === 'ALERT' && alertEvidence.state.status === 'success'
    && alertEvidence.state.data.coverage?.some(day => !day.complete || day.completeBanks < day.expectedBanks)
  const incompleteMoney = money.state.status === 'success'
    && (money.state.data.complete === false || money.state.data.reason === 'WAITING_RECEIPTS')
  const incompleteReceipts = item.kind === 'ALERT' && (incompleteAlertCoverage || incompleteMoney)
  const incompleteNotice = incompleteAlertCoverage && !incompleteMoney
    ? 'Alert 근거의 날짜별 은행 수신이 완료되지 않았습니다. 수신 범위를 확인해 주세요. 정상 종결은 데이터가 완결된 뒤를 권장합니다.'
    : money.state.status === 'success' && money.state.data.reason === 'WAITING_RECEIPTS'
    ? '원장 수신 완료를 기다리는 중이라 돈의 흐름을 산출할 수 없습니다. 정상 종결은 데이터가 완결된 뒤를 권장합니다.'
    : '원장 수신이 완료되지 않아 돈의 흐름은 현재 관측 범위까지만 확인할 수 있습니다. 정상 종결은 데이터가 완결된 뒤를 권장합니다.'
  const selectedTarget = targets.state.status === 'success' ? targets.state.data.content.find(row => row.caseId === targetCaseId && row.kind === 'EPISODE' && row.status === 'OPEN') : undefined
  const editable = canEditOpen(user, item.assigneeId, item.status) && (kind !== 'ALERT' || item.episodeId == null) && !scopeBusy
  const editRestriction = item.status !== 'OPEN' ? '종결된 사건은 변경할 수 없습니다.'
    : user.role !== 'STAFF' ? '현재 역할에서는 사건을 변경할 수 없습니다.'
      : user.userId !== item.assigneeId ? '본인 담당 사건만 변경할 수 있습니다.'
        : kind === 'ALERT' && item.episodeId != null ? 'Episode에 편입된 Alert는 여기서 변경할 수 없습니다.' : null
  const hasSubject = (item.groups ?? []).some(group => group.members.some(member => member.reviewRole === 'SUBJECT' && member.state !== 'EXCLUDED' && member.state !== 'TRANSFERRED'))
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
  const scopeCandidates = money.state.status === 'success' ? money.state.data.candidateAccounts ?? [] : []
  const scopeAccounts = [...new Set([...scopeCandidates, ...chosenAccounts])]
  const toggleAccount = (account: string) => {
    setScopeDraft(current => {
      const accounts = current ?? (money.state.status === 'success' ? money.state.data.selectedAccounts ?? [] : [])
      return accounts.includes(account) ? accounts.filter(value => value !== account) : [...accounts, account]
    })
    setScopeRetry(false)
  }
  const activityAmounts = dailyMemberAmounts(item.groups ?? [])
  const evidence = caseEvidence(item.groups ?? [])
  const excludedCount = new Set((item.groups ?? []).flatMap(group => group.members).filter(member => member.state === 'EXCLUDED').map(member => member.txId)).size
  const seedMembers = evidence.members.filter(member => member.transaction.role === 'SEED')
  const roleGroups = [...new Set(evidence.members.map(member => member.transaction.role))].map(role => ({
    role, members: evidence.members.filter(member => member.transaction.role === role),
  }))
  const focusedMembers = evidenceFocus?.map(id => evidence.members.find(member => member.txId === id)).filter(member => member != null) ?? []
  const openEvidence = (ids: number[]) => {
    if (!ids.length) return
    setEvidenceFocus(ids)
    setTransactionView('transactions')
    setTab('transactions')
    requestAnimationFrame(() => document.querySelector('[data-wiring-id="case.transactions.evidence"]')?.scrollIntoView({ block: 'start' }))
  }
  const showReceiptCoverage = () => {
    window.dispatchEvent(new CustomEvent('aml-wiring-focus', { detail: 'case.overview.money.coverage' }))
    requestAnimationFrame(() => document.querySelector('[data-wiring-id="case.overview.money.coverage"]')?.scrollIntoView({ block: 'start' }))
  }
  const linkedEvidence = linkedGroups.map(group => ({ group, ...caseEvidence([group]) }))
  const timedLinkedEvidence = linkedEvidence.map(entry => {
    const times = entry.members.map(member => Date.parse(member.transaction.occurredAt)).filter(Number.isFinite)
    return { ...entry, firstAt: times.length ? Math.min(...times) : null }
  }).sort((a, b) => (a.firstAt ?? Infinity) - (b.firstAt ?? Infinity) || a.group.sourceAlertId! - b.group.sourceAlertId!)
  const accountMeta = new Map((item.accounts ?? []).map(account => [account.id, account] as const))
  const accountUse = new Map<string, Map<number, { sent: number; received: number }>>()
  for (const { group, members } of linkedEvidence) {
    const alertId = group.sourceAlertId!
    for (const member of members) {
      for (const [accountId, direction] of [[member.transaction.fromAccountId, 'sent'], [member.transaction.toAccountId, 'received']] as const) {
        if (!accountUse.has(accountId)) accountUse.set(accountId, new Map())
        const perAlert = accountUse.get(accountId)!
        if (!perAlert.has(alertId)) perAlert.set(alertId, { sent: 0, received: 0 })
        perAlert.get(alertId)![direction] += 1
      }
    }
  }
  const sharedAccounts = [...accountUse].filter(([, perAlert]) => perAlert.size > 1)
  const ownerUse = new Map<string, { name: string; alerts: Set<number>; accounts: Set<string> }>()
  for (const [accountId, perAlert] of accountUse) {
    const account = accountMeta.get(accountId)
    if (!account?.ownerId) continue
    if (!ownerUse.has(account.ownerId)) ownerUse.set(account.ownerId, { name: account.ownerName ?? account.ownerId, alerts: new Set(), accounts: new Set() })
    const owner = ownerUse.get(account.ownerId)!
    owner.accounts.add(accountId)
    for (const alertId of perAlert.keys()) owner.alerts.add(alertId)
  }
  const sharedOwners = [...ownerUse.values()].filter(owner => owner.alerts.size > 1 && owner.accounts.size > 1)
  const usdLabel = (value: unknown) => (typeof value !== 'number' && typeof value !== 'string') || !String(value).trim() || !Number.isFinite(Number(value))
    ? 'USD 환산액 미제공' : `${moneyAmount(value)} USD`
  const previewMembers = [...(seedMembers.length ? seedMembers : evidence.members)]
    .sort((a, b) => new Date(a.transaction.occurredAt).getTime() - new Date(b.transaction.occurredAt).getTime() || a.txId - b.txId).slice(0, 5)
  const transactionRow = (member: typeof evidence.members[number]): TxRow => ({
    txId: member.txId, txAt: new Date(member.transaction.occurredAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'),
    fromAccount: member.transaction.fromAccountId, toAccount: member.transaction.toAccountId,
    amountPaid: Number(member.transaction.amountPaid), paymentCurrency: member.transaction.paymentCurrency, paymentFormat: member.transaction.paymentFormat,
    launderingScore: member.transaction.scores?.p_laundering ?? null, role: member.transaction.role,
    reviewLabel: `${member.reviewRole} · ${member.state}${member.decision ? ` · ${member.decision}` : ''}`,
  })
  const externalUsd = (field: 'in' | 'net') => money.state.status === 'success' && money.state.data.available
    ? usdLabel(money.state.data.externalUsd?.[field]) : undefined
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
  function openTransaction(txId: number) {
    const member = item.groups?.flatMap(group => group.members).find(member => member.txId === txId)
    if (!member || !Number.isSafeInteger(txId) || txId <= 0) return
    const occurred = new Date(member.transaction.occurredAt)
    const day = Number.isFinite(occurred.getTime()) ? occurred.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : undefined
    workspace.set(`ledger/transaction-target/${txId}`, { from: day, to: day, account: member.transaction.fromAccountId || undefined })
    window.location.hash = hrefFor('transactions', txId)
  }
  async function findSourceAlert(alertId: number) {
      let page = 0
      for (;;) {
        const result = await fetchReviewCases({ kind: 'ALERT', query: `A-${alertId}`, page, size: 100 })
        const found = result.content.find(row => row.alertId === alertId)
        if (found) return found
        if (++page >= result.totalPages) break
      }
      return null
  }
  async function openSourceAlert(alertId: number) {
    if (!onOpenAlert) return
    try {
      const found = await findSourceAlert(alertId)
      if (found) { onOpenAlert(found.caseId); return }
      toast.error('연결된 Alert를 찾을 수 없습니다.')
    } catch { toast.error('연결된 Alert를 조회하지 못했습니다. 다시 시도해 주세요.') }
  }
  async function showSourceAssignee(alertId: number) {
    setSourceAssignees(current => ({ ...current, [alertId]: { status: 'loading' } }))
    try {
      const found = await findSourceAlert(alertId)
      setSourceAssignees(current => ({ ...current, [alertId]: found
        ? { status: 'loaded', name: found.assigneeName } : { status: 'missing' } }))
    } catch {
      setSourceAssignees(current => ({ ...current, [alertId]: { status: 'error' } }))
    }
  }
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
  async function reconsiderGroup(groupId: number) {
    if (!editable || busyRef.current || scopeBusyRef.current || item.kind !== 'EPISODE' || !comment.trim()) return
    const group = item.groups?.find(group => group.groupId === groupId)
    const txIds = group?.members.filter(member => member.reviewRole === 'SUBJECT' && member.state === 'DECIDED').map(member => member.txId) ?? []
    if (!txIds.length) { toast.error('다시 검토할 판정 거래가 없습니다. 최신 범위를 확인해 주세요.'); return }
    await submit({ action: 'RECONSIDER', selections: [{ caseId: item.caseId, revision: item.revision, groupId, txIds }],
      targetCaseId: null, targetRevision: null, targetGroupId: null, decision: null, comment: comment.trim() }, '선택 Alert 판정 재검토 시작')
  }
  async function finalizeAlert(mode: 'NORMAL' | 'SUSPICIOUS' | 'EXISTING', incompleteAtConfirm = false) {
    if (!editable || busyRef.current || scopeBusyRef.current) return
    if (!comment.trim()) { toast.error('변경 사유를 입력해 주세요.'); return }
    const closeComment = mode === 'NORMAL' && incompleteAtConfirm ? `${comment.trim()}\n수신 미완 상태에서 종결` : comment.trim()
    if (closeComment.length > 4000) { toast.error('변경 사유와 수신 상태 기록은 4,000자 이하로 입력해 주세요.'); return }
    try { assertEditableAlert(item, user) } catch (error) { toast.error((error as Error).message); return }
    if (mode === 'NORMAL' || mode === 'SUSPICIOUS') {
      if (!hasSubject) { toast.error('조사 대상 거래가 없어 종결할 수 없습니다.'); return }
      await submit(buildAlertClose(item, mode, closeComment), mode === 'NORMAL' ? '정상 종결 완료' : '단독 세탁 의심 종결 완료')
      return
    }
    const target = selectedTarget
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
        toast.error(error.problem.code === 'FIXTURE_READ_ONLY' ? error.message : error.problem.status === 403 ? '이 사건을 변경할 권한이 없습니다.' : error.problem.status === 404 ? '사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : error.problem.status === 409 ? '사건 정보가 변경됐습니다. 최신 내용을 확인한 뒤 다시 제출해 주세요.' : error.problem.status >= 500 ? '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' : error.message)
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
        toast.error(error.problem.code === 'FIXTURE_READ_ONLY' ? error.message : error.problem.status === 403 ? '이 사건의 계좌 범위를 변경할 권한이 없습니다.' : error.problem.status === 404 ? '사건을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.' : error.problem.status === 409 ? '사건 정보가 변경됐습니다. 최신 계좌 범위를 확인한 뒤 다시 제출해 주세요.' : error.problem.status >= 500 ? '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.' : error.message)
        if (error.problem.status === 409 || error.problem.status === 404) { if (error.problem.status === 404) setScopeDraft(null); void Promise.allSettled([refresh(), money.refresh(), refreshList()]) }
      }
    } finally { scopeBusyRef.current = false; setScopeBusy(false) }
  }
  const judgmentPanel = (<Panel title={item.kind === 'ALERT' ? '묶음 근거' : '패턴 증거'} description="서버가 보존한 조사 범위" testId="grouping" action={item.kind === 'ALERT' ? <Button size="sm" variant="outline" onClick={() => setTab('review')}>{editable ? '검토 의견 작성' : '검토 의견 확인'}</Button> : undefined}>
      {item.kind === 'EPISODE' && <div className="flex flex-wrap gap-1">{item.primaryTypes.map(name => <Badge key={name} variant="outline">{name}</Badge>)}</div>}
      <dl className="space-y-2 text-xs"><div><dt>씨앗 거래</dt><dd>{item.summary.seedCount}건</dd></div><div><dt>조사 대상</dt><dd>{item.summary.subjectCount}건</dd></div><div><dt>유효 거래</dt><dd>{item.summary.txCount}건</dd></div></dl>
      {item.summary.typeShare != null && <p className="mt-2 text-xs text-muted-foreground">대표 유형 비중 {(item.summary.typeShare * 100).toFixed(1)}% · 사건 확률 아님</p>}
      <p className="mt-2 text-xs text-muted-foreground">모델 유형 점수와 룰 평가는 별도 근거입니다. 룰 적중 여부는 현재 사건 응답으로 확인할 수 없습니다.</p>
    </Panel>)
  const modelInfo = <div data-wiring-id="case.overview.model" className="min-w-0 space-y-3">
    {judgmentPanel}
    <div className="rounded-lg border p-4 text-sm"><strong>모델 참고 정보</strong><p className="mt-2 text-xs text-muted-foreground">대표 유형 {item.summary.primaryType || '확인 불가'} · 위험 점수 {item.summary.riskScore}</p>
      {item.summary.typeShare != null && <p className="mt-1 text-xs">씨앗 거래 내 대표 유형 비중 {(item.summary.typeShare * 100).toFixed(1)}% · 사건 확률 아님</p>}
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">이 사건 모델 버전 미확인</summary><p className="mt-1">{fixture ? '개발 전용 합성 값입니다.' : '현재 서버 계약은 이진 GNN과 시연용 유형 모델을 구분합니다. 이 사건의 모델·피처 버전은 응답에 제공되지 않았습니다.'}</p></details>
      <p className="mt-2 text-xs text-muted-foreground">{fixture ? '개발 전용 합성 점수 · ' : ''}조사 대상 {item.summary.subjectCount}건 · 씨앗 거래 {item.summary.seedCount}건 · 미판정 {item.pendingCount}건</p>
    </div>
    {item.kind === 'ALERT' && <div data-wiring-id="case.overview.seed" className="rounded-lg border p-4 text-xs">
      <h3 className="text-sm font-semibold">탐지 거래와 조사 범위</h3>
      <p className="mt-1 text-muted-foreground">아래 역할은 현재 사건 거래에 기록된 값입니다. 각 거래의 포함 이유 코드는 근거 거래에서 확인할 수 있으며 상류·하류 방향을 뜻하지 않습니다.</p>
      <div className="mt-3 flex flex-wrap gap-2">{roleGroups.map(({ role, members }) => <Button key={role} type="button" size="sm" variant="outline" onClick={() => openEvidence(members.map(member => member.txId))}>{transactionRole(role)} {members.length}건 거래 보기</Button>)}</div>
      {seedMembers.length ? <div className="mt-3 space-y-2" data-wiring-id="case.overview.seed.transactions">{seedMembers.slice(0, 3).map(member => <div key={member.txId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
        <span><strong className="font-mono">T-{member.txId}</strong> · {businessTime(member.transaction.occurredAt)} · {member.transaction.fromAccountId} → {member.transaction.toAccountId} · {moneyAmount(member.transaction.amountPaid)} {member.transaction.paymentCurrency}{member.transaction.includedReasons?.length ? ` · 포함 이유 코드 ${member.transaction.includedReasons.join(', ')}` : ''}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => openEvidence([member.txId])}>이 거래 보기</Button>
      </div>)}{seedMembers.length > 3 && <Button type="button" size="sm" variant="ghost" onClick={() => openEvidence(seedMembers.map(member => member.txId))}>씨앗 거래 {seedMembers.length}건 모두 보기</Button>}</div>
        : <p className="mt-3 text-muted-foreground">현재 조사 범위에서 씨앗 거래를 확인할 수 없습니다.</p>}
    </div>}
    {item.kind === 'ALERT' && <Panel title="근거 거래 확인" description={seedMembers.length ? `씨앗 거래 ${seedMembers.length}건 중 ${previewMembers.length}건 · 거래 ID로 현재 원장의 소유주와 계좌 확인` : '씨앗 거래 정보 없음 · 현재 조사 범위를 시각순으로 최대 5건 표시'} testId="overview-evidence"
        action={<Button size="sm" variant="outline" onClick={() => setTab('transactions')}>전체 거래 {evidence.members.length}건 보기</Button>}>
        {previewMembers.length ? <AlertTxTable remote rows={previewMembers.map(transactionRow)} onOpenTransaction={openTransaction} /> : <EmptyBlock>조사 범위가 없습니다.</EmptyBlock>}
      </Panel>}
    {item.kind === 'ALERT' && <Panel title="거래별 패턴 후보" description="선택 거래의 유형 점수" testId="pattern-candidates">
      <p className="mt-1 text-xs text-muted-foreground">선택 거래의 모델 유형 점수이며 사건 전체 확률이 아닙니다.</p>
      <p className="mt-1 text-xs text-muted-foreground">현재 서버 계약의 유형 모델은 시연용입니다. 이 거래의 실행·버전은 미확인입니다. 실행 ID·모델 버전 미제공으로 이 결과의 실행별 출처는 확인할 수 없습니다.</p>
      {scoredMembers.length ? <><label className="mt-3 block text-xs">확률을 볼 거래 <select aria-label="확률을 볼 거래" className="ml-2 min-w-48 rounded-md border bg-background py-2 pl-3 pr-8" value={scoreMember.txId} onChange={event => setScoreTxId(Number(event.target.value))}>{scoredMembers.map(member => <option key={member.txId} value={member.txId}>T-{member.txId}{member.transaction.role === 'SEED' ? ' · 씨앗 거래' : ''}</option>)}</select></label>
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => openEvidence([scoreMember.txId])}>선택 거래 T-{scoreMember.txId} 보기</Button>
        <Button type="button" size="sm" variant="outline" className="mt-2 ml-2" onClick={() => openTransaction(scoreMember.txId)}>선택 거래 원장 확인</Button>
        <ol aria-label="거래 패턴 후보" className="mt-3 space-y-2">{patternCandidates.map((candidate, index) => <li key={candidate.code} className="flex items-center gap-2 text-sm"><span className="w-5 text-muted-foreground">{index + 1}.</span><span className="rounded-full bg-foreground px-2.5 py-0.5 font-mono text-xs text-background">{typeDisplay(candidate.code).key}</span><strong className="tabular-nums">{(candidate.score * 100).toFixed(1)}%</strong></li>)}</ol>
        {!patternCandidates.length && <p className="mt-3 text-sm text-muted-foreground">이 거래의 패턴 점수가 없습니다.</p>}</> : <p className="mt-3 text-sm text-muted-foreground">점수가 제공된 거래가 없습니다.</p>}
    </Panel>}
  </div>
  const selectedRuleExample = ruleExamples.find(example => example.id === ruleExampleId)
  const ruleEvidence = <div data-wiring-id="case.overview.rules" className="rounded-lg border p-4">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">룰별 판단 근거</h3><Badge variant="outline">확인 불가</Badge></div>
    {fixture && item.kind === 'ALERT' && <p className="mt-2 text-xs text-muted-foreground">룰별 검사는 시안 합성 예시입니다. 이 사건의 평가값이나 운영 정책이 아닙니다.</p>}
    {fixture && item.kind === 'ALERT' ? <div className="mt-3 space-y-2">{ruleExamples.map(example => <div key={example.id} className="grid min-w-0 overflow-hidden rounded-md border lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="rule-evidence-row">
      <div className="min-w-0 bg-muted/40 p-3 text-xs" data-wiring-id="case.overview.rules.chart"><div className="flex flex-wrap justify-between gap-2"><strong>{example.name} · {example.result}</strong><span>기준 {example.threshold} · 관측 {example.observed}</span></div>
        {example.fill == null ? <p className="mt-3 rounded border border-dashed p-2">비교 불가 · 기준값·보고 범위 미확인</p> : <div role="img" aria-label={`${example.name}: 예시 기준 ${example.threshold}, 관측 ${example.observed}`} className="relative mt-3 h-3 rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${example.fill}%` }} /><span className="absolute inset-y-[-3px] w-0.5 bg-foreground" style={{ left: `${example.marker}%` }} /></div>}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 p-3 text-xs" data-wiring-id="case.overview.rules.explanation"><p className="min-w-0">{example.reason}</p><Button type="button" size="sm" variant="outline" className="shrink-0" aria-label={`${example.name} 근거 보기`} onClick={event => { ruleExampleOpener.current = event.currentTarget; setRuleExampleId(example.id) }}>근거 보기</Button></div>
    </div>)}</div> : <div className={`mt-3 grid min-w-0 items-start gap-3 ${item.kind === 'ALERT' ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}`} data-testid="rule-evidence-row">
      <div className="min-w-0 rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-wiring-id="case.overview.rules.chart">기준선과 관측 막대는 룰 평가값이 연결되면 표시합니다. 현재 기준값·관측값·평가 범위를 확인할 수 없습니다.</div>
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border p-3 text-xs" data-wiring-id="case.overview.rules.explanation">
        <p className="min-w-0 text-muted-foreground">룰 평가 결과 API 미연동 · 걸림/안 걸림을 판단할 수 없습니다.</p>
        <Button size="sm" variant="outline" className="shrink-0" disabled title="룰 평가 결과와 근거 거래 API 미연동">근거 보기</Button>
      </div>
    </div>}
    <AlertDialog open={selectedRuleExample != null} onOpenChange={open => { if (!open) { setRuleExampleId(null); requestAnimationFrame(() => ruleExampleOpener.current?.focus({ preventScroll: true })) } }}><AlertDialogContent className="max-h-[85vh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>룰 검사 근거 · 합성 예시</AlertDialogTitle><AlertDialogDescription>이 사건의 실제 평가나 운영 기준이 아닙니다. 실제 룰 결과 API는 미연동입니다.</AlertDialogDescription></AlertDialogHeader>{selectedRuleExample && <div className="space-y-3 text-sm"><h3 className="font-semibold">{selectedRuleExample.name} · {selectedRuleExample.result}</h3><p>검사 기준: {selectedRuleExample.condition}</p><p>관측: {selectedRuleExample.observed} · 기준: {selectedRuleExample.threshold}</p><p>범위: {selectedRuleExample.scope}</p><p>{selectedRuleExample.explanation}</p><ul className="space-y-1 rounded-lg border p-3 text-xs" aria-label="합성 근거 거래">{selectedRuleExample.transactions.map(transaction => <li key={transaction}>{transaction}</li>)}</ul></div>}<AlertDialogFooter><AlertDialogAction>돌아가기</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
  const flowVisual = <div data-wiring-id="case.overview.money.chart" className="min-w-0">{money.state.status === 'success' && money.state.data.available && money.state.data.external?.length
      ? <div className="space-y-3">{money.state.data.external.map(row => <div key={row.currency} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-lg border p-3 text-xs"><strong>{row.currency}</strong><div className="min-w-0"><p>유입 {moneyAmount(row.in)} · 유출 {moneyAmount(row.out)}</p><div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted"><span className="bg-foreground" style={{ width: `${row.in + row.out > 0 ? row.in / (row.in + row.out) * 100 : 0}%` }} /></div></div></div>)}</div>
      : <p className="rounded-lg border p-4 text-xs text-muted-foreground">{money.state.status === 'loading' ? '자금 흐름을 불러오는 중입니다.' : money.state.status === 'error' ? '자금 흐름 조회에 실패했습니다.' : !money.state.data.available ? '현재 자금 흐름을 산출할 수 없습니다.' : '통화별 자금 흐름이 제공되지 않았습니다.'}</p>}</div>
  const flowExplanation = <div data-wiring-id="case.overview.money.explanation" className="min-w-0 rounded-lg border p-4 text-xs">
    <h3 className="text-sm font-semibold">원장 기준 외부 자금</h3>
    <p className="mt-1 text-muted-foreground">조사 중심 계좌 범위의 외부 유입·유출·순유입입니다. 거래 총액과 구분해 읽습니다.</p>
    <p className="mt-2 text-muted-foreground">이 합계의 경계 거래별 목록은 현재 money 응답에 없습니다. 아래 사건 조사 거래는 같은 범위를 뜻하지 않을 수 있습니다.</p>
    <Button type="button" size="sm" variant="outline" className="mt-2" disabled={!evidence.members.length} onClick={() => openEvidence(evidence.members.map(member => member.txId))}>사건 조사 거래 {evidence.members.length}건 보기</Button>
    <label className="mt-3 inline-flex items-center gap-2">단시간 유출 비교 기간<select aria-label="단시간 유출 비교 기간" className="rounded-md border bg-background p-2" value={item.status === 'CLOSED' ? 180 : moneyMinutes} onChange={event => setMoneyMinutes(Number(event.target.value))} disabled={item.status === 'CLOSED'}>{moneyIntervals.map(minutes => <option key={minutes} value={minutes}>{minutes === 1440 ? '24시간' : `${minutes}분`}</option>)}</select></label>
    {item.status === 'CLOSED' && <p className="mt-2 text-muted-foreground">종결 당시 180분 지표가 고정 저장됩니다.</p>}
    {money.state.status === 'loading' ? <LoadingBlock label="자금 지표" /> : money.state.status === 'error' ? <ErrorBlock message={money.state.message} onRetry={money.retry} /> : <>
      <p className="mt-3 text-muted-foreground">조사 중심 계좌 {money.state.data.selectedAccounts?.length ?? 0}개{money.state.data.customScope ? ' · 직접 지정' : ' · 씨앗 거래 기준'}{money.state.data.ledgerCount != null ? ` · 원장 거래 ${money.state.data.ledgerCount}건` : ''}</p>
      {!money.state.data.available ? <p className="mt-3 text-muted-foreground">{({ EMPTY_SUBJECT_SCOPE: '조사 거래 범위가 없습니다.', EMPTY_ACCOUNT_SCOPE: '조사 계좌를 선택해야 합니다.', WAITING_RECEIPTS: '원장 수신 완료를 기다리는 중입니다.', NO_CLOSED_SNAPSHOT: '저장된 종결 시점 지표가 없습니다.' } as Record<string, string>)[money.state.data.reason ?? ''] ?? '현재 산출할 수 없습니다.'}</p> : <>
        {money.state.data.complete === false && <p className="mt-2 text-muted-foreground">원장 관측 일부만 완료됨 · 표시된 기간까지만 계산</p>}
        {money.state.data.observedAt && <p className="mt-2 text-muted-foreground">원장 관측 기준 {businessTime(money.state.data.observedAt)}</p>}
        {(money.state.data.start || money.state.data.endExclusive) && <p className="mt-1 text-muted-foreground">계산 기간 {money.state.data.start ? businessTime(money.state.data.start) : '시작 미제공'} ~ {money.state.data.endExclusive ? `${businessTime(money.state.data.endExclusive)} 직전` : '끝 미제공'}</p>}
        <p className="mt-3 text-muted-foreground">통화별 외부 유입·유출·순유입은 왼쪽 흐름도에서 확인하세요.</p>
        <p className="mt-2 text-muted-foreground">USD 환산: 유입 {externalUsd('in')} · 순유입 {externalUsd('net')}</p>
      </>}
    </>}
  </div>
  const flowDiagram = money.state.status === 'success' && money.state.data.available && money.state.data.external?.length
    ? <div className="mt-4 space-y-2" data-wiring-id="case.overview.money.flow">{money.state.data.external.map(row => <div key={row.currency} className="grid items-center gap-2 rounded-lg border p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]"><div><span className="text-muted-foreground">외부 유입 · {row.currency}</span><strong className="mt-1 block tabular-nums">{moneyAmount(row.in)}</strong></div><span aria-hidden="true" className="hidden text-muted-foreground sm:block">→</span><div><span className="text-muted-foreground">조사 중심 계좌</span><strong className="mt-1 block tabular-nums">순유입 {moneyAmount(row.net)}</strong></div><span aria-hidden="true" className="hidden text-muted-foreground sm:block">→</span><div><span className="text-muted-foreground">외부 유출 · {row.currency}</span><strong className="mt-1 block tabular-nums">{moneyAmount(row.out)}</strong></div></div>)}</div>
    : null
  const receiptCoverage = item.kind === 'ALERT' && !fixture && <div className="mt-4 rounded-lg border p-3 text-xs" data-wiring-id="case.overview.money.coverage">
    <h3 className="font-semibold">Alert 근거의 날짜별 수신 범위</h3>
    {alertEvidence.state.status === 'loading' ? <p className="mt-2 text-muted-foreground">수신 범위를 불러오는 중입니다.</p>
      : alertEvidence.state.status === 'error' ? <p className="mt-2 text-muted-foreground">수신 범위를 조회하지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={alertEvidence.retry}>다시 조회</Button></p>
        : alertEvidence.state.status === 'success' ? <>
          {alertEvidence.state.data.coverage?.length ? <ul className="mt-2 space-y-1">{alertEvidence.state.data.coverage.map(day => <li key={day.businessDate}>{day.businessDate} · 수신 은행 {day.completeBanks}/{day.expectedBanks}개 · {day.complete ? '완료' : '미완료'}</li>)}</ul>
            : <p className="mt-2 text-muted-foreground">날짜별 수신 기록이 제공되지 않았습니다.</p>}
          {alertEvidence.state.data.dataAsOf && <p className="mt-2 text-muted-foreground">근거 생성 기준 {businessTime(alertEvidence.state.data.dataAsOf)}</p>}
          {alertEvidence.state.data.lastCheckedAt && <p className="mt-1 text-muted-foreground">수신 확인 시각 {businessTime(alertEvidence.state.data.lastCheckedAt)}</p>}
          <p className="mt-2 text-muted-foreground">이 범위는 Alert 근거의 날짜별 기록이며 돈의 흐름 계산 범위와 다릅니다.</p>
        </> : null}
  </div>
  const accountsVisual = <div data-wiring-id="case.overview.accounts.chart" className="min-w-0 space-y-2">{money.state.status === 'success' && money.state.data.available
    ? money.state.data.accounts?.length ? money.state.data.accounts.map(row => <div key={`${row.accountId}-${row.currency}`} className="min-w-0 rounded-lg border p-3 text-xs"><strong className="break-all">{row.accountId}</strong> · {row.currency}<p className="mt-2">유입 {moneyAmount(row.in)} · 유출 {moneyAmount(row.out)} · 순유입 {moneyAmount(row.net)}</p><p className="mt-1">집중도 {moneyPercent(row.concentrationPercent)} · 단시간 유출 {moneyPercent(row.rapidOutflowPercent)}</p><p className="mt-1 text-muted-foreground">평가 가능 입금 {moneyAmount(row.eligibleIn)} · 기간 끝 미성숙 입금 {moneyAmount(row.excludedIn)} · 기간 내 대응액 {moneyAmount(row.matchedIn)}</p></div>) : <p className="text-xs text-muted-foreground">계좌별 지표가 없습니다.</p>
    : <p className="text-xs text-muted-foreground">원장 계좌 지표를 확인할 수 없습니다.</p>}</div>
  const accountsExplanation = <div data-wiring-id="case.overview.accounts.explanation" className="min-w-0 text-xs">
    <p className="text-muted-foreground">집중도는 같은 통화의 양의 순유입 비중이며 잔액 비중이 아닙니다. 단시간 유출은 입금 후 선택 기간 내 출금의 추정 비율입니다.</p>
    <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => { setTransactionView('accounts'); setTab('transactions') }}>전체 조사 계좌 보기</Button>
    {money.state.status === 'success' && money.state.data.candidateAccounts && <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-semibold">조사 중심 계좌 선택</h3>
          <p className="mt-1 text-xs text-muted-foreground">선택한 가명 계좌를 기준으로 자금 지표를 다시 계산합니다. 사건 거래의 소속과 판정은 바뀌지 않습니다.</p>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{scopeAccounts.length ? scopeAccounts.map(account => <label key={account} className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`조사 중심 계좌 ${account}`} checked={chosenAccounts.includes(account)} onChange={() => toggleAccount(account)} disabled={!editable || scopeBusy || busy} /><span className="break-all">{account}{!scopeCandidates.includes(account) && <span className="ml-1 text-muted-foreground">· 최신 후보 목록에 없음</span>}</span></label>) : <p className="text-xs text-muted-foreground">선택할 계좌 후보가 없습니다.</p>}</div>
          <textarea aria-label="계좌 선택 사유" className="mt-3 min-h-16 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} placeholder="계좌를 포함하거나 제외한 이유" value={scopeComment} onChange={event => { setScopeComment(event.target.value); setScopeRetry(false) }} disabled={!editable || scopeBusy || busy} />
          <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!editable || scopeBusy || busy} onClick={() => void saveMoneyScope()}>조사 중심 계좌 저장</Button>{scopeRetry && <Button size="sm" variant="outline" disabled={scopeBusy || busy} onClick={() => { if (scopePrevious.current) void saveMoneyScope(scopePrevious.current) }}>같은 계좌 선택 요청 재시도</Button>}</div>
        </div>}
  </div>
  const linkedCases = <div data-wiring-id="case.overview.connections.list" className="min-w-0 space-y-3">{item.kind === 'ALERT'
    ? item.episodeId != null ? <Button size="sm" variant="outline" onClick={() => onOpenEpisode(item.episodeId!)}>Episode E-{item.episodeId} 보기</Button> : <p className="text-xs text-muted-foreground">현재 편입된 Episode는 없습니다.</p>
    : <Panel title="연결 Alert" description="이 Episode를 이루는 Alert" testId="linked-alerts"
      action={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => { setSelectingAlerts(value => !value); setUnlinkGroups([]); setUnlinkComment('') }}>{selectingAlerts ? '선택 취소' : '연결 Alert 선택'}</Button>{selectingAlerts && <Button size="sm" disabled={!editable || busy || !unlinkGroups.length || !unlinkComment.trim()} onClick={() => setConfirmUnlink(true)}>선택 Alert 연결 해제</Button>}</div>}>
      {selectingAlerts && <label className="text-xs">연결 해제 사유<textarea aria-label="연결 해제 사유" className="mt-1 mb-3 min-h-9 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} value={unlinkComment} disabled={!editable || busy} onChange={event => { setUnlinkComment(event.target.value); setCanRetry(false) }} placeholder="선택 Alert를 연결 해제하는 이유" /></label>}
      <LinkedAlerts onOpen={onOpenAlert ? id => { void openSourceAlert(id) } : undefined} rows={linkedGroups.map(group => {
        const members = group.members.filter(member => !['EXCLUDED', 'TRANSFERRED'].includes(member.state))
        const scores = members.flatMap(member => member.transaction.scores?.p_laundering == null ? [] : [member.transaction.scores.p_laundering])
        const amounts = memberAmountsByCurrency(members)
        return { id: group.sourceAlertId!, risk: scores.length ? Math.max(...scores) : null,
          types: [...new Set(members.flatMap(member => member.sources.flatMap(source => source.primaryType ? [source.primaryType] : [])))],
          detail: `거래 ${new Set(members.map(member => member.txId)).size}건`, amount: Object.entries(amounts).map(([currency, value]) => `${moneyAmount(value)} ${currency}`).join(' · ') || '—', status: '연결됨' }
      })} selection={selectingAlerts ? { ids: linkedGroups.filter(group => unlinkGroups.includes(group.groupId)).map(group => group.sourceAlertId!), disabled: !editable || busy,
        toggle: id => { const group = linkedGroups.find(group => group.sourceAlertId === id)!; setUnlinkGroups(ids => ids.includes(group.groupId) ? ids.filter(value => value !== group.groupId) : [...ids, group.groupId]); setCanRetry(false) } } : undefined} />
      {selectingAlerts && <p className="mt-2 text-xs text-muted-foreground">남는 Alert가 2개 미만이면 모두 연결 해제하고 Episode는 해체 종결 이력으로 보존합니다.</p>}
    </Panel>}</div>
  const relatedFlowLabels: Record<string, string> = {
    BOUNDARY_PASS: '자금 통과 경로', BOUNDARY_SAME_FOCAL: '같은 중심 계좌', BOUNDARY_OPEN_PAIR: '진행 중 Alert 사이 연결',
    BOUNDARY_CAP: '거래 건수 한도', BOUNDARY_SPAN: '거래 기간 한도', BOUNDARY_STAR_CHUNK: '부채꼴 흐름의 분리 구간',
  }
  const relatedFlowEvidence = item.kind === 'ALERT' && <section aria-label="다른 Alert와의 연결 근거" className="min-w-0 space-y-2 text-xs">
    <h3 className="font-semibold">다른 Alert와의 연결 근거</h3>
    {item.relatedFlows?.length ? item.relatedFlows.map((flow, index) => <div key={`${flow.kind}/${index}`} className="min-w-0 rounded-lg border p-3">
      <strong title={flow.kind}>{relatedFlowLabels[flow.kind] ?? 'Alert 연결 근거'}</strong>
      <p className="mt-1 break-words font-mono">{flow.txIds.map(id => `T-${id}`).join(' · ') || '근거 거래 미제공'}</p>
      <div className="mt-2 flex flex-wrap gap-2">{flow.relatedAlertIds.length ? flow.relatedAlertIds.map(id => <Button key={id} type="button" size="sm" variant="outline" disabled={!onOpenAlert} onClick={() => void openSourceAlert(id)}>Alert A-{id} 보기</Button>) : <span>이동할 현재 Alert가 없습니다.</span>}</div>
    </div>) : <p>{item.relatedFlows == null ? 'Alert 연결 근거가 제공되지 않았습니다.' : '현재 근거에 기록된 Alert 연결이 없습니다.'}</p>}
    <p className="text-muted-foreground">전체 관련 사건 검색 결과가 아닙니다. 연결 근거 거래는 현재 사건 소속과 다를 수 있습니다.</p>
  </section>
  const preservedCaseEvidence = <CaseEvidenceHistory item={item} onOpenCase={(nextKind, nextCaseId) => { if (nextKind === 'ALERT') onOpenAlert?.(nextCaseId); else onOpenEpisode(nextCaseId) }} />
  const connectionExplanation = <p data-wiring-id="case.overview.connections.scope" className="text-xs leading-5 text-muted-foreground">화면의 연결은 현재 사건에 기록된 Episode·Alert만 보여 줍니다. 계좌·소유주로 다른 사건을 폭넓게 찾는 API는 미연동이므로 관련 사건이 0건이라고 판단할 수 없습니다.</p>
  const transferHistory = (item.history ?? []).filter(row => row.action === 'TRANSFER')
  const groupDecisionsAvailable = linkedGroups.some(group => group.decision !== undefined)
  const episodeConnectionEvidence = <div className="space-y-4" data-wiring-id="case.overview.connections.evidence">
    <div className="rounded-lg border p-4 text-xs">
      <h3 className="text-sm font-semibold">묶인 사유와 판정 범위</h3>
      {transferHistory.length ? <div className="mt-2 space-y-1">{transferHistory.map(row => <p key={row.eventId}>{businessTime(row.businessAt)} · {row.actor ?? '기록 주체 미제공'} · {row.comment || '사유 미기록'}</p>)}</div>
        : <p className="mt-2 text-muted-foreground">현재 Episode 이력에서 편입 사유를 확인할 수 없습니다.</p>}
      <p className="mt-2">연결 Alert {linkedGroups.length}건 · {groupDecisionsAvailable ? `묶음 판정 ${linkedGroups.filter(group => group.decision != null).length}/${linkedGroups.length}` : '묶음 판정 상태 미제공'} · 미판정 조사 대상 {item.pendingCount}건</p>
    </div>
    {timedLinkedEvidence.length ? <div className="space-y-2" aria-label="Alert별 연결 비교">
      <p className="text-xs text-muted-foreground">현재 조사 거래의 첫 시각 순서입니다. 간격은 각 Alert의 첫 거래 시각끼리 비교하며 편입 사유나 연결 강도를 뜻하지 않습니다.</p>
      {timedLinkedEvidence.map(({ group, members, period, firstAt }, index) => {
      const previousFirstAt = timedLinkedEvidence[index - 1]?.firstAt
      const amounts = memberAmountsByCurrency(members)
      const shared = [...accountUse.values()].filter(perAlert => perAlert.size > 1 && perAlert.has(group.sourceAlertId!)).length
      return <div key={group.groupId} data-wiring-id={`case.overview.connections.alert.${group.sourceAlertId}`} className="rounded-lg border p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="font-mono">A-{group.sourceAlertId}</strong><Button type="button" size="sm" variant="outline" disabled={!onOpenAlert} onClick={() => void openSourceAlert(group.sourceAlertId!)}>Alert 원본 보기</Button></div>
        <p className="mt-2">거래 {members.length}건 · {period} · {Object.entries(amounts).map(([currency, amount]) => `${moneyAmount(amount)} ${currency}`).join(' · ') || '금액 없음'}</p>
        <p className="mt-1">{firstAt == null ? '첫 거래 시각 확인 불가' : index === 0 ? '첫 거래 시각 기준 첫 Alert' : previousFirstAt == null ? '직전 Alert와의 첫 거래 시각 간격 확인 불가' : `직전 Alert 첫 거래에서 ${elapsedTime(firstAt - previousFirstAt)} 뒤`}</p>
        <p className="mt-1">현재 묶음 판정: {group.decision === undefined ? '값 미제공' : decisionLabel(group.decision)} · 공유 계좌 {shared}개 · 원래 담당자: {sourceAssignees[group.sourceAlertId!]?.status === 'loaded' ? sourceAssignees[group.sourceAlertId!].name : sourceAssignees[group.sourceAlertId!]?.status === 'missing' ? '원본 Alert를 찾을 수 없음' : sourceAssignees[group.sourceAlertId!]?.status === 'error' ? '조회 실패' : sourceAssignees[group.sourceAlertId!]?.status === 'loading' ? '조회 중' : '확인 전'} <Button type="button" size="sm" variant="ghost" disabled={sourceAssignees[group.sourceAlertId!]?.status === 'loading'} onClick={() => void showSourceAssignee(group.sourceAlertId!)} aria-label={`원래 담당자 조회 A-${group.sourceAlertId}`}>조회</Button></p>
        <p className="mt-1 text-muted-foreground">조사 거래 판정 {members.filter(member => activeMember(member.state) && member.decision != null).length}건 · 미판정 {members.filter(member => member.state === 'PENDING').length}건. 거래 판정과 묶음 판정은 다릅니다.</p>
        <Button type="button" size="sm" variant="ghost" className="mt-1" disabled={!members.length} onClick={() => openEvidence(members.map(member => member.txId))}>이 Alert의 조사 거래 보기</Button>
      </div>
    })}</div> : <p className="text-xs text-muted-foreground">연결 Alert의 거래 정보를 확인할 수 없습니다.</p>}
  </div>
  const sharedAccountEvidence = <div data-wiring-id="case.overview.shared.accounts" className="space-y-3 text-xs">
    <p className="text-muted-foreground">현재 Episode의 조사 거래에서 관측된 송금·수취 방향입니다. 조사 역할(SUBJECT/CONTEXT)이나 자동 연결 강도 판정과 같지 않습니다.</p>
    {sharedAccounts.length ? sharedAccounts.map(([accountId, perAlert]) => <div key={accountId} className="rounded-lg border p-3">
      <strong className="break-all font-mono">{accountId}</strong><span className="ml-2 text-muted-foreground">{accountMeta.get(accountId)?.ownerName ?? '소유주 미제공'} · 은행 ID {accountMeta.get(accountId)?.bankId ?? '미제공'}</span>
      <div className="mt-2 flex flex-wrap gap-2">{[...perAlert].map(([alertId, use]) => <Badge key={alertId} variant="outline">A-{alertId} · {[use.sent ? `송금 ${use.sent}건` : '', use.received ? `수취 ${use.received}건` : ''].filter(Boolean).join(' · ')}</Badge>)}</div>
    </div>) : <p className="rounded-lg border p-3">현재 조회된 조사 거래에서는 둘 이상의 Alert에 같은 계좌가 나타나지 않습니다. 다른 연결 근거가 없다는 뜻은 아닙니다.</p>}
    {sharedOwners.length > 0 && <div className="rounded-lg border p-3"><h3 className="font-semibold">같은 소유주의 다른 계좌</h3>{sharedOwners.map(owner => <p key={[...owner.accounts].join('|')} className="mt-2">{owner.name} · 계좌 {[...owner.accounts].join(', ')} · Alert {[...owner.alerts].map(id => `A-${id}`).join(', ')}</p>)}</div>}
    <p className="text-muted-foreground">계좌·소유주 정보가 응답에 포함된 범위만 비교했습니다. 허브 계좌 기준과 공식 연결 근거 강도는 Backend 확인이 필요합니다.</p>
  </div>
  const recentHistory = <div data-wiring-id="case.overview.progress.history" className="min-w-0 space-y-2">{item.history?.length ? item.history.slice(0, 3).map(row => <div key={row.eventId} className="rounded-md border p-3 text-xs"><strong>{row.action}</strong> · {row.actor ?? '시스템'} · {new Date(row.businessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}{row.comment && <p className="mt-1 text-muted-foreground">{row.comment}</p>}</div>) : <p className="text-xs text-muted-foreground">처리 이력이 없습니다.</p>}</div>
  const progressExplanation = <div data-wiring-id="case.overview.progress.next" className="min-w-0 text-xs"><p>조사 범위 {item.summary.txCount}건 · 미판정 {item.pendingCount}건</p><p className="mt-1 text-muted-foreground">담당 {item.assigneeName} · {item.status === 'OPEN' ? '진행 중' : '종결'}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => setTab('review')}>검토 의견과 전체 이력 보기</Button></div>
  const alertOverviewSections: OverviewSection[] = [
    { id: 'judgment', name: '판단 요약', content: <section className="rounded-xl border bg-card p-4" aria-label="판단 요약"><h2 className="text-base font-semibold">1 판단 요약</h2><p className="mt-2 text-xs text-muted-foreground">모델 참고 정보와 룰 평가 결과는 별개입니다.</p><div className="mt-4 space-y-4">{modelInfo}{ruleEvidence}</div></section> },
    { id: 'money', name: '돈의 흐름', content: <section className="rounded-xl border bg-card p-4" aria-label="돈의 흐름"><h2 className="text-base font-semibold">2 돈의 흐름</h2><p className="mt-2 text-xs text-muted-foreground">조사 거래 {evidence.members.length}건 · 거래 기간 {evidence.period} · 원장 기준 외부 자금</p>{flowDiagram}{receiptCoverage}
      <div className="mt-4 grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">{flowVisual}{flowExplanation}</div></section> },
    { id: 'accounts', name: '핵심 계좌', content: <section className="h-full rounded-xl border bg-card p-4" aria-label="핵심 계좌"><h2 className="text-base font-semibold">3 핵심 계좌</h2><div className="mt-3 space-y-4">{accountsVisual}{accountsExplanation}</div></section>, focusContent: <section className="rounded-xl border bg-card p-4" aria-label="핵심 계좌"><h2 className="text-base font-semibold">3 핵심 계좌</h2><div className="mt-4 grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">{accountsVisual}{accountsExplanation}</div></section> },
    { id: 'connections', name: '다른 사건과의 연결', content: <section className="h-full rounded-xl border bg-card p-4" aria-label="다른 사건과의 연결"><h2 className="text-base font-semibold">4 다른 사건과의 연결</h2><div className="mt-3 space-y-4">{linkedCases}{relatedFlowEvidence}{preservedCaseEvidence}{connectionExplanation}</div></section>, focusContent: <section className="rounded-xl border bg-card p-4" aria-label="다른 사건과의 연결"><h2 className="text-base font-semibold">4 다른 사건과의 연결</h2><div className="mt-4 grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">{linkedCases}{relatedFlowEvidence}{preservedCaseEvidence}{connectionExplanation}</div></section> },
    { id: 'progress', name: '진행·최근 처리', content: <section className="h-full rounded-xl border bg-card p-4" aria-label="진행과 최근 처리"><h2 className="text-base font-semibold">5 진행·최근 처리</h2><div className="mt-3 space-y-4">{progressExplanation}{recentHistory}</div></section>, focusContent: <section className="rounded-xl border bg-card p-4" aria-label="진행과 최근 처리"><h2 className="text-base font-semibold">5 진행·최근 처리</h2><div className="mt-4 grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">{recentHistory}{progressExplanation}</div></section> },
  ]
  const episodeOverviewSections: OverviewSection[] = [
    { id: 'connections', name: '연결 Alert와 편입 근거', content: <section className="rounded-xl border bg-card p-4" aria-label="연결 Alert와 편입 근거"><h2 className="text-base font-semibold">1 연결 Alert와 편입 근거</h2><div className="mt-4 space-y-4">{episodeConnectionEvidence}{linkedCases}</div></section> },
    { id: 'shared', name: '공유 계좌와 소유주', content: <section className="rounded-xl border bg-card p-4" aria-label="공유 계좌와 소유주"><h2 className="text-base font-semibold">2 공유 계좌와 소유주</h2><div className="mt-4">{sharedAccountEvidence}</div></section> },
    { id: 'judgment', name: '통합 판단과 돈의 흐름', content: <section className="rounded-xl border bg-card p-4" aria-label="통합 판단과 돈의 흐름"><h2 className="text-base font-semibold">3 통합 판단과 돈의 흐름</h2><p className="mt-2 text-xs text-muted-foreground">모델 참고 정보·룰 평가·원장 자금 지표는 서로 다른 근거입니다. 개별 Alert의 룰 출처는 평가 결과 API가 필요합니다.</p><div className="mt-4 grid items-start gap-4 xl:grid-cols-2">{modelInfo}{ruleEvidence}</div><section aria-label="돈의 흐름" data-wiring-id="case.overview.money" className="mt-4"><p className="text-xs text-muted-foreground">조사 거래 {evidence.members.length}건 · 거래 기간 {evidence.period}</p>{flowDiagram}<div className="mt-4 grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">{flowVisual}{flowExplanation}</div></section></section> },
    { id: 'accounts', name: '핵심 계좌와 다른 사건', content: <section className="h-full rounded-xl border bg-card p-4" aria-label="핵심 계좌와 다른 사건"><h2 className="text-base font-semibold">4 핵심 계좌와 다른 사건</h2><div className="mt-4 space-y-4">{accountsVisual}{accountsExplanation}{preservedCaseEvidence}{connectionExplanation}</div></section> },
    { id: 'progress', name: '진행·최근 처리', content: <section className="h-full rounded-xl border bg-card p-4" aria-label="진행과 최근 처리"><h2 className="text-base font-semibold">5 진행·최근 처리</h2><div className="mt-4 space-y-4">{progressExplanation}{recentHistory}</div></section> },
  ]
  // The five visual forms follow aml-overview-responsive-states.html, using only values in this case response.
  const metricTile = (label: string, value: string | number) => <div className="min-w-0 rounded-lg border bg-card p-4"><span className="block text-xs text-muted-foreground">{label}</span><strong className="mt-2 block break-words text-xl tabular-nums">{value}</strong></div>
  const focusFlow = money.state.status === 'success' && money.state.data.available && money.state.data.external?.length
    ? <div className="space-y-3" data-wiring-id="case.overview.money.chart">{money.state.data.external.map(row => <div key={row.currency} className="grid min-w-0 items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
      {metricTile(`외부 유입 · ${row.currency}`, moneyAmount(row.in))}<span className="self-center text-center text-muted-foreground" aria-hidden="true">→</span>{metricTile('조사 중심 계좌 · 순유입', moneyAmount(row.net))}<span className="self-center text-center text-muted-foreground" aria-hidden="true">→</span>{metricTile(`외부 유출 · ${row.currency}`, moneyAmount(row.out))}
    </div>)}</div> : <div data-wiring-id="case.overview.money.chart" className="rounded-lg border border-dashed bg-card p-4 text-sm">{money.state.status === 'loading' ? '자금 흐름 조회 중' : '자금 흐름 산출값 미제공'}</div>
  const accountRows = money.state.status === 'success' && money.state.data.available ? money.state.data.accounts ?? [] : []
  const focusAccounts = accountRows.length
    ? <div className="space-y-4">{accountRows.map(row => {
      const largest = Math.max(...accountRows.filter(account => account.currency === row.currency).map(account => Math.max(0, account.net)), 0)
      return <div key={`${row.accountId}-${row.currency}`} className="min-w-0 rounded-lg border bg-card p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong className="break-all">{row.accountId} · {row.currency}</strong><span className="tabular-nums">순유입 {moneyAmount(row.net)}</span></div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${largest ? Math.max(0, row.net) / largest * 100 : 0}%` }} /></div>
      </div>
    })}</div> : <div className="rounded-lg border border-dashed bg-card p-4 text-sm">계좌별 순유입 비교값 미제공</div>
  const focusHistory = <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3">{metricTile('조사 범위', item.summary.txCount)}{metricTile('제외', excludedCount)}{metricTile('미판정', item.pendingCount)}</div>
    <div className="border-l-2 border-primary pl-4">{item.history?.length ? <div className="rounded-lg border bg-card p-3 text-sm">{businessTime(item.history[0].businessAt)} · {item.history[0].actor ?? '시스템'} · {item.history[0].action}</div> : <div className="rounded-lg border border-dashed bg-card p-3 text-sm">최근 처리 이력 없음</div>}</div>
  </div>
  const alertFocus: { question: string; visual: ReactNode; copy: ReactNode; after?: ReactNode }[] = [
    { question: '무엇이 의심스럽고 어떤 근거가 확인됐나?', visual: <><div className="mx-auto rounded-lg border-2 border-primary bg-card px-6 py-3 font-semibold">판단 근거</div><div className="grid gap-3 border-t-2 border-primary pt-4 sm:grid-cols-3">{metricTile('모델', `위험 점수 ${item.summary.riskScore}`)}{metricTile('의심 패턴', item.summary.primaryType || '미제공')}{metricTile('룰', '평가 결과 미연동')}</div></>, copy: <><p>모델 점수와 룰 평가는 별개입니다. 룰의 기준선·관측값·근거 거래는 결과 API가 제공되면 표시합니다.</p>{seedMembers.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => openEvidence([seedMembers[0].txId])}>대표 씨앗 거래 T-{seedMembers[0].txId} 보기</Button>}</>, after: ruleEvidence },
    { question: '돈이 어디서 들어와 어디로 나갔나?', visual: focusFlow, copy: <div data-wiring-id="case.overview.money.explanation" className="space-y-3"><p>원장 기준 외부 유입·순유입·유출을 통화별로 비교합니다. 조사 거래의 총액과 다릅니다.</p><p>경계 거래 목록은 현재 API에 없습니다.</p><Button type="button" size="sm" variant="outline" disabled={!evidence.members.length} onClick={() => openEvidence(evidence.members.map(member => member.txId))}>사건 조사 거래 보기</Button></div> },
    { question: '어느 계좌부터 확인할까?', visual: focusAccounts, copy: <>{accountsExplanation}</> },
    { question: '이미 조사 중인 사건과 어떻게 이어지나?', visual: <div className="grid min-w-0 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">{metricTile('현재 Alert', `A-${item.alertId ?? '—'}`)}<span className="text-center text-primary" aria-hidden="true">──</span>{metricTile('기록된 Episode', item.episodeId != null ? `E-${item.episodeId}` : '편입 없음')}</div>, copy: <>{linkedCases}{relatedFlowEvidence}{preservedCaseEvidence}{connectionExplanation}</> },
    { question: '남은 판단과 마지막 처리 내용은?', visual: focusHistory, copy: <>{progressExplanation}</> },
  ]
  const episodeFocus: { question: string; visual: ReactNode; copy: ReactNode; after?: ReactNode }[] = [
    { question: '이 Alert 묶음이 맞나?', visual: <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">{timedLinkedEvidence.length ? timedLinkedEvidence.map(({ group, firstAt }, index) => {
      const previous = timedLinkedEvidence[index - 1]?.group.sourceAlertId
      const shared = previous == null ? [] : sharedAccounts.filter(([, perAlert]) => perAlert.has(previous) && perAlert.has(group.sourceAlertId!))
      return <div key={group.groupId} className="contents">
        {index > 0 && <div className="flex min-w-16 flex-col items-center text-center text-xs text-muted-foreground"><span className="hidden h-0.5 w-full bg-primary sm:block" /><span className="sm:hidden" aria-hidden="true">↓</span><span>{shared.length ? `공유 계좌 ${shared.length}개` : '공유 계좌 미확인'}</span></div>}
        <div className="min-w-0 flex-1 rounded-lg border bg-card p-4 text-sm"><span className="block text-xs text-muted-foreground">{firstAt == null ? '첫 거래 시각 미제공' : businessTime(new Date(firstAt).toISOString())}</span><strong className="mt-2 block">A-{group.sourceAlertId}</strong><span className="mt-2 block text-xs">{decisionLabel(group.decision)}</span></div>
      </div>
    }) : <div className="rounded-lg border border-dashed bg-card p-4">연결 Alert 미제공</div>}</div>, copy: <><p>연결 Alert {linkedGroups.length}건을 첫 조사 거래 시각순으로 보여 줍니다. 연결선은 두 Alert의 조회된 공유 계좌만 나타냅니다.</p><p>{transferHistory.length ? `편입 이력 ${transferHistory.length}건 · 상세는 전체 보기에서 확인` : '편입 사유 기록은 현재 조회되지 않았습니다.'}</p><div className="flex flex-wrap gap-2">{timedLinkedEvidence.map(({ group }) => <Button key={group.groupId} type="button" size="sm" variant="outline" disabled={!onOpenAlert} onClick={() => void openSourceAlert(group.sourceAlertId!)}>A-{group.sourceAlertId} 원본 보기</Button>)}</div></> },
    { question: 'Alert 사이에 실제로 공유된 계좌는?', visual: <div className="space-y-3">{sharedAccounts.length ? sharedAccounts.map(([accountId, perAlert]) => <div key={accountId} className="grid gap-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><strong className="break-all">{accountId}</strong><div className="flex flex-wrap gap-2">{[...perAlert].map(([alertId, use]) => <Badge key={alertId} variant="outline">A-{alertId} · 송금 {use.sent} · 수취 {use.received}</Badge>)}</div></div>) : <div className="rounded-lg border border-dashed bg-card p-4">조회된 조사 거래에 공유 계좌 없음</div>}</div>, copy: <p>현재 Episode의 조사 거래에서 관측된 송금·수취 방향입니다. 공식 연결 강도는 아직 제공되지 않습니다.</p> },
    { question: '묶음 전체에서는 무엇이 보이나?', visual: focusFlow, copy: <><p>원장 자금 지표와 모델·룰 결과는 서로 다른 근거입니다.</p>{flowExplanation}</> },
    { question: '이 묶음 밖의 연결까지 확인됐나?', visual: <div className="grid min-w-0 gap-3 sm:grid-cols-2">{metricTile(`이번 Episode · E-${item.caseId}`, `${sharedAccounts.length}개 공유 계좌`)}<div className="rounded-lg border border-dashed bg-card p-4 text-sm"><span className="block text-xs text-muted-foreground">다른 사건</span><strong className="mt-2 block">조회 범위 밖</strong></div></div>, copy: <>{preservedCaseEvidence}{connectionExplanation}</> },
    { question: '종결 전에 어떤 판정이 남았나?', visual: <><div className="grid gap-3 sm:grid-cols-3">{linkedGroups.length ? linkedGroups.map(group => <div key={group.groupId} className="rounded-lg border bg-card p-4 text-sm"><strong>A-{group.sourceAlertId}</strong><span className="mt-2 block">{decisionLabel(group.decision)}</span></div>) : metricTile('연결 Alert', '미제공')}</div>{focusHistory}</>, copy: <>{progressExplanation}</> },
  ]
  const overviewSections = (item.kind === 'EPISODE' ? episodeOverviewSections : alertOverviewSections).map((section, index) => {
    const focus = (item.kind === 'EPISODE' ? episodeFocus : alertFocus)[index]
    return { ...section, focusContent: <FocusPanel number={index + 1} title={section.name} question={focus.question} visual={focus.visual} after={focus.after}>{focus.copy}</FocusPanel> }
  })
  return <div className="space-y-5"><RefreshStatus queries={[detail, money, targets]} />
    <CaseHeader id={item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`} title={item.kind === 'ALERT' ? item.summary.primaryType : item.outcome === 'DISSOLVED' ? '해체된 Episode · 현재 연결 Alert 0건' : `${item.primaryTypes.join(' · ') || '유형 정보 미제공'} · Alert ${item.sourceAlertIds.length}건`}
      tab={tab} onTab={changeTab} count={item.summary.txCount} notice={incompleteReceipts && item.status === 'OPEN' ? <span role="status" className="font-medium text-destructive-text">{incompleteNotice}{alertEvidence.state.status === 'success' && <Button type="button" size="sm" variant="link" className="ml-1 h-auto p-0 text-inherit underline" onClick={showReceiptCoverage}>수신 범위 보기</Button>}</span> : undefined} tags={<><span className="inline-flex" data-wiring-id="case.header.status">{item.kind === 'ALERT' ? <StatusBadge status={alertListRow(item).status} /> : <EpisodeStatusBadge status={episodeListRow(item).status} />}</span><span className="inline-flex" data-wiring-id="case.header.risk"><RiskBadge score={item.summary.riskScore} /></span><span className="inline-flex" data-wiring-id="case.header.assignee"><Badge variant="outline">담당 {item.assigneeName}</Badge></span>{item.kind === 'ALERT' && item.publishedVersion != null && <Badge variant="outline">근거 v{item.publishedVersion}</Badge>}<Badge variant="outline">{item.createdAt ? new Date(item.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '—'}</Badge></>} />
    <div hidden={tab !== 'overview'}><LiveOverviewViews key={item.caseId} kind={item.kind} sections={overviewSections} /></div>
    {graphVisited && <section hidden={tab !== 'graph'} aria-label="관계 그래프" className="space-y-2"><h2 className="font-semibold">관계 그래프</h2>{graphRows.length ? <TimeGraph active={tab === 'graph'} rows={graphRows} context={item.kind === 'ALERT' ? { kind: 'alert', code: `A-${item.alertId}` } : { kind: 'episode', code: `E-${item.caseId}` }} live={{ onInvestigate: openEvidence }} /> : <EmptyBlock>표시할 거래가 없습니다.</EmptyBlock>}</section>}
    <div hidden={tab !== 'transactions'}>
    <div role="group" aria-label="조사 범위 보기 방식" className="mb-4 flex flex-wrap gap-2"><Button type="button" size="sm" variant={transactionView === 'transactions' ? 'secondary' : 'outline'} aria-pressed={transactionView === 'transactions'} onClick={() => setTransactionView('transactions')}>거래 보기</Button><Button type="button" size="sm" variant={transactionView === 'accounts' ? 'secondary' : 'outline'} aria-pressed={transactionView === 'accounts'} onClick={() => setTransactionView('accounts')}>계좌 보기</Button></div>
    {transactionView === 'accounts' && <ReviewAccounts item={item} onInvestigate={openEvidence} />}
    <div hidden={transactionView !== 'transactions'}>
    {evidenceFocus && <section data-wiring-id="case.transactions.evidence" aria-label="선택 근거 거래" className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">선택한 조사 거래</h2><Button type="button" size="sm" variant="outline" onClick={() => setEvidenceFocus(null)}>전체 조사 범위 보기</Button></div>
      {focusedMembers.length ? <div className="mt-3 space-y-2">{focusedMembers.map(member => <div key={member.txId} data-wiring-id={`case.transactions.tx.${member.txId}`} className="rounded-md border p-3 text-sm">
        <strong className="font-mono">T-{member.txId}</strong> · {businessTime(member.transaction.occurredAt)} · {transactionRole(member.transaction.role)}
        <p className="mt-1">{member.transaction.fromAccountId} → {member.transaction.toAccountId} · {moneyAmount(member.transaction.amountPaid)} {member.transaction.paymentCurrency}</p>
        <p className="mt-1 text-xs text-muted-foreground">포함 이유 코드: {member.transaction.includedReasons?.length ? member.transaction.includedReasons.join(', ') : '현재 거래에 제공되지 않음'} · 생성 정책별 의미 확인 필요</p>
        <p className="mt-1 text-xs text-muted-foreground">조사 역할 {member.reviewRole} · 상태 {member.state} · 판정 {decisionLabel(member.decision)}</p>
      </div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">선택한 거래가 현재 조사 범위에 없습니다. 최신 범위를 확인해 주세요.</p>}
    </section>}
    <CaseActivityCharts amounts={activityAmounts} dailyUsdByCurrency={dailyMemberUsdByCurrency(item.groups ?? [])} />
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">조사 범위</h2>{item.kind === 'ALERT' && <Button size="sm" variant="outline" disabled={!editable || busy || !removableSelections.length || !excludeComment.trim()} onClick={() => void execute('EXCLUDE')}>선택 거래 제외</Button>}</div>{item.kind === 'ALERT' && <textarea aria-label="거래 제외 사유" className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000} placeholder="선택 거래를 조사 범위에서 제외하는 이유" value={excludeComment} onChange={event => { setExcludeComment(event.target.value); setCanRetry(false) }} disabled={!editable || busy} />}{(item.groups ?? []).length ? item.groups?.map(group => <div key={group.groupId} className="rounded-xl border bg-card p-4"><h3 className="text-sm font-medium">{item.kind === 'EPISODE' && group.sourceAlertId != null && !group.label.includes(String(group.sourceAlertId)) ? `Alert A-${group.sourceAlertId} · ` : ''}{group.label} · 묶음 {group.groupId}</h3><AlertTxTable remote onOpenTransaction={openTransaction} rows={group.members.map(member => ({
      txId: member.txId, txAt: new Date(member.transaction.occurredAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'),
      fromAccount: member.transaction.fromAccountId, toAccount: member.transaction.toAccountId,
      fromOwnerName: accountMeta.get(member.transaction.fromAccountId)?.ownerName, toOwnerName: accountMeta.get(member.transaction.toAccountId)?.ownerName,
      amountPaid: member.transaction.amountPaid, paymentCurrency: member.transaction.paymentCurrency, paymentFormat: member.transaction.paymentFormat,
      launderingScore: member.transaction.scores?.p_laundering ?? null, role: member.transaction.role,
      reviewLabel: `${member.reviewRole} · ${member.state}${member.decision ? ` · ${member.decision}` : ''}`,
    }))} selection={{ ids: selected[group.groupId] ?? [], onToggle: id => toggleTx(group.groupId, id), disabled: id => { const member = group.members.find(row => row.txId === id)!; return !editable || busy || (item.kind === 'ALERT' ? !['PENDING','DECIDED'].includes(member.state) : member.state !== 'PENDING' || member.reviewRole !== 'SUBJECT') } }} /></div>) : <EmptyBlock>조사 범위가 없습니다.</EmptyBlock>}</section>
    </div>
    </div>
    <div hidden={tab !== 'review'} className="space-y-4">
    <ReviewLayout reference={<dl className="space-y-4 text-xs"><div><dt>검토 범위</dt><dd>거래 {item.summary.txCount}건 · 조사 대상 {item.summary.subjectCount}건</dd></div><div><dt>유형</dt><dd>{item.kind === 'ALERT' ? item.summary.primaryType : item.primaryTypes.join(' · ')}</dd></div><div><dt>조사 대상 거래액</dt><dd>{Object.entries(item.summary.amountsByCurrency).map(([currency, amount]) => <p key={currency}>{currency} {moneyAmount(amount)}</p>)}</dd></div></dl>}>
      <SectionTitle title={item.kind === 'ALERT' ? '검토 의견' : '조사 의견'} description="판단 근거와 조사 내용을 남깁니다. 본인 담당 진행 중 사건만 변경할 수 있습니다." />
      {editRestriction && <p className="text-xs text-muted-foreground">{editRestriction}</p>}
      {item.kind === 'EPISODE' && <section aria-label="연결 Alert 판정" className="space-y-2">{linkedGroups.map(group => <div key={group.groupId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span>Alert A-{group.sourceAlertId} · {decisionLabel(group.decision)}</span>{group.members.some(member => member.reviewRole === 'SUBJECT' && member.state === 'DECIDED') && <Button type="button" size="sm" variant="outline" aria-label={`Alert A-${group.sourceAlertId} 판정 다시 검토`} disabled={!editable || busy || !comment.trim()} onClick={() => setReconsiderGroupId(group.groupId)}>판정 다시 검토</Button>}</div>)}</section>}
      <AlertDialog open={reconsiderGroupId != null} onOpenChange={open => { if (!open) setReconsiderGroupId(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>선택 Alert의 판정을 다시 검토할까요?</AlertDialogTitle><AlertDialogDescription>이 묶음의 판정을 미판정으로 되돌립니다. 기존 판정은 이력에 보존됩니다. Alert의 Episode 소속은 바뀌지 않습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={!editable || busy || !comment.trim()} onClick={() => { const id = reconsiderGroupId; setReconsiderGroupId(null); if (id != null) void reconsiderGroup(id) }}>판정 재검토 확정</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      {item.kind === 'ALERT' ? <>
        {item.episodeId != null && <p className="text-xs text-muted-foreground">Episode E-{item.episodeId}에 편입된 Alert입니다. <Button size="sm" variant="link" onClick={() => onOpenEpisode(item.episodeId!)}>Episode E-{item.episodeId} 보기</Button></p>}
        {!hasSubject && item.status === 'OPEN' && <p className="text-xs text-destructive-text">조사 대상 거래가 없어 최종 종결할 수 없습니다.</p>}
        <AlertVerdictForm verdict={verdict} setVerdict={setVerdict} comment={comment} setComment={value => { setComment(value); setCanRetry(false) }}
          commentLabel="변경 사유" target={targetCaseId == null ? '' : String(targetCaseId)} setTarget={value => setTargetCaseId(Number(value))}
          locked={!editable || busy} episodes={targets.state.status === 'success' ? targets.state.data.content.filter(row => row.kind === 'EPISODE' && row.status === 'OPEN').map(row => row.caseId) : []}
          disabledSubmit={((verdict === 'normal' || verdict === 'standalone') && !hasSubject) || (verdict === 'link-episode' && !selectedTarget)}
          newActionLabel="목록에서 새 Episode 만들기"
          onConfirm={() => { if (verdict === 'normal' || verdict === 'standalone') setConfirmDecision(verdict === 'normal' ? 'NORMAL' : 'SUSPICIOUS'); else if (verdict === 'link-episode') void finalizeAlert('EXISTING'); else onBack() }}
          targetFooter={verdict === 'link-episode' && <>
            {targets.state.status === 'loading' && <LoadingBlock label="Episode 목적지" />}
            {targets.state.status === 'success' && targetCaseId != null && !selectedTarget && <p role="status" className="text-xs text-muted-foreground">선택한 Episode는 최신 진행 중 목록에 없습니다. 목적지를 다시 선택해 주세요.</p>}
            {targets.state.status === 'error' && <ErrorBlock message={targets.state.message} onRetry={targets.retry} />}
            {targets.state.status === 'success' && targets.state.data.totalPages > 1 && <div className="flex items-center gap-2 text-xs"><Button size="sm" variant="outline" aria-label="이전 Episode 목적지" disabled={targetPage === 0} onClick={() => { setTargetCaseId(null); setTargetPage(page => page - 1) }}>이전</Button><span>{targetPage + 1}/{targets.state.data.totalPages}쪽 · 전체 {targets.state.data.totalElements}건</span><Button size="sm" variant="outline" aria-label="다음 Episode 목적지" disabled={targetPage + 1 >= targets.state.data.totalPages} onClick={() => { setTargetCaseId(null); setTargetPage(page => page + 1) }}>다음</Button></div>}
          </>} />
        {verdict === 'new-episode' && <p className="text-xs text-muted-foreground">새 Episode는 목록에서 본인 담당 Alert를 최소 2개 선택해 생성합니다.</p>}
      </> : <><label className="text-sm">조사 의견 (필수)</label><textarea aria-label="변경 사유" className="min-h-[280px] w-full flex-1 resize-y rounded-md border bg-background p-3 text-sm leading-7" placeholder="어떤 주체가 어떤 패턴으로 자금을 옮겼는지, 연결한 Alert의 공통점을 작성하세요." maxLength={4000} value={comment} onChange={event => { setComment(event.target.value); setCanRetry(false) }} disabled={!editable || busy} /></>}
      <div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('COMMENT')}>의견 저장</Button><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('REVIEW_START')}>검토 시작 기록</Button><Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'NORMAL')}>선택 범위 정상 판정</Button>{item.kind === 'EPISODE' && <Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'SUSPICIOUS')}>선택 범위 이상 판정</Button>}{item.kind === 'EPISODE' && <Button size="sm" variant="outline" disabled={!editable || busy || item.pendingCount > 0} onClick={() => void execute('CLOSE')}>사건 종결</Button>}{canRetry && <Button size="sm" variant="outline" disabled={busy} onClick={() => { const previous = previousRequest.current; if (previous) void submit(previous.command, previous.success) }}>같은 요청 재시도</Button>}</div>
      {item.kind === 'EPISODE' && item.pendingCount > 0 && <p className="text-xs text-muted-foreground">미판정 조사 대상 {item.pendingCount}건을 먼저 판정해야 사건을 종결할 수 있습니다.</p>}

    </ReviewLayout>
    {item.outcome === 'DISSOLVED' && <p role="status" className="rounded-lg border p-3 text-sm">해체된 Episode입니다. 현재 소속 Alert는 없으며 해제 당시 구성과 사유는 아래 이력에 보존됩니다.</p>}
    <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{willDissolve ? 'Episode를 해체할까요?' : '선택 Alert의 연결을 해제할까요?'}</AlertDialogTitle>
      <AlertDialogDescription>{willDissolve ? `소속 Alert ${linkedGroups.length}건 모두 OPEN으로 복원됩니다. Episode와 해제 사유는 종결 이력으로 보존됩니다.` : `선택한 Alert ${unlinkGroups.length}건을 원래 담당자의 OPEN 업무로 복원합니다.`}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={!editable || busy} onClick={() => { setConfirmUnlink(false); void unlink() }}>{willDissolve ? 'Episode 해체 확인' : '연결 해제 확인'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {!!item.detachments?.length && <section aria-label="연결 해제 이력" className="space-y-3"><h2 className="font-semibold">연결 해제 이력</h2>{item.detachments.map(entry => <details key={entry.eventId} className="rounded-lg border p-3 text-sm">
      <summary>{entry.action === 'DISSOLVE' ? 'Episode 해체' : 'Alert 연결 해제'} · {entry.comment}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{new Date(entry.businessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 아래 내용은 해제 당시 기록이며 현재 소속이 아닙니다.</p>
      {entry.snapshot.groups.map(group => <div key={group.groupId} className="mt-2"><strong>Alert A-{group.sourceAlertId}</strong>{group.members.map(member => <p key={member.txId} className="text-xs">T-{member.txId} · {member.reviewRole} · {member.state} · {member.decision ?? '미판정'}</p>)}</div>)}
    </details>)}</section>}
    <AlertDialog open={confirmDecision != null} onOpenChange={open => { if (!open) setConfirmDecision(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmDecision === 'NORMAL' ? '정상 종결' : '단독 세탁 의심 종결'}을 확정할까요?</AlertDialogTitle><AlertDialogDescription>제외되지 않은 조사 대상 전체에 최종 판정을 적용합니다. 참고 맥락·제외 거래에는 판정하지 않습니다. 기존 범위 판정은 최종 판정으로 바뀔 수 있으며 이전 내역은 감사 기록에 남습니다. 종결 후 직접 수정할 수 없습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { const decision = confirmDecision; setConfirmDecision(null); if (decision === 'NORMAL' && incompleteReceipts) setConfirmIncompleteClose(true); else if (decision) void finalizeAlert(decision) }}>최종 종결 확정</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={confirmIncompleteClose} onOpenChange={setConfirmIncompleteClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>수신이 덜 된 상태입니다. 그래도 종결하시겠어요?</AlertDialogTitle><AlertDialogDescription>돈의 흐름을 완전히 확인할 수 없습니다. 정상 종결하면 처리 이력에 수신 미완 상태를 남깁니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { setConfirmIncompleteClose(false); void finalizeAlert('NORMAL', true) }}>수신 미완 상태에서 정상 종결</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {!!item.history?.length && <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">처리 이력</h2>{item.history.map(row => <div key={row.eventId} className="border-b py-2 text-xs"><span className="font-semibold">{row.action}</span> · {row.actor ?? '시스템'} · {new Date(row.businessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}<p className="mt-1 text-muted-foreground">{row.comment}</p></div>)}</section>}
    </div>
  </div>
}

export default function LiveCasesPage({ kind, caseId, onOpen, onBack, onOpenEpisode, onOpenAlert }: { kind: ReviewKind; caseId?: number; onOpen: (id: number) => void; onBack: () => void; onOpenEpisode?: (id: number) => void; onOpenAlert?: (id: number) => void }) {
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
  const [targetPage, setTargetPage] = useViewState('cases/targets/page', 0)
  const [busy, setBusy] = useState(false)
  const previous = useRef<{ payload: string; id: string } | null>(null)
  const busyRef = useRef(false)
  const list = useAsync(() => fetchReviewCases({ kind, from: from || undefined, to: to || undefined, ...filterQuery, page, size: 20 }), [scope, page], { key: 'cases', maxAge: 60_000 })
  const targets = useAsync(() => fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', page: targetPage, size: 20 }), [targetPage], { key: 'cases/targets', enabled: kind === 'ALERT' })
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
      const result = await submitReviewCommand(command, requestId)
      previous.current = null
      window.dispatchEvent(new Event('review-command-saved'))
      const refreshed = await Promise.allSettled([list.refresh(), targets.refresh()])
      const success = result.targetCaseId == null ? 'Episode 편입 완료' : `Episode E-${result.targetCaseId} 편입 완료`
      toast.success(refreshed.some(result => result.status === 'rejected') ? `${success}. 저장은 완료됐지만 최신 화면을 불러오지 못했습니다. 다시 조회해 주세요.` : success)
      if (result.targetCaseId != null) onOpenEpisode?.(result.targetCaseId)
    } catch (error) {
      if (error instanceof ApiError) { previous.current = null; toast.error(error.message) }
      else toast.error('처리 여부가 불확실합니다. 같은 선택·의견으로 다시 제출하면 동일 요청으로 확인합니다.')
      throw error
    } finally { busyRef.current = false; setBusy(false) }
  }
  if (caseId) return <CaseDetail key={`${kind}-${caseId}`} caseId={caseId} kind={kind} onBack={onBack} onOpenEpisode={onOpenEpisode ?? onBack} refreshList={list.refresh} onOpenAlert={onOpenAlert ?? (kind === 'ALERT' ? onOpen : undefined)} />
  const footer = list.state.status === 'success' ? <div className="flex items-center justify-between text-xs"><span>전체 {list.state.data.totalElements.toLocaleString()}건</span><div className="flex gap-2"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><span>{page + 1} / {Math.max(1, list.state.data.totalPages)}</span><Button disabled={page + 1 >= list.state.data.totalPages} onClick={() => setPage(page + 1)}>다음</Button></div></div> : null
  const remote = { draftScope: `${scope}/${page}`, query: search, onQuery: setSearch, assignees: users.state.status === 'success' ? users.state.data : [{ id: user.userId, name: user.name }], footer, busy, loading: list.state.status === 'loading', range: from ? { from: new Date(`${from}T00:00:00`), to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined, onRange: (range?: DateRange) => setPeriod({ from: range?.from ? isoDate(range.from) : '', to: range?.to ? isoDate(range.to) : '' }), targets: targets.state.status === 'success' ? targets.state.data.content.map(row => row.caseId) : [] }
  return <div className="space-y-4">
    <RefreshStatus queries={[list]} />

    {users.state.status === 'error' && <ErrorBlock message={users.state.message} onRetry={users.retry} />}
    {kind === 'ALERT' && targets.state.status === 'error' && <ErrorBlock message={targets.state.message} onRetry={targets.retry} />}
    {list.state.status === 'error' && <ErrorBlock message={list.state.error instanceof ApiError && list.state.error.problem.status === 403 ? '이 사건 목록을 조회할 권한이 없습니다.' : list.state.message} onRetry={list.retry} />}
    {list.state.status === 'loading' && <LoadingBlock label="사건 목록" />}
    {list.state.status !== 'error' && (kind === 'ALERT' ? <AlertList key={`${kind}/${page}`} rows={rows.map(alertListRow)} today={businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()} remote={{ ...remote, filters: alertFilters, onFilters: setAlertFilters }} onOpen={row => { const item = rows.find(item => item.alertId === row.alertId); if (item) onOpen(item.caseId) }} onLink={link} /> : <EpisodeList key={`${kind}/${page}`} rows={rows.map(episodeListRow)} today={businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()} remote={{ ...remote, filters: episodeFilters, onFilters: setEpisodeFilters }} onOpen={row => onOpen(row.episodeId)} />)}
    {kind === 'ALERT' && targets.state.status === 'success' && targets.state.data.totalPages > 1 && <div className="flex gap-2 text-xs"><span>편입 대상 Episode 페이지</span><Button disabled={targetPage === 0} onClick={() => setTargetPage(targetPage - 1)}>이전 대상</Button><Button disabled={targetPage + 1 >= targets.state.data.totalPages} onClick={() => setTargetPage(targetPage + 1)}>다음 대상</Button></div>}
  </div>
}
