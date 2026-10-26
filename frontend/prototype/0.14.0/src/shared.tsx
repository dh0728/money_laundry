import React, { type ReactNode } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { ko } from 'date-fns/locale'
import { subDays, startOfMonth } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { riskColor, type Risk } from './domain'

export function IconButton({label,children,onClick,disabled,className}:{label:string;children:ReactNode;onClick?:()=>void;disabled?:boolean;className?:string}){return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick} className={className}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>}
export function UnderTabs({value,onChange,items}:{value:string;onChange:(v:string)=>void;items:{value:string;label:string}[]}){return <Tabs value={value} onValueChange={onChange}><TabsList variant="line" className="underline-tabs">{items.map(i=><TabsTrigger value={i.value} key={i.value}>{i.label}</TabsTrigger>)}</TabsList></Tabs>}
export function RiskBadge({risk,score}:{risk:Risk;score?:number}){return <Badge variant="outline" className="gap-1.5 font-normal" style={{color:riskColor[risk],borderColor:`${riskColor[risk]}40`}}>{score!==undefined&&<><span className="font-mono">{score}</span><span className="text-[10px] opacity-75">상위 {Math.max(1,100-score)}%</span></>}</Badge>}
export function PatternBadge({pattern,probability}:{pattern:string;probability:number}){return <Badge variant="secondary" className="font-mono font-normal text-[11px]">{pattern}<span className="ml-1.5 text-muted-foreground">{probability}%</span></Badge>}
export function DateRangeButton({value,onChange}:{value:DateRange|undefined;onChange:(r:DateRange|undefined)=>void}){
  const [open,setOpen]=React.useState(false),[draft,setDraft]=React.useState<DateRange|undefined>(value)
  const today=new Date(2026,8,16), preset=(days:number)=>setDraft({from:subDays(today,days-1),to:today})
  const label=value?.from?`${value.from.toLocaleDateString('sv-SE')} → ${value.to?.toLocaleDateString('sv-SE')??'종료일'}`:'기간'
  return <Popover open={open} onOpenChange={o=>{setOpen(o);if(o)setDraft(value)}}><div className="inline-flex shrink-0"><PopoverTrigger asChild><Button variant="outline" size="sm" className={`font-normal ${value?.from?'rounded-r-none':''}`}><CalendarDays className="size-3.5"/>{label}</Button></PopoverTrigger>{value?.from&&<Button variant="outline" size="icon" className="size-8 rounded-l-none border-l-0" aria-label="기간 초기화" onClick={()=>onChange(undefined)}><X className="size-3.5"/></Button>}</div><PopoverContent align="start" className="w-auto p-0"><div className="flex"><div className="w-32 border-r p-2 flex flex-col gap-1">{[['오늘',1],['최근 3일',3],['최근 7일',7],['최근 30일',30]].map(([l,d])=><Button key={l} variant="ghost" size="sm" className="justify-start font-normal" onClick={()=>preset(Number(d))}>{l}</Button>)}<Button variant="ghost" size="sm" className="justify-start font-normal" onClick={()=>setDraft({from:startOfMonth(today),to:today})}>이번 달</Button></div><Calendar locale={ko} mode="range" selected={draft} onSelect={setDraft} defaultMonth={draft?.from??new Date(2026,7,1)} today={today} numberOfMonths={1} className="max-h-80 overflow-y-auto"/></div><div className="border-t p-3 flex items-center justify-between gap-6"><span className="text-xs text-muted-foreground">{draft?.from?`${draft.from.toLocaleDateString('sv-SE')} → ${draft.to?.toLocaleDateString('sv-SE')??'종료일 선택'}`:'전체 기간'}</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>setOpen(false)}>취소</Button><Button size="sm" onClick={()=>{onChange(draft);setOpen(false)}}>적용</Button></div></div></PopoverContent></Popover>
}
export function FilterChip({children,onRemove}:{children:ReactNode;onRemove:()=>void}){return <Badge variant="secondary" className="h-7 rounded-full gap-1 pl-3 pr-1 font-normal">{children}<Button variant="ghost" size="icon" className="size-5 rounded-full" aria-label={`${children} 조건 제거`} onClick={onRemove}><X className="size-3"/></Button></Badge>}
export function SectionTitle({title,description,action}:{title:string;description?:string;action?:ReactNode}){return <div className="flex items-start justify-between gap-4 mb-5"><div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{description&&<p className="text-xs text-muted-foreground mt-1.5">{description}</p>}</div>{action}</div>}
