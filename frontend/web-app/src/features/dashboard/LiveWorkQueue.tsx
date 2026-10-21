import { fetchReviewCases, type ReviewKind, type ReviewStatus } from '@/api/liveReview'
import { useCurrentUser } from '@/app/session'
import { hrefFor } from '@/app/navigation'
import { useAsync } from '@/lib/useAsync'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { WorkCard } from './WorkCard'
import { WorkQueue } from './WorkQueue'
import { reviewType } from '@/features/alerts/reviewListAdapter'

export function QueueItems({ kind, status, personal = true, size = 20 }: { kind: ReviewKind; status: ReviewStatus; personal?: boolean; size?: number }) {
  const user = useCurrentUser()
  const period = useSharedPeriod()
  const from = status === 'CLOSED' ? period.from : ''
  const to = status === 'CLOSED' ? period.to : ''
  const [page, setPage] = useViewState(`dashboard/queue/${personal}/${kind}/${status}/${size}${from || to ? `/${from}/${to}` : ''}`, 0)
  const result = useAsync(() => fetchReviewCases({ kind, statuses: [status], assigneeId: personal ? user.userId : undefined, page, size, ...(from ? { from } : {}), ...(to ? { to } : {}) }), [kind, status, personal, user.userId, page, size, from, to], { key: 'dashboard/queue' })
  if (result.state.status === 'loading') return <LoadingBlock label="담당 업무" />
  if (result.state.status === 'error') return <ErrorBlock message={result.state.message} onRetry={result.retry} />
  const data = result.state.data
  return <><p className="text-xs text-muted-foreground">{kind === 'ALERT' ? 'Alert' : 'Episode'} 전체 {data.totalElements}건 · 위험도 순</p>{data.content.length ? data.content.map(row => <WorkCard key={row.caseId} item={{
    kind: row.kind === 'ALERT' ? 'Alert' : 'Episode', code: row.kind === 'ALERT' ? `A-${row.alertId}` : `E-${row.caseId}`,
    href: hrefFor(row.kind === 'ALERT' ? 'alerts' : 'episodes', row.caseId), riskScore: row.summary.riskScore, ageDays: row.ageDays,
    summary: `조사 거래 ${row.summary.txCount}건 · ${Object.entries(row.summary.amountsByCurrency).map(([currency, value]) => `${Number(value).toLocaleString()} ${currency}`).join(' · ')}`,
    types: (row.kind === 'ALERT' ? [row.summary.primaryType] : row.primaryTypes).map(reviewType).flatMap(type => type.code == null ? [] : [type.code]),
  }} />) : <EmptyBlock>해당 상태 업무가 없습니다.</EmptyBlock>}
    {data.totalPages > 1 && <div className="flex items-center justify-between"><Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><span className="text-xs">{page + 1}/{data.totalPages}</span><Button size="sm" disabled={page + 1 >= data.totalPages} onClick={() => setPage(page + 1)}>다음</Button></div>}
  </>
}

export function LiveWorkQueue({ personal = true }: { personal?: boolean } = {}) {
  if (personal) return <>
    <section className="mb-5 rounded-xl border bg-card p-4" data-wiring-id="dashboard.personal.work.unclassified">
      <h3 className="text-sm font-semibold">열린 사건 · 단계 확인 불가</h3>
      <p className="mt-1 text-xs text-muted-foreground">열람·작업 시작 정보가 없는 사건입니다. Episode 편입만으로 처리 중이라고 판단하지 않습니다.</p>
      <div className="mt-4 grid items-start gap-4 @xl:grid-cols-2"><div className="flex min-w-0 flex-col gap-2"><QueueItems kind="ALERT" status="OPEN" size={5} /></div><div className="flex min-w-0 flex-col gap-2"><QueueItems kind="EPISODE" status="OPEN" size={5} /></div></div>
    </section>
    <WorkQueue columns={[
      { status: 'UNREAD', label: '미확인', content: <EmptyBlock>배정 후 열람 시각이 제공되지 않아 분류할 수 없습니다.</EmptyBlock> },
      { status: 'PENDING', label: '처리 전', content: <EmptyBlock>열람 후 작업 시작 여부가 제공되지 않아 분류할 수 없습니다.</EmptyBlock> },
      { status: 'IN_PROGRESS', label: '처리 중', content: <EmptyBlock>개별 사건의 작업 시작 여부가 제공되지 않아 분류할 수 없습니다.</EmptyBlock> },
      { status: 'DONE', label: '처리 완료', content: <><p className="text-xs text-muted-foreground">생성일 기준 선택 기간 · 위험도순 서버 페이지</p><QueueItems kind="ALERT" status="CLOSED" size={5} /><QueueItems kind="EPISODE" status="CLOSED" size={5} /></> },
    ]} />
  </>
  return <WorkQueue columns={[
    { status: 'PENDING', label: '열린 Alert', content: <QueueItems kind="ALERT" status="OPEN" personal={personal} /> },
    { status: 'IN_PROGRESS', label: '열린 Episode', content: <QueueItems kind="EPISODE" status="OPEN" personal={personal} /> },
    { status: 'DONE', content: <><QueueItems kind="ALERT" status="CLOSED" personal={personal} /><QueueItems kind="EPISODE" status="CLOSED" personal={personal} /></> },
  ]} />
}
