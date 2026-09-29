import { toast } from 'sonner'
import type { AlertRow, HistoryRow } from '@/api/alerts'
import { fetchEpisodeGraph } from '@/api/graph'
import { commentEpisode, fetchEpisode, fetchEpisodeTransactions } from '@/api/episodes'
import { useCurrentUser, canEditOpen } from '@/app/session'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { episodeCode } from '@/features/alerts/alertFilters'
import EpisodeDetail from '@/features/episodes/EpisodeDetail'
import { useEpisodeHistory, useReviewRequests } from '@/features/episodes/reviewStore'
import { useAsync } from '@/lib/useAsync'
import { relabelComment, relabelText, useTxRelabels } from '@/features/graph/relabel'
import { loadMockEpisode } from '@/mocks/episodes'
import { live, mockSavedNote } from '@/lib/apiMode'


const loadLive = async (episodeId: number) => {
  const [detail, transactions, graph] = await Promise.all([fetchEpisode(episodeId), fetchEpisodeTransactions(episodeId), fetchEpisodeGraph(episodeId, 0)])
  return { detail, transactions: transactions.content, graph }
}

type Props = { episodeId: number; alerts: AlertRow[]; onOpenAlert: (alertId: number) => void }

export default function EpisodeDetailPage({ episodeId, alerts, onOpenAlert }: Props) {
  const currentUser = useCurrentUser()
  // mock은 목록 화면에서 방금 연결한 결과까지 반영한 Alert로 계산한다
  const alertKey = alerts.map(a => `${a.alertId}:${a.episodeId}`).join()
  const { state, retry } = useAsync(() => (live ? loadLive(episodeId) : loadMockEpisode(episodeId, alerts.length ? alerts : undefined)), [episodeId, alertKey])
  const [requests, setRequests] = useReviewRequests()
  const [extraHistory, setExtraHistory] = useEpisodeHistory(episodeId)
  const [relabels, setRelabels] = useTxRelabels()

  if (state.status === 'loading') return <LoadingBlock label={`${episodeCode(episodeId)} 상세`} />
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />

  const episode = { ...state.data.detail, reviewRequestedAt: requests[episodeId] ?? state.data.detail.reviewRequestedAt }
  const history = [...extraHistory, ...episode.history]
  const responsible = canEditOpen(currentUser, episode.assignee.userId, episode.status)

  const record = (action: HistoryRow['action'], comment: string) => setExtraHistory(prev => [{
    id: Date.now(), actor: { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }, action,
    targetType: 'EPISODE', targetId: episodeId, relatedIds: [], from: 'OPEN', to: 'OPEN', resolution: null, comment, at: new Date().toISOString(),
  }, ...prev])

  async function comment(text: string) {
    try {
      if (live) { await commentEpisode(episodeId, text); toast.success('조사 의견을 남겼습니다.'); retry(); return }
      record('COMMENT', text)
      toast.success('조사 의견을 남겼습니다.', { description: mockSavedNote })
    } catch {
      toast.error('의견을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  function requestReview(text: string) {
    // FE 제안: API.md에 검수 넘김 요청이 없어 실제 서버 모드에서도 보내지 않는다
    if (live) { toast.info('검수 넘김은 Backend 계약 정리 전이라 아직 보낼 수 없습니다.'); return }
    setRequests(prev => ({ ...prev, [episodeId]: new Date().toISOString() }))
    record('REVIEW_REQUEST', text)
    toast.success(`${episodeCode(episodeId)} · 관리자에게 검수를 넘겼습니다.`, { description: mockSavedNote })
  }

  // FE 제안: 사람이 거래의 의심/정상 판정을 바꾼다. API가 없어 실제 서버 모드에서는 보내지 않는다.
  function relabel(txId: number, label: 0 | 1, reason: string) {
    if (live) { toast.info('거래 판정 전환은 Backend 계약 정리 전이라 아직 보낼 수 없습니다.'); return }
    setRelabels(prev => ({ ...prev, [txId]: { label, reason, at: new Date().toISOString(), actor: currentUser.name } }))
    record('TX_RELABEL', relabelComment(txId, label, reason))
    toast.success(`거래 ${txId}를 ${relabelText(label)}로 전환했습니다.`, { description: mockSavedNote })
  }

  return (
    <EpisodeDetail
      relabels={relabels}
      onRelabel={relabel}
      episode={episode}
      graph={state.data.graph}
      transactions={state.data.transactions}
      history={history}
      responsible={responsible}
      onOpenAlert={onOpenAlert}
      onComment={comment}
      onRequestReview={requestReview}
    />
  )
}
