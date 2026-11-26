// v24 shared.tsx의 밑줄 탭과 움직이는 선택 표시를 옮김
import type { CSSProperties } from 'react'
import { Box } from '@/components/layout-primitives'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CountBadge } from './CountBadge'
import { useSelectionIndicator } from './useSelectionIndicator'
export function UnderTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-slot=tabs-trigger]', '[data-slot=tabs-trigger][data-state=active]', JSON.stringify(items))
  return (
    <Tabs value={value} onValueChange={next => onChange(next as T)}>
      <TabsList ref={root} variant="line" className="underline-tabs">
        <Box as="span" aria-hidden="true" data-slot="tab-indicator" data-animate={animate} data-measured={Boolean(geometry) || undefined} className="tab-indicator"
          style={{ '--tab-indicator-x': `${geometry?.x ?? 0}px`, '--tab-indicator-width': `${geometry?.width ?? 0}px` } as CSSProperties} />
        {items.map(i => <TabsTrigger value={i.value} key={i.value} className="gap-1.5">{i.label}{i.count !== undefined && <CountBadge count={i.count} label={i.label} />}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
