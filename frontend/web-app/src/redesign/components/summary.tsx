import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Sparkle, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag } from './tags'

// Figma KPICard. label 14 · value 48 Bold · footer(caption 14 Semi Bold + note 14)
export type Kpi = { label: string; value: string; unit?: string; delta?: { text: string; good: boolean }; caption?: string; note?: string }
export function KpiCard({ kpi, className }: { kpi: Kpi; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-2 overflow-clip rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) p-4', className)}>
      <div className="flex shrink-0 items-center gap-2 overflow-clip">
        <p className="whitespace-nowrap text-[14px] leading-[1.4] text-(--rd-mute)">{kpi.label}</p>
        {kpi.delta && <span className={cn('rounded-[4px] bg-(--rd-bg) px-[6px] py-[2px] text-[12px] font-medium leading-4', kpi.delta.good ? 'text-(--rd-positive)' : 'text-(--rd-danger)')}>{kpi.delta.text}</span>}
      </div>
      <p className="shrink-0 whitespace-nowrap text-[48px] font-bold leading-[1.2] tracking-[-0.96px] text-(--rd-strong)">
        {kpi.value}
        {kpi.unit && <span className="ml-1 text-[24px] font-semibold tracking-normal">{kpi.unit}</span>}
      </p>
      <div className="flex w-full shrink-0 flex-col items-start gap-[6px] overflow-clip text-[14px] leading-[1.4]">
        {kpi.caption && <p className="w-full font-semibold text-(--rd-strong)">{kpi.caption}</p>}
        {kpi.note && <p className="whitespace-nowrap text-(--rd-mute)">{kpi.note}</p>}
      </div>
    </div>
  )
}

// Figma SummaryCard(AI 요약). headline 1줄 + 미니 막대 + 포인트 2~3줄 + 추정 패턴
const pointIcon = { alert: <TriangleAlert />, up: <ArrowUpRight />, down: <ArrowDownLeft /> } as const
export type AiSummaryData = {
  headline: string
  chartLabel: string
  chartValue: string
  /** 막대 높이(px, 최대 32). 마지막 막대가 강조색이다. */
  bars: number[]
  axis: [string, string]
  points: { icon: keyof typeof pointIcon; text: string }[]
  patterns: string[]
}
export function AiSummary({ data, className }: { data: AiSummaryData; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-2 overflow-clip rounded-[8px] border border-(--rd-brand-line) bg-(--rd-brand-subtle) p-4', className)}>
      <div className="flex w-full shrink-0 items-center gap-2">
        <Sparkle className="size-4 text-(--rd-info-strong)" />
        <p className="whitespace-nowrap text-[16px] font-semibold leading-[1.4] text-(--rd-info-strong)">AI 요약</p>
      </div>
      <p className="w-full shrink-0 text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">{data.headline}</p>
      <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-4 overflow-clip">
        {/* 카드가 내용보다 크면 막대 영역이 늘어나고 막대는 바닥에 붙는다 */}
        <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-1">
          <div className="flex w-full items-center justify-between whitespace-nowrap text-[14px] leading-[1.4]">
            <p className="text-(--rd-mute)">{data.chartLabel}</p>
            <p className="font-semibold text-(--rd-strong)">{data.chartValue}</p>
          </div>
          <div className="flex min-h-8 w-full flex-1 items-end gap-2" aria-hidden>
            {data.bars.map((height, index) => {
              const last = index === data.bars.length - 1
              return <div key={index} style={{ height }} className={cn('min-w-px flex-1 rounded-t-[4px]', last ? 'bg-(--rd-brand)' : 'bg-(--rd-subtle)')} />
            })}
          </div>
          <div className="flex w-full items-start justify-between whitespace-nowrap text-[14px] leading-[1.4] text-(--rd-mute)">
            <p>{data.axis[0]}</p>
            <p>{data.axis[1]}</p>
          </div>
        </div>
        <div className="flex w-full flex-col items-start gap-1">
          {data.points.map(point => (
            <div key={point.text} className="flex w-full items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
              {pointIcon[point.icon]}
              <p className="min-w-px flex-1 text-[14px] leading-[1.4] text-(--rd-strong)">{point.text}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex w-full shrink-0 items-center gap-1 whitespace-nowrap">
        <p className="text-[14px] leading-[1.4] text-(--rd-mute)">추정 패턴</p>
        {data.patterns.map(pattern => <Tag key={pattern} tone="neutral" className="text-(--rd-ink)">{pattern}</Tag>)}
      </div>
    </div>
  )
}

/** 패널 안의 작은 제목 줄 */
export function PanelLead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <p className="text-[14px] leading-[1.4] text-(--rd-strong)">{children}</p>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}
