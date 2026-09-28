import { useMemo } from 'react'
import { toast } from 'sonner'
import { closeAlert, fetchAlert, fetchAlertHistory, type AlertRow, type HistoryRow } from '@/api/alerts'
import { createEpisode, linkAlertsToEpisode } from '@/api/episodes'
import { MOCK_USER } from '@/app/session'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import AlertDetail from '@/features/alerts/AlertDetail'
import type { VerdictSubmit } from '@/features/alerts/AlertReview'
import { alertCode, episodeCode } from '@/features/alerts/alertFilters'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import { linkableEpisodes, nextEpisodeId } from '@/features/alerts/episodeLink'
import { verdictOption, verdictResolution } from '@/features/alerts/verdict'
import { josa } from '@/lib/format'
import { useMemoryState } from '@/lib/memory'
import { useAsync } from '@/lib/useAsync'
import { loadMockAlertDetail } from '@/mocks/alertDetail'

const live = import.meta.env.VITE_API_MODE === 'live'

const loadLive = async (alertId: number) => {
  const [detail, history] = await Promise.all([fetchAlert(alertId), fetchAlertHistory(alertId)])
  return { detail, history }
}

type Props = { alertId: number; rows: AlertRow[]; onBack: () => void }

export default function AlertDetailPage({ alertId, rows, onBack }: Props) {
  const { state, retry } = useAsync(() => (live ? loadLive(alertId) : loadMockAlertDetail(alertId)), [alertId])
  const [overrides, setOverrides] = useAlertOverrides()
  const [extraHistory, setExtraHistory] = useAlertHistory(alertId)
  const episodes = useMemo(() => linkableEpisodes(rows), [rows])

  if (state.status === 'loading') return <LoadingBlock label={`${alertCode(alertId)} 상세`} />
  if (state.status === 'error') return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>Alert 목록으로</Button>
      <ErrorBlock message={state.message} onRetry={retry} />
    </div>
  )

  const alert = withOverride(state.data.detail, overrides)
  const history = [...extraHistory, ...state.data.history]
  const responsible = alert.assignee.userId === MOCK_USER.userId

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
        id: Date.now(), actor: { userId: MOCK_USER.userId, name: MOCK_USER.name, role: MOCK_USER.role }, action: resolution ? 'CLOSE' : verdict === 'new-episode' ? 'ESCALATE' : 'LINK',
        targetType: 'ALERT', targetId: alertId, relatedIds: target ? [target] : [], from: 'OPEN', to: override.status, resolution: resolution ?? null, comment, at: new Date().toISOString(),
      }, ...prev])
      toast.success(`${alertCode(alertId)} · ${option.result}${target && !resolution ? ` (${episodeCode(target)})` : ''}`, { description: '시연용 mock이라 서버에는 저장되지 않습니다.' })
    } catch {
      toast.error('판정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <AlertDetail
      alert={alert}
      history={history}
      responsible={responsible}
      assigneeNotice={responsible ? undefined : `현재 ${MOCK_USER.name} 계정으로 조회 중입니다. 판정은 담당자 ${alert.assignee.name}${josa(alert.assignee.name, '이', '가')} 합니다.`}
      episodes={episodes}
      onBack={onBack}
      onSubmit={submit}
    />
  )
}

// mock 전용: 이 화면에서 한 판정을 이력 맨 위에 보여 준다
function useAlertHistory(alertId: number) {
  return useMemoryState<HistoryRow[]>(`alert:${alertId}:history`, [])
}
