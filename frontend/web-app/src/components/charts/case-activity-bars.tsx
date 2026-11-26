import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { readChartNumber } from './chart-design-values'
import { dataSeriesColors } from './charts/chart-context'

type ActivitySeries = { key: string; label: string; color: string }

export function CaseActivityBars({ rows, series, unit, format }: {
  rows: Record<string, string | number>[]
  series?: ActivitySeries[]
  unit: string
  format: (value: number) => string
}) {
  const [design] = useState(() => ({
    rightInset: readChartNumber('--aml-space-4', 4),
    topInset: readChartNumber('--aml-space-6', 6),
    axisFontSize: readChartNumber('--case-activity-axis-font-size', 10),
    valueAxisWidth: readChartNumber('--case-activity-value-axis-width', 70),
    tooltipCursorOpacity: readChartNumber('--case-activity-tooltip-cursor-opacity', 0.35),
    barRadius: readChartNumber('--case-activity-bar-radius', 3),
    gridDash: readChartNumber('--case-activity-grid-dash', 3),
  }))
  const config = series ? Object.fromEntries(series.map(({ key, label, color }) => [key, { label, color }]))
    : { amount: { label: unit, color: dataSeriesColors.sky } }
  const peak = series ? 0 : rows.reduce((best, row, index) => Number(row.amount) > Number(rows[best]?.amount ?? 0) ? index : best, 0)

  return <ChartContainer config={config} className="h-(--case-activity-chart-height) w-full">
    <BarChart data={rows} margin={{ left: 0, right: design.rightInset, top: design.topInset }}>
      <CartesianGrid vertical={false} strokeDasharray={`${design.gridDash} ${design.gridDash}`} />
      <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={design.axisFontSize}
        tickFormatter={day => {
          const [month, date] = String(day).split('-')
          return date ? `${Number(month)}월 ${Number(date)}일` : String(day)
        }} />
      <YAxis width={design.valueAxisWidth} tickLine={false} axisLine={false} fontSize={design.axisFontSize}
        tickFormatter={value => Number(value).toLocaleString('ko-KR')} />
      <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: design.tooltipCursorOpacity }}
        content={<ChartTooltipContent hideIndicator={!series}
          labelFormatter={(label, payload) => series ? `${label} · 합계 ${format(payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0))}` : label}
          formatter={(value, name) => series ? `${name} · ${format(Number(value))}` : format(Number(value))} />} />
      {series ? series.map(({ key, label, color }) => <Bar key={key} dataKey={key} name={label} stackId="usd" fill={color} />)
        : <Bar dataKey="amount" radius={design.barRadius}>
          {rows.map((row, index) => <Cell key={row.day} fill={index === peak ? dataSeriesColors.sky : dataSeriesColors.pink} />)}
        </Bar>}
      {series && <ChartLegend content={<ChartLegendContent />} />}
    </BarChart>
  </ChartContainer>
}
