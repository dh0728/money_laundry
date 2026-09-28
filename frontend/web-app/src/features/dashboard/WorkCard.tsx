import type { AlertRow } from '@/api/alerts'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { alertSummary } from './alertText'

const ageText = (days: number) => (days === 0 ? '오늘 탐지' : `${days}일 경과`)

// Alert 상세 화면이 생기기 전이라 카드는 아직 누를 수 없다.
export function WorkCard({ alert }: { alert: AlertRow }) {
  return (
    <article data-testid="work-card" className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border bg-card px-5 py-4">
      <span className="min-w-0">
        <span className="block font-mono text-xs text-muted-foreground">A-{alert.alertId}</span>
        <span className="mt-1.5 block truncate text-sm">{alertSummary(alert)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <PatternBadge code={alert.primaryType.code} />
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{alert.assignee.name} · {ageText(alert.ageDays)}</span>
        </span>
      </span>
      <RiskBadge score={alert.riskScore} />
    </article>
  )
}
