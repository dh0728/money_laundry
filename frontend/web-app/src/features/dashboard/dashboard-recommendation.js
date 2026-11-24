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
