import { useState } from 'react'
import type { AlertRow } from '@/api/alerts'
import { formatScore, typeDisplay } from '@/api/codes'
import { MOCK_USER } from '@/app/session'
import { WorkStatusBadge } from '@/components/badges'
import { ProvenanceBadge } from '@/components/Provenance'
import { SectionCard, sectionCardSurface } from '@/components/SectionCards'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import { useReviewRequests } from '@/features/episodes/reviewStore'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/useAsync'
import { workStatuses } from '@/lib/workStatus'
import { loadAlerts, loadMyEpisodes } from './dataSource'
import { WorkCard } from './WorkCard'
import { sortWork, STALE_DAYS, workItems, workSorts, type WorkItem, type WorkSort } from './workItems'

const HIGH_RISK = 0.8

// 규칙으로 만든 문장이다(LLM 연결 전 mock). 위 카드·아래 보드와 겹치는 "현재 상황"은 두지 않는다.
function PersonalAiSummary({ pending, first }: { pending: AlertRow[]; first?: WorkItem }) {
  const counts = pending.reduce<Record<number, number>>((acc, alert) => ({ ...acc, [alert.primaryType.code]: (acc[alert.primaryType.code] ?? 0) + 1 }), {})
  const focus = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]
  return (
    <Card data-testid="personal-ai-summary" className="h-full shadow-none @5xl:col-span-2">
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">AI 요약 · 내 담당</h2>
          <ProvenanceBadge kind="mock" title="규칙으로 만든 문장입니다. LLM 연결은 발표 뒤 범위입니다." />
          <p className="ml-auto text-[11px] text-muted-foreground">판단은 조사자가 수행</p>
        </div>
        <div className="mt-4 grid gap-4 @3xl:grid-cols-2">
          <div>
            <p className="text-xs font-medium">집중 패턴</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{focus ? `처리 전 Alert 중 ${typeDisplay(Number(focus[0]) as AlertRow['primaryType']['code']).key} 의심이 ${focus[1]}건으로 가장 많습니다. 같은 소유주·계좌가 반복되는지 함께 보세요.` : '처리 전 Alert가 없습니다.'}</p>
          </div>
          <div>
            <p className="text-xs font-medium">먼저 볼 업무</p>
            {first ? (
              <a href={first.href} data-testid="personal-ai-first" className="mt-2 block rounded-md border px-3 py-2 interactive-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="block font-mono text-sm">{first.code}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{first.kind} · 위험 {formatScore(first.riskScore)} · {first.ageDays}일 경과</span>
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">처리할 업무가 없습니다.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function PersonalView() {
  const [sort, setSort] = useState<WorkSort>('risk')
  const [overrides] = useAlertOverrides()
  const [reviews] = useReviewRequests()
  const alerts = useAsync(() => loadAlerts({ assigneeId: 'me', size: 200 }), [])
  // mock: Alert·Episode 화면에서 처리한 결과가 바뀌면 다시 묶는다(새로고침하면 처음 상태)
  const episodes = useAsync(() => loadMyEpisodes(MOCK_USER.userId, overrides, reviews), [overrides, reviews])
  if (alerts.state.status === 'error') return <ErrorBlock message={alerts.state.message} onRetry={alerts.retry} />
  if (episodes.state.status === 'error') return <ErrorBlock message={episodes.state.message} onRetry={episodes.retry} />
  if (alerts.state.status === 'loading' || episodes.state.status === 'loading') return <LoadingBlock label="내 담당 업무" />

  const myAlerts = alerts.state.data.content.map(alert => withOverride(alert, overrides))
  const items = workItems(myAlerts, episodes.state.data)
  const pending = myAlerts.filter(alert => alert.status === 'OPEN')
  const active = items.filter(item => item.status !== 'DONE')
  const stale = active.filter(item => item.ageDays >= STALE_DAYS)
  const first = sortWork(active.filter(item => item.riskScore >= HIGH_RISK), 'age')[0] ?? sortWork(active, 'risk')[0]

  return (
    <>
      <div className={`grid grid-cols-1 items-stretch gap-4 @xl:grid-cols-2 @5xl:grid-cols-4 ${sectionCardSurface}`} data-testid="personal-top">
        <SectionCard item={{ label: `위험 점수 ${formatScore(HIGH_RISK)} 이상`, value: fmt(pending.filter(alert => alert.riskScore >= HIGH_RISK).length), trend: '처리 전 Alert', note: '판정이 급한 고위험 건' }} />
        <SectionCard item={{ label: `${STALE_DAYS}일 이상 경과`, value: fmt(stale.length), trend: `Alert ${stale.filter(item => item.kind === 'Alert').length} · Episode ${stale.filter(item => item.kind === 'Episode').length}`, note: '처리 전·처리 중 업무 중 오래 머문 건' }} />
        <PersonalAiSummary pending={pending} first={first} />
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

