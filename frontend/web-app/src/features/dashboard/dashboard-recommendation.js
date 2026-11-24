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
  let shortestGap = Infinity;
  for (const [account, { received, sent }] of accounts) {
    sent.sort((left, right) => left.time - right.time);
    for (const receipt of received) {
      const payment = sent.find(candidate => {
        const gap = candidate.time - receipt.time;
        if (gap <= 0 || gap >= shortestGap || candidate.transaction.code === receipt.transaction.code) return false;
        const first = receipt.record;
        const second = candidate.record;
        if (first.kind === second.kind || (!first.open && !second.open)) return false;
        const [alert, episode] = first.kind === 'Alert' ? [first, second] : [second, first];
        return alert.episodeCode !== episode.code && !episode.linkedAlertCodes?.includes(alert.code);
      });
      if (!payment) continue;
      shortestGap = payment.time - receipt.time;
      recommendation = { account, received: receipt, sent: payment };
    }
  }
  return recommendation;
}
