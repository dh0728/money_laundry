import { useMemo } from 'react'
import { toast } from 'sonner'
import { closeAlert, fetchAlert, fetchAlertHistory, type AlertRow, type HistoryRow } from '@/api/alerts'
import { createEpisode, linkAlertsToEpisode } from '@/api/episodes'
import { fetchAlertGraph } from '@/api/graph'
import { useCurrentUser, canEditOpen } from '@/app/session'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import AlertDetail from '@/features/alerts/AlertDetail'
import type { VerdictSubmit } from '@/features/alerts/AlertReview'
import { alertCode, episodeCode } from '@/features/alerts/alertFilters'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import { linkableEpisodes, nextEpisodeId } from '@/features/alerts/episodeLink'
import { verdictOption, verdictResolution } from '@/features/alerts/verdict'
import { josa } from '@/lib/format'
import { useMemoryState } from '@/lib/memory'
import { useAsync } from '@/lib/useAsync'
import { relabelComment, relabelText, useTxRelabels } from '@/features/graph/relabel'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import { live, mockSavedNote } from '@/lib/apiMode'


const loadLive = async (alertId: number) => {
  const [detail, history, graph] = await Promise.all([fetchAlert(alertId), fetchAlertHistory(alertId), fetchAlertGraph(alertId)])
  return { detail, history, graph }
}

type Props = { alertId: number; rows: AlertRow[]; onOpenEpisode: (episodeId: number) => void }

export default function AlertDetailPage({ alertId, rows, onOpenEpisode }: Props) {
  const currentUser = useCurrentUser()
  const { state, retry } = useAsync(() => (live ? loadLive(alertId) : loadMockAlertDetail(alertId)), [alertId])
  const [overrides, setOverrides] = useAlertOverrides()
  const [extraHistory, setExtraHistory] = useAlertHistory(alertId)
  const [relabels, setRelabels] = useTxRelabels()
  const episodes = useMemo(() => linkableEpisodes(rows), [rows])

  if (state.status === 'loading') return <LoadingBlock label={`${alertCode(alertId)} 상세`} />
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />

  const alert = withOverride(state.data.detail, overrides)
  const history = [...extraHistory, ...state.data.history]
  const responsible = canEditOpen(currentUser, alert.assignee.userId, alert.status)

  async function submit({ verdict, comment, episodeId }: VerdictSubmit) {
    const option = verdictOption(verdict)
    try {
      if (live) {
        if (option.proposal) { toast.info('이 판정은 Backend 계약 정리 전이라 아직 보낼 수 없습니다.'); return }
        if (verdict === 'normal') await closeAlert(alertId, 'NORMAL', comment)
        else if (verdict === 'link-episode' && episodeId) await linkAlertsToEpisode(episodeId, [alertId], comment)
        else if (verdict === 'new-episode') await createEpisode([alertId], comment)
        toast.success(`${alertCode(alertId)} · ${option.result}`)
        retry()
        return
      }
      const resolution = verdictResolution[verdict]
      const target = verdict === 'new-episode' ? nextEpisodeId(rows) : episodeId
      const override = resolution ? { status: 'CLOSED' as const, resolution, episodeId: null } : { status: 'ESCALATED' as const, resolution: null, episodeId: target ?? null }
      setOverrides(prev => ({ ...prev, [alertId]: override }))
      setExtraHistory(prev => [{
        id: Date.now(), actor: { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }, action: resolution ? 'CLOSE' : verdict === 'new-episode' ? 'ESCALATE' : 'LINK',
        targetType: 'ALERT', targetId: alertId, relatedIds: target ? [target] : [], from: 'OPEN', to: override.status, resolution: resolution ?? null, comment, at: new Date().toISOString(),
      }, ...prev])
      toast.success(`${alertCode(alertId)} · ${option.result}${target && !resolution ? ` (${episodeCode(target)})` : ''}`, { description: mockSavedNote })
    } catch {
      toast.error('판정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  // FE 제안: 사람이 거래의 의심/정상 판정을 바꾼다. API가 없어 실제 서버 모드에서는 보내지 않는다.
  function relabel(txId: number, label: 0 | 1, reason: string) {
    if (live) { toast.info('거래 판정 전환은 Backend 계약 정리 전이라 아직 보낼 수 없습니다.'); return }
    const at = new Date().toISOString()
    setRelabels(prev => ({ ...prev, [txId]: { label, reason, at, actor: currentUser.name } }))
    setExtraHistory(prev => [{
      id: Date.now(), actor: { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }, action: 'TX_RELABEL',
      targetType: 'ALERT', targetId: alertId, relatedIds: [txId], from: relabelText(label === 1 ? 0 : 1), to: relabelText(label), resolution: null, comment: relabelComment(txId, label, reason), at,
    }, ...prev])
    toast.success(`거래 ${txId}를 ${relabelText(label)}로 전환했습니다.`, { description: mockSavedNote })
  }

  return (
    <AlertDetail
      relabels={relabels}
      onRelabel={relabel}
      alert={alert}
      graph={state.data.graph}
      history={history}
      responsible={responsible}
      assigneeNotice={responsible ? undefined : `현재 ${currentUser.name} 계정으로 조회 중입니다. 판정은 담당자 ${alert.assignee.name}${josa(alert.assignee.name, '이', '가')} 합니다.`}
      episodes={episodes}
      onOpenEpisode={onOpenEpisode}
      onSubmit={submit}
    />
  )
}

// mock 전용: 이 화면에서 한 판정을 이력 맨 위에 보여 준다
function useAlertHistory(alertId: number) {
  return useMemoryState<HistoryRow[]>(`alert:${alertId}:history`, [])
}
