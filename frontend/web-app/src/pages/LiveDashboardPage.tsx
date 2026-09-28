import { useState } from 'react'
import { fetchDemoClock, fetchLiveDashboard, daysBefore, kstDate } from '@/api/liveDashboard'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { PageHeading } from '@/components/page'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'

const count = (n: number) => n.toLocaleString('ko-KR')

export default function LiveDashboardPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  const [scope, setScope] = useState<'personal' | 'institution'>('personal')
  const [range, setRange] = useState<{ from: string; to: string }>()
  const clock = useAsync(fetchDemoClock, [])
  const businessDate = clock.state.status === 'success' ? kstDate(clock.state.data.businessAt) : ''
  const from = range?.from ?? (businessDate ? daysBefore(businessDate, 29) : '')
  const to = range?.to ?? businessDate
  const dashboard = useAsync(() => from && to ? fetchLiveDashboard(from, to) : Promise.reject(new Error('업무 시각을 확인하지 못했습니다.')), [from, to])

  if (clock.state.status === 'loading') return <LoadingBlock label="업무 시각" />
  if (clock.state.status === 'error') return <ErrorBlock message={clock.state.message} onRetry={clock.retry} />
  if (dashboard.state.status === 'loading') return <LoadingBlock label="대시보드" />
  if (dashboard.state.status === 'error') return <ErrorBlock message={dashboard.state.message} onRetry={dashboard.retry} />
  const data = dashboard.state.data
  const cards = scope === 'personal'
    ? [['내 미처리', data.personal.pending], ['72시간 이상 경과', data.personal.aged], ['선택 기간 내 종결', data.personal.closed]] as const
    : [['열린 Alert', data.institution.alerts], ['열린 Episode', data.institution.episodes], ['72시간 이상 경과', data.institution.aged], ['오늘 생성된 Alert', data.institution.today]] as const
  const agreementTotal = data.agreements.reduce((sum, row) => sum + row.count, 0)
  const detectionRate = data.detection.received > 0 && data.pendingReports === 0 ? `${((data.detection.suspicious / data.detection.received) * 100).toFixed(1)}%` : '—'

  return <div className="space-y-6">
    <PageHeading title="대시보드" description={`업무 기준 ${kstDate(data.businessAt)} · 서버 집계`} />
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={scope === 'personal' ? 'default' : 'outline'} size="sm" onClick={() => setScope('personal')}>내 담당</Button>
      <Button variant={scope === 'institution' ? 'default' : 'outline'} size="sm" onClick={() => setScope('institution')}>기관 전체</Button>
      <label className="ml-auto flex items-center gap-2 text-xs">기간
        <input aria-label="시작일" type="date" className="rounded-md border bg-background px-2 py-1" value={from} max={to} onChange={event => setRange({ from: event.target.value, to })} />
        <span>~</span>
        <input aria-label="종료일" type="date" className="rounded-md border bg-background px-2 py-1" value={to} min={from} onChange={event => setRange({ from, to: event.target.value })} />
      </label>
    </div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={`${scope === 'personal' ? '내 담당' : '기관 전체'} 현황`}>
      {cards.map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-semibold">{count(value)}</p></div>)}
    </section>
    {scope === 'institution' && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="탐지와 Episode 업무">
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">오늘 탐지율</p><p className="mt-3 text-2xl font-semibold">{detectionRate}</p><p className="mt-2 text-xs text-muted-foreground">수신 {count(data.detection.received)} · 분석 {count(data.detection.analyzed)} · 의심 {count(data.detection.suspicious)}{data.pendingReports > 0 && ` · 미완료 보고 ${count(data.pendingReports)}`}</p></div>
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">열린 Episode 중 검토 전</p><p className="mt-3 text-2xl font-semibold">{count(data.episodeWork.current.unreviewed)}</p></div>
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">Episode 첫 검토 평균</p><p className="mt-3 text-2xl font-semibold">{data.episodeWork.firstReview.average_seconds == null ? '—' : `${Math.round(data.episodeWork.firstReview.average_seconds / 3600)}시간`}</p></div>
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">Episode 종결 평균</p><p className="mt-3 text-2xl font-semibold">{data.episodeWork.completion.average_seconds == null ? '—' : `${Math.round(data.episodeWork.completion.average_seconds / 3600)}시간`}</p></div>
    </section>}
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">일별 Alert 유입·종결</h2><p className="mb-3 text-xs text-muted-foreground">선택 기간의 생성일·종결일 기준</p>{data.daily.length ? <div className="max-h-64 overflow-auto text-sm">{data.daily.map(row => <div key={row.day} className="grid grid-cols-3 gap-2 border-b py-2"><span>{row.day}</span><span>유입 {count(row.incoming)}</span><span>종결 {count(row.completed)}</span></div>)}</div> : <EmptyBlock>해당 기간 데이터가 없습니다.</EmptyBlock>}</div>
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">탐지 유형</h2><p className="mb-3 text-xs text-muted-foreground">의심 거래 기준 · 분석 거래 {count(agreementTotal)}건 중</p>{data.types.length ? data.types.map(row => <div key={row.type} className="flex justify-between border-b py-2 text-sm"><span>유형 {row.type === 0 ? '패턴 없음' : row.type}</span><strong>{count(row.count)}건</strong></div>) : <EmptyBlock>유형별 거래가 없습니다.</EmptyBlock>}</div>
    </section>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">내 우선 검토 사건</h2><p className="mb-3 text-xs text-muted-foreground">담당 조사자가 위험도와 경과를 확인할 사건</p>{data.priority.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.priority.map(row => <button key={row.case_id} type="button" className="rounded-lg border p-3 text-left hover:bg-accent" onClick={() => onOpen(row.kind, row.case_id)}><span className="text-sm font-semibold">{row.kind === 'ALERT' ? `A-${row.alert_id ?? row.case_id}` : `E-${row.case_id}`}</span><span className="ml-2 text-xs text-muted-foreground">위험 {row.risk.toFixed(2)}</span><p className="mt-1 text-xs text-muted-foreground">조사 사건 {row.case_id}</p></button>)}</div> : <EmptyBlock>우선 검토 사건이 없습니다.</EmptyBlock>}</section>
  </div>
}
