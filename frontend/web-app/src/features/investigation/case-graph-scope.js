import { modelRiskBand as graphRiskBand } from '../settings/model-risk-settings.js';
export { graphRiskBand };

export function sharedCaseEvidence(active, candidate) {
  const activeCodes = new Set(active?.related?.map(row => row.code));
  const activeAccounts = new Set(active?.related?.flatMap(row => [row.from.code, row.to.code]));
  const related = candidate?.related ?? [];
  return {
    transactions: [...new Set(related.map(row => row.code).filter(code => activeCodes.has(code)))],
    accounts: [...new Set(related.flatMap(row => [row.from.code, row.to.code]).filter(code => activeAccounts.has(code)))],
  };
}

export function graphVerdict(verdicts) {
  if (verdicts.size > 1) return 'mixed';
  const verdict = verdicts.values().next().value;
  return verdict === 'normal' || verdict === 'abnormal' ? verdict : 'unjudged';
}

export const graphVerdictLabels = {
  normal: '정상',
  abnormal: '이상',
  unjudged: '판정 전',
  mixed: '판정 혼합',
};

export const graphPartyId = (party, ownerView) => (ownerView && party.owner?.trim()) || party.code;

// Alert 구성원 중 주변 거래(CONTEXT)와 판정 거래(그 밖)를 나눈다. 역할이 없는 거래는 판정 거래로 본다.
export const isContextTransaction = row => row?.reviewRole === 'CONTEXT';
export const transactionRoleLabels = { subject: '판정 거래', context: '주변 거래' };
export const transactionRoleLabel = row => transactionRoleLabels[isContextTransaction(row) ? 'context' : 'subject'];
// 주변 거래로만 이루어진 계좌·연결인지 본다.
export const contextOnly = entry => entry.contextCodes?.size > 0 && entry.contextCodes.size === entry.codes.size;
export function transactionRoleSummary(rows) {
  const context = rows.filter(isContextTransaction).length;
  return context ? `${transactionRoleLabels.subject} ${rows.length - context}건 · ${transactionRoleLabels.context} ${context}건` : undefined;
}

export function buildCaseNetwork(transactions, ownerView = false) {
  const nodes = new Map();
  const edges = new Map();
  const update = (entry, code, score, context) => {
    entry.codes.add(code);
    if (context) entry.contextCodes.add(code);
    if (graphRiskBand(score) !== 'unknown') entry.peakScore = Math.max(entry.peakScore ?? score, score);
  };
  const nodeFor = (party, code, score, context) => {
    const id = graphPartyId(party, ownerView);
    const node = nodes.get(id) ?? { id, owner: party.owner?.trim(), accounts: new Set(), codes: new Set(), contextCodes: new Set() };
    node.accounts.add(party.code);
    update(node, code, score, context);
    nodes.set(id, node);
    return node.id;
  };
  for (const row of transactions) {
    const { code, from, to, verdict, score } = row;
    const context = isContextTransaction(row);
    const source = nodeFor(from, code, score, context);
    const target = nodeFor(to, code, score, context);
    const id = `${source}>${target}`;
    const edge = edges.get(id) ?? { id, source, target, codes: new Set(), contextCodes: new Set(), verdicts: new Set() };
    edge.verdicts.add(verdict === 'normal' || verdict === 'abnormal' ? verdict : 'unjudged');
    update(edge, code, score, context);
    edges.set(id, edge);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function transactionsWithinHops(rows, anchor, limit, ownerView = false) {
  const neighbors = new Map();
  function addNeighbor(from, to, index) {
    const list = neighbors.get(from) ?? [];
    list.push({ to, index });
    neighbors.set(from, list);
  }
  rows.forEach(({ from, to }, index) => {
    const source = graphPartyId(from, ownerView);
    const target = graphPartyId(to, ownerView);
    addNeighbor(source, target, index);
    if (source !== target) addNeighbor(target, source, index);
  });

  const visited = new Set([anchor]);
  const included = new Set();
  let frontier = [anchor];
  // Explore both connected directions and keep each original transaction intact.
  for (let hop = 0; hop < limit && frontier.length; hop += 1) {
    const next = [];
    for (const id of frontier) {
      for (const { to, index } of neighbors.get(id) ?? []) {
        included.add(index);
        if (visited.has(to)) continue;
        visited.add(to);
        next.push(to);
      }
    }
    frontier = next;
  }
  return rows.filter((_, index) => included.has(index));
}

export function graphTableSelection(rows, selected, selectedCodes) {
  if (!selected) return undefined;
  const isNode = 'accounts' in selected;
  const accounts = isNode ? selected.accounts : new Set();
  const transactions = new Set();
  for (const row of rows) {
    if (!selected.codes.has(row.code) || (selectedCodes && !selectedCodes.has(row.code))) continue;
    transactions.add(row.code);
    if (!isNode) {
      accounts.add(row.from.code);
      accounts.add(row.to.code);
    }
  }
  return { accounts, transactions };
}

const orderTransactions = (left, right) => left.timestamp.localeCompare(right.timestamp) || left.code.localeCompare(right.code);

export function mergeCaseTransactions(cases) {
  const records = new Map();
  for (const record of cases) {
    for (const row of record?.related ?? []) {
      if (!records.has(row.code)) records.set(row.code, row);
    }
  }
  return [...records.values()].sort(orderTransactions);
}

export function casePlaybackCursor(rows, through) {
  if (through === undefined) return rows.length;
  if (through === null) return 0;
  const following = rows.findIndex(row => orderTransactions(row, through) > 0);
  return following < 0 ? rows.length : following;
}
