import React, { useMemo, useRef, useState } from 'react';
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
      return <text key={link.index} textAnchor="end" x={x} y={y} dy={offsets.label}>{link.caption}</text>;
    })}
  </g>;
}

function TooltipValue({ title, count, unit, note }) {
  return <TooltipContent title={title}>
    <Text tone="muted">{[countLabel(count, unit), note].filter(Boolean).join(' · ')}</Text>
  </TooltipContent>;
}

export function StagedSankey({ data, stages, label, reduced, fill = false }) {
  const scrollerRef = useRef(null);
  const layout = useMemo(() => layoutFor(stages.length), [stages.length]);
  const [design] = useState(() => {
    const inset = readChartNumber('--aml-space-8', 8);
    return {
      margin: { left: inset, right: fill ? readChartNumber('--chart-sankey-compact-label-reserve', 128)
        : readChartNumber('--chart-sankey-stage-label-reserve', 174), top: inset, bottom: inset },
      nodeWidth: readChartNumber('--aml-space-10', 10),
      nodePadding: readChartNumber('--chart-sankey-stage-node-gap', 15),
      linkOpacity: readChartNumber('--chart-sankey-link-opacity', 0.3),
    };
  });
  return <Box ref={scrollerRef} className="staged-sankey-scroller" data-panel-fill={fill || undefined}>
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
