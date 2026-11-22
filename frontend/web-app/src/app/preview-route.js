import { frames } from './screen-frames.js';
import { isSampleTransactionCode } from '../mocks/dashboard-record-codes.js';

const screens = new Set(frames.map(([, path]) => path));
const workCode = /^(?:[AE]-\d{6}-\d{6}|T-\d{6}-\d{8})$/;
const ledger = { screen: 'add-tab/owner-account-transaction', path: '/investigate/ledger' };
export const benchmarkLedgerPath = '/benchmark/ledger';
export const ledgerTableScreen = 'add-tab/owner-account-transaction-table';
export const isLedgerScreen = screen => screen === ledger.screen || screen === ledgerTableScreen;
const available = new Map([
  ['dashboard/mine', '/dashboard/mine'], ['dashboard/all', '/dashboard/all'],
  ['rule-engine/draft-list', '/rules'], ['rule-engine/draft-create', '/rules/new'],
  ['rule-engine/draft-backtest', '/rules/backtest'], ['rule-engine/draft-list/reason', '/rules/reason'],
  [ledger.screen, ledger.path],
]);
const inverse = new Map(Array.from(available, ([screen, url]) => [url, screen]));
const queryLists = {
  '/investigate/alerts': ['add-tab/alerts-cards', 'add-tab/alerts-table'],
  '/investigate/episodes': ['add-tab/episodes', 'add-tab/episodes-table'],
  '/report': ['report/write/card', 'report/write/table'],
};
const detailDefaults = { A: 'alert/overview-allpanel', E: 'episode/overview' };
export const loginRoute = { screen: 'login', code: '' };
export const dashboardRoute = { screen: 'dashboard/mine', code: '' };

export const validWorkCode = code => typeof code === 'string' && workCode.test(code);
const transactionCode = code => validWorkCode(code) && code.startsWith('T-');
export const isBenchmarkTransactionCode = code => transactionCode(code) && !isSampleTransactionCode(code);
export const initialDetail = code => detailDefaults[code[0]] ?? ledger.screen;

export function readPreviewRoute(url) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const params = url.searchParams;
  if (path === '/login') return loginRoute;
  if (path === ledger.path || path === benchmarkLedgerPath) {
    const code = params.get('transaction');
    const benchmarkLedger = path === benchmarkLedgerPath;
    return { screen: params.get('view') === 'table' ? ledgerTableScreen : ledger.screen,
      code: transactionCode(code) && (benchmarkLedger || !isBenchmarkTransactionCode(code)) ? code : '',
      ...(benchmarkLedger ? { benchmarkLedger } : {}) };
  }
  if (inverse.has(path)) return { screen: inverse.get(path), code: '' };
  if (Object.hasOwn(queryLists, path)) {
    const table = params.get('view') ? params.get('view') === 'table' : path === '/report';
    const screen = queryLists[path][Number(table)];
    const variant = `${screen}/${params.get('layout')}`;
    return { screen: screens.has(variant) ? variant : screen, code: '' };
  }
  const [, family, code = '', extra] = path.split('/');
  if (extra || !validWorkCode(code)) return dashboardRoute;
  if (family === 'transactions' && transactionCode(code)) {
    return { screen: ledger.screen, code: isBenchmarkTransactionCode(code) ? '' : code };
  }
  const prefix = family === 'alerts' ? 'A' : family === 'episodes' ? 'E' : undefined;
  if (!prefix || !code.startsWith(`${prefix}-`)) return dashboardRoute;

  const base = family.slice(0, -1);
  const tab = params.get('tab');
  const section = tab === 'analysis' || tab === 'related' ? tab : 'overview';
  let screen = `${base}/${section}`;
  const view = params.get('view');
  const readOnly = params.get('access') === 'read-only';
  if (section === 'overview') {
    if (prefix === 'A') screen += readOnly ? '-staff-readonly' : params.get('mode') === 'per' ? '-perpanel' : '-allpanel';
    else if (readOnly) screen += '/staff-readonly';
  } else {
    if (view === 'owner' || view === 'sankey') screen += `/${view}`;
    if (readOnly) screen += '/staff-readonly';
  }
  const referenceScreen = screen.replace('/sankey', '');
  const baseScreen = prefix === 'E' && readOnly ? referenceScreen.replace(/\/staff-readonly$/, '') : referenceScreen;
  return { screen: screens.has(baseScreen) ? screen : detailDefaults[prefix], code };
}

export function previewUrl({ screen, code, benchmarkLedger = false }, query = new URLSearchParams()) {
  const params = new URLSearchParams(query);
  let path = available.get(screen) ?? '/dashboard/mine';
  if (screen === 'login') path = '/login';
  else if (screen?.startsWith('dashboard/')) params.delete('view');
  else if (isLedgerScreen(screen)) {
    path = benchmarkLedger ? benchmarkLedgerPath : ledger.path;
    if (screen === ledgerTableScreen) params.set('view', 'table');
    else params.delete('view');
    params.delete('transaction');
    if (transactionCode(code) && (benchmarkLedger || !isBenchmarkTransactionCode(code))) params.set('transaction', code);
  }
  else if (code && /^(alert|episode)\//.test(screen)) {
    const [family, part, ...variants] = screen.split('/');
    path = `/${family}s/${code}`;
    const tab = /^(analysis|related)$/.test(part) ? part : 'overview';
    params.set('tab', tab);
    if (family === 'alert' && tab === 'overview') params.set('mode', part === 'overview-perpanel' ? 'per' : 'all');
    const view = variants.find(value => value === 'owner' || value === 'sankey');
    if (view) params.set('view', view);
    else params.delete('view');
    if (variants.includes('staff-readonly') || part.endsWith('-staff-readonly')) params.set('access', 'read-only');
  } else {
    for (const [target, [cards, table]] of Object.entries(queryLists)) {
      const base = screen.replace(/\/(no-filter|sidebar-collapsed)$/, '');
      if (base !== cards && base !== table) continue;
      path = target;
      params.set('view', base === table ? 'table' : 'cards');
      if (screen !== base) params.set('layout', screen.slice(base.length + 1));
      break;
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
