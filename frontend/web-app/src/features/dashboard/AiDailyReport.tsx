import type { ReactNode } from 'react'
import type { AlertRow } from '@/api/alerts'
import { formatScore, type TypeCode } from '@/api/codes'
import type { DashboardData } from '@/api/dashboard'
import { ProvenanceBadge } from '@/components/Provenance'
import { PatternBadge } from '@/components/badges'
import { Card, CardContent } from '@/components/ui/card'
import { RadarSweep } from '@/features/agent/RadarSweep'
import { rdrSummaryBackground } from '@/features/agent/rdrSummaryStyle'
import { WorkCard } from './WorkCard'
import { alertWorkItem } from './workItems'

const HIGH_RISK = 0.8

// 규칙으로 만든 문장이다. 실제 LLM 연결 전 mock.
export function AiDailyReport({ summary, openAlerts }: { summary: DashboardData; openAlerts: AlertRow[] }) {
  const today = summary.dailyAlerts?.at(-1)
  const yesterday = summary.dailyAlerts?.at(-2)
  const change = today && yesterday ? today.inflow - yesterday.inflow : null
  const changeSummary = change === null ? '전일 기록이 없어 비교 불가.' : change === 0 ? '전일과 동일함.' : `전일보다 ${Math.abs(change)}건 ${change > 0 ? '늘어남' : '줄어듦'}.`
  const highRisk = openAlerts.filter(alert => alert.riskScore >= HIGH_RISK)
  const counts = openAlerts.reduce<Record<number, number>>((acc, alert) => ({ ...acc, [alert.primaryType.code]: (acc[alert.primaryType.code] ?? 0) + 1 }), {})
  const focus = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]
  const focusCode = focus ? Number(focus[0]) as TypeCode : null
  const priority = openAlerts.flatMap(alert => alertWorkItem(alert) ?? []).sort((a, b) => b.ageDays - a.ageDays || b.riskScore - a.riskScore).slice(0, 3)
  const generatedAt = summary.latestJob?.finishedAt

  return <DailyReportView generatedAt={generatedAt} changeSummary={changeSummary}
    operation={`3일 이상 미처리 ${summary.openAlertsAgedOver3Days ?? 0}건, 위험 점수 ${formatScore(HIGH_RISK)} 이상 ${highRisk.length}건 확인됨.`}
    focus={focusCode === null ? <p className="mt-2 text-sm leading-6 text-muted-foreground">진행 중인 탐지에서 집중 패턴 확인 안 됨.</p> : <div className="mt-2 flex flex-wrap items-center gap-2"><PatternBadge code={focusCode} /><p className="text-sm leading-6 text-muted-foreground">진행 중인 Alert의 최빈 유형({focus[1]}건). 동일 소유주·계좌가 서로 다른 Alert에 반복되는지 대조 필요.</p></div>}
    priority={priority.length ? <ul className="mt-3 space-y-2.5">{priority.map(item => <li key={item.id} data-testid="ai-priority-item"><WorkCard item={item} /></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">미처리 Alert 없음.</p>} />
}
export function DailyReportView({ generatedAt, changeSummary, operation, focus, priority }: {
  generatedAt?: string | null; changeSummary: string; operation: string; focus: ReactNode; priority: ReactNode
}) {
  return (
    <Card data-testid="ai-daily-report" className="h-full min-w-0 overflow-hidden shadow-none" style={rdrSummaryBackground}>
      <CardContent className="flex h-full min-h-0 flex-col">
        <div>
          <div className="flex items-center gap-2"><RadarSweep className="size-5 shrink-0" /><h3 className="text-base font-semibold tracking-tight">RDR 9000 Daily Report</h3><ProvenanceBadge kind="mock" title="규칙 기반 시연 문장. LLM 미연동." /></div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {generatedAt ? <>집계 시각 <time dateTime={generatedAt}>{generatedAt.slice(0, 16).replace('T', ' ')}</time> 기준</> : '집계 시각 미제공'}
          </p>
        </div>
        <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div><p className="text-xs font-medium">오늘의 변화</p><p className="mt-2 text-sm leading-6 text-muted-foreground">신규 탐지 흐름: {changeSummary} 장기 경과·고위험 기록의 배정 및 지연 상태 확인 필요.</p></div>
          <div><p className="text-xs font-medium">운영 해석</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{operation}</p></div>
          <div><p className="text-xs font-medium">집중 패턴</p>{focus}</div>
          <div><p className="text-xs font-medium">담당 조사자 교차 확인 질문</p><ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground"><li>동일 소유주·계좌의 다중 패턴 반복 여부</li><li>고액 집중일과 고객 프로필·거래 목적의 일치 여부</li><li>장기 경과 건의 증빙 요청·회신 기록 여부</li></ul></div>
          <section aria-labelledby="priority-title" className="rounded-lg border bg-muted/20 p-3 @3xl:p-4">
            <h4 id="priority-title" className="text-sm font-semibold">담당 조사자 우선 검토</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">기관 전체 미처리 Alert의 위험도와 경과를 확인합니다. 필요하면 담당 배정을 검토하세요.</p>
            {priority}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}
