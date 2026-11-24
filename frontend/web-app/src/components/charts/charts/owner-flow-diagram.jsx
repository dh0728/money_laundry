import { useId } from 'react';
import { GraphFlowReveal, GraphFlowStroke } from './graph-flow-pulse';

function selectWithKeyboard(event, select) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    select();
  }
}

export function OwnerFlowDiagram({ ref, width, height, inset, plotHeight, camera, periods, children }) {
  const clipId = useId();
  return <svg ref={ref} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    <defs>
      <clipPath id={clipId}><rect x="0" y={inset} width={width} height={plotHeight} /></clipPath>
    </defs>
    <g clipPath={`url(#${clipId})`}
      style={{ '--owner-label-size': `${Math.min(22, Math.max(12, 10 / camera.scale))}px` }}>
      <g transform={`translate(${-camera.x} ${inset - camera.y}) scale(${camera.scale})`}>
        {children}
      </g>
    </g>
    {periods}
  </svg>;
}

export function OwnerFlowPeriods({ periods }) {
  return <g className="owner-comparison-periods" role="group" aria-label="업무별 근거 거래 기간">
    <text x="12" y="16" className="owner-axis-heading">업무별 근거 거래 기간</text>
    {periods.map(({ id, x1, x2, y, color, summary, muted }) => <g key={id} data-muted={muted || undefined}>
      <title>{id} · {summary} KST</title>
      <text x="12" y={y + 4}>{id}</text>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={color} strokeWidth="4" strokeLinecap="round" />
      <circle cx={x1} cy={y} r="3" fill={color} />
    </g>)}
  </g>;
}

export function OwnerFlowEdge({ path, label, pressed, muted, onSelect, memberships, color, reveal,
  pulse, pulseColor, width, height, ambientDelay, detail }) {
  const line = <>
    {memberships.map(({ id, color: stroke }, index) => <path key={id} d={path} stroke={stroke}
      strokeWidth={8 + 5 * (memberships.length - index)} strokeOpacity=".24" />)}
    <path className="owner-edge-visible" d={path} stroke={color} strokeWidth={pressed ? 4 : 2.5} />
  </>;
  return <g className="owner-time-edge" role="button" tabIndex={0} aria-label={label} aria-pressed={pressed}
    data-muted={muted || undefined} onClick={onSelect} onKeyDown={event => selectWithKeyboard(event, onSelect)}>
    <title>{[label, ...memberships.map(({ id }) => id)].join(' · ')}</title>
    {reveal ? <GraphFlowReveal key={pulse.startedAt} path={path} pulse={pulse} width={width} height={height}>
      {line}
    </GraphFlowReveal> : line}
    {pulse ? <GraphFlowStroke key={pulse.startedAt} path={path} pulse={pulse} color={pulseColor} />
      : ambientDelay !== undefined && <GraphFlowStroke path={path} color={color} ambientDelay={ambientDelay} />}
    <path className="owner-edge-hit" d={path} stroke="transparent" strokeWidth={18} />
    {detail && <text x={detail.x} y={detail.y - 7}>{detail.count}건</text>}
  </g>;
}

export function OwnerFlowLane({ name, x, y, width, height, headerHeight, offset, pressed, dragging,
  onSelect, dragHandlers, children }) {
  return <g className="owner-account-group" role="group" aria-label={name}
    transform={`translate(${offset.x} ${offset.y})`}>
    <rect className="owner-block-boundary" x={x} y={y} width={width} height={height} rx="10" />
    <g className="owner-lane-control" role="button" tabIndex={0}
      aria-label={`${name} · 계좌 묶음 선택`} aria-pressed={pressed}
      data-dragging={dragging || undefined} {...dragHandlers}
      onClick={onSelect} onKeyDown={event => selectWithKeyboard(event, onSelect)}>
      <rect x={x + 2} y={y + 2} width={width - 4} height={headerHeight} rx="8" />
      <text x={x + 12} y={y + 2 + headerHeight / 2} className="owner-lane-name">{name}</text>
    </g>
    {children}
  </g>;
}

export function OwnerFlowAccount({ id, owner, x, y, width, height, offset, pressed, muted, dragging,
  incoming, outgoing, color, onSelect, dragHandlers }) {
  const centerY = y + height / 2;
  return <g className="owner-time-node" role="button" tabIndex={0}
    transform={`translate(${offset.x} ${offset.y})`}
    data-account={id} data-dragging={dragging || undefined} data-muted={muted || undefined}
    aria-label={`${id} · ${owner}`} aria-pressed={pressed} {...dragHandlers}
    onClick={onSelect} onKeyDown={event => selectWithKeyboard(event, onSelect)}>
    <rect x={x + 2} y={y} width={width - 4} height={height} rx="4" />
    <path className="owner-account-divider" d={`M ${x + 2} ${y} h ${width - 4}`} />
    <text x={x + 12} y={centerY}>{id}</text>
    {incoming && <circle className="owner-account-port" data-port="receive" cx={x} cy={centerY} r="4" fill={color} />}
    {outgoing && <circle className="owner-account-port" data-port="send" cx={x + width} cy={centerY} r="4" fill={color} />}
  </g>;
}
