import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { ArrowRight, Check, CircleDollarSign, ExternalLink, FileClock, History, Radar, Save, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { useMemoryState } from './memory'
import { canClose, graphFor, sortRows, type RecordItem } from './domain'
import { DetailHeading, UnderTabs, SectionTitle, SortableHead } from './shared'
import { useSort } from './Lists'
import Graph from './Graph'
import TxTable, { type TxRow } from './TxTable'
import PatternGlyph from './PatternGlyph'
import { buildTransactionIndex, type TransactionTarget } from './transactionIndex'
import { formatMoney, moneyMetrics } from './v23-domain'

type Draft = { text: string; verdict: string; at: string }
type Event = { title: string; body: string; at: string; actor: string }

// 한글 마지막 글자의 종성 유무로 조사를 고른다: (code - 0xAC00) % 28 !== 0 이면 종성 있음(받침) -> withFinal(이/을/은), 없으면 -> withoutFinal(가/를/는)
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word?.charCodeAt(word.length - 1) ?? NaN
  if (!(last >= 0xac00 && last <= 0xd7a3)) return withoutFinal
  return (last - 0xac00) % 28 !== 0 ? withFinal : withoutFinal
}

// 최종 판단: 실제 업무 경로별 선택지와 후속 입력·확정 문구
export const verdictOptions = (kind: RecordItem['kind']) => kind === 'Alert'
  ? [
    { value: 'normal', label: '정상 거래 · 종결', action: '종결 확인', history: '정상 거래로 종결' },
    { value: 'false-positive', label: '오탐 · 종결', action: '종결 확인', history: '오탐으로 종결' },
    { value: 'link-episode', label: '의심 거래 · 기존 Episode 연결', action: 'Episode 연결 확인', history: '의심 거래로 기존 Episode 연결' },
    { value: 'new-episode', label: '의심 거래 · 새 Episode 생성', action: 'Episode 생성 확인', history: '의심 거래로 새 Episode 생성' },
  ]
  : [
    { value: 'normal', label: '정상 거래 · 조사 종결', action: '종결 확인', history: '정상 거래로 조사 종결' },
    { value: 'false-positive', label: '오탐 · 조사 종결', action: '종결 확인', history: '오탐으로 조사 종결' },
    { value: 'suspicious-report', label: '의심 거래 · 보고 대상 확정', action: '보고 대상 확정', history: '의심 거래 보고 대상으로 확정' },
    { value: 'escalate', label: '추가 조사 필요 · 상위 검토 요청', action: '상위 검토 요청', history: '상위 검토 요청' },
  ]

const counts = <T,>(items: T[], key: (item: T) => string, value: (item: T) => number) => {
  const map = new Map<string, number>(); items.forEach(i => map.set(key(i), (map.get(key(i)) ?? 0) + value(i)))
  return [...map.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v)
}
function BarList({ rows, format }: { rows: { name: string; v: number }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map(r => r.v), 1)
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_72px_minmax(60px,1.1fr)] gap-3 items-center text-xs">
          <span className="truncate font-mono text-[11px]">{r.name}</span>
          <span className="text-right tabular-nums">{format(r.v)}</span>
          <span className="h-2 rounded-full bg-muted overflow-hidden"><span className={`block h-full rounded-full ${i === 0 ? 'bg-foreground' : 'bg-muted-foreground/60'}`} style={{ width: `${r.v / max * 100}%` }} /></span>
        </div>
      ))}
    </div>
  )
}

export default function Detail({ record: r, records, user, onUpdate, onOpen, onOpenTransaction, initialTab = 'overview' }: { record: RecordItem; records: RecordItem[]; user: string; onUpdate: (r: RecordItem) => void; onOpen: (r: RecordItem) => void; onOpenTransaction?: (target: TransactionTarget) => void; initialTab?: 'overview' | 'graph' | 'transactions' | 'conclusion' }) {
  const model = useMemo(() => graphFor(r, records), [r, records])
  const transactionIndex = useMemo(() => buildTransactionIndex(records), [records])
  const tx: TxRow[] = useMemo(() => {
    const recordIds = new Set(r.kind === 'Alert' ? [r.id] : r.alertIds ?? [])
    return transactionIndex.transactions
      .filter(item => item.suspicious && item.recordIds.some(id => recordIds.has(id)))
      .map(item => ({ id: item.id, at: item.at, from: item.fromAccount, fromOwner: item.fromOwner, to: item.toAccount, toOwner: item.toOwner, usd: item.usd, amount: item.amount, currency: item.currency, format: item.format }))
  }, [r.alertIds, r.id, r.kind, transactionIndex])
  const options = verdictOptions(r.kind)
  const [tab, setTab] = useState(initialTab)
  const [reason, setReason] = useMemoryState(`${r.id}:reason`, r.status === '종결' ? '거래 목적 및 계좌 관계 대조 완료. 정상 거래로 판단함.' : '')
  const [verdict, setVerdict] = useMemoryState(`${r.id}:verdict`, 'normal')
  const [target, setTarget] = useMemoryState(`${r.id}:target`, ''), [newTitle, setNewTitle] = useMemoryState(`${r.id}:new-title`, '')
  const [confirm, setConfirm] = useState(false), [draftOpen, setDraftOpen] = useState(false)
  const [drafts, setDrafts] = useMemoryState<Draft[]>(`${r.id}:drafts`, []), [events, setEvents] = useMemoryState<Event[]>(`${r.id}:events`, [])
  const [selectedTx, setSelectedTx] = useState<string | null | undefined>(undefined)
  const responsible = r.owner === user, closed = r.status === '종결'
  const option = options.find(o => o.value === verdict) ?? options[0]
  const needsTarget = verdict === 'link-episode' && !target, needsTitle = verdict === 'new-episode' && !newTitle.trim()
  const ready = canClose(user, r.owner, reason) && !needsTarget && !needsTitle
  const linkedEpisode = r.episodeId ? records.find(x => x.id === r.episodeId) : undefined
  const linkedAlerts = (r.alertIds ?? []).map(id => records.find(x => x.id === id)).filter(Boolean) as RecordItem[]
  const linkedRecords = r.kind === 'Alert' ? (linkedEpisode ? [linkedEpisode] : []) : linkedAlerts
  const priorRedetectionAlert = r.redetection ? records.find(record => record.id === r.redetection?.priorAlertId) : undefined
  const ownerTarget = (account: string): TransactionTarget => {
    const owner = transactionIndex.accounts.find(item => item.id === account)?.owner
    return owner ? { type: 'owner', owner } : { type: 'account', account }
  }

  const event = (title: string, body: string) => setEvents(p => [{ title, body, at: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }), actor: user }, ...p])
  const save = () => { setDrafts(p => [{ text: reason, verdict, at: new Date().toLocaleTimeString('ko-KR') }, ...p]); event('검토 의견 임시 저장', '확정 전 검토 의견을 저장함'); toast.success('현재 화면에 임시 저장했습니다.') }
  const finish = () => {
    if (!ready) return
    if (verdict === 'link-episode') { onUpdate({ ...r, status: '종결', episodeId: target }); event(option.history, `${target} · ${reason}`) }
    else if (verdict === 'new-episode') { onUpdate({ ...r, status: '종결', episodeId: 'EP-2026-0329' }); event(option.history, `EP-2026-0329 ${newTitle} · ${reason}`) }
    else { onUpdate({ ...r, status: verdict === 'escalate' ? '상위 검토' : '종결' }); event(option.history, reason) }
    setConfirm(false); toast.success(`${r.id} · ${option.history}`)
  }

  const dailyRaw = counts(tx, t => t.at.slice(5, 10), t => t.usd).sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ day: d.name, USD: Math.round(d.v) }))
  const dailyMaxIndex = dailyRaw.reduce((maxI, d, i, arr) => d.USD > arr[maxI].USD ? i : maxI, 0)
  const daily = dailyRaw
  const formats = counts(tx, t => t.format, t => t.usd).slice(0, 5)
  const senders = counts(tx, t => t.from, t => t.usd).slice(0, 5)
  const patternGroups = [...linkedAlerts.reduce((groups, alert) => {
    groups.set(alert.pattern, [...(groups.get(alert.pattern) ?? []), alert])
    return groups
  }, new Map<string, RecordItem[]>()).values()]
  const representativeAccount = model.nodes.find(node => node.hub)?.account ?? model.nodes.find(node => node.core)?.account
  const metrics = moneyMetrics(tx, representativeAccount)
  const history = [...events, { title: '검토 시작', body: '탐지 근거와 연결 거래를 확인함', at: '13:42', actor: r.owner }, { title: '담당자 자동 배정', body: `${r.owner}에게 배정됨`, at: '13:38', actor: '시스템' }, { title: `${r.kind} 생성`, body: `${r.pattern} ${r.probability}% 탐지`, at: '13:35', actor: '시스템' }]

  return (
    <div className="min-h-full flex flex-col gap-5">
      <DetailHeading record={r} linkedRecords={linkedRecords} onOpen={onOpen} />
      {!responsible && <p className="self-end text-xs text-muted-foreground rounded-md border px-3 py-2 @5xl:whitespace-nowrap">현재 {user} 계정으로 조회 중입니다. 최종 처리는 담당자 {r.owner}{josa(r.owner, '이', '가')} 수행합니다.</p>}
      {r.kind === 'Alert' && r.redetection && (
        <section data-testid="redetection-banner" aria-labelledby="redetection-title" className="rounded-xl border-2 border-destructive bg-destructive px-5 py-5 text-destructive-foreground shadow-[0_0_28px_-8px_var(--destructive)]">
          <div>
            <div>
              <Badge className="border-destructive-foreground/70 bg-destructive-foreground text-destructive shadow-sm hover:bg-destructive-foreground">재탐지</Badge>
              <h2 id="redetection-title" className="mt-3 text-base font-semibold">종결 이후 동일 계좌에서 새 이상거래가 발견됐습니다.</h2>
              <p className="mt-1.5 text-xs leading-5 text-destructive-foreground/80">계좌 <span className="font-mono text-destructive-foreground">{r.redetection.account}</span> · 과거 종결 판단은 보존하고 현재 Alert를 별도로 검토합니다.</p>
            </div>
          </div>
          <div className="mt-5 grid items-stretch gap-2 @4xl:grid-cols-[1fr_auto_1fr_auto_1fr]" aria-label="종결에서 재탐지까지의 이력">
            <div className="rounded-lg border border-destructive-foreground/25 bg-redetection-inset p-3"><History className="size-4" /><p className="mt-2 text-xs font-semibold">과거 Alert 종결</p><p className="mt-1 font-mono text-[11px]">{r.redetection.priorAlertId}</p><p className="mt-1 text-[11px] text-destructive-foreground/75">{r.redetection.priorClosedAt} · {r.redetection.priorOutcome}</p><p className="mt-1 text-[10px] text-destructive-foreground/65">현재 상태 유지: {priorRedetectionAlert?.status ?? '종결'}</p></div>
            <ArrowRight className="mx-auto size-4 self-center rotate-90 text-destructive-foreground/70 @4xl:rotate-0" aria-hidden />
            <div className="rounded-lg border border-destructive-foreground/25 bg-redetection-inset p-3"><CircleDollarSign className="size-4" /><p className="mt-2 text-xs font-semibold">새 이상거래 발견</p><p className="mt-1 font-mono text-[11px]">{r.redetection.newTransactionId}</p><p className="mt-1 text-[11px] text-destructive-foreground/75">{r.redetection.newTransactionAt}</p></div>
            <ArrowRight className="mx-auto size-4 self-center rotate-90 text-destructive-foreground/70 @4xl:rotate-0" aria-hidden />
            <div className="rounded-lg border border-destructive-foreground/25 bg-redetection-inset p-3"><Radar className="size-4" /><p className="mt-2 text-xs font-semibold">현재 Alert 재탐지</p><p className="mt-1 font-mono text-[11px]">{r.id}</p><p className="mt-1 text-[11px] text-destructive-foreground/75">{r.redetection.detectedAt} · 새 업무로 검토 중</p></div>
          </div>
        </section>
      )}
      <UnderTabs value={tab} onChange={setTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '자금 흐름' }, { value: 'transactions', label: `거래 ${tx.length}` }, { value: 'conclusion', label: '검토 의견' }]} />

      {tab === 'overview' && (
        <div className="space-y-5" data-testid="overview">
          <div className="grid gap-4 @3xl:grid-cols-3">
            <Card className="shadow-none"><CardContent><p className="text-xs text-muted-foreground">투입 원금</p><p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(metrics.principal, 'USD')}</p></CardContent></Card>
            <Card className="shadow-none"><CardContent><p className="text-xs text-muted-foreground">거래 총액</p><p className="mt-3 text-xl font-semibold tabular-nums">{formatMoney(metrics.total, 'USD')}</p></CardContent></Card>
            <Card className="shadow-none"><CardContent><p className="text-xs text-muted-foreground">순유입</p><p className="mt-3 text-xl font-semibold tabular-nums">{metrics.netInflow === null ? '대표 계좌 선택 필요' : formatMoney(metrics.netInflow, 'USD')}</p></CardContent></Card>
          </div>
          <div className="grid gap-4 @5xl:grid-cols-[1.3fr_1fr_1fr]">
            <Card className="shadow-none"><CardContent>
              <SectionTitle title="일별 의심 거래 금액" description="언제 집중됐는지 · USD" />
              <ChartContainer config={{ USD: { label: 'USD', color: 'var(--muted-foreground)' } }} className="h-[170px] w-full">
                <BarChart data={daily} margin={{ left: 0, right: 4, top: 6 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} /><YAxis width={70} tickLine={false} axisLine={false} fontSize={10} tickFormatter={v => formatMoney(Number(v), 'USD')} />
                  <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: .35 }} content={<ChartTooltipContent formatter={v => formatMoney(Number(v), 'USD')} hideIndicator />} />
                  <Bar dataKey="USD" radius={3}>
                    {daily.map((d, i) => <Cell key={d.day} fill={i === dailyMaxIndex ? 'var(--foreground)' : 'var(--muted-foreground)'} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent></Card>
            <Card className="shadow-none"><CardContent><SectionTitle title="상위 송금 계좌" description="자금이 어디서 나갔는지" /><BarList rows={senders} format={value => formatMoney(value, 'USD')} /></CardContent></Card>
            {r.kind === 'Alert' && <Card className="shadow-none"><CardContent><SectionTitle title="결제 수단 구성" description="어떤 경로가 지배적인지" /><BarList rows={formats} format={value => formatMoney(value, 'USD')} /></CardContent></Card>}
          </div>
          <div className="grid gap-4 @5xl:grid-cols-[1fr_1.4fr_1fr]">
            {r.kind === 'Alert' ? <Card className="shadow-none"><CardContent>
              <SectionTitle title="의심 거래 모양" description={`${r.pattern} 유형 도식 · 도식을 눌러 자금 흐름에서 실제 계좌 확인`} />
              <button type="button" className="pattern-link w-full rounded-md border bg-background/40 p-2" onClick={() => setTab('graph')} aria-label="자금 흐름 그래프로 이동"><PatternGlyph pattern={r.pattern} className="w-full h-40" /></button>
            </CardContent></Card> : <div className="grid gap-4">
              {patternGroups.map(group => <Card key={group[0].pattern} className="shadow-none" data-testid="episode-pattern-card"><CardContent>
                <SectionTitle title={`${group[0].pattern} · Alert ${group.length}건`} />
                <button type="button" className="pattern-link w-full rounded-md border bg-background/40 p-2" onClick={() => setTab('graph')} aria-label={`${group[0].pattern} 자금 흐름 그래프로 이동`}><PatternGlyph pattern={group[0].pattern} className="w-full h-32" /></button>
                <div className="mt-3 flex flex-wrap gap-2">{group.map(alert => <Button key={alert.id} variant="outline" size="sm" className="h-7 gap-2 text-xs" onClick={() => onOpen(alert)}><span className="font-mono">{alert.id}</span><span className="text-muted-foreground">의심 {alert.probability}%</span></Button>)}</div>
              </CardContent></Card>)}
            </div>}
            <Card className="shadow-none"><CardContent>
              <SectionTitle title="탐지 근거" description="탐지 신호를 실제 거래와 대조" />
              <div className="space-y-5 text-sm">
                <div className="flex gap-3"><span className="text-muted-foreground font-mono text-xs pt-0.5">01</span><div><p className="font-medium">계좌 관계 확인</p><p className="text-xs text-muted-foreground leading-6 mt-1">자금 원천과 최종 수취 관계를 실제 거래 및 업무 정보와 대조해야 함.</p></div></div>
                <div className="flex gap-3"><span className="text-muted-foreground font-mono text-xs pt-0.5">02</span><div><p className="font-medium">모델 신호 해석</p><p className="text-xs text-muted-foreground leading-6 mt-1">탐지 신호는 조사 우선순위를 위한 참고이며 그 자체로 의심 거래를 확정하지 않음.</p></div></div>
              </div>
            </CardContent></Card>
            <Card className="shadow-none" data-testid="investigation"><CardContent>
              <SectionTitle title="조사 정보" />
              <dl className="grid grid-cols-[88px_1fr] gap-y-4 text-xs">
                <dt className="text-muted-foreground">조사 단위</dt><dd>{r.kind === 'Alert' ? '단일 탐지 신호' : '연관 Alert 묶음'}</dd>
                <dt className="text-muted-foreground">담당자</dt><dd>{r.owner}</dd>
                <dt className="text-muted-foreground">탐지일</dt><dd>{r.date}</dd>
                <dt className="text-muted-foreground">경과 기간</dt><dd>{r.age === 0 ? '오늘' : `${r.age}일 경과`}</dd>
                <dt className="text-muted-foreground">데이터 기준</dt><dd>탐지 시점 거래 데이터</dd>
              </dl>
            </CardContent></Card>
          </div>
          <Card className="shadow-none"><CardContent>
            <SectionTitle title="처리 이력" description="담당자 · 변경 사유 · 시각" />
            <div className="divide-y">{history.map((e, i) => <div key={i} className="flex gap-4 py-3.5"><span className="text-[11px] text-muted-foreground tabular-nums w-10">{e.at}</span><span className="size-1.5 rounded-full bg-muted-foreground mt-1.5" /><div className="flex-1 text-xs"><p>{e.title}<span className="text-muted-foreground ml-3">{e.actor}</span></p><p className="text-muted-foreground mt-1.5 leading-5 whitespace-pre-wrap">{e.body}</p></div></div>)}</div>
          </CardContent></Card>
        </div>
      )}

      {tab === 'graph' && <Graph key={r.id} model={model} label={`${r.id} 관계 그래프`} />}

      {tab === 'transactions' && (() => {
        const picked = selectedTx === null ? undefined : selectedTx ? tx.find(t => t.id === selectedTx) : [...tx].sort((a, b) => a.at.localeCompare(b.at))[0]
        const senderOwner = picked?.fromOwner
        return (
          <div className="grid gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] items-start">
            <TxTable rows={tx} selectedId={picked?.id} onSelect={setSelectedTx} />
            <Card className="selected-transaction-card shadow-none"><CardContent className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionTitle title="선택한 거래" description="행을 선택하면 바뀝니다" />
                {picked && senderOwner && onOpenTransaction && <Button type="button" variant="outline" size="sm" className="ml-auto h-8 max-w-full min-w-0 gap-1.5 text-xs" aria-label={`${senderOwner} 소유주 자세히 보기`} title={`${senderOwner} 소유주 자세히 보기`} onClick={() => onOpenTransaction(ownerTarget(picked.from))}><UserRound className="size-3.5" /><span className="min-w-0 truncate">{senderOwner}</span><ExternalLink className="size-3.5" /></Button>}
              </div>
              {picked && <dl className="grid grid-cols-2 gap-5 text-xs">
                <div><dt className="text-muted-foreground">거래 ID</dt><dd className="mt-1 flex items-center gap-1 font-mono">{picked.id}{onOpenTransaction && <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Transactions에서 거래 ID 보기" title="Transactions에서 거래 ID 보기" onClick={() => onOpenTransaction({ type: 'transaction', transactionId: picked.id })}><ExternalLink className="size-3.5" /></Button>}</dd></div>
                <div><dt className="text-muted-foreground">송금 계좌</dt><dd className="mt-1 flex items-center gap-1 font-mono">{picked.from}{onOpenTransaction && <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Transactions에서 송금 소유주 보기" title="Transactions에서 송금 소유주 보기" onClick={() => onOpenTransaction(ownerTarget(picked.from))}><ExternalLink className="size-3.5" /></Button>}</dd></div><div><dt className="text-muted-foreground">원 통화 · 수단</dt><dd className="mt-2">{picked.currency} · {picked.format}</dd></div>
                <div><dt className="text-muted-foreground">수취 계좌</dt><dd className="mt-1 flex items-center gap-1 font-mono">{picked.to}{onOpenTransaction && <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Transactions에서 수취 소유주 보기" title="Transactions에서 수취 소유주 보기" onClick={() => onOpenTransaction(ownerTarget(picked.to))}><ExternalLink className="size-3.5" /></Button>}</dd></div><div><dt className="text-muted-foreground">금액</dt><dd className="mt-2 text-base font-semibold">{formatMoney(picked.amount, picked.currency)}</dd></div>
              </dl>}
            </CardContent></Card>
          </div>
        )
      })()}

      {tab === 'conclusion' && (
        <div className="flex flex-1 items-start">
          {/* Figma v17/v18: textarea min-h + flex fill; v18 R2는 resize-y로 크기 조절 핸들 제공 */}
          <Card className="w-full shadow-none h-full"><CardContent className="flex flex-col gap-6 h-full">
            <SectionTitle title={closed ? '종결된 검토' : '검토 의견'} description={closed ? '이 화면에서 완료한 처리 결과입니다.' : '최종 판단을 고르고 근거를 작성하세요. 임시 저장은 확정 처리되지 않습니다.'} />
            <div className="space-y-2">
              <Label>최종 판단</Label>
              <Select value={verdict} onValueChange={setVerdict} disabled={closed || !responsible}>
                <SelectTrigger className="w-80" aria-label="최종 판단"><SelectValue /></SelectTrigger>
                <SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {verdict === 'link-episode' && (
              <div className="space-y-2"><Label>연결할 Episode</Label>
                <Select value={target} onValueChange={setTarget} disabled={closed || !responsible}>
                  <SelectTrigger className="w-80" aria-label="연결할 Episode"><SelectValue placeholder="진행 중인 Episode 선택" /></SelectTrigger>
                  <SelectContent>{records.filter(x => x.kind === 'Episode' && x.status !== '종결').map(x => <SelectItem key={x.id} value={x.id}>{x.id} · {x.pattern} {x.probability}%</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {verdict === 'new-episode' && (
              <div className="space-y-2"><Label htmlFor="new-episode">새 Episode 제목</Label><Input id="new-episode" className="w-80" value={newTitle} onChange={e => setNewTitle(e.target.value)} disabled={closed || !responsible} placeholder="예: 중계 계좌 경유 자금 이동 조사" /></div>
            )}
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <Label htmlFor="reason">판단 근거 <span className="text-muted-foreground">(필수)</span></Label>
              <Textarea id="reason" value={reason} onChange={e => setReason(e.target.value)} disabled={closed || !responsible} className="flex-1 min-h-[280px] resize-y text-sm leading-7" placeholder="확인한 거래, 계좌 간 관계, 판단 근거를 작성하세요." />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={drafts.length === 0} onClick={() => setDraftOpen(true)}><FileClock className="size-3.5" />저장본 목록 {drafts.length > 0 && `(${drafts.length})`}</Button>
              <Button variant="secondary" size="sm" disabled={!responsible || closed || !reason.trim()} onClick={save}><Save className="size-3.5" />임시 저장</Button>
              <Button size="sm" disabled={closed || !ready} onClick={() => setConfirm(true)}><Check className="size-3.5" />{option.action}</Button>
            </div>
          </CardContent></Card>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{r.id} · {option.label}</AlertDialogTitle><AlertDialogDescription>{option.history}{verdict === 'link-episode' ? ` · ${target}` : verdict === 'new-episode' ? ` · ${newTitle}` : ''}. 판단 근거와 담당자를 처리 이력에 남깁니다.</AlertDialogDescription></AlertDialogHeader>
          <div className="max-h-44 overflow-auto bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">{reason}</div>
          <AlertDialogFooter><AlertDialogCancel>돌아가기</AlertDialogCancel><AlertDialogAction onClick={finish}>{option.action}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>저장본 목록</DialogTitle><DialogDescription>현재 상세 화면에서 임시 저장한 의견입니다.</DialogDescription></DialogHeader>
          {drafts.length === 0 ? <p className="text-sm text-muted-foreground py-6">아직 저장된 의견이 없습니다.</p> : drafts.map((d, i) => (
            <div key={i} className="border rounded-md p-3">
              <div className="flex justify-between items-center text-xs"><span>{d.at} · {options.find(o => o.value === d.verdict)?.label}</span><Button size="sm" variant="outline" disabled={closed || !responsible} onClick={() => { setReason(d.text); setVerdict(d.verdict); setDraftOpen(false); toast.success('저장본을 불러왔습니다.') }}>불러오기</Button></div>
              <p className="text-xs text-muted-foreground mt-2 line-clamp-3">{d.text}</p>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  )
}
