import { validWorkCode } from './preview-route.js';

const listeners = new Set();
let codes = new Set();

export function restoreWorkTabCodes(stored, defaults, legacyDefaults) {
  const validCodes = items => [...new Set(items.filter(validWorkCode))];
  if ((stored?.version === 2 || stored?.version === 3) && Array.isArray(stored.codes)) return validCodes(stored.codes);
  if (!Array.isArray(stored)) return defaults;

  const defaultCodes = new Set(defaults);
  const legacyCodes = new Set(legacyDefaults);
  return validCodes(stored).filter(code => defaultCodes.has(code) || !legacyCodes.has(code));
}

export const hasWorkTab = code => codes.has(code);

export function subscribeToWorkTabs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setWorkTabCodes(nextCodes) {
  codes = new Set(nextCodes);
  for (const listener of listeners) listener();
}
