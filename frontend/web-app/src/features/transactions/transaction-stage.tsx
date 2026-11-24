import type { CSSProperties, ReactNode, Ref } from 'react'
import { Badge } from '@/components/ui/badge'
import { Box, Heading, Text } from '@/components/layout-primitives'

export function StagePanel({ title, count, description, testId, bodyTestId, bodyClassName = '', children }: {
  title: string; count: number | undefined; description?: string; testId: string; bodyTestId?: string; bodyClassName?: string; children: ReactNode
}) {
  return <Box as="section" data-testid={testId} className="transaction-stage min-w-0 self-start overflow-hidden rounded-xl border bg-card">
    <Box as="header" className="border-b px-4 py-3">
      <Box className="flex items-center justify-between gap-3"><Heading className="text-sm font-semibold">{title}</Heading><Badge variant="secondary">{count ?? '—'}</Badge></Box>
      {description && <Text className="mt-1 truncate text-[var(--text-micro-size)] text-muted-foreground" title={description}>{description}</Text>}
    </Box>
    <Box data-testid={bodyTestId} className={`p-2 ${bodyClassName}`}>{children}</Box>
  </Box>
}

export function StageItem({ active, primary, secondary, trailing, mono = false, testId, itemRef, onSelect }: {
  active: boolean; primary: string; secondary: ReactNode; trailing?: ReactNode; mono?: boolean; testId?: string; itemRef?: Ref<HTMLButtonElement>; onSelect: () => void
}) {
  return <button ref={itemRef} data-testid={testId} type="button" aria-pressed={active} onClick={onSelect} className="transaction-stage-item w-full rounded-lg px-3 py-3 text-left hover:bg-(--hover-surface)">
    <Text as="span" className="flex items-center justify-between gap-2"><Text as="span" title={primary} className={mono ? 'block truncate font-mono text-sm' : 'block truncate text-sm font-medium'}>{primary}</Text>{trailing}</Text>
    {typeof secondary === 'string'
      ? <Text as="span" className="mt-1 block truncate text-[var(--text-micro-size)] text-muted-foreground" title={secondary}>{secondary}</Text>
      : <Text as="span" className="mt-1.5 flex flex-wrap items-center gap-1">{secondary}</Text>}
  </button>
}

export function OrthogonalConnector({ id, sourceIndex, targetCount, targetOffset, activeTargetIndex = -1 }: {
  id: string; sourceIndex: number; targetCount: number; targetOffset: number; activeTargetIndex?: number
}) {
  // Panel border + header + body padding + half of the 64px item.
  const sourceY = 1 + 69 + 8 + 32 + Math.max(0, sourceIndex) * 64
  return <Box data-testid={id} aria-hidden="true" className={`transaction-connector ${id}`}>
    {Array.from({ length: targetCount }, (_, index) => <Text as="i" key={index} data-testid={`${id}-edge-${index}`} data-active={index === activeTargetIndex} className="transaction-connector-edge" style={{ '--source-y': `${sourceY}px`, '--target-y': `${targetOffset + index * 64}px` } as CSSProperties}><Text as="b" /></Text>)}
  </Box>
}
