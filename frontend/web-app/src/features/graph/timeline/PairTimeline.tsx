// UI 재설계 §6.5 계좌쌍 상세(Q2): 두 계좌 레인 사이에 거래마다 리본을 시간 순서대로 그린다.
// 상세 그래프 자체가 두 방향·개별 거래·금액·시각·순서를 보여야 한다(김명기 10/1). 같은 방향 거래를 한 띠로 합치지 않는다.
import { useState } from 'react'
import type { TimeTx } from './timeLayout'
import { NumBadge } from '@/components/NumBadge'

const AB = 'var(--palette-blue-500)', BA = 'var(--risk-7)'
const Dir = ({ from, to, numbers }: { from: string; to: string; numbers: Map<string, number> }) => <span className="inline-flex items-center gap-1"><NumBadge n={numbers.get(from)!} />→<NumBadge n={numbers.get(to)!} /></span>

export default function PairTimeline({ a, b, numbers, all }: { a: string; b: string; numbers: Map<string, number>; all: TimeTx[] }) {
  const tx = all.filter(t => (t.fromAccount === a && t.toAccount === b) || (t.fromAccount === b && t.toAccount === a))
  const [hover, setHover] = useState<number | null>(null)
  const W = 300, H = 150, top = 26, bottom = H - 26, step = Math.max(26, (W - 30) / Math.max(1, tx.length))
  const width = Math.max(W, 30 + step * tx.length)
  const vals = tx.map(t => Math.log10(Math.max(1, t.amountUsd))), lo = Math.min(...vals), hi = Math.max(...vals)
  const bw = (t: TimeTx) => 4 + 12 * (hi === lo ? 0.5 : (Math.log10(Math.max(1, t.amountUsd)) - lo) / (hi - lo))
  const sum = (from: string) => tx.filter(t => t.fromAccount === from).reduce((s, t) => s + t.amountUsd, 0)
  const count = (from: string) => tx.filter(t => t.fromAccount === from).length
  return <div className="space-y-3">
    <div><p className="text-base font-semibold"><span className="inline-flex items-center gap-1.5"><NumBadge n={numbers.get(a)!} />↔<NumBadge n={numbers.get(b)!} /></span><span className="ml-2 text-xs font-normal text-muted-foreground">두 계좌 사이 거래 {tx.length}건</span></p>
      <p className="mt-1 text-xs tabular-nums"><span style={{ color: AB }}>■</span> <Dir from={a} to={b} numbers={numbers} /> {count(a)}건 · {Math.round(sum(a)).toLocaleString()} USD{count(b) > 0 && <><span className="ml-2" style={{ color: BA }}>■</span> <Dir from={b} to={a} numbers={numbers} /> {count(b)}건 · {Math.round(sum(b)).toLocaleString()} USD</>}</p></div>
    <div className="overflow-x-auto rounded-md border">
      <svg width={width} height={H} role="img" aria-label="두 계좌 레인 타임라인" className="block">
        <line x1={0} x2={width} y1={top} y2={top} stroke="var(--border)" strokeWidth={6} /><line x1={0} x2={width} y1={bottom} y2={bottom} stroke="var(--border)" strokeWidth={6} />
        <circle cx={16} cy={top - 12} r={11} fill="var(--card)" stroke="var(--foreground)" /><text x={16} y={top - 7} fontSize={13} fontWeight={700} textAnchor="middle" fill="var(--foreground)">{numbers.get(a)}</text><text x={34} y={top - 7} fontSize={12} fill="var(--muted-foreground)" className="font-mono">{a}</text>
        <circle cx={16} cy={bottom + 13} r={11} fill="var(--card)" stroke="var(--foreground)" /><text x={16} y={bottom + 18} fontSize={13} fontWeight={700} textAnchor="middle" fill="var(--foreground)">{numbers.get(b)}</text><text x={34} y={bottom + 18} fontSize={12} fill="var(--muted-foreground)" className="font-mono">{b}</text>
        {tx.map((t, i) => { const x = 22 + i * step, down = t.fromAccount === a, w = bw(t), on = hover === t.txId
          return <g key={t.txId} onMouseEnter={() => setHover(t.txId)} onMouseLeave={() => setHover(null)} className="cursor-default">
            <rect x={x - w / 2} y={top + 4} width={w} height={bottom - top - 8} rx={2} fill={down ? AB : BA} opacity={hover == null || on ? 0.85 : 0.3} />
            <path d={down ? `M${x - 4},${bottom - 18} L${x},${bottom - 12} L${x + 4},${bottom - 18}` : `M${x - 4},${top + 18} L${x},${top + 12} L${x + 4},${top + 18}`} stroke="var(--background)" strokeWidth={1.5} fill="none" />
            <text x={x} y={H / 2} fontSize={9} textAnchor="middle" fill="var(--foreground)" transform={`rotate(-90 ${x} ${H / 2})`} dy={-w / 2 - 3}>{i + 1}</text>
          </g> })}
      </svg>
    </div>
    <ul className="divide-y text-sm">{tx.map((t, i) => <li key={t.txId} onMouseEnter={() => setHover(t.txId)} onMouseLeave={() => setHover(null)} className={`grid grid-cols-[20px_88px_1fr_auto] items-center gap-2 py-1.5 ${hover === t.txId ? 'bg-muted/60' : ''}`}>
      <span className="tabular-nums text-muted-foreground">{i + 1}</span><span className="tabular-nums text-muted-foreground">{t.txAt.replace('T', ' ').slice(5, 16)}</span>
      <span style={{ color: t.fromAccount === a ? AB : BA }}><Dir from={t.fromAccount} to={t.toAccount} numbers={numbers} /></span><span className="tabular-nums">{t.amountPaid.toLocaleString()} {t.paymentCurrency}</span>
    </li>)}</ul>
  </div>
}
