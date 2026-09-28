// v24 Detail.tsx(kind=Alert)를 옮김. 자금 흐름(그래프) 탭은 다음 묶음에서 옮긴다.
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { ArrowLeft } from 'lucide-react'
import type { AlertDetail as AlertDetailData, HistoryRow } from '@/api/alerts'
import { alertResolutionLabels, typeDisplay, type TypeCode } from '@/api/codes'
import { PatternBadge, RiskBadge, StatusBadge } from '@/components/badges'
import { PlannedBlock } from '@/components/Provenance'
import { UnderTabs } from '@/components/UnderTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { useMemoryState } from '@/lib/memory'
import { BarList, Panel } from './DetailPanels'
import { card, historyLabels } from './detailText'
import { alertCode, episodeCode } from './alertFilters'
import AlertReview, { type VerdictSubmit } from './AlertReview'
import AlertTxTable from './AlertTxTable'
import { moneyMetrics, sumBy, usd } from './metrics'

export type DetailTab = 'overview' | 'graph' | 'transactions' | 'review'

const basisLabels = { TIME: '시간', ACCOUNT: '계좌', BANK: '은행', PATH: '경로' } as const

type Props = {
  alert: AlertDetailData
  history: HistoryRow[]
  responsible: boolean
  assigneeNotice?: string
  episodes: number[]
  onBack: () => void
  onOpenEpisode: (episodeId: number) => void
  onSubmit: (submit: VerdictSubmit) => void
}

export default function AlertDetail({ alert, history, responsible, assigneeNotice, episodes, onBack, onOpenEpisode, onSubmit }: Props) {
  const [tab, setTab] = useMemoryState<DetailTab>(`alert:${alert.alertId}:tab`, 'overview')
  const tx = alert.transactions
  const metrics = moneyMetrics(tx, alert.subjectAccount.account)
  const daily = sumBy(tx, t => t.txAt.slice(5, 10), t => t.amountUsd).sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ day: d.name, USD: Math.round(d.v) }))
  const peak = daily.reduce((best, d, i) => (d.USD > daily[best].USD ? i : best), 0)
  const senders = sumBy(tx, t => t.fromAccount, t => t.amountUsd).slice(0, 5)
  const times = tx.map(t => t.txAt).sort()
  const span = times.length ? `${times[0].slice(5, 10)} ~ ${times[times.length - 1].slice(5, 10)}` : '—'
  const distribution = Object.entries(alert.typeDistribution).map(([code, ratio]) => ({ code: Number(code) as TypeCode, ratio: ratio ?? 0 })).sort((a, b) => b.ratio - a.ratio)

  return (
    <div className="flex min-h-full flex-col gap-5">
      <header data-testid="detail-header">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={onBack}><ArrowLeft className="size-3.5" />Alert 목록</Button>
        <p data-testid="detail-id" className="font-mono text-xs text-muted-foreground">{alertCode(alert.alertId)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">{typeDisplay(alert.primaryType.code).label} · 대표 계좌 {alert.subjectAccount.account}</h1>
          {alert.episodeId != null && <Button variant="outline" size="sm" className="h-8 rounded-full px-3 font-mono text-xs font-normal" onClick={() => onOpenEpisode(alert.episodeId!)}>연결된 Episode {episodeCode(alert.episodeId)}</Button>}
        </div>
        <div data-testid="detail-tags" className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={alert.status} />
          <RiskBadge score={alert.riskScore} />
          <PatternBadge code={alert.primaryType.code} />
          {alert.resolution && <Badge variant="outline" className="semantic-metadata-badge font-normal">{alertResolutionLabels[alert.resolution]}</Badge>}
          <Badge variant="outline" className="semantic-metadata-badge font-normal">담당 {alert.assignee.name}</Badge>
          <Badge variant="outline" className="semantic-metadata-badge font-normal">탐지 {alert.createdAt.slice(0, 10)}</Badge>
        </div>
        {assigneeNotice && <p className="mt-3 text-xs text-muted-foreground">{assigneeNotice}</p>}
      </header>

      <UnderTabs value={tab} onChange={setTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '그래프' }, { value: 'transactions', label: '거래', count: tx.length }, { value: 'review', label: '검토 의견' }]} />

      {tab === 'overview' && (
        <div className="space-y-4" data-testid="overview">
          <div className="grid items-stretch gap-3 @3xl:grid-cols-12 @6xl:grid-cols-6">
            {[
              { label: '투입 원금', value: usd(metrics.principal) },
              { label: '거래 총액', value: usd(metrics.total) },
              { label: '순유입 (대표 계좌)', value: metrics.netInflow === null ? '—' : usd(metrics.netInflow) },
              { label: '근거 거래', value: `${tx.length}건` },
              { label: '참여 계좌', value: `${alert.accountCount}개 · 은행 ${alert.bankCount}곳` },
              { label: '거래 기간', value: span },
            ].map(stat => (
              <Card key={stat.label} className={`${card} @3xl:col-span-4 @6xl:col-span-1`} data-testid="overview-kpi-card"><CardContent className="px-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{stat.value}</p>
              </CardContent></Card>
            ))}
          </div>
          <div className="grid items-stretch gap-4 @4xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
            <Panel title="일별 거래 금액" description="언제 집중됐는지 · USD">
              <ChartContainer config={{ USD: { label: 'USD', color: 'var(--muted-foreground)' } }} className="h-[170px] w-full">
                <BarChart data={daily} margin={{ left: 0, right: 4, top: 6 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} />
                  <YAxis width={70} tickLine={false} axisLine={false} fontSize={10} tickFormatter={v => usd(Number(v))} />
                  <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.35 }} content={<ChartTooltipContent formatter={v => usd(Number(v))} hideIndicator />} />
                  <Bar dataKey="USD" radius={3}>{daily.map((d, i) => <Cell key={d.day} fill={i === peak ? 'var(--foreground)' : 'var(--muted-foreground)'} />)}</Bar>
                </BarChart>
              </ChartContainer>
            </Panel>
            <Panel title="상위 송금 계좌" description="자금이 어디서 나갔는지"><BarList rows={senders} /></Panel>
          </div>
          <div className="grid items-stretch gap-4 @3xl:grid-cols-3">
            <Panel title="묶음 근거" description="이 거래들이 한 Alert가 된 이유" testId="grouping">
              <ul className="space-y-2 text-xs">
                {alert.groupingBasis.map(b => <li key={`${b.basis}-${b.value}`} className="flex items-center gap-2"><Badge variant="outline" className="font-normal">{basisLabels[b.basis]}</Badge><span className="min-w-0 truncate">{b.value}</span></li>)}
              </ul>
              <p className="mb-2 mt-5 text-xs text-muted-foreground">유형 구성비</p>
              <ul className="space-y-1.5 text-xs">
                {distribution.map(d => <li key={d.code} className="flex justify-between"><span>{typeDisplay(d.code).label}</span><span className="tabular-nums">{Math.round(d.ratio * 100)}%</span></li>)}
              </ul>
            </Panel>
            <Panel title="조사 정보">
              <dl className="grid grid-cols-[96px_1fr] gap-y-4 text-xs">
                <dt className="text-muted-foreground">조사 단위</dt><dd>Alert 한 건을 통째로 판정</dd>
                <dt className="text-muted-foreground">분석 날짜</dt><dd className="tabular-nums">{alert.analysisDate}</dd>
                <dt className="text-muted-foreground">점수 평균·최고</dt><dd className="tabular-nums">{alert.scoreStats.mean.toFixed(2)} · {alert.scoreStats.max.toFixed(2)}</dd>
                <dt className="text-muted-foreground">참여 은행</dt><dd className="tabular-nums">{alert.banks.join(', ')}</dd>
              </dl>
            </Panel>
            <Panel title="처리 이력" description="담당자 · 변경 사유 · 시각" testId="history">
              <div className="divide-y">
                {history.map(e => (
                  <div key={e.id} className="flex gap-2.5 py-2">
                    <span className="w-11 shrink-0 text-[11px] tabular-nums text-muted-foreground">{e.at.slice(5, 10)}</span>
                    <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground" />
                    <div className="min-w-0 flex-1 text-xs">
                      <p>{historyLabels[e.action]}<span className="ml-2 text-muted-foreground">{e.actor.name}</span></p>
                      {e.comment && <p className="mt-1 truncate text-muted-foreground">{e.comment}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'graph' && <PlannedBlock>자금 흐름 그래프(계좌 관계도)는 v24 시안에서 옮기는 중입니다.</PlannedBlock>}
      {tab === 'transactions' && <AlertTxTable rows={tx} />}
      {tab === 'review' && <AlertReview alert={alert} responsible={responsible} episodes={episodes} onSubmit={onSubmit} />}
    </div>
  )
}
