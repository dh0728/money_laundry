import { typeDisplay, type TypeCode, type AlertStatus } from '@/api/codes'
import { ExternalLink } from 'lucide-react'
import { AgeBadge, RiskBadge, PatternBadge, StatusBadge } from '@/components/badges'
import { Badge } from '@/components/ui/badge'

export type LinkedAlertItem = { id: number; risk: number | null; types: string[]; age?: number; detail: string; amount: string; status: string }
export function LinkedAlerts({ rows, selection, onOpen }: {
 rows: LinkedAlertItem[]; selection?: { ids: number[]; toggle: (id: number) => void; disabled?: boolean }
 onOpen?: (id: number) => void
}) {
 return <div className="divide-y rounded-md border">{rows.map(row => {
  const content = <><span className="font-mono">A-{row.id}</span>{row.risk == null ? <span>—</span> : <RiskBadge score={row.risk} />}<span className="flex flex-wrap gap-1">{row.types.map(type => { const code = Array.from({ length: 9 }, (_, i) => i as TypeCode).find(code => typeDisplay(code).label === type || typeDisplay(code).key === type); return code == null ? <Badge key={type} variant="outline">{type}</Badge> : <PatternBadge key={type} code={code} /> })}</span><span className="col-span-3 flex min-w-0 items-center gap-2 @3xl:col-span-1">{row.age != null && <AgeBadge days={row.age} />}<span className="truncate text-muted-foreground">{row.detail}</span></span><span className="tabular-nums @3xl:text-right">{row.amount}</span>{['OPEN', 'CLOSED', 'ESCALATED'].includes(row.status) ? <StatusBadge status={row.status as AlertStatus} /> : <Badge variant="outline">{row.status}</Badge>}{onOpen && <ExternalLink className="size-3.5 text-muted-foreground" />}</>
  const cls = 'grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 text-left text-xs @3xl:grid-cols-[88px_72px_160px_minmax(0,1fr)_110px_90px_16px] @3xl:gap-3'
  return selection ? <label key={row.id} className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 interactive-surface ${selection.ids.includes(row.id) ? 'bg-muted/40' : ''}`}><input type="checkbox" aria-label={`연결 해제 Alert A-${row.id}`} disabled={selection.disabled} checked={selection.ids.includes(row.id)} onChange={() => selection.toggle(row.id)} /><span className={cls}>{content}</span></label>
    : onOpen ? <button key={row.id} type="button" aria-label={`A-${row.id} 상세 보기`} onClick={() => onOpen(row.id)} className={`${cls} w-full px-3 py-2.5 outline-none interactive-surface focus-visible:ring-2 focus-visible:ring-ring`}>{content}</button>
    : <div key={row.id} className={`${cls} px-3 py-2.5`}>{content}</div>
 })}</div>
}
