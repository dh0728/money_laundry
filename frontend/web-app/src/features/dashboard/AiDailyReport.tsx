import type { AlertRow } from '@/api/alerts'
import { formatScore, typeDisplay } from '@/api/codes'
import type { DashboardData } from '@/api/dashboard'
import { Card, CardContent } from '@/components/ui/card'
import { alertSummary } from './alertText'

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
  const priority = openAlerts.slice().sort((a, b) => b.ageDays - a.ageDays || b.riskScore - a.riskScore).slice(0, 3)
  const generatedAt = summary.latestJob?.finishedAt

  return (
    <Card data-testid="ai-daily-report" className="h-full min-w-0 overflow-hidden shadow-none">
      <CardContent className="flex h-full min-h-0 flex-col">
        <div>
          <h3 className="text-base font-semibold tracking-tight">AI Daily Report</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {generatedAt ? <>최근 분석 <time dateTime={generatedAt}>{generatedAt.slice(0, 16).replace('T', ' ')}</time> 기준</> : '아직 완료된 분석이 없습니다'}
          </p>
        </div>
        <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div><p className="text-xs font-medium">오늘의 변화</p><p className="mt-2 text-sm leading-6 text-muted-foreground">신규 탐지 흐름이 {changeSummary} 단순 건수보다 장기 경과와 위험 점수가 함께 높은 기록을 먼저 확인해야 합니다.</p></div>
          <div><p className="text-xs font-medium">운영 해석</p><p className="mt-2 text-sm leading-6 text-muted-foreground">3일 이상 미처리 {summary.openAlertsAgedOver3Days ?? 0}건, 위험 점수 {formatScore(HIGH_RISK)} 이상 {highRisk.length}건입니다.</p></div>
          <div><p className="text-xs font-medium">집중 패턴</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{focus ? `${typeDisplay(Number(focus[0]) as AlertRow['primaryType']['code']).key} 의심이 진행 중인 탐지 ${focus[1]}건으로 가장 많습니다. 같은 소유주·계좌가 서로 다른 Alert에 반복되는지 대조하세요.` : '현재 진행 중인 탐지에서 집중 패턴을 찾지 못했습니다.'}</p></div>
          <div><p className="text-xs font-medium">교차 확인 질문</p><ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground"><li>같은 소유주나 계좌가 서로 다른 패턴에 반복 등장합니까?</li><li>고액 집중일이 고객 프로필과 거래 목적에 부합합니까?</li><li>장기 경과 건의 증빙 요청과 회신 상태가 기록돼 있습니까?</li></ul></div>
          <div>
            <p className="text-xs font-medium">우선 검토</p>
            {priority.length ? (
              <ul className="mt-2 space-y-3">
                {priority.map(alert => (
                  <li key={alert.alertId} data-testid="ai-priority-item" className="rounded-md border px-3 py-2.5">
                    <p className="truncate text-sm">{alertSummary(alert)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">A-{alert.alertId} · 위험 점수 {formatScore(alert.riskScore)} · {alert.ageDays === 0 ? '오늘 탐지' : `${alert.ageDays}일 경과`}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">미처리 Alert가 없습니다.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
