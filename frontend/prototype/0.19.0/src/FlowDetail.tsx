// v19: 그래프에서 계좌·거래쌍을 누르면 여는 상세. 오른쪽 도킹(좁으면 아래) 또는 RDR 9000처럼 떠 있는 창.
// 흐름 도식은 이미 설치된 recharts의 Sankey, 거래 목록은 shadcn Table, 떠 있는 창은 react-rnd(드래그·리사이즈)를 쓴다.
import { useMemo, useState } from 'react'
import { Rnd } from 'react-rnd'
import { PanelRight, PictureInPicture2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compactUsd, usd, type GraphModel, type GraphTransaction } from './domain'

export type PanelMode = 'dock' | 'float'
export type FlowFocus = { kind: 'edge'; s: string; t: string } | { kind: 'node'; key: string }
export const flowId = (f: FlowFocus) => f.kind === 'node' ? `flow:${f.key}` : `flow:${f.s}>${f.t}`

const accountOf = (model: GraphModel, key: string) => model.nodes.find(n => n.key === key)?.account ?? key
export const flowLabel = (model: GraphModel, f: FlowFocus) => f.kind === 'node' ? `계좌 ${accountOf(model, f.key)}` : `${accountOf(model, f.s)} ↔ ${accountOf(model, f.t)}`

// 거래의 송·수취 계좌는 엣지(s→t) key로 판정한다
type Row = GraphTransaction & { s: string; t: string }
type SankeyData = { nodes: { name: string; suspect: boolean }[]; links: { source: number; target: number; value: number; suspect: boolean }[] }

// 계좌 focus: 보낸 상대(왼쪽) → 선택 계좌(가운데) → 받은 상대(오른쪽). 같은 상대는 금액을 합친다.
function sankeyFor(model: GraphModel, focus: FlowFocus, txs: Row[]): SankeyData {
  const center = focus.kind === 'node' ? focus.key : focus.s
  const nodes: SankeyData['nodes'] = [{ name: accountOf(model, center), suspect: false }]
  const links = new Map<string, SankeyData['links'][number]>()
  const indexOf = (side: 'in' | 'out', key: string) => {
    const name = `${accountOf(model, key)}${side === 'in' ? ' ' : '  '}` // 같은 계좌가 양쪽에 나오면 이름으로 구분
    let i = nodes.findIndex(n => n.name === name)
    if (i < 0) { nodes.push({ name, suspect: false }); i = nodes.length - 1 }
    return i
  }
  for (const tx of txs) {
    if (tx.s === tx.t) continue // 자기 자신 거래는 흐름 도식에서 제외(목록에는 남음)
    const incoming = tx.t === center
    const other = incoming ? tx.s : tx.t
    const o = indexOf(incoming ? 'in' : 'out', other)
    const [source, target] = incoming ? [o, 0] : [0, o]
    const k = `${source}>${target}`
    const link = links.get(k) ?? { source, target, value: 0, suspect: false }
    link.value += tx.usd; link.suspect ||= tx.label === 1
    links.set(k, link)
    if (tx.label === 1) { nodes[o].suspect = true; nodes[0].suspect = true }
  }
  return { nodes, links: [...links.values()] }
}

export default function FlowDetail({ model, focus }: { model: GraphModel; focus: FlowFocus }) {
  const txs = useMemo<Row[]>(() => {
    const hit = (s: string, t: string) => focus.kind === 'node'
      ? s === focus.key || t === focus.key
      : (s === focus.s && t === focus.t) || (s === focus.t && t === focus.s)
    return model.edges.filter(e => hit(e.s, e.t)).flatMap(e => e.transactions.map(tx => ({ ...tx, s: e.s, t: e.t }))).sort((a, b) => a.at.localeCompare(b.at))
  }, [model, focus])
  const data = useMemo(() => sankeyFor(model, focus, txs), [model, focus, txs])
  const suspect = txs.filter(t => t.label === 1)
  const total = txs.reduce((s, t) => s + t.usd, 0)
  const red = 'var(--graph-l1)', grey = 'var(--graph-l0)'
  // 관계 그래프의 '상시 거래 정보 표시'와 같은 역할: 띠마다 금액을 글자로 보인다
  const [showInfo, setShowInfo] = useState(false)

  return (
    <div className="flex flex-col gap-4" data-testid="flow-detail">
      <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-4">
        {[['거래', `${txs.length}건`], ['합계', usd(total)], ['의심 거래', `${suspect.length}건 · ${compactUsd(suspect.reduce((s, t) => s + t.usd, 0))}`], ['기간', txs.length ? `${txs[0].at.slice(5, 16)} ~ ${txs[txs.length - 1].at.slice(5, 16)}` : '—']].map(([k, v]) => (
          <Card key={k} className="shadow-none"><CardHeader><CardDescription>{k}</CardDescription><CardTitle className="tabular-nums">{v}</CardTitle></CardHeader></Card>
        ))}
      </div>
      {data.links.length > 0 && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>자금 흐름</CardTitle>
            <CardDescription>{focus.kind === 'node' ? '왼쪽 보낸 계좌 → 선택 계좌 → 오른쪽 받은 계좌 · 굵기는 금액(USD)' : '두 계좌 사이 방향별 금액(USD)'}</CardDescription>
            <CardAction className="flex items-center gap-2">
              <Label htmlFor="flow-info" className="text-xs font-normal">거래 정보</Label>
              <Switch id="flow-info" checked={showInfo} onCheckedChange={setShowInfo} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer>
                <Sankey data={data} nodePadding={18} nodeWidth={10} margin={{ left: 96, right: 96, top: 18, bottom: 10 }}
                  link={({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) => {
                    const d = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`
                    const suspect = (payload as unknown as { suspect: boolean }).suspect
                    return (
                      <g>
                        <path d={d} fill="none" stroke={suspect ? red : grey} strokeOpacity={.45} strokeWidth={Math.max(1, linkWidth)} />
                        {/* 자금 흐름 방향: 띠 위로 점선이 보낸 쪽 → 받은 쪽으로 흐른다(메인 그래프의 입자와 같은 의미) */}
                        {showInfo && <text x={(sourceX + targetX) / 2} y={(sourceY + targetY) / 2 - Math.max(4, linkWidth / 2) - 3} textAnchor="middle" className="fill-foreground text-[10px] tabular-nums">{compactUsd((payload as unknown as { value: number }).value)}</text>}
                        <path d={d} fill="none" className="flow-dash" stroke={suspect ? red : 'var(--muted-foreground)'} strokeWidth={Math.min(3, Math.max(1.5, linkWidth / 4))} strokeDasharray="2 10" strokeLinecap="round" />
                      </g>
                    )
                  }}
                  node={({ x, y, width, height, index, payload }) => {
                    const left = x < 150, center = index === 0
                    return (
                      <Layer key={`n-${index}`}>
                        <Rectangle x={x} y={y} width={width} height={height} fill={(payload as unknown as { suspect: boolean }).suspect ? red : 'var(--muted-foreground)'} />
                        <text x={center ? x + width / 2 : left ? x - 6 : x + width + 6} y={center ? y - 6 : y + height / 2} textAnchor={center ? 'middle' : left ? 'end' : 'start'} dominantBaseline={center ? 'auto' : 'middle'} className="fill-foreground font-mono text-[11px]">{payload.name.trim()}</text>
                      </Layer>
                    )
                  }}>
                  <Tooltip formatter={v => usd(Number(v))} />
                </Sankey>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
      <Card className="shadow-none">
        <CardHeader><CardTitle>거래 {txs.length}건</CardTitle><CardDescription>시각 순 · 자기 자신 거래 포함</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>거래 ID</TableHead><TableHead>일시</TableHead><TableHead>송금 계좌</TableHead><TableHead>수취 계좌</TableHead><TableHead className="text-right">금액 (USD)</TableHead><TableHead>결제 수단</TableHead><TableHead>구분</TableHead></TableRow></TableHeader>
            <TableBody>
              {txs.map(tx => (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono text-xs" translate="no">{tx.id}</TableCell>
                  <TableCell className="tabular-nums text-xs">{tx.at.slice(5, 16)}</TableCell>
                  <TableCell className="font-mono text-xs" translate="no">{accountOf(model, tx.s)}</TableCell>
                  <TableCell className="font-mono text-xs" translate="no">{accountOf(model, tx.t)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(tx.usd)}</TableCell>
                  <TableCell className="text-xs">{tx.format}</TableCell>
                  <TableCell>{tx.label === 1 ? <Badge variant="destructive">의심</Badge> : <Badge variant="outline">정상</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// 상세 창 셸: 제목 + (도킹 ↔ 플로팅) + 닫기. 본문은 container query로 좁은 폭에서 한 줄씩 쌓인다.
export function FlowPanel({ model, focus, mode, onModeChange, onClose }: { model: GraphModel; focus: FlowFocus; mode: PanelMode; onModeChange: (m: PanelMode) => void; onClose: () => void }) {
  const body = (
    <div className="flex flex-col h-full min-h-0 bg-card" data-testid="flow-panel" data-mode={mode}>
      <div className="flow-panel-handle flex items-center gap-2 border-b px-3 py-2 shrink-0">
        <h3 className="flex-1 min-w-0 truncate text-sm font-semibold" translate="no">{flowLabel(model, focus)}</h3>
        <Button variant="ghost" size="icon" className="size-7" aria-label={mode === 'dock' ? '떠 있는 창으로 보기' : '오른쪽에 고정'} title={mode === 'dock' ? '떠 있는 창으로 보기' : '오른쪽에 고정'} onClick={() => onModeChange(mode === 'dock' ? 'float' : 'dock')}>
          {mode === 'dock' ? <PictureInPicture2 /> : <PanelRight />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="상세 닫기" onClick={onClose}><X /></Button>
      </div>
      <div className="@container flex-1 min-h-0 overflow-auto p-3"><FlowDetail model={model} focus={focus} /></div>
    </div>
  )
  if (mode === 'dock') return body
  const vw = globalThis.innerWidth ?? 1440
  return (
    // 떠 있는 창: 화면 안에서만 끌고(bounds) 가장자리로 크기 조절. 제목 줄을 잡아 이동한다.
    <div className="fixed inset-0 z-50 pointer-events-none">
      <Rnd bounds="parent" dragHandleClassName="flow-panel-handle" minWidth={340} minHeight={320}
        default={{ x: Math.max(16, vw - 560 - 24), y: 88, width: 560, height: 620 }}
        className="pointer-events-auto overflow-hidden rounded-xl border shadow-2xl">
        {body}
      </Rnd>
    </div>
  )
}