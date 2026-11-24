import { accountTrailComparison, findAccountTrail } from './dashboard-recommendation.js';
import { isOverdueCaseAge } from '../investigation/case-age.js';

export const dashboardDateKey = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map(value => String(value).padStart(2, '0')).join('-');
const assignmentDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const assigneeKey = row => row.assigneeId ?? row.assignee ?? row.assigneeName;

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
    const time = Date.parse(row.assignedAt);
    return Number.isFinite(time) && dateSet.has(assignmentDate.format(time));
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
    equalAssignments: staffById.size ? registeredAssignments / staffById.size : null };
}

export function investigationDashboard(allCases, cases, dates, { assignmentRows = cases, roster } = {}) {
  const episodes = new Map(allCases.filter(row => row.kind === 'Episode').map(row => [row.code, row]));
  const episodeByAlert = new Map();
  for (const episode of episodes.values()) {
    for (const alertCode of episode.linkedAlertCodes ?? []) episodeByAlert.set(alertCode, episode);
  }

  const alertDays = new Map(dates.map(date => [date, { date, ...statusCounts() }]));
  const episodeDays = new Map(dates.map(date => [date, { date, ...statusCounts() }]));
  const routes = { individual: routeCounts(), episode: routeCounts() };
  const linkedEpisodes = new Set();
  const statusByCode = {};
  let individualAlerts = 0;
  let episodeAlerts = 0;
  for (const row of cases) {
    const date = dashboardDateKey(row.date);
    if (row.kind === 'Episode') {
      const day = episodeDays.get(date);
      const status = row.open ? 'inProgress' : 'done';
      if (day) day[status]++;
      statusByCode[row.code] = boardStatuses[status];
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
    }
    route[status]++;
    if (status === 'done') route.verdicts[verdicts[(episode ?? row).verdict] ?? 'unclassified']++;
    const day = alertDays.get(date);
    if (day) day[status]++;
  }

  const dailyAlertStatus = [...alertDays.values()];
  const recommendation = findAccountTrail(cases);
  const openWork = cases.filter(row => row.open && (row.kind === 'Episode' ||
    (row.kind === 'Alert' && !row.episodeCode && !episodeByAlert.has(row.code))));
  const overdueWork = openWork.filter(row => isOverdueCaseAge(row.elapsed));
  return {
    dailyAlertStatus,
    dailyEpisodeStatus: [...episodeDays.values()],
    accountRecommendation: recommendation && { ...recommendation, comparison: accountTrailComparison(recommendation, allCases) },
    institutionWorkload: staffWorkload(openWork, overdueWork, assignmentRows, dates, roster),
    investigation: {
      totalAlerts: individualAlerts + episodeAlerts,
      individualAlerts, episodeAlerts, linkedEpisodes: linkedEpisodes.size, routes, dailyAlertStatus, statusByCode,
    },
  };
}
