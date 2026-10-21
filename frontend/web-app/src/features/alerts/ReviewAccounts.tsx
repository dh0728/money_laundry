import type { ReviewApiMember, ReviewCase } from '@/api/liveReview'
import { Button } from '@/components/ui/button'
import { caseEvidence } from './caseEvidence'
import { memberAmountsByCurrency } from './activityAmounts'
import { formatMoney } from '@/features/transactions/transactionIndex'

type Direction = { count: number; members: ReviewApiMember[] }
type Account = { id: string; bankId: number; txIds: Set<number>; sent: Direction; received: Direction }
const direction = (): Direction => ({ count: 0, members: [] })
const amountText = (currency: string, amount: string | null) => amount == null || !Number.isFinite(Number(amount))
  ? `금액 확인 불가 · ${currency}` : `${formatMoney(amount, '', true)} ${currency}`

export default function ReviewAccounts({ item, onInvestigate }: { item: ReviewCase; onInvestigate: (txIds: number[]) => void }) {
  const metadata = new Map(item.accounts?.map(account => [account.id, account]))
  const accounts = new Map<string, Account>()
  for (const member of caseEvidence(item.groups ?? []).members) {
    const transaction = member.transaction
    for (const [id, bankId, side] of [
      [transaction.fromAccountId, transaction.fromBankId, 'sent'],
      [transaction.toAccountId, transaction.toBankId, 'received'],
    ] as const) {
      const account = accounts.get(id) ?? { id, bankId, txIds: new Set<number>(), sent: direction(), received: direction() }
      account.txIds.add(member.txId)
      const current = account[side]
      current.count++
      current.members.push(member)
      accounts.set(id, account)
    }
  }
  return <section aria-label="조사 계좌" className="min-w-0 space-y-3">
    <h2 className="text-base font-semibold">조사 계좌 · {accounts.size}개</h2>
    {accounts.size ? <>
      <p className="text-xs text-muted-foreground">현재 조사 거래 기준 · 금액은 거래의 송금 통화 기준이며 실제 수취액·잔액이 아닙니다.</p>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {[...accounts.values()].map(account => {
          const meta = metadata.get(account.id)
          return <article key={account.id} aria-label={`계좌 ${account.id}`} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
            <h3 className="break-all font-mono text-sm font-semibold">{account.id}</h3>
            <div className="min-w-0 text-xs">
              <p className="break-words">{meta?.ownerName || '소유주 미제공'}</p>
              {meta?.ownerId && <p className="mt-1 break-all text-muted-foreground">{meta.ownerId}</p>}
              <p className="mt-1 text-muted-foreground">은행 ID {meta?.bankId ?? account.bankId}</p>
            </div>
            <p className="text-sm">송금 {account.sent.count}건 · 수취 {account.received.count}건</p>
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
              {([['sent', '보낸 거래의 송금액'], ['received', '받은 거래의 송금액']] as const).map(([side, label]) => <div key={side} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all text-sm tabular-nums">{account[side].count ? Object.entries(memberAmountsByCurrency(account[side].members)).map(([currency, amount]) => <p key={currency}>{amountText(currency, amount)}</p>) : '해당 거래 없음'}</dd>
              </div>)}
            </dl>
            <Button type="button" size="sm" variant="outline" className="max-w-full" aria-label={`${account.id} 조사 거래 보기`} onClick={() => onInvestigate([...account.txIds])}>이 계좌의 조사 거래 보기</Button>
          </article>
        })}
      </div>
    </> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">현재 조사 범위에 계좌가 없습니다.</p>}
  </section>
}
