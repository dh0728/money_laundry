// UI 재설계 S7 Episode 상세 개요 시안. S5 Alert 개요의 카드·계산을 재사용하고 Episode에만 있는 질문(왜 묶었나·어떻게 이어지나·판정 진행)을 더한다.
// 요약 카드는 4개(외부 유입액·순유입·근거 거래·거래 기간). 거래 총액은 두지 않는다(10/11).
import { NumBadge } from '@/components/NumBadge'
import { useState } from 'react'
import type { AlertRow, HistoryRow } from '@/api/alerts'
import type { EpisodeDetail, EpisodeTransaction } from '@/api/episodes'
import { typeDisplay } from '@/api/codes'
import { PatternBadge, RiskBadge } from '@/components/badges'
import { ProvenanceBadge, ProvenanceNote } from '@/components/Provenance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { CaseStats } from '@/features/alerts/CasePresentation'
import { CaseActivityCharts } from '@/features/alerts/CaseActivityCharts'
import { alertCode } from '@/features/alerts/alertFilters'
import { historyLabels } from '@/features/alerts/detailText'
import { sumBy, usd } from '@/features/alerts/metrics'
import { Row, Step, flowFacts } from '@/features/alerts/RedesignOverview'

const day = (iso: string) => iso.replace('T', ' ').slice(5, 16)
const hoursBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 36e5)
const gapText = (h: number) => h < 0 ? '겹침' : h < 24 ? `${h}시간 뒤` : `${Math.round(h / 24)}일 뒤`

type Props = { episode: EpisodeDetail; transactions: EpisodeTransaction[]; history: HistoryRow[]; responsible: boolean; onOpenAlert: (alertId: number) => void; onUnlink?: (alertIds: number[], reason: string) => void }

export default function EpisodeOverview({ episode, transactions: tx, history, responsible, onOpenAlert, onUnlink }: Props) {
  const [selecting, setSelecting] = useState(false), [picked, setPicked] = useState<number[]>([]), [reason, setReason] = useState('')
  // Alert별 구간 · 첫 거래 시각 순
  const spans = episode.alerts.map(a => { const own = tx.filter(t => t.alertId === a.alertId).sort((x, y) => x.txAt.localeCompare(y.txAt)); return { a, own, first: own[0]?.txAt ?? a.firstTxAt, last: own[own.length - 1]?.txAt ?? a.lastTxAt } }).sort((x, y) => x.first.localeCompare(y.first))
  // 2개 이상 Alert에 나온 계좌
  const seen = new Map<string, Set<number>>()
  for (const t of tx) for (const acc of [t.fromAccount, t.toAccount]) (seen.get(acc) ?? seen.set(acc, new Set()).get(acc)!).add(t.alertId)
  const shared = [...seen].filter(([, ids]) => ids.size > 1).sort((x, y) => y[1].size - x[1].size)
  const sharedOf = (alertId: number) => shared.filter(([, ids]) => ids.has(alertId)).length
  const isolated = spans.filter(s => sharedOf(s.a.alertId) === 0)
  const { externalIn, externalOut } = flowFacts(tx)
  const times = tx.map(t => t.txAt).sort(), t0 = Date.parse(times[0] ?? episode.flow.periodFrom), t1 = Date.parse(times[times.length - 1] ?? episode.flow.periodTo)
  const pos = (iso: string) => `${((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * 100}%`
  const daily = sumBy(tx, t => t.txAt.slice(5, 10), t => t.amountUsd).sort((a, b) => a.name.localeCompare(b.name)).map(d => ({ day: d.name, amount: Math.round(d.v) }))
  const accounts = [...seen.keys()].map(acc => ({ acc, inUsd: tx.filter(t => t.toAccount === acc).reduce((s, t) => s + t.amountUsd, 0), outUsd: tx.filter(t => t.fromAccount === acc).reduce((s, t) => s + t.amountUsd, 0), alerts: [...seen.get(acc)!] })).sort((a, b) => (b.inUsd + b.outUsd) - (a.inUsd + a.outUsd)).slice(0, 5)
  const decided = episode.alerts.filter(a => a.resolution != null).length, pending = episode.alerts.length - decided
  const joins = history.filter(h => ['ESCALATE', 'EPISODE_CREATE', 'LINK'].includes(h.action))
  const remain = episode.alerts.length - picked.length

  return <div className="space-y-4" data-testid="overview">
    <CaseStats items={[
      { label: '외부 유입액', value: usd(externalIn), secondary: '사건 밖에서 들어온 돈' },
      { label: '순유입 (대표 계좌)', value: usd(episode.flow.netRetainedUsd) },
      { label: '근거 거래', value: `${tx.length}건`, secondary: `Alert ${episode.alerts.length}건에서` },
      { label: '거래 기간', value: `${episode.flow.periodFrom.slice(5, 10)} ~ ${episode.flow.periodTo.slice(5, 10)}` },
    ]} />
    <div className="grid grid-cols-1 items-stretch gap-4 @5xl:grid-cols-2">
      <Step n={1} title="왜 묶었나" description="누가 언제 어떤 이유로 Alert를 이 Episode에 넣었나" source="사람" wide>
        <ul className="space-y-3 text-xs">{(joins.length ? joins : history.slice(-1)).map(h => <li key={h.id} className="grid grid-cols-[80px_1fr] gap-2"><span className="tabular-nums text-muted-foreground">{day(h.at)}</span><span><b className="font-medium">{historyLabels[h.action]}</b> · {h.actor.name}{h.comment && <span className="mt-0.5 block text-muted-foreground">{h.comment}</span>}</span></li>)}</ul>
      </Step>
      <Step n={2} title="연결 Alert" description="첫 거래 시각 순 · 행을 누르면 Alert 상세로" source="관측·사람" wide action={<Button size="sm" variant="outline" disabled={!responsible || !onUnlink} onClick={() => { setSelecting(v => !v); setPicked([]); setReason('') }}>{selecting ? '선택 취소' : '연결 해제'}</Button>}>
        <Table><TableHeader><TableRow>{selecting && <TableHead className="w-8" />}<TableHead>순서</TableHead><TableHead>Alert</TableHead><TableHead>대표 유형</TableHead><TableHead>위험</TableHead><TableHead>거래 기간</TableHead><TableHead>직전과 간격</TableHead><TableHead className="text-right">거래</TableHead><TableHead className="text-right">공유 계좌</TableHead><TableHead>원래 담당</TableHead><TableHead>판정</TableHead></TableRow></TableHeader>
          <TableBody>{spans.map(({ a, own, first, last }, i) => { const on = picked.includes(a.alertId); return <TableRow key={a.alertId} className={`cursor-pointer ${on ? 'bg-muted/50' : ''}`} onClick={() => selecting ? setPicked(p => on ? p.filter(v => v !== a.alertId) : [...p, a.alertId]) : onOpenAlert(a.alertId)}>
            {selecting && <TableCell><Checkbox checked={on} aria-label={`${alertCode(a.alertId)} 선택`} /></TableCell>}
            <TableCell className="tabular-nums">{i + 1}</TableCell><TableCell className="font-mono text-xs">{alertCode(a.alertId)}</TableCell>
            <TableCell><PatternBadge code={a.primaryType.code} /></TableCell><TableCell><RiskBadge score={a.riskScore} /></TableCell>
            <TableCell className="tabular-nums text-xs">{day(first)} ~ {day(last).slice(6)}</TableCell>
            <TableCell className="text-xs">{i === 0 ? '—' : gapText(hoursBetween(spans[i - 1].last, first))}</TableCell>
            <TableCell className="text-right tabular-nums">{own.length}건</TableCell>
            <TableCell className="text-right tabular-nums">{sharedOf(a.alertId) || <span className="text-destructive">0</span>}</TableCell>
            <TableCell className="text-xs">{(a as AlertRow).assignee.name}</TableCell>
            <TableCell className="text-xs">{a.resolution ? '판정됨' : '미판정'}</TableCell>
          </TableRow> })}</TableBody></Table>
        {selecting && <div className="mt-3 space-y-2">
          <Textarea className="min-h-14 text-sm" placeholder="연결 해제 사유(필수)" value={reason} onChange={e => setReason(e.target.value)} />
          {picked.length > 0 && remain < 2 && <p className="text-xs text-destructive">Episode가 해체되고 남은 Alert {remain}건도 모두 해제됩니다.</p>}
          <div className="flex justify-end"><Button size="sm" disabled={!picked.length || !reason.trim()} onClick={() => { onUnlink?.(picked, reason.trim()); setSelecting(false) }}>선택 {picked.length}건 연결 해제</Button></div>
        </div>}
        <div className="mt-2"><ProvenanceNote kind="proposal">원래 담당은 Episode 상세에 없어 Alert마다 조회합니다. 서버가 함께 주는 편이 맞습니다(2단계).</ProvenanceNote></div>
      </Step>

      <Step n={3} title="무엇으로 이어지나" description="2개 이상 Alert에 나온 계좌" source="관측">
        {shared.length ? <ul className="space-y-2 text-xs">{shared.slice(0, 6).map(([acc, ids]) => <li key={acc} className="flex flex-wrap items-center gap-2"><span className="font-mono">{acc}</span><span className="text-muted-foreground">Alert {ids.size}건</span><span className="flex gap-1">{[...ids].map(id => <Badge key={id} variant="outline" className="font-mono font-normal">{alertCode(id)}</Badge>)}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">Alert끼리 공유하는 계좌가 없습니다.</p>}
        {isolated.length > 0 && <p className="mt-3 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">연결 근거 없음: {isolated.map(s => alertCode(s.a.alertId)).join(', ')}는 다른 Alert와 공유하는 계좌가 없습니다. 묶은 이유를 <NumBadge n={1} />에서 확인하세요.</p>}
      </Step>

      <Step n={4} title="통합 자금 흐름" description="Episode 전체에서 사건 밖으로 들어오고 나간 돈" source="계산">
        <dl className="grid grid-cols-[112px_1fr] gap-y-3 text-xs">
          <Row label="외부 유입" value={usd(externalIn)} /><Row label="외부 유출" value={usd(externalOut)} />
          <Row label="경유 비율" value={externalIn ? `${Math.round((externalOut / externalIn) * 100)}%` : '산출 불가'} note="외부 유출 ÷ 외부 유입" />
        </dl>
        <p className="mt-4 text-xs font-medium">Alert별 구간</p>
        <div className="mt-2 space-y-1.5">{spans.map(({ a, first, last }) => <div key={a.alertId} className="grid grid-cols-[56px_1fr] items-center gap-2 text-[0.6875rem]"><span className="font-mono">{alertCode(a.alertId)}</span>
          <span className="relative h-3 rounded bg-muted"><span className="absolute top-0 h-3 rounded" style={{ left: pos(first), width: `max(4px, calc(${pos(last)} - ${pos(first)}))`, backgroundColor: 'var(--palette-blue-500)' }} title={`${day(first)} ~ ${day(last)}`} /></span></div>)}</div>
        <p className="mt-1 flex justify-between pl-16 text-[0.6875rem] text-muted-foreground tabular-nums"><span>{day(times[0] ?? episode.flow.periodFrom)}</span><span>{day(times[times.length - 1] ?? episode.flow.periodTo)}</span></p>
      </Step>

      <div className="@5xl:col-span-2"><CaseActivityCharts amounts={{ USD: { daily, senders: sumBy(tx, t => t.fromAccount, t => t.amountUsd).slice(0, 5) } }} /></div>

      <Step n={5} title="어떤 모양인가" description="Alert마다 다를 수 있어 하나로 줄이지 않습니다" source="모델·관측">
        <div className="flex flex-wrap gap-2">{episode.alerts.map(a => <span key={a.alertId} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"><span className="font-mono">{alertCode(a.alertId)}</span><PatternBadge code={a.primaryType.code} /><span className="text-muted-foreground">{typeDisplay(a.primaryType.code).label}</span></span>)}</div>
      </Step>

      <Step n={6} title="누가 관여했나" description="금액이 큰 계좌 5개와 등장한 Alert" source="관측">
        <Table><TableHeader><TableRow><TableHead>계좌</TableHead><TableHead className="text-right">유입</TableHead><TableHead className="text-right">유출</TableHead><TableHead>등장 Alert</TableHead></TableRow></TableHeader>
          <TableBody>{accounts.map(r => <TableRow key={r.acc}><TableCell className="font-mono text-xs">{r.acc}</TableCell><TableCell className="text-right tabular-nums">{usd(r.inUsd)}</TableCell><TableCell className="text-right tabular-nums">{usd(r.outUsd)}</TableCell><TableCell className="text-xs">{r.alerts.map(alertCode).join(', ')}</TableCell></TableRow>)}</TableBody></Table>
      </Step>

      <Step n={7} title="전에 본 적 있나" description="같은 거래·계좌가 나온 다른 사건" source="사람·관측">
        <dl className="grid grid-cols-[112px_1fr] gap-y-3 text-xs"><Row label="같은 거래 판정" value="다른 사건 판정 없음" /><Row label="연관 사건 후보" value={<ProvenanceBadge kind="proposal" title="계좌·소유주로 사건을 찾는 API 필요(2단계)" />} note={<>Alert 개요 <NumBadge n={5} />와 같은 컴포넌트</>} /></dl>
      </Step>
      <Step n={8} title="판정 진행" description="Alert(묶음)마다 판정해야 종결할 수 있습니다" source="사람">
        <p className="text-2xl font-semibold tabular-nums">{decided} / {episode.alerts.length}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(decided / episode.alerts.length) * 100}%`, backgroundColor: 'var(--palette-blue-500)' }} /></div>
        <p className="mt-3 text-xs">{pending ? <>미판정 {pending}건이 남아 <b>아직 종결할 수 없습니다.</b> 검토 의견 탭에서 묶음별로 판정합니다.</> : '모든 묶음이 판정돼 종결할 수 있습니다.'}</p>
      </Step>

      <Step title="처리 이력" description="편입 · 해제 · 판정" source="사람" wide>
        <div className="divide-y">{history.map(e => <div key={e.id} className="flex gap-2.5 py-2"><span className="w-11 shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">{e.at.slice(5, 10)}</span><span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground" /><div className="min-w-0 flex-1 text-xs"><p>{historyLabels[e.action]}<span className="ml-2 text-muted-foreground">{e.actor.name}</span></p>{e.comment && <p className="mt-1 truncate text-muted-foreground">{e.comment}</p>}</div></div>)}</div>
      </Step>
    </div>
    <ProvenanceNote kind="mock">시안용 mock 데이터입니다.</ProvenanceNote>
  </div>
}
