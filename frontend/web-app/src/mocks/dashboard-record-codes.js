const dailyCounts = [
  { T: 18, A: 18, E: 18 },
  { T: 20, A: 6, E: 3 },
  { T: 15, A: 9, E: 4 },
  { T: 27, A: 5, E: 2 },
  { T: 18, A: 11, E: 4 },
  { T: 25, A: 5, E: 2 },
  { T: 22, A: 9, E: 3 },
  { T: 12, A: 4, E: 1 },
];

export const dashboardDays = dailyCounts.map((_, index) => `2026-11-${11 + index}`);
export const samplePeriod = [dashboardDays[0], dashboardDays.at(-1)];
const codeDates = new Set(dashboardDays.map(date => date.slice(2).replaceAll('-', '')));

export function isSampleTransactionCode(code) {
  return codeDates.has(code.slice(2, 8));
}

export function sampleEpisodeAlertCodes(episodeCode) {
  const [, stamp, suffix] = episodeCode.split('-');
  const episodeNumber = Number(suffix);
  const memberCount = episodeNumber % 3 === 0 ? 3 : 2;
  return Array.from({ length: memberCount }, (_, index) => `A-${stamp}-${500000 + episodeNumber * 3 + index}`);
}

export function dashboardRecordCodes({ prefix, digits, first = [] }) {
  let serial = 0;
  const records = dailyCounts.flatMap((counts, day) => {
    const stamp = dashboardDays[day].slice(2).replaceAll('-', '');
    return Array.from({ length: counts[prefix] }, (_, index) => {
      const id = prefix === 'T' ? ++serial : !day ? first[index] ?? index + 1 : index + 1;
      return `${prefix}-${stamp}-${String(id).padStart(digits, '0')}`;
    });
  });
  if (prefix !== 'A') return records;
  const episodes = dashboardRecordCodes({ prefix: 'E', digits });
  return [...records, ...episodes.flatMap(sampleEpisodeAlertCodes)];
}
