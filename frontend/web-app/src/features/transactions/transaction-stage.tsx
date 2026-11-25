import type { CSSProperties, ReactNode, Ref } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Box, Heading, Text } from '@/components/layout-primitives'

export function StagePanel({ title, count, description, testId, bodyTestId, bodyClassName = '', children }: {
  title: string; count: number | undefined; description?: string; testId: string; bodyTestId?: string; bodyClassName?: string; children: ReactNode
}) {
  return <Box as="section" data-testid={testId} className="transaction-stage min-w-0 self-start overflow-hidden rounded-xl border bg-card">
    <Box as="header" className="border-b px-4 py-3">
      <Box className="flex items-center justify-between gap-3"><Heading className="text-sm font-semibold">{title}</Heading><Badge variant="secondary">{count ?? '—'}</Badge></Box>
      {description && <Text className="mt-1 truncate text-muted-foreground" title={description}>{description}</Text>}
    </Box>
    <Box data-testid={bodyTestId} className={`p-2 ${bodyClassName}`}>{children}</Box>
  </Box>
}

export function StageItem({ active, primary, secondary, trailing, mono = false, testId, itemRef, onSelect }: {
  active: boolean; primary: string; secondary: ReactNode; trailing?: ReactNode; mono?: boolean; testId?: string; itemRef?: Ref<HTMLButtonElement>; onSelect: () => void
}) {
  return <Button layout="text" ref={itemRef} data-testid={testId} type="button" aria-pressed={active} onClick={onSelect} className="transaction-stage-item w-full rounded-lg px-3 py-3 text-left hover:bg-(--hover-surface)">
    <Text as="span" className="flex items-center justify-between gap-2"><Text as="span" title={primary} className={mono ? 'block truncate font-mono text-sm' : 'block truncate text-sm font-medium'}>{primary}</Text>{trailing}</Text>
    {typeof secondary === 'string'
      ? <Text as="span" className="mt-1 block truncate text-muted-foreground" title={secondary}>{secondary}</Text>
      : <Text as="span" className="mt-1.5 flex flex-wrap items-center gap-1">{secondary}</Text>}
  </Button>
}

export function OrthogonalConnector({ id, sourceIndex, targetCount, activeTargetIndex = -1 }: {
  id: string; sourceIndex: number; targetCount: number; activeTargetIndex?: number
}) {
  return <Box data-testid={id} aria-hidden="true" className={`transaction-connector ${id}`}
    style={{ '--source-index': Math.max(0, sourceIndex) } as CSSProperties}>
    {Array.from({ length: targetCount }, (_, index) => <Text as="i" key={index} data-testid={`${id}-edge-${index}`} data-active={index === activeTargetIndex} className="transaction-connector-edge" style={{ '--target-index': index } as CSSProperties}><Text as="b" /></Text>)}
  </Box>
}
