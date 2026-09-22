import type { CSSProperties, ReactNode, Ref } from 'react'
import { Badge } from '@/components/ui/badge'

export function StagePanel({ title, count, description, testId, bodyTestId, bodyClassName = '', children }: {
  title: string; count: number; description: string; testId: string; bodyTestId?: string; bodyClassName?: string; children: ReactNode
}) {
  return <section data-testid={testId} className="transaction-stage min-w-0 self-start overflow-hidden rounded-xl border bg-card">
    <header className="border-b px-4 py-3">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{title}</h2><Badge variant="secondary">{count}</Badge></div>
      <p className="mt-1 truncate text-[var(--text-micro-size)] text-muted-foreground" title={description}>{description}</p>
    </header>
    <div data-testid={bodyTestId} className={`p-2 ${bodyClassName}`}>{children}</div>
  </section>
}

export function StageItem({ active, primary, secondary, trailing, mono = false, testId, itemRef, onSelect }: {
  active: boolean; primary: string; secondary: string; trailing?: ReactNode; mono?: boolean; testId?: string; itemRef?: Ref<HTMLButtonElement>; onSelect: () => void
}) {
  return <button ref={itemRef} data-testid={testId} type="button" aria-pressed={active} onClick={onSelect} className="transaction-stage-item w-full rounded-lg px-3 py-3 text-left hover:bg-muted/60">
    <span className="flex items-center justify-between gap-2"><span title={primary} className={mono ? 'block truncate font-mono text-sm' : 'block truncate text-sm font-medium'}>{primary}</span>{trailing}</span>
    <span className="mt-1 block truncate text-[var(--text-micro-size)] text-muted-foreground" title={secondary}>{secondary}</span>
  </button>
}

export function OrthogonalConnector({ id, sourceIndex, targetCount, targetOffset }: {
  id: string; sourceIndex: number; targetCount: number; targetOffset: number
}) {
  // Panel border + header + body padding + half of the 64px item.
  const sourceY = 1 + 69 + 8 + 32 + Math.max(0, sourceIndex) * 64
  return <div data-testid={id} aria-hidden="true" className={`transaction-connector ${id}`}>
    {Array.from({ length: targetCount }, (_, index) => <i key={index} data-testid={`${id}-edge-${index}`} className="transaction-connector-edge" style={{ '--source-y': `${sourceY}px`, '--target-y': `${targetOffset + index * 64}px` } as CSSProperties}><b /></i>)}
  </div>
}
