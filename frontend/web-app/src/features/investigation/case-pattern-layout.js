import { caseNodeSize, seedCasePositions } from '../../next/features/case-graph-layout';

const columnStep = caseNodeSize.width + 64;
const rowStep = caseNodeSize.height + 64;
const patternAliases = { 'ga-sc': 'gather-scatter', 'sc-ga': 'scatter-gather' };

function findCycle(topology) {
  const visited = new Set();
  const active = new Map();
  const path = [];
  function visit(id) {
    if (active.has(id)) return path.slice(active.get(id));
    if (visited.has(id)) return undefined;
    active.set(id, path.length);
    visited.add(id);
    path.push(id);
    for (const next of [...topology.get(id).outgoing].sort()) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(id);
    return undefined;
  }
  for (const id of topology.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}

function patternColumns(topology, pattern) {
  let best;
  let size = 0;
  for (const [id, { incoming, outgoing }] of topology) {
    const inputs = [...incoming].sort();
    const outputs = [...outgoing].sort();
    let columns;
    if (pattern === 'fan-out' && outputs.length >= 2) columns = [[id], outputs];
    if (pattern === 'fan-in' && inputs.length >= 2) columns = [inputs, [id]];
    if (pattern === 'gather-scatter') {
      const sources = inputs.filter(source => !outgoing.has(source));
      const targets = outputs.filter(target => !incoming.has(target));
      if (sources.length >= 2 && targets.length >= 2) columns = [sources, [id], targets];
    }
    if (pattern === 'scatter-gather' && outputs.length >= 2) {
      const branchesByTarget = new Map();
      for (const branch of outputs) {
        for (const target of topology.get(branch).outgoing) {
          if (target === id || outgoing.has(target)) continue;
          const branches = branchesByTarget.get(target) ?? [];
          branches.push(branch);
          branchesByTarget.set(target, branches);
        }
      }
      for (const [target, branches] of [...branchesByTarget].sort(([a], [b]) => a.localeCompare(b))) {
        if (branches.length >= 2 && (!columns || branches.length > columns[1].length)) {
          columns = [[id], branches, [target]];
        }
      }
    }
    const count = columns?.flat().length ?? 0;
    if (count > size) {
      best = columns;
      size = count;
    }
  }
  return best;
}

function placeColumns(columns) {
  const rows = Math.max(...columns.map(column => column.length));
  return new Map(columns.flatMap((column, x) => column.map((id, y) => [id, {
    x: x * columnStep,
    y: (y + (rows - column.length) / 2) * rowStep,
  }])));
}

function placeCycle(cycle) {
  // The distance between adjacent nodes exceeds their bounding-box diagonal.
  const radius = Math.hypot(columnStep, rowStep) / (2 * Math.sin(Math.PI / cycle.length));
  return new Map(cycle.map((id, index) => {
    const angle = ((2 * index) / cycle.length - 0.5) * Math.PI;
    return [id, { x: radius * (1 + Math.cos(angle)), y: radius * (1 + Math.sin(angle)) }];
  }));
}

export function arrangeCasePattern(network, pattern, baselinePositions) {
  const token = pattern?.trim().toLowerCase().replace(/\s+\d+(?:[.,]\d+)?%$/, '');
  const name = patternAliases[token] ?? token;
  if (!['fan-out', 'fan-in', 'gather-scatter', 'scatter-gather', 'cycle'].includes(name)) return undefined;
  const ids = network.nodes.map(({ id }) => id).sort();
  const topology = new Map(ids.map(id => [id, { incoming: new Set(), outgoing: new Set() }]));
  for (const { source, target } of network.edges) {
    if (source === target || !topology.has(source) || !topology.has(target)) continue;
    topology.get(source).outgoing.add(target);
    topology.get(target).incoming.add(source);
  }
  const motif = name === 'cycle' ? findCycle(topology) : patternColumns(topology, name);
  if (!motif) return undefined;
  const positions = name === 'cycle' ? placeCycle(motif) : placeColumns(motif);

  // Move the remaining ELK layout as a block to keep its existing spacing.
  const remainder = ids.filter(id => !positions.has(id));
  if (remainder.length) {
    const context = remainder.map(id => baselinePositions[id]);
    if (context.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return undefined;
    const right = Math.max(...Array.from(positions.values(), point => point.x));
    const offset = right + columnStep - Math.min(...context.map(({ x }) => x));
    remainder.forEach((id, index) => {
      const { x, y } = context[index];
      positions.set(id, { x: x + offset, y });
    });
  }
  return Object.fromEntries(positions);
}

export function caseAccountLayout(network, pattern) {
  const nodes = [...network.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const positions = arrangeCasePattern(network, pattern, seedCasePositions(nodes));
  if (positions) return { kind: 'pattern', positions };

  // Order verified relationships by their transfer direction even when a model motif is absent.
  const incoming = new Map(nodes.map(({ id }) => [id, 0]));
  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  const ranks = new Map(nodes.map(({ id }) => [id, 0]));
  for (const { source, target } of network.edges) {
    if (source === target) continue;
    incoming.set(target, incoming.get(target) + 1);
    outgoing.get(source).push(target);
  }
  const roots = nodes.map(({ id }) => id).filter(id => incoming.get(id) === 0);
  for (const id of roots) {
    for (const target of outgoing.get(id)) {
      ranks.set(target, Math.max(ranks.get(target), ranks.get(id) + 1));
      const remaining = incoming.get(target) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) roots.push(target);
    }
  }
  const tiers = Map.groupBy(nodes.map(({ id }) => id), id => ranks.get(id));
  const columns = [...tiers].sort(([a], [b]) => a - b).map(([, ids]) => ids);
  return { kind: 'direction', positions: columns.length ? Object.fromEntries(placeColumns(columns)) : {} };
}
