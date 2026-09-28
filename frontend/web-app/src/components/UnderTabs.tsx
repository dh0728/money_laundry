// v24 shared.tsx의 밑줄 탭과 움직이는 선택 표시를 옮김
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSelectionIndicator } from './useSelectionIndicator'
export function UnderTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-slot=tabs-trigger]', '[data-slot=tabs-trigger][data-state=active]', JSON.stringify(items))
  return (
    <Tabs value={value} onValueChange={next => onChange(next as T)}>
      <TabsList ref={root} variant="line" className="underline-tabs">
        <span aria-hidden="true" data-slot="tab-indicator" data-animate={animate} className="tab-indicator" style={{ visibility: geometry ? 'visible' : 'hidden', transform: `translateX(${geometry?.x ?? 0}px)`, width: geometry?.width ?? 0 }} />
        {items.map(i => <TabsTrigger value={i.value} key={i.value}>{i.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
