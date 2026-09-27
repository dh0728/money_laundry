import { PageHeading } from '@/components/page'

export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <PageHeading title={title} description="v24 시안을 웹앱으로 옮기는 중입니다." />
      <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">준비 중인 화면입니다.</p>
    </div>
  )
}
