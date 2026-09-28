import { PageHeading } from '@/components/page'
import { ProvenanceBadge } from '@/components/Provenance'

// 거래 탐색 API는 API.md에 없어 Backend에 새로 요청할 항목이다
export function TransactionsHeading() {
  return (
    <PageHeading
      title="거래 내역"
      description="소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다."
      badge={<ProvenanceBadge kind="proposal" title="거래 탐색 API(소유주 → 계좌 → 거래)는 API 계약에 아직 없습니다. Backend에 요청할 항목입니다." />}
    />
  )
}
