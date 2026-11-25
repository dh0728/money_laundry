import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../components/primitives'
import { actionLabel, type RuleAction } from './model'

// Figma ReasonDialog (480 폭). 승인 · 반려 · 중지 전에 사유를 받는다. 사유를 적어야 첫 버튼이 켜진다.
export function ReasonDialog({ action, target, onConfirm, onClose }: { action: RuleAction; target: string; onConfirm: (reason: string) => void; onClose: () => void }) {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const ready = reason.trim() !== ''
  const name = actionLabel[action]

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-(--rd-bg)/60 backdrop-blur-[4px]" onClick={onClose} aria-hidden />
      <form role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={event => { event.preventDefault(); if (ready) onConfirm(reason.trim()) }}
        className="relative flex w-[480px] max-w-[calc(100vw-32px)] flex-col overflow-clip rounded-[8px] border border-(--rd-line) bg-(--rd-subtle) shadow-[0_16px_32px_-8px_#0c0c0d33]">
        <header className="flex h-12 shrink-0 items-center justify-between pl-4 pr-2">
          <h2 id={titleId} className="text-[16px] font-semibold leading-[1.4] text-(--rd-strong)">{name} 사유</h2>
          <Button aria-label="닫기" onClick={onClose} iconStart={<X />} />
        </header>
        <div className="h-px w-full bg-(--rd-line)" />
        <div className="flex flex-col p-4">
          <textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} placeholder="사유를 적어 주세요" aria-label={`${target} ${name} 사유`}
            className="min-h-20 w-full rounded-[8px] border border-(--rd-mute) bg-(--rd-bg) px-4 py-3 text-[16px] leading-[1.4] text-(--rd-strong) outline-none placeholder:text-(--rd-mute) focus-visible:border-(--rd-brand-base)" />
        </div>
        <div className="h-px w-full bg-(--rd-line)" />
        <footer className="grid h-12 shrink-0 grid-cols-2 gap-2 p-2">
          <Button type="submit" tone={ready ? 'brand' : 'disabled'} disabled={!ready} className="h-8 w-full">{name}</Button>
          <Button tone="black" onClick={onClose} className="h-8 w-full">취소</Button>
        </footer>
      </form>
    </div>
  )
}
