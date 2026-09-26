import { useState } from 'react'
import { PageHeading } from '@/components/page'
import { UnderTabs } from '@/components/UnderTabs'
import { dashboardToday } from '@/features/dashboard/dataSource'
import { InstitutionView } from '@/features/dashboard/InstitutionView'
import { PersonalView } from '@/features/dashboard/PersonalView'

type Scope = 'personal' | 'institution'

export default function DashboardPage() {
  const [scope, setScope] = useState<Scope>('personal')
  return (
    <div className="space-y-6">
      <PageHeading title="대시보드" description="담당 업무와 기관 탐지 현황을 확인합니다." />
      <UnderTabs value={scope} onChange={setScope} items={[{ value: 'personal', label: '내 담당' }, { value: 'institution', label: '기관 전체' }]} />
      {scope === 'personal' ? <PersonalView /> : <InstitutionView today={dashboardToday()} />}
    </div>
  )
}
