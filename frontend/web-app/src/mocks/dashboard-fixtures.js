import { caseFixtureRows, dateFromCode } from '../components/query-controls.jsx';
import { applyPreviewJudgment } from '../features/investigation/case-judgment-data.js';
import { currentPreviewUser, previewAnalysts, previewStaff } from '../features/auth/preview-session-user.js';
import { previewCaseAssignee, previewWorkRequestEffects } from '../features/investigation/preview-work-requests.js';
import { applyPreviewEpisodeTransfers } from '../features/investigation/preview-episode-transfer.js';
import { applyPreviewAlertMembership } from '../features/investigation/case-membership-data.js';
import { wasPreviewCaseRead } from '../features/investigation/case-read-state.js';
import { sampleTransactions, transactionFixture } from './transaction-fixtures.js';
import { fixtureCompletionTime } from './verdict-fixtures.js';
import { dashboardDays, sampleEpisodeAlertCodes, samplePeriod } from './dashboard-record-codes.js';
import { modelRiskBand, modelRiskLabels } from '../features/settings/model-risk-settings.js';
import { isOverdueCaseAge } from '../features/investigation/case-age.js';
import { alertEvidenceCodes, caseLifecycleByDay, dashboardDateKey as dateKey, investigationDashboard } from '../features/dashboard/dashboard-investigation.js';

export { dashboardRecordCodes, samplePeriod } from './dashboard-record-codes.js';
export const dashboardPeriodEnd = new Date(`${samplePeriod[1]}T00:00:00`);
const primaryPreviewCases = new Set(['A-261111-000009', 'A-261111-001042', 'A-261112-000003',
  'E-261111-000001', 'E-261111-000003', 'E-261115-000004']);
const bandNames = { high: '위험', medium: '주의', low: '낮음' };

const kpiHours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const snapshot = new Date(samplePeriod[1] + 'T18:00:00+09:00');
const isSuspiciousTransaction = row => row.score >= 55;
const scores = [93, 28, 18, 86, 24, 39, 76, 17, 29, 95, 57, 82, 0, 34, 59, 98, 68, 94];
const hours = [0, 1, 1, 2, 3, 3, 3, 4, 4, 5, 6, 7, 7, 7, 7, 8, 9, 9];
const sampleReviewStates = ['처리 전', '처리 전', '처리 중', '처리 중', '처리 완료'];
const extraPatterns = ['Fan-out 82%', 'Scatter-gather 76%', 'Cycle 74%', 'Gather-scatter 71%', 'Fan-in 86%', 'Bipartite 62%'];
export const complexSankeySampleCode = 'A-261111-000018';
export const cyclicSankeySampleCode = 'A-261118-000003';
const cyclicSankeyTransactionCodes = [
  'T-261117-00000145', 'T-261117-00000140', 'T-261117-00000141', 'T-261118-00000146',
];

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
  const allTransactions = new Map(transactions.map(row => [row.code, row]));
  const cyclicSankeyEvidence = cyclicSankeyTransactionCodes.map(code => allTransactions.get(code));
  const transactionsByDay = Map.groupBy(transactions, row => dateKey(row.date));
  const alertCodes = new Set(A);
  const episodeMembers = new Map(E.map(code => [code, sampleEpisodeAlertCodes(code)])
    .filter(([, codes]) => codes.every(code => alertCodes.has(code))));
  const memberAlerts = new Set([...episodeMembers.values()].flat());
  const baseCases = [[A, 'Alert'], [E, 'Episode']].flatMap(([codes, kind], group) =>
    caseFixtureRows(codes).map((row, index) => {
      const date = dateKey(row.date);
      const pool = transactionsByDay.get(date) ?? [];
      const indexInDay = Number(row.code.split('-')[2]) - 1;
      const offset = (index + group * 5) % Math.max(1, pool.length);
      const defaultEvidence = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, index % 3 + 1);
      const related = row.code === complexSankeySampleCode ? complexSankeyEvidence(T, transactions)
        : row.code === 'A-261111-001051' ? completedCaseNetwork(T, transactions)
        : row.code === cyclicSankeySampleCode && cyclicSankeyEvidence.every(Boolean) ? cyclicSankeyEvidence
        : defaultEvidence;
      const summary = evidenceSummary(related);
      const addedDay = dashboardDays.indexOf(date) > 0;
      const day = row.date.getDate();
      const step = (indexInDay + Math.floor(day / 2) + group) % sampleReviewStates.length;
      const linkedAlertCodes = episodeMembers.get(row.code);
      const seededMember = memberAlerts.has(row.code);
      const fixtureStatus = addedDay ? sampleReviewStates[step] : row.status;
      const status = seededMember || (linkedAlertCodes && fixtureStatus === '처리 전') ? '처리 중' : fixtureStatus;
      const hour = seededMember ? 0 : addedDay ? (day + indexInDay * 3 + group) % 9 : hours[index % hours.length];
      const createdAt = `${date}T${kpiHours[hour]}:00+09:00`;
      const created = new Date(createdAt);
      const completedAt = addedDay && status === '처리 완료'
        ? new Date(Math.min(+snapshot, +created + (indexInDay % 3 === 0 ? 24 : 2) * 3600000)).toISOString()
        : fixtureCompletionTime(row.code);
      return applyPreviewJudgment({
        ...row, ...summary, kind, related, hour, status, createdAt, completedAt,
        ...(linkedAlertCodes && { linkedAlertCodes, linkedAlertCodesComplete: true }),
        pattern: addedDay ? extraPatterns[(indexInDay + day + group) % extraPatterns.length] : row.pattern,
        verdict: addedDay && status === '처리 완료' ? (summary.score >= 70 ? 'abnormal' : 'normal') : row.verdict,
        unread: status === '처리 전' && Math.floor(index / 4) % 2 === 0 && !wasPreviewCaseRead(row.code),
        open: status !== '처리 완료',
        elapsed: Math.max(0, Math.floor((snapshot - created) / 86400000)),
      });
    }));
  for (const row of baseCases) for (const transaction of row.related) {
    if (!allTransactions.has(transaction.code)) allTransactions.set(transaction.code, transaction);
  }
  const actor = currentPreviewUser();
  const staff = actor?.source === 'fixture' && actor.role === 'STAFF' ? actor.username : previewStaff.username;
  const effects = actor?.source === 'fixture' ? previewWorkRequestEffects() : new Map();
  const otherAnalysts = previewAnalysts.slice(1);
  let position = 0;
  const assignments = new Map(baseCases.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.code.localeCompare(right.code))
    .map(row => [row.code, primaryPreviewCases.has(row.code) ? previewStaff.username : otherAnalysts[position++ % otherAnalysts.length].username]));
  const cases = applyPreviewEpisodeTransfers(applyPreviewAlertMembership(baseCases, allTransactions, evidenceSummary), evidenceSummary)
    .map(row => {
      const effect = effects.get(row.code);
      const assignee = effect?.assignee ?? row.assignee ?? assignments.get(row.code) ?? previewCaseAssignee(row);
      const next = { ...row, assignee, assigned: assignee === staff, assignedAt: effect?.assignedAt ?? row.createdAt,
        reviewDueOn: effect?.reviewDueOn };
      if (!effect?.reviewStateAt || row.episodeCode || row.judgment?.at > effect.reviewStateAt) return next;
      return applyPreviewJudgment({ ...next, reviewStateAt: effect.reviewStateAt, status: effect.reviewStatus,
        verdict: 'unjudged', open: true, unread: false, completedAt: null, judgment: undefined });
    });
  const alertCases = cases.filter(row => row.kind === 'Alert');
  for (const row of cases) {
    if (row.kind !== 'Episode') continue;
    const relatedCodes = new Set(row.related.map(transaction => transaction.code));
    row.overlappingAlerts = alertCases.filter(alert => alert.related.some(transaction => relatedCodes.has(transaction.code)));
    row.linkedAlerts = row.linkedAlertCodes?.length ?? row.overlappingAlerts.length;
  }
  const defaultStaff = previewStaff.username;
  const incoming = cases.find(row => row.kind === 'Alert' && row.open && assignments.get(row.code) === defaultStaff);
  const outgoing = cases.find(row => row.kind === 'Episode' && row.open
    && assignments.has(row.code) && assignments.get(row.code) !== defaultStaff);
  const otherStaff = outgoing ? assignments.get(outgoing.code) : otherAnalysts[0].username;
  const assignmentChanges = [
    { row: incoming, previous: otherStaff, next: defaultStaff },
    { row: outgoing, previous: defaultStaff, next: otherStaff },
  ].filter(change => change.row).map(({ row, previous, next }) => ({
    id: `sample-assign-${row.code}`, code: row.code, before: { assignee: previous }, assignee: next,
    appliedAt: new Date(Date.parse(row.createdAt) + 45 * 60_000).toISOString(),
  }));
  return { transactions: [...allTransactions.values()], cases, mine: cases.filter(row => row.assigned),
    staff, assignmentChanges };
}

function dashboardMetrics(transactions, cases, range, history, completedPopulation, coveredEvidence) {
  const suspicious = transactions.filter(isSuspiciousTransaction);
  const alertCases = cases.filter(row => row.kind === 'Alert');
  const linked = suspicious.filter(row => coveredEvidence.has(row.code)).length;
  const byDay = Map.groupBy(cases, row => dateKey(row.date));
  const transactionsByDay = Map.groupBy(transactions, row => dateKey(row.date));
  const firstSeen = firstSeenByTransaction(history);
  const firstAvailable = new Date(`${samplePeriod[0]}T00:00:00`);
  const start = new Date(range?.from > firstAvailable ? range.from : firstAvailable);
  const end = range?.to < dashboardPeriodEnd ? range.to : dashboardPeriodEnd;
  const operationalDaily = [];
  for (const day = start; day <= end; day.setDate(day.getDate() + 1)) {
    const date = dateKey(day);
    const rows = byDay.get(date) ?? [];
    const alerts = rows.filter(row => row.kind === 'Alert');
    const transfers = transactionsByDay.get(date) ?? [];
    const flagged = transfers.filter(isSuspiciousTransaction);
    const dayLinked = flagged.filter(row => coveredEvidence.has(row.code)).length;
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
      linked: dayLinked,
      unlinked: flagged.length - dayLinked,
    });
  }
  const mine = cases.filter(row => row.assigned);
  const unfinished = mine.filter(row => row.open);
  const highRiskAlerts = unfinished.filter(row => row.kind === 'Alert' && modelRiskBand(row.score) === 'high');
  const overdueCases = unfinished.filter(row => isOverdueCaseAge(row.elapsed));
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
  const dailyCaseEvents = caseLifecycleByDay(operationalDaily.map(day => day.date), { created: cases, completed: completedPopulation });
  return {
    cases, mine, transactions, suspicious, alertCases,
    flags: Object.entries(bandNames).map(([key, name]) => ({ key, label: `${labels[key]} · ${name}`,
      count: suspicious.filter(row => modelRiskBand(row.score) === key).length })),
    settled: cases.filter(row => !row.open).length,
    ownedAlerts: mine.filter(row => row.kind === 'Alert').length,
    highRisk: highRiskAlerts.length,
    overdue: overdueCases.length,
    overdueAlerts: overdueCases.filter(row => row.kind === 'Alert').length,
    overdueEpisodes: overdueCases.filter(row => row.kind === 'Episode').length,
    unfinished: unfinished.length,
    urgent: highRiskAlerts.filter(row => isOverdueCaseAge(row.elapsed)).length,
    newAccounts: operationalDaily.reduce((total, row) => total + row.newAccounts, 0),
    newOwners: operationalDaily.reduce((total, row) => total + row.newOwners, 0),
    linked, unlinked: suspicious.length - linked,
    patterns: [...patternCounts].map(([label, count]) => ({ label, count })),
    daily: dailyCaseEvents.Alert, dailyCaseEvents, operationalDaily,
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
  const partial = mine || completedPopulation.length < scopeCases.length || cases.length < periodCases.length;
  const evidence = partial ? new Set(cases.flatMap(row => row.related.map(transaction => transaction.code))) : null;
  const eligibleTransactions = source.transactions.filter(row => includesDate(row) && (!evidence || evidence.has(row.code)));
  const transactions = [...new Map(eligibleTransactions.map(row => [row.code, row])).values()];
  const coveredEvidence = alertEvidenceCodes(partial ? (population ?? rows ?? scopeCases) : scopeCases);
  const metrics = dashboardMetrics(transactions, cases, range, source.transactions, completedPopulation, coveredEvidence);
  const businessAt = `${samplePeriod[1]}T18:00:00+09:00`;
  const todaysTransactions = mine ? [] : source.transactions.filter(row => dateKey(row.date) === samplePeriod[1]);
  const analyzedToday = todaysTransactions.filter(row => Number.isFinite(row.score));
  const todayDetection = { received: todaysTransactions.length, analyzed: analyzedToday.length,
    suspicious: analyzedToday.filter(isSuspiciousTransaction).length, basis: 'transaction-day' };
  return {
    scope: mine ? 'mine' : 'all',
    dataSource: 'sample',
    businessAt,
    period: { from, to },
    coverageScope: partial ? 'case-evidence' : 'institution',
    ...metrics,
    ...investigationDashboard(source.cases, cases, metrics.operationalDaily.map(day => day.date), {
      assignmentRows: completedPopulation, businessAt: mine ? undefined : businessAt, todayDetection,
      roster: mine ? undefined : previewAnalysts.map(person => ({ id: person.username, name: person.name })),
    }),
    sort,
  };
}

export function dashboardFixtureBoardPage(cases, { page = 0, size = 20 } = {}) {
  const start = page * size;
  return { content: cases.slice(start, start + size), number: page, size,
    totalElements: cases.length, totalPages: Math.ceil(cases.length / size) };
}
