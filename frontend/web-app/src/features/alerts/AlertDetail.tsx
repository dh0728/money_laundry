// v24 Detail.tsx(kind=Alert)를 옮김. 그래프 탭은 v24 자금 흐름 그래프를 그대로 옮겼다(features/graph/v24).
import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CaseActivityCharts } from './CaseActivityCharts'
import type { AlertDetail as AlertDetailData, HistoryRow } from '@/api/alerts'
import { alertResolutionLabels, typeDisplay, type TypeCode } from '@/api/codes'
import { PatternBadge, RiskBadge, StatusBadge } from '@/components/badges'
import { CaseHeader, CaseStats } from '@/features/alerts/CasePresentation'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useMemoryState } from '@/lib/memory'
import { Panel } from './DetailPanels'
import { historyLabels } from './detailText'
import { alertCode, episodeCode } from './alertFilters'
import AlertReview, { type VerdictSubmit } from './AlertReview'
import AlertTxTable from './AlertTxTable'
import { toGraphModel } from '@/features/graph/adapter'
import Graph from '@/features/graph/v24/Graph'
import TxLabelPanel from '@/features/graph/TxLabelPanel'
import { applyRelabels, type TxRelabels } from '@/features/graph/relabel'
import type { RelationGraph } from '@/api/graph'
import { moneyMetrics, sumBy, usd } from './metrics'

export type DetailTab = 'overview' | 'graph' | 'transactions' | 'review'

const basisLabels = { TIME: '시간', ACCOUNT: '계좌', BANK: '은행', PATH: '경로' } as const

type Props = {
  alert: AlertDetailData
  graph: RelationGraph
  relabels: TxRelabels
  onRelabel: (txId: number, label: 0 | 1, reason: string) => void
  history: HistoryRow[]
  responsible: boolean
  assigneeNotice?: string
  episodes: number[]
  onOpenEpisode: (episodeId: number) => void
  onSubmit: (submit: VerdictSubmit) => void
  onExcludeTransactions?: (txIds: number[], reason: string) => void
}

export default function AlertDetail({ alert, graph, relabels, onRelabel, history, responsible, assigneeNotice, episodes, onOpenEpisode, onSubmit, onExcludeTransactions }: Props) {
  const [tab, setTab] = useMemoryState<DetailTab>(`alert:${alert.alertId}:tab`, 'overview')
  const [scoreTxId, setScoreTxId] = useState<number | null>(null)
  const [selectingTransactions, setSelectingTransactions] = useState(false)
  const [selectedTxIds, setSelectedTxIds] = useState<number[]>([])
  const [excludeReason, setExcludeReason] = useState('')
  const [confirmExclude, setConfirmExclude] = useState(false)
  // 사람이 바꾼 거래 판정을 반영한다(표·그래프 공통)
  const tx = useMemo(() => applyRelabels(alert.transactions, relabels), [alert.transactions, relabels])
  const graphModel = useMemo(() => toGraphModel(graph, alert.transactions, relabels), [graph, alert.transactions, relabels])
  const metrics = moneyMetrics(tx, alert.subjectAccount.account)
  const daily = sumBy(tx, t => t.txAt.slice(5, 10), t => t.amountUsd).sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ day: d.name, amount: Math.round(d.v) }))
  const senders = sumBy(tx, t => t.fromAccount, t => t.amountUsd).slice(0, 5)
  const times = tx.map(t => t.txAt).sort()
  const span = times.length ? `${times[0].slice(5, 10)} ~ ${times[times.length - 1].slice(5, 10)}` : '—'
  const scoredTx = tx.filter(row => row.typeProbabilities)
  const selectedScoreTx = scoredTx.find(row => row.txId === scoreTxId) ?? scoredTx[0]
  const patternCandidates = Object.entries(selectedScoreTx?.typeProbabilities ?? {})
    .map(([code, score]) => ({ code: Number(code) as TypeCode, score }))
    .filter((candidate): candidate is { code: TypeCode; score: number } => candidate.score != null && Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score || a.code - b.code)
  const submitExclude = () => {
    if (!selectedTxIds.length || !excludeReason.trim()) return
    onExcludeTransactions?.(selectedTxIds, excludeReason.trim())
    setConfirmExclude(false)
    setSelectingTransactions(false)
    setSelectedTxIds([])
    setExcludeReason('')
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <CaseHeader id={alertCode(alert.alertId)} title={`${typeDisplay(alert.primaryType.code).label} · 대표 계좌 ${alert.subjectAccount.account}`} tab={tab} onTab={setTab} count={tx.length}
        action={alert.episodeId != null && <Button variant="outline" size="sm" onClick={() => onOpenEpisode(alert.episodeId!)}>연결된 Episode {episodeCode(alert.episodeId)}</Button>}
        notice={assigneeNotice} tags={<><StatusBadge status={alert.status} /><RiskBadge score={alert.riskScore} /><PatternBadge code={alert.primaryType.code} />
          {alert.resolution && <Badge variant="outline">{alertResolutionLabels[alert.resolution]}</Badge>}
          <Badge variant="outline">담당 {alert.assignee.name}</Badge><Badge variant="outline">탐지 {alert.createdAt.slice(0, 10)}</Badge></>} />

      {tab === 'overview' && (
        <div className="space-y-4" data-testid="overview">
          <CaseStats items={[
              { label: '투입 원금', value: usd(metrics.principal) },
              { label: '거래 총액', value: usd(metrics.total) },
              { label: '순유입 (대표 계좌)', value: metrics.netInflow === null ? '—' : usd(metrics.netInflow) },
              { label: '근거 거래', value: `${tx.length}건` },
              { label: '참여 계좌', value: `${alert.accountCount}개 · 은행 ${alert.bankCount}곳` },
              { label: '거래 기간', value: span },
            ]} />
          <CaseActivityCharts amounts={{ USD: { daily, senders } }} />
          <div className="grid items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-4 [&>[data-slot=card]]:h-auto [&>[data-slot=card]>[data-slot=card-content]]:h-auto">
            <Panel title="묶음 근거" description="이 거래들이 한 Alert가 된 이유" testId="grouping">
              <ul className="space-y-2 text-xs">
                {alert.groupingBasis.map(b => <li key={`${b.basis}-${b.value}`} className="flex items-center gap-2"><Badge variant="outline" className="font-normal">{basisLabels[b.basis]}</Badge><span className="min-w-0 truncate">{b.value}</span></li>)}
              </ul>
            </Panel>
            <Panel title="거래별 패턴 후보" description="mock 예시" testId="pattern-candidates">
              {scoredTx.length > 0 ? <>
                <p className="mt-1 text-xs text-muted-foreground">선택 거래의 모델 점수이며 Alert 전체 확률이 아닙니다.</p>
                {selectedScoreTx && <div className="relative mt-2"><select aria-label="확률을 볼 거래" className="w-full appearance-none rounded-md border bg-background py-2 pl-2 pr-10 text-xs" value={selectedScoreTx.txId} onChange={event => setScoreTxId(Number(event.target.value))}>{scoredTx.map(row => <option key={row.txId} value={row.txId}>T-{row.txId}{row.role === 'SEED' ? ' · 씨앗 거래' : ''}</option>)}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div>}
                <ol aria-label="거래 패턴 후보" className="mt-3 space-y-1.5 text-xs">{patternCandidates.map((candidate, index) => <li key={candidate.code} className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="w-4 shrink-0 text-muted-foreground">{index + 1}.</span><PatternBadge code={candidate.code} /><strong className="tabular-nums">{(candidate.score * 100).toFixed(1)}%</strong></li>)}</ol>
              </> : <p className="text-xs text-muted-foreground">표시할 거래별 패턴 후보가 없습니다.</p>}
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

      {tab === 'graph' && <Graph key={alert.alertId} model={graphModel} label={`${alertCode(alert.alertId)} 관계 그래프`}
        panelExtra={focus => <TxLabelPanel model={graphModel} focus={focus} editable={responsible && alert.status === 'OPEN'} onRelabel={onRelabel} />} />}
      {tab === 'transactions' && <div className="space-y-3">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={!responsible || !onExcludeTransactions}
            onClick={() => { setSelectingTransactions(value => !value); setSelectedTxIds([]); setExcludeReason('') }}>
            {selectingTransactions ? '선택 취소' : '거래 선택'}
          </Button>
          {selectingTransactions && <Button size="sm" disabled={!selectedTxIds.length || !excludeReason.trim()} onClick={() => setConfirmExclude(true)}>선택 거래 제외</Button>}
        </div>
        {selectingTransactions && <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3">
          <label className="min-w-48 flex-1 text-xs">거래 제외 사유
            <textarea aria-label="거래 제외 사유" className="mt-1 min-h-9 w-full rounded-md border bg-background p-2 text-sm" maxLength={4000}
              value={excludeReason} onChange={event => setExcludeReason(event.target.value)} placeholder="선택 거래를 제외하는 이유" />
          </label>
        </div>}
        <AlertTxTable rows={tx} selection={selectingTransactions ? { ids: selectedTxIds, onToggle: id => setSelectedTxIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]) } : undefined} />
      </div>}
      {tab === 'review' && <AlertReview alert={alert} responsible={responsible} episodes={episodes} onSubmit={onSubmit} />}
      <AlertDialog open={confirmExclude} onOpenChange={setConfirmExclude}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>선택 거래를 제외할까요?</AlertDialogTitle>
            <AlertDialogDescription>{alertCode(alert.alertId)}의 조사 대상에서 거래 {selectedTxIds.length}건을 제외합니다. 제외 후 Alert의 거래 건수와 금액이 다시 계산됩니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction onClick={submitExclude}>거래 제외 확인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
