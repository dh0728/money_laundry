// v24 Detail.tsx(kind=Episode)를 옮김. 연결 Alert·탐지 유형·근거 출처가 중심이다(v23 요구).
// 자금 흐름(그래프) 탭은 Alert와 함께 다음 묶음에서 옮긴다.
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { HistoryRow } from '@/api/alerts'
import { alertResolutionLabels, typeDisplay } from '@/api/codes'
import type { EpisodeDetail as EpisodeDetailData, EpisodeTransaction } from '@/api/episodes'
import { PatternBadge, RiskBadge, StatusBadge } from '@/components/badges'
import { UnderTabs } from '@/components/UnderTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Panel } from '@/features/alerts/DetailPanels'
import { card, historyLabels } from '@/features/alerts/detailText'
import AlertTxTable from '@/features/alerts/AlertTxTable'
import { alertCode, episodeCode } from '@/features/alerts/alertFilters'
import { moneyMetrics, usd } from '@/features/alerts/metrics'
import { useMemoryState } from '@/lib/memory'
import EpisodeReview from './EpisodeReview'
import { EpisodeStatusBadge } from './EpisodeList'

type Tab = 'overview' | 'graph' | 'transactions' | 'review'

type Props = {
  episode: EpisodeDetailData
  transactions: EpisodeTransaction[]
  history: HistoryRow[]
  responsible: boolean
  onBack: () => void
  onOpenAlert: (alertId: number) => void
  onComment: (comment: string) => void
  onRequestReview: (comment: string) => void
}

export default function EpisodeDetail({ episode, transactions, history, responsible, onBack, onOpenAlert, onComment, onRequestReview }: Props) {
  const [tab, setTab] = useMemoryState<Tab>(`episode:${episode.episodeId}:tab`, 'overview')
  // Episode 금액은 거래 ID로 중복을 없애 계산한다(v23)
  const representative = [...episode.alerts].sort((a, b) => b.riskScore - a.riskScore)[0]?.subjectAccount.account
  const metrics = moneyMetrics(transactions, representative)
  const span = `${episode.flow.periodFrom.slice(5, 10)} ~ ${episode.flow.periodTo.slice(5, 10)}`

  return (
    <div className="flex min-h-full flex-col gap-5">
      <header data-testid="detail-header">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={onBack}><ArrowLeft className="size-3.5" />Episode 목록</Button>
        <p data-testid="detail-id" className="font-mono text-xs text-muted-foreground">{episodeCode(episode.episodeId)}</p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{episode.primaryTypes.map(t => typeDisplay(t.code).label).join(' · ')} · Alert {episode.alertCount}건</h1>
        <div data-testid="detail-tags" className="mt-3 flex flex-wrap items-center gap-2">
          <EpisodeStatusBadge status={episode.status} reviewRequested={Boolean(episode.reviewRequestedAt)} />
          <RiskBadge score={episode.riskScore} />
          <Badge variant="outline" className="semantic-metadata-badge font-normal">담당 {episode.assignee.name}</Badge>
          <Badge variant="outline" className="semantic-metadata-badge font-normal">생성 {episode.createdAt.slice(0, 10)}</Badge>
        </div>
      </header>

      <UnderTabs value={tab} onChange={setTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '자금 흐름' }, { value: 'transactions', label: `거래 ${transactions.length}` }, { value: 'review', label: '조사 의견' }]} />

      {tab === 'overview' && (
        <div className="space-y-4" data-testid="overview">
          <div className="grid items-stretch gap-3 @3xl:grid-cols-12 @6xl:grid-cols-6">
            {[
              { label: '투입 원금', value: usd(metrics.principal) },
              { label: '거래 총액', value: usd(metrics.total) },
              { label: '순유입 (대표 계좌)', value: usd(episode.flow.netRetainedUsd) },
              { label: '연결 Alert', value: `${episode.alertCount}건` },
              { label: '근거 거래', value: `${transactions.length}건` },
              { label: '거래 기간', value: span },
            ].map(stat => (
              <Card key={stat.label} className={`${card} @3xl:col-span-4 @6xl:col-span-1`} data-testid="overview-kpi-card"><CardContent className="px-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{stat.value}</p>
              </CardContent></Card>
            ))}
          </div>

          <Panel title="연결 Alert" description="이 Episode를 이루는 Alert · 눌러서 Alert 상세로 이동" testId="linked-alerts">
            <div className="divide-y rounded-md border">
              {episode.alerts.map(alert => (
                <button key={alert.alertId} type="button" onClick={() => onOpenAlert(alert.alertId)} aria-label={`${alertCode(alert.alertId)} 상세 보기`}
                  className="grid w-full grid-cols-[88px_72px_120px_minmax(0,1fr)_110px_90px_16px] items-center gap-3 px-3 py-2.5 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="font-mono">{alertCode(alert.alertId)}</span>
                  <RiskBadge score={alert.riskScore} />
                  <PatternBadge code={alert.primaryType.code} />
                  <span className="truncate text-muted-foreground">{alert.summary}</span>
                  <span className="text-right tabular-nums">{usd(alert.totalAmountUsd)}</span>
                  <StatusBadge status={alert.status} />
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </Panel>

          <div className="grid items-stretch gap-4 @3xl:grid-cols-3">
            <Panel title="패턴 증거" description="Alert별 유형 확인 항목" testId="pattern-evidence">
              <div className="space-y-4">
                {episode.patternEvidence.map(e => (
                  <div key={e.alertId}>
                    <p className="mb-1.5 text-xs font-medium"><span className="font-mono">{alertCode(e.alertId)}</span> · {typeDisplay(e.typeClass).label}</p>
                    <ul className="space-y-1 text-xs">
                      {e.checks.map(c => <li key={c.key} className="flex justify-between gap-2"><span className={c.passed ? '' : 'text-muted-foreground'}>{c.passed ? '✓' : '·'} {c.label}</span><span className="tabular-nums text-muted-foreground">{c.value}</span></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="대표 계좌 이력" description="같은 계좌가 나온 Alert(정상 판정 포함)" testId="account-history">
              {episode.accountHistory.map(h => (
                <div key={h.account} className="text-xs">
                  <p className="mb-2 font-mono">{h.account} · 은행 {h.bank}</p>
                  <ul className="space-y-1.5">
                    {h.alerts.map(a => <li key={a.alertId} className="flex justify-between gap-2"><span className="font-mono">{alertCode(a.alertId)}</span><span className="text-muted-foreground">{a.resolution ? alertResolutionLabels[a.resolution] : a.episodeId != null ? episodeCode(a.episodeId) : '검토 전'}</span></li>)}
                  </ul>
                </div>
              ))}
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

      {tab === 'graph' && <p className="rounded-lg border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">자금 흐름 그래프는 다음 작업에서 옮깁니다.</p>}
      {tab === 'transactions' && <AlertTxTable rows={transactions} />}
      {tab === 'review' && <EpisodeReview episode={episode} responsible={responsible} onComment={onComment} onRequestReview={onRequestReview} />}
    </div>
  )
}
