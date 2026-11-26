import { useEffect, useId, useState } from 'react'
import { ChevronDown, Download, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './primitives'

// Figma JudgeDialog (480 폭). 판정(단일 Alert·Episode)과 묶기(여러 Alert → Episode) 두 가지 내용으로 쓴다.
export type JudgeDialogSpec = {
  mode: 'judge' | 'bundle'
  title: string
  description: string
  /** 대상 목록. 한 줄에 하나씩, 사이에 선을 긋는다. */
  targets: string[]
  noteLabel: string
  notePlaceholder: string
}

const fieldClass = 'w-full rounded-[8px] border border-(--rd-mute) bg-(--rd-bg) px-3 text-[16px] text-(--rd-strong) outline-none placeholder:text-(--rd-mute) focus-visible:border-(--rd-brand-base)'

export function JudgeDialog({ spec, onClose }: { spec: JudgeDialogSpec; onClose: () => void }) {
  const titleId = useId()
  const [verdict, setVerdict] = useState<'normal' | 'abnormal'>('abnormal')
  const [choice, setChoice] = useState('')
  const [note, setNote] = useState('')
  const judge = spec.mode === 'judge'
  // 시안의 첫 버튼은 꺼진 모습이다. 고를 것을 골라야 켜진다(묶기는 기본값 "새 Episode 만들기"가 있어 이유만 적으면 된다).
  const ready = judge ? choice !== '' : note.trim() !== ''

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[167px]">
      <div className="absolute inset-0 bg-(--rd-bg)/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex w-[480px] max-w-[calc(100vw-32px)] flex-col overflow-clip rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) shadow-[0_16px_32px_-8px_#0c0c0d33]">
        <header className="flex h-12 shrink-0 items-center justify-between pl-4 pr-2">
          <h2 id={titleId} className="text-[16px] font-semibold leading-[1.4] text-(--rd-ink)">{spec.title}</h2>
          <Button aria-label="닫기" onClick={onClose} iconStart={<X />} />
        </header>
        <div className="h-px w-full bg-(--rd-line)" />
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[14px] leading-[1.4] text-(--rd-ink)">{spec.description}</p>
          <ul className="flex flex-col px-3">
            {spec.targets.map((target, index) => (
              <li key={target} className={cn('py-[6px] text-[16px] leading-[1.4] text-(--rd-strong)', index > 0 && 'border-t border-(--rd-line)')}>{target}</li>
            ))}
          </ul>
          {judge && (
            <div role="radiogroup" aria-label="판정" className="flex flex-col gap-2 py-2">
              {([['normal', '정상'], ['abnormal', '이상']] as const).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-3 text-[16px] text-(--rd-strong)">
                  <input type="radio" name={`${titleId}-verdict`} checked={verdict === key} onChange={() => setVerdict(key)} className="size-4 accent-(--rd-brand)" />
                  {label}
                </label>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-[16px] leading-[1.4] text-(--rd-ink)">{judge ? '판정 사유' : '묶을 곳'}</span>
            <span className="relative">
              <select value={choice} onChange={event => setChoice(event.target.value)} className={cn(fieldClass, 'h-10 cursor-pointer appearance-none pr-9', choice === '' && judge && 'text-(--rd-mute)')}>
                {judge
                  ? <><option value="">사유 선택</option><option value="pattern">패턴 일치</option><option value="rule">룰 적중</option><option value="normal-business">정상 영업 거래</option><option value="etc">기타</option></>
                  : <><option value="">새 Episode 만들기</option><option value="E-261111-000008">E-261111-000008</option><option value="E-261111-000009">E-261111-000009</option></>}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-(--rd-strong)" />
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[16px] leading-[1.4] text-(--rd-ink)">{spec.noteLabel}</span>
            <textarea value={note} onChange={event => setNote(event.target.value)} placeholder={spec.notePlaceholder} rows={2} className={cn(fieldClass, 'min-h-16 py-3')} />
          </label>
        </div>
        <div className="h-px w-full bg-(--rd-line)" />
        <footer className="grid h-12 shrink-0 grid-cols-3 gap-2 p-2">
          <Button tone={ready ? 'brand' : 'disabled'} disabled={!ready} onClick={onClose} className="h-8 w-full">{judge ? '판정 완료' : '묶기'}</Button>
          <Button tone="black" onClick={onClose} className="h-8 w-full">취소</Button>
          <Button tone="disabled" disabled iconStart={<Download />} className="h-8 w-full">보고서 다운로드</Button>
        </footer>
      </div>
    </div>
  )
}
