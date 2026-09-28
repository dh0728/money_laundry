import { PageHeading } from '@/components/page'
import { UnderTabs } from '@/components/UnderTabs'
import { dashboardToday } from '@/features/dashboard/dataSource'
import { InstitutionView } from '@/features/dashboard/InstitutionView'
import { PersonalView } from '@/features/dashboard/PersonalView'
import { useMemoryState } from '@/lib/memory'

type Scope = 'personal' | 'institution'

export default function DashboardPage() {
  // 상세에 다녀와도 보던 탭을 유지한다(새로고침하면 내 담당)
  const [scope, setScope] = useMemoryState<Scope>('dashboard:scope', 'personal')
  return (
    <div className="space-y-6">
      <PageHeading title="대시보드" description="담당 업무와 기관 탐지 현황을 확인합니다." />
      <UnderTabs value={scope} onChange={setScope} items={[{ value: 'personal', label: '내 담당' }, { value: 'institution', label: '기관 전체' }]} />
      {scope === 'personal' ? <PersonalView /> : <InstitutionView today={dashboardToday()} />}
    </div>
  )
}
