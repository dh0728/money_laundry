import { accountTrailComparison, findAccountTrail } from './dashboard-recommendation.js';
import { isOverdueCaseAge } from '../investigation/case-age.js';

export const dashboardDateKey = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map(value => String(value).padStart(2, '0')).join('-');
const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
export const dashboardBusinessDate = instant => {
  const time = Date.parse(instant);
  return Number.isFinite(time) ? kstDate.format(time) : null;
};
const assigneeKey = row => row.assigneeId ?? row.assignee ?? row.assigneeName;

export function caseLifecycleByDay(dates, { created, completed }) {
  const kinds = ['Alert', 'Episode'];
  const byKind = new Map(kinds.map(kind => [kind, new Map(dates.map(day => [day, { day, incoming: 0, completed: 0 }]))]));
  for (const row of created) {
    const creationDate = dashboardBusinessDate(row.createdAt) ?? (row.date && dashboardDateKey(row.date));
    const events = byKind.get(row.kind)?.get(creationDate);
    if (events) events.incoming++;
  }
  for (const row of completed) {
    const events = byKind.get(row.kind)?.get(dashboardBusinessDate(row.completedAt));
    if (events) events.completed++;
  }
  return Object.fromEntries(kinds.map(kind => [kind, [...byKind.get(kind).values()]]));
}

export function alertEvidenceCodes(cases) {
  return new Set(cases.filter(row => row.kind === 'Alert').flatMap(row => row.related.map(transaction => transaction.code)));
}

const statusCounts = () => ({ pending: 0, inProgress: 0, done: 0 });
const routeCounts = () => ({ ...statusCounts(), verdicts: { normal: 0, suspicious: 0, unclassified: 0 } });
const alertStatuses = { '처리 전': 'pending', '처리 중': 'inProgress', '처리 완료': 'done' };
const boardStatuses = { pending: '처리 전', inProgress: '처리 중', done: '처리 완료' };
const verdicts = { normal: 'normal', abnormal: 'suspicious' };

function staffWorkload(openWork, overdue, assignmentRows, dates, roster) {
  const dateSet = new Set(dates);
  const assignments = Map.groupBy(assignmentRows.filter(row => {
    return dateSet.has(dashboardBusinessDate(row.assignedAt));
  }), assigneeKey);
  const activeByStaff = Map.groupBy(openWork, assigneeKey);
  const overdueByStaff = Map.groupBy(overdue, assigneeKey);
  const staffById = new Map(roster?.map(person => [person.id, person]));
  const keys = new Set([...staffById.keys(), ...activeByStaff.keys(), ...assignments.keys()]);
  const byAssignee = [...keys].filter(key => key !== undefined && key !== null && key !== '').map(key => {
    const person = staffById.get(key);
    const record = activeByStaff.get(key)?.[0] ?? assignments.get(key)?.[0];
    return { id: key, name: person?.name ?? record?.assigneeName ?? record?.assignee ?? String(key),
      registered: staffById.has(key), total: activeByStaff.get(key)?.length ?? 0,
      overdue: overdueByStaff.get(key)?.length ?? 0, assignments: assignments.get(key)?.length ?? 0 };
  }).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'ko'));
  const registeredAssignments = byAssignee.reduce((sum, row) => sum + (row.registered ? row.assignments : 0), 0);
  return { total: openWork.length, byAssignee, overdue, staffCount: staffById.size,
    unknownElapsed: openWork.filter(row => !hasElapsedDays(row)).length,
    equalAssignments: staffById.size ? registeredAssignments / staffById.size : null };
}

const priorityLimit = 8;
const prolongedAgeDays = 7;
const hasElapsedDays = row => Number.isFinite(row.elapsed) && row.elapsed >= 0;
const comparePriority = (left, right) => right.priorityScore - left.priorityScore || right.score - left.score ||
  right.elapsed - left.elapsed || left.code.localeCompare(right.code);

function workPriority(openWork, roster) {
  const staff = new Map(roster?.map(person => [person.id, person.name]));
  return openWork.filter(row => hasElapsedDays(row) && Number.isFinite(row.score) && row.score >= 0 && row.score <= 100)
    .map(row => ({ ...row, priorityScore: row.score * row.elapsed, assigneeName: row.assigneeName ?? staff.get(assigneeKey(row)) }))
    .sort(comparePriority).slice(0, priorityLimit);
}

function patternAlerts(cases) {
  const alertsByPattern = Map.groupBy(cases.filter(row => row.kind === 'Alert'),
    row => row.pattern?.replace(/\s+\d+%$/, '').trim() || '패턴 미특정');
  return [...alertsByPattern.entries()].map(([label, rows]) => ({ label, count: rows.length }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ko'));
}

function currentWorkSnapshot(allCases, isIndependentWork, businessAt, detection) {
  const date = dashboardBusinessDate(businessAt);
  const asOf = Date.parse(businessAt);
  const snapshot = { date, openAlerts: 0, openEpisodes: 0, createdAlerts: 0, overdue3Days: 0, overdue7Days: 0,
    createdCases: 0, completedCreatedCases: 0, completedCases: 0, completionSampleCount: 0, averageCompletionSeconds: null, detection };
  let totalCompletionSeconds = 0;
  for (const row of allCases) {
    const created = Date.parse(row.createdAt);
    const createdToday = created <= asOf && dashboardBusinessDate(row.createdAt) === date;
    if (createdToday && row.kind === 'Alert') snapshot.createdAlerts++;
    if (!isIndependentWork(row) || created > asOf) continue;
    if (createdToday) snapshot.createdCases++;
    if (row.open) {
      if (row.kind === 'Alert') snapshot.openAlerts++;
      else snapshot.openEpisodes++;
      if (hasElapsedDays(row) && isOverdueCaseAge(row.elapsed)) snapshot.overdue3Days++;
      if (hasElapsedDays(row) && row.elapsed >= prolongedAgeDays) snapshot.overdue7Days++;
      continue;
    }
    const completed = Date.parse(row.completedAt);
    if (!(completed <= asOf && dashboardBusinessDate(row.completedAt) === date)) continue;
    snapshot.completedCases++;
    if (createdToday) snapshot.completedCreatedCases++;
    if (!Number.isFinite(created) || completed < created) continue;
    snapshot.completionSampleCount++;
    totalCompletionSeconds += (completed - created) / 1000;
  }
  if (snapshot.completionSampleCount) snapshot.averageCompletionSeconds = totalCompletionSeconds / snapshot.completionSampleCount;
  return snapshot;
}

export function investigationDashboard(allCases, cases, dates, { assignmentRows = cases, roster, businessAt, todayDetection = null } = {}) {
  const episodes = new Map(allCases.filter(row => row.kind === 'Episode').map(row => [row.code, row]));
  const episodeByAlert = new Map();
  for (const episode of episodes.values()) {
    for (const alertCode of episode.linkedAlertCodes ?? []) episodeByAlert.set(alertCode, episode);
  }

  const alertDays = new Map(dates.map(date => [date, { date, ...statusCounts() }]));
  const individualAlertDays = new Map(dates.map(date => [date, { date, ...statusCounts() }]));
  const episodeDays = new Map(dates.map(date => [date, { date, ...statusCounts() }]));
  const routes = { individual: routeCounts(), episode: routeCounts() };
  const linkedEpisodes = new Set();
  const statusByCode = {};
  const verdictByCode = {};
  let individualAlerts = 0;
  let episodeAlerts = 0;
  for (const row of cases) {
    const date = dashboardDateKey(row.date);
    if (row.kind === 'Episode') {
      const day = episodeDays.get(date);
      const status = row.open ? 'inProgress' : 'done';
      if (day) day[status]++;
      statusByCode[row.code] = boardStatuses[status];
      if (status === 'done') verdictByCode[row.code] = row.verdict;
      continue;
    }
    if (row.kind !== 'Alert') continue;

    const episode = episodes.get(row.episodeCode) ?? episodeByAlert.get(row.code);
    const route = episode ? routes.episode : routes.individual;
    const status = episode ? (episode.open ? 'inProgress' : 'done') : alertStatuses[row.status];
    statusByCode[row.code] = boardStatuses[status];
    if (episode) {
      linkedEpisodes.add(episode.code);
      episodeAlerts++;
    } else {
      individualAlerts++;
      const day = individualAlertDays.get(date);
      if (day) day[status]++;
    }
    route[status]++;
    if (status === 'done') {
      const verdict = (episode ?? row).verdict;
      verdictByCode[row.code] = verdict;
      route.verdicts[verdicts[verdict] ?? 'unclassified']++;
    }
    const day = alertDays.get(date);
    if (day) day[status]++;
  }

  const dailyAlertStatus = [...alertDays.values()];
  const recommendation = findAccountTrail(cases);
  const isIndependentWork = row => row.kind === 'Episode' || (row.kind === 'Alert' && !row.episodeCode && !episodeByAlert.has(row.code));
  const openWork = cases.filter(row => row.open && isIndependentWork(row));
  const overdueWork = openWork.filter(row => hasElapsedDays(row) && isOverdueCaseAge(row.elapsed));
  const asOf = Date.parse(businessAt);
  return {
    ...(businessAt && {
      todaySnapshot: currentWorkSnapshot(allCases, isIndependentWork, businessAt, todayDetection),
      priorityCases: workPriority(allCases.filter(row => row.open && isIndependentWork(row) && !(Date.parse(row.createdAt) > asOf)), roster),
      patternAlertCounts: patternAlerts(cases),
    }),
    dailyAlertStatus,
    dailyIndividualAlertStatus: [...individualAlertDays.values()],
    dailyEpisodeStatus: [...episodeDays.values()],
    accountRecommendation: recommendation && { ...recommendation, comparison: accountTrailComparison(recommendation, allCases) },
    institutionWorkload: staffWorkload(openWork, overdueWork, assignmentRows, dates, roster),
    investigation: {
      totalAlerts: individualAlerts + episodeAlerts,
      individualAlerts, episodeAlerts, linkedEpisodes: linkedEpisodes.size, routes, dailyAlertStatus, statusByCode, verdictByCode,
    },
  };
}
