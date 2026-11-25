import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sankey } from 'd3-sankey';
import { Box, Text } from '@/components/layout-primitives';
import { SankeyChart } from './sankey-chart';
import { useSankey } from './sankey-context';
import { SankeyLink } from './sankey-link';
import { SankeyNode } from './sankey-node';
import { SankeyTooltip } from './sankey-tooltip';
import { TooltipContent } from '../tooltip/tooltip-content';
import { readChartNumber } from '../../chart-design-values';

const formatCount = new Intl.NumberFormat('ko-KR');
const countLabel = (count, unit = '건') => count == null ? '' : formatCount.format(count) + unit;
const nodeColor = node => node.color;

function layoutFor(stages) {
  return (data, size) => {
    const nodes = data.nodes.map(node => ({ ...node }));
    const links = data.links.map(link => ({ ...link, value: link.weight ?? link.count }));
    // Preserve the stages even when some branches have no activity in the selected period.
    for (let stage = 0; stage < stages; stage++) {
      const index = nodes.length;
      nodes.push({ stage, ghost: true });
      if (stage > 0) links.push({ source: index - 1, target: index, value: 0, ghost: true });
    }
    const result = sankey().nodeAlign(node => node.stage).nodeSort(null).linkSort(null)
      .nodeWidth(size.nodeWidth).nodePadding(size.nodePadding)
      .extent([[0, 0], [size.width, size.height]])({ nodes, links });
    return {
      nodes: result.nodes.filter(node => !node.ghost),
      links: result.links.filter(link => !link.ghost).map(link => ({ ...link, value: link.count })),
    };
  };
}

function Labels() {
  const { nodes, links } = useSankey();
  const [offsets] = useState(() => ({
    label: `${readChartNumber('--chart-sankey-label-offset', 0.34)}em`,
    labelWithDetail: `${readChartNumber('--chart-sankey-label-with-detail-offset', -0.15)}em`,
    detail: `${readChartNumber('--chart-sankey-detail-offset', 1.15)}em`,
    nodeInset: readChartNumber('--aml-space-8', 8),
    countInset: readChartNumber('--aml-space-6', 6),
    linkCaptionInset: readChartNumber('--chart-sankey-link-caption-inset', 9),
  }));
  return <g className="staged-sankey-labels" aria-hidden="true">
    {nodes.map(node => {
      const x = node.x1 + offsets.nodeInset;
      const y = (node.y0 + node.y1) / 2;
      return <g key={node.index}>
        {node.anchor && <>
          <circle data-sankey-anchor={node.anchor} cx={(node.x0 + node.x1) / 2} cy={node.y1} opacity={0} />
          <circle data-sankey-top-anchor={node.anchor} cx={(node.x0 + node.x1) / 2} cy={node.y0} opacity={0} />
        </>}
        <text x={x} y={y} dy={node.detail ? offsets.labelWithDetail : offsets.label}>
          {node.name}
          <tspan dx={offsets.countInset}>{[countLabel(node.count, node.unit), node.ratio].filter(Boolean).join(' · ')}</tspan>
          {node.detail && <tspan x={x} dy={offsets.detail}>{node.detail}</tspan>}
        </text>
      </g>;
    })}
    {links.filter(link => link.caption).map(link => {
      const x = link.target.x0 - offsets.linkCaptionInset;
      const y = (link.y0 + link.y1) / 2;
      return <g key={link.index}>
        <text textAnchor="end" x={x} y={y} dy={offsets.label}>{link.caption}</text>
        {link.anchor && <circle data-sankey-top-anchor={link.anchor} data-sankey-anchor={link.anchor} cx={x} cy={y} opacity={0} />}
      </g>;
    })}
  </g>;
}

function TooltipValue({ title, count, unit, note }) {
  return <TooltipContent title={title}>
    <Text tone="muted">{[countLabel(count, unit), note].filter(Boolean).join(' · ')}</Text>
  </TooltipContent>;
}

export function StagedSankey({ data, stages, label, reduced }) {
  const scrollerRef = useRef(null);
  const layout = useMemo(() => layoutFor(stages.length), [stages.length]);
  const [design] = useState(() => {
    const inset = readChartNumber('--aml-space-8', 8);
    return {
      margin: { left: inset, right: readChartNumber('--chart-sankey-stage-label-reserve', 174), top: inset, bottom: inset },
      nodeWidth: readChartNumber('--aml-space-10', 10),
      nodePadding: readChartNumber('--chart-sankey-stage-node-gap', 15),
      linkOpacity: readChartNumber('--chart-sankey-link-opacity', 0.3),
    };
  });
  return <Box ref={scrollerRef} className="staged-sankey-scroller">
    <Box className="staged-sankey-content">
      <Box className="staged-sankey-stages" data-stage-count={stages.length}>
        {stages.map(name => <Text as="span" key={name}>{name}</Text>)}
      </Box>
      <SankeyChart data={data} layout={layout} margin={design.margin} className="staged-sankey-chart"
        nodeWidth={design.nodeWidth} nodePadding={design.nodePadding} animationDuration={reduced ? 0 : undefined} interactionLabel={label}>
        <SankeyLink reveal={!reduced} useGradient={false} strokeOpacity={design.linkOpacity} getLinkColor={link => link.color ?? link.target.color} />
        <SankeyNode showLabels={false} showValueLabels={false} getNodeColor={nodeColor} />
        <Labels />
        <SankeyTooltip horizontalViewportRef={scrollerRef} entrance={!reduced} exit={!reduced}
          nodeContent={({ node }) => <TooltipValue title={node.name} count={node.count} unit={node.unit} note={node.detail ?? node.ratio} />}
          linkContent={({ link }) => <TooltipValue title={link.source.name + ' → ' + link.target.name} count={link.count}
            unit={link.unit} note={link.note} />} />
      </SankeyChart>
    </Box>
  </Box>;
}

function RelationPaths({ lines, metrics }) {
  return <svg className="staged-sankey-relations" data-metric-relations={metrics || undefined} aria-hidden="true">
    {lines.map(({ id, tone, partial, path, startX, startY, endX, endY }) =>
      <g key={id} data-tone={tone} data-relation={id} data-partial={partial || undefined}>
        <path d={path} />
        {metrics && <circle cx={startX} cy={startY} />}
        <circle cx={endX} cy={endY} />
      </g>)}
  </svg>;
}

function metricRelation(value, mark, origin, { id, partial }) {
  const card = value?.closest('article');
  if (!card || !mark) return [];

  const sourceBounds = value.getBoundingClientRect();
  const targetBounds = mark.getBoundingClientRect();
  const plot = mark.closest('.staged-sankey-scroller')?.getBoundingClientRect();
  const center = targetBounds.left + targetBounds.width / 2;
  if (plot && (center < plot.left || center > plot.right)) return [];

  const startX = sourceBounds.left + sourceBounds.width / 2 - origin.left;
  const cardBounds = card.getBoundingClientRect();
  const startY = (targetBounds.bottom <= cardBounds.top ? cardBounds.top : cardBounds.bottom) - origin.top;
  const endX = center - origin.left;
  const endY = targetBounds.top + (plot ? targetBounds.height / 2 : 0) - origin.top;
  const turnY = startY + (endY - startY) / 2;
  const path = `M ${startX} ${startY} C ${startX} ${turnY}, ${endX} ${turnY}, ${endX} ${endY}`;
  return [{ id, partial, startX, startY, endX, endY, path }];
}

function MetricDetailsLinks({ hostRef, routes }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let frame;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const origin = host.getBoundingClientRect();
        const next = routes.flatMap(route => {
          const value = host.querySelector(route.source);
          const mark = host.querySelector(route.target);
          if (value) sizes.observe(value);
          if (mark) sizes.observe(mark.ownerSVGElement ?? mark);
          return metricRelation(value, mark, origin, route);
        });
        setLines(previous => previous.length === next.length && previous.every((line, index) =>
          line.id === next[index].id && line.path === next[index].path) ? previous : next);
      });
    };
    const sizes = new ResizeObserver(schedule);
    const marks = new MutationObserver(records => {
      if (records.some(record => !record.target.closest?.('.staged-sankey-relations'))) schedule();
    });
    sizes.observe(host);
    marks.observe(host, { childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['cx', 'cy', 'width', 'height', 'viewBox', 'transform', 'data-dashboard-metric-source', 'data-dashboard-metric-target'] });
    host.addEventListener('scroll', schedule, { capture: true, passive: true });
    schedule();
    return () => {
      sizes.disconnect();
      marks.disconnect();
      host.removeEventListener('scroll', schedule, true);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [hostRef, routes]);
  return <RelationPaths lines={lines} metrics />;
}

function ChartDetailsLinks({ hostRef, relations }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const host = hostRef.current;
    const chart = host?.querySelector('.staged-sankey-scroller');
    if (!chart) return undefined;
    const measure = () => {
      const origin = host.getBoundingClientRect();
      const chartBounds = chart.getBoundingClientRect();
      const next = relations.flatMap(({ id, source = id, tone }) => {
        const target = host.querySelector(`[data-sankey-detail="${id}"]`);
        if (!target) return [];
        const end = target.getBoundingClientRect();
        const aboveChart = end.bottom <= chartBounds.top;
        const anchor = chart.querySelector(aboveChart ? `[data-sankey-top-anchor="${source}"]` : `[data-sankey-anchor="${source}"]`);
        if (!anchor) return [];
        const start = anchor.getBoundingClientRect();
        const startX = start.left + start.width / 2 - origin.left;
        const startY = start.top + start.height / 2 - origin.top;
        const endX = end.left + end.width / 2 - origin.left;
        const endY = (aboveChart ? end.bottom : end.top) - origin.top;
        const turnY = startY + (endY - startY) / (aboveChart ? 4 : 2);
        return [{ id, tone, endX, endY, path: `M ${startX} ${startY} C ${startX} ${turnY}, ${endX} ${turnY}, ${endX} ${endY}` }];
      });
      setLines(next);
    };
    const sizes = new ResizeObserver(measure);
    const marks = new MutationObserver(measure);
    sizes.observe(host);
    sizes.observe(chart);
    marks.observe(chart, { childList: true, subtree: true });
    chart.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      sizes.disconnect();
      marks.disconnect();
      chart.removeEventListener('scroll', measure);
    };
  }, [hostRef, relations]);
  return <RelationPaths lines={lines} />;
}

export function SankeyDetailsLinks({ hostRef, relations, routes }) {
  return routes ? <MetricDetailsLinks hostRef={hostRef} routes={routes} /> : <ChartDetailsLinks hostRef={hostRef} relations={relations} />;
}
