import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { checkWorkspaceLayout } from './check-workspace-layout.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const selectedTransaction = 'T-261111-00000001';
const ledgerCards = ['/investigate/ledger?view=cards', '[data-ledger-view="cards"] .ledger-transactions .animated-list__item'];
const ledgerTable = ['/investigate/ledger?view=table', '[data-ledger-view="table"] .ledger-hierarchy tbody tr'];
const selectedLedger = [`/investigate/ledger?transaction=${selectedTransaction}`, '.ledger-related .preview-case-card'];
const selectedLedgerTable = [`/investigate/ledger?view=table&transaction=${selectedTransaction}`, '[data-ledger-view="table"] > .data-table-frame tbody tr'];
const alertCards = ['/investigate/alerts?view=cards', '.case-list-panel .preview-case-card'];
const alertTable = ['/investigate/alerts?view=table', '[data-case-list-table] tbody tr'];
const episodeCards = ['/investigate/episodes?view=cards', '.case-list-panel .preview-case-card'];
const episodeTable = ['/investigate/episodes?view=table', '[data-case-list-table] tbody tr'];
const myDashboard = ['/dashboard/mine', '.dashboard-personal-flow .staged-sankey-chart'];
const allDashboard = ['/dashboard/all', '.dashboard-analytics:has(.dashboard-staff-scroll) .dashboard-investigation-flow .staged-sankey-chart'];
const moreCompletedAlerts = [...alertCards, async page => {
  await page.locator('#footer-actions button').first().waitFor();
  const completed = page.getByRole('region', { name: '처리 완료', exact: true });
  const cards = completed.locator('.preview-case-card');
  const initialCount = await cards.count();
  await completed.getByRole('button', { name: '처리 완료 업무 더 보기' }).click();
  await cards.nth(initialCount).waitFor();
}];
const openGraphSettings = ['/alerts/A-261111-000009?tab=analysis', '.preview-graph-settings', async page => {
  const toggle = page.getByRole('button', { name: '그래프 설정', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.locator('.preview-graph-settings[data-expanded="true"] .preview-graph-settings-body').waitFor();
}];
const overview = '.preview-case-overview';
const caseRoutes = [
  ['/alerts/A-261111-000009?tab=overview', overview],
  ['/alerts/A-261111-000009?tab=overview&mode=per', overview],
  ['/episodes/E-261111-000003?tab=overview', overview],
  ...['alerts/A-261111-000009', 'episodes/E-261111-000003'].flatMap(path => ['analysis', 'related'].map(tab =>
    [`/${path}?tab=${tab}`, `[data-case-flow="${tab}"] > *`])),
];
const workspaces = [
  myDashboard,
  allDashboard,
  ledgerCards, ledgerTable, selectedLedger, selectedLedgerTable,
  ['/benchmark/ledger?data=ibm&view=cards', '.benchmark-ledger-cards .benchmark-detail'],
  ['/benchmark/ledger?data=ibm&view=table', '.benchmark-ledger-results tbody tr'],
  alertCards, alertTable, episodeCards, episodeTable,
  moreCompletedAlerts,
  ...caseRoutes,
  openGraphSettings,
  ['/rules', '.workflow-rule-list'],
  ['/rules/reason', '.workflow-rule-reason'],
  ['/rules/new', '[data-rule-editor] form'],
  ['/rules/backtest', '.workflow-backtest'],
  ['/report?view=cards', '.workflow-report-lane [data-glow-surface]'],
  ['/report?view=table', '.workflow-report tbody tr'],
];
const configurations = [
  { width: 1440, height: 960, routes: workspaces },
  { width: 390, height: 844, routes: workspaces },
  { width: 768, height: 481, routes: [alertCards, alertTable] },
  { width: 769, height: 481, routes: [alertCards, alertTable] },
  { width: 1120, height: 481, routes: [selectedLedger, selectedLedgerTable] },
  { width: 1121, height: 481, routes: [selectedLedger, selectedLedgerTable] },
  { width: 1440, height: 480, routes: [alertTable, selectedLedger] },
];

function scrollOwnership(screen) {
  const overlay = 'dialog, [role="dialog"], [popover], .query-tool-popover, [inert]';
  const overflowAmount = element => element.scrollHeight - element.clientHeight;
  const allowsScroll = overflow => ['auto', 'scroll', 'overlay'].includes(overflow);
  const canMove = element => {
    const initial = element.scrollTop;
    element.scrollTo({ top: initial === 0 ? overflowAmount(element) : 0, behavior: 'instant' });
    const changed = element.scrollTop !== initial;
    element.scrollTo({ top: initial, behavior: 'instant' });
    return changed;
  };
  const scrollable = element => element instanceof HTMLElement
    && element.clientWidth > 0 && element.clientHeight > 0
    && overflowAmount(element) > 1
    && allowsScroll(getComputedStyle(element).overflowY)
    && element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    && canMove(element);
  const describe = element => `${element.id ? `#${element.id}` :
    [element.localName, ...element.classList].join('.')} (+${overflowAmount(element)}px)`;

  const pageOwners = [];
  const documentScroller = document.scrollingElement;
  const htmlOverflow = getComputedStyle(document.documentElement).overflowY;
  const viewportOverflow = htmlOverflow === 'visible' ? getComputedStyle(document.body).overflowY : htmlOverflow;
  if (overflowAmount(documentScroller) > 1 && !['hidden', 'clip'].includes(viewportOverflow) && canMove(documentScroller)) {
    pageOwners.push(`document (+${overflowAmount(documentScroller)}px)`);
  }
  for (let element = screen; element !== document.body && element !== documentScroller; element = element.parentElement) {
    if (scrollable(element)) pageOwners.push(describe(element));
  }

  const policy = screen.getAttribute('data-workspace-scroll');
  const panelScrollers = [...screen.querySelectorAll('*')].filter(element => !element.closest(overlay) && scrollable(element));
  const markers = [...screen.querySelectorAll('[data-scroll-exception]')];
  const allowedExceptions = new Set(markers.filter(element =>
    location.pathname.replace(/\/$/, '') === '/dashboard/all' && policy === 'page'
    && element.matches('.dashboard-staff-metric .dashboard-staff-scroll[data-scroll-exception="long-chart"]')
    && element.querySelectorAll('.dashboard-staff-labels > li').length >= 14
    && panelScrollers.includes(element) && element.scrollHeight >= 2 * element.clientHeight));
  const panelOwners = panelScrollers.filter(element => !allowedExceptions.has(element)).map(describe);
  const minWidth = policy === 'wide-panels' ? 1121 : 769;
  const panelsExpected = policy !== 'page' && matchMedia(`(min-width: ${minWidth}px) and (min-height: 481px)`).matches;
  const failures = markers.filter(element => !allowedExceptions.has(element))
    .map(element => `Invalid vertical scroll exception on ${describe(element)}.`);
  if (!['page', 'panels', 'wide-panels'].includes(policy)) failures.push('Missing or invalid data-workspace-scroll policy.');
  if (pageOwners.length > 1) failures.push('More than one page-level vertical scroll owner.');
  if (pageOwners.length && panelOwners.length) failures.push('Page and panels both scroll vertically.');
  if (panelsExpected && pageOwners.length) failures.push('Panel mode permits only panel vertical scroll.');
  if (!panelsExpected && panelOwners.length) failures.push('Page mode permits only page vertical scroll.');

  return { policy, expected: panelsExpected ? 'panels' : 'page', pageOwners, panelOwners, exceptions: allowedExceptions.size, failures };
}

async function injectRegression(screen) {
  await screen.evaluate(element => {
    const panel = document.createElement('div');
    panel.className = 'scroll-ownership-regression';
    panel.dataset.scrollException = 'long-chart';
    panel.style.cssText = 'height: 32px; overflow-y: auto !important;';
    const content = document.createElement('div');
    content.style.height = '120px';
    panel.append(content);
    element.append(panel);
    document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
    document.body.style.minHeight = '200vh';
  });
}

async function checkViewport(browser, origin, { width, height, routes }, regression) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    sessionStorage.setItem('aml-live-layout-signed-in', 'true');
    sessionStorage.setItem('aml-live-layout-signed-in-actor', 'demo-admin');
    localStorage.setItem('aml-live-layout-appearance', JSON.stringify({ theme: 'light', reduceMotion: true }));
  });
  const failures = [];
  let exceptions = 0;
  try {
    for (const [path, ready, prepare] of routes) {
      const url = new URL(path, origin);
      if (!url.searchParams.has('data')) url.searchParams.set('data', 'sample');
      const context = `${width}×${height} ${path}${prepare ? ' after opening or expanding content' : ''}`;
      try {
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        const screen = page.locator('#workspace .screen-layout');
        await screen.locator(ready).first().waitFor();
        if (prepare) await prepare(page);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        if (regression) await injectRegression(screen);
        const result = await screen.evaluate(scrollOwnership);
        exceptions += result.exceptions;
        if (result.failures.length) failures.push([
          `${context} (policy=${result.policy}, expected=${result.expected})`,
          ...result.failures,
          `Page scroll owners: ${result.pageOwners.join(', ') || 'none'}`,
          `Panel scroll owners: ${result.panelOwners.join(', ') || 'none'}`,
        ].join('\n  '));
        if (!regression) {
          await checkWorkspaceLayout(page, { path: url.pathname + url.search, viewport: { width, height } })
            .catch(error => failures.push(error.message));
        }
      } catch (error) {
        failures.push(`${context}\n  ${error.message}`);
      }
    }
  } finally {
    await page.close();
  }
  return { failures, exceptions };
}

const regression = process.argv.includes('--inject-regression');
const matrix = regression ? [{ width: 1440, height: 960, routes: [myDashboard] }] : configurations;
process.env.VITE_API_MODE = 'fixture';
const server = await createServer({
  root,
  cacheDir: 'node_modules/.vite-scroll-check',
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  const { port } = server.httpServer.address();
  const executablePath = process.env.SCROLL_CHECK_BROWSER_EXECUTABLE;
  const channel = !executablePath && process.platform === 'win32' && !existsSync(chromium.executablePath()) ? 'chrome' : undefined;
  browser = await chromium.launch({ executablePath, channel });
  const results = await Promise.all(matrix.map(viewport =>
    checkViewport(browser, `http://127.0.0.1:${port}`, viewport, regression)));
  const failures = results.flatMap(result => result.failures);
  const exceptions = results.reduce((count, result) => count + result.exceptions, 0);
  if (exceptions) console.log(`Approved long-chart scroll exceptions on /dashboard/all: ${exceptions}.`);
  if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exitCode = 1;
  } else {
    const checks = matrix.reduce((count, viewport) => count + viewport.routes.length, 0);
    console.log(`Vertical scroll ownership and workspace layout verified in ${checks} screen and viewport combinations.`);
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
