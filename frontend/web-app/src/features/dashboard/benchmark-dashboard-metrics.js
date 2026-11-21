const dateFormat = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
const dayString = day => typeof day === 'string' ? day.slice(0, 10) : day && dateFormat.format(day);

export function benchmarkDashboardMetrics(dataset, range) {
  const from = dayString(range?.from) ?? dataset.period.start;
  const to = dayString(range?.to) ?? dataset.period.end;
  const days = dataset.days.filter(day => day.date >= from && day.date <= to);
  const totals = { transactions: 0, labeled: 0, newAccounts: 0, newBanks: 0 };
  let peak;
  for (const day of days) {
    totals.transactions += day.total;
    totals.labeled += day.labeled;
    totals.newAccounts += day.newAccounts;
    totals.newBanks += day.newBanks;
    if (day.labeled > (peak?.labeled ?? 0)) peak = day;
  }
  return { from, to, days, totals, peak };
}
