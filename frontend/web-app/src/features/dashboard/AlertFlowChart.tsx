// 기관 전체 "일별 Alert 유입과 처리 상태". 그날 들어온 Alert를 지금 처리 상태(처리 전·중·완료)로 나눠 쌓는다.
// 색은 상태 태그와 같은 초록·파랑·보라다. 기간은 대시보드의 DateRangeButton이 정한다.
import { Bar, BarChart, Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { DashboardRequested } from '@/api/dashboard'
import { ProvenanceBadge } from '@/components/Provenance'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { fmt } from '@/lib/format'
import { workStatusLabels } from '@/lib/workStatus'

export type DailyStatus = DashboardRequested['dailyAlertStatus'][number]

const series = [
  { key: 'pending', label: workStatusLabels.PENDING, color: 'var(--status-pending)' },
  { key: 'inProgress', label: workStatusLabels.IN_PROGRESS, color: 'var(--status-working)' },
  { key: 'done', label: workStatusLabels.DONE, color: 'var(--status-closed)' },
] as const

const chartConfig = Object.fromEntries(series.map(s => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig

const md = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

function StatusTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: DailyStatus }[]; label?: string }) {
  const day = active ? payload?.[0]?.payload : undefined
  if (!day) return null
  const total = day.pending + day.inProgress + day.done
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{md(String(label))} · 유입 {fmt(total)}건</p>
      {series.map(s => (
        <p key={s.key} className="flex items-center gap-2">
          <i className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="ml-auto font-mono tabular-nums">{fmt(day[s.key])}</span>
        </p>
      ))}
    </div>
  )
}

export function StatusLegend() {
  return (
    <div className="flex items-center justify-center gap-5 pt-3 text-xs text-muted-foreground" data-testid="status-legend">
      {series.map(s => <span key={s.key} className="inline-flex items-center gap-2"><i className="size-2.5 rounded-[2px]" style={{ background: s.color }} aria-hidden />{s.label}</span>)}
    </div>
  )
}

export function AlertStatusChart({ data }: { data: DailyStatus[] }) {
  return (
    <Card className="@container/card min-w-0 max-w-full shadow-none" data-testid="alert-flow-chart">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>일별 Alert 유입과 처리 상태</CardTitle>
          <ProvenanceBadge kind="proposal" title="일별 처리 상태 집계는 API 계약에 없어 Backend에 요청할 항목입니다." />
        </div>
        <CardDescription>그날 들어온 Alert가 지금 어느 단계에 있는지 · 막대 전체 = 유입 건수</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-2 pt-2 sm:px-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full min-w-0 max-w-full">
          <BarChart accessibilityLayer data={data} barCategoryGap="18%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={md} />
            <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: .5 }} content={<StatusTooltip />} />
            {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="status" fill={s.color} radius={i === series.length - 1 ? [3, 3, 0, 0] : 0} />)}
          </BarChart>
        </ChartContainer>
        <StatusLegend />
      </CardContent>
    </Card>
  )
}

/** 실제 API는 날짜별 유입·종결 건수를 준다. 상태별 잔량으로 재해석하지 않는다. */
export function AlertDailyFlowChart({ data }: { data: { day: string; incoming: number; completed: number }[] }) {
  return <Card className="@container/card min-w-0 max-w-full shadow-none" data-testid="alert-flow-chart"><CardHeader><CardTitle>일별 Alert 유입과 종결</CardTitle><CardDescription>각 날짜의 신규 유입과 종결 건수</CardDescription></CardHeader><CardContent>
    <ChartContainer className="h-[260px] w-full" config={{ incoming: { label: '유입', color: 'var(--status-pending)' }, completed: { label: '종결', color: 'var(--status-closed)' } }}>
      <LineChart data={data} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="day" tickFormatter={md} /><YAxis allowDecimals={false} /><ChartTooltip content={<ChartTooltipContent />} /><Line dataKey="incoming" stroke="var(--status-pending)" dot={false} /><Line dataKey="completed" stroke="var(--status-closed)" dot={false} /></LineChart>
    </ChartContainer><p className="text-center text-xs text-muted-foreground">유입 · 종결</p>
  </CardContent></Card>
}
