import { currentPreviewUser } from '../auth/preview-session-user.js';
import { fetchLiveRiskBands, saveLiveRiskBands } from './live-settings.js';

const key = 'aml-live-layout-model-risk-bands';
const defaults = [70, 90];
const valid = values => Array.isArray(values) && values.length === 2 &&
  values.every(value => Number.isInteger(value) && value >= 1 && value <= 99) && values[0] < values[1];
let thresholds = defaults;
try {
  const saved = JSON.parse(sessionStorage.getItem(key));
  if (valid(saved)) thresholds = saved;
} catch {
  // The preview continues with the default bands if storage is unavailable.
}

export const getModelRiskThresholds = () => [...thresholds];

export function modelRiskBand(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) return 'unknown';
  if (score >= thresholds[1]) return 'high';
  return score >= thresholds[0] ? 'medium' : 'low';
}

export function modelRiskLabels() {
  const [medium, high] = thresholds;
  return { high: `${high}점 이상`, medium: `${medium}~${high - 1}점`, low: `${medium}점 미만`, unknown: '점수 없음' };
}

// 서비스 모드: 서버에 저장된 구간을 화면 기준으로 쓴다.
export async function loadLiveModelRiskThresholds() {
  const saved = await fetchLiveRiskBands();
  if (valid(saved)) thresholds = saved;
}

export function saveModelRiskThresholds(values) {
  const user = currentPreviewUser();
  if (user?.role !== 'ADMIN' || !valid(values)) return false;
  if (user.source === 'api') return saveLiveRiskBands(values).then(saved => {
    if (!saved) return false;
    thresholds = [...values];
    document.dispatchEvent(new Event('aml:model-risk'));
    return true;
  });
  if (user.source !== 'fixture') return false;
  thresholds = [...values];
  try { sessionStorage.setItem(key, JSON.stringify(thresholds)); } catch { /* Use the current tab's in-memory value. */ }
  document.dispatchEvent(new Event('aml:model-risk'));
  return true;
}
