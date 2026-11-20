import { useId } from 'react'

export function RadarSweep({ className = 'size-14' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  return <svg viewBox="0 0 32 32" className={className} aria-hidden data-testid="rdr-eye">
    <defs>
      <radialGradient id={`${id}-core`} cx="16" cy="16" r="5" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--radar-core-hot)" /><stop offset=".4" stopColor="var(--graph-l1)" /><stop offset="1" stopColor="var(--radar-core-deep)" />
      </radialGradient>
      <linearGradient id={`${id}-bezel`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--radar-bezel-light)" /><stop offset=".5" stopColor="var(--radar-bezel-mid)" /><stop offset="1" stopColor="var(--radar-bezel-dark)" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="15" fill="var(--radar-disc)" stroke={`url(#${id}-bezel)`} strokeWidth="1.5" />
    <circle cx="16" cy="16" r="12.5" fill="none" stroke="var(--graph-l1)" strokeOpacity=".3" strokeWidth=".6" />
    <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--graph-l1)" strokeOpacity=".25" strokeWidth=".5" />
    <g>
      <path d="M16 16 L16 3 A13 13 0 0 1 18.7 3.28 Z" fill="var(--graph-l1)" fillOpacity=".08" />
      <path d="M16 16 L18.7 3.28 A13 13 0 0 1 23.64 5.48 Z" fill="var(--graph-l1)" fillOpacity=".2" />
      <path d="M16 16 L23.64 5.48 A13 13 0 0 1 28.93 17.36 Z" fill="var(--graph-l1)" fillOpacity=".6" />
      <path d="M16 16 L28.93 17.36" stroke="var(--radar-core-hot)" strokeWidth="1.4" strokeLinecap="round" />
      {!reducedMotion && <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="2.2s" repeatCount="indefinite" />}
    </g>
    <circle cx="16" cy="16" r="5" fill={`url(#${id}-core)`} className="rdr-glow" />
    <circle cx="16" cy="16" r="1.3" fill="var(--radar-bezel-light)" fillOpacity=".85" />
  </svg>
}
