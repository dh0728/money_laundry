import { sharedCaseEvidence } from '../investigation/case-graph-scope.js';

const maximumVisibleTransfers = 12;

export function findAccountTrail(cases) {
  const accounts = new Map();
  for (const record of cases) {
    if (record.kind !== 'Alert' && record.kind !== 'Episode') continue;
    for (const transaction of record.related) {
      const from = transaction.from?.code;
      const to = transaction.to?.code;
      if (!from || !to || from === to || typeof transaction.timestamp !== 'string') continue;
      const time = Date.parse(transaction.timestamp.replace(' ', 'T') + '+09:00');
      if (!Number.isFinite(time)) continue;
      const evidence = { record, transaction, time };
      for (const [account, direction] of [[from, 'sent'], [to, 'received']]) {
        if (!accounts.has(account)) accounts.set(account, { sent: [], received: [] });
        accounts.get(account)[direction].push(evidence);
      }
    }
  }

  let recommendation = null;
  let highestPriority = -1;
  let shortestGap = Infinity;
  for (const [account, { received, sent }] of accounts) {
    sent.sort((left, right) => left.time - right.time);
    for (const receipt of received) {
      for (const payment of sent) {
        const gap = payment.time - receipt.time;
        if (gap <= 0 || payment.transaction.code === receipt.transaction.code) continue;
        if (highestPriority === 3 && gap >= shortestGap) break;
        const first = receipt.record;
        const second = payment.record;
        if (first.kind === second.kind || (!first.open && !second.open)) continue;
        const [alert, episode] = first.kind === 'Alert' ? [first, second] : [second, first];
        if (alert.episodeCode === episode.code || episode.linkedAlertCodes?.includes(alert.code)) continue;
        const incoming = receipt.transaction;
        const outgoing = payment.transaction;
        const returned = incoming.from.code === outgoing.to.code;
        const sameAmount = Number.isFinite(incoming.amount) && incoming.amount === outgoing.amount
          && Boolean(incoming.currency) && incoming.currency === outgoing.currency;
        const priority = (returned ? 2 : 0) + Number(sameAmount);
        if (priority < highestPriority || (priority === highestPriority && gap >= shortestGap)) continue;
        highestPriority = priority;
        shortestGap = gap;
        recommendation = { account, received: receipt, sent: payment, returned, sameAmount };
      }
    }
  }
  return recommendation;
}
export function accountTrailComparison(trail, allCases) {
  const { received, sent } = trail;
  const cases = [received.record, sent.record];
  const alert = cases.find(record => record.kind === 'Alert');
  const episode = cases.find(record => record.kind === 'Episode');
  const validTransactions = record => record.related.filter(row => row.from?.code && row.to?.code);
  const alertEvidence = { related: validTransactions(alert) };
  const episodeEvidence = { related: validTransactions(episode) };
  const shared = sharedCaseEvidence(alertEvidence, episodeEvidence).accounts;
  const byCode = new Map();
  for (const [kind, evidence] of [['comparison', alertEvidence], ['episode', episodeEvidence]]) {
    for (const transaction of evidence.related) {
      const transfer = byCode.get(transaction.code) ?? { ...transaction, memberAlerts: [] };
      transfer[kind] = true;
      byCode.set(transaction.code, transfer);
    }
  }
  const memberCodes = new Set(episode.linkedAlertCodes ?? []);
  for (const member of allCases) {
    if (member.kind !== 'Alert' || !memberCodes.has(member.code)) continue;
    for (const code of new Set(member.related.map(transaction => transaction.code))) {
      const transfer = byCode.get(code);
      if (transfer?.episode) transfer.memberAlerts.push(member.code);
    }
  }
  const transfers = [byCode.get(received.transaction.code), byCode.get(sent.transaction.code)];
  const selected = new Set(transfers.map(row => row.code));
  const accounts = new Set(transfers.flatMap(row => [row.from.code, row.to.code]));
  const remaining = [...byCode.values()].filter(row => !selected.has(row.code))
    .sort((first, second) => Number([second.from.code, second.to.code].includes(trail.account))
      - Number([first.from.code, first.to.code].includes(trail.account)));
  while (transfers.length < maximumVisibleTransfers) {
    const index = remaining.findIndex(row => accounts.has(row.from.code) || accounts.has(row.to.code));
    if (index === -1) break;
    const [transfer] = remaining.splice(index, 1);
    transfers.push(transfer);
    accounts.add(transfer.from.code);
    accounts.add(transfer.to.code);
  }
  return {
    alert: alert.code,
    episode: episode.code,
    shared,
    transfers,
    omittedTransfers: remaining.length,
  };
}
