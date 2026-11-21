import { getBezierPath, Position } from '@xyflow/react'

type Anchors = Parameters<typeof getBezierPath>[0] & { loop: boolean }
export function caseEdgePath({ loop, ...anchors }: Anchors): [string, number, number] {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition } = anchors
  const vertical = sourcePosition === Position.Bottom
  if (loop || (vertical ? sy >= ty : sx >= tx)) {
    return vertical
      ? [`M ${sx} ${sy} C ${sx + 128} ${sy + 64}, ${tx + 128} ${ty - 64}, ${tx} ${ty}`, Math.max(sx, tx) + 112, (sy + ty) / 2]
      : [`M ${sx} ${sy} C ${sx + 128} ${sy - 160}, ${tx - 128} ${ty - 160}, ${tx} ${ty}`, (sx + tx) / 2, Math.min(sy, ty) - 112]
  }
  const [path, x, y] = getBezierPath({ ...anchors, curvature: .35 })
  return [path, x, y - 12]
}
