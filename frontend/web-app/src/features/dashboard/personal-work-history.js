import { dashboardDateKey } from './dashboard-investigation.js';

const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const newestFirst = (left, right) => Date.parse(right.at) - Date.parse(left.at) || left.id.localeCompare(right.id);

export function personalWorkHistory(cases, requests, username, range) {
  const from = range?.from && dashboardDateKey(range.from);
  const to = range?.to && dashboardDateKey(range.to);
  const includes = at => {
    const time = Date.parse(at);
    if (!Number.isFinite(time)) return false;
    const date = dateFormat.format(time);
    return (!from || date >= from) && (!to || date <= to);
  };
  const assignments = [];
  const judgments = new Map();
  const recordJudgment = (code, verdict, at, judgment) => {
    if (!['normal', 'abnormal'].includes(verdict) || !includes(at)) return;
    const id = judgment?.id ?? `${code}/${at}`;
    judgments.set(id, { id, code, verdict, at, judgment });
  };
  for (const request of requests ?? []) {
    const { code, before, assignee: next, appliedAt: at } = request;
    const previous = before?.assignee;
    if (previous && next && previous !== next && [previous, next].includes(username) && includes(at)) {
      assignments.push({ id: request.id, code, at, previous, next, incoming: next === username });
    }
    if (previous === username && before?.judgment) {
      recordJudgment(code, before.verdict, before.judgment.at ?? before.completedAt, before.judgment);
    }
  }
  for (const row of cases) {
    if (row.assignee !== username || row.episodeCode) continue;
    recordJudgment(row.code, row.verdict, row.judgment?.at ?? row.completedAt, row.judgment);
  }
  return { assignments: requests ? assignments.sort(newestFirst) : null,
    judgments: [...judgments.values()].sort(newestFirst) };
}
