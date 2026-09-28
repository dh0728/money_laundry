import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/common'
import { fetchReviewCase, fetchReviewCases, fetchReviewMoney, submitReviewCommand, type ReviewAction, type ReviewCase, type ReviewKind, type ReviewQuery } from '@/api/liveReview'
import { PageHeading } from '@/components/page'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useCurrentUser, canEditOpen } from '@/app/session'
import { useAsync } from '@/lib/useAsync'

function CaseDetail({ caseId, kind, onBack }: { caseId: number; kind: ReviewKind; onBack: () => void }) {
  const user = useCurrentUser()
  const { state, retry } = useAsync(() => fetchReviewCase(caseId), [caseId])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<number, number[]>>({})
  const previousRequest = useRef<{ payload: string; id: string } | null>(null)
  const [targetCaseId, setTargetCaseId] = useState<number | null>(null)
  const targets = useAsync(() => kind === 'ALERT' ? fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', size: 100 }) : Promise.resolve({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }), [kind])
  const money = useAsync(() => fetchReviewMoney(caseId), [caseId])

  if (state.status === 'loading') return <LoadingBlock label="조사 사건" />
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />
  const item = state.data
  if (item.kind !== kind) return <ErrorBlock message="요청한 종류와 사건 정보가 다릅니다." onRetry={retry} />
  const editable = canEditOpen(user, item.assigneeId, item.status)
  const activeSelections = (item.groups ?? []).map(group => ({
    caseId: item.caseId, revision: item.revision, groupId: group.groupId,
    txIds: (selected[group.groupId] ?? []).filter(id => group.members.some(member => member.txId === id && member.state === 'PENDING' && member.reviewRole === 'SUBJECT')),
  })).filter(group => group.txIds.length)
  const toggleTx = (groupId: number, txId: number) => setSelected(current => {
    const ids = current[groupId] ?? []
    return { ...current, [groupId]: ids.includes(txId) ? ids.filter(id => id !== txId) : [...ids, txId] }
  })
  async function execute(action: ReviewAction, decision?: 'NORMAL' | 'SUSPICIOUS') {
    if (!editable || busy) return
    const wholeCase = ['COMMENT', 'REVIEW_START', 'CLOSE'].includes(action)
    const selections = wholeCase ? [{ caseId: item.caseId, revision: item.revision, groupId: item.groups?.[0]?.groupId ?? 0, txIds: [] }] : activeSelections
    if (!comment.trim()) { toast.error('변경 사유를 입력해 주세요.'); return }
    if (!selections.length) { toast.error('미판정 거래를 선택해 주세요.'); return }
    if (action === 'DECIDE' && item.kind === 'EPISODE' && selections.some(selection => {
      const group = item.groups?.find(group => group.groupId === selection.groupId)
      return group?.members.filter(member => member.state === 'PENDING' && member.reviewRole === 'SUBJECT').length !== selection.txIds.length
    })) { toast.error('Episode는 각 묶음의 미판정 조사 거래 전체를 선택해야 합니다.'); return }
    const target = targets.state.status === 'success' ? targets.state.data.content.find(row => row.caseId === targetCaseId) : undefined
    const command = { action, selections, decision, comment: comment.trim(), ...(action === 'TRANSFER' ? { targetCaseId, targetRevision: target?.revision ?? null } : {}) }
    const payload = JSON.stringify(command)
    const requestId = previousRequest.current?.payload === payload ? previousRequest.current.id : crypto.randomUUID()
    previousRequest.current = { payload, id: requestId }
    setBusy(true)
    try {
      const result = await submitReviewCommand(command, requestId)
      toast.success(result.targetCaseId ? `Episode E-${result.targetCaseId} 생성` : '조사 결과 저장 완료')
      previousRequest.current = null; setComment(''); setSelected({}); retry()
      window.dispatchEvent(new Event('review-command-saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '저장하지 못했습니다. 사건을 다시 확인해 주세요.')
      if (error instanceof ApiError && error.problem.status === 409) {
        previousRequest.current = null; setSelected({}); retry(); targets.retry()
      }
    } finally { setBusy(false) }
  }
  return <div className="space-y-5">
    <Button variant="outline" size="sm" onClick={onBack}>목록으로</Button>
    <PageHeading title={`${item.kind === 'ALERT' ? `Alert A-${item.alertId ?? item.caseId}` : `Episode E-${item.caseId}`}`} description={`조사 사건 ID ${item.caseId} · ${item.status === 'OPEN' ? '진행 중' : '종결'} · 담당 ${item.assigneeName}`} />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="사건 요약">
      {[['위험 점수', item.summary.riskScore?.toFixed(2) ?? '—'], ['거래', String(item.summary.txCount)], ['미판정', String(item.pendingCount)], ['유형', item.summary.primaryType]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>)}
    </section>
    <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">조사 계좌 자금 지표</h2><p className="mt-1 text-xs text-muted-foreground">서버 원장 기준 · 단시간 유출 180분 추정</p>{money.state.status === 'loading' ? <LoadingBlock label="자금 지표" /> : money.state.status === 'error' ? <ErrorBlock message={money.state.message} onRetry={money.retry} /> : !money.state.data.available ? <p className="mt-3 text-sm text-muted-foreground">{({ EMPTY_SUBJECT_SCOPE: '조사 거래 범위가 없습니다.', EMPTY_ACCOUNT_SCOPE: '조사 계좌를 선택해야 합니다.', WAITING_RECEIPTS: '원장 수신 완료를 기다리는 중입니다.', NO_CLOSED_SNAPSHOT: '저장된 종결 시점 지표가 없습니다.' } as Record<string, string>)[money.state.data.reason ?? ''] ?? '현재 산출할 수 없습니다.'}</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{money.state.data.external?.map(row => <div key={row.currency} className="rounded-lg border p-3 text-xs"><strong>{row.currency}</strong><p className="mt-2">외부 유입 {Number(row.in).toLocaleString('ko-KR')}</p><p>외부 유출 {Number(row.out).toLocaleString('ko-KR')}</p><p>순유입 {Number(row.net).toLocaleString('ko-KR')}</p></div>)}{!money.state.data.complete && <p className="text-xs text-muted-foreground">원장 관측 일부만 완료됨</p>}</div>}</section>
    <section className="space-y-3"><h2 className="font-semibold">조사 범위</h2>{(item.groups ?? []).length ? item.groups?.map(group => <div key={group.groupId} className="rounded-xl border bg-card p-4"><h3 className="text-sm font-medium">{group.label} · 묶음 {group.groupId}</h3><div className="mt-3 space-y-2">{group.members.map(member => <label key={member.txId} className="flex min-w-0 items-start gap-2 rounded-md border p-2 text-xs"><input type="checkbox" className="mt-0.5" disabled={!editable || member.state !== 'PENDING' || member.reviewRole !== 'SUBJECT'} checked={selected[group.groupId]?.includes(member.txId) ?? false} onChange={() => toggleTx(group.groupId, member.txId)} /><span className="min-w-0 flex-1"><strong>T-{member.txId}</strong> · {member.reviewRole} · {member.state}{member.decision && ` · ${member.decision}`}<span className="mt-1 block break-all text-muted-foreground">{member.transaction.fromAccountId} → {member.transaction.toAccountId}</span></span><span>{Number(member.transaction.amountPaid).toLocaleString('ko-KR')} {member.transaction.paymentCurrency}</span></label>)}</div></div>) : <EmptyBlock>조사 범위가 없습니다.</EmptyBlock>}</section>
    <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">조사 처리</h2><p className="mt-1 text-xs text-muted-foreground">본인 담당 진행 중 사건만 변경 가능 · 변경 뒤 최신 사건 정보 재조회</p><textarea aria-label="변경 사유" className="mt-3 min-h-20 w-full rounded-md border bg-background p-3 text-sm" placeholder="조사 의견 또는 변경 사유" value={comment} onChange={event => setComment(event.target.value)} disabled={!editable || busy} /><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('COMMENT')}>의견 저장</Button><Button size="sm" variant="outline" disabled={!editable || busy} onClick={() => void execute('REVIEW_START')}>검토 시작 기록</Button><Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'NORMAL')}>선택 범위 정상 판정</Button>{item.kind === 'EPISODE' && <Button size="sm" disabled={!editable || busy || !activeSelections.length} onClick={() => void execute('DECIDE', 'SUSPICIOUS')}>선택 범위 이상 판정</Button>}{item.kind === 'ALERT' && <><select aria-label="Episode 이관 대상" className="rounded-md border bg-background px-2 text-xs" value={targetCaseId ?? 'new'} onChange={event => setTargetCaseId(event.target.value === 'new' ? null : Number(event.target.value))}><option value="new">새 Episode</option>{targets.state.status === 'success' && targets.state.data.content.map(row => <option key={row.caseId} value={row.caseId}>E-{row.caseId} · {row.assigneeName}</option>)}</select><Button size="sm" variant="outline" disabled={!editable || busy || !activeSelections.length || targets.state.status === 'loading'} onClick={() => void execute('TRANSFER')}>선택 거래 이관</Button></>}<Button size="sm" variant="outline" disabled={!editable || busy || item.pendingCount > 0} onClick={() => void execute('CLOSE')}>사건 종결</Button></div></section>
    {!!item.history?.length && <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">처리 이력</h2>{item.history.map(row => <div key={row.eventId} className="border-b py-2 text-xs"><span className="font-semibold">{row.action}</span> · {row.actor ?? '시스템'} · {new Date(row.businessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}<p className="mt-1 text-muted-foreground">{row.comment}</p></div>)}</section>}
  </div>
}

export default function LiveCasesPage({ kind, caseId, onOpen, onBack }: { kind: ReviewKind; caseId?: number; onOpen: (id: number) => void; onBack: () => void }) {
  const user = useCurrentUser()
  const [status, setStatus] = useState<ReviewQuery['status'] | 'ALL'>('ALL')
  const [mine, setMine] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const query: ReviewQuery = { kind, status: status === 'ALL' ? undefined : status, assigneeId: mine ? user.userId : undefined, from: from || undefined, to: to || undefined, page, size: 20 }
  const { state, retry } = useAsync(() => fetchReviewCases(query), [kind, status, mine, from, to, page])
  if (caseId) return <CaseDetail caseId={caseId} kind={kind} onBack={onBack} />
  return <div className="space-y-5"><PageHeading title={`${kind === 'ALERT' ? 'Alert' : 'Episode'} 목록`} description="서버 조사 사건 · 위험도 높은 순" />
    <div className="flex flex-wrap items-center gap-2"><label className="text-xs">상태 <select className="ml-1 rounded-md border bg-background p-2" value={status} onChange={event => { setStatus(event.target.value as typeof status); setPage(0) }}><option value="ALL">전체</option><option value="OPEN">진행 중</option><option value="CLOSED">종결</option></select></label><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); setPage(0) }} />내 담당</label><label className="text-xs">시작일 <input type="date" className="ml-1 rounded-md border bg-background p-1" value={from} onChange={event => { setFrom(event.target.value); setPage(0) }} /></label><label className="text-xs">종료일 <input type="date" className="ml-1 rounded-md border bg-background p-1" value={to} onChange={event => { setTo(event.target.value); setPage(0) }} /></label></div>
    {state.status === 'loading' ? <LoadingBlock label="조사 사건" /> : state.status === 'error' ? <ErrorBlock message={state.message} onRetry={retry} /> : <>{state.data.content.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{state.data.content.map((row: ReviewCase) => <button type="button" key={row.caseId} className="min-w-0 rounded-xl border bg-card p-4 text-left hover:bg-accent" onClick={() => onOpen(row.caseId)}><div className="flex items-center justify-between gap-2"><strong>{kind === 'ALERT' ? `A-${row.alertId ?? row.caseId}` : `E-${row.caseId}`}</strong><span className="text-xs">{row.status === 'OPEN' ? '진행 중' : '종결'}</span></div><p className="mt-2 text-xs text-muted-foreground">담당 {row.assigneeName} · 조사 사건 {row.caseId}</p><p className="mt-3 text-xs">위험 {row.summary.riskScore?.toFixed(2) ?? '—'} · 거래 {row.summary.txCount} · 미판정 {row.pendingCount}</p><p className="mt-2 text-xs text-muted-foreground">{row.summary.primaryType}</p></button>)}</div> : <EmptyBlock>조건에 맞는 조사 사건이 없습니다.</EmptyBlock>}<div className="flex items-center justify-end gap-2 text-xs"><span>전체 {state.data.totalElements}건 · {page + 1}쪽</span><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><Button size="sm" variant="outline" disabled={(page + 1) * 20 >= state.data.totalElements} onClick={() => setPage(page + 1)}>다음</Button></div></>}
  </div>
}
