import { validWorkCode } from './preview-route.js';

const storageKey = 'aml-live-layout-read-cases';
const isCaseCode = code => validWorkCode(code) && !code.startsWith('T-');
const readCases = new Set();

try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
  if (Array.isArray(saved)) {
    saved.filter(isCaseCode).forEach(code => readCases.add(code));
  }
} catch {
  // Case details remain usable when session storage is unavailable.
}

export function wasPreviewCaseRead(code) {
  return readCases.has(code);
}

export function markPreviewCaseRead(row) {
  if (!row?.unread || !isCaseCode(row.code) || readCases.has(row.code)) return false;
  readCases.add(row.code);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...readCases]));
  } catch {
    // Keep the read state in memory for the current preview.
  }
  return true;
}

export function resetPreviewCaseRead() {
  readCases.clear();
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // The in-memory read state was reset.
  }
}
