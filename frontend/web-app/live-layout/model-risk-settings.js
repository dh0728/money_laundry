import { currentPreviewUser } from './preview-session-user.js';

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

export function saveModelRiskThresholds(values) {
  const user = currentPreviewUser();
  if (user?.role !== 'ADMIN' || user.source !== 'fixture' || !valid(values)) return false;
  thresholds = [...values];
  try { sessionStorage.setItem(key, JSON.stringify(thresholds)); } catch { /* Use the current tab's in-memory value. */ }
  document.dispatchEvent(new Event('aml:model-risk'));
  return true;
}
