import { PageHeading } from '@/components/page'
import { PlannedBlock } from '@/components/Provenance'

export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <PageHeading title={title} description="v24 시안을 웹앱으로 옮기는 중입니다." />
      <PlannedBlock>준비 중인 화면입니다.</PlannedBlock>
    </div>
  )
}
