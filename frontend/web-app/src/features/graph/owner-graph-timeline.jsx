import React, { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraphZoomControls } from './preview-graph-controls';
import { graphVerdict, graphVerdictLabels } from '../investigation/case-graph-scope';
import {
  ownerAccountY, ownerGraphLayout, ownerHeaderHeight, ownerRowHeight, ownerTransferPath, ownerTransferRisk, ownerWidth,
} from './owner-graph-layout';
import { copySVG, registerGraphSnapshot } from '../../lib/preview-visual-export';
import { useSpringNodeDrag } from './graph-node-drag';
import { Box } from '../../components/layout-primitives';
import { OwnerFlowAccount, OwnerFlowDiagram, OwnerFlowEdge, OwnerFlowLane, OwnerFlowPeriods, readOwnerFlowDesign } from '../../components/charts/charts/owner-flow-diagram';
import { readGraphFlowMarkers } from '../../components/charts/charts/graph-flow-pulse';
import { flowMarkers } from './graph-case-groups';
import { useAppReducedMotion } from '@/hooks/use-reduced-motion';

const dragThreshold = 5;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const riskColor = risk => `var(--case-graph-risk-${risk})`;

function ownerComparisonPeriods({ groups, timeByCode, times, formatTime, width, highlightedCase }) {
  const first = times[0], span = times.at(-1) - first;
  const left = Math.min(170, width * .48);
  const xFor = instant => left + (span ? (instant - first) / span : .5) * Math.max(0, width - left - 20);
  return groups.flatMap(({ id, color, transactionIds }, index) => {
    const evidence = [...transactionIds].map(code => timeByCode.get(code)).filter(Number.isFinite);
    if (!evidence.length) return [];
    const start = Math.min(...evidence), end = Math.max(...evidence);
    const summary = start === end ? formatTime(start) : `${formatTime(start)} ~ ${formatTime(end)}`;
    return [{ id, color, x1: xFor(start), x2: xFor(end), y: 32 + index * 20,
      summary, muted: highlightedCase && highlightedCase !== id }];
  });
}

export function OwnerGraphTimeline({
  records, visible, selection, selectedCodes, selectedAccounts, selectedTransactions,
  onNodeSelect, onSelect, controlsHost, groups, highlightedCase, showDetails, playing, flowPulse,
}) {
  const host = useRef(null);
  const drawing = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const [viewport, setViewport] = useState(null);
  const [position, setPosition] = useState(null);
  const [panning, setPanning] = useState(false);
  const [design] = useState(readOwnerFlowDesign);
  const [markerDesign] = useState(readGraphFlowMarkers);
  const reducedMotion = useAppReducedMotion();
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
  const edgePaths = edges.map(edge => ({ ...edge, ...ownerTransferPath(edge.from, edge.to, accountOffset(edge.from), accountOffset(edge.to)) }));
  // 모든 선에서 표식이 송금 방향으로 계속 흐른다. 비교 중이면 Alert별 모양, 공유한 거래는 모양이 번갈아 촘촘해진다.
  const still = reducedMotion || playing || Boolean(flowPulse);
  const spacing = markerDesign.spacing * (edgePaths.length > markerDesign.denseEdges ? 2 : 1);
  const edgeMarkers = (length, memberships) => {
    const screen = length * camera.scale;
    const caseIds = groups.length > 1 ? memberships.map(group => group.id) : [];
    const markers = flowMarkers(caseIds, screen, spacing).map(({ t, caseId }) => {
      const group = memberships.find(entry => entry.id === caseId);
      if (!group) return { t, radius: markerDesign.dotRadius / camera.scale, fill: 'var(--text)', opacity: markerDesign.dotOpacity };
      const dimmed = highlightedCase && highlightedCase !== caseId;
      return { t, shape: group.shape, radius: markerDesign.markerRadius / camera.scale,
        fill: dimmed ? 'var(--case-graph-dimmed)' : group.color, stroke: 'var(--graph-flow-highlight)',
        strokeWidth: markerDesign.outline / camera.scale };
    });
    return { markers, still, duration: Math.max(screen, 1) / markerDesign.speed };
  };
  const highlightedCodes = groups.find(group => group.id === highlightedCase)?.transactionIds;
  const isHighlighted = rows => !highlightedCodes || rows.some(row => highlightedCodes.has(row.code));
  const dragHandlers = id => ({
    ...nodeHandlers(id),
    onPointerDownCapture() { suppressClick.current = false; },
  });
  return <Box ref={host} className="preview-evidence-canvas preview-owner-timeline" data-export-visualization
    aria-label="소유주별 자금 흐름 그래프" aria-description="소유주 블록 안 계좌 사이의 거래를 표시합니다. 왼쪽은 수취, 오른쪽은 송금입니다."
    role="group" tabIndex={0} data-panning={panning || undefined}
    onPointerDown={startPan} onPointerMove={pan} onPointerUp={endPan} onPointerCancel={endPan}
    onLostPointerCapture={endPan} onClickCapture={preventDragClick} onFocusCapture={revealFocusedControl}
    onKeyDown={panWithKeyboard}>
    <OwnerFlowDiagram ref={drawing} width={viewWidth} height={viewHeight} inset={timeInset}
      plotHeight={plotHeight} camera={camera} periods={showPeriods ? <OwnerFlowPeriods design={design} periods={ownerComparisonPeriods({
        groups, timeByCode, times, formatTime, width: viewWidth, highlightedCase,
      })} /> : undefined}>
      {edgePaths.map(({ key, from, to, rows, path, midpoint, length }) => {
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
        const highlighted = isHighlighted(rows);
        return <OwnerFlowEdge key={key} design={design} path={path} label={label} pressed={active} muted={!highlighted}
          onSelect={select} memberships={memberships} color={riskColor(ownerTransferRisk(rows))}
          width={width} height={height} pulse={activePulse} pulseColor={activePulse && riskColor(activePulse.risk)}
          reveal={activePulse && codes.size === 1}
          markers={edgeMarkers(length, memberships)}
          detail={showDetails && (active || edges.length <= 12)
            ? { x: midpoint[0], y: midpoint[1], count: rows.length } : undefined} />;
      })}
      {owners.map(owner => {
        const accounts = owner.accounts.filter(account => shownAccounts.has(account.id));
        if (!accounts.length) return null;
        return <OwnerFlowLane key={owner.id} design={design} name={owner.name} x={owner.x} y={owner.y} width={ownerWidth}
          height={owner.height} headerHeight={ownerHeaderHeight} offset={offsetFor(owner.id)}
          pressed={selection === owner.selection} dragging={activeId === owner.id}
          onSelect={() => onNodeSelect(owner.selection)} dragHandlers={dragHandlers(owner.id)}>
          {accounts.map(account => {
            const { id } = account;
            const { rows, incoming, outgoing } = shownAccounts.get(id);
            const sharedBy = groups.length > 1 ? groups.filter(group => rows.some(row => group.transactionIds.has(row.code))).length : 0;
            const pressed = selection === id || selection === owner.selection || selectedAccounts?.has(id) === true;
            return <OwnerFlowAccount key={id} design={design} id={id} owner={owner.name} x={owner.x} y={ownerAccountY(account)}
              width={ownerWidth} height={ownerRowHeight} offset={offsetFor(id)} pressed={pressed}
              muted={!isHighlighted(rows)} dragging={activeId === id} incoming={incoming} outgoing={outgoing}
              color={riskColor(ownerTransferRisk(rows))} shared={sharedBy > 1 ? sharedBy : undefined}
              badge={{ width: markerDesign.badgeWidth, height: markerDesign.badgeHeight }}
              onSelect={() => onNodeSelect(id)} dragHandlers={dragHandlers(id)} />;
          })}
        </OwnerFlowLane>;
      })}
    </OwnerFlowDiagram>
    {controlsHost && createPortal(<GraphZoomControls zoom={Math.round(camera.scale * 100)}
      onZoom={zoom} onFit={() => setPosition(null)} />, controlsHost)}
  </Box>;
}
