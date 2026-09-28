import { useState } from 'react'
import { toast } from 'sonner'
import { fetchAlerts, type AlertRow } from '@/api/alerts'
import { createEpisode, linkAlertsToEpisode } from '@/api/episodes'
import { PageHeading } from '@/components/page'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import AlertList from '@/features/alerts/AlertList'
import { episodeCode } from '@/features/alerts/alertFilters'
import { applyEpisodeLink, nextEpisodeId, type EpisodeTarget } from '@/features/alerts/episodeLink'
import { useAsync } from '@/lib/useAsync'
import { loadMockAlerts } from '@/mocks/alerts'

const live = import.meta.env.VITE_API_MODE === 'live'
// mock Alert는 2026-09-26까지 있다
const today = () => (live ? new Date() : new Date(2026, 8, 26))

const heading = <PageHeading title="Alert 목록" description="탐지된 이상 거래를 검토하고 조사 대상을 확인합니다." />

export default function AlertsPage() {
  const { state, retry } = useAsync(() => (live ? fetchAlerts({ size: 200 }) : loadMockAlerts()), [])
  // mock에서 "Episode로 묶기" 결과를 화면에 남긴다. 실제 API는 요청 뒤 다시 조회한다.
  const [edited, setEdited] = useState<AlertRow[] | null>(null)

  if (state.status === 'loading') return <div className="space-y-4">{heading}<LoadingBlock label="Alert 목록" /></div>
  if (state.status === 'error') return <div className="space-y-4">{heading}<ErrorBlock message={state.message} onRetry={retry} /></div>
  const rows = edited ?? state.data.content
  if (!rows.length) return <div className="space-y-4">{heading}<EmptyBlock>배정된 Alert가 없습니다.</EmptyBlock></div>

  async function link(alertIds: number[], target: EpisodeTarget, comment: string) {
    try {
      if (live) {
        const episodeId = target === 'new' ? (await createEpisode(alertIds, comment)).episodeId : (await linkAlertsToEpisode(target, alertIds, comment), target)
        toast.success(`${alertIds.length}건을 ${episodeCode(episodeId)}에 연결했습니다.`)
        retry()
        return
      }
      const episodeId = target === 'new' ? nextEpisodeId(rows) : target
      setEdited(applyEpisodeLink(rows, alertIds, episodeId))
      toast.success(`${alertIds.length}건을 ${episodeCode(episodeId)}에 연결했습니다.`, { description: '시연용 mock이라 서버에는 저장되지 않습니다.' })
    } catch {
      toast.error('Episode 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <div className="space-y-4">
      {heading}
      <AlertList rows={rows} today={today()} onLink={link} onOpen={() => toast.info('Alert 상세 화면은 다음 작업에서 연결합니다.')} />
    </div>
  )
}
