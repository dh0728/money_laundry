import React, { useEffect, useMemo, useState } from 'react';
import { sankey } from 'd3-sankey';
import { Box, Text } from '@/components/layout-primitives';
import { SankeyChart } from './sankey-chart';
import { useSankey } from './sankey-context';
import { SankeyLink } from './sankey-link';
import { SankeyNode } from './sankey-node';
import { SankeyTooltip } from './sankey-tooltip';

const formatCount = new Intl.NumberFormat('ko-KR');
const countLabel = (count, unit = '건') => count == null ? '' : formatCount.format(count) + unit;
const margin = { left: 8, right: 174, top: 8, bottom: 8 };
const nodeWidth = 10;
const nodePadding = 15;
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
  return <g className="staged-sankey-labels" aria-hidden="true">
    {nodes.map(node => {
      const x = node.x1 + 8;
      const y = (node.y0 + node.y1) / 2;
      return <g key={node.index}>
        {node.anchor && <circle data-sankey-anchor={node.anchor} cx={(node.x0 + node.x1) / 2}
          cy={node.y1} r={1} opacity={0} />}
        <text x={x} y={y} dy={node.detail ? '-.15em' : '.34em'}>
          {node.name}
          <tspan dx={6}>{[countLabel(node.count, node.unit), node.ratio].filter(Boolean).join(' · ')}</tspan>
          {node.detail && <tspan x={x} dy="1.15em">{node.detail}</tspan>}
        </text>
      </g>;
    })}
    {links.filter(link => link.caption).map(link => <text key={link.index} textAnchor="end"
      x={link.target.x0 - 9} y={(link.y0 + link.y1) / 2} dy=".34em">{link.caption}</text>)}
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
  return <Box className="staged-sankey-scroller">
    <Box className="staged-sankey-content">
      <Box className="staged-sankey-stages" data-stage-count={stages.length}>
        {stages.map(name => <Text as="span" key={name}>{name}</Text>)}
      </Box>
      <SankeyChart data={data} layout={layout} margin={margin} className="staged-sankey-chart"
        nodeWidth={nodeWidth} nodePadding={nodePadding} animationDuration={reduced ? 0 : undefined} interactionLabel={label}>
        <SankeyLink reveal={!reduced} useGradient={false} strokeOpacity={0.3} getLinkColor={link => link.color ?? link.target.color} />
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
    const measure = () => {
      const origin = host.getBoundingClientRect();
      const chartBottom = chart.getBoundingClientRect().bottom - origin.top;
      const next = relations.flatMap(({ id, tone }) => {
        const anchor = chart.querySelector(`[data-sankey-anchor="${id}"]`);
        const target = host.querySelector(`[data-sankey-detail="${id}"]`);
        if (!anchor || !target) return [];
        const start = anchor.getBoundingClientRect();
        const end = target.getBoundingClientRect();
        const startX = start.left + start.width / 2 - origin.left;
        const startY = start.top + start.height / 2 - origin.top;
        const endX = Math.min(Math.max(startX, end.left - origin.left + 18), end.right - origin.left - 18);
        const endY = end.top - origin.top;
        const turnY = (chartBottom + endY) / 2;
        return [{ id, tone, endX, endY, path: `M ${startX} ${startY} V ${chartBottom} C ${startX} ${turnY}, ${endX} ${turnY}, ${endX} ${endY}` }];
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
    {lines.map(({ id, tone, path, endX, endY }) => <g key={id} data-tone={tone}>
      <path d={path} />
      <circle cx={endX} cy={endY} r={2.5} />
    </g>)}
  </svg>;
}
