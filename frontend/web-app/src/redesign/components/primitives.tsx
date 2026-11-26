import type { ComponentProps, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Figma Button. md = 아이콘 16 · 글자 16 Medium · padding 8 · radius 6, sm = 아이콘 12 · 글자 12 · padding 4 · radius 4
type Tone = 'ghost' | 'plain' | 'brand' | 'black' | 'gray' | 'danger' | 'disabled'
type ButtonLook = { size?: 'md' | 'sm'; tone?: Tone; iconStart?: ReactNode; iconEnd?: ReactNode }

const toneClass: Record<Tone, string> = {
  ghost: 'bg-(--rd-subtle) text-(--rd-ink) hover:bg-(--rd-hover)',
  plain: 'text-(--rd-ink) hover:bg-(--rd-hover)',
  brand: 'bg-(--rd-brand) text-(--rd-inv) font-semibold hover:brightness-95',
  black: 'bg-(--rd-ink) text-(--rd-inv) hover:opacity-90',
  gray: 'bg-(--rd-sub) text-(--rd-inv) hover:opacity-90',
  danger: 'bg-(--rd-danger) text-(--rd-inv) hover:opacity-90',
  disabled: 'bg-(--rd-hover) text-(--rd-mute)',
}

function buttonClass({ size = 'md', tone = 'ghost' }: ButtonLook, className?: string) {
  return cn(
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center overflow-clip whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-(--rd-brand-base) disabled:cursor-not-allowed',
    // leading-none 은 글자 크기 뒤에 둔다. 앞에 두면 tailwind-merge 가 글자 크기와 겹친다고 보고 지워서 버튼이 6px 높아진다.
    size === 'md' ? 'gap-2 rounded-[6px] p-2 text-[16px] leading-none font-medium [&_svg]:size-4' : 'gap-1 rounded-[4px] p-1 text-[12px] leading-none font-normal [&_svg]:size-3',
    toneClass[tone],
    className,
  )
}

export function Button({ size, tone, iconStart, iconEnd, className, children, type = 'button', ...props }: ComponentProps<'button'> & ButtonLook) {
  return (
    <button type={type} className={buttonClass({ size, tone }, className)} {...props}>
      {iconStart}
      {children != null && <span>{children}</span>}
      {iconEnd}
    </button>
  )
}

/** 화면을 옮기는 버튼. 주소가 있어 새 탭 열기·뒤로 가기가 그대로 동작한다. */
export function ButtonLink({ size, tone, iconStart, iconEnd, className, children, ...props }: ComponentProps<'a'> & ButtonLook) {
  return (
    <a className={buttonClass({ size, tone }, className)} {...props}>
      {iconStart}
      {children != null && <span>{children}</span>}
      {iconEnd}
    </a>
  )
}

// Figma SegmentedSwitch. 선택된 칸은 brand 배경 + Drop Shadow/200, 높이 28.
export type Segment<T extends string> = { key: T; label: string; href?: string }
export function SegmentedSwitch<T extends string>({ items, value, onChange, label }: { items: Segment<T>[]; value: T; onChange?: (key: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="relative flex shrink-0 items-center justify-center gap-[2px] rounded-[8px] bg-(--rd-subtle) p-[2px] shadow-(--rd-inner-200)">
      {items.map(item => {
        const selected = item.key === value
        const className = cn(
          'flex h-7 min-w-[60px] shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[6px] px-3 text-[14px] font-semibold leading-none outline-none focus-visible:ring-2 focus-visible:ring-(--rd-brand-base)',
          selected ? 'bg-(--rd-brand) text-(--rd-inv) shadow-(--rd-shadow-200)' : 'bg-(--rd-subtle) text-(--rd-sub) hover:bg-(--rd-hover)',
        )
        return item.href ? (
          <a key={item.key} role="tab" aria-selected={selected} href={item.href} className={className}>{item.label}</a>
        ) : (
          <button key={item.key} type="button" role="tab" aria-selected={selected} onClick={() => onChange?.(item.key)} className={className}>{item.label}</button>
        )
      })}
    </div>
  )
}

// Figma Checkbox. 16×16, radius 4. 테두리 색은 놓인 곳(표 = brand, 카드 = 카드 상태색)을 따른다.
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (next: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={event => { event.stopPropagation(); onChange(!checked) }}
      className={cn(
        'flex size-4 shrink-0 cursor-pointer items-center justify-center overflow-clip rounded-[4px] border border-(--rd-brand-base) outline-none focus-visible:ring-2 focus-visible:ring-(--rd-brand-base)',
        checked ? 'border-(--rd-brand) bg-(--rd-brand) text-(--rd-inv)' : 'bg-(--rd-bg)',
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  )
}

// Figma Switch Field
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors', checked ? 'justify-end bg-(--rd-brand)' : 'justify-start bg-(--rd-line)')}
    >
      <span className="size-[18px] rounded-full bg-(--rd-bg)" />
    </button>
  )
}
