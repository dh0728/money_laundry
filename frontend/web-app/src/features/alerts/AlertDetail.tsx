// v24 Detail.tsx(kind=Alert)를 옮김. 그래프 탭은 v24 자금 흐름 그래프를 그대로 옮겼다(features/graph/0.24.0).
import { useMemo, useState } from 'react'
import { Download, TriangleAlert } from 'lucide-react'
import TimeGraph from '@/features/graph/timeline/TimeGraph'
import RedesignOverview, { overviewFacts } from './RedesignOverview'
import ExportDialog from './ExportDialog'
import { AgeBadge } from '@/components/badges'
import { UnderTabs } from '@/components/UnderTabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AlertDetail as AlertDetailData, HistoryRow } from '@/api/alerts'
import { alertResolutionLabels, typeDisplay } from '@/api/codes'
import { PatternBadge, RiskBadge, StatusBadge } from '@/components/badges'
import { CaseHeader } from '@/features/alerts/CasePresentation'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useMemoryState } from '@/lib/memory'
import { alertCode, episodeCode } from './alertFilters'
import AlertReview, { type VerdictSubmit } from './AlertReview'
import AlertTxTable from './AlertTxTable'
import { applyRelabels, type TxRelabels } from '@/features/graph/relabel'
import type { RelationGraph } from '@/api/graph'

export type DetailTab = 'overview' | 'graph' | 'transactions' | 'review'


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

export default function AlertDetail({ alert, relabels, history, responsible, assigneeNotice, episodes, onOpenEpisode, onSubmit, onExcludeTransactions }: Props) {
  const [tab, setTab] = useMemoryState<DetailTab>(`alert:${alert.alertId}:tab`, 'overview')
  const [selectingTransactions, setSelectingTransactions] = useState(false)
  const [selectedTxIds, setSelectedTxIds] = useState<number[]>([])
  const [excludeReason, setExcludeReason] = useState('')
  const [confirmExclude, setConfirmExclude] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [graphSeen, setGraphSeen] = useState(false)
  if (tab === 'graph' && !graphSeen) setGraphSeen(true)
  const [txView, setTxView] = useState<'tx' | 'accounts'>('tx')
  // 사람이 바꾼 거래 판정을 반영한다(표·그래프 공통)
  const tx = useMemo(() => applyRelabels(alert.transactions, relabels), [alert.transactions, relabels])
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
        action={<span className="ml-auto flex gap-2">{alert.episodeId != null && <Button variant="outline" size="sm" onClick={() => onOpenEpisode(alert.episodeId!)}>연결된 Episode {episodeCode(alert.episodeId)}</Button>}<Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="size-4" />내보내기</Button></span>}
        notice={<span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-foreground" style={{ backgroundColor: 'color-mix(in oklab, var(--risk-6) 30%, transparent)' }}><TriangleAlert className="size-3.5" />09-25 은행 보고가 아직 다 들어오지 않았습니다. 금액·거래 수가 늘어날 수 있습니다.{assigneeNotice && ` · ${assigneeNotice}`}</span>}
        tags={<><StatusBadge status={alert.status} /><RiskBadge score={alert.riskScore} /><Badge variant="outline" className="border-dashed font-normal text-muted-foreground" title="실제 모델(MONEY17-146) 연결 전까지 표시">시연용 임의 점수</Badge><PatternBadge code={alert.primaryType.code} />
          {alert.resolution && <Badge variant="outline">{alertResolutionLabels[alert.resolution]}</Badge>}
          <Badge variant="outline">담당 {alert.assignee.name}</Badge><Badge variant="outline">탐지 {alert.createdAt.slice(0, 10)}</Badge><AgeBadge days={alert.ageDays} /><Badge variant="outline" className="font-normal">근거 v2</Badge><Badge variant="outline" className="font-mono font-normal">demo-random-v1</Badge></>} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} code={alertCode(alert.alertId)} txCount={tx.length} seedCount={overviewFacts(alert).seeds.length} />

      {tab === 'overview' && <RedesignOverview alert={{ ...alert, transactions: tx }} history={history} onAccounts={() => { setTxView('accounts'); setTab('transactions') }} />}
      {/* 탭을 바꿔도 그래프 위치·카메라·선택을 유지한다(§6.1): 한 번 연 뒤에는 숨기기만 한다 */}
      {graphSeen && <div className={tab === 'graph' ? '' : 'hidden'}><TimeGraph rows={tx} context={{ kind: 'alert', code: alertCode(alert.alertId) }} /></div>}
      {tab === 'transactions' && <div className="space-y-3">
        <div className="flex items-center justify-between gap-2"><UnderTabs value={txView} onChange={setTxView} items={[{ value: 'tx', label: '거래', count: tx.length }, { value: 'accounts', label: '계좌', count: alert.accounts.length }]} /></div>
        {txView === 'accounts' ? <Table><TableHeader><TableRow><TableHead>계좌</TableHead><TableHead>은행</TableHead><TableHead>역할</TableHead><TableHead className="text-right">유입</TableHead><TableHead className="text-right">유출</TableHead><TableHead className="text-right">상대 계좌</TableHead></TableRow></TableHeader><TableBody>{alert.accounts.map(a => <TableRow key={a.account}><TableCell className="font-mono text-xs">{a.account}</TableCell><TableCell>{a.bank}</TableCell><TableCell>{a.role}</TableCell><TableCell className="text-right tabular-nums">{a.inCount}건 · {Math.round(a.inAmountUsd).toLocaleString()}$</TableCell><TableCell className="text-right tabular-nums">{a.outCount}건 · {Math.round(a.outAmountUsd).toLocaleString()}$</TableCell><TableCell className="text-right tabular-nums">{a.counterpartyCount}</TableCell></TableRow>)}</TableBody></Table> : <>
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
        </>}
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
