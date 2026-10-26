import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { SectionTitle } from '@/components/page'

/** fe/work 검토 의견의 본문/참고 정보 배치를 두 데이터 모드에서 공유한다. */
export function ReviewLayout({ children, reference }: { children: ReactNode; reference: ReactNode }) {
  return <div className="grid flex-1 items-stretch gap-4 @5xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="review-layout">
    <Card className="h-full w-full shadow-none"><CardContent className="flex h-full flex-col gap-6">{children}</CardContent></Card>
    <Card className="h-full shadow-none" data-testid="review-reference"><CardContent><SectionTitle title="참고 정보" description="판단 전에 대조할 조사 요약" />{reference}</CardContent></Card>
  </div>
}
