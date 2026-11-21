import { UnderTabs } from '@/components/UnderTabs'
import { dashboardToday } from '@/features/dashboard/dataSource'
import { InstitutionView } from '@/features/dashboard/InstitutionView'
import { PersonalView } from '@/features/dashboard/PersonalView'
import { useMemoryState } from '@/lib/memory'
import { isoDate } from '@/lib/format'
import { DashboardFreshness } from '@/features/dashboard/Freshness'

type Scope = 'personal' | 'institution'

export default function DashboardPage() {
  // 상세에 다녀와도 보던 탭을 유지한다(새로고침하면 기관 전체)
  const [scope, setScope] = useMemoryState<Scope>('dashboard:scope:v2', 'institution')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><UnderTabs value={scope} onChange={setScope} items={[{ value: 'institution', label: '기관 전체' }, { value: 'personal', label: '내 담당' }]} /><DashboardFreshness businessDate={isoDate(dashboardToday())} /></div>
      {scope === 'personal' ? <PersonalView /> : <InstitutionView today={dashboardToday()} />}
    </div>
  )
}
