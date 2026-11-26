import { useId, useState } from 'react'
import { useAppReducedMotion } from '@/hooks/use-reduced-motion'
import { readChartDurationSeconds, readChartNumber } from './charts/chart-design-values'

export function RadarSweep({ className = 'size-14' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const reducedMotion = useAppReducedMotion()
  const [design] = useState(() => ({
    coreRadius: readChartNumber('--radar-core-radius', 5),
    coreMidpoint: readChartNumber('--radar-core-gradient-midpoint', 0.4),
    bezelMidpoint: readChartNumber('--radar-bezel-gradient-midpoint', 0.5),
    sweepDuration: readChartDurationSeconds('--radar-sweep-duration', 2.2),
  }))
  return <svg viewBox="0 0 32 32" className={className} aria-hidden data-testid="rdr-eye">
    <defs>
      <radialGradient id={`${id}-core`} cx="16" cy="16" r={design.coreRadius} gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--radar-core-hot)" /><stop offset={design.coreMidpoint} stopColor="var(--graph-l1)" /><stop offset="1" stopColor="var(--radar-core-deep)" />
      </radialGradient>
      <linearGradient id={`${id}-bezel`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--radar-bezel-light)" /><stop offset={design.bezelMidpoint} stopColor="var(--radar-bezel-mid)" /><stop offset="1" stopColor="var(--radar-bezel-dark)" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" className="radar-disc" fill="var(--radar-disc)" stroke={`url(#${id}-bezel)`} />
    <circle cx="16" cy="16" className="radar-outer-ring" fill="none" stroke="var(--graph-l1)" />
    <circle cx="16" cy="16" className="radar-inner-ring" fill="none" stroke="var(--graph-l1)" />
    <g>
      <path d="M16 16 L16 3 A13 13 0 0 1 18.7 3.28 Z" className="radar-trail-faint" fill="var(--graph-l1)" />
      <path d="M16 16 L18.7 3.28 A13 13 0 0 1 23.64 5.48 Z" className="radar-trail-middle" fill="var(--graph-l1)" />
      <path d="M16 16 L23.64 5.48 A13 13 0 0 1 28.93 17.36 Z" className="radar-trail-bright" fill="var(--graph-l1)" />
      <path d="M16 16 L28.93 17.36" className="radar-beam" stroke="var(--radar-core-hot)" strokeLinecap="round" />
      {!reducedMotion && <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur={`${design.sweepDuration}s`} repeatCount="indefinite" />}
    </g>
    <circle cx="16" cy="16" fill={`url(#${id}-core)`} className="radar-core rdr-glow" />
    <circle cx="16" cy="16" className="radar-highlight" fill="var(--radar-bezel-light)" />
  </svg>
}
