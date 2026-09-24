import type { GraphModel } from './domain'

// 의심 거래(라벨 1)에 참여한 계좌와 그 사이 엣지만 그린 요약 모양. 개요·기관 현황판에서 쓴다.
export default function MiniGraph({ model, className = '' }: { model: GraphModel; className?: string }) {
  const core = model.nodes.filter(n => n.core)
  const keys = new Set(core.map(n => n.key))
  const edges = model.edges.filter(e => e.label === 1 && e.s !== e.t && keys.has(e.s) && keys.has(e.t))
  if (!core.length) return null
  const xs = core.map(n => n.x), ys = core.map(n => n.y)
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), .3) * 1.3
  const at = new Map(core.map(n => [n.key, n]))
  return (
    <svg viewBox={`${cx - span / 2} ${cy - span / 2} ${span} ${span}`} className={className} role="img" aria-label={`의심 거래 계좌 ${core.length}개, 연결 ${edges.length}개`}>
      {edges.map(e => { const a = at.get(e.s)!, b = at.get(e.t)!; return <line key={e.key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--graph-l1)" strokeWidth={span * .012} strokeLinecap="round" /> })}
      {core.map(n => <circle key={n.key} cx={n.x} cy={n.y} r={span * .026} fill="var(--graph-l1)" />)}
    </svg>
  )
}
