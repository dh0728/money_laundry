import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { BarList, Panel } from './DetailPanels'

export type ActivityAmounts = Record<string, { daily: { day: string; amount: number }[]; senders: { name: string; v: number }[] }>
const ALL = '__all__'
export function CaseActivityCharts({ amounts, dailyUsd }: { amounts: ActivityAmounts; dailyUsd?: { day: string; amount: number }[] | null }) {
  const currencies = Object.keys(amounts).sort()
  const [selected, setSelected] = useState('')
  const all = selected === ALL && currencies.length > 1
  const currency = all ? ALL : currencies.includes(selected) ? selected : currencies[0] ?? ''
  const data = all ? { daily: dailyUsd ?? [], senders: [] } : amounts[currency] ?? { daily: [], senders: [] }
  const unit = all ? 'USD' : currency
  const config = { amount: { label: unit, color: 'var(--muted-foreground)' } }
  const format = (value: number) => `${Number(value).toLocaleString('ko-KR')} ${unit}`
  const peak = data.daily.reduce((best, row, index) => row.amount > (data.daily[best]?.amount ?? 0) ? index : best, 0)
  return <div className="space-y-2">
    {currencies.length > 1 && <label className="flex items-center gap-2 text-xs">금액 차트 통화<select aria-label="금액 차트 통화" className="rounded-md border bg-background p-2" value={currency} onChange={event => setSelected(event.target.value)}><option value={ALL}>전체 (USD 환산)</option>{currencies.map(value => <option key={value}>{value}</option>)}</select></label>}
    <div className="grid items-stretch gap-4 @4xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
      <Panel title="일별 거래 금액" description={`언제 집중됐는지 · ${all ? '전체 · USD 환산' : currency || '집계 없음'}`}>
        {data.daily.length ? <ChartContainer config={config} className="h-[170px] w-full">
          <BarChart data={data.daily} margin={{ left: 0, right: 4, top: 6 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} />
            <YAxis width={70} tickLine={false} axisLine={false} fontSize={10} tickFormatter={value => Number(value).toLocaleString('ko-KR')} />
            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.35 }} content={<ChartTooltipContent formatter={value => format(Number(value))} hideIndicator />} />
            <Bar dataKey="amount" radius={3}>{data.daily.map((row, index) => <Cell key={row.day} fill={index === peak ? 'var(--foreground)' : 'var(--muted-foreground)'} />)}</Bar>
          </BarChart>
        </ChartContainer> : <p className="text-xs text-muted-foreground">{all && dailyUsd == null ? 'USD 환산액 미제공' : '일별 금액 집계 없음'}</p>}
      </Panel>
      <Panel title="상위 송금 계좌" description={`자금이 어디서 나갔는지 · ${all ? '전체 · 통화별' : currency}`}>
        {all ? <div className="max-h-64 space-y-4 overflow-y-auto">{currencies.map(value => <section key={value}><p className="mb-2 text-xs font-medium">{value}</p>{amounts[value].senders.length ? <BarList rows={amounts[value].senders} format={amount => `${Number(amount).toLocaleString('ko-KR')} ${value}`} /> : <p className="text-xs text-muted-foreground">송금 계좌 집계 없음</p>}</section>)}</div> : data.senders.length ? <BarList rows={data.senders} format={format} /> : <p className="text-xs text-muted-foreground">송금 계좌 집계 없음</p>}
      </Panel>
    </div>
  </div>
}
