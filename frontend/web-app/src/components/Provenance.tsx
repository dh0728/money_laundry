// 화면의 각 부분이 실제로 동작하는지, 설계 단계인지 구분하는 표시(중간발표 실현 가능성 설명용).
//   mock     : 화면은 동작하고 데이터만 mock이다. API 계약(API.md)은 있다.
//   proposal : FE 제안. API.md에 아직 없는 값·요청이라 Backend와 정리가 필요하다.
//   planned  : 준비 중. 설계만 있고 화면이 아직 없다.
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { live } from '@/lib/apiMode'

export type Provenance = 'mock' | 'proposal' | 'planned'

const info: Record<Provenance, { label: string; title: string }> = {
  mock: { label: 'mock 데이터', title: '화면은 동작하고, 데이터는 시연용 mock입니다.' },
  proposal: { label: 'FE 제안', title: 'API 계약에 아직 없는 기능입니다. Backend와 정리한 뒤 연결합니다.' },
  planned: { label: '준비 중', title: '설계는 있고 화면은 아직 만들지 않았습니다.' },
}

export function ProvenanceBadge({ kind, title }: { kind: Provenance; title?: string }) {
  return (
    <Badge variant="outline" data-provenance={kind} className="provenance-badge shrink-0 font-normal" title={title ?? info[kind].title}>
      {info[kind].label}
    </Badge>
  )
}

/** 표시 + 한 줄 설명 */
export function ProvenanceNote({ kind, children }: { kind: Provenance; children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ProvenanceBadge kind={kind} />{children}</p>
}

/** 아직 없는 화면·탭 자리 */
export function PlannedBlock({ children }: { children: ReactNode }) {
  return (
    <div data-testid="planned-block" className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
      <ProvenanceBadge kind="planned" />
      <p>{children}</p>
    </div>
  )
}

/** 앱 머리: 지금 보이는 데이터가 mock인지 실제 API인지 */
export function DataModeBadge() {
  return live
    ? <Badge variant="outline" data-provenance="live" className="provenance-badge font-normal" title="Backend API에서 데이터를 불러오는 중입니다.">실제 API</Badge>
    : <ProvenanceBadge kind="mock" title="서버 없이 시연용 mock 데이터로 동작합니다. 처리 결과는 새로고침하면 처음 상태로 돌아갑니다." />
}
