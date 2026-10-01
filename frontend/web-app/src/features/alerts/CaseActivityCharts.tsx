import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { BarList, Panel } from './DetailPanels'

export type ActivityAmounts = Record<string, { daily: { day: string; amount: number }[]; senders: { name: string; v: number }[] }>
const ALL = '__all__'
export function CaseActivityCharts({ amounts, dailyUsdByCurrency }: { amounts: ActivityAmounts; dailyUsdByCurrency?: Record<string, { day: string; amount: number }[]> | null }) {
  const currencies = Object.keys(amounts).sort()
  const [selected, setSelected] = useState(ALL)
  const all = currencies.length > 1 && (selected === ALL || !currencies.includes(selected))
  const currency = all ? ALL : currencies.includes(selected) ? selected : currencies[0] ?? ''
  const data = amounts[currency] ?? { daily: [], senders: [] }
  const series = currencies.map((label, index) => ({ key: `currency${index}`, label, color: `hsl(${[...label].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0) % 360} 65% 55%)` }))
  const days = new Map<string, Record<string, string | number>>()
  for (const { key, label } of series) for (const row of dailyUsdByCurrency?.[label] ?? []) {
    const day = days.get(row.day) ?? { day: row.day }
    day[key] = Number(day[key] ?? 0) + row.amount
    days.set(row.day, day)
  }
  const stacked = [...days.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))).map(row => ({ ...Object.fromEntries(series.map(s => [s.key, 0])), ...row }))
  const unit = all ? 'USD' : currency
  const config = all ? Object.fromEntries(series.map(s => [s.key, { label: s.label, color: s.color }])) : { amount: { label: unit, color: 'var(--muted-foreground)' } }
  const format = (value: number) => `${Number(value).toLocaleString('ko-KR')} ${unit}`
  const peak = data.daily.reduce((best, row, index) => row.amount > (data.daily[best]?.amount ?? 0) ? index : best, 0)
  return <div className="space-y-2">
    {currencies.length > 1 && <label className="flex items-center gap-2 text-xs">금액 차트 통화<select aria-label="금액 차트 통화" className="rounded-md border bg-background p-2" value={currency} onChange={event => setSelected(event.target.value)}><option value={ALL}>전체 (USD 환산)</option>{currencies.map(value => <option key={value}>{value}</option>)}</select></label>}
    <div className="grid items-stretch gap-4 @4xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
      <Panel title="일별 거래 금액" description={`언제 집중됐는지 · ${all ? '전체 · USD 환산' : currency || '집계 없음'}`}>
        {(all ? stacked.length : data.daily.length) ? <ChartContainer config={config} className="h-[170px] w-full">
          <BarChart data={all ? stacked : data.daily} margin={{ left: 0, right: 4, top: 6 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} />
            <YAxis width={70} tickLine={false} axisLine={false} fontSize={10} tickFormatter={value => Number(value).toLocaleString('ko-KR')} />
            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.35 }} content={<ChartTooltipContent labelFormatter={(label, payload) => all ? `${label} · 합계 ${format(payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0))}` : label} formatter={(value, name) => all ? `${name} · ${format(Number(value))}` : format(Number(value))} hideIndicator={!all} />} />
            {all ? series.map(s => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="usd" fill={s.color} />) : <Bar dataKey="amount" radius={3}>{data.daily.map((row, index) => <Cell key={row.day} fill={index === peak ? 'var(--foreground)' : 'var(--muted-foreground)'} />)}</Bar>}
            {all && <ChartLegend content={<ChartLegendContent />} />}
          </BarChart>
        </ChartContainer> : <p className="text-xs text-muted-foreground">{all && dailyUsdByCurrency == null ? 'USD 환산액 미제공' : '일별 금액 집계 없음'}</p>}
      </Panel>
      <Panel title="상위 송금 계좌" description={`자금이 어디서 나갔는지 · ${all ? '전체 · 통화별' : currency}`}>
        {all ? <div className="max-h-64 space-y-4 overflow-y-auto">{currencies.map(value => <section key={value}><p className="mb-2 text-xs font-medium">{value}</p>{amounts[value].senders.length ? <BarList rows={amounts[value].senders} format={amount => `${Number(amount).toLocaleString('ko-KR')} ${value}`} /> : <p className="text-xs text-muted-foreground">송금 계좌 집계 없음</p>}</section>)}</div> : data.senders.length ? <BarList rows={data.senders} format={format} /> : <p className="text-xs text-muted-foreground">송금 계좌 집계 없음</p>}
      </Panel>
    </div>
  </div>
}
