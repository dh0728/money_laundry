import { typeDisplay, type TypeCode, type AlertStatus } from '@/api/codes'
import { ExternalLink } from 'lucide-react'
import { AgeBadge, RiskBadge, PatternBadge, StatusBadge } from '@/components/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeCheckbox } from '@/components/ui/checkbox'
import { Box, Text } from '@/components/layout-primitives'

export type LinkedAlertItem = { id: number; risk: number | null; types: string[]; age?: number; detail: string; amount: string; status: string }

const linkedAlertGrid = 'grid min-w-0 flex-1 grid-cols-linked-alert-compact items-center gap-x-2 gap-y-1 text-left text-xs @3xl:grid-cols-linked-alert-expanded @3xl:gap-3'
export function LinkedAlerts({ rows, selection, onOpen }: {
 rows: LinkedAlertItem[]; selection?: { ids: number[]; toggle: (id: number) => void; disabled?: boolean }
 onOpen?: (id: number) => void
}) {
 return <Box className="divide-y rounded-md border">{rows.map(row => {
  const content = <><Text as="span" className="font-mono">A-{row.id}</Text>{row.risk == null ? <Text as="span">—</Text> : <RiskBadge score={row.risk} />}<Text as="span" className="flex flex-wrap gap-1">{row.types.map(type => { const code = Array.from({ length: 9 }, (_, i) => i as TypeCode).find(code => typeDisplay(code).label === type || typeDisplay(code).key === type); return code == null ? <Badge key={type} variant="outline">{type}</Badge> : <PatternBadge key={type} code={code} /> })}</Text><Text as="span" className="col-span-3 flex min-w-0 items-center gap-2 @3xl:col-span-1">{row.age != null && <AgeBadge days={row.age} />}<Text as="span" className="truncate text-muted-foreground">{row.detail}</Text></Text><Text as="span" className="tabular-nums @3xl:text-right">{row.amount}</Text>{['OPEN', 'CLOSED', 'ESCALATED'].includes(row.status) ? <StatusBadge status={row.status as AlertStatus} /> : <Badge variant="outline">{row.status}</Badge>}{onOpen && <ExternalLink className="size-3.5 text-muted-foreground" />}</>
  return selection ? <Box as="label" key={row.id} className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 interactive-surface ${selection.ids.includes(row.id) ? 'bg-muted/40' : ''}`}><NativeCheckbox aria-label={`연결 해제 Alert A-${row.id}`} disabled={selection.disabled} checked={selection.ids.includes(row.id)} onChange={() => selection.toggle(row.id)} /><Text as="span" className={linkedAlertGrid}>{content}</Text></Box>
    : onOpen ? <Button key={row.id} layout="row" type="button" aria-label={`A-${row.id} 상세 보기`} onClick={() => onOpen(row.id)} className={linkedAlertGrid}>{content}</Button>
    : <Box key={row.id} className={`${linkedAlertGrid} px-3 py-2.5`}>{content}</Box>
 })}</Box>
}
