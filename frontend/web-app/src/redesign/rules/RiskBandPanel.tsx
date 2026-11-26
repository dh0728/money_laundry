import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from '../components/Panel'
import { Button } from '../components/primitives'
import { Tag, type TagTone } from '../components/tags'

// Figma "위험 점수 구간" 패널. 모델 점수(0~1)를 낮음 · 주의 · 위험으로 나누는 두 경계값을 손잡이로 옮긴다.
// 시안은 0.7 손잡이가 0.65 자리에 그려져 있다. 여기서는 값과 같은 자리에 둔다.
export type Bands = { caution: number; danger: number }
const defaults: Bands = { caution: 0.7, danger: 0.9 }
/** 두 손잡이 사이, 그리고 양 끝과 띄워 두는 간격 */
const gap = 0.05
const round = (value: number) => Math.round(value * 100) / 100
const show = (value: number) => String(round(value))
const percent = (value: number) => `${value * 100}%`

const clamp = (bands: Bands, which: keyof Bands, value: number): Bands =>
  which === 'caution'
    ? { ...bands, caution: round(Math.min(Math.max(value, gap), bands.danger - gap)) }
    : { ...bands, danger: round(Math.min(Math.max(value, bands.caution + gap), 1 - gap)) }

function Handle({ which, bands, onMove, track }: { which: keyof Bands; bands: Bands; onMove: (next: Bands) => void; track: RefObject<HTMLDivElement | null> }) {
  const value = bands[which]
  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !track.current) return
    const box = track.current.getBoundingClientRect()
    onMove(clamp(bands, which, (event.clientX - box.left) / box.width))
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = (event.shiftKey ? 0.05 : 0.01) * (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0)
    if (step === 0) return
    event.preventDefault()
    onMove(clamp(bands, which, value + step))
  }
  return (
    <>
      <p style={{ left: percent(value) }} className="absolute top-0 -translate-x-1/2 text-[12px] font-semibold leading-[normal] text-(--rd-strong)">{show(value)}</p>
      <button type="button" role="slider" aria-label={which === 'caution' ? '주의 시작 점수' : '위험 시작 점수'} aria-valuemin={0} aria-valuemax={1} aria-valuenow={value}
        style={{ left: percent(value) }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={drag} onKeyDown={nudge}
        className="absolute top-[18px] size-4 -translate-x-1/2 cursor-ew-resize touch-none rounded-full border-2 border-(--rd-brand-base) bg-(--rd-brand) outline-none focus-visible:ring-2 focus-visible:ring-(--rd-brand-base) focus-visible:ring-offset-1" />
    </>
  )
}

function Band({ tone, name, range }: { tone: TagTone; name: string; range: string }) {
  return (
    <div className="flex h-5 items-center gap-[6px]">
      {/* 태그 숫자는 구간에 든 Alert 수 자리다. 시안이 1234 로 비워 둔 값이라 그대로 둔다. */}
      <Tag tone={tone} icon={<TriangleAlert />} className="px-1 py-1"><span>1234</span><span>{name}</span></Tag>
      <p className="whitespace-nowrap text-[12px] leading-[normal] text-(--rd-strong)">{range}</p>
    </div>
  )
}

/** saved = 저장된 경계값(없으면 기본값). 손잡이를 옮긴 값은 저장을 눌러야 onSave 로 나간다. */
export function RiskBandPanel({ saved = defaults, onSave, className }: { saved?: Bands; onSave: (next: Bands) => void; className?: string }) {
  const [bands, setBands] = useState<Bands>(saved)
  const track = useRef<HTMLDivElement>(null)
  const changed = bands.caution !== saved.caution || bands.danger !== saved.danger

  return (
    <Panel title="위험 점수 구간" className={cn('overflow-clip', className)}
      headerRight={<>
        <Button size="sm" tone="gray" onClick={() => setBands(defaults)}>기본값으로 되돌리기</Button>
        <Button size="sm" tone={changed ? 'brand' : 'disabled'} disabled={!changed} onClick={() => onSave(bands)}>저장</Button>
      </>}>
      <div className="flex w-full flex-col items-start gap-3">
        <div ref={track} className="relative h-[34px] w-full">
          <div className="absolute inset-x-0 top-[22px] flex h-2 overflow-clip rounded-[4px]" aria-hidden>
            <div style={{ width: percent(bands.caution) }} className="h-full bg-(--rd-positive)" />
            <div style={{ width: percent(bands.danger - bands.caution) }} className="h-full bg-(--rd-caution)" />
            <div className="h-full min-w-px flex-1 bg-(--rd-danger)" />
          </div>
          <p className="absolute left-0 top-0 text-[12px] leading-[normal] text-(--rd-strong)">0</p>
          <p className="absolute right-0 top-0 text-[12px] leading-[normal] text-(--rd-strong)">1.0</p>
          <Handle which="caution" bands={bands} onMove={setBands} track={track} />
          <Handle which="danger" bands={bands} onMove={setBands} track={track} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Band tone="positiveSolid" name="낮음" range={`${show(bands.caution)} 미만`} />
          <Band tone="unread" name="주의" range={`${show(bands.caution)} 이상 ${show(bands.danger)} 미만`} />
          <Band tone="negative" name="위험" range={`${show(bands.danger)} 이상 1.0 이하`} />
        </div>
      </div>
    </Panel>
  )
}
