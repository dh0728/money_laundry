import { AgeBadge, PatternBadge, RiskBadge } from '@/components/badges'
import type { WorkItem } from './workItems'

// 대시보드 업무 카드. ID(A-·E-)가 종류를 알려 주므로 종류 태그는 두지 않는다.
// 색이 있는 경과일·위험 점수는 ID 줄 오른쪽에, 무채색 패턴 태그는 맨 아래 줄에 따로 묶는다.
// 누르면 해당 Alert·Episode 상세로 간다.
export function WorkCard({ item }: { item: Pick<WorkItem, 'kind' | 'href' | 'code' | 'riskScore' | 'ageDays' | 'summary' | 'types'> }) {
  return (
    <a
      href={item.href}
      aria-label={`${item.code} 상세 보기`}
      data-testid="work-card"
      data-kind={item.kind}
      className="flex flex-col gap-2 rounded-lg border bg-card px-5 py-4 interactive-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm">{item.code}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <AgeBadge days={item.ageDays} />
          <RiskBadge score={item.riskScore} />
        </span>
      </span>
      <span className="block truncate text-sm text-muted-foreground">{item.summary}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        {item.types.map(code => <PatternBadge key={code} code={code} />)}
      </span>
    </a>
  )
}
