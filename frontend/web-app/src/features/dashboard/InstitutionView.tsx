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
import { Skeleton } from '@/components/ui/skeleton'
import { useAsync } from '@/lib/useAsync'
import { EpisodeWork } from './EpisodeWork'
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
  const openAlerts = work.state.status === 'success' ? work.state.data.alerts.filter(row => row.status === 'OPEN') : []

  return (
    <>
      <InstitutionLayout cards={remote?.cards ?? (summary.state.status === 'success' ? <SectionCards items={institutionCards(summary.state.data)} /> : <KpiSkeleton />)} range={remote ? remote.range : range} onRange={remote?.onRange ?? setRange} today={today}
        charts={remote?.charts ?? <>{charts.state.status === 'error' && <ErrorBlock message={charts.state.message} onRetry={charts.retry} />}{charts.state.status === 'loading' && <LoadingBlock label="그래프" />}{charts.state.status === 'success' && <InstitutionCharts data={charts.state.data} />}</>}
        report={remote?.report ?? (summary.state.status === 'success' && <AiDailyReport summary={summary.state.data} openAlerts={openAlerts} />)} />
      {remote ? remote.queue : work.state.status === 'error' ? <ErrorBlock message={work.state.message} onRetry={work.retry} /> : work.state.status === 'loading' ? <LoadingBlock label="Episode 업무" /> : <EpisodeWork episodes={work.state.data.episodes} today={today} />}
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
          <SectionTitle title="의심 거래 구성과 패턴 분포" description="전체 구성은 거래 건, 패턴별 유형은 패턴 소속 거래의 Alert 수" action={<a href="#suspicious" className="shrink-0 text-xs underline-offset-4 hover:underline">의심 거래 목록 →</a>} />
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

/** §1.5: 틀은 바로 그리고 값 자리만 낮은 대비 skeleton(페이지 전체를 로딩 문구로 바꾸지 않는다) */
function KpiSkeleton() {
  return <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4" aria-busy="true">{['오늘 신규 Alert', '오늘 의심 거래 탐지율', '열린 Alert', '조사 중 Episode'].map(l => <Card key={l} className="shadow-none"><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{l}</p><Skeleton className="h-8 w-20" /><Skeleton className="h-4 w-32" /></CardContent></Card>)}</div>
}
