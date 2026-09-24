// shadcn 공식 block `dashboard-01`의 section-cards를 그대로 가져왔다. 바뀐 것은 데이터·문구·아이콘 라이브러리(lucide)뿐.
import { TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export type SectionCardItem = { label: string; value: string; delta?: number; unit?: string; trend: string; note: string }

export function SectionCards({ items }: { items: SectionCardItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl:grid-cols-2 @5xl:grid-cols-4 dark:*:data-[slot=card]:bg-card" data-testid="institution-metrics">
      {items.map(item => {
        // 비교 기준이 없는 지표(delta 없음)는 증감 배지·아이콘을 숨긴다
        const Icon = item.delta === undefined ? null : item.delta >= 0 ? TrendingUp : TrendingDown
        return (
          <Card key={item.label} className="@container/card">
            <CardHeader>
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{item.value}</CardTitle>
              {Icon && item.delta !== undefined && (
                <CardAction>
                  <Badge variant="outline">
                    <Icon />
                    {item.delta >= 0 ? '+' : ''}{item.delta}{item.unit ?? '%'}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                {item.trend} {Icon && <Icon className="size-4" />}
              </div>
              <div className="text-muted-foreground">{item.note}</div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
