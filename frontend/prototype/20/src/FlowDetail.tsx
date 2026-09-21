// v19: 그래프에서 계좌·거래쌍을 누르면 여는 상세. 오른쪽 도킹(좁으면 아래) 또는 RDR 9000처럼 떠 있는 창.
// 흐름 도식은 이미 설치된 recharts의 Sankey, 떠 있는 창은 react-rnd(드래그·리사이즈)를 쓴다.
import { useMemo, useState } from 'react'
import { Rnd } from 'react-rnd'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { Minus, PanelRight, PictureInPicture2, Plus, Shrink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { compactUsd, usd, type GraphModel, type GraphTransaction } from './domain'
import { IconButton } from './shared'

// 확대해도 글자는 화면 크기 그대로(Figma 섹션 이름·annotation처럼): 배율의 역수로 되돌린다
const fixed = (zoom: number, origin: string) => ({ transform: `scale(${1 / zoom})`, transformBox: 'fill-box' as const, transformOrigin: origin })
const span = (first: string, last: string) => first.slice(5, 10) === last.slice(5, 10) ? first.slice(5, 16) : `${first.slice(5, 10)} ~ ${last.slice(5, 10)}`

// 호버 정보창: shadcn 차트 툴팁과 같은 모양(보낸 → 받은, 금액·건수·기간)
function FlowTip({ p }: { p: Record<string, unknown> }) {
  const src = p.source as { name?: string } | undefined, tgt = p.target as { name?: string } | undefined
  const link = !!src && typeof src === 'object'
  return (
    <div className="grid min-w-[8rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium font-mono" translate="no">{link ? `${src?.name?.trim()} → ${tgt?.name?.trim()}` : String(p.name ?? '').trim()}</p>
      <p className="tabular-nums text-muted-foreground"><span className="text-foreground font-medium">{usd(Number(p.value))}</span>{link && ` · ${p.count}건 · ${span(String(p.first), String(p.last))}`}</p>
    </div>
  )
}

export type PanelMode = 'dock' | 'float'
export type FlowFocus = { kind: 'edge'; s: string; t: string } | { kind: 'node'; key: string }
export const flowId = (f: FlowFocus) => f.kind === 'node' ? `flow:${f.key}` : `flow:${f.s}>${f.t}`

const accountOf = (model: GraphModel, key: string) => model.nodes.find(n => n.key === key)?.account ?? key
export const flowLabel = (model: GraphModel, f: FlowFocus) => f.kind === 'node' ? `계좌 ${accountOf(model, f.key)}` : `${accountOf(model, f.s)} ↔ ${accountOf(model, f.t)}`

// 거래의 송·수취 계좌는 엣지(s→t) key로 판정한다
type Row = GraphTransaction & { s: string; t: string }
type SankeyData = { nodes: { name: string; suspect: boolean }[]; links: { source: number; target: number; value: number; suspect: boolean; count: number; first: string; last: string }[] }

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
    const link = links.get(k) ?? { source, target, value: 0, suspect: false, count: 0, first: tx.at, last: tx.at }
    link.value += tx.usd; link.suspect ||= tx.label === 1; link.count += 1
    if (tx.at < link.first) link.first = tx.at
    if (tx.at > link.last) link.last = tx.at
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
  const red = 'var(--graph-l1)', redEdge = 'var(--graph-l1-edge)', grey = 'var(--graph-l0)'
  // 관계 그래프의 '상시 거래 정보 표시'와 같은 역할: 띠마다 금액을 글자로 보인다
  const [showInfo, setShowInfo] = useState(false), [zoom, setZoom] = useState(1), [fitted, setFitted] = useState(true)

  return (
    <div className="flex flex-col gap-4" data-testid="flow-detail">
      <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-4">
        {[['거래', `${txs.length}건`], ['합계', usd(total)], ['의심 거래', `${suspect.length}건 · ${compactUsd(suspect.reduce((s, t) => s + t.usd, 0))}`], ['기간', txs.length ? `${txs[0].at.slice(5, 16)} ~ ${txs[txs.length - 1].at.slice(5, 16)}` : '—']].map(([k, v]) => (
          <Card key={k} className="shadow-none"><CardHeader><CardDescription>{k}</CardDescription><CardTitle className="tabular-nums">{v}</CardTitle></CardHeader></Card>
        ))}
      </div>
      {data.links.length > 0 && (
        <Card className="relative shadow-none">
          <CardHeader>
            <CardTitle>자금 흐름</CardTitle>
            <CardDescription>{focus.kind === 'node' ? '왼쪽 보낸 계좌 → 선택 계좌 → 오른쪽 받은 계좌 · 굵기는 금액(USD)' : '두 계좌 사이 방향별 금액(USD)'}</CardDescription>
            <CardAction className="flex items-center gap-2">
              <Label htmlFor="flow-info" className="text-xs font-normal">거래 정보</Label>
              <Switch id="flow-info" checked={showInfo} onCheckedChange={setShowInfo} />
            </CardAction>
          </CardHeader>
          <CardContent>
            {/* v20 R16: 표 없이 읽히도록 확대·축소·화면 맞춤(react-zoom-pan-pinch). 글자는 배율과 무관하게 화면 크기 고정 */}
            <TransformWrapper minScale={0.5} maxScale={6} smooth={false} wheel={{ step: 0.12 }} doubleClick={{ disabled: true }} onTransform={(_, s) => { setZoom(s.scale); setFitted(Math.abs(s.scale - 1) < .001 && Math.abs(s.positionX) < .5 && Math.abs(s.positionY) < .5) }}>
              {({ zoomIn, zoomOut, resetTransform }) => (
                <div>
                  <TransformComponent wrapperClass="!w-full rounded-md" contentClass="!w-full">
                    <div className="h-[340px] w-full">
                      <ResponsiveContainer>
                        <Sankey data={data} nodePadding={18} nodeWidth={10} margin={{ left: 96, right: 96, top: 22, bottom: 10 }}
                          link={({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) => {
                            const d = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`
                            const l = payload as unknown as { suspect: boolean; value: number; count: number; first: string; last: string }
                            const mx = (sourceX + targetX) / 2, my = (sourceY + targetY) / 2 - Math.max(4, linkWidth / 2) - 3
                            return (
                              <g>
                                <path d={d} fill="none" stroke={l.suspect ? redEdge : grey} strokeWidth={Math.max(1, linkWidth)} />
                                {/* 의심 거래는 빨간 점, 정상 거래는 반투명 흰 점이 보낸 쪽 → 받은 쪽으로 흐른다. */}
                                <path d={d} fill="none" className="flow-dash" stroke={l.suspect ? red : 'var(--foreground)'} strokeOpacity={l.suspect ? 1 : .5} strokeWidth={Math.min(3, Math.max(1.5, linkWidth / 4))} strokeDasharray="1 11" strokeLinecap="round" />
                                {showInfo && <text x={mx} y={my} textAnchor="middle" style={fixed(zoom, 'center bottom')} className="fill-foreground text-[10px] tabular-nums">{compactUsd(l.value)} · {l.count}건 · {span(l.first, l.last)}</text>}
                              </g>
                            )
                          }}
                          node={({ x, y, width, height, index, payload }) => {
                            const left = x < 150, center = index === 0
                            return (
                              <Layer key={`n-${index}`}>
                                <Rectangle x={x} y={y} width={width} height={height} fill={(payload as unknown as { suspect: boolean }).suspect ? red : 'var(--muted-foreground)'} />
                                <text x={center ? x + width / 2 : left ? x - 6 : x + width + 6} y={center ? y - 6 : y + height / 2} textAnchor={center ? 'middle' : left ? 'end' : 'start'} dominantBaseline={center ? 'auto' : 'middle'}
                                  style={fixed(zoom, center ? 'center bottom' : left ? 'right center' : 'left center')} className="fill-foreground font-mono text-[11px]">{payload.name.trim()}</text>
                              </Layer>
                            )
                          }}>
                          <Tooltip content={({ active, payload }) => active && payload?.[0] ? <FlowTip p={payload[0].payload} /> : null} />
                        </Sankey>
                      </ResponsiveContainer>
                    </div>
                  </TransformComponent>
                  <div className="absolute bottom-3 right-3 flex items-center rounded-md border bg-card">
                    <IconButton label="축소" onClick={() => zoomOut()}><Minus className="size-3.5" /></IconButton>
                    <span className="w-10 text-center text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span>
                    <IconButton label="확대" onClick={() => zoomIn()}><Plus className="size-3.5" /></IconButton>
                    <IconButton label="화면 맞춤" disabled={fitted} onClick={() => resetTransform()}><Shrink className="size-3.5" /></IconButton>
                  </div>
                </div>
              )}
            </TransformWrapper>
          </CardContent>
        </Card>
      )}
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
