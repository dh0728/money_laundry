import type { ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { DateRangeButton } from '@/components/DateRangeButton'
import { Box, Heading, Text } from '@/components/layout-primitives'

/** fe/work 기관 대시보드의 배치. mock/live에서 동일하게 사용한다. */
export function InstitutionLayout({ cards, range, onRange, today, charts, report, children }: {
  cards: ReactNode; range?: DateRange; onRange: (range?: DateRange) => void; today: Date
  charts: ReactNode; report: ReactNode; children?: ReactNode
}) {
  return <>{cards}<Box data-testid="institution-dashboard-grid" className="grid min-w-0 max-w-full items-stretch gap-4 @6xl:grid-cols-3">
    <Box as="section" aria-labelledby="institution-chart-title" className="flex min-h-0 min-w-0 max-w-full flex-col gap-4 rounded-xl border bg-card/35 p-3 @3xl:p-4 @6xl:col-span-2">
      <Box className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-1"><Box><Heading id="institution-chart-title" className="text-base font-semibold tracking-tight">기관 탐지 현황</Heading><Text className="mt-1 text-xs text-muted-foreground">선택한 기간의 탐지와 처리 현황</Text></Box><DateRangeButton value={range} onChange={onRange} today={today} /></Box>
      {charts}
    </Box><Box as="section" aria-label="RDR 9000 Daily Report" className="min-h-0 min-w-0 @6xl:relative @6xl:col-span-1">
      <Box className="min-h-0 @6xl:absolute @6xl:inset-0">{report}</Box>
    </Box>
  </Box>{children}</>
}
