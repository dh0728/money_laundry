import type { WorkspaceCase } from '../workspace-store'
import type { GraphEdge } from './case-selectors'
export type AlertGroupSource = { id: number; label: string; transactionIds: number[] }
export type AlertGraphGroup = AlertGroupSource & { nodeIds: string[]; edgeIds: string[] }
export function episodeAlertSources(episode: WorkspaceCase, records: WorkspaceCase[]) {
  if (episode.kind !== 'EPISODE') return { groups: [], missingIds: [] }
  const declared = new Set(episode.alertCaseIds)
  const available = records.filter(record => record.kind === 'ALERT' && (declared.has(record.caseId) || record.episodeCaseId === episode.caseId))
  const evidence = new Set(episode.transactionIds)
  return {
    groups: available.map(record => ({ id: record.caseId, label: record.displayId, transactionIds: [...new Set(record.transactionIds)].filter(id => evidence.has(id)) })),
    missingIds: [...declared].filter(id => !available.some(record => record.caseId === id)),
  }
}
export function graphAlertGroups(sources: AlertGroupSource[], edges: Pick<GraphEdge,'id'|'source'|'target'|'transactionIds'>[]): AlertGraphGroup[] {
  return sources.map(source => {
    const ids = new Set(source.transactionIds)
    const matched = edges.filter(edge => edge.transactionIds.some(id => ids.has(id)))
    return { ...source, transactionIds: [...new Set(matched.flatMap(edge => edge.transactionIds.filter(id => ids.has(id))))], edgeIds: matched.map(edge => edge.id), nodeIds: [...new Set(matched.flatMap(edge => [edge.source, edge.target]))] }
  })
}
type Point = { x: number; y: number }
// The polygon is an envelope only. Exact intersection is determined from IDs,
// never from polygon intersection (which can include unrelated intervening nodes).
export function wrappingHull(positions: Point[], size: {width:number;height:number}, padding=22): string {
  const points = positions.flatMap(({x,y}) => [{x:x-padding,y:y-padding},{x:x+size.width+padding,y:y-padding},{x:x+size.width+padding,y:y+size.height+padding},{x:x-padding,y:y+size.height+padding}]).sort((a,b)=>a.x-b.x||a.y-b.y)
  if (!points.length) return ''
  const cross=(o:Point,a:Point,b:Point)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x)
  const half=(input:Point[])=>{const hull:Point[]=[];for(const p of input){while(hull.length>=2&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();hull.push(p)}return hull}
  return [...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)].map(p=>`${p.x},${p.y}`).join(' ')
}
