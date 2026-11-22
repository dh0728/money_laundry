import { getJson, postJson } from '@/api/common';
import { liveSource, transactionCode } from '../investigation/live-data.js';

// 서비스 모드에서 룰 화면이 쓰는 서버 호출. 결과 모양은 프리뷰 저장 함수와 같다.
export const liveRules = import.meta.env.VITE_API_MODE === 'live';
const backtestDays = 30; // 영업일 기준 최근 30일을 백테스트 대상으로 본다.
const failure = (error, fallback) => ({ ok: false, error: error?.problem?.detail ?? error?.problem?.title ?? fallback });
const kstDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const conditions = ({ name, description, typeCode, scoreMin, minTransactions, windowHours }) =>
  ({ name, description, typeCode, scoreMin, minTransactions, windowHours });

export const fetchLiveRules = () => getJson('/api/v1/rules');

export async function saveLiveRule(input, existingId) {
  try {
    return { ok: true, value: await postJson(existingId ? `/api/v1/rules/${existingId}` : '/api/v1/rules', conditions(input)) };
  } catch (error) {
    return failure(error, '룰을 저장하지 못했습니다.');
  }
}

export async function reviewLiveRule(id, status, reason) {
  try {
    return { ok: true, value: await postJson(`/api/v1/rules/${id}/review`, { status, reason }) };
  } catch (error) {
    return failure(error, '룰 상태와 처리 권한을 확인해 주세요.');
  }
}

export async function liveBacktestScope() {
  const end = kstDate.format(new Date(liveSource().businessAt ?? Date.now()));
  const first = new Date(`${end}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - backtestDays + 1);
  const start = first.toISOString().slice(0, 10);
  const ledger = await getJson(`/api/v1/dashboard/transaction-days?from=${start}&to=${end}`);
  return { start, end, count: ledger.days.reduce((total, day) => total + day.total, 0) };
}

export async function runLiveBacktest(rule, period, { limit } = {}) {
  const result = await postJson('/api/v1/rules/backtest', { rule: conditions(rule), start: period.start, end: period.end, limit });
  return { ...result, transactions: result.transactions.map(row => ({ ...row, id: row.txId, displayId: transactionCode(row) })) };
}
