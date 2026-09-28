import type { AlertRow } from '@/api/alerts'
import { formatScore, type TypeCode } from '@/api/codes'
import type { DashboardData } from '@/api/dashboard'
import { ProvenanceBadge } from '@/components/Provenance'
import { PatternBadge } from '@/components/badges'
import { Card, CardContent } from '@/components/ui/card'
import { WorkCard } from './WorkCard'
import { alertWorkItem } from './workItems'

const HIGH_RISK = 0.8

// 규칙으로 만든 문장이다. 실제 LLM 연결 전 mock.
export function AiDailyReport({ summary, openAlerts }: { summary: DashboardData; openAlerts: AlertRow[] }) {
  const today = summary.dailyAlerts?.at(-1)
  const yesterday = summary.dailyAlerts?.at(-2)
  const change = today && yesterday ? today.inflow - yesterday.inflow : null
  const changeSummary = change === null ? '비교할 전일 기록이 없습니다.' : change === 0 ? '전일과 같은 수준입니다.' : `전일보다 ${Math.abs(change)}건 ${change > 0 ? '늘었습니다' : '줄었습니다'}.`
  const highRisk = openAlerts.filter(alert => alert.riskScore >= HIGH_RISK)
  const counts = openAlerts.reduce<Record<number, number>>((acc, alert) => ({ ...acc, [alert.primaryType.code]: (acc[alert.primaryType.code] ?? 0) + 1 }), {})
  const focus = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]
  const focusCode = focus ? Number(focus[0]) as TypeCode : null
  const priority = openAlerts.flatMap(alert => alertWorkItem(alert) ?? []).sort((a, b) => b.ageDays - a.ageDays || b.riskScore - a.riskScore).slice(0, 3)
  const generatedAt = summary.latestJob?.finishedAt

  return (
    <Card data-testid="ai-daily-report" className="h-full min-w-0 overflow-hidden shadow-none">
      <CardContent className="flex h-full min-h-0 flex-col">
        <div>
          <div className="flex items-center gap-2"><h3 className="text-base font-semibold tracking-tight">AI Daily Report</h3><ProvenanceBadge kind="mock" title="규칙으로 만든 문장입니다. LLM 연결은 발표 뒤 범위입니다." /></div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {generatedAt ? <>최근 분석 <time dateTime={generatedAt}>{generatedAt.slice(0, 16).replace('T', ' ')}</time> 기준</> : '아직 완료된 분석이 없습니다'}
          </p>
        </div>
        <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div><p className="text-xs font-medium">오늘의 변화</p><p className="mt-2 text-sm leading-6 text-muted-foreground">신규 탐지 흐름이 {changeSummary} 관리자는 장기 경과와 위험 점수가 함께 높은 기록의 배정·지연 상태를 확인합니다.</p></div>
          <div><p className="text-xs font-medium">운영 해석</p><p className="mt-2 text-sm leading-6 text-muted-foreground">3일 이상 미처리 {summary.openAlertsAgedOver3Days ?? 0}건, 위험 점수 {formatScore(HIGH_RISK)} 이상 {highRisk.length}건입니다.</p></div>
          <div><p className="text-xs font-medium">집중 패턴</p>{focusCode === null
            ? <p className="mt-2 text-sm leading-6 text-muted-foreground">현재 진행 중인 탐지에서 집중 패턴을 찾지 못했습니다.</p>
            : <div className="mt-2 flex flex-wrap items-center gap-2"><PatternBadge code={focusCode} /><p className="text-sm leading-6 text-muted-foreground">진행 중인 Alert에서 가장 많은 유형입니다({focus[1]}건). 담당 조사자는 같은 소유주·계좌가 서로 다른 Alert에 반복되는지 대조합니다.</p></div>}</div>
          <div><p className="text-xs font-medium">담당 조사자 교차 확인 질문</p><ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground"><li>같은 소유주나 계좌가 서로 다른 패턴에 반복 등장합니까?</li><li>고액 집중일이 고객 프로필과 거래 목적에 부합합니까?</li><li>장기 경과 건의 증빙 요청과 회신 상태가 기록돼 있습니까?</li></ul></div>
          <section aria-labelledby="priority-title" className="rounded-lg border bg-muted/20 p-3 @3xl:p-4">
            <h4 id="priority-title" className="text-sm font-semibold">담당 조사자 우선 검토</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">기관 전체의 미처리 Alert 중 오래 경과한 건부터 표시합니다. 관리자는 지연과 재배정 여부를 확인합니다.</p>
            {priority.length ? (
              <ul className="mt-3 space-y-2.5">
                {priority.map(item => (
                  <li key={item.id} data-testid="ai-priority-item"><WorkCard item={item} /></li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">미처리 Alert가 없습니다.</p>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}
