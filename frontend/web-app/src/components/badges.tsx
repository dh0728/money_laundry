import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { alertStatusLabels, formatScore, typeDisplay, type AlertStatus, type EpisodeStatus, type TypeCode } from '@/api/codes'
import { workStatusLabels, workStatusTone, type WorkStatus } from '@/lib/workStatus'
import { isOverdueCaseAge } from '@/features/investigation/case-age'

// 위험 색 단계(--risk-0~9)는 theme.css가 가진다. 점수 0~1을 10단계로 나눈다.
const riskTone = (score: number) => `var(--risk-${Math.min(9, Math.max(0, Math.floor(score * 10)))})`

export function RiskBadge({ score }: { score: number }) {
  // 배경은 단계 색(테마별로 라이트는 연하게, 다크는 어둡게)을 칠하고 글씨는 테마 글자색을 쓴다
  return (
    <Badge className="gap-1.5 border-transparent bg-(color:--badge-risk-fill) font-normal text-foreground" style={{ '--badge-risk-fill': riskTone(score) } as CSSProperties} title="모델 위험 점수 (0 정상 ~ 1 이상)">
      <span className="font-mono">{formatScore(score)}</span>
    </Badge>
  )
}

export function AgeBadge({ days }: { days: number }) {
  const tone = isOverdueCaseAge(days) ? 'danger' : 'caution'
  return (
    <Badge className="case-age-badge border-transparent font-normal" data-tone={tone} data-testid="age-badge" title="탐지 뒤 지난 날수">
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

export function CaseLifecycleBadge({ status, label }: { status: AlertStatus | EpisodeStatus; label: string }) {
  return <Badge variant="outline" data-tone={status === 'CLOSED' ? 'closed' : 'working'} data-status={status} className="semantic-status-badge text-xs font-normal">{label}</Badge>
}

export const StatusBadge = ({ status }: { status: AlertStatus }) => <CaseLifecycleBadge status={status} label={alertStatusLabels[status]} />

export function PatternBadge({ code }: { code: TypeCode }) {
  const { key, label } = typeDisplay(code)
  return (
    <Badge variant="outline" className="semantic-pattern-badge font-mono text-xs font-normal" title={label}>
      {key}
    </Badge>
  )
}
