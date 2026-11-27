import { readChartFontFamily, readChartNumber } from '@/components/charts/chart-design-values';

export const hopStep = 160;
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

// 계좌마다 홉(돈이 처음 출발한 계좌에서 송금 방향으로 몇 번 건너왔는지)을 센다.
// 출발 계좌 = 받은 적 없이 보내기만 한 계좌(여러 개일 수 있다). 출발 계좌가 없는 순환은
// 아직 정하지 않은 계좌 중 가장 이른 거래를 보낸 계좌에서 다시 시작한다. 여러 경로로 닿으면 가장 짧은 홉.
export function accountHops(records, accountIds) {
  const accounts = new Set(accountIds);
  const outgoing = new Map();
  const received = new Set();
  for (const row of records) {
    const from = row.from.code, to = row.to.code;
    if (!accounts.has(from) || !accounts.has(to)) continue;
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(to);
    if (from !== to) received.add(to);
  }
  const hops = new Map();
  const spread = starts => {
    let frontier = starts.filter(id => !hops.has(id));
    for (const id of frontier) hops.set(id, 0);
    for (let hop = 1; frontier.length; hop++) {
      const next = [];
      for (const id of frontier) for (const target of outgoing.get(id) ?? []) {
        if (hops.has(target)) continue;
        hops.set(target, hop);
        next.push(target);
      }
      frontier = next;
    }
  };
  spread([...accounts].filter(id => !received.has(id)));
  const byTime = records.map(row => ({ row, time: transactionTime(row.timestamp) }))
    .sort((left, right) => (Number.isFinite(left.time) ? left.time : Infinity) - (Number.isFinite(right.time) ? right.time : Infinity)
      || String(left.row.code).localeCompare(String(right.row.code)));
  for (const { row } of byTime) {
    if (hops.size === accounts.size) break;
    if (!hops.has(row.from.code) && accounts.has(row.from.code)) spread([row.from.code]);
  }
  for (const id of accounts) if (!hops.has(id)) hops.set(id, 0);
  return hops;
}

// 홉-시간순 그래프: 가로 = 홉, 같은 홉 안의 세로 = 시간순(위가 이른 시각).
// 출발 계좌는 첫 송금 시각, 나머지는 돈이 처음 들어온 시각으로 줄을 세운다.
export function buildHopTimePlan(records, nodes) {
  const byCode = new Map();
  const first = new Map();
  const arrived = new Map();
  const sent = new Map();
  const earliest = (map, key, time) => map.set(key, Math.min(map.get(key) ?? time, time));
  for (const row of records) {
    const time = transactionTime(row.timestamp);
    if (!Number.isFinite(time)) continue;
    byCode.set(row.code, time);
    for (const account of [row.from.code, row.to.code]) earliest(first, account, time);
    earliest(sent, row.from.code, time);
    if (row.from.code !== row.to.code) earliest(arrived, row.to.code, time);
  }
  if (!nodes.length) return undefined;
  const times = [...new Set(byCode.values())].sort((left, right) => left - right);
  const formatTime = graphTimeFormatter(times.length ? times : [0]);
  const hops = accountHops(records, nodes.map(node => node.id));
  const lastHop = Math.max(...hops.values());
  const ticks = Array.from({ length: lastHop + 1 }, (_, hop) => ({ x: hop * hopStep, label: `홉 ${hop}` }));
  const homes = new Map();
  const order = id => (hops.get(id) === 0 ? sent.get(id) : arrived.get(id)) ?? first.get(id) ?? Infinity;
  for (const [hop, accounts] of Map.groupBy(nodes, ({ id }) => hops.get(id))) {
    const ordered = accounts.toSorted((left, right) => order(left.id) - order(right.id) || left.id.localeCompare(right.id));
    const top = -((ordered.length - 1) * sameTimeGap) / 2;
    ordered.forEach(({ id }, index) => homes.set(id, { x: hop * hopStep, y: top + index * sameTimeGap }));
  }
  return { byCode, first, hops, ticks, homes, formatTime };
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
