// shadcn 공식 block `dashboard-01`의 chart-area-interactive를 그대로 가져왔다. 바뀐 것은 데이터·문구·날짜 locale, 그리고 유입·처리는 합계가 아니므로 stackId 제거, 두 계열 구분용 ChartLegend·accessibilityLayer 추가(web-design-guidelines 점검).
import * as React from 'react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type DailyFlow = { date: string; inflow: number; closed: number }

const chartConfig = {
  inflow: { label: '유입 Alert', color: 'var(--primary)' },
  // 겹쳐 그리므로 처리 완료는 명도를 달리한 semantic token으로 구분한다
  closed: { label: '처리 완료', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

const ranges = [
  { value: '90d', label: '최근 3개월', days: 90 },
  { value: '30d', label: '최근 30일', days: 30 },
  { value: '7d', label: '최근 7일', days: 7 },
]

const md = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

export function ChartAreaInteractive({ data, referenceDate }: { data: DailyFlow[]; referenceDate: string }) {
  const [timeRange, setTimeRange] = React.useState('30d')

  const filteredData = data.filter(item => {
    const days = ranges.find(r => r.value === timeRange)?.days ?? 30
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - days)
    return new Date(item.date) >= startDate
  })

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>일별 Alert 유입·처리</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">유입과 처리 완료 건수 추이 · 예시값(모델 팀 지표 확정 전)</span>
          <span className="@[540px]/card:hidden">유입·처리 추이</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup type="single" value={timeRange} onValueChange={v => v && setTimeRange(v)} variant="outline" className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex">
            {ranges.map(r => <ToggleGroupItem key={r.value} value={r.value}>{r.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden" size="sm" aria-label="기간 선택">
              <SelectValue placeholder="최근 30일" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectGroup>
                {ranges.map(r => <SelectItem key={r.value} value={r.value} className="rounded-lg">{r.label}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart accessibilityLayer data={filteredData}>
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
            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={value => md(String(value))} indicator="dot" />} />
            <Area dataKey="closed" type="natural" fill="url(#fillClosed)" stroke="var(--color-closed)" />
            <Area dataKey="inflow" type="natural" fill="url(#fillInflow)" stroke="var(--color-inflow)" />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
