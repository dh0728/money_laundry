import { accountTrailComparison, findAccountTrail } from './dashboard-recommendation.js';
import { isOverdueCaseAge } from '../investigation/case-age.js';

export const dashboardDateKey = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map(value => String(value).padStart(2, '0')).join('-');

export function alertEvidenceCodes(cases) {
  return new Set(cases.filter(row => row.kind === 'Alert').flatMap(row => row.related.map(transaction => transaction.code)));
}

const statusCounts = () => ({ pending: 0, inProgress: 0, done: 0 });
const routeCounts = () => ({ ...statusCounts(), verdicts: { normal: 0, suspicious: 0, unclassified: 0 } });
const alertStatuses = { '처리 전': 'pending', '처리 중': 'inProgress', '처리 완료': 'done' };
const boardStatuses = { pending: '처리 전', inProgress: '처리 중', done: '처리 완료' };
const verdicts = { normal: 'normal', abnormal: 'suspicious' };

export function investigationDashboard(allCases, cases, dates) {
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
  const byAssignee = [...Map.groupBy(openWork, row => row.assigneeId ?? row.assignee ?? row.assigneeName).values()]
    .flatMap(rows => {
      const { assigneeId, assignee, assigneeName } = rows[0];
      return assigneeId != null || assignee || assigneeName
        ? [{ assignee, name: assigneeName, total: rows.length }] : [];
    }).sort((first, second) => second.total - first.total);
  return {
    dailyAlertStatus,
    dailyEpisodeStatus: [...episodeDays.values()],
    accountRecommendation: recommendation && { ...recommendation, comparison: accountTrailComparison(recommendation, allCases) },
    institutionWorkload: { total: openWork.length, byAssignee, overdue: overdueWork },
    investigation: {
      totalAlerts: individualAlerts + episodeAlerts,
      individualAlerts, episodeAlerts, linkedEpisodes: linkedEpisodes.size, routes, dailyAlertStatus, statusByCode,
    },
  };
}
