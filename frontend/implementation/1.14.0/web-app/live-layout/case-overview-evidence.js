const byCode = (a, b) => a.code.localeCompare(b.code);

export function caseOverviewEvidence(transactions) {
  const records = [...new Map(transactions.map(row => [row.code, row])).values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || byCode(a, b));
  const participants = new Map();
  for (const record of records) {
    for (const [direction, party] of [['sent', record.from], ['received', record.to]]) {
      const account = participants.get(party.code) ?? { ...party, sent: 0, received: 0, transactions: new Set() };
      account[direction] += 1;
      account.transactions.add(record.code);
      participants.set(party.code, account);
    }
  }
  const accounts = [...participants.values()].sort((a, b) => b.transactions.size - a.transactions.size || byCode(a, b));
  const ownerCount = new Set(accounts.map(account => account.owner).filter(Boolean)).size;
  const [first, second] = accounts;
  const focus = first && first.transactions.size > (second?.transactions.size ?? 0) && first.transactions.size > 1 ? first : undefined;
  const inflows = [];
  const outflows = [];
  const currencyTotals = new Map();
  const lead = records.reduce((top, row) => Number.isFinite(row.score) && (!top || row.score > top.score) ? row : top, null);
  for (const record of records) {
    const fromFocus = focus?.code === record.from.code;
    const toFocus = focus?.code === record.to.code;
    if (fromFocus === toFocus) continue;
    const totals = currencyTotals.get(record.currency) ?? { currency: record.currency, inflow: 0, outflow: 0 };
    if (toFocus) { inflows.push(record); totals.inflow += record.amount; }
    else { outflows.push(record); totals.outflow += record.amount; }
    currencyTotals.set(record.currency, totals);
  }
  const flows = [...currencyTotals.values()].sort((a, b) => a.currency.localeCompare(b.currency))
    .map(flow => ({ ...flow, net: flow.inflow - flow.outflow, ratio: flow.inflow > 0 ? 100 * flow.outflow / flow.inflow : null }));
  return { records, accounts, ownerCount, focus, inflows, outflows, flows, lead };
}

export function relatedJudgments(history, currentCode, { accounts, records }) {
  const accountCodes = new Set(accounts.map(account => account.code));
  const currentTargets = new Set([currentCode, ...records.map(record => record.code)]);
  return history.flatMap(judgment => {
    const targets = judgment.targets.flatMap(target => {
      if (currentTargets.has(target.code)) return [];
      const evidence = target.related ?? (target.from && target.to ? [target] : []);
      const sharedAccounts = [...new Set(evidence.flatMap(row => [row.from.code, row.to.code]))]
        .filter(code => accountCodes.has(code)).sort();
      return sharedAccounts.length ? [{ code: target.code, sharedAccounts }] : [];
    });
    return targets.length ? [{ ...judgment, targets }] : [];
  });
}
