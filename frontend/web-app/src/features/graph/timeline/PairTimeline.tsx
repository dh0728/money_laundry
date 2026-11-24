// 각 거래를 시간순으로 표시하고 목록과 리본의 강조 상태를 공유한다.
import { useMemo, useState } from 'react'
import type { TimeTx } from './timeLayout'
import { NumBadge } from '@/components/NumBadge'
import { Box, Text } from '@/components/layout-primitives'
import { AccountPairTimeline } from '@/components/charts/charts/account-pair-timeline'

function Direction({ from, to, numbers }: { from: string; to: string; numbers: Map<string, number> }) {
  return (
    <Text as="span" className="inline-flex items-center gap-1">
      <NumBadge n={numbers.get(from)!} />→<NumBadge n={numbers.get(to)!} />
    </Text>
  )
}

export default function PairTimeline({ a, b, numbers, all }: { a: string; b: string; numbers: Map<string, number>; all: TimeTx[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const { transactions, ribbons, forward, reverse } = useMemo(() => {
    const transactions = all.filter(tx =>
      (tx.fromAccount === a && tx.toAccount === b) || (tx.fromAccount === b && tx.toAccount === a),
    )
    const forward = { count: 0, total: 0 }
    const reverse = { count: 0, total: 0 }
    const ribbons = transactions.map(tx => {
      const sourceIsFirstAccount = tx.fromAccount === a
      if (sourceIsFirstAccount) {
        forward.count += 1
        forward.total += tx.amountUsd
      }
      if (tx.fromAccount === b) {
        reverse.count += 1
        reverse.total += tx.amountUsd
      }
      return { id: tx.txId, amount: tx.amountUsd, forward: sourceIsFirstAccount }
    })
    return { transactions, ribbons, forward, reverse }
  }, [a, b, all])

  return (
    <Box className="space-y-3">
      <Box>
        <Text className="text-base font-semibold">
          <Text as="span" className="inline-flex items-center gap-1.5">
            <NumBadge n={numbers.get(a)!} />↔<NumBadge n={numbers.get(b)!} />
          </Text>
          <Text as="span" className="ml-2 text-xs font-normal text-muted-foreground">두 계좌 사이 거래 {transactions.length}건</Text>
        </Text>
        <Text className="mt-1 text-xs tabular-nums">
          <Text as="span" className="pair-timeline-direction" data-direction="forward">■</Text>{' '}
          <Direction from={a} to={b} numbers={numbers} /> {forward.count}건 · {Math.round(forward.total).toLocaleString()} USD
          {reverse.count > 0 && <>
            <Text as="span" className="ml-2 pair-timeline-direction" data-direction="reverse">■</Text>{' '}
            <Direction from={b} to={a} numbers={numbers} /> {reverse.count}건 · {Math.round(reverse.total).toLocaleString()} USD
          </>}
        </Text>
      </Box>
      <Box className="overflow-x-auto rounded-md border">
        <AccountPairTimeline
          accounts={[{ label: a, number: numbers.get(a) }, { label: b, number: numbers.get(b) }]}
          ribbons={ribbons}
          hovered={hovered}
          onHover={setHovered}
        />
      </Box>
      <Box as="ul" className="divide-y text-sm">
        {transactions.map((tx, index) => (
          <Box
            as="li"
            key={tx.txId}
            onMouseEnter={() => setHovered(tx.txId)}
            onMouseLeave={() => setHovered(null)}
            className={`pair-timeline-row grid items-center gap-2 py-1.5 ${hovered === tx.txId ? 'bg-muted/60' : ''}`}
          >
            <Text as="span" className="tabular-nums text-muted-foreground">{index + 1}</Text>
            <Text as="span" className="tabular-nums text-muted-foreground">{tx.txAt.replace('T', ' ').slice(5, 16)}</Text>
            <Text as="span" className="pair-timeline-direction" data-direction={tx.fromAccount === a ? 'forward' : 'reverse'}>
              <Direction from={tx.fromAccount} to={tx.toAccount} numbers={numbers} />
            </Text>
            <Text as="span" className="tabular-nums">{tx.amountPaid.toLocaleString()} {tx.paymentCurrency}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
