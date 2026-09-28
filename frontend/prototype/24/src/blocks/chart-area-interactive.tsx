// shadcn Chart 기반. 기간은 Dashboard의 단일 DateRangeButton이 소유하고, 이 컴포넌트는 이미 필터된 데이터만 그린다.
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

export type DailyFlow = { date: string; inflow: number; closed: number }

export const dashboardChartTones = {
  primary: 'var(--foreground)',
  secondary: 'var(--muted-foreground)',
  active: 'var(--foreground)',
} as const

const chartConfig = {
  inflow: { label: '유입 Alert', color: dashboardChartTones.primary },
  closed: { label: '처리 완료', color: dashboardChartTones.secondary },
} satisfies ChartConfig

const md = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

export function AlertFlowCursor({ points, height = 0 }: { points?: Array<{ x?: number; y?: number }>; height?: number }) {
  const x = points?.[0]?.x
  if (typeof x !== 'number') return null
  return <line data-testid="alert-flow-hover-line" x1={x} x2={x} y1={0} y2={height} stroke={dashboardChartTones.active} strokeWidth={1.5} pointerEvents="none" />
}

export function AlertFlowLegend() {
  return <div className="flex items-center justify-center gap-5 pt-3 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-2"><i data-line-style="dashed" className="w-5 border-t-2 border-dashed" style={{ borderColor: dashboardChartTones.primary }} aria-hidden />유입 Alert</span>
    <span className="inline-flex items-center gap-2"><i data-line-style="solid" className="w-5 border-t-2" style={{ borderColor: dashboardChartTones.secondary }} aria-hidden />처리 완료</span>
  </div>
}

export function ChartAreaInteractive({ data }: { data: DailyFlow[] }) {
  return (
    <Card className="@container/card min-w-0 max-w-full" data-testid="alert-flow-chart">
      <CardHeader>
        <CardTitle>일별 Alert 유입·처리</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">유입과 처리 완료 건수 추이</span>
          <span className="@[540px]/card:hidden">유입·처리 추이</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] min-w-0 max-w-full w-full">
          <AreaChart accessibilityLayer data={data}>
            <defs>
              <linearGradient id="fillInflow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-inflow)" stopOpacity={1.0} />
                <stop offset="95%" stopColor="var(--color-inflow)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="fillClosed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-closed)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-closed)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={md} />
            <ChartTooltip cursor={<AlertFlowCursor />} content={<ChartTooltipContent labelFormatter={value => md(String(value))} indicator="dot" />} />
            <Area dataKey="closed" name="처리 완료" type="natural" fill="url(#fillClosed)" stroke="var(--color-closed)" strokeWidth={2.5} activeDot={false} />
            <Area dataKey="inflow" name="유입 Alert" type="natural" fill="url(#fillInflow)" stroke="var(--color-inflow)" strokeWidth={2} strokeDasharray="5 3" activeDot={false} />
            <ChartLegend content={<AlertFlowLegend />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
