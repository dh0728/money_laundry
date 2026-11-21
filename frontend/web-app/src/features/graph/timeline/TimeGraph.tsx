// UI 재설계 §6 관계 그래프 시안: React Flow, 시간순 왼쪽→오른쪽(Q2, 10/6 팀 결정).
// 10/12 김명기: 위치가 곧 정보(x = 시간, y = 계좌 행)라 노드를 끌어 옮기지 않는다. 그래프를 갖고 노는 화면이 아니다.
// 시각 문법: 엣지 색 = 위험, 굵기 = 금액, 건수 = 글자, 방향 = 엣지 안을 흐르는 입자(reduced-motion이면 정지 쉐브론).
// 위치는 처음 한 번만 계산해 상태로 들고 있고, 재조회·패널 열고 닫기로 다시 배치하지 않는다(§6.1).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, ViewportPortal, getBezierPath, useEdgesState, useNodesState, useReactFlow, useViewport, type Edge, type EdgeProps, type Node, type NodeProps, type OnSelectionChangeParams, type Viewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import { ProvenanceBadge } from '@/components/Provenance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { buildTimeline, chooseSpacing, columnX, detectPatterns, lanePlan, NODE_SIZE, OWNER_HEAD, type Appearance, type Bundle, type TimeTx } from './timeLayout'
import PairTimeline from './PairTimeline'
import PatternGraph, { type PatternControls, type PatternSelection } from './PatternGraph'
import { NumBadge } from '@/components/NumBadge'
import { SelectionActions, type GraphContext } from './SelectionActions'

const NODE = NODE_SIZE
const MIN_ZOOM = 0.2, MAX_ZOOM = 2.5
// 조작 안내 열림 여부는 이 브라우저에 기억한다(기본은 열림). 저장소를 못 쓰면 매번 열림
const GUIDE_KEY = 'aml:graphGuideOpen'
const readGuide = () => { try { return window.localStorage.getItem(GUIDE_KEY) !== '0' } catch { return true } }
const usdShort = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`
const risk = (score: number) => `var(--risk-${Math.min(9, Math.max(0, Math.floor(score * 10)))})`

type AccNode = Node<{ app: Appearance; highlighted: boolean }, 'account'>
type FlowEdge = Edge<{ bundle: Bundle; width: number; showLabel: boolean }, 'flow'>

const AccountNode = memo(function AccountNode({ data, selected }: NodeProps<AccNode>) {
  const { app, highlighted } = data
  return <div title={`${app.n}번 ${app.account}${app.nth > 1 ? ` · ${app.nth}번째 등장` : ''}${app.folded ? ` · ${app.folded}건 더 오감` : ''}`}
    className={`relative flex items-center justify-center rounded-full border-2 bg-card font-mono font-bold tabular-nums transition-shadow ${selected ? 'border-[var(--palette-blue-500)] ring-4 ring-[var(--palette-blue-500)]/25' : highlighted ? 'border-[var(--palette-blue-500)]/60' : 'border-border'}`}
    style={{ width: NODE, height: NODE, fontSize: 'min(1.25rem, 24px)' }}>
    {app.n}{app.folded > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-foreground px-1 text-xs font-medium text-background">+{app.folded}</span>}
    {(['left', 'right', 'top', 'bottom'] as const).map(side => <Handle key={side} id={side} type={side === 'left' || side === 'top' ? 'target' : 'source'} position={{ left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }[side]} style={{ opacity: 0 }} isConnectable={false} />)}
    {(['top', 'bottom'] as const).map(side => <Handle key={`${side}-s`} id={`${side}-s`} type="source" position={side === 'top' ? Position.Top : Position.Bottom} style={{ opacity: 0 }} isConnectable={false} />)}
    {(['top', 'bottom'] as const).map(side => <Handle key={`${side}-t`} id={`${side}-t`} type="target" position={side === 'top' ? Position.Top : Position.Bottom} style={{ opacity: 0 }} isConnectable={false} />)}
  </div>
})

const FlowEdgeView = memo(function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdge>) {
  // 모든 연결선은 베지어(김명기 10/12). 같은 행으로 쭉 가는 선은 베지어여도 저절로 직선이 된다
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const b = data!.bundle, color = risk(b.maxScore), w = data!.width
  const angle = Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI
  return <>
    <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: selected ? w + 2 : w, strokeOpacity: selected ? 1 : 0.75, strokeDasharray: b.folded ? '6 4' : undefined }} interactionWidth={Math.max(14, w + 8)} />
    <circle r={Math.max(2.5, w / 2.6)} fill="var(--foreground)" className="flow-particle motion-reduce:hidden"><animateMotion dur={`${2.4 + (b.txs.length % 3) * 0.3}s`} repeatCount="indefinite" path={path} /></circle>
    <EdgeLabelRenderer>
      <div className="nodrag nopan pointer-events-none absolute flex flex-col items-center gap-0.5" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
        <span className="hidden text-base leading-none motion-reduce:block" style={{ transform: `rotate(${angle}deg)`, color }}>›</span>
        {data!.showLabel && <span className={`rounded border bg-background/90 px-1.5 py-0.5 text-xs tabular-nums ${selected ? 'border-foreground' : ''}`}>{b.txs.length}건 · {usdShort(b.sumUsd)}{b.sameTime ? ' · 동시각' : ''}</span>}
      </div>
    </EdgeLabelRenderer>
  </>
})

const nodeTypes = { account: AccountNode }
const edgeTypes = { flow: FlowEdgeView }
function GraphCanvas({ rows: allRows, context }: { rows: TimeTx[]; context: GraphContext }) {
  // '선택 거래만 보기'는 사용자가 누른 위상 변경이라 다시 배치한다
  const [only, setOnly] = useState<Set<number> | null>(null)
  const rows = useMemo(() => only ? allRows.filter(t => only.has(t.txId)) : allRows, [allRows, only])
  const g = useMemo(() => buildTimeline(rows), [rows])
  // 보기 단위: 계좌 | 소유주. 둘 다 x = 시간이고, 소유주 보기는 같은 소유주의 계좌 행을 상자로 묶는다
  const [view, setView] = useState<'pattern' | 'owner'>('pattern')
  const plan = useMemo(() => lanePlan(g, view === 'owner' ? 'owner' : 'account'), [g, view])
  // 결정적 배치: x = 시간 칸, y = 계좌 행. 선이 붙으면 간격을 벌린 값
  const sp = useMemo(() => chooseSpacing(g, 10, plan.yOf), [g, plan])
  const dataKey = useMemo(() => g.tx.map(t => t.txId).join(','), [g])
  const minSum = Math.min(...g.bundles.map(b => b.sumUsd || 1)), maxSum = Math.max(...g.bundles.map(b => b.sumUsd || 1))
  const widthOf = useCallback((sum: number) => 1.5 + 7 * (maxSum === minSum ? 0.5 : (Math.log(sum || 1) - Math.log(minSum)) / (Math.log(maxSum) - Math.log(minSum))), [minSum, maxSum])
  const [nodes, setNodes, onNodesChange] = useNodesState<AccNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const fitted = useRef(false), lastView = useRef(view)
  const camera = useRef<Viewport | undefined>(undefined)
  const wasOnlySelected = useRef(false) // 누르기 직전에 이 계좌만 선택돼 있었는가: 다시 누르면 선택 해제(전환)
  const [showLabels, setShowLabels] = useState(true)
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] })
  const { fitView, setViewport, zoomTo } = useReactFlow()
  const { zoom: flowZoom } = useViewport()
  // 패턴 보기(force 그래프)는 자기 카메라를 가져서 배율·선택을 따로 든다
  const patCtl = useRef<PatternControls>(null)
  const [patZoom, setPatZoom] = useState(0.85)
  const [patSel, setPatSel] = useState<PatternSelection>(null)
  const zoom = view === 'pattern' ? patZoom : flowZoom
  const zoomBy = (k: number) => view === 'pattern' ? patCtl.current?.zoomTo(k) : void zoomTo(k, { duration: 120 })
  const fitAll = () => view === 'pattern' ? patCtl.current?.fit() : void fitView({ padding: 0.15, duration: 200 })
  const patterns = useMemo(() => detectPatterns(g), [g])
  const [guideOpen, setGuideOpen] = useState(readGuide)
  const toggleGuide = (open: boolean) => { setGuideOpen(open); try { window.localStorage.setItem(GUIDE_KEY, open ? '1' : '0') } catch { /* 저장 불가 */ } }
  const box = useRef<HTMLDivElement>(null)

  // 위상(거래 집합)이 바뀔 때만 배치한다. 금액·상태 갱신으로는 다시 배치하지 않는다
  useEffect(() => {
    {
      // 보기 단위를 바꾸면 행 배치가 달라지므로 카메라도 다시 정한다
      if (lastView.current !== view) { lastView.current = view; fitted.current = false }
      const pos = sp.positions
      setNodes(g.apps.map(a => ({ id: a.id, type: 'account', position: pos.get(a.id)!, data: { app: a, highlighted: false } })))
      setEdges(g.bundles.map(b => {
        const s = pos.get(b.source)!, t = pos.get(b.target)!, vertical = b.sameTime
        return { id: b.id, type: 'flow', source: b.source, target: b.target, sourceHandle: vertical ? (t.y > s.y ? 'bottom-s' : 'top-s') : 'right', targetHandle: vertical ? (t.y > s.y ? 'top-t' : 'bottom-t') : 'left', data: { bundle: b, width: widthOf(b.sumUsd), showLabel: true } }
      }))
      // 최초 1회만 카메라를 정한다: 읽을 수 있는 배율(0.6 이상)로 시간의 시작(왼쪽)부터 보인다. 전체는 화면 맞춤으로
      if (!fitted.current && box.current) {
        fitted.current = true
        const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y)
        const w = box.current.clientWidth, h = box.current.clientHeight, minX = Math.min(...xs) - 180, maxX = Math.max(...xs) + NODE, minY = Math.min(...ys), maxY = Math.max(...ys) + NODE
        const zoom = Math.min(1.1, Math.max(0.85, Math.min((w - 80) / (maxX - minX), (h - 140) / (maxY - minY))))
        requestAnimationFrame(() => void setViewport({ x: 40 - minX * zoom, y: 120 - minY * zoom, zoom }))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, view])

  useEffect(() => { setEdges(es => es.map(e => ({ ...e, data: { ...e.data!, showLabel: showLabels } }))) }, [showLabels, setEdges])
  // 같은 번호의 다른 등장도 강조
  const selectedAccounts = useMemo(() => new Set(nodes.filter(n => selection.nodes.includes(n.id)).map(n => n.data.app.account)), [nodes, selection.nodes])
  // 바뀐 노드가 없으면 같은 배열을 돌려줘야 한다(새 배열을 돌려주면 selectedAccounts가 다시 계산되어 무한 갱신)
  useEffect(() => { setNodes(ns => { let changed = false; const out = ns.map(n => { const h = selectedAccounts.has(n.data.app.account) && !selection.nodes.includes(n.id); if (h === n.data.highlighted) return n; changed = true; return { ...n, data: { ...n.data, highlighted: h } } }); return changed ? out : ns }) }, [selectedAccounts, selection.nodes, setNodes])

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => setSelection({ nodes: ns.map(n => n.id), edges: es.map(e => e.id) }), [])
  const selEdge = edges.find(e => selection.edges.length === 1 && selection.nodes.length <= 2 && e.id === selection.edges[0])
  const selNode = selection.nodes.length === 1 && !selEdge ? nodes.find(n => n.id === selection.nodes[0]) : undefined
  // 고른 선의 거래 + 고른 계좌끼리 오간 거래
  const selectedTxs = useMemo(() => {
    const ids = new Set(selection.edges), nodeIds = new Set(selection.nodes)
    return [...new Map(g.bundles.filter(b => ids.has(b.id) || (nodeIds.has(b.source) && nodeIds.has(b.target))).flatMap(b => b.txs).map(t => [t.txId, t])).values()]
  }, [g, selection])
  const showBar = selection.nodes.length > 1 || selection.edges.length > 0
  const clearSelection = () => { setNodes(ns => ns.map(n => ({ ...n, selected: false }))); setEdges(es => es.map(e => ({ ...e, selected: false }))); setSelection({ nodes: [], edges: [] }) }
  const yMin = -56
  const ownerBoxes = plan.boxes(sp.lane)
  // 소유주 보기 전용 요약(10/12 C안): 소유주별 외부 유입·유출(같은 소유주 안 이동은 따로 셈)과 소유주 간 흐름
  const ownerInfo = useMemo(() => {
    const of = new Map<string, string>(), label = new Map<string, string>()
    for (const grp of plan.groups) for (const a of grp.accounts) { of.set(a, grp.key); label.set(grp.key, grp.known ? grp.name : `소유주 미상(${grp.accounts[0]})`) }
    const stat = new Map(plan.groups.map(grp => [grp.key, { inUsd: 0, outUsd: 0, inN: 0, outN: 0, internal: 0 }]))
    const flow = new Map<string, { from: string; to: string; n: number; usd: number }>()
    for (const t of g.tx) {
      const f = of.get(t.fromAccount), to = of.get(t.toAccount)
      if (!f || !to) continue
      const usd = Number.isFinite(t.amountUsd) ? t.amountUsd : 0
      if (f === to) { stat.get(f)!.internal++; continue }
      stat.get(f)!.outUsd += usd; stat.get(f)!.outN++; stat.get(to)!.inUsd += usd; stat.get(to)!.inN++
      const k = `${f}>${to}`, cur = flow.get(k) ?? { from: f, to, n: 0, usd: 0 }
      cur.n++; cur.usd += usd; flow.set(k, cur)
    }
    return { stat, label, flows: [...flow.values()].sort((a, b) => b.usd - a.usd) }
  }, [plan, g])
  const laneEnd = Math.max(0, ...g.apps.map(a => columnX(a.col, g.gaps, sp.timeWidth))) + NODE + 40
  const selectedOwners = new Set(ownerBoxes.filter(b => b.group.accounts.some(a => selectedAccounts.has(a))).map(b => b.group.key))

  // 큰 화면: 그래프 | 세부를 끌어 크기 조절(dev 그래프와 같은 ResizablePanel). 좁은 화면: 위아래로 쌓기
  const wrap = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= 1024))
    ro.observe(el); setWide(el.clientWidth >= 1024)
    return () => ro.disconnect()
  }, [])

  const patPair = view === 'pattern' && patSel?.type === 'link' ? patSel.id.split('>') : undefined
  const patIds = view === 'pattern' && patSel?.type === 'nodes' ? patSel.ids : []
  const patApp = patIds.length === 1 ? g.apps.find(a => a.account === patIds[0]) : undefined
  const patTxs = patIds.length > 1 ? g.tx.filter(t => patIds.includes(t.fromAccount) && patIds.includes(t.toAccount)) : patPair ? g.tx.filter(t => (t.fromAccount === patPair[0] && t.toAccount === patPair[1])) : []
  const patActive = patIds.length > 1 || Boolean(patPair)
  const main = <div className="flex h-full min-h-0 flex-col gap-2">
    <div ref={box} onPointerDownCapture={e => { const el = (e.target as HTMLElement).closest('.react-flow__node'); const id = el?.getAttribute('data-id'); wasOnlySelected.current = Boolean(id) && selection.nodes.length === 1 && selection.nodes[0] === id }} className="relative isolate min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
      <div className="pointer-events-auto flex min-h-11 flex-wrap items-center gap-2 rounded-md border bg-background/90 px-2.5 py-1 text-xs">
        <span className="text-muted-foreground">보기</span>
        <div role="group" aria-label="보기 단위" className="flex gap-0.5 rounded-md border p-0.5">
          {([['pattern', '패턴'], ['owner', '소유주']] as const).map(([v, label]) => <Button key={v} type="button" size="sm" variant={view === v ? 'default' : 'ghost'} aria-pressed={view === v} className="h-6 px-2 text-xs" onClick={() => setView(v)}>{label}</Button>)}
        </div>
        {view === 'pattern' && <ProvenanceBadge kind="proposal" title="패턴 보기와 패턴 이름은 FE 제안(김명기 10/12), 이름은 거래 구조로 추정한 값이며 모델 값이 아님" />}
        {view === 'owner' && <ProvenanceBadge kind="proposal" title="소유주 이름은 FE 제안 필드(fromOwnerName·toOwnerName). API 확정 전" />}
        <span className="mx-1 h-3 w-px bg-border" /><label className="flex items-center gap-1.5">금액(USD)·건수<Switch checked={showLabels} onCheckedChange={setShowLabels} /></label>
        <span className="mx-1 h-3 w-px bg-border" /><span className="text-muted-foreground">시간 →</span>
      </div>
      {view === 'pattern' && <div className="pointer-events-auto flex min-h-11 items-center rounded-md border bg-background/90 px-1.5"><Button size="sm" variant="outline" className="h-8 gap-1.5 bg-background text-xs" title="끌어 놓은 계좌를 구조로 추정한 원래 패턴 모양으로 되돌림" onClick={() => patCtl.current?.reset()}><RotateCcw className="size-3.5" />원래 패턴으로</Button></div>}
      </div>
      {view === 'pattern' ? <PatternGraph g={g} selected={patSel} onSelect={setPatSel} onZoom={setPatZoom} controls={patCtl} /> : null}
      {view === 'pattern' ? null : <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        // eslint-disable-next-line react-hooks/refs -- 패널 크기 조절·화면 폭 전환으로 다시 그릴 때 카메라를 이어 받으려고 마지막 위치를 ref에 둔다
        onNodeClick={() => { if (wasOnlySelected.current) { wasOnlySelected.current = false; clearSelection() } }} defaultViewport={camera.current} onMoveEnd={(_, v) => { camera.current = v }}
        onSelectionChange={onSelectionChange} nodesDraggable={false} selectionOnDrag panOnDrag={[1, 2]} panActivationKeyCode="Space" zoomOnScroll panOnScroll={false} onPaneContextMenu={e => e.preventDefault()}
        nodesConnectable={false} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} proOptions={{ hideAttribution: true }} aria-label="시간순 관계 그래프">
        <ViewportPortal>
          {ownerBoxes.map(({ group, top, height }) => <div key={group.key} className={`pointer-events-none absolute rounded-lg border-2 ${selectedOwners.has(group.key) ? 'border-foreground' : group.known ? 'border-foreground/45' : 'border-dashed border-border'}`} style={{ transform: `translate(-182px, ${top}px)`, width: `${laneEnd + 182}px`, height }}>
            <div className="rounded-t-[0.4rem] bg-muted px-3 text-sm font-semibold" style={{ height: OWNER_HEAD }}><StickyX boxLeft={-182} maxShift={laneEnd - 420} className="flex h-full items-center gap-4"><span className="max-w-48 truncate">{group.name}</span><span className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs font-normal text-muted-foreground"><span>계좌 {group.accounts.length}개</span>{(st => <><span>외부 유입 <b className="font-semibold text-foreground">{usdShort(st.inUsd)}</b> ({st.inN}건)</span><span>외부 유출 <b className="font-semibold text-foreground">{usdShort(st.outUsd)}</b> ({st.outN}건)</span>{st.internal > 0 && <span>내부 이동 {st.internal}건</span>}</>)(ownerInfo.stat.get(group.key)!)}</span></StickyX></div>
          </div>)}
          {[...g.numbers].map(([acc, n]) => <div key={acc} className="pointer-events-none absolute flex items-center" style={{ transform: `translate(-170px, ${plan.yOf(acc, sp.lane) + NODE / 2}px) translate(0, -50%)`, width: `${laneEnd + 170}px` }}>
            <StickyX boxLeft={-170} maxShift={laneEnd - 160} className="w-[150px] shrink-0"><span className={`block truncate rounded bg-card/90 pr-1 text-base ${selectedAccounts.has(acc) ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}><NumBadge n={n} /> <span className="font-mono">{acc}</span></span></StickyX>
            <span className="h-px flex-1 bg-border/60" />
          </div>)}
          {g.times.map((t, i) => { const x = columnX(i * 2, g.gaps, sp.timeWidth) + NODE / 2 + 30, d = new Date(t); const label = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
            return <div key={t} className="absolute whitespace-nowrap text-xs tabular-nums text-muted-foreground" style={{ transform: `translate(${x}px, ${yMin}px) translate(-50%, 0)` }}>{(i === 0 || i % Math.ceil(g.times.length / 12) === 0) && label}<div className="mx-auto mt-1 h-2 w-px bg-border" /></div> })}
          {g.gaps.map(gap => <div key={gap.afterIndex} className="absolute text-xs font-medium text-muted-foreground" style={{ transform: `translate(${columnX(gap.afterIndex * 2 + 2, g.gaps, sp.timeWidth) - 40}px, ${yMin - 2}px)` }}>⋯ {gap.days}일</div>)}
        </ViewportPortal>
      </ReactFlow>}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
        {/* 조작 안내(김명기 10/12): 처음 보는 사람도 선택·이동·확대 방법을 바로 알 수 있게 항상 보인다. 높이는 오른쪽 화면 맞춤 프레임과 같음 */}
        {/* 안내 전체가 하나의 여닫이 버튼: 어디를 눌러도 열고 닫힘. 아이콘은 왼쪽, 열렸을 땐 왼쪽(접기), 닫혔을 땐 오른쪽(펼치기)을 가리킴 */}
        <button type="button" aria-expanded={guideOpen} onClick={() => toggleGuide(!guideOpen)} data-testid="graph-guide" className="pointer-events-auto flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 text-left text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
          {guideOpen ? <ChevronLeft className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
          {guideOpen
            ? <span><b className="font-semibold text-foreground">왼쪽 클릭·끌기</b> 선택 · <b className="font-semibold text-foreground">오른쪽 또는 휠 클릭하고 끌기</b> 화면 이동 · <b className="font-semibold text-foreground">휠</b> 확대·축소{view === 'pattern' && <> · <b className="font-semibold text-foreground">계좌 잡고 끌기</b> 옮기기</>}</span>
            : <span className="font-medium text-foreground">조작 안내</span>}
        </button>
        {/* 확대·축소 슬라이더: 로그 눈금이라 어느 배율에서든 같은 감도로 움직인다 */}
        <div className="pointer-events-auto flex min-h-10 items-center gap-1.5 rounded-md border bg-background px-1" data-testid="zoom-control">
          <Button size="icon" variant="ghost" className="size-7" aria-label="축소" onClick={() => zoomBy(Math.max(MIN_ZOOM, zoom / 1.25))}><Minus className="size-3.5" /></Button>
          <Slider className="w-28" min={Math.log2(MIN_ZOOM)} max={Math.log2(MAX_ZOOM)} step={0.01} value={[Math.log2(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)))]} onValueChange={([v]) => zoomBy(2 ** v)} aria-label="확대·축소" />
          <Button size="icon" variant="ghost" className="size-7" aria-label="확대" onClick={() => zoomBy(Math.min(MAX_ZOOM, zoom * 1.25))}><Plus className="size-3.5" /></Button>
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-background text-xs" onClick={fitAll}><Maximize className="size-3.5" />화면 맞춤</Button>
        </div>
      </div>
    </div>
    {/* 고르기 동작 줄: 항상 같은 높이라 선택해도 그래프가 움직이지 않는다 */}
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto rounded-md border bg-background px-3 text-xs" data-testid="selection-strip">
      {view === 'pattern' && patActive ? <SelectionActions context={context} accounts={patIds.length || 2} txs={patTxs} onOnly={() => { setOnly(new Set(patTxs.map(t => t.txId))); setPatSel(null) }} onClear={() => setPatSel(null)} />
      : view === 'pattern' && only ? <><span className="shrink-0 whitespace-nowrap">선택 거래 {only.size}건만 보는 중</span><Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => setOnly(null)}>전체 보기</Button></>
      : view === 'pattern' ? <><span className="shrink-0 whitespace-nowrap text-muted-foreground">추정 패턴</span>{patterns.length ? patterns.map(p => <Badge key={p} variant="outline" className="shrink-0 font-normal">{p}</Badge>) : <span className="shrink-0 whitespace-nowrap">추정 불가(거래가 적거나 단순 경로)</span>}<ProvenanceBadge kind="proposal" title="거래 구조로 추정한 이름이며 모델 값이 아님" /><span className="shrink-0 whitespace-nowrap text-muted-foreground"></span></>
      : showBar ? <SelectionActions context={context} accounts={selectedAccounts.size || new Set(selectedTxs.flatMap(t => [t.fromAccount, t.toAccount])).size} txs={selectedTxs} onOnly={() => { setOnly(new Set(selectedTxs.map(t => t.txId))); clearSelection() }} onClear={clearSelection} />
        : only ? <><span className="shrink-0 whitespace-nowrap">선택 거래 {only.size}건만 보는 중</span><Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => setOnly(null)}>전체 보기</Button></>
          : <span className="whitespace-nowrap text-muted-foreground">빈 곳을 끌어 계좌·선을 고르면 제거 · 묶기 · 분리를 여기서 할 수 있음</span>}
    </div>
  </div>
  const shownPair = view === 'pattern' ? patPair : selEdge ? [selEdge.data!.bundle.txs[0].fromAccount, selEdge.data!.bundle.txs[0].toAccount] : undefined, shownApp = view === 'pattern' ? patApp : selNode?.data.app
  const hiAcc = view === 'pattern' ? new Set(patIds.length ? patIds : patPair ?? []) : selectedAccounts
  const side = <Card className="h-full min-h-0 overflow-y-auto shadow-none"><CardContent className="space-y-4">
      {shownPair ? <PairTimeline a={shownPair[0]} b={shownPair[1]} numbers={g.numbers} all={g.tx} />
        : shownApp ? <AccountDetail app={shownApp} g={g} />
          : <p className="rounded-lg border border-dashed px-4 py-10 text-center text-xs text-muted-foreground">계좌나 연결선을 고르면 거래 흐름이 여기 나타납니다.<br />왼쪽 클릭으로 고르고, 빈 곳을 끌면 여러 개를 한 번에 고릅니다.<br />화면 이동은 오른쪽(또는 휠) 클릭하고 끌기, 확대·축소는 아래 슬라이더.</p>}
      {view === 'owner' && !shownPair && !shownApp && <OwnerFlows info={ownerInfo} />}
      <div>
        <p className="text-xs font-medium">번호 대응표</p>
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">{[...g.numbers].map(([acc, n]) => <li key={acc} className={`flex items-center gap-1.5 ${hiAcc.has(acc) ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}><NumBadge n={n} /><span className="truncate font-mono">{acc}</span></li>)}</ul>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">오른쪽→왼쪽 선 {g.violations}개 · 선 겹침 {sp.conflicts}개 · 등장 {g.apps.length}개 · 계좌 {g.numbers.size}개 <ProvenanceBadge kind="mock" /></p>
    </CardContent></Card>

  // 패널 그룹은 높이를 자동(내용 따라)으로 정해 두므로, 고정 높이 상자 안에서 남는 높이를 채우게 한다.
  // 안 그러면 세부 카드 내용이 길어질 때마다 그래프까지 커져 화면이 움찔한다(10/12 측정: 481→718px)
  return <div ref={wrap} data-testid="graph-split">
    {wide
      ? <div className="flex h-[clamp(440px,calc(100dvh-17rem),760px)] flex-col"><ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="graph-main" minSize="420px">{main}</ResizablePanel>
        <ResizableHandle className="group w-3 bg-transparent after:w-1 after:rounded-full after:bg-border after:opacity-0 after:transition-opacity hover:after:opacity-100 data-[separator=hover]:after:opacity-100 data-[separator=active]:after:bg-ring data-[separator=active]:after:opacity-100" aria-label="그래프와 세부 항목 크기 조절" />
        <ResizablePanel id="graph-side" defaultSize="340px" minSize="260px" maxSize="720px">{side}</ResizablePanel>
      </ResizablePanelGroup></div>
      : <div className="grid grid-cols-1 gap-3"><div className="h-[540px]">{main}</div>{side}</div>}
  </div>
}

/** 보는 화면의 왼쪽 끝에 붙어 따라오는 라벨: 오른쪽으로 많이 옮겨도 소유주 머리글·계좌 이름이 보인다(김명기 10/12). 상자 안에서만 움직인다 */
function StickyX({ boxLeft, maxShift, className, children }: { boxLeft: number; maxShift: number; className?: string; children: React.ReactNode }) {
  const { x, zoom } = useViewport()
  const shift = Math.max(0, Math.min(-x / zoom - boxLeft + 8, Math.max(0, maxShift)))
  return <div className={className} style={{ transform: `translateX(${shift}px)` }}>{children}</div>
}

function OwnerFlows({ info }: { info: { label: Map<string, string>; flows: { from: string; to: string; n: number; usd: number }[] } }) {
  return <div>
    <p className="text-xs font-medium">소유주 간 흐름 <span className="font-normal text-muted-foreground">(소유주가 다른 거래만, 큰 금액 순)</span></p>
    {info.flows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">소유주 사이를 오간 거래가 없습니다.</p>
      : <ul className="mt-2 divide-y text-sm">{info.flows.slice(0, 8).map(f => <li key={`${f.from}>${f.to}`} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{info.label.get(f.from)} → {info.label.get(f.to)}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{f.n}건 · {usdShort(f.usd)}</span></li>)}</ul>}
    {info.flows.length > 8 && <p className="mt-1 text-xs text-muted-foreground">나머지 {info.flows.length - 8}개 흐름은 생략</p>}
  </div>
}

function AccountDetail({ app, g }: { app: Appearance; g: ReturnType<typeof buildTimeline> }) {
  const all = g.tx.filter(t => t.fromAccount === app.account || t.toAccount === app.account)
  const inUsd = all.filter(t => t.toAccount === app.account).reduce((s, t) => s + t.amountUsd, 0), outUsd = all.filter(t => t.fromAccount === app.account).reduce((s, t) => s + t.amountUsd, 0)
  const appearances = g.apps.filter(a => a.account === app.account).length
  return <div className="space-y-3">
    <div><p className="text-base font-semibold"><NumBadge n={app.n} className="mr-1.5" /><span className="font-mono text-sm">{app.account}</span></p><p className="mt-1 text-xs text-muted-foreground">등장 {appearances}번 · 이 등장은 {app.nth}번째{app.folded ? ` · 상한을 넘어 ${app.folded}건을 여기에 모음` : ''}</p></div>
    <dl className="grid grid-cols-[72px_1fr] gap-y-2 text-xs"><dt className="text-muted-foreground">받음</dt><dd className="tabular-nums">{all.filter(t => t.toAccount === app.account).length}건 · {usdShort(inUsd)} USD</dd><dt className="text-muted-foreground">보냄</dt><dd className="tabular-nums">{all.filter(t => t.fromAccount === app.account).length}건 · {usdShort(outUsd)} USD</dd></dl>
    <ul className="divide-y text-sm">{all.map(t => { const inbound = t.toAccount === app.account; return <li key={t.txId} className="flex items-center justify-between gap-2 py-1.5"><span className="tabular-nums text-muted-foreground">{t.txAt.replace('T', ' ').slice(5, 16)}</span><span className="inline-flex items-center gap-1">{inbound ? '←' : '→'}<NumBadge n={g.numbers.get(inbound ? t.fromAccount : t.toAccount)!} /></span><span className="tabular-nums">{t.amountPaid.toLocaleString()} {t.paymentCurrency}</span></li> })}</ul>
  </div>
}

export default function TimeGraph({ rows, context }: { rows: TimeTx[]; context: GraphContext }) {
  return <ReactFlowProvider><GraphCanvas rows={rows} context={context} /></ReactFlowProvider>
}
