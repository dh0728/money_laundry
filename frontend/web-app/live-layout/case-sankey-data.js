import { sankeyLinkHorizontal } from 'd3-sankey';
import { graphPartyId, graphRiskBand } from './case-graph-scope';

function addAmount(totals, currency, amount) {
  if (currency && Number.isFinite(amount) && amount >= 0) {
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
}

export function caseSankeyGraph(rows, ownerView = false) {
  const nodes = [];
  const links = new Map();
  const indices = new Map();
  const seen = new Set();
  function indexFor(party) {
    const name = graphPartyId(party, ownerView);
    if (!indices.has(name)) {
      indices.set(name, nodes.length);
      nodes.push({ name, incoming: new Map(), outgoing: new Map() });
    }
    return indices.get(name);
  }
  for (const { code, currency, amount, from, to, score, verdict } of rows) {
    if (!from?.code || !to?.code || seen.has(code)) continue;
    seen.add(code);
    const source = indexFor(from);
    const target = indexFor(to);
    const key = `${source}:${target}`;
    const link = links.get(key) ?? { source, target, value: 0, codes: new Set(), amounts: new Map(), verdicts: new Set() };
    link.value += 1;
    link.codes.add(code);
    link.verdicts.add(verdict);
    addAmount(link.amounts, currency, amount);
    addAmount(nodes[source].outgoing, currency, amount);
    addAmount(nodes[target].incoming, currency, amount);
    if (graphRiskBand(score) !== 'unknown') {
      for (const entry of [link, nodes[source], nodes[target]]) {
        entry.peakScore = Math.max(entry.peakScore ?? score, score);
      }
    }
    links.set(key, link);
  }
  return { nodes, links: [...links.values()] };
}

function reaches(outgoing, start, end) {
  const remaining = [start];
  const seen = new Set();
  while (remaining.length) {
    const node = remaining.pop();
    if (node === end) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    remaining.push(...outgoing[node]);
  }
  return false;
}

export function caseSankeyLayers({ nodes, links }) {
  const forward = nodes.map(() => []);
  const indegree = nodes.map(() => 0);
  const returnLinks = new Set();
  // Allocate forward space to the busiest routes first. Keep links that would
  // introduce a cycle as return ribbons between the same account nodes.
  for (const link of links.toSorted((a, b) => b.value - a.value)) {
    if (reaches(forward, link.target, link.source)) {
      returnLinks.add(link);
    } else {
      forward[link.source].push(link.target);
      indegree[link.target]++;
    }
  }
  const ranks = nodes.map(() => 0);
  const remaining = ranks.flatMap((_, index) => indegree[index] === 0 ? [index] : []);
  for (const source of remaining) {
    for (const target of forward[source]) {
      ranks[target] = Math.max(ranks[target], ranks[source] + 1);
      if (--indegree[target] === 0) remaining.push(target);
    }
  }
  const layers = Array.from({ length: Math.max(0, ...ranks) + 1 }, () => []);
  ranks.forEach((rank, index) => layers[rank].push(index));
  return { layers, returnLinks };
}

export function layoutCaseSankey(data, { width, height, nodeWidth, nodePadding }) {
  const { layers, returnLinks } = caseSankeyLayers(data);
  const nodes = data.nodes.map((node, index) => ({ ...node, index, sourceLinks: [], targetLinks: [] }));
  const links = data.links.map((link, index) => {
    const edge = { ...link, index, source: nodes[link.source], target: nodes[link.target] };
    edge.source.sourceLinks.push(edge);
    edge.target.targetLinks.push(edge);
    return edge;
  });
  const total = ribbons => ribbons.reduce((sum, { value }) => sum + value, 0);
  for (const node of nodes) node.value = Math.max(total(node.sourceLinks), total(node.targetLinks));

  const spaceForReturn = returnLinks.size ? Math.min(height * .45, 24 + returnLinks.size * 20) : 0;
  const usableHeight = height - spaceForReturn;
  const gap = Math.min(nodePadding, usableHeight / (2 * Math.max(...layers.map(layer => layer.length))));
  const fits = layers.map(layer => (usableHeight - (layer.length - 1) * gap) / layer.reduce((sum, index) => sum + nodes[index].value, 0));
  const returnTotal = total([...returnLinks]);
  const pixelsPerTransfer = Math.min(16, ...fits, returnTotal ? spaceForReturn * .72 / returnTotal : Infinity);
  const loopShoulder = returnLinks.size ? Math.min(width * .14, 20) : 0;
  const span = Math.max(0, width - nodeWidth - 2 * loopShoulder);
  layers.forEach((layer, layerIndex) => {
    const heightSum = layer.reduce((sum, index) => sum + nodes[index].value * pixelsPerTransfer, 0);
    const x0 = loopShoulder + (layers.length > 1 ? layerIndex * span / (layers.length - 1) : span / 2);
    let top = spaceForReturn + (usableHeight - heightSum - (layer.length - 1) * gap) / 2;
    for (const index of layer) {
      const node = nodes[index];
      const y1 = top + node.value * pixelsPerTransfer;
      Object.assign(node, { x0, x1: x0 + nodeWidth, y0: top, y1, layer: layerIndex });
      top = y1 + gap;
    }
  });

  const assignPorts = (node, ribbons, otherSide, port) => {
    const sorted = ribbons.toSorted((a, b) => a[otherSide].y0 - b[otherSide].y0);
    let offset = node.y0 + (node.value - total(ribbons)) * pixelsPerTransfer / 2;
    for (const link of sorted) {
      link[port] = offset + link.width / 2;
      offset += link.width;
    }
  };
  for (const link of links) link.width = link.value * pixelsPerTransfer;
  for (const node of nodes) {
    assignPorts(node, node.sourceLinks, 'target', 'y0');
    assignPorts(node, node.targetLinks, 'source', 'y1');
  }
  const returnGap = (spaceForReturn - returnTotal * pixelsPerTransfer) / (returnLinks.size + 1);
  let returnTop = returnGap;
  for (const [index, link] of links.entries()) {
    if (!returnLinks.has(data.links[index])) continue;
    link.returnY = returnTop + link.width / 2;
    returnTop += link.width + returnGap;
  }
  return { nodes, links };
}

const horizontal = sankeyLinkHorizontal();
export function caseSankeyPath(link) {
  if (link.returnY === undefined) return horizontal(link) ?? '';
  const { source, target, y0, y1, returnY } = link;
  const bend = 16;
  return `M ${source.x1} ${y0} C ${source.x1 + bend} ${y0}, ${source.x1 + bend} ${returnY}, ${source.x1} ${returnY} H ${target.x0} C ${target.x0 - bend} ${returnY}, ${target.x0 - bend} ${y1}, ${target.x0} ${y1}`;
}
