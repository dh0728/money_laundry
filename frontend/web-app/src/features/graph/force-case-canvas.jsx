import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { configureDevAccountForces, seedComponentPositions } from './0.24.0/force-layout';
import { contextOnly, graphRiskBand, graphVerdict, graphVerdictLabels, transactionRoleLabels } from '../investigation/case-graph-scope';
import { caseMembership, caseShapePoints, caseShortLabel, flowMarkers } from './graph-case-groups';
import { GraphZoomControls } from './preview-graph-controls';
import { readGraphCanvasPulse, readGraphFlowMarkers } from '../../components/charts/charts/graph-flow-pulse';
import { readCanvasColors, readChartNumber } from '../../components/charts/chart-design-values';
import { makeGraphSnapshot, registerGraphSnapshot } from '../../lib/preview-visual-export';
import { buildHopTimePlan, readGraphTimeAxisDesign, projectGraphTimeTicks,
  patternHomeForce, patternVelocityDecay } from './pattern-graph-time';
import { useAppReducedMotion } from '@/hooks/use-reduced-motion';
import { Box, Text } from '../../components/layout-primitives';

function simulationData(network, positions, timePlan, previous) {
  const saved = new Map(previous?.nodes.map(node => [node.id, node]));
  const nodes = seedComponentPositions({
    nodes: network.nodes.map((node, index) => {
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      return { id: node.id, key: node.id, x: Math.cos(angle) * Math.sqrt(index), y: Math.sin(angle) * Math.sqrt(index) };
    }),
    edges: network.edges.map(edge => ({ s: edge.source, t: edge.target })),
  }).map(node => {
    const home = timePlan?.homes.get(node.id);
    if (home) return { ...node, ...home, home };
    const point = positions?.[node.id];
    if (point) {
      // The account planner spaces panel-sized nodes. Canvas nodes are smaller glyphs.
      const x = point.x * .44;
      const y = point.y * .44;
      return { ...node, x, y, fx: x, fy: y };
    }
    const old = saved.get(node.id);
    return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy } : node;
  });
  return { nodes, links: network.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })) };
}

function edgeShape(a, b, curved) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const start = { x: a.x + a.r * dx, y: a.y + a.r * dy };
  const end = { x: b.x - b.r * dx, y: b.y - b.r * dy };
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const bend = curved ? Math.hypot(b.x - a.x, b.y - a.y) * .23 : 0;
  const control = { x: mid.x - bend * dy, y: mid.y + bend * dx };
  const loop = a.id === b.id;
  const firstLoopControl = { x: a.x + 3 * a.r, y: a.y - 4 * a.r };
  const secondLoopControl = { x: a.x - 3 * a.r, y: a.y - 4 * a.r };
  const curve = loop ? [start, firstLoopControl, secondLoopControl, end] : [start, control, end];
  const path = loop
    ? `M ${start.x} ${start.y} C ${firstLoopControl.x} ${firstLoopControl.y}, ${secondLoopControl.x} ${secondLoopControl.y}, ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  return { path, curve,
    x: (mid.x + control.x) / 2, y: loop ? a.y - 3*a.r : (mid.y + control.y) / 2 };
}

function radius(node) {
  return Math.min(12, 5 + Math.sqrt(node.codes.size) * 2);
}

const renderedRadius = (node, zoom) => Math.min(radius(node), 18 / zoom);

function avoidEdgeLabelCollisions(nodes, edges, selection, pixel) {
  const widthFor = text => [...text].reduce((width, char) => width + (char.charCodeAt(0) < 128 ? 7 : 11), 4) * pixel;
  const rectangle = (x, y, width, height) => ({ left: x - width / 2, top: y, right: x + width / 2, bottom: y + height });
  const reserved = nodes.flatMap(({ x, y, r, text }) => {
    const mark = rectangle(x, y - r, r * 2, r * 2);
    return text ? [mark, rectangle(x, y + r + 4 * pixel, widthFor(text), 12 * pixel)] : [mark];
  });
  const labeled = edges.filter(edge => edge.text);
  if (selection?.size) labeled.sort((a, b) => Number(selection.has(b.id)) - Number(selection.has(a.id)));
  for (const edge of labeled) {
    const area = rectangle(edge.x, edge.y - 16 * pixel, widthFor(edge.text), 12 * pixel);
    const overlaps = reserved.some(box => area.left < box.right && box.left < area.right &&
      area.top < box.bottom && box.top < area.bottom);
    if (overlaps && !selection?.has(edge.id)) edge.text = undefined;
    else reserved.push(area);
  }
}

// 주변 거래로만 이루어진 선은 흐린 점선, 계좌는 속이 빈 원으로 그린다.
export function readContextDesign() {
  return {
    opacity: readChartNumber('--case-graph-context-opacity', .4),
    dash: readChartNumber('--case-graph-context-dash', 6),
    gap: readChartNumber('--case-graph-context-gap', 5),
  };
}

function edgeRoleText(edge) {
  if (!edge.contextCodes?.size) return `${edge.codes.size}건`;
  return contextOnly(edge) ? `${transactionRoleLabels.context} ${edge.codes.size}건`
    : `${edge.codes.size}건 · ${transactionRoleLabels.context} ${edge.contextCodes.size}건`;
}

function graphGeometry(coords, visible, groups, colors, selection, highlight, point, unit, showDetails, ownerView, zoom = unit,
  contextDesign = readContextDesign()) {
  const edgeUnit = unit / Math.max(1, zoom);
  const nodes = visible.nodes.flatMap(node => {
    const position = coords.get(node.id);
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return [];
    const caseIds = caseMembership(groups, node.codes);
    const shared = caseIds.length > 1;
    const dimmed = highlight && !caseIds.includes(highlight);
    const label = [node.id, ownerView && `계좌 ${node.accounts.size}개`, shared && caseIds.map(caseShortLabel).join('·')].filter(Boolean).join(' · ');
    const tone = dimmed ? colors.dimmed : colors[graphRiskBand(node.peakScore)];
    const hollow = contextOnly(node);
    return [{ id: node.id, ...point(position.x, position.y), r: renderedRadius(node, zoom) * unit, caseIds,
      fill: hollow ? colors.axisFill : tone, outline: hollow ? tone : undefined, outlineWidth: 2.5 * edgeUnit,
      // 여러 Alert가 함께 쓰는 계좌는 Alert 색을 나눈 고리와 '공유 N' 배지로 표시한다.
      ring: shared ? caseIds.map(id => highlight && highlight !== id ? colors.dimmed : colors[id]) : undefined,
      badge: shared ? `공유 ${caseIds.length}` : undefined, badgeFill: colors.ink, badgeInk: colors.axisFill,
      stroke: selection?.has(node.id) ? colors.accent : undefined,
      text: visible.nodes.length <= 25 || selection?.has(node.id) || caseIds.includes(highlight) ? label : undefined,
      textColor: colors.ink }];
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const directions = new Set(visible.edges.map(edge => `${edge.source}>${edge.target}`));
  const edges = visible.edges.flatMap(edge => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target) return [];
    const caseIds = caseMembership(groups, edge.codes);
    const label = graphVerdictLabels[graphVerdict(edge.verdicts)];
    const dimmed = highlight && !caseIds.includes(highlight);
    const context = contextOnly(edge);
    return [{ id: edge.id, caseIds, ...edgeShape(source, target, directions.has(`${edge.target}>${edge.source}`)),
      stroke: dimmed ? colors.dimmed : colors[graphRiskBand(edge.peakScore)],
      width: (selection?.has(edge.id) ? 5 : 3) * edgeUnit,
      dash: context ? [contextDesign.dash * edgeUnit, contextDesign.gap * edgeUnit] : undefined,
      opacity: context && !selection?.has(edge.id) ? contextDesign.opacity : 1,
      text: showDetails && (visible.edges.length <= 16 || selection?.has(edge.id))
        ? [edgeRoleText(edge), label, caseIds.length > 1 && caseIds.map(caseShortLabel).join('·')].filter(Boolean).join(' · ') : undefined,
      textColor: colors.ink }];
  });
  if (showDetails) avoidEdgeLabelCollisions(nodes, edges, selection, unit / zoom);
  return { nodes, edges };
}

function paintLine(context, { path, stroke, width, opacity = 1, dash }) {
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.lineCap = dash ? 'butt' : 'round';
  context.setLineDash(dash ?? []);
  context.stroke(new Path2D(path));
  context.restore();
}

function curvePoint(points, progress) {
  if (points.length === 1) return points[0];
  return curvePoint(points.slice(1).map((point, index) => ({
    x: points[index].x + (point.x - points[index].x) * progress,
    y: points[index].y + (point.y - points[index].y) * progress,
  })), progress);
}

// 선 위를 송금 방향으로 흐르는 표식. 비교 중이면 Alert별 모양·색, 아니면 작은 점이다.
// elapsed(초)가 없으면 멈춘 자리에 찍는다(동작 줄이기, 재생 중, 이미지 내려받기).
function edgeMarkers(edge, { pixel, design, elapsed, shapes, colors, highlight, dense }) {
  const samples = Array.from({ length: 9 }, (_, index) => curvePoint(edge.curve, index / 8));
  const length = samples.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - samples[index].x, point.y - samples[index].y), 0) / pixel;
  const spacing = design.spacing * (dense ? 2 : 1);
  const kinds = Math.max(1, edge.caseIds.length);
  const count = Math.max(1, Math.round(length / spacing)) * kinds;
  const shift = elapsed === undefined ? .5 : elapsed * design.speed / Math.max(length / count, 1);
  const outside = highlight && !edge.caseIds.includes(highlight);
  return flowMarkers(edge.caseIds, length, spacing, shift).map(({ t, caseId }) => {
    const { x, y } = curvePoint(edge.curve, t);
    const fade = (edge.opacity ?? 1) *
      (elapsed === undefined ? 1 : Math.max(0, Math.min(1, t / design.fadeShare, (1 - t) / design.fadeShare)));
    if (caseId === undefined) {
      return { x, y, r: design.dotRadius * pixel, fill: colors.ink, opacity: fade * design.dotOpacity * (outside ? .3 : 1) };
    }
    const dimmed = highlight && caseId !== highlight;
    return { x, y, r: design.markerRadius * pixel, shape: shapes.get(caseId), fill: dimmed ? colors.dimmed : colors[caseId],
      stroke: colors.flowHighlight, strokeWidth: design.outline * pixel, opacity: fade * (dimmed ? .45 : 1) };
  });
}

function traceShape(context, { x, y, r, shape }) {
  context.beginPath();
  const points = caseShapePoints(shape);
  if (!points) {
    context.arc(x, y, r, 0, Math.PI * 2);
    return;
  }
  points.forEach(([px, py], index) => context[index ? 'lineTo' : 'moveTo'](x + px * r, y + py * r));
  context.closePath();
}

function paintMarker(context, marker) {
  if (marker.opacity <= 0) return;
  context.save();
  context.globalAlpha = marker.opacity;
  traceShape(context, marker);
  context.fillStyle = marker.fill;
  context.fill();
  if (marker.stroke) {
    context.strokeStyle = marker.stroke;
    context.lineWidth = marker.strokeWidth;
    context.lineJoin = 'round';
    context.stroke();
  }
  context.restore();
}

// 공유 계좌: 노드 둘레에 Alert 색을 똑같이 나눈 고리, 오른쪽 위에 '공유 N' 배지.
function paintSharedNode(context, dot, pixel, badgeHeight) {
  const width = 3 * pixel;
  const reach = dot.r + 3 * pixel;
  const part = Math.PI * 2 / dot.ring.length;
  context.save();
  context.lineWidth = width;
  dot.ring.forEach((color, index) => {
    context.beginPath();
    context.arc(dot.x, dot.y, reach, -Math.PI / 2 + index * part, -Math.PI / 2 + (index + 1) * part);
    context.strokeStyle = color;
    context.stroke();
  });
  context.font = `600 ${10 * pixel}px Pretendard`;
  const textWidth = context.measureText(dot.badge).width;
  const height = badgeHeight * pixel;
  const left = dot.x + reach - 2 * pixel;
  const top = dot.y - reach - height + 2 * pixel;
  context.fillStyle = dot.badgeFill;
  context.beginPath();
  context.roundRect(left, top, textWidth + 10 * pixel, height, height / 2);
  context.fill();
  context.fillStyle = dot.badgeInk;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(dot.badge, left + 5 * pixel, top + height / 2 + .5 * pixel);
  context.restore();
}

function revealedEdge(edge, progress) {
  const prefix = [];
  for (let points = edge.curve; points.length; points = points.slice(1).map((point, index) => ({
    x: points[index].x + (point.x - points[index].x) * progress,
    y: points[index].y + (point.y - points[index].y) * progress,
  }))) prefix.push(points[0]);
  const [{ x, y }, ...controls] = prefix;
  return { ...edge,
    path: `M ${x} ${y} ${controls.length === 3 ? 'C' : 'Q'} ${controls.map(point => `${point.x} ${point.y}`).join(', ')}`,
    text: progress > 0.6 ? edge.text : undefined };
}

function paintFlow(context, edge, pulse, color, highlight, scale, design) {
  const time = (performance.now() - pulse.startedAt) / design.duration;
  if (time < 0 || time >= 1) return;
  const progress = time * (1 + design.pulseLength);
  const start = Math.max(0, progress - design.pulseLength);
  const end = Math.min(1, progress);
  const { x, y } = curvePoint(edge.curve, start);
  context.save();
  context.globalAlpha = Math.min(1, time / design.fadeShare, (1 - time) / design.fadeShare);
  context.lineCap = 'round';
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(x, y);
  for (let index = 1; index <= 8; index++) {
    const point = curvePoint(edge.curve, start + (end - start) * index / 8);
    context.lineTo(point.x, point.y);
  }
  context.strokeStyle = color;
  context.lineWidth = design.width / scale;
  context.stroke();
  context.strokeStyle = highlight;
  context.lineWidth = design.highlightWidth / scale;
  context.stroke();
  context.restore();
}

function tokenColors(host, groups) {
  return readCanvasColors(host, {
    ink: 'var(--text)', dimmed: 'var(--case-graph-dimmed)', accent: 'var(--brand-accent)',
    axisFill: 'var(--inner-surface)', grid: 'var(--divider)',
    flowHighlight: 'var(--graph-flow-highlight)',
    high: 'var(--case-graph-risk-high)', medium: 'var(--case-graph-risk-medium)',
    low: 'var(--case-graph-risk-low)', unknown: 'var(--case-graph-risk-unknown)',
    ...Object.fromEntries(groups.map(group => [group.id, group.color])),
  });
}

function timeAxisMarks(plan, engine, { width, height }, design) {
  return { height, design, ticks: projectGraphTimeTicks(plan.ticks, x => engine.graph2ScreenCoords(x, 0).x, width, design) };
}

function drawTimeAxis(context, engine, scale, axis, colors, foreground) {
  const { x, y } = engine.screen2GraphCoords(0, 0);
  context.save();
  context.translate(x, y);
  context.scale(1 / scale, 1 / scale);
  if (!foreground) {
    context.strokeStyle = colors.grid;
    context.lineWidth = axis.design.stroke;
    context.beginPath();
    for (const tick of axis.ticks) {
      context.moveTo(tick.x, axis.design.inset);
      context.lineTo(tick.x, axis.height);
    }
    context.stroke();
  } else {
    const pill = axis.design.pill;
    context.font = `${pill.fontSize}px ${pill.fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    for (const { x: tickX, label, pillWidth } of axis.ticks) {
      if (!label) continue;
      context.fillStyle = colors.axisFill;
      context.beginPath();
      context.roundRect(tickX - pillWidth / 2, pill.top, pillWidth, pill.height, pill.radius);
      context.fill();
      context.fillStyle = colors.ink;
      context.fillText(label, tickX, pill.textY);
    }
  }
  context.restore();
}

function addTimeAxisSnapshot(snapshot, axis, colors) {
  const make = (tag, attrs, label) => {
    const element = snapshot.ownerDocument.createElementNS(snapshot.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (label) element.textContent = label;
    return element;
  };
  const lines = axis.ticks.map(tick => `M ${tick.x} ${axis.design.inset} V ${axis.height}`).join(' ');
  snapshot.prepend(make('path', { d: lines, stroke: colors.grid, 'stroke-width': axis.design.stroke, fill: 'none' }));
  const pill = axis.design.pill;
  const text = { fill: colors.ink, 'font-family': pill.fontFamily, 'font-size': pill.fontSize, 'text-anchor': 'middle' };
  for (const { x, label, pillWidth } of axis.ticks) {
    if (!label) continue;
    snapshot.append(make('rect', { x: x - pillWidth / 2, y: pill.top, width: pillWidth,
      height: pill.height, rx: pill.radius, fill: colors.axisFill }));
    snapshot.append(make('text', { ...text, x, y: pill.textY }, label));
  }
}

export function ForceCaseCanvas({
  network, visible, ownerView, selection, onNodeSelect, onSelect, controlsHost, groups, positions, records,
  showDetails, highlightedCase, flowPulse, playing,
}) {
  const host = useRef(null);
  const graph = useRef();
  const fitPending = useRef(true);
  const originalLink = useRef();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(100);
  const [colors, setColors] = useState({});
  const [pulseDesign] = useState(readGraphCanvasPulse);
  const [markerDesign] = useState(readGraphFlowMarkers);
  const [flowStart] = useState(() => performance.now());
  const shapes = useMemo(() => new Map(groups.map(group => [group.id, group.shape])), [groups]);
  const [axisDesign] = useState(readGraphTimeAxisDesign);
  const [contextDesign] = useState(readContextDesign);
  const timePlan = useMemo(() => buildHopTimePlan(records ?? [], network.nodes), [records, network]);
  const [data, setData] = useState(() => simulationData(network, positions, timePlan));
  const currentLayout = useRef({ network, positions, timePlan });
  const reducedMotion = useAppReducedMotion();
  const activeFlow = reducedMotion ? undefined : flowPulse;
  // 모든 선에서 표식이 계속 흐른다. 동작 줄이기·재생 중·한 거래 강조 중에는 멈춘 자리에 찍는다.
  const flowing = !reducedMotion && !playing && !activeFlow && visible.edges.length > 0;
  const dense = visible.edges.length > markerDesign.denseEdges;
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([{ contentRect }]) => {
      setSize({ width: Math.floor(contentRect.width), height: Math.floor(contentRect.height) });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const refresh = () => setColors(tokenColors(host.current, groups));
    refresh();
    document.addEventListener('aml:appearance', refresh);
    return () => document.removeEventListener('aml:appearance', refresh);
  }, [groups]);
  useEffect(() => {
    if (currentLayout.current.network === network && currentLayout.current.positions === positions && currentLayout.current.timePlan === timePlan) return;
    currentLayout.current = { network, positions, timePlan };
    fitPending.current = true;
    setData(previous => simulationData(network, positions, timePlan, previous));
  }, [network, positions, timePlan]);
  const ready = size.width > 0 && size.height > 0;
  useEffect(() => {
    const engine = graph.current;
    if (!ready || !engine) return;
    const link = engine.d3Force('link');
    if (link && originalLink.current?.engine !== engine) originalLink.current = { engine, strength: link.strength() };
    engine.d3Force('center')?.strength(timePlan ? 0 : 1);
    if (timePlan) {
      engine.d3Force('charge')?.strength(0);
      link?.strength(0);
      engine.d3Force('gravity', null);
      engine.d3Force('pattern-home', patternHomeForce());
      engine.d3ReheatSimulation();
      // Nodes already start at their time positions. Fit before the force engine finishes its cooldown.
      const frame = requestAnimationFrame(() => {
        if (fitPending.current && fit(0)) fitPending.current = false;
      });
      return () => cancelAnimationFrame(frame);
    } else {
      if (originalLink.current?.strength) link?.strength(originalLink.current.strength);
      engine.d3Force('pattern-home', null);
      configureDevAccountForces(engine);
    }
  }, [ready, data, timePlan]);

  const visibleNodes = new Map(visible.nodes.map(node => [node.id, node]));
  const visibleEdges = new Map(visible.edges.map(edge => [edge.id, edge]));
  function fit(duration = reducedMotion ? 0 : 220) {
    const engine = graph.current;
    if (!engine || !visibleNodes.size) return false;
    if (!timePlan) {
      engine.zoomToFit(duration, 44, node => visibleNodes.has(node.id));
      return true;
    }
    const bounds = engine.getGraphBbox(node => visibleNodes.has(node.id));
    if (!bounds) return false;
    const left = Math.min(bounds.x[0], timePlan.ticks[0].x);
    const right = Math.max(bounds.x[1], timePlan.ticks.at(-1).x);
    const [top, bottom] = bounds.y;
    const scale = Math.max(.12, Math.min(5, (size.width - 144) / Math.max(right - left, 1),
      (size.height - 118) / Math.max(bottom - top, 1)));
    engine.centerAt((left + right) / 2, (top + bottom) / 2 - axisDesign.inset / (2 * scale), duration);
    engine.zoom(scale, duration);
    return true;
  }
  const coordinates = () => new Map(data.nodes.map(node => [node.id, node]));
  let drawing;
  useLayoutEffect(() => registerGraphSnapshot(host.current, () => {
    const engine = graph.current;
    if (!engine || !ready || !visible.nodes.length) return null;
    const detail = graphGeometry(coordinates(), visible, groups, colors, selection, highlightedCase,
      (x, y) => engine.graph2ScreenCoords(x, y), engine.zoom(), showDetails, ownerView, engine.zoom(), contextDesign);
    const markers = detail.edges.flatMap(edge => edgeMarkers(edge,
      { pixel: 1, design: markerDesign, shapes, colors, highlight: highlightedCase, dense }));
    const nodes = detail.nodes.map(node => ({ ...node, badgeHeight: markerDesign.badgeHeight }));
    const snapshot = makeGraphSnapshot({ ...size, ...detail, nodes, markers });
    if (timePlan) addTimeAxisSnapshot(snapshot, timeAxisMarks(timePlan, engine, size, axisDesign), colors);
    return snapshot;
  }));

  return <Box ref={host} className="preview-evidence-canvas" data-force-graph=""
    data-graph-layout={positions ? 'account' : 'gravity'} data-time-axis={timePlan ? 'hop' : undefined} role="group"
    aria-label={timePlan ? '홉-시간순 관계 그래프 · 가로는 돈이 출발한 계좌에서 건너간 횟수 · 같은 홉 안에서는 위가 이른 시각'
      : ownerView ? '소유주 관계 그래프' : '계좌 관계 그래프'}>
    {ready && <ForceGraph2D ref={graph} width={size.width} height={size.height} graphData={data}
      autoPauseRedraw={!activeFlow && !flowing}
      cooldownTime={4000} cooldownTicks={timePlan ? 96 : positions ? 1 : undefined}
      d3VelocityDecay={timePlan ? patternVelocityDecay : .4} backgroundColor="transparent" minZoom={.12} maxZoom={12}
      nodeVisibility={node => visibleNodes.has(node.id)} linkVisibility={link => visibleEdges.has(link.id)}
      nodeRelSize={1} nodeLabel={node => {
        const time = timePlan?.first.get(node.id);
        const hop = timePlan?.hops.get(node.id);
        const entry = visibleNodes.get(node.id);
        const role = entry && contextOnly(entry) ? ` · ${transactionRoleLabels.context}에만 나오는 계좌` : '';
        return <Text as="span">{node.id}{hop === undefined ? '' : ` · 홉 ${hop}`}{time === undefined ? '' : ` · 첫 거래 ${timePlan.formatTime(time)} KST`}{role}</Text>;
      }}
      linkLabel={link => {
        const edge = visibleEdges.get(link.id);
        if (!edge) return '';
        const roles = edge.contextCodes?.size ? ` · ${transactionRoleLabels.subject} ${edge.codes.size - edge.contextCodes.size}건`
          + ` · ${transactionRoleLabels.context} ${edge.contextCodes.size}건` : '';
        const direction = `${edge.source} → ${edge.target} · ${graphVerdictLabels[graphVerdict(edge.verdicts)]}${roles}`;
        const times = [...edge.codes].map(code => timePlan?.byCode.get(code)).filter(Number.isFinite);
        if (!times.length) return <Text as="span">{direction}</Text>;
        const first = Math.min(...times);
        const last = Math.max(...times);
        return <Text as="span">{direction} · {timePlan.formatTime(first)}{first !== last && ` ~ ${timePlan.formatTime(last)}`} KST</Text>;
      }}
      nodeVal={node => Math.pow(radius(visibleNodes.get(node.id) ?? { codes: new Set() }), 2)}
      nodePointerAreaPaint={(node, color, context, scale) => {
        const entry = visibleNodes.get(node.id);
        if (!entry || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
        context.fillStyle = color;
        context.beginPath();
        context.arc(node.x, node.y, renderedRadius(entry, scale) + 4 / scale, 0, 2 * Math.PI);
        context.fill();
      }}
      linkPointerAreaPaint={(link, color, context, scale) => {
        const edge = visibleEdges.get(link.id);
        const source = visibleNodes.get(edge?.source);
        const target = visibleNodes.get(edge?.target);
        if (!source || !target || !Number.isFinite(link.source.x) || !Number.isFinite(link.target.x)) return;
        const a = { ...link.source, r: renderedRadius(source, scale) };
        const b = { ...link.target, r: renderedRadius(target, scale) };
        const { path } = edgeShape(a, b, visibleEdges.has(`${b.id}>${a.id}`));
        context.strokeStyle = color;
        context.lineWidth = 12 / scale;
        context.stroke(new Path2D(path));
      }}
      onNodeClick={node => onNodeSelect(node.id)} onLinkClick={link => onSelect(link.id)}
      onBackgroundClick={() => onSelect(undefined)}
      onNodeDrag={() => { fitPending.current = false; }}
      onNodeDragEnd={node => {
        if (node.home) {
          if (reducedMotion) Object.assign(node, node.home, { vx: 0, vy: 0 });
          graph.current?.d3ReheatSimulation();
        } else if (positions) {
          node.fx = node.x;
          node.fy = node.y;
        }
      }}
      onZoom={({ k }) => queueMicrotask(() => setZoom(Math.round(k * 100)))}
      onEngineStop={() => { if (fitPending.current) { fitPending.current = false; fit(); } }}
      onRenderFramePre={(context, scale) => {
        if (timePlan && graph.current) drawTimeAxis(context, graph.current, scale,
          timeAxisMarks(timePlan, graph.current, size, axisDesign), colors, false);
        const model = graphGeometry(coordinates(), visible, groups, colors, selection, highlightedCase,
          (x, y) => ({ x, y }), 1, showDetails, ownerView, scale, contextDesign);
        drawing = { nodes: new Map(model.nodes.map(node => [node.id, node])),
          edges: new Map(model.edges.map(edge => [edge.id, edge])) };
        const reveal = activeFlow ? (performance.now() - activeFlow.startedAt) / pulseDesign.revealDuration : 1;
        const growing = reveal >= 0 && reveal < 1 && model.edges.find(edge => {
          const codes = visibleEdges.get(edge.id)?.codes;
          return codes?.size === 1 && codes.has(activeFlow.code);
        });
        if (growing) drawing.edges.set(growing.id, revealedEdge(growing, reveal));
        drawing.growing = growing?.id;
        drawing.elapsed = flowing ? (performance.now() - flowStart) / 1000 : undefined;
        context.font = `${11 / scale}px Pretendard`;
      }}
      onRenderFramePost={(context, scale) => {
        if (timePlan && graph.current) drawTimeAxis(context, graph.current, scale,
          timeAxisMarks(timePlan, graph.current, size, axisDesign), colors, true);
      }}
      linkCanvasObjectMode={() => 'replace'} linkCanvasObject={(link, context, scale) => {
        const edge = drawing?.edges.get(link.id);
        if (!edge) return;
        paintLine(context, edge);
        if (drawing.growing !== link.id) {
          for (const marker of edgeMarkers(edge, { pixel: 1 / scale, design: markerDesign, elapsed: drawing.elapsed,
            shapes, colors, highlight: highlightedCase, dense })) paintMarker(context, marker);
        }
        if (activeFlow && visibleEdges.get(link.id).codes.has(activeFlow.code)) {
          paintFlow(context, edge, activeFlow, colors[activeFlow.risk] ?? edge.stroke, colors.flowHighlight, scale, pulseDesign);
        }
        if (!edge.text) return;
        context.font = `${11 / scale}px Pretendard`;
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        context.fillStyle = edge.textColor;
        context.fillText(edge.text, edge.x, edge.y - 4 / scale);
      }}
      nodeCanvasObject={(node, context, scale) => {
        const dot = drawing?.nodes.get(node.id);
        if (!dot) return;
        context.beginPath();
        context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        context.fillStyle = dot.fill;
        context.fill();
        if (dot.outline) { context.strokeStyle = dot.outline; context.lineWidth = dot.outlineWidth; context.stroke(); }
        if (dot.stroke) { context.strokeStyle = dot.stroke; context.lineWidth = 2 / scale; context.stroke(); }
        if (dot.ring) paintSharedNode(context, dot, 1 / scale, markerDesign.badgeHeight);
        if (!dot.text) return;
        context.font = `${11 / scale}px Pretendard`;
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillStyle = dot.textColor;
        context.fillText(dot.text, dot.x, dot.y + dot.r + 4 / scale);
      }} />}
    {controlsHost && createPortal(<GraphZoomControls zoom={zoom} onFit={() => fit()}
      onZoom={factor => graph.current?.zoom(graph.current.zoom() * factor, 180)} />, controlsHost)}
  </Box>;
}
