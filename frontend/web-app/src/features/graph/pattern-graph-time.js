import { readChartFontFamily, readChartNumber } from '@/components/charts/chart-design-values';

export const graphTimeStep = 120;
const sameTimeGap = 42;
const clockFormat = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

export function readGraphTimeAxisDesign() {
  return {
    inset: readChartNumber('--case-graph-time-axis-inset', 28),
    stroke: readChartNumber('--aml-stroke-divider', 1),
    labelGap: readChartNumber('--aml-space-8', 8),
    labelPadding: readChartNumber('--aml-space-12', 12),
    estimatedLatinWidth: readChartNumber('--case-graph-time-label-latin-width', 7),
    estimatedWideWidth: readChartNumber('--case-graph-time-label-wide-width', 11),
    pill: {
      top: readChartNumber('--case-graph-time-pill-top', 5),
      height: readChartNumber('--case-graph-time-pill-height', 18),
      radius: readChartNumber('--case-graph-time-pill-radius', 9),
      textY: readChartNumber('--case-graph-time-pill-baseline', 17),
      fontSize: readChartNumber('--case-graph-time-pill-font-size', 11),
      fontFamily: readChartFontFamily(),
    },
  };
}

function graphTimePillWidth(label, design) {
  return [...label].reduce((width, character) =>
    width + (character.codePointAt(0) <= 127 ? design.estimatedLatinWidth : design.estimatedWideWidth), design.labelPadding);
}

export function projectGraphTimeTicks(ticks, toViewportX, width, design) {
  let lastLabel = 0;
  return ticks.flatMap(({ x, label }) => {
    const projected = toViewportX(x);
    if (projected < 0 || projected > width) return [];
    const pillWidth = graphTimePillWidth(label, design);
    const right = projected + pillWidth / 2;
    const showLabel = projected - pillWidth / 2 >= lastLabel && right <= width;
    if (showLabel) lastLabel = right + design.labelGap;
    return [{ x: projected, label: showLabel ? label : undefined, pillWidth }];
  });
}

export function transactionTime(timestamp) {
  if (typeof timestamp !== 'string') return NaN;
  const value = timestamp.trim().replace(/ KST$/, '');
  const local = clockFormat.test(value);
  if (!local && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return NaN;
  return Date.parse(value.replace(' ', 'T') + (local ? '+09:00' : ''));
}

export function graphTimeFormatter(times) {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(new Set(times.map(time => new Date(time + 9 * 3600000).getUTCFullYear())).size > 1 ? { year: 'numeric' } : {}),
    ...(times.some(time => time % 60000 !== 0) ? { second: '2-digit' } : {}),
  });
  return time => format.format(time).replace(',', '');
}

export function buildPatternTime(records, nodes, patternPositions) {
  const byCode = new Map();
  const first = new Map();
  for (const row of records) {
    const time = transactionTime(row.timestamp);
    if (!Number.isFinite(time)) continue;
    byCode.set(row.code, time);
    for (const account of [row.from.code, row.to.code]) {
      first.set(account, Math.min(first.get(account) ?? time, time));
    }
  }
  const times = [...new Set(byCode.values())].sort((left, right) => left - right);
  if (!times.length) return undefined;

  const formatTime = graphTimeFormatter(times);
  const ticks = times.map((time, index) => ({ x: index * graphTimeStep, label: formatTime(time) }));
  const columns = new Map(times.map((time, index) => [time, index * graphTimeStep]));
  const homes = new Map();
  const buckets = Map.groupBy(nodes, ({ id }) => first.get(id));
  for (const [time, accounts] of buckets) {
    const x = columns.get(time) ?? ticks.length * graphTimeStep;
    const preferredY = id => (patternPositions?.[id]?.y ?? 0) * .44;
    const ordered = accounts.sort((left, right) => preferredY(left.id) - preferredY(right.id) || left.id.localeCompare(right.id));
    const ys = [];
    for (const { id } of ordered) {
      const preferred = preferredY(id);
      ys.push(ys.length ? Math.max(ys.at(-1) + sameTimeGap, preferred) : preferred);
    }
    const offset = ordered.reduce((sum, { id }, index) => sum + ys[index] - preferredY(id), 0) / ordered.length;
    ordered.forEach(({ id }, index) => homes.set(id, { x, y: ys[index] - offset }));
  }
  if (buckets.has(undefined)) ticks.push({ x: ticks.length * graphTimeStep, label: '시각 없음' });
  return { byCode, first, ticks, homes, formatTime };
}

// D3 integrates velocity after each force iteration. This pair crosses the
// target once or more, then settles during the 96-tick reheated simulation.
export const patternVelocityDecay = .25;
export function patternHomeForce() {
  let nodes = [];
  return Object.assign(() => {
    for (const node of nodes) {
      if (!node.home) continue;
      if (node.fx == null) node.vx = (node.vx ?? 0) + (node.home.x - node.x) * .14;
      if (node.fy == null) node.vy = (node.vy ?? 0) + (node.home.y - node.y) * .14;
    }
  }, { initialize: next => { nodes = next; } });
}
