import { useState, type ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { readChartNumber } from './chart-design-values'

export function AlertStatusBars<Key extends string>({ data, series, formatDay, tooltip }: {
  data: ({ date: string } & Record<Key, number>)[]
  series: readonly { key: Key; label: string; color: string }[]
  formatDay: (day: string) => string
  tooltip: ReactElement
}) {
  const [design] = useState(() => ({
    categoryGap: readChartNumber('--alert-status-category-gap', 18),
    tickMargin: readChartNumber('--aml-space-8', 8),
    tickGap: readChartNumber('--alert-status-axis-tick-gap', 28),
    axisWidth: readChartNumber('--alert-status-value-axis-width', 36),
    cursorOpacity: readChartNumber('--alert-status-cursor-opacity', 0.5),
    barRadius: readChartNumber('--alert-status-bar-top-radius', 3),
  }))
  const config = Object.fromEntries(series.map(({ key, label, color }) => [key, { label, color }]))

  return <ChartContainer config={config} className="aspect-auto h-(--alert-status-chart-height) w-full min-w-0 max-w-full">
    <BarChart accessibilityLayer data={data} barCategoryGap={`${design.categoryGap}%`}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={design.tickMargin} minTickGap={design.tickGap} tickFormatter={formatDay} />
      <YAxis width={design.axisWidth} tickLine={false} axisLine={false} allowDecimals={false} />
      <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: design.cursorOpacity }} content={tooltip} />
      {series.map(({ key, label, color }, index) => (
        <Bar key={key} dataKey={key} name={label} stackId="status" fill={color}
          radius={index === series.length - 1 ? [design.barRadius, design.barRadius, 0, 0] : 0} />
      ))}
    </BarChart>
  </ChartContainer>
}
