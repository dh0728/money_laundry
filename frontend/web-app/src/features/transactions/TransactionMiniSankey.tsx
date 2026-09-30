import { ArrowRight } from 'lucide-react'
import { formatMoney } from './transactionIndex'

export type TransactionFlow = {
  id: string; amount: number; currency: string; format: string
  fromOwner: string; fromAccount: string; toOwner: string; toAccount: string
  suspicious: boolean | null
}

export default function TransactionMiniSankey({ transaction }: { transaction: TransactionFlow }) {
  const amount = formatMoney(transaction.amount, transaction.currency)
  const label = `${transaction.fromAccount}에서 ${transaction.toAccount}으로 ${amount} ${transaction.format} 송금 흐름`
  const labelId = `transaction-flow-${transaction.id}`
  return <figure data-testid="transaction-mini-sankey" className="rounded-md border bg-muted/20 p-3" aria-labelledby={labelId}>
    <span id={labelId} className="sr-only">{label}</span>
    <div className="relative grid min-h-28 grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-2">
      <svg viewBox="0 0 420 112" aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d="M118 38 C176 38 244 38 302 38 L302 74 C244 74 176 74 118 74 Z" className={transaction.suspicious ? 'fill-destructive/35' : 'fill-muted-foreground/35'} />
      </svg>
      <div className="relative z-10 min-w-0 rounded-md border bg-card px-3 py-2"><p className="truncate text-[10px] text-muted-foreground">송금 소유주</p><p className="mt-1 break-words text-[11px] font-medium leading-tight" title={transaction.fromOwner}>{transaction.fromOwner}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{transaction.fromAccount}</p></div>
      <p className="relative z-10 flex min-w-0 items-center justify-center gap-1 rounded-full bg-card/90 px-1 py-1 text-center text-[10px] font-medium tabular-nums" title={amount}><span className="truncate">{amount}</span><ArrowRight data-testid="transaction-flow-direction" aria-hidden="true" className="size-3 shrink-0" /></p>
      <div className="relative z-10 min-w-0 rounded-md border bg-card px-3 py-2 text-right"><p className="truncate text-[10px] text-muted-foreground">수취 소유주</p><p className="mt-1 break-words text-[11px] font-medium leading-tight" title={transaction.toOwner}>{transaction.toOwner}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{transaction.toAccount}</p></div>
    </div>
  </figure>
}
