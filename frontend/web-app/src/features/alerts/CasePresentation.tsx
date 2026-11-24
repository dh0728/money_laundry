import type { ReactNode } from 'react'
import { UnderTabs } from '@/components/UnderTabs'
import { Card, CardContent } from '@/components/ui/card'
import { card } from './detailText'
import { Box, Heading, Text } from '@/components/layout-primitives'

export type CaseTab = 'overview' | 'graph' | 'transactions' | 'review'

/** fe/work 상세의 공통 헤더·탭. 데이터 공급 방식과 조사 명령은 호출자가 담당한다. */
export function CaseHeader({ id, title, tags, notice, action, tab, onTab, count }: {
  id: string; title: string; tags: ReactNode; notice?: ReactNode; action?: ReactNode
  tab: CaseTab; onTab: (tab: CaseTab) => void; count: number
}) {
  return <><Box as="header" data-testid="detail-header">
    <Text data-testid="detail-id" className="font-mono text-xs text-muted-foreground">{id}</Text>
    <Box className="mt-1.5 flex flex-wrap items-center gap-2.5"><Heading level={1} className="text-xl font-semibold tracking-tight">{title}</Heading>{action}</Box>
    <Box data-testid="detail-tags" className="mt-3 flex flex-wrap items-center gap-2">{tags}</Box>
    {notice && <Text className="mt-3 text-xs text-muted-foreground">{notice}</Text>}
  </Box><UnderTabs value={tab} onChange={onTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '그래프' }, { value: 'transactions', label: '거래', count }, { value: 'review', label: '검토 의견' }]} /></>
}

export function CaseStats({ items }: { items: { label: string; value: string; secondary?: string }[] }) {
  // 카드 수만큼 한 줄에 놓는다(재설계: Alert 5개, Episode 4개). 6개는 기존 2줄→1줄 배치를 유지
  const grid = items.length === 6 ? 'grid-cols-1 @3xl:grid-cols-12 @6xl:grid-cols-6' : items.length === 5 ? 'grid-cols-2 @3xl:grid-cols-5' : 'grid-cols-2 @3xl:grid-cols-4'
  const span = items.length === 6 ? '@3xl:col-span-4 @6xl:col-span-1' : ''
  return <Box as="section" aria-label="사건 요약" className={`grid items-stretch gap-3 ${grid}`}>
    {items.map(stat => <Card key={stat.label} className={`${card} ${span}`} data-testid="overview-kpi-card"><CardContent className="px-4">
      <Text className="text-xs text-muted-foreground">{stat.label}</Text><Text className="mt-2 break-words text-lg font-semibold tabular-nums">{stat.value}</Text>
      {stat.secondary && <Text className="mt-1 text-xs text-muted-foreground tabular-nums">{stat.secondary}</Text>}
    </CardContent></Card>)}
  </Box>
}
