// 개수 배지(탭·알림 공통). 빨강은 위험도 표시에만 쓰므로 무채색으로 둔다(2026-09-28 김명기 결정).
export function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span aria-label={`${label} ${count}건`} data-testid="count-badge" className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {count}
    </span>
  )
}
