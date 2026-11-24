import { useState } from 'react'
import { readChartNumber } from '../chart-design-values'
import './account-pair-timeline.css'

type Account = { label: string; number: number | undefined }
type Ribbon = { id: number; amount: number; forward: boolean }

function readLayout() {
  return {
    minWidth: readChartNumber('--pair-timeline-min-width', 300),
    height: readChartNumber('--pair-timeline-height', 150),
    laneInset: readChartNumber('--pair-timeline-lane-inset', 26),
    horizontalInset: readChartNumber('--pair-timeline-horizontal-inset', 30),
    firstRibbon: readChartNumber('--pair-timeline-first-ribbon', 22),
    numberX: readChartNumber('--aml-space-16', 16),
    labelX: readChartNumber('--pair-timeline-label-x', 34),
    topBadgeGap: readChartNumber('--aml-space-12', 12),
    bottomBadgeGap: readChartNumber('--pair-timeline-bottom-badge-gap', 13),
    textOffset: readChartNumber('--pair-timeline-text-offset', 5),
    minRibbon: readChartNumber('--aml-space-4', 4),
    maxRibbon: readChartNumber('--aml-space-16', 16),
    laneGap: readChartNumber('--aml-space-4', 4),
    arrowWidth: readChartNumber('--aml-space-8', 8),
    arrowTipGap: readChartNumber('--aml-space-12', 12),
    arrowBaseGap: readChartNumber('--pair-timeline-arrow-base-gap', 18),
    orderAngle: readChartNumber('--pair-timeline-order-angle', -90),
    orderGap: readChartNumber('--pair-timeline-order-gap', 3),
  }
}

export function AccountPairTimeline({
  accounts, ribbons, hovered, onHover,
}: {
  accounts: readonly [Account, Account]
  ribbons: readonly Ribbon[]
  hovered: number | null
  onHover: (id: number | null) => void
}) {
  const [layout] = useState(readLayout)
  const top = layout.laneInset
  const bottom = layout.height - layout.laneInset
  const middle = layout.height / 2
  const step = Math.max(layout.laneInset, (layout.minWidth - layout.horizontalInset) / Math.max(1, ribbons.length))
  const width = Math.max(layout.minWidth, layout.horizontalInset + step * ribbons.length)
  const amounts = ribbons.map(ribbon => Math.log10(Math.max(1, ribbon.amount)))
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const lanes = [
    { y: top, badgeY: top - layout.topBadgeGap, account: accounts[0] },
    { y: bottom, badgeY: bottom + layout.bottomBadgeGap, account: accounts[1] },
  ]

  return (
    <svg width={width} height={layout.height} role="img" aria-label="두 계좌 레인 타임라인" className="block">
      {lanes.map(({ y }) => (
        <line key={y} x1={0} x2={width} y1={y} y2={y} className="pair-timeline-lane" />
      ))}
      {lanes.map(({ y, badgeY, account }) => (
        <g key={y}>
          <circle cx={layout.numberX} cy={badgeY} className="pair-timeline-number-ring" />
          <text x={layout.numberX} y={badgeY + layout.textOffset} textAnchor="middle" className="pair-timeline-number">{account.number}</text>
          <text x={layout.labelX} y={badgeY + layout.textOffset} className="pair-timeline-account font-mono">{account.label}</text>
        </g>
      ))}
      {ribbons.map(({ id, forward }, index) => {
        const ratio = min === max ? 0.5 : (amounts[index] - min) / (max - min)
        const bandWidth = layout.minRibbon + (layout.maxRibbon - layout.minRibbon) * ratio
        const x = layout.firstRibbon + index * step
        const direction = forward ? 'forward' : 'reverse'
        const baseY = forward ? bottom - layout.arrowBaseGap : top + layout.arrowBaseGap
        const tipY = forward ? bottom - layout.arrowTipGap : top + layout.arrowTipGap
        const halfArrow = layout.arrowWidth / 2

        return (
          <g key={id} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)} className="cursor-default">
            <rect
              x={x - bandWidth / 2}
              y={top + layout.laneGap}
              width={bandWidth}
              height={bottom - top - 2 * layout.laneGap}
              className="pair-timeline-ribbon"
              data-direction={direction}
              data-dimmed={hovered !== null && hovered !== id}
            />
            <path d={`M${x - halfArrow},${baseY} L${x},${tipY} L${x + halfArrow},${baseY}`} className="pair-timeline-arrow" />
            <text
              x={x}
              y={middle}
              textAnchor="middle"
              transform={`rotate(${layout.orderAngle} ${x} ${middle})`}
              dy={-bandWidth / 2 - layout.orderGap}
              className="pair-timeline-order"
            >{index + 1}</text>
          </g>
        )
      })}
    </svg>
  )
}
