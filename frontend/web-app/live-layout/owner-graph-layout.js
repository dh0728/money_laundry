import { graphPartyId, graphRiskBand } from './case-graph-scope';
import { graphTimeFormatter, transactionTime } from './pattern-graph-time';

export const ownerWidth = 220;
export const ownerHeaderHeight = 32;
export const ownerRowHeight = 32;
const inset = 2;
const columnGap = 112;
const rowGap = 30;
const margin = 64;

export function ownerGraphLayout(records) {
  const ownersById = new Map();
  const accounts = new Map();
  const links = new Map();
  const timeByCode = new Map();
  function addAccount(party) {
    if (accounts.has(party.code)) return accounts.get(party.code);
    const name = party.owner?.trim();
    const id = name ? `owner:${graphPartyId(party, true)}` : `account:${party.code}`;
    const owner = ownersById.get(id) ?? { id, name: name || '소유주 미상', selection: name ? id : party.code,
      accounts: [], outgoing: new Set(), incoming: new Set() };
    ownersById.set(id, owner);
    const account = { id: party.code, owner, index: owner.accounts.length };
    owner.accounts.push(account);
    accounts.set(party.code, account);
    return account;
  }
  for (const row of records) {
    const from = addAccount(row.from);
    const to = addAccount(row.to);
    const key = JSON.stringify([from.id, to.id]);
    const link = links.get(key) ?? { key, from, to, rows: [] };
    link.rows.push(row);
    links.set(key, link);
    if (from.owner !== to.owner) {
      from.owner.outgoing.add(to.owner.id);
      to.owner.incoming.add(from.owner.id);
    }
    const instant = transactionTime(row.timestamp);
    if (Number.isFinite(instant)) timeByCode.set(row.code, instant);
  }

  const owners = [...ownersById.values()];
  const directionalScore = owner => owner.outgoing.size - owner.incoming.size;
  const scores = [...new Set(owners.map(directionalScore))].sort((a, b) => b - a);
  const desiredColumns = Math.min(4, scores.length);
  const groups = desiredColumns > 1
    ? [...Map.groupBy(owners, owner => Math.round(scores.indexOf(directionalScore(owner)) * (desiredColumns - 1) / (scores.length - 1)))]
      .sort(([first], [second]) => first - second).map(([, group]) => group)
    : [owners];
  const maxRows = Math.max(4, Math.ceil(Math.sqrt(owners.length)));
  const columns = groups.flatMap(group => Array.from(
    { length: Math.ceil(group.length / maxRows) }, (_, index) => group.slice(index * maxRows, (index + 1) * maxRows),
  ));
  const heights = columns.map(column => column.reduce((height, owner) =>
    height + ownerHeaderHeight + owner.accounts.length * ownerRowHeight + inset * 2 + rowGap, -rowGap));
  const height = Math.max(0, ...heights);
  columns.forEach((column, index) => {
    let y = margin + (height - heights[index]) / 2;
    for (const owner of column) {
      owner.x = margin + index * (ownerWidth + columnGap);
      owner.y = y;
      owner.height = ownerHeaderHeight + owner.accounts.length * ownerRowHeight + inset * 2;
      y += owner.height + rowGap;
    }
  });
  const times = [...new Set(timeByCode.values())].sort((a, b) => a - b);
  return { owners, links: [...links.values()], timeByCode, times, formatTime: graphTimeFormatter(times),
    width: margin * 2 + Math.max(1, columns.length) * (ownerWidth + columnGap) - columnGap,
    height: margin * 2 + height };
}

export function ownerAccountY(account) {
  return account.owner.y + inset + ownerHeaderHeight + account.index * ownerRowHeight;
}

export function ownerTransferPath(from, to, fromOffset, toOffset) {
  const start = [from.owner.x + ownerWidth + fromOffset.x, ownerAccountY(from) + ownerRowHeight / 2 + fromOffset.y];
  const end = [to.owner.x + toOffset.x, ownerAccountY(to) + ownerRowHeight / 2 + toOffset.y];
  const forward = end[0] > start[0] + 24;
  const bend = forward ? Math.max(48, (end[0] - start[0]) / 2) : 96;
  const below = Math.max(from.owner.y + from.owner.height + fromOffset.y, to.owner.y + to.owner.height + toOffset.y) + 44;
  const first = [start[0] + bend, forward ? start[1] : start[1] + (below - start[1]) * 4 / 3];
  const second = [end[0] - bend, forward ? end[1] : end[1] + (below - end[1]) * 4 / 3];
  return { path: `M ${start.join(' ')} C ${first.join(' ')}, ${second.join(' ')}, ${end.join(' ')}`,
    midpoint: start.map((value, index) => (value + 3 * first[index] + 3 * second[index] + end[index]) / 8) };
}

export const ownerTransferRisk = rows => graphRiskBand(Math.max(...rows.filter(row =>
  graphRiskBand(row.score) !== 'unknown').map(row => row.score)));
