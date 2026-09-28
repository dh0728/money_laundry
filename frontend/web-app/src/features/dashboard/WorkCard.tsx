import type { AlertRow } from '@/api/alerts'
import { hrefFor } from '@/app/navigation'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { alertSummary } from './alertText'

const ageText = (days: number) => (days === 0 ? '오늘 탐지' : `${days}일 경과`)

// 카드를 누르면 Alert 상세로 간다(시연 경로: 대시보드 → Alert 상세)
export function WorkCard({ alert }: { alert: AlertRow }) {
  return (
    <a href={hrefFor('alerts', alert.alertId)} aria-label={`A-${alert.alertId} 상세 보기`} data-testid="work-card" className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border bg-card px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="min-w-0">
        <span className="block font-mono text-xs text-muted-foreground">A-{alert.alertId}</span>
        <span className="mt-1.5 block truncate text-sm">{alertSummary(alert)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <PatternBadge code={alert.primaryType.code} />
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{alert.assignee.name} · {ageText(alert.ageDays)}</span>
        </span>
      </span>
      <RiskBadge score={alert.riskScore} />
    </a>
  )
}
