import { caseFixtureRows, dateFromCode } from '../../components/radar/query-controls.jsx';
import { applyPreviewJudgment } from '../../features/investigation/case-judgment-data.js';
import { applyPreviewAlertMembership } from '../../features/investigation/case-membership-data.js';
import { wasPreviewCaseRead } from '../../features/investigation/case-read-state.js';
import { sampleTransactions, transactionFixture } from './transaction-fixtures.js';
import { fixtureCompletionTime } from './verdict-fixtures.js';
import { dashboardDays, samplePeriod } from './dashboard-record-codes.js';
import { modelRiskBand, modelRiskLabels } from '../../features/settings/model-risk-settings.js';

export { dashboardRecordCodes, samplePeriod } from './dashboard-record-codes.js';
export const dashboardPeriodEnd = new Date(`${samplePeriod[1]}T00:00:00`);
const bandNames = { high: '위험', medium: '주의', low: '낮음' };

const kpiHours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const snapshot = new Date(samplePeriod[1] + 'T18:00:00+09:00');
const scores = [93, 28, 18, 86, 24, 39, 76, 17, 29, 95, 57, 82, 0, 34, 59, 98, 68, 94];
const hours = [0, 1, 1, 2, 3, 3, 3, 4, 4, 5, 6, 7, 7, 7, 7, 8, 9, 9];
const sampleReviewStates = ['처리 전', '처리 전', '처리 중', '처리 중', '처리 완료'];
const extraPatterns = ['Fan-out 82%', 'Scatter-gather 76%', 'Cycle 74%', 'Gather-scatter 71%', 'Fan-in 86%', 'Bipartite 62%'];
const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateKey = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map(value => String(value).padStart(2, '0')).join('-');
export const complexSankeySampleCode = 'A-261111-000018';

function scoredSample(record, score) {
  return {
    ...record, date: dateFromCode(record.code), hour: Number(record.timestamp.slice(11, 13)) - 9,
    score, account: record.from.code, counterparty: record.to.code, owner: record.from.owner,
  };
}

function complexSankeyEvidence(codes, transactions) {
  const senders = [
    { owner: 0, scores: [18, 39, 93, 86] },
    { owner: 3, scores: [94, 78, 63, 91] },
    { owner: 6, scores: [84, 95, 76, 41] },
    { owner: 9, scores: [53, 91, 85, 95] },
  ];
  return senders.flatMap(({ owner, scores }) => {
    const rows = sampleTransactions(codes, owner, owner);
    // Outgoing routes share recipients between adjacent senders in each currency.
    return [2, 5, 0, 3].map((index, route) => {
      const row = rows[index];
      return transactions[row.serial] ?? scoredSample(row, scores[route]);
    });
  });
}

function completedCaseNetwork(codes, transactions) {
  const branches = [
    { owner: 0, account: 0, indices: [0, 1, 2, 4], scores: [67, 52, 39, 72] },
    { owner: 3, account: 2, indices: [0, 2, 3, 5], scores: [91, 81, 46, 89] },
    { owner: 4, account: 2, indices: [0, 2], scores: [75, 96] },
  ];
  return branches.flatMap(({ owner, account, indices, scores }) => {
    const records = sampleTransactions(codes, owner, account);
    return indices.map((index, branch) => {
      const record = records[index];
      return transactions[record.serial] ?? scoredSample(record, scores[branch]);
    });
  });
}

function evidenceSummary(related) {
  return {
    score: Math.max(0, ...related.map(transaction => transaction.score)),
    relatedAccounts: new Set(related.flatMap(transaction => [transaction.account, transaction.counterparty])).size,
    amountByCurrency: related.reduce((amounts, { amount, currency }) => {
      amounts[currency] = (amounts[currency] ?? 0) + amount;
      return amounts;
    }, {}),
  };
}

export function dashboardFixtures({ T = [], A = [], E = [] }) {
  const transactions = T.map((_, index) => scoredSample(transactionFixture(T, index), scores[index % scores.length]));
  const transactionsByDay = Map.groupBy(transactions, row => dateKey(row.date));
  const baseCases = [[A, 'Alert'], [E, 'Episode']].flatMap(([codes, kind], group) =>
    caseFixtureRows(codes).map((row, index) => {
      const date = dateKey(row.date);
      const pool = transactionsByDay.get(date) ?? [];
      const indexInDay = Number(row.code.split('-')[2]) - 1;
      const offset = (index + group * 5) % Math.max(1, pool.length);
      const defaultEvidence = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, index % 3 + 1);
      const related = row.code === complexSankeySampleCode ? complexSankeyEvidence(T, transactions)
        : row.code === 'A-261111-001051' ? completedCaseNetwork(T, transactions)
        : defaultEvidence;
      const summary = evidenceSummary(related);
      const addedDay = dashboardDays.indexOf(date) > 0;
      const day = row.date.getDate();
      const step = (indexInDay + Math.floor(day / 2) + group) % sampleReviewStates.length;
      const status = addedDay ? sampleReviewStates[step] : row.status;
      const hour = addedDay ? (day + indexInDay * 3 + group) % 9 : hours[index % hours.length];
      const createdAt = `${date}T${kpiHours[hour]}:00+09:00`;
      const created = new Date(createdAt);
      const completedAt = addedDay && status === '처리 완료'
        ? new Date(Math.min(+snapshot, +created + (indexInDay % 3 === 0 ? 24 : 2) * 3600000)).toISOString()
        : fixtureCompletionTime(row.code);
      return applyPreviewJudgment({
        ...row, ...summary, kind, related, hour, status, createdAt, completedAt,
        pattern: addedDay ? extraPatterns[(indexInDay + day + group) % extraPatterns.length] : row.pattern,
        verdict: addedDay && status === '처리 완료' ? (summary.score >= 70 ? 'abnormal' : 'normal') : row.verdict,
        unread: status === '처리 전' && Math.floor(index / 4) % 2 === 0 && !wasPreviewCaseRead(row.code),
        open: status !== '처리 완료',
        elapsed: Math.max(0, Math.floor((snapshot - created) / 86400000)),
      });
    }));
  const allTransactions = new Map(transactions.map(row => [row.code, row]));
  for (const row of baseCases) for (const transaction of row.related) {
    if (!allTransactions.has(transaction.code)) allTransactions.set(transaction.code, transaction);
  }
  const cases = applyPreviewAlertMembership(baseCases, allTransactions, evidenceSummary);
  const alertCases = cases.filter(row => row.kind === 'Alert');
  for (const row of cases) {
    if (row.kind !== 'Episode') continue;
    const relatedCodes = new Set(row.related.map(transaction => transaction.code));
    row.overlappingAlerts = alertCases.filter(alert => alert.related.some(transaction => relatedCodes.has(transaction.code)));
    row.linkedAlerts = row.overlappingAlerts.length;
  }
  return { transactions: [...allTransactions.values()], cases, mine: cases.filter(row => row.assigned) };
}

function dashboardMetrics(transactions, cases, range, history, completedPopulation) {
  const suspicious = transactions.filter(row => row.score >= 55);
  const alertCases = cases.filter(row => row.kind === 'Alert');
  const linked = new Set(alertCases.flatMap(row => row.related.map(transaction => transaction.code)));
  const byDay = Map.groupBy(cases, row => dateKey(row.date));
  const transactionsByDay = Map.groupBy(transactions, row => dateKey(row.date));
  const firstSeen = firstSeenByTransaction(history);
  const completions = Map.groupBy(completedPopulation.filter(row => row.kind === 'Alert' && row.completedAt),
    row => kstDate.format(new Date(row.completedAt)));
  const firstAvailable = new Date(`${samplePeriod[0]}T00:00:00`);
  const start = new Date(range?.from > firstAvailable ? range.from : firstAvailable);
  const end = range?.to < dashboardPeriodEnd ? range.to : dashboardPeriodEnd;
  const dailyAlertStatus = [];
  const operationalDaily = [];
  const daily = [];
  for (const day = start; day <= end; day.setDate(day.getDate() + 1)) {
    const date = dateKey(day);
    const rows = byDay.get(date) ?? [];
    const alerts = rows.filter(row => row.kind === 'Alert');
    const transfers = transactionsByDay.get(date) ?? [];
    const flagged = transfers.filter(row => row.score >= 55);
    dailyAlertStatus.push({
      date,
      pending: alerts.filter(row => row.status === '처리 전').length,
      inProgress: alerts.filter(row => row.status === '처리 중').length,
      done: alerts.filter(row => row.status === '처리 완료').length,
    });
    daily.push({ day: date, incoming: alerts.length, completed: completions.get(date)?.length ?? 0 });
    operationalDaily.push({
      date, label: `${day.getMonth() + 1}/${day.getDate()}`,
      total: transfers.length,
      suspicious: flagged.length,
      alerts: alerts.length,
      openAlerts: alerts.filter(row => row.open).length,
      openEpisodes: rows.filter(row => row.kind === 'Episode' && row.open).length,
      newAccounts: transfers.reduce((total, row) => total + (firstSeen.accounts.get(row.code) ?? 0), 0),
      newOwners: transfers.reduce((total, row) => total + (firstSeen.owners.get(row.code) ?? 0), 0),
      settled: rows.filter(row => !row.open).length,
      totalCases: rows.length,
      linked: flagged.filter(row => linked.has(row.code)).length,
    });
  }
  const mine = cases.filter(row => row.assigned);
  const unfinished = mine.filter(row => row.open);
  const highRiskAlerts = unfinished.filter(row => row.kind === 'Alert' && modelRiskBand(row.score) === 'high');
  const overdueCases = unfinished.filter(row => row.elapsed >= 3);
  const patternByTransaction = new Map();
  for (const row of [...alertCases].sort((left, right) => left.code.localeCompare(right.code))) {
    for (const transaction of row.related) {
      if (!patternByTransaction.has(transaction.code)) {
        patternByTransaction.set(transaction.code, row.pattern.replace(/ \d+%$/, ''));
      }
    }
  }
  const patternCounts = new Map();
  suspicious.forEach(transaction => {
    const pattern = patternByTransaction.get(transaction.code) ?? '미분류';
    patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
  });
  const labels = modelRiskLabels();
  return {
    cases, mine, transactions, suspicious, alertCases,
    flags: Object.entries(bandNames).map(([key, name]) => ({ key, label: `${labels[key]} · ${name}`,
      count: suspicious.filter(row => modelRiskBand(row.score) === key).length })),
    settled: cases.filter(row => !row.open).length,
    ownedAlerts: mine.filter(row => row.kind === 'Alert').length,
    highRisk: highRiskAlerts.length,
    overdue: overdueCases.length,
    unfinished: unfinished.length,
    urgent: highRiskAlerts.filter(row => row.elapsed >= 3).length,
    newAccounts: operationalDaily.reduce((total, row) => total + row.newAccounts, 0),
    newOwners: operationalDaily.reduce((total, row) => total + row.newOwners, 0),
    linked: suspicious.filter(row => linked.has(row.code)).length,
    patterns: [...patternCounts].map(([label, count]) => ({ label, count })),
    daily, dailyAlertStatus, operationalDaily,
    hourly: kpiHours.map((label, i) => ({
      label,
      total: transactions.filter(row => row.hour === i).length,
      suspicious: suspicious.filter(row => row.hour === i).length,
      mine: mine.filter(row => row.kind === 'Alert' && row.hour === i).length,
      highRisk: highRiskAlerts.filter(row => row.hour === i).length,
      overdue: overdueCases.filter(row => row.hour === i).length,
      alerts: alertCases.filter(row => row.hour === i).length,
      pending: alertCases.filter(row => row.hour === i && row.status === '처리 전').length,
      inProgress: alertCases.filter(row => row.hour === i && row.status === '처리 중').length,
      done: alertCases.filter(row => row.hour === i && row.status === '처리 완료').length,
    })),
  };
}

function firstSeenByTransaction(transactions) {
  const accounts = new Map();
  const owners = new Map();
  const seenAccounts = new Set();
  const seenOwners = new Set();
  for (const row of [...transactions].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) || left.code.localeCompare(right.code))) {
    for (const party of [row.from, row.to]) {
      if (!seenAccounts.has(party.code)) {
        seenAccounts.add(party.code);
        accounts.set(row.code, (accounts.get(row.code) ?? 0) + 1);
      }
      if (!seenOwners.has(party.owner)) {
        seenOwners.add(party.owner);
        owners.set(row.code, (owners.get(row.code) ?? 0) + 1);
      }
    }
  }
  return { accounts, owners };
}

export function dashboardFixtureResponse(source, { mine, rows, population, range, sort } = {}) {
  const scopeCases = mine ? source.mine : source.cases;
  const completedPopulation = population ?? scopeCases;
  const from = range?.from ? dateKey(range.from) : samplePeriod[0];
  const to = range?.to ? dateKey(range.to) : samplePeriod[1];
  const includesDate = row => {
    const date = dateKey(row.date);
    return date >= from && date <= to;
  };
  const periodCases = scopeCases.filter(includesDate);
  const cases = (rows ?? completedPopulation).filter(includesDate);
  const evidence = mine || completedPopulation.length < scopeCases.length || cases.length < periodCases.length
    ? new Set(cases.flatMap(row => row.related.map(transaction => transaction.code))) : null;
  const transactions = source.transactions.filter(row => includesDate(row) && (!evidence || evidence.has(row.code)));
  return {
    scope: mine ? 'mine' : 'all',
    businessAt: `${samplePeriod[1]}T18:00:00+09:00`,
    period: { from, to },
    ...dashboardMetrics(transactions, cases, range, source.transactions, completedPopulation),
    sort,
  };
}

export function dashboardFixtureBoardPage(cases, { page = 0, size = 20 } = {}) {
  const start = page * size;
  return { content: cases.slice(start, start + size), number: page, size,
    totalElements: cases.length, totalPages: Math.ceil(cases.length / size) };
}
