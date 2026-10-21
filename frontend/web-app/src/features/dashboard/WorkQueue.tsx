import type { ReactNode } from 'react'
import { WorkStatusBadge } from '@/components/badges'
import type { WorkStatus } from '@/lib/workStatus'

export function WorkQueue({ columns }: { columns: { status: WorkStatus | 'UNREAD'; count?: number; label?: string; content: ReactNode }[] }) {
  return <div className={`grid items-start gap-4 ${columns.length === 4 ? '@xl:grid-cols-2 @5xl:grid-cols-4' : '@3xl:grid-cols-3'}`} data-testid="work-queue">{columns.map(column => <div key={column.status} data-testid="work-status-column" className="flex min-w-0 flex-col gap-2.5">
    <div className="flex items-center gap-2">{column.label ? <span className="rounded-full border px-2 py-0.5 text-xs">{column.label}</span> : column.status !== 'UNREAD' ? <WorkStatusBadge status={column.status} /> : null}{column.count != null && <span className="text-xs tabular-nums text-muted-foreground">{column.count}건</span>}</div>{column.content}
  </div>)}</div>
}
