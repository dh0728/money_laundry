import React, { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraphZoomControls } from './preview-graph-controls';
import { graphVerdict, graphVerdictLabels } from '../investigation/case-graph-scope';
import {
  ownerAccountY, ownerGraphLayout, ownerHeaderHeight, ownerRowHeight, ownerTransferPath, ownerTransferRisk, ownerWidth,
} from './owner-graph-layout';
import { copySVG, registerGraphSnapshot } from '../../lib/radar/preview-visual-export';
import { GraphFlowReveal, GraphFlowStroke } from './graph-flow-pulse';
import { useSpringNodeDrag } from './graph-node-drag';

const dragThreshold = 5;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const riskColor = risk => `var(--case-graph-risk-${risk})`;

function activate(event, select) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    select();
  }
}

function OwnerComparisonPeriods({ groups, timeByCode, times, formatTime, width, highlightedCase }) {
  const first = times[0], span = times.at(-1) - first;
  const left = Math.min(170, width * .48);
  const xFor = instant => left + (span ? (instant - first) / span : .5) * Math.max(0, width - left - 20);
  return <g className="owner-comparison-periods" role="group" aria-label="업무별 근거 거래 기간">
    <text x="12" y="16" className="owner-axis-heading">업무별 근거 거래 기간</text>
    {groups.map(({ id, color, transactionIds }, index) => {
      const evidence = [...transactionIds].map(code => timeByCode.get(code)).filter(Number.isFinite);
      if (!evidence.length) return null;
      const start = Math.min(...evidence), end = Math.max(...evidence), y = 32 + index * 20;
      const summary = start === end ? formatTime(start) : `${formatTime(start)} ~ ${formatTime(end)}`;
      return <g key={id} data-muted={highlightedCase && highlightedCase !== id || undefined}>
        <title>{id} · {summary} KST</title>
        <text x="12" y={y + 4}>{id}</text>
        <line x1={xFor(start)} x2={xFor(end)} y1={y} y2={y} stroke={color} strokeWidth="4" strokeLinecap="round" />
        <circle cx={xFor(start)} cy={y} r="3" fill={color} />
      </g>;
    })}
  </g>;
}

export function OwnerGraphTimeline({
  records, visible, selection, selectedCodes, selectedAccounts, selectedTransactions,
  onNodeSelect, onSelect, controlsHost, groups, highlightedCase, showDetails, playing, flowPulse,
}) {
  const host = useRef(null);
  const drawing = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const clipId = useId();
  const [viewport, setViewport] = useState(null);
  const [position, setPosition] = useState(null);
  const [panning, setPanning] = useState(false);
  const showPeriods = groups.length > 1;
  const { owners, links, timeByCode, times, formatTime, width, height } = useMemo(() => ownerGraphLayout(records), [records]);
  const viewWidth = viewport?.width ?? width;
  const viewHeight = viewport?.height ?? height;
  const timeInset = showPeriods ? 24 + groups.length * 20 : 0;
  const plotHeight = Math.max(1, viewHeight - timeInset);
  const fitScale = Math.min(1, viewWidth / width, plotHeight / height);
  const minScale = Math.min(.12, fitScale / 2);
  const fit = { scale: fitScale, x: (width * fitScale - viewWidth) / 2, y: (height * fitScale - plotHeight) / 2 };
  const camera = position ?? fit;
  const { offsetFor, nodeHandlers, activeId } = useSpringNodeDrag(camera.scale);
  const accountOffset = account => {
    const owner = offsetFor(account.owner.id);
    const row = offsetFor(account.id);
    return { x: owner.x + row.x, y: owner.y + row.y };
  };
  const moveCamera = (x, y) => setPosition(previous => {
    const current = previous ?? fit;
    return { ...current, x: current.x + x, y: current.y + y };
  });
  const zoom = (factor, focalX = viewWidth / 2, focalY = plotHeight / 2) => setPosition(previous => {
    const current = previous ?? fit;
    const scale = clamp(current.scale * factor, minScale, 3);
    const ratio = scale / current.scale;
    return { scale, x: (current.x + focalX) * ratio - focalX,
      y: (current.y + focalY) * ratio - focalY };
  });
  const zoomWithWheel = useEffectEvent(event => {
    if (!event.deltaY) return;
    event.preventDefault();
    const bounds = host.current.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left, 0, viewWidth);
    const y = clamp(event.clientY - bounds.top - timeInset, 0, plotHeight);
    zoom(Math.exp(-event.deltaY * .008), x, y);
  });

  useEffect(() => {
    const region = host.current;
    const wheel = event => zoomWithWheel(event);
    region.addEventListener('wheel', wheel, { passive: false });
    return () => region.removeEventListener('wheel', wheel);
  }, []);
  useLayoutEffect(() => {
    const region = host.current;
    const measure = () => {
      const width = region.clientWidth;
      const height = region.clientHeight;
      if (!width || !height) return;
      setViewport(previous => previous?.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(region);
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => registerGraphSnapshot(host.current, () => copySVG(drawing.current)), []);

  function startPan(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: camera.x, y: camera.y, dragging: false };
  }
  function pan(event) {
    const pointer = gesture.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.dragging) {
      if (Math.hypot(dx, dy) < dragThreshold) return;
      pointer.dragging = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setPanning(true);
    }
    setPosition({ scale: camera.scale, x: pointer.x - dx, y: pointer.y - dy });
  }
  function endPan(event) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setPanning(false);
  }
  function preventDragClick(event) {
    if (!suppressClick.current || event.detail === 0) return;
    event.stopPropagation();
    suppressClick.current = false;
  }
  function revealFocusedControl(event) {
    const control = event.target;
    if (control.getAttribute('role') !== 'button' || !control.matches(':focus-visible')) return;
    const view = event.currentTarget.getBoundingClientRect();
    const item = control.getBoundingClientRect();
    const overflow = (start, end, min, max) => start < min ? start - min : Math.max(0, end - max);
    const dx = overflow(item.left, item.right, view.left, view.right);
    const dy = overflow(item.top, item.bottom, view.top + timeInset, view.bottom);
    if (dx || dy) moveCamera(dx, dy);
  }
  function panWithKeyboard(event) {
    if (event.target !== event.currentTarget) return;
    const delta = { ArrowLeft: [-48, 0], ArrowRight: [48, 0], ArrowUp: [0, -48], ArrowDown: [0, 48] }[event.key];
    if (!delta) return;
    event.preventDefault();
    moveCamera(...delta);
  }
  const visibleCodes = new Set(visible.map(row => row.code));
  const shownAccounts = new Map();
  const edges = links.flatMap(link => {
    const rows = link.rows.filter(row => visibleCodes.has(row.code));
    if (!rows.length) return [];
    for (const [account, side] of [[link.from, 'outgoing'], [link.to, 'incoming']]) {
      const details = shownAccounts.get(account.id) ?? { rows: [] };
      details[side] = true;
      details.rows.push(...rows);
      shownAccounts.set(account.id, details);
    }
    return [{ ...link, rows }];
  });
  const highlightedCodes = groups.find(group => group.id === highlightedCase)?.transactionIds;
  const isHighlighted = rows => !highlightedCodes || rows.some(row => highlightedCodes.has(row.code));
  const dragHandlers = id => ({
    ...nodeHandlers(id),
    onPointerDownCapture() { suppressClick.current = false; },
  });
  return <div ref={host} className="preview-evidence-canvas preview-owner-timeline" data-export-visualization
    aria-label="소유주별 자금 흐름 그래프" aria-description="소유주 블록 안 계좌 사이의 거래를 표시합니다. 왼쪽은 수취, 오른쪽은 송금입니다."
    role="group" tabIndex={0} data-panning={panning || undefined}
    onPointerDown={startPan} onPointerMove={pan} onPointerUp={endPan} onPointerCancel={endPan}
    onLostPointerCapture={endPan} onClickCapture={preventDragClick} onFocusCapture={revealFocusedControl}
    onKeyDown={panWithKeyboard}>
    <svg ref={drawing} width={viewWidth} height={viewHeight} viewBox={`0 0 ${viewWidth} ${viewHeight}`}>
      <defs>
        <clipPath id={clipId}><rect x="0" y={timeInset} width={viewWidth} height={plotHeight} /></clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}
        style={{ '--owner-label-size': `${Math.min(22, Math.max(12, 10 / camera.scale))}px` }}>
        <g transform={`translate(${-camera.x} ${timeInset - camera.y}) scale(${camera.scale})`}>
          {edges.map(({ key, from, to, rows }, index) => {
            const { path, midpoint } = ownerTransferPath(from, to, accountOffset(from), accountOffset(to));
            const codes = new Set(rows.map(row => row.code));
            const memberships = groups.filter(group => rows.some(row => group.transactionIds.has(row.code)));
            const relationship = `${from.id}>${to.id}`;
            const active = rows.some(row => selectedTransactions?.has(row.code)) ||
              (selection === relationship && (!selectedCodes || rows.some(row => selectedCodes.has(row.code))));
            const verdict = graphVerdictLabels[graphVerdict(new Set(rows.map(row => row.verdict)))];
            const range = rows.map(row => timeByCode.get(row.code)).filter(Number.isFinite);
            const earliest = Math.min(...range), latest = Math.max(...range);
            const when = range.length ? earliest === latest ? `${formatTime(earliest)} KST` :
              `${formatTime(earliest)} ~ ${formatTime(latest)} KST` : '시각 없음';
            const label = `${from.id} → ${to.id} · ${rows.length}건 · ${verdict} · ${when}`;
            const select = () => selection === relationship ? onSelect() : onSelect(relationship, codes);
            const activePulse = flowPulse && codes.has(flowPulse.code) ? flowPulse : undefined;
            const color = riskColor(ownerTransferRisk(rows));
            const line = <>
              {memberships.map(({ id, color: stroke }, member) => <path key={id} d={path} stroke={stroke}
                strokeWidth={8 + 5 * (memberships.length - member)} strokeOpacity=".24" />)}
              <path className="owner-edge-visible" d={path} stroke={color} strokeWidth={active ? 4 : 2.5} />
            </>;
            return <g key={key} className="owner-time-edge" role="button" tabIndex={0} aria-label={label} aria-pressed={active}
              data-muted={!isHighlighted(rows) || undefined}
              onClick={select} onKeyDown={event => activate(event, select)}>
              <title>{[label, ...memberships.map(({ id }) => id)].join(' · ')}</title>
              {activePulse && codes.size === 1 ? <GraphFlowReveal key={activePulse.startedAt} path={path}
                pulse={activePulse} width={width} height={height}>{line}</GraphFlowReveal> : line}
              {activePulse
                ? <GraphFlowStroke key={activePulse.startedAt} path={path} pulse={activePulse} color={riskColor(activePulse.risk)} />
                : !playing && !flowPulse && isHighlighted(rows) &&
                  <GraphFlowStroke path={path} color={color} ambientDelay={index % 8 * .22} />}
              <path className="owner-edge-hit" d={path} stroke="transparent" strokeWidth={18} />
              {showDetails && (active || edges.length <= 12) &&
                <text x={midpoint[0]} y={midpoint[1] - 7}>{rows.length}건</text>}
            </g>;
          })}
          {owners.map(owner => {
            const accounts = owner.accounts.filter(account => shownAccounts.has(account.id));
            if (!accounts.length) return null;
            const offset = offsetFor(owner.id);
            const ownerSelect = () => onNodeSelect(owner.selection);
            return <g key={owner.id} className="owner-account-group" role="group" aria-label={owner.name}
              transform={`translate(${offset.x} ${offset.y})`}>
              <rect className="owner-block-boundary" x={owner.x} y={owner.y} width={ownerWidth} height={owner.height} rx="10" />
              <g className="owner-lane-control" role="button" tabIndex={0}
                aria-label={`${owner.name} · 계좌 묶음 선택`} aria-pressed={selection === owner.selection}
                data-dragging={activeId === owner.id || undefined} {...dragHandlers(owner.id)}
                onClick={ownerSelect} onKeyDown={event => activate(event, ownerSelect)}>
                <rect x={owner.x + 2} y={owner.y + 2} width={ownerWidth - 4} height={ownerHeaderHeight} rx="8" />
                <text x={owner.x + 12} y={owner.y + 2 + ownerHeaderHeight / 2} className="owner-lane-name">{owner.name}</text>
              </g>
              {accounts.map(account => {
                const { id } = account;
                const { rows, incoming, outgoing } = shownAccounts.get(id);
                const y = ownerAccountY(account);
                const centerY = y + ownerRowHeight / 2;
                const offset = offsetFor(id);
                const risk = riskColor(ownerTransferRisk(rows));
                const select = () => onNodeSelect(id);
                const pressed = selection === id || selection === owner.selection || selectedAccounts?.has(id) === true;
                return <g key={id} className="owner-time-node" role="button" tabIndex={0}
                  transform={`translate(${offset.x} ${offset.y})`}
                  data-account={id} data-dragging={activeId === id || undefined}
                  data-muted={!isHighlighted(rows) || undefined}
                  aria-label={`${id} · ${owner.name}`} aria-pressed={pressed}
                  {...dragHandlers(id)} onClick={select} onKeyDown={event => activate(event, select)}>
                  <rect x={owner.x + 2} y={y} width={ownerWidth - 4} height={ownerRowHeight} rx="4" />
                  <path className="owner-account-divider" d={`M ${owner.x + 2} ${y} h ${ownerWidth - 4}`} />
                  <text x={owner.x + 12} y={centerY}>{id}</text>
                  {incoming && <circle className="owner-account-port" data-port="receive" cx={owner.x} cy={centerY} r="4" fill={risk} />}
                  {outgoing && <circle className="owner-account-port" data-port="send" cx={owner.x + ownerWidth} cy={centerY} r="4" fill={risk} />}
                </g>;
              })}
            </g>;
          })}
        </g>
      </g>
      {showPeriods && <OwnerComparisonPeriods groups={groups} timeByCode={timeByCode} times={times}
        formatTime={formatTime} width={viewWidth} highlightedCase={highlightedCase} />}
    </svg>
    {controlsHost && createPortal(<GraphZoomControls zoom={Math.round(camera.scale * 100)}
      onZoom={zoom} onFit={() => setPosition(null)} />, controlsHost)}
  </div>;
}
