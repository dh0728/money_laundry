import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { Check, FileClock, Link2, Network, Save } from 'lucide-react'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { useMemoryState } from './memory'
import { canClose, compactUsd, graphFor, laundering, sortRows, usd, type RecordItem } from './domain'
import { UnderTabs, RiskBadge, PatternBadge, SectionTitle, SortableHead } from './shared'
import { useSort } from './Lists'
import Graph from './Graph'
import PatternGlyph from './PatternGlyph'

type Draft = { text: string; verdict: string; at: string }
type Event = { title: string; body: string; at: string; actor: string }
type TxRow = { id: string; at: string; from: string; to: string; usd: number; currency: string; format: string }
type TxSort = 'id' | 'at' | 'from' | 'to' | 'usd' | 'currency' | 'format'

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

export default function Detail({ record: r, records, user, onUpdate, onOpen }: { record: RecordItem; records: RecordItem[]; user: string; onUpdate: (r: RecordItem) => void; onOpen: (r: RecordItem) => void }) {
  const model = useMemo(() => graphFor(r, records), [r, records])
  const accountOf = useMemo(() => new Map(model.nodes.map(n => [n.key, n.account])), [model])
  const tx: TxRow[] = useMemo(() => laundering(model).map(t => ({ id: t.id, at: t.at, from: accountOf.get(t.from)!, to: accountOf.get(t.to)!, usd: t.usd, currency: t.currency, format: t.format })), [model, accountOf])
  const options = verdictOptions(r.kind)
  const [tab, setTab] = useState('overview')
  const [reason, setReason] = useMemoryState(`${r.id}:reason`, r.status === '종결' ? '거래 목적 및 계좌 관계 대조 완료. 정상 거래로 판단함.' : '')
  const [verdict, setVerdict] = useMemoryState(`${r.id}:verdict`, 'normal')
  const [target, setTarget] = useMemoryState(`${r.id}:target`, ''), [newTitle, setNewTitle] = useMemoryState(`${r.id}:new-title`, '')
  const [confirm, setConfirm] = useState(false), [draftOpen, setDraftOpen] = useState(false)
  const [drafts, setDrafts] = useMemoryState<Draft[]>(`${r.id}:drafts`, []), [events, setEvents] = useMemoryState<Event[]>(`${r.id}:events`, [])
  const [selectedTx, setSelectedTx] = useState<string | null>(null)
  const txSort = useSort<TxSort>('at', 'asc')
  const responsible = r.owner === user, closed = r.status === '종결'
  const option = options.find(o => o.value === verdict) ?? options[0]
  const needsTarget = verdict === 'link-episode' && !target, needsTitle = verdict === 'new-episode' && !newTitle.trim()
  const ready = canClose(user, r.owner, reason) && !needsTarget && !needsTitle
  const linkedEpisode = r.episodeId ? records.find(x => x.id === r.episodeId) : undefined
  const linkedAlerts = (r.alertIds ?? []).map(id => records.find(x => x.id === id)).filter(Boolean) as RecordItem[]
  const linkedLabel = r.kind === 'Alert' ? 'Episode' : 'Alert'
  const linkedRecords = r.kind === 'Alert' ? (linkedEpisode ? [linkedEpisode] : []) : linkedAlerts

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
  // 9/18: 거래 블록에는 경과일 대신 첫~마지막 거래 시각 범위를 보인다 (경과일은 제목 줄 업무 메타로 이동)
  const txTimes = tx.map(t => t.at).sort()
  const txSpan = txTimes.length ? `${txTimes[0].slice(5, 16)} ~ ${txTimes[txTimes.length - 1].slice(5, 16)}` : '—'
  const formats = counts(tx, t => t.format, t => t.usd).slice(0, 5)
  const senders = counts(tx, t => t.from, t => t.usd).slice(0, 5)
  const patternMix = counts(linkedAlerts, a => a.pattern, () => 1)
  const history = [...events, { title: '검토 시작', body: '탐지 근거와 연결 거래를 확인함', at: '13:42', actor: r.owner }, { title: '담당자 자동 배정', body: `${r.owner}에게 배정됨`, at: '13:38', actor: '시스템' }, { title: `${r.kind} 생성`, body: `${r.pattern} ${r.probability}% 탐지`, at: '13:35', actor: '시스템' }]

  return (
    <div className="space-y-5">
      {/* Figma v17: row1 = 제목 + 연결 레코드 팝오버 버튼(긴 chip 대체), row2 = record id·상태·위험·패턴·담당. 우측은 읽기 전용 안내만 남긴다 */}
      <div className="flex flex-col @5xl:flex-row @5xl:items-start @5xl:justify-between gap-3" data-testid="detail-header">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{r.title}</h1>
            {linkedRecords.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs font-normal"><Link2 className="size-3.5" />연결된 {linkedLabel} {linkedRecords.length}</Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-1.5" align="start">
                  <div className="space-y-1">
                    {linkedRecords.map(x => (
                      <button type="button" key={x.id} onClick={() => onOpen(x)} className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="min-w-0">
                          <span className="block font-mono">{x.id}</span>
                          <span className="block text-muted-foreground truncate mt-0.5">{x.title}</span>
                        </span>
                        <RiskBadge risk={x.risk} score={x.score} />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2.5" data-testid="detail-row2">
            <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
            <Badge variant="outline" className="text-[10px] font-normal">{r.status}</Badge>
            <RiskBadge risk={r.risk} score={r.score} />
            <PatternBadge pattern={r.pattern} probability={r.probability} />
            <span className="text-xs text-muted-foreground">담당 {r.owner} · {r.date} 탐지 · {r.age === 0 ? '오늘' : `${r.age}일 경과`}</span>
          </div>
        </div>
        {!responsible && (
          <p className="text-xs text-muted-foreground rounded-md border px-3 py-2 shrink-0 @5xl:whitespace-nowrap">현재 {user} 계정으로 조회 중입니다. 최종 처리는 담당자 {r.owner}{josa(r.owner, '이', '가')} 수행합니다.</p>
        )}
      </div>
      <UnderTabs value={tab} onChange={setTab} items={[{ value: 'overview', label: '개요' }, { value: 'graph', label: '자금 흐름' }, { value: 'transactions', label: `거래 ${tx.length}` }, { value: 'conclusion', label: '검토 의견' }]} />

      {tab === 'overview' && (
        <div className="space-y-5" data-testid="overview">
          <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-4">
            {[{ label: '의심 거래 금액', value: usd(r.amount) }, { label: '근거 거래', value: `${tx.length}건` }, { label: r.kind === 'Alert' ? '의심 거래 참여 계좌' : '연결 Alert', value: r.kind === 'Alert' ? `${model.nodes.filter(n => n.core).length}개` : `${linkedAlerts.length}건` }, { label: '거래 기간', value: txSpan }].map(s => (
              <Card key={s.label} className="shadow-none"><CardContent><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-semibold tabular-nums mt-3">{s.value}</p></CardContent></Card>
            ))}
          </div>
          <div className="grid gap-4 @5xl:grid-cols-[1.3fr_1fr_1fr]">
            <Card className="shadow-none"><CardContent>
              <SectionTitle title="일별 의심 거래 금액" description="언제 집중됐는지 · USD" />
              <ChartContainer config={{ USD: { label: 'USD', color: 'var(--muted-foreground)' } }} className="h-[170px] w-full">
                <BarChart data={daily} margin={{ left: 0, right: 4, top: 6 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} /><YAxis width={48} tickLine={false} axisLine={false} fontSize={10} tickFormatter={v => compactUsd(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="USD" radius={3}>
                    {daily.map((d, i) => <Cell key={d.day} fill={i === dailyMaxIndex ? 'var(--foreground)' : 'var(--muted-foreground)'} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent></Card>
            <Card className="shadow-none"><CardContent><SectionTitle title="상위 송금 계좌" description="자금이 어디서 나갔는지" /><BarList rows={senders} format={compactUsd} /></CardContent></Card>
            <Card className="shadow-none"><CardContent>
              {r.kind === 'Alert'
                ? <><SectionTitle title="결제 수단 구성" description="어떤 경로가 지배적인지" /><BarList rows={formats} format={compactUsd} /></>
                : <><SectionTitle title="연결 Alert 유형" description="묶인 탐지 신호의 구성" /><BarList rows={patternMix} format={v => `${v}건`} /></>}
            </CardContent></Card>
          </div>
          <div className="grid gap-4 @5xl:grid-cols-[1fr_1.4fr_1fr]">
            <Card className="shadow-none"><CardContent>
              <SectionTitle title="의심 거래 모양" description={`${r.pattern} 유형 도식 · 실제 계좌는 자금 흐름에서 확인`} />
              <button type="button" className="w-full rounded-md border bg-background/40 hover:bg-muted/40 p-2" onClick={() => setTab('graph')} aria-label="자금 흐름 그래프로 이동"><PatternGlyph pattern={r.pattern} className="w-full h-40" /></button>
              <Button variant="outline" className="mt-3 text-xs w-full" size="sm" onClick={() => setTab('graph')}><Network className="size-3.5" />자금 흐름에서 확인</Button>
            </CardContent></Card>
            <Card className="shadow-none"><CardContent>
              <SectionTitle title="탐지 근거" description="탐지 신호를 실제 거래와 대조" />
              <div className="space-y-5 text-sm">
                <div className="flex gap-3"><span className="text-muted-foreground font-mono text-xs pt-0.5">01</span><div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground leading-6 mt-1">모델이 의심으로 판별한 거래 {tx.length}건, 참여 계좌 {model.nodes.filter(n => n.core).length}개가 탐지 범위에 포함됨. 거래 목적 및 계좌 간 관계 확인 필요.</p></div></div>
                <div className="flex gap-3"><span className="text-muted-foreground font-mono text-xs pt-0.5">02</span><div><p className="font-medium">탐지 유형 {r.pattern} · 모델 확률 {r.probability}%</p><p className="text-xs text-muted-foreground leading-6 mt-1">위험 점수 {r.score}점(상위 {Math.max(1, 100 - r.score)}%)과 모델 확률은 별도 지표임. 유형 확률만으로 의심 거래를 확정하지 않음.</p></div></div>
              </div>
            </CardContent></Card>
            <Card className="shadow-none"><CardContent>
              <SectionTitle title="조사 정보" />
              <dl className="grid grid-cols-[88px_1fr] gap-y-4 text-xs">
                <dt className="text-muted-foreground">조사 단위</dt><dd>{r.kind === 'Alert' ? '단일 탐지 신호' : '연관 Alert 묶음'}</dd>
                <dt className="text-muted-foreground">담당자</dt><dd>{r.owner}</dd>
                <dt className="text-muted-foreground">현재 상태</dt><dd>{r.status}</dd>
                <dt className="text-muted-foreground">데이터 기준</dt><dd>IBM HI-Small 블록 #{model.blocks.join(', #')}</dd>
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
        const rows = sortRows(tx, txSort.key, txSort.direction), picked = tx.find(t => t.id === selectedTx) ?? rows[0]
        const head = (label: string, key: TxSort, align: 'left' | 'right' = 'left') => <SortableHead label={label} active={txSort.key === key} direction={txSort.direction} onSort={() => txSort.toggle(key)} align={align} />
        return (
          <div className="grid gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] items-start">
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader><TableRow>{head('거래 ID', 'id')}{head('일시', 'at')}{head('송금 계좌', 'from')}{head('수취 계좌', 'to')}{head('금액 (USD)', 'usd', 'right')}{head('결제 수단', 'format')}</TableRow></TableHeader>
                <TableBody>{rows.map(t => (
                  <TableRow key={t.id} data-state={picked?.id === t.id ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelectedTx(t.id)}>
                    <TableCell className="font-mono text-sm py-3">{t.id}</TableCell><TableCell className="text-sm tabular-nums py-3">{t.at}</TableCell>
                    <TableCell className="font-mono text-sm py-3">{t.from}</TableCell><TableCell className="font-mono text-sm py-3">{t.to}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums py-3">{usd(t.usd)}</TableCell><TableCell className="text-sm py-3">{t.format}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
            <Card className="shadow-none @5xl:sticky @5xl:top-20"><CardContent className="space-y-6">
              <SectionTitle title="선택한 거래" description="행을 선택하면 바뀝니다" />
              {picked && <dl className="grid grid-cols-2 gap-5 text-xs">
                <div><dt className="text-muted-foreground">거래 ID</dt><dd className="mt-2 font-mono">{picked.id}</dd></div><div><dt className="text-muted-foreground">일시</dt><dd className="mt-2 tabular-nums">{picked.at}</dd></div>
                <div><dt className="text-muted-foreground">송금 계좌</dt><dd className="mt-2 font-mono">{picked.from}</dd></div><div><dt className="text-muted-foreground">수취 계좌</dt><dd className="mt-2 font-mono">{picked.to}</dd></div>
                <div><dt className="text-muted-foreground">금액</dt><dd className="mt-2 text-base font-semibold">{usd(picked.usd)}</dd></div><div><dt className="text-muted-foreground">원 통화 · 수단</dt><dd className="mt-2">{picked.currency} · {picked.format}</dd></div>
              </dl>}
              <div className="border-t pt-5 grid grid-cols-2 gap-5 text-xs">
                <div><p className="text-muted-foreground">총 거래</p><p className="mt-2 text-base font-semibold">{tx.length}건</p></div>
                <div><p className="text-muted-foreground">총 금액</p><p className="mt-2 text-base font-semibold">{usd(tx.reduce((s, t) => s + t.usd, 0))}</p></div>
              </div>
            </CardContent></Card>
          </div>
        )
      })()}

      {tab === 'conclusion' && (
        <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)] items-start">
          {/* Figma v17/v18: textarea min-h + flex fill; v18 R2는 resize-y로 크기 조절 핸들 제공 */}
          <Card className="shadow-none @5xl:self-stretch"><CardContent className="flex flex-col gap-6 h-full">
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
            <div className="flex items-center justify-end gap-2 border-t pt-5">
              <Button variant="ghost" size="sm" disabled={drafts.length === 0} onClick={() => setDraftOpen(true)}><FileClock className="size-3.5" />저장본 목록 {drafts.length > 0 && `(${drafts.length})`}</Button>
              <Button variant="secondary" size="sm" disabled={!responsible || closed || !reason.trim()} onClick={save}><Save className="size-3.5" />임시 저장</Button>
              <Button size="sm" disabled={closed || !ready} onClick={() => setConfirm(true)}><Check className="size-3.5" />{option.action}</Button>
            </div>
          </CardContent></Card>
          <Card className="shadow-none"><CardContent className="space-y-6">
            <SectionTitle title="판단 참고" description="의견 작성 중 함께 확인할 근거" />
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div><p className="text-muted-foreground">의심 거래</p><p className="mt-1.5 text-base font-semibold tabular-nums">{tx.length}건 · {compactUsd(r.amount)}</p></div>
              <div><p className="text-muted-foreground">탐지 유형</p><p className="mt-1.5"><PatternBadge pattern={r.pattern} probability={r.probability} /></p></div>
            </div>
            <div><p className="text-xs text-muted-foreground mb-3">상위 송금 계좌</p><BarList rows={senders.slice(0, 3)} format={compactUsd} /></div>
            <div className="text-xs"><p className="text-muted-foreground mb-2">{r.kind === 'Alert' ? '연결 Episode' : '연결 Alert'}</p>{r.kind === 'Alert' ? (linkedEpisode ? <Button variant="link" className="p-0 h-auto text-xs font-mono" onClick={() => onOpen(linkedEpisode)}>{linkedEpisode.id}</Button> : '없음') : linkedAlerts.map(a => <Button key={a.id} variant="link" className="p-0 h-auto text-xs font-mono mr-3" onClick={() => onOpen(a)}>{a.id}</Button>)}</div>
            <div className="text-xs border-t pt-4"><p className="text-muted-foreground mb-2">최근 처리 이력</p>{history.slice(0, 3).map((e, i) => <p key={i} className="py-1.5 flex gap-3"><span className="tabular-nums text-muted-foreground w-10">{e.at}</span>{e.title}</p>)}</div>
          </CardContent></Card>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{r.id} · {option.label}</AlertDialogTitle><AlertDialogDescription>{option.history}{verdict === 'link-episode' ? ` · ${target}` : verdict === 'new-episode' ? ` · ${newTitle}` : ''}. 판단 근거와 담당자를 처리 이력에 남깁니다. 현재 실행 중인 화면 데이터에만 반영됩니다.</AlertDialogDescription></AlertDialogHeader>
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
