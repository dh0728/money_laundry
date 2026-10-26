// UI 재설계 S19 의심 거래 목록 시안. 대시보드의 탐지율·구성 차트에서 들어온다(사이드바 메뉴 아님).
// API는 있다: GET /api/v1/suspicious-transactions (API.md §2.4). 점수 의미는 §2.2.
import { useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { TypeCode } from '@/api/codes'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { PageHeading } from '@/components/page'
import { ProvenanceBadge } from '@/components/Provenance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { agreementStyles } from '@/features/dashboard/metrics'

type Row = { txId: number; txAt: string; fromBank: number; fromAccount: string; toBank: number; toAccount: string; amountPaid: number; paymentCurrency: string; amountUsd: number; paymentFormat: string; launderingScore: number; scorePercentile: number; thresholdRatio: number; typeCandidates: TypeCode[]; agreement: string }
const FORMATS = ['Wire', 'ACH', 'Cheque', 'Credit Card', 'Cash']
const CUR = [['USD', 1], ['EUR', 1.08], ['SAR', 0.27], ['GBP', 1.27]] as const
// mock: 결정적인 예시 행
const ROWS: Row[] = Array.from({ length: 24 }, (_, i) => {
  const score = Math.round((0.98 - i * 0.012) * 100) / 100, [cur, rate] = CUR[i % 4], usd = 4200 + ((i * 7919) % 46000)
  const types = ([2, 1, 8, 4, 3, 5, 0, 7] as TypeCode[])
  const first = types[i % types.length], second = i % 3 === 0 ? types[(i + 3) % types.length] : null
  return { txId: 501200 + i * 17, txAt: `10-${String(9 + (i % 2)).padStart(2, '0')} ${String(8 + (i % 12)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`, fromBank: 10 + (i % 5), fromAccount: `acc-${(0xa200 + i * 3).toString(16)}`, toBank: 10 + ((i + 2) % 5), toAccount: `acc-${(0x1060 + i).toString(16)}`,
    amountPaid: Math.round(usd / rate), paymentCurrency: cur, amountUsd: usd, paymentFormat: FORMATS[i % 5], launderingScore: score, scorePercentile: Math.round(99.9 - i * 0.4), thresholdRatio: Math.round((score / 0.7) * 100) / 100,
    typeCandidates: second != null && second !== first ? [first, second] : [first], agreement: first === 0 ? 'ATYPICAL' : 'STRONG' }
})

export default function SuspiciousPage() {
  const [type, setType] = useState('all'), [agree, setAgree] = useState('all'), [sort, setSort] = useState('score')
  const rows = useMemo(() => ROWS.filter(r => (type === 'all' || r.typeCandidates[0] === Number(type)) && (agree === 'all' || r.agreement === agree)).sort((a, b) => sort === 'score' ? b.launderingScore - a.launderingScore || a.txId - b.txId : a.txId - b.txId), [type, agree, sort])
  const agreeName = (code: string) => agreementStyles.find(a => a.code === code)?.name ?? code
  return <div className="space-y-5">
    <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-xs" onClick={() => { window.location.hash = 'dashboard' }}><ArrowLeft className="size-4" />대시보드</Button>
    <PageHeading title="의심 거래" description="10-10 분석에서 모델이 임계값(0.7) 이상으로 본 거래. 거래 하나의 점수이며 사건 전체의 판단이 아닙니다." badge={<ProvenanceBadge kind="mock" title="API는 있음(API.md §2.4) · 화면은 mock 데이터" />} />
    <Card className="shadow-none"><CardContent className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1.5"><span className="block text-muted-foreground">분석일</span><Select defaultValue="10-10"><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{['10-10', '10-09', '10-08'].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5"><span className="block text-muted-foreground">유형</span><Select value={type} onValueChange={setType}><SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">전체</SelectItem>{[2, 1, 8, 4, 3, 5, 7, 0].map(c => <SelectItem key={c} value={String(c)}>{['NON_PATTERN', 'FAN-OUT', 'FAN-IN', 'G-SCATTER', 'S-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK'][c]}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5"><span className="block text-muted-foreground">두 모델 합의</span><Select value={agree} onValueChange={setAgree}><SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">전체</SelectItem>{agreementStyles.slice(0, 2).map(a => <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5"><span className="block text-muted-foreground">정렬</span><Select value={sort} onValueChange={setSort}><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="score">점수 높은 순</SelectItem><SelectItem value="tx">거래 번호 순</SelectItem></SelectContent></Select></label>
        <span className="ml-auto text-muted-foreground">{rows.length}건</span>
      </div>
      <Table><TableHeader><TableRow><TableHead>거래</TableHead><TableHead>시각</TableHead><TableHead>송금 은행 · 계좌</TableHead><TableHead>수취 은행 · 계좌</TableHead><TableHead className="text-right">금액</TableHead><TableHead>결제 수단</TableHead><TableHead>점수</TableHead><TableHead>유형 후보</TableHead><TableHead>두 모델 합의</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(r => <TableRow key={r.txId}>
          <TableCell className="font-mono text-xs">T-{r.txId}</TableCell><TableCell className="tabular-nums text-xs">{r.txAt}</TableCell>
          <TableCell className="font-mono text-xs">{r.fromBank} · {r.fromAccount}</TableCell><TableCell className="font-mono text-xs">{r.toBank} · {r.toAccount}</TableCell>
          <TableCell className="text-right tabular-nums">{r.amountPaid.toLocaleString()} {r.paymentCurrency}{r.paymentCurrency !== 'USD' && <p className="text-xs text-muted-foreground">{r.amountUsd.toLocaleString()} USD</p>}</TableCell>
          <TableCell className="text-xs">{r.paymentFormat}</TableCell>
          <TableCell><span className="flex items-center gap-1.5"><RiskBadge score={r.launderingScore} /><span className="text-xs text-muted-foreground tabular-nums">상위 {Math.max(0.1, Math.round((100 - r.scorePercentile) * 10) / 10)}% · 임계 {r.thresholdRatio}배</span></span></TableCell>
          <TableCell><span className="flex flex-wrap gap-1">{r.typeCandidates.map(c => <PatternBadge key={c} code={c} />)}{r.typeCandidates.length > 1 && <Badge variant="outline" className="font-normal text-muted-foreground">모호</Badge>}</span></TableCell>
          <TableCell className="text-xs">{agreeName(r.agreement)}</TableCell>
        </TableRow>)}</TableBody></Table>
      <p className="text-xs text-muted-foreground">점수는 시연용 임의 점수(demo-random-v1)입니다. 유형 후보가 두 개면 상위 두 확률 차이가 0.1보다 작다는 뜻입니다. 계좌는 가명입니다.</p>
    </CardContent></Card>
  </div>
}
