import { useState, type ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { readChartNumber } from './chart-design-values'

export function AlertStatusBars<Key extends string>({ data, series, formatDay, tooltip, separated = false, reduced }: {
  data: ({ date: string } & Record<Key, number>)[]
  series: readonly { key: Key; label: string; color: string; stackId?: string }[]
  formatDay: (day: string) => string
  tooltip: ReactElement
  separated?: boolean
  reduced?: boolean
}) {
  const [design] = useState(() => ({
    categoryGap: readChartNumber('--alert-status-category-gap', 18),
    tickMargin: readChartNumber('--aml-space-8', 8),
    tickGap: readChartNumber('--alert-status-axis-tick-gap', 28),
    axisWidth: readChartNumber('--alert-status-value-axis-width', 36),
    barRadius: readChartNumber('--alert-status-bar-top-radius', 3),
    segmentGap: readChartNumber('--aml-space-2', 2),
    groupGap: readChartNumber('--aml-space-4', 4),
  }))
  const config = Object.fromEntries(series.map(({ key, label, color }) => [key, { label, color }]))

  return <ChartContainer config={config} className="aspect-auto h-(--alert-status-chart-height) w-full min-w-0 max-w-full">
    <BarChart accessibilityLayer data={data} barCategoryGap={`${design.categoryGap}%`} barGap={design.groupGap}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={design.tickMargin} minTickGap={design.tickGap} tickFormatter={formatDay} />
      <YAxis width={design.axisWidth} tickLine={false} axisLine={false} allowDecimals={false} />
      <ChartTooltip cursor={false} content={tooltip} />
      {series.map(({ key, label, color, stackId = 'status' }, index) => {
        const neighbors = series.slice(index + 1).filter(item => (item.stackId ?? 'status') === stackId)
        const segment = separated ? ({ x, y, width, height, payload }: BarShapeProps) => {
          const hasNext = neighbors.some(item => Number(payload?.[item.key]) > 0)
          const gap = hasNext ? Math.min(design.segmentGap, height / 2) : 0
          return <Rectangle x={x} y={y + gap} width={width} height={height - gap} fill={color}
            radius={Math.min(design.barRadius, width / 2, (height - gap) / 2)} />
        } : undefined
        return <Bar key={key} dataKey={key} name={label} stackId={stackId} fill={color} shape={segment}
          isAnimationActive={reduced ? false : undefined}
          radius={neighbors.length === 0 ? [design.barRadius, design.barRadius, 0, 0] : 0} />
      })}
    </BarChart>
  </ChartContainer>
}
