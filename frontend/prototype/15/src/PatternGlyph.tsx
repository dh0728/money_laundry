import { useId } from 'react'

// IBM AML 논문 "Figure 2: Laundering Patterns Modelled"을 그대로 따르는 도식 글리프.
// 대시보드 "패턴 대표 모양" 갤러리와 Alert 개요에서 데이터 기반 임의 모양 대신 이 스키마를 쓴다.
export type PatternKey =
  | 'FAN_OUT'
  | 'FAN_IN'
  | 'GATHER-SCATTER'
  | 'SCATTER-GATHER'
  | 'CYCLE'
  | 'RANDOM'
  | 'BIPARTITE'
  | 'STACK'
  | 'NON_PATTERN'

interface GlyphNode { x: number; y: number; highlight: boolean }
interface GlyphLayout { nodes: GlyphNode[]; edges: [number, number][] }

const NODE_R = 6

function node(x: number, y: number, highlight = false): GlyphNode { return { x, y, highlight } }

export const patternLayouts: Record<PatternKey, GlyphLayout> = {
  // (a) 왼쪽 강조 소스 v → 오른쪽 세로 호 위 hollow 노드 4개
  FAN_OUT: {
    nodes: [
      node(14, 50, true),
      node(92, 18),
      node(104, 39),
      node(104, 63),
      node(92, 86),
    ],
    edges: [[0, 1], [0, 2], [0, 3], [0, 4]],
  },
  // (b) 왼쪽 hollow 노드 4개 → 오른쪽 강조 싱크 v
  FAN_IN: {
    nodes: [
      node(28, 18),
      node(16, 39),
      node(16, 63),
      node(28, 86),
      node(106, 50, true),
    ],
    edges: [[0, 4], [1, 4], [2, 4], [3, 4]],
  },
  // (c) 왼쪽 hollow 3개 → 중앙 강조 v → 오른쪽 hollow 3개
  'GATHER-SCATTER': {
    nodes: [
      node(14, 25),
      node(14, 50),
      node(14, 75),
      node(60, 50, true),
      node(106, 25),
      node(106, 50),
      node(106, 75),
    ],
    edges: [[0, 3], [1, 3], [2, 3], [3, 4], [3, 5], [3, 6]],
  },
  // (d) hollow 소스 v → 중간 강조 정점 4개(점선 타원) → hollow 싱크 u
  'SCATTER-GATHER': {
    nodes: [
      node(12, 50),
      node(60, 15, true),
      node(60, 38, true),
      node(60, 62, true),
      node(60, 85, true),
      node(108, 50),
    ],
    edges: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [2, 5], [3, 5], [4, 5]],
  },
  // (e) 오각형 위 노드 5개, 시계방향 화살표, 하나만 강조
  CYCLE: {
    nodes: [
      node(60, 16, true),
      node(99.9, 38.1),
      node(84.7, 73.9),
      node(35.3, 73.9),
      node(20.1, 38.1),
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]],
  },
  // (f) 지그재그 랜덤 경로, 시작 노드만 강조, 선분이 서로 교차
  RANDOM: {
    nodes: [
      node(12, 50, true),
      node(45, 15),
      node(35, 78),
      node(82, 25),
      node(106, 66),
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  // (g) 왼쪽 강조 노드 2개 × 오른쪽 hollow 노드 3개, 전부 연결(교차)
  BIPARTITE: {
    nodes: [
      node(14, 32, true),
      node(14, 68, true),
      node(106, 18),
      node(106, 50),
      node(106, 82),
    ],
    edges: [[0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4]],
  },
  // (h) 왼쪽 hollow 2 · 중앙 강조 3 · 오른쪽 hollow 2, 좌→중·중→우 전연결
  STACK: {
    nodes: [
      node(12, 30),
      node(12, 70),
      node(60, 15, true),
      node(60, 50, true),
      node(60, 85, true),
      node(108, 30),
      node(108, 70),
    ],
    edges: [
      [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4],
      [2, 5], [2, 6], [3, 5], [3, 6], [4, 5], [4, 6],
    ],
  },
  // 논문에 없는 유형: 서로 연결되지 않은 작은 조각 3개(세탁과 무관한 단편 거래를 표현)
  NON_PATTERN: {
    nodes: [
      node(16, 20), node(36, 20),
      node(58, 14), node(74, 30), node(58, 46),
      node(92, 70), node(110, 86),
    ],
    edges: [[0, 1], [2, 3], [3, 4], [5, 6]],
  },
}

const KNOWN_KEYS = new Set<string>(Object.keys(patternLayouts))

function resolveKey(pattern: string): PatternKey {
  return (KNOWN_KEYS.has(pattern) ? pattern : 'NON_PATTERN') as PatternKey
}

function shorten(x1: number, y1: number, x2: number, y2: number, startPad: number, endPad: number) {
  const dx = x2 - x1, dy = y2 - y1
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist, uy = dy / dist
  return { x1: x1 + ux * startPad, y1: y1 + uy * startPad, x2: x2 - ux * endPad, y2: y2 - uy * endPad }
}

export default function PatternGlyph({ pattern, className }: { pattern: string; className?: string }) {
  const key = resolveKey(pattern)
  const layout = patternLayouts[key]
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const mutedMarker = `pg-arrow-muted-${rawId}`
  const fgMarker = `pg-arrow-fg-${rawId}`

  const isScatterGather = key === 'SCATTER-GATHER'
  let ellipse: { cx: number; cy: number; rx: number; ry: number } | null = null
  if (isScatterGather) {
    const mids = layout.nodes.filter(n => n.highlight)
    const minY = Math.min(...mids.map(n => n.y)) - NODE_R - 3
    const maxY = Math.max(...mids.map(n => n.y)) + NODE_R + 3
    const cx = mids[0].x
    ellipse = { cx, cy: (minY + maxY) / 2, rx: NODE_R + 10, ry: (maxY - minY) / 2 }
  }

  return (
    <svg
      viewBox="0 0 120 100"
      role="img"
      aria-label={`${pattern} 패턴 도식`}
      data-pattern={pattern}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker id={mutedMarker} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0.5 L9,5 L0,9.5 Z" fill="var(--muted-foreground)" />
        </marker>
        <marker id={fgMarker} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0.5 L9,5 L0,9.5 Z" fill="var(--foreground)" />
        </marker>
      </defs>

      {ellipse && (
        <ellipse
          cx={ellipse.cx} cy={ellipse.cy} rx={ellipse.rx} ry={ellipse.ry}
          fill="none" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 2" opacity={0.6}
        />
      )}

      {layout.edges.map(([fromIdx, toIdx], i) => {
        const a = layout.nodes[fromIdx], b = layout.nodes[toIdx]
        const emphasize = a.highlight || b.highlight
        const { x1, y1, x2, y2 } = shorten(a.x, a.y, b.x, b.y, NODE_R, NODE_R + 1)
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={emphasize ? 'var(--foreground)' : 'var(--muted-foreground)'}
            strokeWidth={1.5}
            markerEnd={`url(#${emphasize ? fgMarker : mutedMarker})`}
          />
        )
      })}

      {layout.nodes.map((n, i) => (
        n.highlight
          ? <circle key={i} cx={n.x} cy={n.y} r={NODE_R} fill="var(--graph-l1)" stroke="none" />
          : <circle key={i} cx={n.x} cy={n.y} r={NODE_R} fill="var(--card)" stroke="var(--foreground)" strokeOpacity={0.85} strokeWidth={1.5} />
      ))}
    </svg>
  )
}
