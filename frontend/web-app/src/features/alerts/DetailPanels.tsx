import type { ReactNode } from 'react'
import { SectionTitle } from '@/components/page'
import { Card, CardContent } from '@/components/ui/card'
import { card, content } from './detailText'
import { usd } from './metrics'

export function BarList({ rows }: { rows: { name: string; v: number }[] }) {
  const max = Math.max(...rows.map(r => r.v), 1)
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_72px_minmax(60px,1.1fr)] items-center gap-3 text-xs">
          <span className="truncate font-mono text-[11px]">{r.name}</span>
          <span className="text-right tabular-nums">{usd(r.v)}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${i === 0 ? 'bg-foreground' : 'bg-muted-foreground/60'}`} style={{ width: `${(r.v / max) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  )
}

export const Panel = ({ title, description, children, testId }: { title: string; description?: string; children: ReactNode; testId?: string }) => (
  <Card className={card} data-testid={testId}><CardContent className={content}><SectionTitle title={title} description={description} />{children}</CardContent></Card>
)
