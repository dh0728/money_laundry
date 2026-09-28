import { AgeBadge, PatternBadge, RiskBadge } from '@/components/badges'
import { Badge } from '@/components/ui/badge'
import type { WorkItem } from './workItems'

// 대시보드 업무 카드. 글은 ID와 개수·금액 요약만 두고, 종류·패턴·경과일·위험 점수는 태그로 보인다.
// 누르면 해당 Alert·Episode 상세로 간다.
export function WorkCard({ item }: { item: WorkItem }) {
  return (
    <a
      href={item.href}
      aria-label={`${item.code} 상세 보기`}
      data-testid="work-card"
      data-kind={item.kind}
      className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 rounded-lg border bg-card px-5 py-4 interactive-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <Badge variant="outline" className="semantic-metadata-badge font-normal">{item.kind}</Badge>
          <span className="font-mono text-sm">{item.code}</span>
        </span>
        <span className="mt-1.5 block truncate text-sm text-muted-foreground">{item.summary}</span>
      </span>
      <RiskBadge score={item.riskScore} />
      <span className="col-span-2 flex flex-wrap items-center gap-1.5">
        {item.types.map(code => <PatternBadge key={code} code={code} />)}
        <AgeBadge days={item.ageDays} />
      </span>
    </a>
  )
}
