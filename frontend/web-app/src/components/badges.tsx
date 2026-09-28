import { Badge } from '@/components/ui/badge'
import { formatScore, typeDisplay, type AlertStatus, type TypeCode } from '@/api/codes'
import { alertWorkStatus, workStatusLabels, workStatusTone, type WorkStatus } from '@/lib/workStatus'

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

/** 처리 전 · 처리 중 · 처리 완료 (Alert·Episode 공통) */
export function WorkStatusBadge({ status, title }: { status: WorkStatus; title?: string }) {
  return (
    <Badge variant="outline" data-tone={workStatusTone[status]} data-status={status} className="semantic-status-badge text-xs font-normal" title={title}>
      {workStatusLabels[status]}
    </Badge>
  )
}

export const StatusBadge = ({ status }: { status: AlertStatus }) => <WorkStatusBadge status={alertWorkStatus(status)} />

export function PatternBadge({ code }: { code: TypeCode }) {
  const { key, label } = typeDisplay(code)
  return (
    <Badge variant="outline" className="semantic-pattern-badge font-mono text-xs font-normal" title={label}>
      {key}
    </Badge>
  )
}
