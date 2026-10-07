import type { ReactNode } from 'react'
import { UnderTabs } from '@/components/UnderTabs'
import { Card, CardContent } from '@/components/ui/card'
import { card } from './detailText'

export type CaseTab = 'overview' | 'graph' | 'transactions' | 'review'

/** fe/work 상세의 공통 헤더·탭. 데이터 공급 방식과 조사 명령은 호출자가 담당한다. */
export function CaseHeader({ id, title, tags, notice, action, tab, onTab, count }: {
  id: string; title: string; tags: ReactNode; notice?: ReactNode; action?: ReactNode
  tab: CaseTab; onTab: (tab: CaseTab) => void; count: number
}) {
  return <><header data-testid="detail-header">
    <p data-testid="detail-id" className="font-mono text-xs text-muted-foreground">{id}</p>
    <div className="mt-1.5 flex flex-wrap items-center gap-2.5"><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{action}</div>
    <div data-testid="detail-tags" className="mt-3 flex flex-wrap items-center gap-2">{tags}</div>
    {notice && <p className="mt-3 text-xs text-muted-foreground">{notice}</p>}
  </header><UnderTabs value={tab} onChange={onTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '그래프' }, { value: 'transactions', label: '거래', count }, { value: 'review', label: '검토 의견' }]} /></>
}

export function CaseStats({ items }: { items: { label: string; value: string; secondary?: string }[] }) {
  return <section aria-label="사건 요약" className="grid items-stretch gap-3 @3xl:grid-cols-12 @6xl:grid-cols-6">
    {items.map(stat => <Card key={stat.label} className={`${card} @3xl:col-span-4 @6xl:col-span-1`} data-testid="overview-kpi-card"><CardContent className="px-4">
      <p className="text-xs text-muted-foreground">{stat.label}</p><p className="mt-2 break-words text-lg font-semibold tabular-nums">{stat.value}</p>
      {stat.secondary && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{stat.secondary}</p>}
    </CardContent></Card>)}
  </section>
}
