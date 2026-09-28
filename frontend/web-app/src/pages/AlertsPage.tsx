import { useMemo } from 'react'
import { toast } from 'sonner'
import { fetchAlerts } from '@/api/alerts'
import { createEpisode, linkAlertsToEpisode } from '@/api/episodes'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import AlertList from '@/features/alerts/AlertList'
import { episodeCode } from '@/features/alerts/alertFilters'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import { episodeLinkOverrides, nextEpisodeId, type EpisodeTarget } from '@/features/alerts/episodeLink'
import { useAsync } from '@/lib/useAsync'
import { loadMockAlerts } from '@/mocks/alerts'
import AlertDetailPage from './AlertDetailPage'
import { live, mockSavedNote } from '@/lib/apiMode'

// mock Alert는 2026-09-26까지 있다
const today = () => (live ? new Date() : new Date(2026, 8, 26))


type Props = { alertId?: number; onOpen: (alertId: number) => void; onOpenEpisode: (episodeId: number) => void }

export default function AlertsPage({ alertId, onOpen, onOpenEpisode }: Props) {
  const { state, retry } = useAsync(() => (live ? fetchAlerts({ size: 200 }) : loadMockAlerts()), [])
  const [overrides, setOverrides] = useAlertOverrides()
  const rows = useMemo(() => (state.status === 'success' ? state.data.content.map(row => withOverride(row, overrides)) : []), [state, overrides])

  // 상세는 목록과 따로 불러온다. 목록은 Episode 연결 대상 고르기에만 쓴다.
  if (alertId) return <AlertDetailPage alertId={alertId} rows={rows} onOpenEpisode={onOpenEpisode} />

  if (state.status === 'loading') return <div className="space-y-4"><LoadingBlock label="Alert 목록" /></div>
  if (state.status === 'error') return <div className="space-y-4"><ErrorBlock message={state.message} onRetry={retry} /></div>
  if (!rows.length) return <div className="space-y-4"><EmptyBlock>배정된 Alert가 없습니다.</EmptyBlock></div>

  async function link(alertIds: number[], target: EpisodeTarget, comment: string) {
    try {
      if (live) {
        const episodeId = target === 'new' ? (await createEpisode(alertIds, comment)).episodeId : (await linkAlertsToEpisode(target, alertIds, comment), target)
        toast.success(`${alertIds.length}건을 ${episodeCode(episodeId)}에 연결했습니다.`)
        retry()
        return
      }
      const episodeId = target === 'new' ? nextEpisodeId(rows) : target
      setOverrides(prev => ({ ...prev, ...episodeLinkOverrides(rows, alertIds, episodeId) }))
      toast.success(`${alertIds.length}건을 ${episodeCode(episodeId)}에 연결했습니다.`, { description: mockSavedNote })
    } catch {
      toast.error('Episode 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <div className="space-y-4">
      
      <AlertList rows={rows} today={today()} onLink={link} onOpen={row => onOpen(row.alertId)} />
    </div>
  )
}
