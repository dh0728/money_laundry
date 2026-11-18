import type { CSSProperties, ReactNode } from 'react'
import { PanelLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './primitives'

// Figma panel. header 48 · content padding 16 · footer 48.
// 디자인에서 header 와 footer 는 패널 폭과 상관없이 370px 고정이라(아래 선도 370까지만) 그대로 옮겼다.
type PanelProps = {
  title: string
  headerLeft?: ReactNode
  headerRight?: ReactNode
  footer?: ReactNode
  onExpand?: () => void
  onClose?: () => void
  /** 머리줄에 넣을 것이 370px 에 안 들어갈 때만 패널 폭 전체를 쓴다 */
  wideHeader?: boolean
  hideFooter?: boolean
  className?: string
  contentClassName?: string
  style?: CSSProperties
  children?: ReactNode
}

export function Panel({ title, headerLeft, headerRight, footer, onExpand, onClose, wideHeader, hideFooter, className, contentClassName, style, children }: PanelProps) {
  return (
    <section aria-label={title} style={style} className={cn('relative flex min-w-0 flex-col items-start border border-(--rd-line) bg-(--rd-subtle)', className)}>
      <header className={cn('flex h-12 max-w-full shrink-0 items-center justify-between border-b border-(--rd-line) px-3 py-2', wideHeader ? 'w-full' : 'w-[370px]')}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button size="sm" aria-label={`${title} 패널 크게 보기`} onClick={onExpand} iconStart={<PanelLeft />} />
          <h3 className="shrink-0 truncate text-[16px] font-semibold leading-[1.4] text-(--rd-ink)">{title}</h3>
          <div className="flex h-5 min-w-0 flex-1 items-center gap-2">{headerLeft}</div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 pl-4">
          {headerRight}
          <Button size="sm" aria-label={`${title} 패널 닫기`} onClick={onClose} iconStart={<X />} />
        </div>
      </header>
      <div className={cn('flex min-h-0 w-full flex-1 flex-col gap-2 p-4', contentClassName)}>{children}</div>
      {!hideFooter && <footer className="flex h-12 w-[370px] max-w-full shrink-0 items-center justify-end gap-2 border-t border-(--rd-line) px-4 py-2">{footer}</footer>}
    </section>
  )
}
