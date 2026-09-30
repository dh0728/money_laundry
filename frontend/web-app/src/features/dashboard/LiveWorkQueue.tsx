import { fetchReviewCases, type ReviewKind, type ReviewStatus } from '@/api/liveReview'
import { useCurrentUser } from '@/app/session'
import { hrefFor } from '@/app/navigation'
import { useAsync } from '@/lib/useAsync'
import { useViewState } from '@/lib/workspaceState'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { WorkCard } from './WorkCard'
import { WorkQueue } from './WorkQueue'
import { reviewType } from '@/features/alerts/reviewListAdapter'

export function QueueItems({ kind, status, personal = true }: { kind: ReviewKind; status: ReviewStatus; personal?: boolean }) {
  const user = useCurrentUser()
  const [page, setPage] = useViewState(`dashboard/queue/${personal}/${kind}/${status}`, 0)
  const result = useAsync(() => fetchReviewCases({ kind, statuses: [status], assigneeId: personal ? user.userId : undefined, page, size: 20 }), [kind, status, personal, user.userId, page], { key: 'dashboard/queue' })
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

export function LiveWorkQueue() {
  return <WorkQueue columns={[
    { status: 'PENDING', label: '열린 Alert', content: <QueueItems kind="ALERT" status="OPEN" /> },
    { status: 'IN_PROGRESS', label: '열린 Episode', content: <QueueItems kind="EPISODE" status="OPEN" /> },
    { status: 'DONE', content: <><QueueItems kind="ALERT" status="CLOSED" /><QueueItems kind="EPISODE" status="CLOSED" /></> },
  ]} />
}
