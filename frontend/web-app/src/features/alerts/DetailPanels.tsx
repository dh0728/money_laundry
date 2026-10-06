import type { ReactNode } from 'react'
import { SectionTitle } from '@/components/page'
import { Card, CardContent } from '@/components/ui/card'
import { card, content } from './detailText'
import { usd } from './metrics'

export function BarList({ rows }: { rows: { name: string; v: number }[] }) {
  const max = Math.max(...rows.map(r => r.v), 1)
  return (
    <div className="grid grid-cols-[minmax(0,max-content)_max-content_minmax(60px,1fr)] items-center gap-x-3 gap-y-3 text-xs">
      {rows.map(r => (
        <div key={r.name} className="contents">
          <span className="max-w-24 truncate font-mono text-[11px]">{r.name}</span>
          <span className="text-right tabular-nums">{usd(r.v)}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground" style={{ width: `${(r.v / max) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  )
}

export const Panel = ({ title, description, children, testId, action }: { title: string; description?: string; children: ReactNode; testId?: string; action?: ReactNode }) => (
  <Card className={card} data-testid={testId}><CardContent className={content}><div className="flex items-start justify-between gap-3"><SectionTitle title={title} description={description} />{action}</div>{children}</CardContent></Card>
)
