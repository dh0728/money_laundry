import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function LoadingBlock({ label }: { label: string }) {
  return <p role="status" className="rounded-lg border border-dashed px-4 py-10 text-center text-xs text-muted-foreground">{label} 불러오는 중…</p>
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
