import { useState } from 'react'
import { BarList, Panel } from './DetailPanels'
import { Box, Text } from '@/components/layout-primitives'
import { NativeSelect } from '@/components/ui/select'
import { CaseActivityBars } from '@/components/charts/case-activity-bars'
import { dataSeriesPalette } from '@/components/charts/charts/chart-context'

export type ActivityAmounts = Record<string, { daily: { day: string; amount: number }[]; senders: { name: string; v: number }[] }>
const ALL = '__all__'
export function CaseActivityCharts({ amounts, dailyUsdByCurrency }: { amounts: ActivityAmounts; dailyUsdByCurrency?: Record<string, { day: string; amount: number }[]> | null }) {
  const currencies = Object.keys(amounts).sort()
  const [selected, setSelected] = useState(ALL)
  const all = currencies.length > 1 && (selected === ALL || !currencies.includes(selected))
  const currency = all ? ALL : currencies.includes(selected) ? selected : currencies[0] ?? ''
  const data = amounts[currency] ?? { daily: [], senders: [] }
  const series = currencies.map((label, index) => ({ key: `currency${index}`, label, color: dataSeriesPalette[index % dataSeriesPalette.length] }))
  const days = new Map<string, Record<string, string | number>>()
  for (const { key, label } of series) for (const row of dailyUsdByCurrency?.[label] ?? []) {
    const day = days.get(row.day) ?? { day: row.day }
    day[key] = Number(day[key] ?? 0) + row.amount
    days.set(row.day, day)
  }
  const stacked = [...days.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))).map(row => ({ ...Object.fromEntries(series.map(s => [s.key, 0])), ...row }))
  const unit = all ? 'USD' : currency
  const format = (value: number) => `${Number(value).toLocaleString('ko-KR')} ${unit}`
  const daily = all ? stacked : data.daily
  return <Box className="space-y-2">
    {currencies.length > 1 && <Box as="label" className="flex items-center gap-2 text-xs">금액 차트 통화<NativeSelect
      aria-label="금액 차트 통화" className="rounded-md border bg-background p-2" value={currency} onChange={event => setSelected(event.target.value)}
      options={[{ value: ALL, label: '전체 (USD 환산)' }, ...currencies.map(label => ({ label }))]} /></Box>}
    <Box className="grid items-stretch gap-4 @4xl:grid-cols-(--case-activity-grid-columns)">
      <Panel title="일별 거래 금액" description={`언제 집중됐는지 · ${all ? '전체 · USD 환산' : currency || '집계 없음'}`}>
        {daily.length ? <CaseActivityBars rows={daily} series={all ? series : undefined} unit={unit} format={format} />
          : <Text className="text-xs text-muted-foreground">{all && dailyUsdByCurrency == null ? 'USD 환산액 미제공' : '일별 금액 집계 없음'}</Text>}
      </Panel>
      <Panel title="상위 송금 계좌" description={`자금이 어디서 나갔는지 · ${all ? '전체 · 통화별' : currency}`}>
        {all ? <Box className="max-h-64 space-y-4 overflow-y-auto">{currencies.map(value => <Box as="section" key={value}><Text className="mb-2 text-xs font-medium">{value}</Text>{amounts[value].senders.length ? <BarList rows={amounts[value].senders} format={amount => `${Number(amount).toLocaleString('ko-KR')} ${value}`} /> : <Text className="text-xs text-muted-foreground">송금 계좌 집계 없음</Text>}</Box>)}</Box> : data.senders.length ? <BarList rows={data.senders} format={format} /> : <Text className="text-xs text-muted-foreground">송금 계좌 집계 없음</Text>}
      </Panel>
    </Box>
  </Box>
}
