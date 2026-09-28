import { toast } from 'sonner'
import type { AlertRow, HistoryRow } from '@/api/alerts'
import { commentEpisode, fetchEpisode, fetchEpisodeTransactions } from '@/api/episodes'
import { MOCK_USER } from '@/app/session'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { episodeCode } from '@/features/alerts/alertFilters'
import EpisodeDetail from '@/features/episodes/EpisodeDetail'
import { useEpisodeHistory, useReviewRequests } from '@/features/episodes/reviewStore'
import { useAsync } from '@/lib/useAsync'
import { loadMockEpisode } from '@/mocks/episodes'
import { live, mockSavedNote } from '@/lib/apiMode'


const loadLive = async (episodeId: number) => {
  const [detail, transactions] = await Promise.all([fetchEpisode(episodeId), fetchEpisodeTransactions(episodeId)])
  return { detail, transactions: transactions.content }
}

type Props = { episodeId: number; alerts: AlertRow[]; onBack: () => void; onOpenAlert: (alertId: number) => void }

export default function EpisodeDetailPage({ episodeId, alerts, onBack, onOpenAlert }: Props) {
  // mock은 목록 화면에서 방금 연결한 결과까지 반영한 Alert로 계산한다
  const alertKey = alerts.map(a => `${a.alertId}:${a.episodeId}`).join()
  const { state, retry } = useAsync(() => (live ? loadLive(episodeId) : loadMockEpisode(episodeId, alerts.length ? alerts : undefined)), [episodeId, alertKey])
  const [requests, setRequests] = useReviewRequests()
  const [extraHistory, setExtraHistory] = useEpisodeHistory(episodeId)

  if (state.status === 'loading') return <LoadingBlock label={`${episodeCode(episodeId)} 상세`} />
  if (state.status === 'error') return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>Episode 목록으로</Button>
      <ErrorBlock message={state.message} onRetry={retry} />
    </div>
  )

  const episode = { ...state.data.detail, reviewRequestedAt: requests[episodeId] ?? state.data.detail.reviewRequestedAt }
  const history = [...extraHistory, ...episode.history]
  const responsible = episode.assignee.userId === MOCK_USER.userId

  const record = (action: HistoryRow['action'], comment: string) => setExtraHistory(prev => [{
    id: Date.now(), actor: { userId: MOCK_USER.userId, name: MOCK_USER.name, role: MOCK_USER.role }, action,
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

  return (
    <EpisodeDetail
      episode={episode}
      transactions={state.data.transactions}
      history={history}
      responsible={responsible}
      onBack={onBack}
      onOpenAlert={onOpenAlert}
      onComment={comment}
      onRequestReview={requestReview}
    />
  )
}
