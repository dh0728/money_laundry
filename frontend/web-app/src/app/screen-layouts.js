import { frames } from './screen-frames.js';
import { isLedgerScreen, ledgerTableScreen } from './preview-route.js';

const titles = {
  'dashboard/mine': '내 대시보드', 'dashboard/all': '전체 대시보드',
  'rule-engine/draft-list': '룰 목록', 'rule-engine/draft-create': '룰 만들기',
  'rule-engine/draft-backtest': '백테스트', 'rule-engine/draft-list/reason': '변경 사유',
  'add-tab/owner-account-transaction': '소유주·계좌·거래', 'add-tab/alerts-cards': 'Alert 카드',
  [ledgerTableScreen]: '통합 테이블',
  'add-tab/alerts-table': 'Alert 표', 'add-tab/episodes': 'Episode 카드',
  'add-tab/episodes-table': 'Episode 표', 'report/write/table': '보고서 표',
  'report/write/card': '보고서 카드', notifications: '보관함', account: '계정',
};
const detailLabels = {
  overview: '개요', 'overview-allpanel': '개요', 'overview-perpanel': '패널 보기',
  analysis: '분석', related: '관련', judge: '판정', 'judge-single': '단건 판정', 'judge-bundle': '묶음 판정',
};
const variationLabels = {
  owner: '소유주', sankey: '생키', 'staff-readonly': '읽기 전용', 'no-filter': '필터 없음',
  'sidebar-collapsed': '사이드바 닫힘', judged: '판정 완료',
};

function frameLabel(path) {
  if (titles[path]) return titles[path];
  const [family, type, ...rest] = path.split('/');
  if (family === 'alert' || family === 'episode') {
    const detail = type.replace(/-staff-readonly$/, '');
    const variants = type.endsWith('-staff-readonly') ? ['staff-readonly', ...rest] : rest;
    return [detailLabels[detail], ...variants.map(item => variationLabels[item])].join(' · ');
  }
  const base = path.slice(0, path.lastIndexOf('/'));
  return [titles[base], variationLabels[rest.at(-1)]].filter(Boolean).join(' · ');
}

export const sections = {
  dashboard: 'dashboard/mine',
  rules: 'rule-engine/draft-list',
  report: 'report/write/table',
  T: 'add-tab/owner-account-transaction',
  A: 'add-tab/alerts-cards',
  E: 'add-tab/episodes',
};

export const workspaceDestinations = [
  { icon: 'dashboard', label: '대시보드', value: sections.dashboard, routes: ['dashboard'] },
  { icon: 'rules', label: '룰엔진', value: sections.rules, routes: ['rule-engine'] },
  { icon: 'compass', label: '조사', value: sections.T, routes: ['add-tab', 'alert', 'episode'] },
  { icon: 'report', label: '보고서 작성', value: sections.report, routes: ['report'] },
];

export function currentWorkspace(path) {
  return workspaceDestinations.find(({ routes }) => routes.includes(path?.split('/')[0]));
}

const rows = Object.fromEntries(frames.map(([id, path]) => [path, id]));
const category = path => path.includes('/') ? path.split('/')[0] : 'utility';
const workspaceLabels = {
  dashboard: '대시보드', 'rule-engine': '룰엔진', 'add-tab': '조사', report: '보고서 작성',
  alert: 'Alert', episode: 'Episode',
};
const navigatorLabels = {
  'dashboard/mine': '개인', 'dashboard/all': '전체',
  'rule-engine/draft-list': '목록', 'rule-engine/draft-create': '만들기',
};
const caseTabs = [['overview', '개요'], ['analysis', '분석'], ['related', '관련']];

function caseRoute(path) {
  const [family, detail, ...states] = path.split('/');
  if (family !== 'alert' && family !== 'episode') return undefined;
  const tab = detail === 'analysis' ? 'analysis' :
    detail === 'related' || detail === 'judge-bundle' ? 'related' : 'overview';
  const lens = states.find(state => state === 'owner' || state === 'sankey') ?? 'pattern';
  return { family, detail, tab, lens,
    readOnly: detail === 'overview-staff-readonly' || states.includes('staff-readonly') };
}

function caseTabPath({ family, readOnly, lens }, tab) {
  if (tab === 'overview') {
    if (family === 'episode') return readOnly ? 'episode/overview/staff-readonly' : 'episode/overview';
    return readOnly ? 'alert/overview-staff-readonly' : 'alert/overview-allpanel';
  }
  return `${family}/${tab}${lens === 'pattern' ? '' : `/${lens}`}${readOnly ? '/staff-readonly' : ''}`;
}

const viewModes = [
  { label: '소유주·계좌·거래', card: sections.T, table: ledgerTableScreen },
  { label: 'Alert', card: sections.A, table: 'add-tab/alerts-table' },
  { label: 'Episode', card: sections.E, table: 'add-tab/episodes-table' },
  { label: '보고서 작성', card: 'report/write/card', table: sections.report },
];

function viewMode(path) {
  const base = path.replace(/\/(no-filter|sidebar-collapsed)$/, '');
  return viewModes.find(({ card, table }) => base === card || base === table);
}

function navigationItem(label, destination, active, value = destination) {
  return { label, destination, active, value };
}

function caseNavigation(path, route) {
  let views = [];
  if (route.family === 'alert' && /^overview-(allpanel|perpanel)$/.test(route.detail)) {
    views = [['전체', 'alert/overview-allpanel'], ['패널별', 'alert/overview-perpanel']];
  } else if (route.detail === 'analysis' || route.detail === 'related') {
    views = [
      ['패턴별', caseTabPath({ ...route, lens: 'pattern' }, route.tab)],
      ['소유주별', caseTabPath({ ...route, lens: 'owner' }, route.tab)],
      ['생키', caseTabPath({ ...route, lens: 'sankey' }, route.tab)],
    ];
  }

  return {
    primary: caseTabs.map(([tab, label]) => {
      const active = route.tab === tab;
      return navigationItem(label, active ? path : caseTabPath(route, tab), active, tab);
    }),
    secondary: views.map(([label, destination]) => navigationItem(label, destination, path === destination, label)),
  };
}

export function ScreenNavigation(path, code = '') {
  const family = category(path);
  const area = currentWorkspace(path);
  const global = workspaceDestinations.map(item => ({ ...item,
    current: item === area ? (path === item.value && !code ? 'page' : 'location') : undefined }));
  const location = code ? { text: code, record: true }
    : { text: workspaceLabels[family] ?? titles[path] };
  const route = caseRoute(path);
  if (route) return { global, location, ...caseNavigation(path, route) };
  if (family === 'utility') return { global, location, primary: [], secondary: [] };
  const basePath = path === 'rule-engine/draft-list/reason' ? sections.rules : path;
  const activeMode = viewMode(path);
  const primary = frames.filter(([, candidate]) => {
    if (category(candidate) !== family || candidate === 'rule-engine/draft-list/reason') return false;
    const mode = viewMode(candidate);
    return !mode || candidate === (candidate.startsWith('report/') ? mode.table : mode.card);
  }).map(([, candidate]) => {
    const mode = viewMode(candidate);
    const active = mode ? mode === activeMode : candidate === basePath;
    return navigationItem(mode?.label ?? navigatorLabels[candidate] ?? frameLabel(candidate), active ? path : candidate, active, candidate);
  });
  const suffix = path.match(/\/(no-filter|sidebar-collapsed)$/)?.[0] ?? '';
  const secondary = activeMode ? [['표', activeMode.table], ['카드', activeMode.card]]
    .map(([label, base]) => {
      const destination = rows[base + suffix] ? base + suffix : base;
      return navigationItem(label, destination, destination === path, label);
    }) : [];
  const duplicatesLocation = primary.length === 1 && primary[0].active && primary[0].label === location.text;
  return { global, location, primary: duplicatesLocation ? [] : primary, secondary };
}

export const panel = (title, kind = '') => `<section class="screen-panel glass ${kind}"><h2>${title}</h2></section>`;
const row = (panels, variant = '') => `<div class="screen-row ${variant}">${panels.join('')}</div>`;
const table = (title, columns = []) => `<section class="screen-panel glass screen-table">
  <h2>${title}</h2>
  ${columns.length ? `<div class="screen-table-scroll"><table><thead><tr>
    ${columns.map(column => `<th scope="col">${column}</th>`).join('')}
  </tr></thead><tbody><tr>${columns.map(() => '<td>—</td>').join('')}</tr></tbody></table></div>` : ''}
</section>`;
const graph = title => panel(title, 'screen-graph');
const overlay = title => `<section class="screen-overlay glass"><h2>${title}</h2></section>`;

function Dashboard(path) {
  return `<div data-workflow="dashboard-${path.endsWith('/mine') ? 'mine' : 'all'}"></div>`;
}

function RuleEngine(path) {
  if (path.endsWith('draft-create')) return '<div data-rule-editor></div>';
  if (path.endsWith('draft-backtest')) {
    return '<div data-workflow="backtest"></div>';
  }
  return `<div class="workflow-rule-overview">
    <div data-workflow="rules-list" data-rule-reason="${path.endsWith('/reason')}"></div>
  </div>`;
}

function InvestigationList(path) {
  if (isLedgerScreen(path)) {
    return '<div data-investigation-component="ledger"></div>';
  }
  const alerts = path.includes('alerts');
  const title = alerts ? 'Alert 목록' : 'Episode 목록';
  const actions = alerts ? '<div data-workflow="alert-episode-actions"></div>' : '';
  return actions + (path.includes('table')
    ? `<section class="screen-section screen-entries" data-case-list-table="${title}"></section>`
    : `<div data-investigation-component="cards" data-label="${title}"></div>`);
}

function CaseDetail(path) {
  const route = caseRoute(path);
  const { detail: type } = route;
  const readOnly = route.readOnly ? '<div data-workflow="case-readonly"></div>' : '';
  const { lens } = route;
  if (type === 'analysis') {
    return readOnly + `<div data-case-flow="analysis" data-lens="${lens}"></div>` +
      '<div data-case-evidence="거래" data-analysis-table></div>';
  }
  if (type === 'related' || type === 'judge-bundle') {
    return readOnly + `<div class="preview-related-layout">
      <div data-case-flow="related" data-lens="${lens}"></div>
      <div data-case-evidence="연결 거래"></div>
    </div>` +
      (type === 'judge-bundle' ? overlay('묶음 판정') : '');
  }
  if (type.includes('perpanel') || type.includes('readonly') || type === 'judge-single') {
    return readOnly + (type === 'judge-single' ? panel('판단 요약', 'screen-graph') : '<div data-workflow="case-overview"></div>') + (type === 'judge-single' ? overlay(path.endsWith('/judged') ? '판정 완료' : '단건 판정') : '');
  }
  return readOnly + '<div data-workflow="case-overview"></div>' +
    (path.startsWith('episode') ? '<div data-case-evidence="포함 거래"></div>' : '') +
    (type === 'judge' ? overlay('판정') : '');
}

function Report(path) {
  return `<div data-workflow="report" data-report-view="${path.split('/')[2] === 'card' ? 'card' : 'table'}"></div>`;
}

function Utility(path) {
  const title = titles[path];
  return path === 'notifications' ? panel(title) : overlay(title);
}

export function ScreenLayout(path, { code = '', hasQuery = false, showCaseJudgment = false, content: customContent, source } = {}) {
  const categoryName = category(path);
  const route = caseRoute(path);
  const content = customContent ?? (route ? CaseDetail(path) : ({
    dashboard: Dashboard, 'rule-engine': RuleEngine, 'add-tab': InvestigationList,
    report: Report, utility: Utility,
  })[categoryName](path));
  const label = frameLabel(path);
  const heading = code ? `${code} · ${label}` : label;
  const judgment = showCaseJudgment && route && !route.readOnly && !route.detail.startsWith('judge');
  const referencePath = path === ledgerTableScreen ? sections.T : path.replace('/sankey', '');
  return `<section class="screen-layout" data-figma-frame="${rows[referencePath] ?? rows[referencePath.replace(/\/staff-readonly$/, '')]}">
    <h1 class="screen-title-accessible" tabindex="-1">${heading}</h1>
    ${source ? `<p class="screen-data-source" role="status">${source}</p>` : ''}
    <div class="screen-query-area">
      <div class="screen-query-row">
        ${hasQuery ? '<div class="screen-query-tags" data-query-tags></div>' : ''}
        ${route && ['analysis', 'related'].includes(route.detail) ? '' : '<div class="screen-query-tools" data-screen-query-tools></div>'}
      </div>
      ${hasQuery ? '<div class="screen-query-editor" data-query-editor></div>' : ''}
    </div>
    ${content}
    ${judgment ? '<div class="case-judgment-mount" data-workflow="case-judgment"></div>' : ''}
  </section>`;
}
