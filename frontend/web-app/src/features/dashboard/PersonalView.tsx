import { useState } from 'react'
import type { AlertRow } from '@/api/alerts'
import { formatScore, typeDisplay } from '@/api/codes'
import { StatusBadge } from '@/components/badges'
import { SectionCards, type SectionCardItem } from '@/components/SectionCards'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmt } from '@/lib/format'
import { loadAlerts } from './dataSource'
import { personalColumns, personalSorts, sortAlerts, type PersonalSort } from './personalQueue'
import { EmptyBlock, ErrorBlock, LoadingBlock } from './states'
import { useAsync } from './useAsync'
import { WorkCard } from './WorkCard'
import { alertSummary } from './alertText'

const HIGH_RISK = 0.8

function PersonalAiSummary({ open }: { open: AlertRow[] }) {
  const stale = open.filter(alert => alert.ageDays >= 3)
  const high = open.filter(alert => alert.riskScore >= HIGH_RISK)
  const counts = open.reduce<Record<number, number>>((acc, alert) => ({ ...acc, [alert.primaryType.code]: (acc[alert.primaryType.code] ?? 0) + 1 }), {})
  const focus = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]
  const first = sortAlerts(open, 'age').find(alert => alert.riskScore >= HIGH_RISK) ?? sortAlerts(open, 'risk')[0]
  return (
    <Card data-testid="personal-ai-summary" className="shadow-none">
      <CardContent>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">AI 요약 · 내 담당</h2>
          <p className="text-[11px] text-muted-foreground">담당 미처리 {open.length}건 기준 · 판단은 조사자가 수행</p>
        </div>
        <div className="mt-4 grid gap-4 @3xl:grid-cols-3">
          <div><p className="text-xs font-medium">현재 상황</p><p className="mt-2 text-sm leading-6 text-muted-foreground">미처리 {open.length}건 중 위험 점수 {formatScore(HIGH_RISK)} 이상 {high.length}건, 3일 이상 경과 {stale.length}건입니다.</p></div>
          <div><p className="text-xs font-medium">집중 패턴</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{focus ? `${typeDisplay(Number(focus[0]) as AlertRow['primaryType']['code']).key} 의심이 ${focus[1]}건으로 가장 많습니다. 같은 소유주·계좌가 반복되는지 함께 보세요.` : '두드러진 패턴이 없습니다.'}</p></div>
          <div>
            <p className="text-xs font-medium">먼저 볼 업무</p>
            {first ? (
              <div data-testid="personal-ai-first" className="mt-2 rounded-md border px-3 py-2">
                <span className="block truncate text-sm">{alertSummary(first)}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">A-{first.alertId} · 위험 {formatScore(first.riskScore)} · {first.ageDays}일 경과</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">미처리 업무가 없습니다.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function PersonalView() {
  const [sort, setSort] = useState<PersonalSort>('risk')
  const { state, retry } = useAsync(() => loadAlerts({ assigneeId: 'me', size: 200 }), [])
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />
  if (state.status === 'loading') return <LoadingBlock label="내 담당 업무" />

  const mine = state.data.content
  const open = mine.filter(alert => alert.status === 'OPEN')
  const cards: SectionCardItem[] = [
    { label: '내 담당 미처리', value: fmt(open.length), trend: '검토 전 상태', note: '검토가 필요한 Alert' },
    { label: `위험 점수 ${formatScore(HIGH_RISK)} 이상`, value: fmt(open.filter(alert => alert.riskScore >= HIGH_RISK).length), trend: '고위험', note: `미처리 중 위험 점수 ${formatScore(HIGH_RISK)} 이상` },
    { label: '3일 이상 경과', value: fmt(open.filter(alert => alert.ageDays >= 3).length), trend: '우선 처리 대상', note: '미처리 중 3일 이상 경과' },
    { label: '내 종결', value: fmt(mine.filter(alert => alert.status === 'CLOSED').length), trend: '현재 조회 범위', note: '담당해 종결한 Alert' },
  ]
  return (
    <>
      <SectionCards items={cards} />
      <PersonalAiSummary open={open} />
      <section aria-labelledby="queue-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="queue-title" className="text-base font-semibold tracking-tight">내 담당 업무</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">상태별 · {personalSorts[sort].label}</p>
          </div>
          <Select value={sort} onValueChange={value => setSort(value as PersonalSort)}>
            <SelectTrigger size="sm" className="w-40" aria-label="업무 정렬 기준"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(personalSorts).map(([key, option]) => <SelectItem key={key} value={key}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid items-start gap-4 @3xl:grid-cols-3" data-testid="work-queue">
          {personalColumns.map(status => {
            const items = sortAlerts(mine.filter(alert => alert.status === status), sort)
            return (
              <div key={status} data-testid="work-status-column" className="flex min-w-0 flex-col gap-2.5">
                <div className="flex items-center gap-2"><StatusBadge status={status} /><span className="text-xs tabular-nums text-muted-foreground">{items.length}건</span></div>
                {items.length ? items.map(alert => <WorkCard key={alert.alertId} alert={alert} />) : <EmptyBlock>해당 상태 업무가 없습니다.</EmptyBlock>}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
