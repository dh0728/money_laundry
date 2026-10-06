import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function LoadingBlock({ label }: { label: string }) {
  return <div role="status" aria-label={`${label} 불러오는 중`} className="space-y-3 rounded-lg border p-4">
    {[0, 1, 2].map(index => <div key={index} className="flex items-center gap-3"><span className="size-8 shrink-0 animate-pulse rounded-full bg-muted" /><span className="h-4 w-full animate-pulse rounded bg-muted" style={{ maxWidth: `${85 - index * 13}%` }} /></div>)}
  </div>
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card role="alert" className="shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">데이터를 불러오지 못했습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>다시 시도</Button>
      </CardContent>
    </Card>
  )
}

export function EmptyBlock({ children }: { children: string }) {
  return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">{children}</p>
}
