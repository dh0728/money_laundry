import { Badge } from '@/components/ui/badge'
import { formatScore, typeDisplay, type AlertStatus, type TypeCode } from '@/api/codes'
import { alertWorkStatus, workStatusLabels, workStatusTone, type WorkStatus } from '@/lib/workStatus'

// 위험 색 단계(--risk-0~9)는 theme.css가 가진다. 점수 0~1을 10단계로 나눈다.
const riskTone = (score: number) => `var(--risk-${Math.min(9, Math.max(0, Math.floor(score * 10)))})`

export function RiskBadge({ score }: { score: number }) {
  // 배경은 단계 색(테마별로 라이트는 연하게, 다크는 어둡게)을 칠하고 글씨는 테마 글자색을 쓴다
  return (
    <Badge className="gap-1.5 border-transparent font-normal text-foreground" style={{ backgroundColor: riskTone(score) }} title="모델 위험 점수 (0 정상 ~ 1 이상)">
      <span className="font-mono">{formatScore(score)}</span>
    </Badge>
  )
}

/** 경과일도 위험 점수와 같은 연두→빨강 단계를 쓴다. 0일은 연두, 5일 이상은 가장 빨강(v24 ageTone 기준) */
export const AGE_MAX_DAYS = 5
export function AgeBadge({ days }: { days: number }) {
  const step = Math.min(9, Math.max(0, Math.round((days / AGE_MAX_DAYS) * 9)))
  return (
    <Badge className="border-transparent font-normal text-foreground" style={{ backgroundColor: `var(--risk-${step})` }} data-testid="age-badge" title="탐지 뒤 지난 날수">
      {days === 0 ? '오늘' : `${days}일 경과`}
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
