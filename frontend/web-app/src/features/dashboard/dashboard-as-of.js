// 기준일 대시보드: 받아 둔 업무 목록(board)을 "그 날짜를 마감한 시점"의 모습으로 되돌린다.
// 서버는 지금 상태만 내려주므로, 생성·조사 시작·종결 시각으로 그때의 상태를 다시 계산한다.
// 되돌리지 못하는 것: Alert가 Episode에 묶인 시점과 담당자가 바뀐 시점(기록이 없어 지금 상태로 보인다).
const dayMs = 86_400_000;
const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const kstMidnight = date => Date.parse(`${date}T00:00:00+09:00`);

export const isDateKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(kstMidnight(value)) && kstDate.format(kstMidnight(value)) === value;

/** 시각(ISO)이 속한 KST 날짜. 읽을 수 없으면 undefined. */
export const businessDateKey = instant => {
  const time = Date.parse(instant);
  return Number.isFinite(time) ? kstDate.format(time) : undefined;
};

/** 날짜를 days만큼 옮긴다(KST 달력 기준). */
export const shiftDateKey = (date, days) => kstDate.format(kstMidnight(date) + days * dayMs + dayMs / 2);

/** 고를 수 있는 기준일 범위. first는 첫 업무가 생긴 날, last는 오늘(업무일)이다. */
export function dashboardDateRange(source) {
  const last = businessDateKey(source.businessAt);
  let first = last;
  for (const row of source.cases) {
    const created = businessDateKey(row.createdAt);
    if (created && created < first) first = created;
  }
  return { first, last };
}

/** 주소·상태에서 읽은 기준일을 범위 안으로 맞춘다. 오늘이거나 읽을 수 없으면 undefined(오늘 화면)다. */
export function clampDashboardDate(value, { first, last }) {
  if (!isDateKey(value) || !last || value >= last) return undefined;
  return value < first ? first : value;
}

function caseAsOf(row, asOf, codes) {
  // 기준일 뒤에 종결된 업무는 그날에는 아직 열려 있었다. 종결 시각을 모르면 지금 상태를 그대로 둔다.
  const closedLater = !row.open && Date.parse(row.completedAt) > asOf;
  const open = row.open || closedLater;
  // Episode는 만든 순간부터 조사 중이다. Alert는 조사 시작 시각이 기준일 안에 있어야 조사 중이다.
  const status = !open ? row.status
    : row.kind === 'Episode' || Date.parse(row.reviewStartedAt) <= asOf ? '처리 중' : '처리 전';
  const next = {
    ...row, open, status, unread: false,
    elapsed: Math.max(0, Math.floor((asOf - Date.parse(row.createdAt)) / dayMs)),
    episodeCode: codes.has(row.episodeCode) ? row.episodeCode : undefined,
  };
  // 상태가 달라지면 그 뒤에 내린 거래별 판단도 아직 없던 것으로 본다.
  if (closedLater || status !== row.status) next.related = row.related.map(record => ({ ...record, status, verdict: 'unjudged' }));
  if (closedLater) Object.assign(next, { verdict: 'unjudged', completedAt: undefined, judgment: undefined });
  if (row.linkedAlertCodes) next.linkedAlertCodes = row.linkedAlertCodes.filter(code => codes.has(code));
  return next;
}

const views = new WeakMap(); // 받아 둔 목록 → 기준일별 결과. 같은 목록·같은 날짜는 같은 객체를 돌려준다.

/**
 * 기준일(date, 'YYYY-MM-DD')을 마감한 시점의 업무 목록.
 * 그 뒤에 생긴 업무는 빼고, 그 뒤에 조사 시작·종결된 업무는 그 전 상태로 되돌리며, 경과일은 기준일 끝까지로 다시 센다.
 */
export function sourceAsOf(source, date) {
  const cached = views.get(source)?.get(date);
  if (cached) return cached;
  const asOf = kstMidnight(date) + dayMs - 1;
  const kept = source.cases.filter(row => Date.parse(row.createdAt) <= asOf);
  const codes = new Set(kept.map(row => row.code));
  const cases = kept.map(row => caseAsOf(row, asOf, codes));
  const byCode = new Map(cases.map(row => [row.code, row]));
  for (const row of cases) {
    if (!row.overlappingAlerts) continue;
    row.overlappingAlerts = row.overlappingAlerts.flatMap(alert => byCode.get(alert.code) ?? []);
    row.linkedAlerts = row.overlappingAlerts.length;
  }
  const view = { ...source, cases, mine: cases.filter(row => row.assigned), businessAt: new Date(asOf).toISOString(), asOfDate: date };
  if (!views.has(source)) views.set(source, new Map());
  views.get(source).set(date, view);
  return view;
}
