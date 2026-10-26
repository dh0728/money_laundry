import type { ReactNode } from 'react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { subDays } from 'date-fns'
import type { DashboardData } from '@/api/dashboard'
import { InstitutionLayout } from './DashboardPresentation'
import { SectionTitle } from '@/components/page'
import { SectionCards } from '@/components/SectionCards'
import { Card, CardContent } from '@/components/ui/card'
import { isoDate } from '@/lib/format'
import { AiDailyReport } from './AiDailyReport'
import { AlertStatusChart } from './AlertFlowChart'
import { loadInstitutionWork, loadDashboard } from './dataSource'
import { chartInputs, institutionCards } from './metrics'
import { TransactionPatternHierarchy } from './PatternRelation'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { useAsync } from '@/lib/useAsync'
import { WorkCard } from './WorkCard'
import { sortWork, workItems } from './workItems'
import { WorkQueue } from './WorkQueue'
import { workStatuses } from '@/lib/workStatus'
import { useAlertOverrides } from '@/features/alerts/alertOverrides'

export type InstitutionRemote = {
  cards: ReactNode; charts: ReactNode; report: ReactNode
  queue: ReactNode
  range?: DateRange; onRange: (range?: DateRange) => void
}
export function InstitutionView({ today, remote }: { today: Date; remote?: InstitutionRemote }) {
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(today, 29), to: today })
  const kpiRange = { from: isoDate(subDays(today, 59)), to: isoDate(today) }
  const chartRange = { from: range?.from && isoDate(range.from), to: range?.to && isoDate(range.to) }
  const summary = useAsync(() => loadDashboard(kpiRange), [kpiRange.from, kpiRange.to], { enabled: !remote })
  const charts = useAsync(() => loadDashboard(chartRange), [chartRange.from, chartRange.to], { enabled: !remote })
  const [overrides] = useAlertOverrides()
  const work = useAsync(() => loadInstitutionWork(overrides), [overrides], { enabled: !remote })

  if (!remote && summary.state.status === 'error') return <ErrorBlock message={summary.state.message} onRetry={summary.retry} />
  if (!remote && summary.state.status === 'loading') return <LoadingBlock label="기관 지표" />
  const openAlerts = work.state.status === 'success' ? work.state.data.alerts.filter(row => row.status === 'OPEN') : []
  const items = work.state.status === 'success' ? workItems(work.state.data.alerts, work.state.data.episodes) : []

  return (
    <>
      <InstitutionLayout cards={remote?.cards ?? (summary.state.status === 'success' && <SectionCards items={institutionCards(summary.state.data)} />)} range={remote ? remote.range : range} onRange={remote?.onRange ?? setRange} today={today}
        charts={remote?.charts ?? <>{charts.state.status === 'error' && <ErrorBlock message={charts.state.message} onRetry={charts.retry} />}{charts.state.status === 'loading' && <LoadingBlock label="그래프" />}{charts.state.status === 'success' && <InstitutionCharts data={charts.state.data} />}</>}
        report={remote?.report ?? (summary.state.status === 'success' && <AiDailyReport summary={summary.state.data} openAlerts={openAlerts} />)} />
      <section aria-labelledby="institution-queue-title">
        <h2 id="institution-queue-title" className="text-base font-semibold tracking-tight">업무 현황</h2>
        <p className="mt-1.5 mb-3 text-xs text-muted-foreground">기관 전체 · Alert·Episode 상태별 · 위험 점수 높은 순</p>
        {remote ? remote.queue : work.state.status === 'error' ? <ErrorBlock message={work.state.message} onRetry={work.retry} /> : work.state.status === 'loading' ? <LoadingBlock label="기관 전체 업무" /> : <WorkQueue columns={workStatuses.map(status => {
          const column = sortWork(items.filter(item => item.status === status), 'risk')
          return { status, label: status === 'PENDING' ? '열린 Alert' : status === 'IN_PROGRESS' ? '열린 Episode' : undefined, count: column.length,
            content: column.length ? column.map(item => <WorkCard key={`${item.kind}-${item.id}`} item={item} />) : <EmptyBlock>해당 상태 업무가 없습니다.</EmptyBlock> }
        })} />}
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
