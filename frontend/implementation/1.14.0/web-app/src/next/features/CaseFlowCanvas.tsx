import { memo, useCallback, useEffect, useId, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { BaseEdge, Handle, MiniMap, Position, ReactFlow, getNodesBounds, type Edge, type EdgeChange, type EdgeProps, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import ELK from 'elkjs/lib/elk-api'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'
import '@xyflow/react/dist/base.css'
import { Button } from '@/components/ui/button'
import type { GraphEdge, GraphNode } from './case-selectors'
import { caseLayoutPositions, caseLayoutRequest, caseNodeSize, seedCasePositions, type CaseDirection, type CasePositions } from './case-graph-layout'
import { caseEdgePath } from './case-edge-path'

type FlowNode = Node<{ record: GraphNode; direction: CaseDirection }, 'case'>
type FlowEdge = Edge<{ record: GraphEdge; moving: boolean }, 'case'>
type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }
export type CaseFlowControls = { zoomBy: (factor: number) => void; fit: () => void; focus: (id: string) => void; arrange: () => void }
type Props = {
  topology: Graph; visible: Graph; direction: CaseDirection; selectedNode: string | null; selectedEdge: string | null; moving: boolean
  controls: Ref<CaseFlowControls>; onNode: (id: string) => void; onEdge: (id: string) => void; onClear: () => void; onZoom: (zoom: number) => void
}
const riskLabels = { high: '위험', medium: '주의', low: '낮음' }
const FlowAccount = memo(function FlowAccount({ data, selected }: NodeProps<FlowNode>) {
  const vertical = data.direction === 'DOWN'
  return <div data-case="graph-node" data-selected={selected || undefined} data-abnormal={data.record.abnormal || undefined}>
    <Handle type="target" position={vertical ? Position.Top : Position.Left} isConnectable={false} />
    <strong>{data.record.label}</strong><span>계좌 {data.record.accountIds.length}개{data.record.abnormal ? ' · 사람 판정 이상' : ''}</span>
    <Handle type="source" position={vertical ? Position.Bottom : Position.Right} isConnectable={false} />
  </div>
})
const FlowConnection = memo(function FlowConnection({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps<FlowEdge>) {
  const markerId = useId().replaceAll(':', '')
  const loop = source === target
  const [path, labelX, labelY] = caseEdgePath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, loop })
  if (!data) return null
  return <g data-case="edge" data-case-risk={data.record.risk} data-selected={selected || undefined} data-moving={data.moving || undefined} strokeWidth={selected ? data.record.width + 2 : data.record.width}>
    <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 Z" /></marker></defs>
    <BaseEdge id={id} path={path} interactionWidth={24} markerEnd={`url(#${markerId})`} />
    <text data-case="edge-label" x={labelX} y={labelY} textAnchor="middle">{riskLabels[data.record.risk]} · {data.record.count}건</text>
    <title>{data.record.count}건 · {data.record.amountUsd.toLocaleString('ko-KR')} USD · {riskLabels[data.record.risk]}</title>
  </g>
})
const nodeTypes = { case: FlowAccount }
const edgeTypes = { case: FlowConnection }
const ariaLabelConfig = {
  'node.a11yDescription.default': 'Enter로 선택, 방향키로 이동, Escape로 선택 해제합니다.',
  'node.a11yDescription.keyboardDisabled': 'Enter로 선택합니다.',
  'edge.a11yDescription.default': 'Enter로 연결을 선택합니다.',
  'minimap.ariaLabel': '관계 전체 지도',
}
export function CaseFlowCanvas({ topology, visible, direction, selectedNode, selectedEdge, moving, controls, onNode, onEdge, onClear, onZoom }: Props) {
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)
  const [revision, setRevision] = useState(0)
  const request = useMemo(() => caseLayoutRequest(topology.nodes, topology.edges, direction), [topology.nodes, topology.edges, direction])
  const key = useMemo(() => `${direction}:${revision}:${topology.nodes.map(n => n.id).join('|')}:${topology.edges.map(e => e.id).join('|')}`, [direction, revision, topology.nodes, topology.edges])
  const seeds = useMemo(() => seedCasePositions(topology.nodes), [topology.nodes])
  const [layout, setLayout] = useState<{ key: string; positions: CasePositions; error?: string }>({ key: '', positions: {} })
  const [moves, setMoves] = useState<{ key: string; positions: CasePositions }>({ key: '', positions: {} })
  useEffect(() => {
    if (!request.children?.length) return
    let canceled = false, settled = false, engine: InstanceType<typeof ELK> | undefined
    const failed = () => {
      if (canceled || settled) return
      settled = true
      engine?.terminateWorker()
      setLayout({ key, positions: seeds, error: '자동 배치를 완료하지 못했습니다. 기본 배치에서 계속 조사하거나 다시 배치해 주세요.' })
    }
    const timer = window.setTimeout(failed, 5000)
    Promise.resolve().then(() => {
      if (canceled) return null
      engine = new ELK({ workerUrl: elkWorkerUrl })
      return engine.layout(request)
    }).then(result => {
      if (!result || canceled || settled) return
      const positions = caseLayoutPositions(result, request.children!.map(node => node.id))
      settled = true
      setLayout({ key, positions })
    }).catch(failed).finally(() => { window.clearTimeout(timer); engine?.terminateWorker() })
    return () => { canceled = true; window.clearTimeout(timer); engine?.terminateWorker() }
  }, [request, key, seeds])
  const positions = layout.key === key ? layout.positions : seeds
  const visibleNodes = useMemo(() => new Set(visible.nodes.map(node => node.id)), [visible.nodes])
  const nodes = useMemo<FlowNode[]>(() => topology.nodes.map(record => ({ id: record.id, type: 'case', data: { record, direction }, position: (moves.key === key && moves.positions[record.id]) || positions[record.id] || { x: 0, y: 0 }, ...caseNodeSize, selected: record.id === selectedNode, hidden: !visibleNodes.has(record.id), ariaLabel: `${record.label} 선택`, ariaRole: 'button', deletable: false })), [topology.nodes, direction, moves, key, positions, selectedNode, visibleNodes])
  const labels = useMemo(() => new Map(topology.nodes.map(node => [node.id, node.label])), [topology.nodes])
  const edges = useMemo<FlowEdge[]>(() => visible.edges.map(record => ({ id: record.id, type: 'case', source: record.source, target: record.target, data: { record, moving }, selected: record.id === selectedEdge, focusable: true, deletable: false, ariaRole: 'button', ariaLabel: `${labels.get(record.source)} → ${labels.get(record.target)} · ${record.count}건 연결 선택` })), [visible.edges, moving, selectedEdge, labels])
  const changeNodes = useCallback((changes: NodeChange<FlowNode>[]) => {
    const selected = changes.find(change => change.type === 'select' && change.selected)
    if (selected?.type === 'select') onNode(selected.id)
    else if (changes.some(change => change.type === 'select' && !change.selected && change.id === selectedNode)) onClear()
    const changed = changes.flatMap(change => change.type === 'position' && change.position ? [[change.id, change.position] as const] : [])
    if (!changed.length) return
    setMoves(previous => ({ key, positions: { ...(previous.key === key ? previous.positions : {}), ...Object.fromEntries(changed) } }))
  }, [key, onNode, onClear, selectedNode])
  const changeEdges = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const selected = changes.find(change => change.type === 'select' && change.selected)
    if (selected?.type === 'select') onEdge(selected.id)
    else if (changes.some(change => change.type === 'select' && !change.selected && change.id === selectedEdge)) onClear()
  }, [onEdge, onClear, selectedEdge])
  const fitGraph = useCallback(() => {
    if (!flow) return
    const current = flow.getNodes().filter(node => !node.hidden)
    if (!current.length) return
    const byId = new Map(current.map(node => [node.id, node]))
    const hasReturn = flow.getEdges().some(edge => {
      const source = byId.get(edge.source), target = byId.get(edge.target)
      return source && target && (edge.source === edge.target || (direction === 'DOWN' ? source.position.y >= target.position.y : source.position.x >= target.position.x))
    })
    if (hasReturn) {
      const bounds = getNodesBounds(current)
      void flow.fitBounds({ x: bounds.x - 128, y: bounds.y - 160, width: bounds.width + 256, height: bounds.height + 320 }, { padding: .2, duration: 0 })
    } else void flow.fitView({ padding: .2, maxZoom: 1.25, duration: 0 })
  }, [flow, direction])
  useEffect(() => {
    if (!flow || layout.key !== key || !topology.nodes.length) return
    const frame = requestAnimationFrame(fitGraph)
    return () => cancelAnimationFrame(frame)
    // Playback changes visibility without changing this layout or the user's camera.
  }, [flow, layout.key, key, topology.nodes.length, fitGraph])
  useImperativeHandle(controls, () => ({
    zoomBy: factor => { if (flow) void flow.zoomTo(Math.max(.25, Math.min(3, flow.getViewport().zoom * factor)), { duration: 0 }) },
    fit: fitGraph,
    focus: id => { if (flow) void flow.fitView({ nodes: [{ id }], padding: .5, maxZoom: 1.5, duration: 0 }) },
    arrange: () => setRevision(value => value + 1),
  }), [flow, fitGraph])
  return <>
    {layout.key !== key && topology.nodes.length > 0 && <p data-ws="notice" role="status">관계를 배치하는 중입니다.</p>}
    {layout.key === key && layout.error && <div data-ws="notice" role="alert">{layout.error}<Button variant="secondary" onClick={() => setRevision(value => value + 1)}>배치 다시 시도</Button></div>}
    <div data-case="flow-canvas" aria-label="자금 흐름 조사 영역">
      <ReactFlow<FlowNode, FlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changeNodes} onEdgesChange={changeEdges} onInit={setFlow}
        onNodeClick={(_, node) => onNode(node.id)} onEdgeClick={(_, edge) => onEdge(edge.id)} onPaneClick={onClear} onMoveEnd={(_, viewport) => onZoom(viewport.zoom)}
        nodesDraggable nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null} minZoom={.25} maxZoom={3}
        fitView fitViewOptions={{ padding: .2, maxZoom: 1.25 }} ariaLabelConfig={ariaLabelConfig}>
        <MiniMap pannable zoomable nodeColor="var(--aml-surface-muted)" nodeStrokeColor="var(--aml-border-strong)" maskColor="var(--aml-black-020)" />
      </ReactFlow>
    </div>
  </>
}
