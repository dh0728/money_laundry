import { LinkedAlerts } from './LinkedAlerts'
// v24 Detail.tsx(kind=Episode)를 옮김. 연결 Alert·탐지 유형·근거 출처가 중심이다(v23 요구).
// 그래프 탭은 v24 자금 흐름 그래프를 그대로 옮겼다(features/graph/v24).
import { useMemo, useState } from 'react'
import type { HistoryRow } from '@/api/alerts'
import { alertResolutionLabels, typeDisplay } from '@/api/codes'
import type { EpisodeDetail as EpisodeDetailData, EpisodeTransaction } from '@/api/episodes'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { CaseHeader, CaseStats } from '@/features/alerts/CasePresentation'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Panel, OverviewPanels } from '@/features/alerts/DetailPanels'
import { historyLabels } from '@/features/alerts/detailText'
import AlertTxTable from '@/features/alerts/AlertTxTable'
import { alertCode, episodeCode } from '@/features/alerts/alertFilters'
import { moneyMetrics, usd } from '@/features/alerts/metrics'
import { useMemoryState } from '@/lib/memory'
import EpisodeReview from './EpisodeReview'
import { toGraphModel } from '@/features/graph/adapter'
import Graph from '@/features/graph/v24/Graph'
import TxLabelPanel from '@/features/graph/TxLabelPanel'
import { applyRelabels, type TxRelabels } from '@/features/graph/relabel'
import type { RelationGraph } from '@/api/graph'
import { EpisodeStatusBadge } from './EpisodeList'

type Tab = 'overview' | 'graph' | 'transactions' | 'review'

type Props = {
  episode: EpisodeDetailData
  graph: RelationGraph
  relabels: TxRelabels
  onRelabel: (txId: number, label: 0 | 1, reason: string) => void
  transactions: EpisodeTransaction[]
  history: HistoryRow[]
  responsible: boolean
  onOpenAlert: (alertId: number) => void
  onComment: (comment: string) => void
  onRequestReview: (comment: string) => void
  onUnlinkAlerts?: (alertIds: number[], reason: string) => void
}

export default function EpisodeDetail({ episode, graph, transactions: modelTransactions, relabels, onRelabel, history, responsible, onOpenAlert, onComment, onRequestReview, onUnlinkAlerts }: Props) {
  const [tab, setTab] = useMemoryState<Tab>(`episode:${episode.episodeId}:tab`, 'overview')
  const [selectingAlerts, setSelectingAlerts] = useState(false)
  const [selectedAlertIds, setSelectedAlertIds] = useState<number[]>([])
  const [unlinkReason, setUnlinkReason] = useState('')
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const transactions = useMemo(() => applyRelabels(modelTransactions, relabels), [modelTransactions, relabels])
  const graphModel = useMemo(() => toGraphModel(graph, modelTransactions, relabels), [graph, modelTransactions, relabels])
  // Episode 금액은 거래 ID로 중복을 없애 계산한다(v23)
  const representative = [...episode.alerts].sort((a, b) => b.riskScore - a.riskScore)[0]?.subjectAccount.account
  const metrics = moneyMetrics(transactions, representative)
  const span = `${episode.flow.periodFrom.slice(5, 10)} ~ ${episode.flow.periodTo.slice(5, 10)}`
  const submitUnlink = () => {
    if (!selectedAlertIds.length || !unlinkReason.trim()) return
    onUnlinkAlerts?.(selectedAlertIds, unlinkReason.trim())
    setConfirmDissolve(false)
    setSelectingAlerts(false)
    setSelectedAlertIds([])
    setUnlinkReason('')
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <CaseHeader id={episodeCode(episode.episodeId)} title={`${episode.primaryTypes.map(t => typeDisplay(t.code).label).join(' · ')} · Alert ${episode.alertCount}건`} tab={tab} onTab={setTab} count={transactions.length}
        tags={<><EpisodeStatusBadge status={episode.status} reviewRequested={Boolean(episode.reviewRequestedAt)} /><RiskBadge score={episode.riskScore} />
          {episode.primaryTypes.map(type => <PatternBadge key={type.code} code={type.code} />)}<Badge variant="outline">담당 {episode.assignee.name}</Badge><Badge variant="outline">생성 {episode.createdAt.slice(0, 10)}</Badge></>} />

      {tab === 'overview' && (
        <div className="space-y-4" data-testid="overview">
          <CaseStats items={[
              { label: '투입 원금', value: usd(metrics.principal) },
              { label: '거래 총액', value: usd(metrics.total) },
              { label: '순유입 (대표 계좌)', value: usd(episode.flow.netRetainedUsd) },
              { label: '연결 Alert', value: `${episode.alertCount}건` },
              { label: '근거 거래', value: `${transactions.length}건` },
              { label: '거래 기간', value: span },
            ]} />

          <Panel title="연결 Alert" description="이 Episode를 이루는 Alert · 눌러서 Alert 상세로 이동" testId="linked-alerts"
            action={<div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!responsible || !onUnlinkAlerts}
                onClick={() => { setSelectingAlerts(value => !value); setSelectedAlertIds([]); setUnlinkReason('') }}>
                {selectingAlerts ? '선택 취소' : '연결 Alert 선택'}
              </Button>
              {selectingAlerts && <Button size="sm" disabled={!selectedAlertIds.length || !unlinkReason.trim()}
                onClick={() => episode.alerts.length - selectedAlertIds.length < 2 ? setConfirmDissolve(true) : submitUnlink()}>
                선택 Alert 연결 해제
              </Button>}
            </div>}>
            {selectingAlerts && <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
              <label className="min-w-48 flex-1 text-xs">연결 해제 사유
                <textarea aria-label="연결 해제 사유" className="mt-1 min-h-9 w-full rounded-md border bg-background p-2 text-sm"
                  maxLength={4000} value={unlinkReason} onChange={event => setUnlinkReason(event.target.value)} placeholder="선택 Alert를 연결 해제하는 이유" />
              </label>
            </div>}
            <LinkedAlerts rows={episode.alerts.map(alert => ({
              id: alert.alertId, risk: alert.riskScore, types: [typeDisplay(alert.primaryType.code).label],
              age: alert.ageDays, detail: `계좌 ${alert.accountCount} · 은행 ${alert.bankCount} · 거래 ${alert.txCount}건`,
              amount: usd(alert.totalAmountUsd), status: alert.status,
            }))} onOpen={onOpenAlert} selection={selectingAlerts ? { ids: selectedAlertIds, toggle: id => setSelectedAlertIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]) } : undefined} />
            {selectingAlerts && <p className="mt-2 text-xs text-muted-foreground">연결 해제 후 Alert가 1건 이하이면 Episode가 해체되고 모든 Alert가 단독으로 전환됩니다.</p>}
          </Panel>

          <OverviewPanels columns={3}>
            <Panel title="패턴 증거" description="Alert별 유형 확인 항목" testId="pattern-evidence">
              <div className="space-y-4">
                {episode.patternEvidence.map(e => (
                  <div key={e.alertId}>
                    <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium"><span className="font-mono">{alertCode(e.alertId)}</span><PatternBadge code={e.typeClass} /></p>
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
                    {h.alerts.map(a => <li key={a.alertId} className="flex justify-between gap-2"><span className="font-mono">{alertCode(a.alertId)}</span><Badge variant="outline" className="semantic-metadata-badge font-normal">{a.resolution ? alertResolutionLabels[a.resolution] : a.episodeId != null ? episodeCode(a.episodeId) : '처리 전'}</Badge></li>)}
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
          </OverviewPanels>
        </div>
      )}

      {tab === 'graph' && <Graph key={episode.episodeId} model={graphModel} label={`${episodeCode(episode.episodeId)} 관계 그래프`}
        panelExtra={focus => <TxLabelPanel model={graphModel} focus={focus} editable={responsible && !episode.reviewRequestedAt && episode.status === 'OPEN'} onRelabel={onRelabel} />} />}
      {tab === 'transactions' && <AlertTxTable rows={transactions} />}
      {tab === 'review' && <EpisodeReview episode={episode} responsible={responsible} onComment={onComment} onRequestReview={onRequestReview} />}
      <AlertDialog open={confirmDissolve} onOpenChange={setConfirmDissolve}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Episode를 해체할까요?</AlertDialogTitle>
            <AlertDialogDescription>{episodeCode(episode.episodeId)}의 연결 Alert가 1건 이하로 남습니다. Episode가 해체되고 연결된 Alert {episode.alerts.length}건 모두 단독 Alert로 전환됩니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction onClick={submitUnlink}>Episode 해체 확인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
