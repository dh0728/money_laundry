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
  return {
    dailyAlertStatus,
    dailyEpisodeStatus: [...episodeDays.values()],
    investigation: {
      totalAlerts: individualAlerts + episodeAlerts,
      individualAlerts, episodeAlerts, linkedEpisodes: linkedEpisodes.size, routes, dailyAlertStatus, statusByCode,
    },
  };
}
