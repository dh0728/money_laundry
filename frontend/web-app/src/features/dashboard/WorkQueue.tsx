import type { ReactNode } from 'react'
import { WorkStatusBadge } from '@/components/badges'
import type { WorkStatus } from '@/lib/workStatus'
import { Box, Text } from '@/components/layout-primitives'

export function WorkQueue({ columns }: { columns: { status: WorkStatus; count?: number; label?: string; hint?: string; content: ReactNode }[] }) {
  const grid = columns.length === 4 ? '@3xl:grid-cols-2 @6xl:grid-cols-4' : '@3xl:grid-cols-3'
  return <Box className={`grid items-start gap-4 ${grid}`} data-testid="work-queue">{columns.map(column => <Box key={column.status} data-testid="work-status-column" className="flex min-w-0 flex-col gap-2.5">
    <Box className="flex items-center gap-2">{column.label ? <Text as="span" className="rounded-full border px-2 py-0.5 text-xs">{column.label}</Text> : <WorkStatusBadge status={column.status} />}{column.count != null && <Text as="span" className="text-xs tabular-nums text-muted-foreground">{column.count}건</Text>}</Box>
    {column.hint && <Text className="-mt-1 text-2xs text-muted-foreground">{column.hint}</Text>}{column.content}
  </Box>)}</Box>
}
