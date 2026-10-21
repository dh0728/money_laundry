import { useState } from 'react'
import { fetchReviewCases, type ReviewCase, type ReviewKind, type ReviewStatus } from '@/api/liveReview'
import { useCurrentUser } from '@/app/session'
import { WorkStatusBadge } from '@/components/badges'
import { SectionCard, sectionCardSurface } from '@/components/SectionCards'
import { EmptyBlock, ErrorBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAsync } from '@/lib/useAsync'
import { workStatuses, type WorkStatus } from '@/lib/workStatus'
import { WorkCard } from './WorkCard'
import { reviewCaseWorkItem } from './workItems'

const size = 20
type Source = { kind: ReviewKind; status: ReviewStatus }
const sources: Record<WorkStatus, Source[]> = {
  PENDING: [],
  IN_PROGRESS: [{ kind: 'EPISODE', status: 'OPEN' }],
  DONE: [{ kind: 'ALERT', status: 'CLOSED' }, { kind: 'EPISODE', status: 'CLOSED' }],
}
const unclassifiedSource: Source[] = [{ kind: 'ALERT', status: 'OPEN' }]

function WorkColumn({ status }: { status: WorkStatus | 'UNKNOWN' }) {
  const { userId } = useCurrentUser()
  const [page, setPage] = useState(0)
  const result = useAsync(() => Promise.all((status === 'UNKNOWN' ? unclassifiedSource : sources[status]).map(source =>
    fetchReviewCases({ ...source, assigneeId: userId, page, size }))), [status, userId, page], { key: `personal/${status}` })
  const pages = result.state.status === 'success' ? result.state.data : []
  const rows: ReviewCase[] = pages.flatMap(part => part.content)
  const items = rows.flatMap(row => reviewCaseWorkItem(row) ?? [])
    .sort((a, b) => b.riskScore - a.riskScore || b.ageDays - a.ageDays)
  const totalPages = Math.max(1, ...pages.map(part => part.totalPages))

  return <div data-testid="work-status-column" className="flex min-w-0 flex-col gap-2.5">
    <div className="flex items-center gap-2">{status === 'UNKNOWN' ? <h3 className="text-sm font-semibold">열람 상태 미확인 Alert</h3> : <WorkStatusBadge status={status} />}{result.state.status === 'loading' && status !== 'PENDING' && <Skeleton className="h-3 w-20" />}{result.state.status === 'success' && status !== 'PENDING' && <span className="text-xs tabular-nums text-muted-foreground">현재 페이지 {items.length}건</span>}</div>
    {result.state.status === 'loading' ? <div role="status" aria-label="내 담당 업무 불러오는 중" className="space-y-2.5">{[0, 1, 2].map(index => <div key={index} className="flex flex-col gap-2 rounded-lg border bg-card px-5 py-4"><div className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-20" /><div className="flex gap-1.5"><Skeleton className="h-5 w-10 rounded-full" /><Skeleton className="h-5 w-12 rounded-full" /></div></div><Skeleton className="h-4 w-3/4" /><Skeleton className="h-5 w-16 rounded-full" /></div>)}</div>
      : result.state.status === 'error' ? <ErrorBlock message={result.state.message} onRetry={result.retry} />
        : items.length ? items.map(item => <WorkCard key={`${item.kind}-${item.id}`} item={item} />)
          : <EmptyBlock>{status === 'PENDING' ? '최초 열람 정보가 제공되지 않아 처리 전 Alert를 구분할 수 없습니다.' : '해당 상태 업무가 없습니다.'}</EmptyBlock>}
    {result.state.status === 'success' && totalPages > 1 && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button>
      <span>{page + 1} / {totalPages}</span>
      <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>다음</Button>
    </div>}
  </div>
}

export default function LivePersonalView({ pending, aged }: { pending: number; aged: number }) {
  return <>
    <div className={`grid grid-cols-1 items-stretch gap-4 @xl:grid-cols-2 @5xl:grid-cols-4 ${sectionCardSurface}`} data-testid="personal-top">
      <SectionCard item={{ label: '내 미처리', value: pending.toLocaleString('ko-KR'), trend: '본인 담당 Alert·Episode', note: '현재 미종결 사건' }} />
      <SectionCard item={{ label: '72시간 이상 경과', value: aged.toLocaleString('ko-KR'), trend: '본인 담당', note: '우선 확인 필요' }} />
      <section className="rounded-xl border bg-card p-5 @xl:col-span-2 @5xl:col-span-2"><h2 className="text-base font-semibold">RDR 9000 · 내 담당 요약</h2><p className="mt-4 text-sm text-muted-foreground">유형별 요약 데이터가 제공되지 않았습니다.</p></section>
    </div>
    <section aria-labelledby="queue-title">
      <div className="mb-3"><h2 id="queue-title" className="text-base font-semibold tracking-tight">업무 현황</h2><p className="mt-1.5 text-xs text-muted-foreground">Alert·Episode 상태별 · 위험 점수 높은 순</p></div>
      <div className="grid items-start gap-4 @3xl:grid-cols-3" data-testid="work-queue">{workStatuses.map(status => <WorkColumn key={status} status={status} />)}</div>
      <div className="mt-5"><WorkColumn status="UNKNOWN" /></div>
    </section>
  </>
}
