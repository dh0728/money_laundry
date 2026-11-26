const ledgerPath = '/investigate/ledger';
const investigationLists = ['/investigate/alerts', '/investigate/episodes'];
const pageButtons = ['처음으로 가기', '이전으로 가기', '다음으로 가기', '마지막으로 가기'];

function layoutFailures({ pathname, table, selected, list, pageButtons }) {
  const failures = [];
  const visible = element => element?.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const findVisible = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const download = '[data-query-tool="download"]';
  const workspace = document.getElementById('workspace');
  const downloadIn = selector => findVisible(selector + ' ' + download, workspace);
  const minimumGap = parseFloat(getComputedStyle(workspace).getPropertyValue('--aml-space-8'));
  if (visible(document.getElementById('preview-login'))) failures.push('The login screen is visible after sign-in.');

  for (const selector of ['.app-header', '.app-footer', '.account-footer']) {
    const wrapper = document.querySelector(selector);
    if (!visible(wrapper)) {
      failures.push(`${selector} is missing or hidden.`);
      continue;
    }
    const css = getComputedStyle(wrapper);
    if (css.backgroundColor !== 'rgba(0, 0, 0, 0)' || css.backgroundImage !== 'none' ||
        css.backdropFilter !== 'none' || css.boxShadow !== 'none') failures.push(`${selector} paints behind its controls.`);
  }

  const pageControl = document.getElementById('page-download');
  const button = pageControl?.querySelector(download);
  const dock = document.getElementById('workspace-query-dock');
  if (pathname !== '/rules/new' && !visible(button)) failures.push('The page download is missing.');
  if (visible(button)) {
    const tools = findVisible('[data-query-tool]', dock);
    if (!dock.contains(pageControl) || getComputedStyle(dock).position !== 'fixed' ||
        tools.at(-1) !== button ||
        tools.some((tool, index) => index > 0 && tool.getBoundingClientRect().top <= tools[index - 1].getBoundingClientRect().bottom)) {
      failures.push('Workspace tools must share a fixed vertical dock, with page download last.');
    }
    if (pathname.startsWith('/dashboard/') && tools.map(tool => tool.dataset.queryTool).join() !== 'filter,sort,period,download') {
      failures.push('The dashboard dock must include filter, sort, period, and download.');
    }
    const bounds = dock.getBoundingClientRect();
    const footerTop = document.querySelector('.app-footer').getBoundingClientRect().top;
    if (Math.abs(footerTop - bounds.bottom) > 1 || bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1 ||
        parseFloat(getComputedStyle(workspace).paddingInlineEnd) > 0) {
      failures.push('The workspace dock must float within the viewport above the footer and reserve no content width.');
    }
  }

  const pageScope = {
    '/rules': '.workflow-rule-list',
    '/rules/reason': '.workflow-rule-list',
    '/report': '.workflow-report > .data-table-frame, .workflow-report > .data-table-heading',
    '/benchmark/ledger': '.benchmark-ledger-results',
  }[pathname];
  const duplicateRoots = [
    ...(pageScope?.split(', ') ?? []),
    ...(list ? [table ? '.screen-entries' : '.case-list-panel > .section-download-heading'] : []),
    ...(pathname === '/investigate/ledger' && table && !selected ? ['.ledger-hierarchy'] : []),
  ];
  for (const root of duplicateRoots) {
    if (downloadIn(root).length) failures.push(`The page download is duplicated in ${root}.`);
  }

  if (pathname === '/dashboard/mine' || pathname === '/dashboard/all') {
    if (pathname === '/dashboard/mine' && downloadIn('.dashboard-board-heading').length !== 1) {
      failures.push('The work board needs its own download.');
    }
    const bodyText = document.createElement('span');
    bodyText.style.fontSize = 'var(--aml-type-body-size)';
    bodyText.style.lineHeight = 'var(--aml-type-body-lineHeight)';
    workspace.append(bodyText);
    const { fontSize: bodySize, lineHeight: bodyLineHeight } = getComputedStyle(bodyText);
    bodyText.remove();
    for (const lane of findVisible('.dashboard-board .case-progress-lane', workspace)) {
      const heading = lane.querySelector('.case-progress-heading');
      const count = heading?.querySelector(':scope > .semantic-tag + span');
      if (!count?.textContent.trim() || heading.querySelectorAll('.semantic-tag').length !== 1) {
        failures.push('The work lane needs a status tag and a plain count.');
      } else {
        const { fontSize, lineHeight } = getComputedStyle(count);
        if (fontSize !== bodySize || lineHeight !== bodyLineHeight) {
          failures.push(`The ${lane.getAttribute('aria-label')} work count must use body text size and line height.`);
        }
      }
      const expectedDownloads = lane.querySelector('.preview-case-card') ? 1 : 0;
      if (findVisible(download, lane).length !== expectedDownloads) {
        failures.push('The work lane download must be available for each status with cases.');
      }
    }
  }

  if (pathname === '/dashboard/mine') {
    const panels = workspace.querySelectorAll([
      '.dashboard-personal-flow:has(.staged-sankey-chart)',
      '.dashboard-personal-history:has(.dashboard-work-history > li)',
      '.dashboard-priority-panel:has(.account-trail-network)',
    ].join(', '));
    for (const panel of panels) {
      if (!findVisible(download, panel).length) {
        failures.push(`The ${panel.querySelector('h2')?.textContent.trim()} panel download is missing.`);
      }
    }
  }

  if (list && !table) {
    const board = workspace.querySelector('.case-list-panel');
    if (!board) failures.push('The investigation card list is missing.');
    else if (findVisible(':scope > h1, :scope > h2, :scope > h3, :scope > .section-download-heading', board).length) {
      failures.push('The card list repeats its navigation title.');
    }
    for (const lane of board?.querySelectorAll('.case-progress-lane:has(.preview-case-card)') ?? []) {
      if (!findVisible(download, lane).length) failures.push(`The ${lane.getAttribute('aria-label')} lane download is missing.`);
    }
  }

  if (pathname === '/dashboard/all') {
    const workSection = workspace.querySelector('.dashboard-work-details');
    if (workSection?.querySelector('.dashboard-section-heading')?.textContent !== '업무 현황' ||
        workSection.querySelectorAll('.dashboard-board .case-progress-lane').length !== 3) {
      failures.push('The overall dashboard work section must include all three work board lanes under its shared title.');
    }
    const rowHeight = parseFloat(getComputedStyle(workspace).getPropertyValue('--aml-space-24'));
    for (const listRegion of findVisible('.dashboard-staff-scroll', workspace)) {
      if (listRegion.getBoundingClientRect().height > 7 * rowHeight + 0.5) {
        failures.push('An analyst list grows past its seven-row viewport.');
      }
    }
  }

  for (const selector of ['.dashboard-analytics-row', '.workflow-rule-inventory']) {
    for (const grid of findVisible(selector, workspace)) {
      const panels = findVisible(':scope > .screen-panel', grid).map(panel => panel.getBoundingClientRect());
      const panelsTooClose = panels.some((first, index) => panels.slice(index + 1).some(second => {
        const horizontalGap = Math.max(second.left - first.right, first.left - second.right);
        const verticalGap = Math.max(second.top - first.bottom, first.top - second.bottom);
        return Math.max(horizontalGap, verticalGap) < minimumGap - 0.5;
      }));
      if (panelsTooClose) failures.push(`Panels in ${selector} are closer than the shared minimum gap.`);
      if (selector === '.workflow-rule-inventory' && matchMedia('(min-width: 931px)').matches &&
          (panels.length !== 6 || panels.some(panel => Math.abs(panel.width - panels[0].width) > 0.5))) {
        failures.push('The desktop rule inventory must have six equally wide panels.');
      }
    }
  }

  for (const control of downloadIn('.section-download-tools')) {
    const panel = control.closest('.screen-panel, .rule-draft-preview');
    if (!panel) continue;
    const bounds = control.getBoundingClientRect();
    const outer = panel.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(panel).borderTopRightRadius);
    const inset = Math.max(0, radius - Math.min(bounds.width, bounds.height) / 2);
    if (bounds.top - outer.top < inset - 0.5 || outer.right - bounds.right < inset - 0.5) {
      failures.push(`The ${control.closest('.section-download-tools').getAttribute('aria-label')} button touches its panel corner.`);
    }
  }

  if (pathname === '/investigate/ledger') {
    const search = workspace.querySelector('.ledger-search-bar');
    if (findVisible('input[type="search"]', workspace).length !== 1 ||
        !visible(search?.querySelector('input[type="search"]')) || !visible(search?.querySelector('.glide-select__trigger[role="combobox"]'))) {
      failures.push('The ledger does not have one shared search field and GlideSelect scope control.');
    }
    if (!table && selected && matchMedia('(min-width: 1121px) and (min-height: 481px)').matches) {
      const transactionList = workspace.querySelector('.ledger-transactions .animated-list__viewport');
      const relatedLists = [...workspace.querySelectorAll('.ledger-case-groups .case-list')];
      const bounds = [transactionList, ...relatedLists].filter(visible).map(element => element.getBoundingClientRect());
      for (let index = 1; index < bounds.length; index += 1) {
        const previous = bounds[index - 1], current = bounds[index];
        if (current.top < previous.bottom && current.left - previous.right < minimumGap - 0.5) {
          failures.push("The ledger's adjacent scroll regions are closer than the shared minimum gap.");
        }
      }
    }
  }

  if (pathname === '/report' && !table) {
    const lanes = [...workspace.querySelectorAll('.workflow-report-lane')];
    const labels = lanes.map(lane => lane.getAttribute('aria-label'));
    const [abnormal, normal] = lanes.map(lane => lane.getBoundingClientRect());
    const stacked = matchMedia('(max-width: 520px)').matches;
    if (labels.join('|') !== '이상 판정|정상 판정' || lanes.length !== 2 ||
        (stacked ? abnormal.bottom > normal.top : abnormal.right > normal.left)) {
      failures.push('Report cards must put abnormal judgments before normal judgments.');
    }
    if (!dock || findVisible('[data-query-tool="filter"]', dock).length ||
        !findVisible('[data-query-tool="sort"]', dock).length) failures.push('Report cards must offer sorting instead of a verdict filter.');
  }

  if (list && table) {
    const pager = document.querySelector('.footer-pagination');
    const actions = [...(pager?.querySelectorAll(':scope > button') ?? [])];
    const status = pager?.querySelector('.footer-pagination-status');
    if (actions.map(action => action.getAttribute('aria-label')).join('|') !== pageButtons.join('|') ||
        actions.some(action => !action.querySelector('svg') || action.textContent.trim()) ||
        !status?.textContent.trim() || status.querySelector('button, a, [role="button"], .semantic-tag')) {
      failures.push('The table needs four icon-only page actions and plain page status.');
    }
  }
  return failures;
}

async function checkQueryPopover(page, tool, verify) {
  const trigger = page.locator('#workspace-query-dock [data-query-tool="' + tool + '"]:visible');
  if (!await trigger.isVisible()) throw new Error(tool + ' button is missing.');

  const panel = page.locator('.query-tool-popover[data-tool="' + tool + '"]:popover-open');
  const apply = panel.getByRole('button', { name: '적용', exact: true });
  await trigger.click();
  try {
    await panel.waitFor();
    await apply.waitFor();
    await verify({ panel, apply, trigger });
  } finally {
    if (await panel.isVisible()) await page.keyboard.press('Escape');
  }
}

async function checkWorkspaceQueryTools(page, { pathname, table, list }) {
  const report = pathname === '/report';
  if (!report && !list && !pathname.startsWith('/dashboard/')) return;

  if ((report || list) && !table) {
    await checkQueryPopover(page, 'sort', async ({ panel, apply, trigger }) => {
      const oldest = panel.getByRole('radio', { name: '오래된 판정순', exact: true });
      const choice = report ? oldest : panel.getByRole('radio').first();
      const card = page.getByRole('region', { name: '이상 판정', exact: true }).locator('[data-glow-surface]').first();
      const previous = report ? await card.textContent() : null;
      await choice.check();
      await apply.click();
      await panel.waitFor({ state: 'hidden' });

      if (report) {
        if (await card.textContent() === previous) throw new Error('Changing the report sort did not reorder the cards.');
        await trigger.click();
        if (!await oldest.isChecked()) throw new Error('The selected report order did not persist.');
      }
    });
  }

  await checkQueryPopover(page, 'period', async ({ panel, apply, trigger }) => {
    const recent = panel.getByRole('radio', { name: '최근 3일', exact: true });
    await panel.locator('[aria-label="조회 기간 달력"]').waitFor();
    await recent.check();
    await apply.click();
    await panel.waitFor({ state: 'hidden' });
    await trigger.click();
    if (!await recent.isChecked()) throw new Error('The selected date range did not persist.');
    await panel.getByRole('button', { name: '기간 초기화', exact: true }).click();
    await apply.click();
    await panel.waitFor({ state: 'hidden' });
  });
}

export async function checkWorkspaceLayout(page, { path, viewport }) {
  const { pathname, searchParams } = new URL(path, page.url());
  const list = investigationLists.includes(pathname);
  const table = searchParams.get('view') === 'table' || pathname === '/report' && !searchParams.has('view');
  const selected = searchParams.has('transaction');
  if (pathname === '/dashboard/mine' || pathname === '/dashboard/all' && searchParams.get('data') !== 'ibm') {
    await page.locator('#workspace .dashboard-board .preview-case-card').first().waitFor({ timeout: 10000 });
  }
  const failures = await page.evaluate(layoutFailures, { pathname, list, table, selected, pageButtons });
  if (pathname === '/investigate/alerts') {
    const group = page.locator('#footer-actions').getByRole('button', { name: 'Episode로 묶기', exact: true });
    if (!await group.isVisible() || !await group.evaluate(element => (
      element.matches('.screen-primary--brand') && !!element.closest('.star-border')
    ))) failures.push('The Episode grouping action must use the branded animated border button.');
  }
  if (pathname === ledgerPath && !failures.some(failure => failure.includes('GlideSelect'))) {
    const scope = page.getByRole('combobox', { name: '원장 검색 대상' });
    try {
      await scope.press('Enter', { timeout: 5000 });
      const options = page.getByRole('listbox', { name: '원장 검색 대상' }).getByRole('option');
      await options.first().waitFor({ timeout: 5000 });
      if ((await options.allTextContents()).map(text => text.trim()).join('|') !== '소유주|계좌|거래') {
        failures.push('The ledger search scopes must be owner, account, and transaction.');
      }
    } catch (error) {
      failures.push(`The ledger search scope list could not be opened. ${error.message}`);
    } finally {
      if (await scope.getAttribute('aria-expanded') === 'true') await scope.press('Escape', { timeout: 5000 });
    }
  }
  try {
    await checkWorkspaceQueryTools(page, { pathname, table, list });
  } catch (error) {
    failures.push('Query controls: ' + error.message);
  }
  if (failures.length) throw new Error(`${viewport.width}×${viewport.height} ${path}\n  ${failures.join('\n  ')}`);
}
