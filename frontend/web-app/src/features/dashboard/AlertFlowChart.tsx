// 기관 전체 "일별 Alert 유입과 처리 상태". 그날 들어온 Alert를 지금 처리 상태(처리 전·중·완료)로 나눠 쌓는다.
// 단독 여부는 청록으로 구분하고, Episode 진행 중과 종결에는 상태 배지와 같은 파랑·초록을 쓴다.
import type { DashboardRequested } from '@/api/dashboard'
import { AlertStatusBars } from '@/components/charts/alert-status-bars'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmt } from '@/lib/format'
import { Box, Text } from '@/components/layout-primitives'

export type DailyStatus = DashboardRequested['dailyAlertStatus'][number]

const series = [
  // Q4(10/8 김명기): Episode 편입을 처리 단계로 부르지 않는다. 단독 Alert도 이상거래일 수 있다
  { key: 'pending', label: '진행 중 · 단독 Alert', color: 'var(--alert-standalone-series-accent)' },
  { key: 'inProgress', label: '진행 중 · Episode', color: 'var(--status-info-accent)' },
  { key: 'done', label: '종결', color: 'var(--status-positive-accent)' },
] as const

const md = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

function StatusTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: DailyStatus }[]; label?: string }) {
  const day = active ? payload?.[0]?.payload : undefined
  if (!day) return null
  const total = day.pending + day.inProgress + day.done
  return (
    <Box className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <Text className="font-medium">{md(String(label))} · 유입 {fmt(total)}건</Text>
      {series.map(s => (
        <Text key={s.key} className="flex items-center gap-2">
          <Text as="i" className="case-status-swatch size-2.5 shrink-0" data-series={s.key} aria-hidden />
          <Text as="span" className="text-muted-foreground">{s.label}</Text>
          <Text as="span" className="ml-auto font-mono tabular-nums">{fmt(day[s.key])}</Text>
        </Text>
      ))}
    </Box>
  )
}

export function StatusLegend() {
  return (
    <Box className="flex items-center justify-center gap-5 pt-3 text-xs text-muted-foreground" data-testid="status-legend">
      {series.map(s => <Text as="span" key={s.key} className="inline-flex items-center gap-2"><Text as="i" className="case-status-swatch size-2.5" data-series={s.key} aria-hidden />{s.label}</Text>)}
    </Box>
  )
}

export function AlertStatusChart({ data, unavailable = false }: { data: DailyStatus[]; unavailable?: boolean }) {
  return (
    <Card className="@container/card min-w-0 max-w-full shadow-none" data-testid="alert-flow-chart">
      <CardHeader>
        <Box className="flex flex-wrap items-center gap-2">
          <CardTitle>일별 Alert 유입과 현재 상태</CardTitle>
        </Box>
        <CardDescription>그날 들어온 Alert가 지금 어느 단계에 있는지 · 막대 전체 = 유입 건수</CardDescription>
        <Text className="text-xs text-muted-foreground">단독 Alert: Episode에 묶이지 않은 열린 Alert · Episode: 열린 Episode에 속한 Alert · 종결: 직접 종결 또는 Episode 종결</Text>
        {unavailable && <Text className="text-xs text-muted-foreground">상태별 일별 집계 API 미연결 · 데이터 준비 중</Text>}
      </CardHeader>
      <CardContent className="min-w-0 px-2 pt-2 sm:px-6">
        <AlertStatusBars data={data} series={series} formatDay={md} tooltip={<StatusTooltip />} />
        <StatusLegend />
        <Table className="sr-only" containerClassName="sr-only" aria-label="일별 Alert 현재 처리 상태 집계">
          <TableHeader><TableRow><TableHead>생성일</TableHead>{series.map(s => <TableHead key={s.key}>{s.label}</TableHead>)}<TableHead>유입</TableHead></TableRow></TableHeader>
          <TableBody>{data.map(day => <TableRow key={day.date}><TableHead scope="row">{day.date}</TableHead>{series.map(s => <TableCell key={s.key}>{day[s.key]}</TableCell>)}<TableCell>{day.pending + day.inProgress + day.done}</TableCell></TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

