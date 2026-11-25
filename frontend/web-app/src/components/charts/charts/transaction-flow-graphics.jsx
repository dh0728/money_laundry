import React, { useId } from 'react';
import { readChartNumber } from '../chart-design-values';
import './transaction-flow-graphics.css';

export function TransactionFlowBand({ suspicious }) {
  return <svg viewBox="0 0 420 112" aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full">
    <path d="M118 38 C176 38 244 38 302 38 L302 74 C244 74 176 74 118 74 Z" className={suspicious ? 'fill-destructive/35' : 'fill-muted-foreground/35'} />
  </svg>;
}

export function FlowConnectionOverlay({ connections, ref }) {
  return <svg ref={ref} className="flow-connection-overlay" aria-hidden="true" focusable="false">
    {connections.map(({ name, targetIndex, active, d }) => <path key={`${name}-${targetIndex}`} data-source={name}
      data-target-index={targetIndex} data-active={active || undefined} d={d} />)}
  </svg>;
}

export function TransactionDirectionArrow({ incoming, sourceVerdict, destinationVerdict }) {
  const gradientId = useId();
  const mixed = sourceVerdict !== destinationVerdict;
  const headWidth = readChartNumber('--transaction-arrow-head-width', 20);
  const headInset = readChartNumber('--transaction-arrow-head-inset', 18);
  const arrowHeight = readChartNumber('--transaction-arrow-height', 23);
  const shaftHeight = readChartNumber('--aml-space-4', 4);
  return <svg className="transaction-direction-arrow" data-incoming={incoming || undefined} aria-hidden="true">
    {mixed && <defs>
      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" data-account-verdict={incoming ? destinationVerdict : sourceVerdict} stopColor="var(--transaction-endpoint-fill)" />
        <stop offset="100%" data-account-verdict={incoming ? sourceVerdict : destinationVerdict} stopColor="var(--transaction-endpoint-fill)" />
      </linearGradient>
    </defs>}
    <rect className="transaction-arrow-shaft" data-svg-width-from-layout="" data-account-verdict={sourceVerdict}
      x={incoming ? headInset : 0} y={(arrowHeight - shaftHeight) / 2} height={shaftHeight}
      fill={mixed ? `url(#${gradientId})` : 'var(--transaction-endpoint-fill)'} />
    <svg x={incoming ? '0' : '100%'} y="0" width={headWidth} height={arrowHeight} overflow="visible">
      <path data-account-verdict={destinationVerdict} fill="var(--transaction-endpoint-fill)"
        d={incoming ? 'M20 0 0 11.5 20 23Z' : 'M-20 0 0 11.5 -20 23Z'} />
    </svg>
  </svg>;
}
