import React, { useEffect, useMemo, useState } from 'react';
import { sankey } from 'd3-sankey';
import { Box, Text } from '@/components/layout-primitives';
import { SankeyChart } from './sankey-chart';
import { useSankey } from './sankey-context';
import { SankeyLink } from './sankey-link';
import { SankeyNode } from './sankey-node';
import { SankeyTooltip } from './sankey-tooltip';
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
          <circle data-sankey-top-anchor={node.anchor} data-sankey-stage-index={node.stage}
            cx={(node.x0 + node.x1) / 2} cy={node.y0} opacity={0} />
        </>}
        <text x={x} y={y} dy={node.detail ? offsets.labelWithDetail : offsets.label}>
          {node.name}
          <tspan dx={offsets.countInset}>{[countLabel(node.count, node.unit), node.ratio].filter(Boolean).join(' · ')}</tspan>
          {node.detail && <tspan x={x} dy={offsets.detail}>{node.detail}</tspan>}
        </text>
      </g>;
    })}
    {links.filter(link => link.caption).map(link => <text key={link.index} textAnchor="end"
      x={link.target.x0 - offsets.linkCaptionInset} y={(link.y0 + link.y1) / 2} dy={offsets.label}>{link.caption}</text>)}
  </g>;
}

function TooltipValue({ title, count, unit, note }) {
  return <Box>
    <Text as="strong">{title}</Text>
    <Text tone="muted">{[countLabel(count, unit), note].filter(Boolean).join(' · ')}</Text>
  </Box>;
}

export function StagedSankey({ data, stages, label, reduced }) {
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
  return <Box className="staged-sankey-scroller">
    <Box className="staged-sankey-content">
      <Box className="staged-sankey-stages" data-stage-count={stages.length}>
        {stages.map((name, index) => <Text as="span" key={name} data-sankey-stage-label={index}>{name}</Text>)}
      </Box>
      <SankeyChart data={data} layout={layout} margin={design.margin} className="staged-sankey-chart"
        nodeWidth={design.nodeWidth} nodePadding={design.nodePadding} animationDuration={reduced ? 0 : undefined} interactionLabel={label}>
        <SankeyLink reveal={!reduced} useGradient={false} strokeOpacity={design.linkOpacity} getLinkColor={link => link.color ?? link.target.color} />
        <SankeyNode showLabels={false} showValueLabels={false} getNodeColor={nodeColor} />
        <Labels />
        <SankeyTooltip entrance={!reduced} exit={!reduced}
          nodeContent={({ node }) => <TooltipValue title={node.name} count={node.count} unit={node.unit} note={node.detail ?? node.ratio} />}
          linkContent={({ link }) => <TooltipValue title={link.source.name + ' → ' + link.target.name} count={link.count}
            unit={link.unit} note={link.note} />} />
      </SankeyChart>
    </Box>
  </Box>;
}

export function SankeyDetailsLinks({ hostRef, relations }) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const host = hostRef.current;
    const chart = host?.querySelector('.staged-sankey-scroller');
    if (!chart) return undefined;
    const labelClearance = readChartNumber('--aml-space-8', 8);
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
        const header = aboveChart && chart.querySelector(`[data-sankey-stage-label="${anchor.dataset.sankeyStageIndex}"]`)?.getBoundingClientRect();
        const laneX = header ? Math.min(startX, header.left - origin.left - labelClearance) : startX;
        const laneY = header ? header.bottom - origin.top : startY;
        const leadY = (laneY + startY) / 2;
        const turnY = (laneY + endY) / 2;
        const lead = header ? ` C ${startX} ${leadY}, ${laneX} ${leadY}, ${laneX} ${laneY}` : '';
        return [{ id, tone, endX, endY, path: `M ${startX} ${startY}${lead} C ${laneX} ${turnY}, ${endX} ${turnY}, ${endX} ${endY}` }];
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
  return <svg className="staged-sankey-relations" aria-hidden="true">
    {lines.map(({ id, tone, path, endX, endY }) => <g key={id} data-tone={tone} data-relation={id}>
      <path d={path} />
      <circle cx={endX} cy={endY} />
    </g>)}
  </svg>;
}
