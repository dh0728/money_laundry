import { Badge } from '@/components/ui/badge'
import { alertStatusLabels, formatScore, typeDisplay, type AlertStatus, type TypeCode } from '@/api/codes'

// 위험 색 단계(--risk-0~9)는 theme.css가 가진다. 점수 0~1을 10단계로 나눈다.
const riskTone = (score: number) => `var(--risk-${Math.min(9, Math.max(0, Math.floor(score * 10)))})`

export function RiskBadge({ score }: { score: number }) {
  return (
    <Badge
      className="gap-1.5 border-0 font-normal text-selection-destructive-foreground"
      style={{ backgroundColor: `color-mix(in oklch, ${riskTone(score)} 70%, transparent)` }}
      title="모델 위험 점수 (0~1)"
    >
      <span className="font-mono">{formatScore(score)}</span>
    </Badge>
  )
}

const statusTone: Record<AlertStatus, string> = { OPEN: 'pending', ESCALATED: 'working', CLOSED: 'closed' }

export function StatusBadge({ status }: { status: AlertStatus }) {
  return (
    <Badge variant="outline" data-tone={statusTone[status]} className="semantic-status-badge text-xs font-normal">
      {alertStatusLabels[status]}
    </Badge>
  )
}

export function PatternBadge({ code }: { code: TypeCode }) {
  const { key, label } = typeDisplay(code)
  return (
    <Badge variant="outline" className="semantic-pattern-badge font-mono text-xs font-normal" title={label}>
      {key}
    </Badge>
  )
}
