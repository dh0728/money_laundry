import { useMemo } from 'react'
import { fetchEpisodes } from '@/api/episodes'
import { PageHeading } from '@/components/page'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { useAlertOverrides, withOverride } from '@/features/alerts/alertOverrides'
import EpisodeList from '@/features/episodes/EpisodeList'
import { useReviewRequests } from '@/features/episodes/reviewStore'
import { useAsync } from '@/lib/useAsync'
import { allAlertsNormal } from '@/mocks/alerts'
import { loadMockEpisodes } from '@/mocks/episodes'
import EpisodeDetailPage from './EpisodeDetailPage'

const live = import.meta.env.VITE_API_MODE === 'live'

const heading = <PageHeading title="Episode 목록" description="연결된 Alert를 묶어 조사 진행 상황을 확인합니다." />

type Props = { episodeId?: number; onOpen: (episodeId: number) => void; onBack: () => void; onOpenAlert: (alertId: number) => void }

export default function EpisodesPage({ episodeId, onOpen, onBack, onOpenAlert }: Props) {
  // mock: Alert 화면에서 연결·생성한 결과(메모리)를 반영해 Episode를 다시 묶는다
  const [overrides] = useAlertOverrides()
  const [requests] = useReviewRequests()
  const alerts = useMemo(() => (live ? [] : allAlertsNormal.content.map(row => withOverride(row, overrides))), [overrides])
  const { state, retry } = useAsync(() => (live ? fetchEpisodes({ size: 200 }) : loadMockEpisodes(alerts)), [overrides])

  if (episodeId) return <EpisodeDetailPage episodeId={episodeId} alerts={alerts} onBack={onBack} onOpenAlert={onOpenAlert} />

  if (state.status === 'loading') return <div className="space-y-4">{heading}<LoadingBlock label="Episode 목록" /></div>
  if (state.status === 'error') return <div className="space-y-4">{heading}<ErrorBlock message={state.message} onRetry={retry} /></div>
  const rows = state.data.content.map(row => (requests[row.episodeId] ? { ...row, reviewRequestedAt: requests[row.episodeId] } : row))
  if (!rows.length) return <div className="space-y-4">{heading}<EmptyBlock>아직 만든 Episode가 없습니다.</EmptyBlock></div>

  return (
    <div className="space-y-4">
      {heading}
      <EpisodeList rows={rows} onOpen={row => onOpen(row.episodeId)} />
    </div>
  )
}
