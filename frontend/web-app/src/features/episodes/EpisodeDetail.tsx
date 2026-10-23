import EpisodeOverview from './EpisodeOverview'
import TimeGraph from '@/features/graph/timeline/TimeGraph'
// v24 Detail.tsx(kind=Episode)를 옮김. 연결 Alert·탐지 유형·근거 출처가 중심이다(v23 요구).
// 그래프 탭은 v24 자금 흐름 그래프를 그대로 옮겼다(features/graph/v24).
import { useMemo, useState } from 'react'
import type { HistoryRow } from '@/api/alerts'
import { typeDisplay } from '@/api/codes'
import type { EpisodeDetail as EpisodeDetailData, EpisodeTransaction } from '@/api/episodes'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { CaseHeader } from '@/features/alerts/CasePresentation'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import AlertTxTable from '@/features/alerts/AlertTxTable'
import { episodeCode } from '@/features/alerts/alertFilters'
import { useMemoryState } from '@/lib/memory'
import EpisodeReview from './EpisodeReview'
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

export default function EpisodeDetail({ episode, transactions: modelTransactions, relabels, history, responsible, onOpenAlert, onComment, onRequestReview, onUnlinkAlerts }: Props) {
  const [tab, setTab] = useMemoryState<Tab>(`episode:${episode.episodeId}:tab`, 'overview')
  const [graphSeen, setGraphSeen] = useState(false)
  if (tab === 'graph' && !graphSeen) setGraphSeen(true)
  const [selectedAlertIds, setSelectedAlertIds] = useState<number[]>([])
  const [unlinkReason, setUnlinkReason] = useState('')
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const transactions = useMemo(() => applyRelabels(modelTransactions, relabels), [modelTransactions, relabels])
  // Episode 금액은 거래 ID로 중복을 없애 계산한다(v23)
  const requestUnlink = (ids: number[], reason: string) => {
    if (!responsible || !onUnlinkAlerts || !ids.length || !reason.trim()) return false
    if (episode.alerts.length - ids.length < 2) {
      setSelectedAlertIds(ids); setUnlinkReason(reason.trim()); setConfirmDissolve(true)
      return false
    }
    onUnlinkAlerts(ids, reason.trim())
    return true
  }
  const submitUnlink = () => {
    if (!responsible || !onUnlinkAlerts || !selectedAlertIds.length || !unlinkReason.trim()) return
    onUnlinkAlerts?.(selectedAlertIds, unlinkReason.trim())
    setConfirmDissolve(false)
    setSelectedAlertIds([])
    setUnlinkReason('')
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <CaseHeader id={episodeCode(episode.episodeId)} title={`${episode.primaryTypes.map(t => typeDisplay(t.code).label).join(' · ')} · Alert ${episode.alertCount}건`} tab={tab} onTab={setTab} count={transactions.length}
        tags={<><EpisodeStatusBadge status={episode.status} reviewRequested={Boolean(episode.reviewRequestedAt)} /><RiskBadge score={episode.riskScore} />
          <Badge variant="outline" className="border-dashed font-normal text-muted-foreground" title="실제 모델(MONEY17-146) 연결 전까지 표시">시연용 임의 점수</Badge>{episode.primaryTypes.map(type => <PatternBadge key={type.code} code={type.code} />)}<Badge variant="outline">담당 {episode.assignee.name}</Badge><Badge variant="outline">생성 {episode.createdAt.slice(0, 10)}</Badge></>} />

      {tab === 'overview' && <EpisodeOverview episode={episode} transactions={transactions} history={history} responsible={responsible} onOpenAlert={onOpenAlert} onUnlink={onUnlinkAlerts ? requestUnlink : undefined} />}

      {/* 탭을 바꿔도 그래프 위치·카메라·선택을 유지한다(§6.1): 한 번 연 뒤에는 숨기기만 한다 */}
      {graphSeen && <div className={tab === 'graph' ? '' : 'hidden'}><TimeGraph rows={transactions} context={{ kind: 'episode', code: episodeCode(episode.episodeId) }} /></div>}
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
            <AlertDialogAction disabled={!responsible || !onUnlinkAlerts} onClick={submitUnlink}>Episode 해체 확인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
