import { useState } from 'react'
import type { AlertRow } from '@/api/alerts'
import { formatScore, type TypeCode } from '@/api/codes'
import { useCurrentUser } from '@/app/session'
import { PatternBadge, WorkStatusBadge } from '@/components/badges'
import { ProvenanceBadge } from '@/components/Provenance'
import { SectionCard, sectionCardSurface } from '@/components/SectionCards'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import { useReviewRequests } from '@/features/episodes/reviewStore'
import { RadarSweep } from '@/features/agent/RadarSweep'
import { rdrSummaryBackground } from '@/features/agent/rdrSummaryStyle'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { workStatuses } from '@/lib/workStatus'
import { loadAlerts, loadMyEpisodes } from './dataSource'
import { WorkCard } from './WorkCard'
import { sortWork, STALE_DAYS, workItems, workSorts, type WorkSort } from './workItems'

const HIGH_RISK = 0.8

// 규칙으로 만든 문장이다(LLM 연결 전 mock). 위 카드·아래 보드와 겹치는 "현재 상황"은 두지 않는다.
function PersonalAiSummary({ pending }: { pending: AlertRow[] }) {
  const counts = pending.reduce<Record<number, number>>((acc, alert) => ({ ...acc, [alert.primaryType.code]: (acc[alert.primaryType.code] ?? 0) + 1 }), {})
  const focus = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]
  const focusCode = focus ? Number(focus[0]) as TypeCode : null
  return (
    <Card data-testid="personal-ai-summary" className="h-full w-full min-w-0 shadow-none @xl:col-span-2 @5xl:col-span-2" style={rdrSummaryBackground}>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <RadarSweep className="size-5 shrink-0" />
          <h2 className="text-base font-semibold tracking-tight">RDR 9000 · 내 담당 요약</h2>
          <ProvenanceBadge kind="mock" title="규칙 기반 시연 문장. LLM 미연동." />
          <p className="ml-auto text-[11px] text-muted-foreground">판단은 조사자가 수행</p>
        </div>
        <div className="mt-4">
          <p className="text-xs font-medium">집중 패턴</p>
          {focusCode === null ? <p className="mt-2 text-sm leading-6 text-muted-foreground">처리 전 Alert 없음.</p>
            : <div className="mt-2 flex flex-wrap items-center gap-2"><PatternBadge code={focusCode} /><p className="text-sm leading-6 text-muted-foreground">처리 전 Alert의 최빈 유형({focus[1]}건). 동일 소유주·계좌의 반복 여부 확인 필요.</p></div>}
        </div>
      </CardContent>
    </Card>
  )
}

export function PersonalView() {
  const currentUser = useCurrentUser()
  const [sort, setSort] = useState<WorkSort>('risk')
  const [overrides] = useAlertOverrides()
  const [reviews] = useReviewRequests()
  const alerts = useAsync(() => loadAlerts({ assigneeId: 'me', size: 200 }), [])
  // mock: Alert·Episode 화면에서 처리한 결과가 바뀌면 다시 묶는다(새로고침하면 처음 상태)
  const episodes = useAsync(() => loadMyEpisodes(currentUser.userId, overrides, reviews), [overrides, reviews])
  if (alerts.state.status === 'error') return <ErrorBlock message={alerts.state.message} onRetry={alerts.retry} />
  if (episodes.state.status === 'error') return <ErrorBlock message={episodes.state.message} onRetry={episodes.retry} />
  if (alerts.state.status === 'loading' || episodes.state.status === 'loading') return <LoadingBlock label="내 담당 업무" />

  const myAlerts = alerts.state.data.content.map(alert => withOverride(alert, overrides))
  const items = workItems(myAlerts, episodes.state.data)
  const pending = myAlerts.filter(alert => alert.status === 'OPEN')
  const active = items.filter(item => item.status !== 'DONE')
  const stale = active.filter(item => item.ageDays >= STALE_DAYS)

  return (
    <>
      <div className={`grid grid-cols-1 items-stretch gap-4 @xl:grid-cols-2 @5xl:grid-cols-4 ${sectionCardSurface}`} data-testid="personal-top">
        <SectionCard item={{ label: `위험 점수 ${formatScore(HIGH_RISK)} 이상`, value: fmt(pending.filter(alert => alert.riskScore >= HIGH_RISK).length), trend: '처리 전 Alert', note: '판정이 급한 고위험 건' }} />
        <SectionCard item={{ label: `${STALE_DAYS}일 이상 경과`, value: fmt(stale.length), trend: `Alert ${stale.filter(item => item.kind === 'Alert').length} · Episode ${stale.filter(item => item.kind === 'Episode').length}`, note: '처리 전·처리 중 업무 중 오래 머문 건' }} />
        <PersonalAiSummary pending={pending} />
      </div>
      <section aria-labelledby="queue-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="queue-title" className="text-base font-semibold tracking-tight">업무 현황</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">Alert·Episode 상태별 · {workSorts[sort].label}</p>
          </div>
          <Select value={sort} onValueChange={value => setSort(value as WorkSort)}>
            <SelectTrigger size="sm" className="w-40" aria-label="업무 정렬 기준"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(workSorts).map(([key, option]) => <SelectItem key={key} value={key}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid items-start gap-4 @3xl:grid-cols-3" data-testid="work-queue">
          {workStatuses.map(status => {
            const column = sortWork(items.filter(item => item.status === status), sort)
            return (
              <div key={status} data-testid="work-status-column" className="flex min-w-0 flex-col gap-2.5">
                <div className="flex items-center gap-2"><WorkStatusBadge status={status} /><span className="text-xs tabular-nums text-muted-foreground">{column.length}건</span></div>
                {column.length ? column.map(item => <WorkCard key={`${item.kind}-${item.id}`} item={item} />) : <EmptyBlock>해당 상태 업무가 없습니다.</EmptyBlock>}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
