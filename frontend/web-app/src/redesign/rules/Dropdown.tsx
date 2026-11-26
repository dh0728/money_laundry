import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '../components/primitives'

// Figma 조건 블록의 고르기 버튼(sm · 회색 바탕 · 오른쪽 화살표). 누르면 아래로 목록이 열린다.
type Option<T> = { key: T; label: string }
type DropdownProps<T> = {
  /** 무엇을 고르는지(스크린 리더용) */
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (key: T) => void
  tone?: 'gray' | 'black'
  /** 버튼에 보이는 글자를 고른 값과 다르게 적을 때("24시간" → "24시간 안에") */
  display?: (option: Option<T>) => string
}

export function Dropdown<T extends string | number>({ label, value, options, onChange, tone = 'gray', display }: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = options.find(option => option.key === value)
  const text = current ? (display ? display(current) : current.label) : ''

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onPointer); window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={box} className="relative shrink-0">
      <Button size="sm" tone={tone} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${text}`} onClick={() => setOpen(was => !was)} iconEnd={<ChevronDown />}>{text}</Button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute left-0 top-full z-20 mt-1 flex min-w-full flex-col gap-[2px] rounded-[4px] border border-(--rd-line) bg-(--rd-bg) p-1 shadow-(--rd-shadow-200)">
          {options.map(option => {
            const selected = option.key === value
            return (
              <li key={option.key} role="option" aria-selected={selected}>
                <button type="button" onClick={() => { onChange(option.key); setOpen(false) }}
                  className={cn('w-full cursor-pointer whitespace-nowrap rounded-[4px] px-2 py-1 text-left text-[12px] leading-4 text-(--rd-strong) outline-none hover:bg-(--rd-hover) focus-visible:bg-(--rd-hover)', selected && 'bg-(--rd-brand-subtle) font-medium text-(--rd-brand-text)')}>
                  {option.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
