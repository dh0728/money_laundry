import { reviewStatusLabels as statusLabels } from '../../lib/review-status';

export { statusLabels };

const number = new Intl.NumberFormat('ko-KR');
const percent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 });
export const count = value => `${number.format(value)}건`;
export const share = (value, total) => total ? percent.format(value / total) : '—';

export const flowColors = {
  neutral: 'var(--text)',
  normal: 'var(--risk-low)',
  suspect: 'var(--risk-high)',
  pending: 'var(--review-status-pending-accent)',
  inProgress: 'var(--review-status-inProgress-accent)',
  done: 'var(--review-status-done-accent)',
};

export function reviewStatusTotals(rows) {
  const totals = { pending: 0, inProgress: 0, done: 0 };
  for (const row of rows ?? []) {
    totals.pending += row.pending;
    totals.inProgress += row.inProgress;
    totals.done += row.done;
  }
  const unfinished = totals.pending + totals.inProgress;
  return { ...totals, unfinished, total: unfinished + totals.done };
}
const verdictNodes = [
  { key: 'normal', label: '정상 판정', color: flowColors.normal },
  { key: 'suspicious', label: '이상 판정', color: flowColors.suspect },
  { key: 'unclassified', label: '판정 정보 없음', color: flowColors.neutral },
];

function graph() {
  const nodes = [];
  const links = [];
  return {
    nodes, links,
    node(name, stage, value, color, props = {}) {
      return nodes.push({ name, stage, count: value, color, ...props }) - 1;
    },
    link(source, target, value, props = {}) {
      if (value > 0) links.push({ source, target, count: value, ...props });
    },
  };
}

function transactionDetailScale(total, suspicious) {
  if (!suspicious || suspicious / total >= 0.08) return 1;
  const target = (0.08 / 0.92) * (total - suspicious) / suspicious;
  const step = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map(value => value * step).find(value => value >= target);
}

function fixtureBanks(total) {
  const example = [64, 48, 37, 26];
  let previous = 0;
  let cumulative = 0;
  const ranked = example.map((value, index) => {
    cumulative += value;
    const boundary = Math.round(total * cumulative / 175);
    const row = { name: '가상 은행 ' + 'ABCD'[index], value: boundary - previous };
    previous = boundary;
    return row;
  }).filter(row => row.value > 0)
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, 'ko-KR'));
  const leading = ranked.slice(0, 3);
  const remainder = ranked.slice(3).reduce((sum, row) => sum + row.value, 0);
  return remainder ? [...leading, { name: '기타', value: remainder }] : leading;
}

export function transactionFlow(data) {
  const total = data.transactions.length;
  const suspicious = data.suspicious.length;
  const other = total - suspicious;
  const sample = data.dataSource === 'sample';
  const scale = transactionDetailScale(total, suspicious);
  const flow = graph();
  const remainderColor = sample ? flowColors.normal : flowColors.neutral;

  const recipients = sample ? fixtureBanks(total) : [{ name: '은행별 거래 미집계', value: total }];
  const recipientNodes = recipients.map(row => flow.node(row.name, 0, sample ? row.value : null, flowColors.neutral));
  const totalNode = flow.node('전체 거래', 1, total, flowColors.neutral);
  const receivedWeight = total ? (other + suspicious * scale) / total : 1;
  recipients.forEach((row, index) => flow.link(recipientNodes[index], totalNode, row.value, { weight: row.value * receivedWeight }));

  if (other > 0) {
    const otherNode = flow.node(sample ? '정상' : '그 외 거래', 2, other, remainderColor,
      { ratio: share(other, total) });
    flow.link(totalNode, otherNode, other);
  }
  if (suspicious > 0) {
    const suspectNode = flow.node('이상', 2, suspicious, flowColors.suspect,
      { ratio: share(suspicious, total) });
    flow.link(totalNode, suspectNode, suspicious, { weight: suspicious * scale });
    const patterns = data.patterns.filter(row => row.count > 0).sort((a, b) => b.count - a.count);
    const patternTotal = patterns.reduce((sum, row) => sum + row.count, 0);
    if (patternTotal < suspicious) {
      const undetermined = patterns.find(row => row.label === '미분류');
      if (undetermined) {
        const index = patterns.indexOf(undetermined);
        patterns[index] = { ...undetermined, count: undetermined.count + suspicious - patternTotal };
      } else patterns.push({ label: '미분류', count: suspicious - patternTotal });
    }
    if (patternTotal <= suspicious) for (const row of patterns) {
      const pattern = flow.node(row.label, 3, row.count, flowColors.suspect,
        { ratio: share(row.count, suspicious) });
      flow.link(suspectNode, pattern, row.count, { weight: row.count * scale });
    }
  }
  return { ...flow, scale, sample, hasData: total > 0 };
}

function addStatusAndVerdicts(flow, routeNodes, stage, weight = 1) {
  for (const [key, label] of Object.entries(statusLabels)) {
    const total = routeNodes.reduce((sum, { route }) => sum + route[key], 0);
    if (total === 0) continue;
    const state = flow.node(label, stage, total, flowColors[key]);
    for (const { id, route } of routeNodes) flow.link(id, state, route[key], { weight: route[key] * weight });
    if (key !== 'done') continue;
    for (const verdict of verdictNodes) {
      const value = routeNodes.reduce((sum, { route }) => sum + route.verdicts[verdict.key], 0);
      if (value === 0) continue;
      const result = flow.node(verdict.label, stage + 1, value, verdict.color);
      flow.link(state, result, value, { weight: value * weight });
    }
  }
}

export function personalInvestigationFlow(mine, { statusByCode, verdictByCode }) {
  const flow = graph();
  const byKind = Map.groupBy(mine, row => row.kind);
  const routeNodes = [];
  for (const [kind, color] of [
    ['Alert', 'var(--alert-standalone-series-accent)'],
    ['Episode', 'var(--case-comparison-pink)'],
  ]) {
    const cases = byKind.get(kind) ?? [];
    if (!cases.length) continue;
    const route = { pending: 0, inProgress: 0, done: 0, verdicts: { normal: 0, suspicious: 0, unclassified: 0 } };
    for (const row of cases) {
      const status = statusByCode[row.code] ?? row.status;
      const key = status === '처리 완료' ? 'done' : status === '처리 중' ? 'inProgress' : 'pending';
      route[key]++;
      if (key === 'done') {
        const verdict = verdictByCode[row.code] ?? row.verdict;
        route.verdicts[verdict === 'normal' ? 'normal' : verdict === 'abnormal' ? 'suspicious' : 'unclassified']++;
      }
    }
    routeNodes.push({ id: flow.node(kind, 0, cases.length, color), route });
  }
  addStatusAndVerdicts(flow, routeNodes, 1);
  return { ...flow, hasData: routeNodes.length > 0 };
}

export function investigationFlow(data) {
  const flow = graph();
  const status = data.investigation;
  if (!status) return { ...flow, hasData: false };
  const suspicious = data.suspicious.length;
  const linked = data.linked;
  const unlinked = data.unlinked;
  const weight = linked > 0 && status.totalAlerts > 0 ? linked / status.totalAlerts : 1;
  const alerts = status.totalAlerts > 0
    ? flow.node('Alert', 1, status.totalAlerts, flowColors.suspect)
    : null;

  if (suspicious > 0 && linked != null && unlinked != null) {
    const suspect = flow.node('모델 의심 거래', 0, suspicious, flowColors.suspect);
    if (linked > 0) {
      const destination = alerts ?? flow.node('Alert 연결', 1, linked, flowColors.suspect,
        { ratio: share(linked, suspicious) });
      flow.link(suspect, destination, linked, {
        color: flowColors.suspect,
        caption: alerts == null ? undefined : `연결 ${count(linked)} · ${share(linked, suspicious)}`,
        note: '같은 거래는 한 번만 집계',
      });
    }
    if (unlinked > 0) {
      const unmatched = flow.node('미연결', 1, unlinked, flowColors.suspect, { ratio: share(unlinked, suspicious) });
      flow.link(suspect, unmatched, unlinked);
    }
  }
  if (alerts == null) return { ...flow, hasData: flow.links.length > 0 };

  const routeNodes = [
    { name: '개별 처리', route: status.routes.individual, value: status.individualAlerts },
    { name: 'Episode 편입', route: status.routes.episode, value: status.episodeAlerts,
      detail: `Episode ${count(status.linkedEpisodes)}` },
  ].filter(item => item.value > 0).map(item => ({
    ...item, id: flow.node(item.name, 2, item.value, flowColors.suspect, { detail: item.detail }),
  }));
  routeNodes.forEach(route => flow.link(alerts, route.id, route.value, { weight: route.value * weight }));

  addStatusAndVerdicts(flow, routeNodes, 3, weight);
  return { ...flow, hasData: true };
}
