import type { CSSProperties, ReactNode } from 'react'
import { SectionTitle } from '@/components/page'
import { Card, CardContent } from '@/components/ui/card'
import { card, content } from './detailText'
import { usd } from './metrics'
import { Box, Text } from '@/components/layout-primitives'
import { dataSeriesColors } from '@/components/charts/charts/chart-context'

export function BarList({ rows, format = usd }: { rows: { name: string; v: number }[]; format?: (value: number) => string }) {
  const max = Math.max(...rows.map(r => r.v), 1)
  return (
    <Box className="grid grid-cols-(--alert-amount-breakdown-columns) items-center gap-x-3 gap-y-3 text-xs">
      {rows.map(r => (
        <Box key={r.name} className="contents">
          <Text as="span" title={r.name} className="max-w-24 truncate font-mono text-2xs">{r.name}</Text>
          <Text as="span" className="text-right tabular-nums">{format(r.v)}</Text>
          <Text as="span" className="h-2 overflow-hidden rounded-full bg-muted">
            <Text as="span" className="block h-full w-(--alert-amount-breakdown-width) rounded-full bg-(color:--alert-amount-breakdown-fill)" style={{
              '--alert-amount-breakdown-width': `${(r.v / max) * 100}%`,
              '--alert-amount-breakdown-fill': dataSeriesColors.sky,
            } as CSSProperties} />
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export const Panel = ({ title, description, children, testId, action }: { title: ReactNode; description?: string; children: ReactNode; testId?: string; action?: ReactNode }) => (
  <Card className={card} data-testid={testId}><CardContent className={content}><Box className="flex items-start justify-between gap-3"><SectionTitle title={title} description={description} />{action}</Box>{children}</CardContent></Card>
)


export function OverviewPanels({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return <Box className={columns === 3 ? 'grid items-stretch gap-4 @3xl:grid-cols-3' : 'grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-4 [&>[data-slot=card]]:h-auto [&>[data-slot=card]>[data-slot=card-content]]:h-auto'}>{children}</Box>
}
