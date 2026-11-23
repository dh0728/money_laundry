import { getJson } from '@/api/common';
import { modelRiskBand, modelRiskLabels } from '../settings/model-risk-settings.js';

// 서비스 모드 대시보드 숫자. 화면이 읽는 모양은 mocks/dashboard-fixtures.js의 dashboardFixtureResponse와 같다.
// 업무 지표는 서버에서 받은 Alert·Episode로 계산한다. 전체 거래 수·의심 거래 수·유형별 수는 서버 집계를 읽고,
// 내 담당이나 필터처럼 일부 사건만 볼 때는 그 사건의 근거 거래로 계산한다.
const defaultDays = 8; // 샘플 화면의 기본 조회 폭과 같다.
const bandNames = { high: '위험', medium: '주의', low: '낮음' };
const kpiHours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateKey = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map(value => String(value).padStart(2, '0')).join('-');
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

export const liveDashboardAsOf = source => new Date(`${kstDate.format(new Date(source.businessAt))}T00:00:00`);

export async function liveDashboardResponse(source, { mine, rows, population, range, sort } = {}) {
  const scopeCases = mine ? source.mine : source.cases;
  const completedPopulation = population ?? scopeCases;
  const end = range?.to ?? liveDashboardAsOf(source);
  const start = range?.from ?? new Date(end.getFullYear(), end.getMonth(), end.getDate() - defaultDays + 1);
  const from = dateKey(start);
  const to = dateKey(end);
  const includesDate = row => {
    const date = dateKey(row.date);
    return date >= from && date <= to;
  };
  const periodCases = scopeCases.filter(includesDate);
  const cases = (rows ?? completedPopulation).filter(includesDate);
  const partial = mine || completedPopulation.length < scopeCases.length || cases.length < periodCases.length;
  const evidence = new Set(cases.flatMap(row => row.related.map(transaction => transaction.code)));
  const members = source.transactions.filter(row => includesDate(row) && evidence.has(row.code));
  const flagged = members.filter(row => row.suspicious);
  const ledger = partial ? undefined : await getJson(`/api/v1/dashboard/transaction-days?from=${from}&to=${to}`);
  const ledgerDays = new Map(ledger?.days.map(day => [day.date, day]));
  const ledgerHours = new Map(ledger?.hours.map(hour => [hour.hour, hour]));

  const alertCases = cases.filter(row => row.kind === 'Alert');
  const linked = new Set(alertCases.flatMap(row => row.related.map(transaction => transaction.code)));
  const byDay = Map.groupBy(cases, row => dateKey(row.date));
  const membersByDay = Map.groupBy(members, row => dateKey(row.date));
  const completions = Map.groupBy(completedPopulation.filter(row => row.kind === 'Alert' && row.completedAt),
    row => kstDate.format(new Date(row.completedAt)));
  const dailyAlertStatus = [];
  const operationalDaily = [];
  const daily = [];
  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const date = dateKey(day);
    const dayCases = byDay.get(date) ?? [];
    const alerts = dayCases.filter(row => row.kind === 'Alert');
    const transfers = membersByDay.get(date) ?? [];
    const suspicious = transfers.filter(row => row.suspicious);
    const counted = ledgerDays.get(date);
    dailyAlertStatus.push({
      date,
      pending: alerts.filter(row => row.status === '처리 전').length,
      inProgress: alerts.filter(row => row.status === '처리 중').length,
      done: alerts.filter(row => row.status === '처리 완료').length,
    });
    daily.push({ day: date, incoming: alerts.length, completed: completions.get(date)?.length ?? 0 });
    operationalDaily.push({
      date, label: `${day.getMonth() + 1}/${day.getDate()}`,
      total: counted?.total ?? transfers.length,
      suspicious: counted?.suspicious ?? suspicious.length,
      alerts: alerts.length,
      openAlerts: alerts.filter(row => row.open).length,
      openEpisodes: dayCases.filter(row => row.kind === 'Episode' && row.open).length,
      // 그날 처음 등장한 계좌·소유주 수는 전체 원장 기준 서버 집계다. 일부 사건만 볼 때는 세지 않는다.
      newAccounts: counted?.newAccounts ?? 0, newOwners: counted?.newOwners ?? 0,
      settled: dayCases.filter(row => !row.open).length,
      totalCases: dayCases.length,
      linked: suspicious.filter(row => linked.has(row.code)).length,
    });
  }

  const owned = cases.filter(row => row.assigned);
  const unfinished = owned.filter(row => row.open);
  const highRiskAlerts = unfinished.filter(row => row.kind === 'Alert' && modelRiskBand(row.score) === 'high');
  const overdueCases = unfinished.filter(row => row.elapsed >= 3);
  const patternCounts = new Map();
  if (ledger) {
    for (const { type, count } of ledger.types) patternCounts.set(type === 'NON_PATTERN' ? '미분류' : type, count);
  } else {
    const patternByTransaction = new Map();
    for (const row of [...alertCases].sort((left, right) => left.code.localeCompare(right.code))) {
      for (const transaction of row.related) {
        if (!patternByTransaction.has(transaction.code)) patternByTransaction.set(transaction.code, row.pattern.replace(/ \d+%$/, ''));
      }
    }
    for (const transaction of flagged) {
      const pattern = patternByTransaction.get(transaction.code) ?? '미분류';
      patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
    }
  }
  const labels = modelRiskLabels();
  return {
    scope: mine ? 'mine' : 'all',
    businessAt: source.businessAt,
    period: { from, to },
    cases, mine: owned, alertCases,
    // 화면은 두 목록의 건수만 읽는다. 전체 거래는 서버 건수로 채운다.
    transactions: ledger ? { length: sum(operationalDaily, 'total') } : members,
    suspicious: ledger ? { length: sum(operationalDaily, 'suspicious') } : flagged,
    // 전체를 볼 때는 서버가 센 점수별 의심 거래 수를 구간으로 묶는다. 일부 사건만 볼 때는 근거 거래 점수로 센다.
    flags: Object.entries(bandNames).map(([key, name]) => ({ key, label: `${labels[key]} · ${name}`,
      count: ledger
        ? ledger.scores.filter(point => modelRiskBand(point.scorePct) === key).reduce((total, point) => total + point.count, 0)
        : flagged.filter(row => modelRiskBand(row.score) === key).length })),
    settled: cases.filter(row => !row.open).length,
    ownedAlerts: owned.filter(row => row.kind === 'Alert').length,
    highRisk: highRiskAlerts.length,
    overdue: overdueCases.length,
    unfinished: unfinished.length,
    urgent: highRiskAlerts.filter(row => row.elapsed >= 3).length,
    newAccounts: sum(operationalDaily, 'newAccounts'), newOwners: sum(operationalDaily, 'newOwners'),
    linked: flagged.filter(row => linked.has(row.code)).length,
    patterns: [...patternCounts].map(([label, count]) => ({ label, count })),
    daily, dailyAlertStatus, operationalDaily,
    hourly: kpiHours.map((label, i) => ({
      label,
      // 전체를 볼 때는 서버가 센 시간대별 거래 수를 쓴다(09시가 첫 칸). 일부 사건만 볼 때는 근거 거래로 센다.
      total: ledger ? ledgerHours.get(i + 9)?.total ?? 0 : members.filter(row => row.hour === i).length,
      suspicious: ledger ? ledgerHours.get(i + 9)?.suspicious ?? 0 : flagged.filter(row => row.hour === i).length,
      mine: owned.filter(row => row.kind === 'Alert' && row.hour === i).length,
      highRisk: highRiskAlerts.filter(row => row.hour === i).length,
      overdue: overdueCases.filter(row => row.hour === i).length,
      alerts: alertCases.filter(row => row.hour === i).length,
      pending: alertCases.filter(row => row.hour === i && row.status === '처리 전').length,
      inProgress: alertCases.filter(row => row.hour === i && row.status === '처리 중').length,
      done: alertCases.filter(row => row.hour === i && row.status === '처리 완료').length,
    })),
    sort,
  };
}
