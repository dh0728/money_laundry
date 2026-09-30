import type { ReactNode } from 'react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { subDays } from 'date-fns'
import type { AlertRow } from '@/api/alerts'
import type { DashboardData } from '@/api/dashboard'
import { InstitutionLayout } from './DashboardPresentation'
import { SectionTitle } from '@/components/page'
import { SectionCards } from '@/components/SectionCards'
import { Card, CardContent } from '@/components/ui/card'
import { isoDate } from '@/lib/format'
import { AiDailyReport } from './AiDailyReport'
import { AlertStatusChart } from './AlertFlowChart'
import { loadActiveEpisodes, loadAlerts, loadDashboard } from './dataSource'
import { chartInputs, institutionCards } from './metrics'
import { TransactionPatternHierarchy } from './PatternRelation'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { useAsync } from '@/lib/useAsync'
import { WorkCard } from './WorkCard'
import { alertWorkItem, episodeWorkItem } from './workItems'
import { useAlertOverrides } from '@/features/alerts/alertOverrides'

export type InstitutionRemote = {
  cards: ReactNode; charts: ReactNode; report: ReactNode
  alerts: ReactNode; episodes: ReactNode
  range?: DateRange; onRange: (range?: DateRange) => void
}
export function InstitutionView({ today, remote }: { today: Date; remote?: InstitutionRemote }) {
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(today, 29), to: today })
  const kpiRange = { from: isoDate(subDays(today, 59)), to: isoDate(today) }
  const chartRange = { from: range?.from && isoDate(range.from), to: range?.to && isoDate(range.to) }
  const summary = useAsync(() => loadDashboard(kpiRange), [kpiRange.from, kpiRange.to], { enabled: !remote })
  const charts = useAsync(() => loadDashboard(chartRange), [chartRange.from, chartRange.to], { enabled: !remote })
  const [overrides] = useAlertOverrides()
  const episodes = useAsync(() => loadActiveEpisodes(overrides), [overrides], { enabled: !remote })
  const open = useAsync(() => loadAlerts({ status: 'OPEN', sort: 'createdAt,desc', size: 200 }), [], { enabled: !remote })

  if (!remote && summary.state.status === 'error') return <ErrorBlock message={summary.state.message} onRetry={summary.retry} />
  if (!remote && summary.state.status === 'loading') return <LoadingBlock label="기관 지표" />
  const openAlerts: AlertRow[] = open.state.status === 'success' ? open.state.data.content : []

  return (
    <>
      <InstitutionLayout cards={remote?.cards ?? (summary.state.status === 'success' && <SectionCards items={institutionCards(summary.state.data)} />)} range={remote ? remote.range : range} onRange={remote?.onRange ?? setRange} today={today}
        charts={remote?.charts ?? <>{charts.state.status === 'error' && <ErrorBlock message={charts.state.message} onRetry={charts.retry} />}{charts.state.status === 'loading' && <LoadingBlock label="그래프" />}{charts.state.status === 'success' && <InstitutionCharts data={charts.state.data} />}</>}
        report={remote?.report ?? (summary.state.status === 'success' && <AiDailyReport summary={summary.state.data} openAlerts={openAlerts} />)} />
      <div data-testid="institution-recent" className="grid items-start gap-4 @3xl:grid-cols-2">
        <section aria-labelledby="recent-title">
          <div className="mb-3">
            <h2 id="recent-title" className="text-base font-semibold tracking-tight">{remote ? '미처리 Alert' : '최근 유입 Alert'}</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">{remote ? '미처리 · 위험도 순' : '미처리 · 최신순'}</p>
          </div>
          {remote?.alerts}
          {!remote && open.state.status === 'error' && <ErrorBlock message={open.state.message} onRetry={open.retry} />}
          {!remote && open.state.status === 'loading' && <LoadingBlock label="최근 Alert" />}
          {!remote && open.state.status === 'success' &&
            (openAlerts.length ? (
              <div className="space-y-2.5">{openAlerts.slice(0, 5).flatMap(alert => alertWorkItem(alert) ?? []).map(item => <WorkCard key={item.id} item={item} />)}</div>
            ) : (
              <EmptyBlock>미처리 Alert가 없습니다.</EmptyBlock>
            ))}
        </section>
        <section aria-labelledby="recent-episode-title">
          <div className="mb-3">
            <h2 id="recent-episode-title" className="text-base font-semibold tracking-tight">조사 중 Episode</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">{remote ? '종결 전 · 위험도 순' : '종결 전 · 최신순'}</p>
          </div>
          {remote?.episodes}
          {!remote && episodes.state.status === 'error' && <ErrorBlock message={episodes.state.message} onRetry={episodes.retry} />}
          {!remote && episodes.state.status === 'loading' && <LoadingBlock label="조사 중 Episode" />}
          {!remote && episodes.state.status === 'success' &&
            (episodes.state.data.length ? (
              <div className="space-y-2.5">{episodes.state.data.slice(0, 5).map(episode => { const item = episodeWorkItem(episode); return <WorkCard key={item.id} item={item} /> })}</div>
            ) : (
              <EmptyBlock>조사 중인 Episode가 없습니다.</EmptyBlock>
            ))}
        </section>
      </div>
    </>
  )
}

function InstitutionCharts({ data }: { data: DashboardData }) {
  const { composition, distribution } = chartInputs(data)
  const hasComposition = composition.some(item => item.value > 0)
  return (
    <>
      <div className="shrink-0">
        {data.dailyAlertStatus?.length ? <AlertStatusChart data={data.dailyAlertStatus} /> : <EmptyBlock>선택한 기간에 Alert가 없습니다.</EmptyBlock>}
      </div>
      <Card className="min-w-0 max-w-full shrink-0 gap-4 py-4 shadow-none" data-testid="transaction-pattern-hierarchy">
        <CardContent className="flex min-h-0 flex-1 flex-col px-4">
          <SectionTitle title="의심 거래 구성과 패턴 분포" description="전체 구성은 거래 건, 패턴별 유형은 패턴 소속 거래의 Alert 수" />
          {hasComposition ? (
            <div className="min-h-0 flex-1"><TransactionPatternHierarchy composition={composition} distribution={distribution} /></div>
          ) : (
            <EmptyBlock>선택한 기간에 의심 거래가 없습니다.</EmptyBlock>
          )}
        </CardContent>
      </Card>
    </>
  )
}
