import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { subDays } from 'date-fns'
import type { AlertRow } from '@/api/alerts'
import type { DashboardData } from '@/api/dashboard'
import { DateRangeButton } from '@/components/DateRangeButton'
import { SectionTitle } from '@/components/page'
import { SectionCards } from '@/components/SectionCards'
import { Card, CardContent } from '@/components/ui/card'
import { isoDate } from '@/lib/format'
import { AiDailyReport } from './AiDailyReport'
import { ChartAreaInteractive } from './AlertFlowChart'
import { loadAlerts, loadDashboard } from './dataSource'
import { chartInputs, institutionCards } from './metrics'
import { TransactionPatternHierarchy } from './PatternRelation'
import { EmptyBlock, ErrorBlock, LoadingBlock } from './states'
import { useAsync } from './useAsync'
import { WorkCard } from './WorkCard'

export function InstitutionView({ today }: { today: Date }) {
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(today, 29), to: today })
  const kpiRange = { from: isoDate(subDays(today, 59)), to: isoDate(today) }
  const chartRange = { from: range?.from && isoDate(range.from), to: range?.to && isoDate(range.to) }
  const summary = useAsync(() => loadDashboard(kpiRange), [kpiRange.from, kpiRange.to])
  const charts = useAsync(() => loadDashboard(chartRange), [chartRange.from, chartRange.to])
  const open = useAsync(() => loadAlerts({ status: 'OPEN', sort: 'createdAt,desc', size: 200 }), [])

  if (summary.state.status === 'error') return <ErrorBlock message={summary.state.message} onRetry={summary.retry} />
  if (summary.state.status === 'loading') return <LoadingBlock label="기관 지표" />
  const openAlerts: AlertRow[] = open.state.status === 'success' ? open.state.data.content : []

  return (
    <>
      <SectionCards items={institutionCards(summary.state.data)} />
      <div data-testid="institution-dashboard-grid" className="grid min-w-0 max-w-full items-stretch gap-4 @6xl:grid-cols-3">
        <section aria-labelledby="institution-chart-title" className="flex h-full min-h-0 min-w-0 max-w-full flex-col gap-4 rounded-xl border bg-card/35 p-3 @3xl:p-4 @6xl:col-span-2">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-1">
            <div>
              <h2 id="institution-chart-title" className="text-base font-semibold tracking-tight">기관 탐지 현황</h2>
              <p className="mt-1 text-xs text-muted-foreground">한 기간 선택이 아래 두 그래프에 함께 적용됩니다.</p>
            </div>
            <DateRangeButton value={range} onChange={setRange} today={today} />
          </div>
          {charts.state.status === 'error' && <ErrorBlock message={charts.state.message} onRetry={charts.retry} />}
          {charts.state.status === 'loading' && <LoadingBlock label="그래프" />}
          {charts.state.status === 'success' && <InstitutionCharts data={charts.state.data} />}
        </section>
        <section aria-label="AI Daily Report" className="h-full min-w-0 @6xl:col-span-1">
          <AiDailyReport summary={summary.state.data} openAlerts={openAlerts} />
        </section>
      </div>
      <section aria-labelledby="recent-title">
        <div className="mb-3">
          <h2 id="recent-title" className="text-base font-semibold tracking-tight">최근 유입 Alert</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">미처리 · 최신순</p>
        </div>
        {open.state.status === 'error' && <ErrorBlock message={open.state.message} onRetry={open.retry} />}
        {open.state.status === 'loading' && <LoadingBlock label="최근 Alert" />}
        {open.state.status === 'success' &&
          (openAlerts.length ? (
            <div className="space-y-2.5">{openAlerts.slice(0, 5).map(alert => <WorkCard key={alert.alertId} alert={alert} />)}</div>
          ) : (
            <EmptyBlock>미처리 Alert가 없습니다.</EmptyBlock>
          ))}
      </section>
    </>
  )
}

function InstitutionCharts({ data }: { data: DashboardData }) {
  const { composition, distribution } = chartInputs(data)
  const hasComposition = composition.some(item => item.value > 0)
  return (
    <>
      <div className="shrink-0">
        {data.dailyAlerts?.length ? <ChartAreaInteractive data={data.dailyAlerts} /> : <EmptyBlock>선택한 기간에 Alert가 없습니다.</EmptyBlock>}
      </div>
      <Card className="h-full min-h-0 min-w-0 max-w-full flex-1 gap-4 py-4 shadow-none" data-testid="transaction-pattern-hierarchy">
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
