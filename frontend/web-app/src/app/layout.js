import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Eye, EyeOff, Monitor, Moon, Sun } from 'lucide-react';
import { login, logout, restoreSession } from '@/api/auth';
import { ApiError } from '@/api/common';
import { alternatePreviewStaff, currentPreviewUser, previewAdmin, previewStaff, setPreviewUser, subscribePreviewUser } from '../features/auth/preview-session-user.js';
import { fetchNotificationCases, fetchNotifications, setNotificationsRead } from '@/api/notifications';
import { bindCardGlow } from '../components/card-glow.js';
import { ConfirmHoldButton, PrimaryButton } from '../components/primary-button.jsx';
import { DialogClose, DialogFooter, DialogHeader } from '../components/dialog-parts.jsx';
import { SearchField } from '../components/search-field.jsx';
import { downloadCsv, inDateRange, QueryRadio, QueryToolbar, setupQueryControls } from '../components/query-controls.jsx';
import { dashboardFixtureBoardPage, dashboardFixtureResponse, dashboardFixtures, dashboardPeriodEnd, dashboardRecordCodes } from '../mocks/dashboard-fixtures.js';
import { liveCodes, liveSource, liveSourceLoaded, loadLiveSource, rebuildLiveSource, resetLiveSource } from '../features/investigation/live-data.js';
import { changeLiveEpisode, editLiveTransactions, markLiveRead, saveLiveJudgment, startLiveReview } from '../features/investigation/live-actions.js';
import { liveWorkRequests, liveWorkRequestsReady, loadLiveWorkRequests, readLiveWorkRequests, resetLiveWorkRequests, resolveLiveWorkRequest,
  sendLiveWorkRequest } from '../features/investigation/live-work-requests.js';
import { changePreviewEpisode } from '../features/investigation/preview-episode-transfer.js';
import { liveDashboardAsOf, liveDashboardResponse } from '../features/dashboard/live-dashboard.js';
import { loadLiveRules } from '../features/rules/preview-rule-workspace.jsx';
import { canStartPreviewReview, savePreviewJudgment, startPreviewReview } from '../features/investigation/case-judgment-data.js';
import { requestStateLabels, WorkRequestDetail, WorkRequestForm } from '../features/investigation/preview-work-request-dialog.jsx';
import { previewCaseAssignee, previewWorkRequests, readPreviewWorkRequests, resolvePreviewWorkRequest, sendPreviewWorkRequest,
  workRequestTypes } from '../features/investigation/preview-work-requests.js';
import { createCaseEvidenceSelection } from '../features/investigation/case-evidence-selection.js';
import { editPreviewAlertTransactions } from '../features/investigation/case-membership-data.js';
import { markPreviewCaseRead, resetPreviewCaseRead } from '../features/investigation/case-read-state.js';
import { mountTransactionEvidenceTable } from '../features/investigation/preview-case-table.jsx';
import { mountWorkflows, mountWorkflowNotifications } from '../pages/workflow-components.jsx';
import { renderScreenNav, refreshScreenNav } from './screen-navigation.jsx';
import { ScreenLayout, ScreenNavigation, sections } from './screen-layouts.js';
import { BrandSymbol, Button, Divider, GlassDialog, Icon, IconButton, ScrollArea, Sidebar, Tooltip, bindTooltip, hideTooltip } from '../components/components.js';
import { setupGlassMaterial } from '../components/glass-material.js';
import { mountLoginScene } from '../features/auth/preview-login-scene.js';
import { uiSizeOptions } from '../config/appearance-options.js';
import { enableBackdropDismissal, setupOverlayDismissal } from '../lib/overlay-dismissal.js';
import { SquishSwitch, bindSquishSwitch } from '../components/squish-switch.js';
import { mountNotificationPreference, receivesSampleNotifications } from '../features/settings/notification-preference.jsx';
import { restoreWorkTabCodes, setWorkTabCodes } from './work-tab-state.js';
import { benchmarkLedgerPath, dashboardRoute, initialDetail, isBenchmarkTransactionCode, isLedgerScreen, ledgerTableScreen, loginRoute, previewUrl, readPreviewRoute, validWorkCode } from './preview-route.js';

const tabGroups = [
  { name: 'Transactions', prefix: 'T', digits: 8 },
  { name: 'Alert', prefix: 'A', digits: 6, first: [1042, 1051, 1069] },
  { name: 'Episode', prefix: 'E', digits: 6 },
];
const serviceMode = import.meta.env.VITE_API_MODE === 'live';
const pendingEntry = location.pathname === '/login' ? history.state?.previewNext : undefined;
const entryPath = typeof pendingEntry === 'string' && pendingEntry.startsWith('/')
  ? new URL(pendingEntry, location.origin).pathname : location.pathname;
const benchmarkLedgerRoute = !serviceMode && entryPath.replace(/\/$/, '') === benchmarkLedgerPath;
function readDataMode() {
  if (serviceMode) return;
  if (benchmarkLedgerRoute) return 'ibm';
  const requested = new URLSearchParams(location.search).get('data');
  return requested === 'sample' || requested === 'ibm' ? requested : undefined;
}

const dataMode = readDataMode();
const sampleData = dataMode === 'sample';
const workTabsStorageKey = benchmarkLedgerRoute ? 'aml-live-layout-ibm-work-tabs' : 'aml-live-layout-work-tabs';
const avatarUrl = new URL('../assets/sample-avatar.png', import.meta.url).href;
let storedWorkTabs;
try {
  storedWorkTabs = JSON.parse(sessionStorage.getItem(workTabsStorageKey));
} catch {
  // The first preview session starts with the sample tabs.
}
const defaultTabs = tabGroups.flatMap(group => tabCodes(group).slice(0, 2));
const initialWorkTabs = restoreWorkTabCodes(storedWorkTabs, defaultTabs, tabGroups.flatMap(tabCodes))
  .filter(code => benchmarkLedgerRoute || !isBenchmarkTransactionCode(code));
let benchmarkDataset;
let benchmarkSummaryLoading;
let benchmarkLoading;
const profileName = '이름';
const profilePictureKey = 'aml-live-layout-profile-picture';
const profilePictureTypes = ['image/png', 'image/jpeg', 'image/webp'];
let profilePicture = avatarUrl;
try {
  const stored = sessionStorage.getItem(profilePictureKey);
  if (stored && /^data:image\/(png|jpeg|webp);base64,/.test(stored)) profilePicture = stored;
} catch {
  // The sample profile also works without browser storage.
}
const profileRole = '분석가';
const now = Date.now();
const sampleNotificationDescriptions = [
  '새 Alert가 검토 대기에 추가되었습니다. 담당 업무 목록에서 근거 거래를 확인할 수 있습니다.',
  '미완료 업무의 검토 기한이 다가왔습니다. 개인 대시보드에서 경과일을 확인할 수 있습니다.',
  '판정 보고서가 생성되었습니다. 보고서 화면에서 저장된 판정 내용을 확인할 수 있습니다.',
];
const notifications = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, read: i % 3 === 2, time: new Date(now - i * 900000),
  title: `[테스트] 알림 ${String(i + 1).padStart(2, '0')}`,
  description: sampleNotificationDescriptions[i % sampleNotificationDescriptions.length],
}));
let nextNotificationId = notifications.length;
let liveInbox;
let inboxRequest = 0;
const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
});

function DrawerChromeRow(className, primary, accessory, attributes = '') {
  return `<div class="drawer-chrome ${className}" ${attributes}>
    <div class="drawer-chrome__primary">${primary}</div>
    <div class="drawer-chrome__accessory">${accessory}</div>
  </div>`;
}

function Header() {
  return `<header class="app-header" aria-label="헤더">
    <div class="header-frame header-frame--left">
      ${DrawerChromeRow('brand-header sidebar-chrome',
        IconButton(BrandSymbol('idle-icon') + Icon('left', 'alternate-icon') + '<span class="brand">AML RADAR</span>', '사이드바 열기',
          'id="sidebar-toggle" aria-expanded="false" aria-controls="sidebar" data-drawer-button', 'brand-pill', 'floating', 'pill'),
        IconButton(Icon('search'), '검색',
          'id="search-toggle" aria-haspopup="dialog" aria-controls="search-dialog" data-drawer-button', '', 'floating'),
        'data-drawer-controls')}
    </div>
    <div class="header-frame header-frame--center">
      <div class="contextual-header">
        <div id="screen-navigation" class="header-frame screen-navigation" hidden></div>
      </div>
    </div>
    <div class="header-frame header-frame--right header-right">
      <div class="header-view-controls" role="group" aria-label="화면 보기">
        ${IconButton(Icon('fullscreen'), '전체화면 보기', 'id="fullscreen-toggle" aria-pressed="false"')}
        ${IconButton(Icon('wide'), '넓게 보기', 'id="workspace-width-toggle" aria-pressed="false"')}
      </div>
      ${DrawerChromeRow('inbox-header',
        IconButton(Icon('check'), '현재 페이지 모두 읽음', 'id="mark-all-read"', '', '') +
          SquishSwitch('unread-only', '읽지 않은 항목만 표시'),
        IconButton(Icon('archive', 'idle-icon') + Icon('right', 'alternate-icon') +
          '<span id="inbox-count" class="inbox-count unread-dot"></span>', '보관함 열기',
          'id="inbox-toggle" aria-expanded="false" aria-controls="inbox" aria-describedby="inbox-count" data-drawer-button', 'inbox-pill', 'floating'),
        'data-drawer-controls')}
    </div>
  </header>`;
}

function WorkTab(code) {
  return `<div class="work-tab">
    ${Button(`<code>${code}</code>`, { variant: 'work-tab-open', attributes: `data-work-code="${code}"` })}
    ${IconButton(Icon('close', 'icon-compact'), `${code} 닫기`, 'data-close-tab', '', '')}
  </div>`;
}

// 서비스 모드는 서버에서 받은 사건을, 프리뷰는 샘플을 화면 데이터로 쓴다.
function caseSource(groups) {
  return serviceMode ? rebuildLiveSource() : dashboardFixtures(groups);
}

function tabCodes(group) {
  return serviceMode ? liveCodes(group.prefix) : dashboardRecordCodes(group);
}

function TabGroup(group) {
  const { name, prefix } = group;
  const tabs = initialWorkTabs.filter(code => code.startsWith(`${prefix}-`)).map(WorkTab);
  const id = `group-${prefix}`;
  return `<section>
    <div class="group-row">
      ${Button(`${Icon('chevron', 'icon-compact')}${name}`, {
        variant: 'group-toggle', attributes: `aria-expanded="true" aria-controls="${id}"`,
      })}
      ${IconButton(Icon('add', 'icon-compact'), `조사 · ${name} 목록 열기`, `data-investigation="${prefix}"`, '', '')}
    </div>
    <div id="${id}" class="group-content">${tabs.join('')}</div>
  </section>`;
}

function AccountControls() {
  const account = `<img class="avatar" data-profile-image src="${avatarUrl}" alt="" width="32" height="32">
    <span id="profile-context" class="account-text"><span id="profile-display-name" data-preview-user-name>${profileName}</span><span aria-hidden="true">·</span><span data-preview-user-role>${profileRole}</span></span>`;
  return `<div class="account-footer">${Divider()}
    ${DrawerChromeRow('account-controls sidebar-chrome',
      Button(account, { variant: 'account', surface: 'floating', shape: 'pill', attributes: 'id="account-toggle" aria-label="계정" aria-describedby="profile-context" aria-haspopup="dialog" aria-controls="account-dialog"' }),
      IconButton(Icon('settings'), '설정', 'id="settings-toggle" aria-haspopup="dialog" aria-controls="settings-dialog"', '', 'floating'))}
  </div>`;
}

function Footer() {
  return `<footer class="app-footer" aria-label="공통 하단 도구">
    ${AccountControls()}
    <div id="workflow-notifications"></div>
    <div id="footer-pagination"></div>
    <div id="footer-actions"></div>
  </footer>`;
}

function NavigationSidebar() {
  const workTabs = ScrollArea(`<nav class="work-tabs" aria-label="작업 탭">${tabGroups.map(TabGroup).join('')}</nav>`);
  return Sidebar(Divider() + workTabs, 'id="sidebar" aria-label="사이드바" hidden inert');
}

function Notification() {
  let item;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button notification';
  button.setAttribute('aria-haspopup', 'dialog');
  const heading = document.createElement('strong');
  heading.className = 'notification-title';
  const marker = document.createElement('span');
  marker.className = 'notification-marker';
  marker.setAttribute('aria-hidden', 'true');
  const title = document.createTextNode('');
  const status = document.createElement('span');
  status.className = 'visually-hidden';
  status.textContent = '읽지 않음';
  heading.append(marker, title, status);
  const timestamp = document.createElement('time');
  button.append(heading, timestamp);
  button.addEventListener('click', () => openNotification(item));
  return {
    button,
    update(next) {
      item = next;
      button.dataset.notificationId = item.id;
      button.setAttribute('aria-controls', item.request ? 'work-request-dialog' : 'notification-dialog');
      title.data = item.title;
      marker.classList.toggle('unread-dot', !item.read);
      status.hidden = item.read;
      const dateTime = item.time.toISOString();
      if (timestamp.dateTime !== dateTime) {
        timestamp.dateTime = dateTime;
        timestamp.textContent = dateFormat.format(item.time);
      }
    },
  };
}

function Inbox() {
  return Sidebar(Divider() + ScrollArea('', 'id="notifications"') +
    '<div class="inbox-pages" id="inbox-pages" hidden>' +
    Button('이전', { attributes: 'id="inbox-previous"' }) +
    '<span id="inbox-page-status" aria-live="polite"></span>' +
    Button('다음', { attributes: 'id="inbox-next"' }) + '</div>' +
    '<footer class="inbox-request-footer" id="inbox-request-footer"></footer>',
    'id="inbox" aria-label="보관함" hidden inert');
}

function SearchDialog() {
  return GlassDialog(`
    <div class="search-heading" id="search-field-host"></div>
    <p id="search-status" class="visually-hidden" role="status"></p>
    ${ScrollArea('', 'id="search-results"')}
  `, { id: 'search-dialog', variant: 'search-dialog', attributes: 'aria-label="검색"' });
}

function PreferenceDialog(id, title, content, { wrapContent = true, footer = '' } = {}) {
  return GlassDialog(`
    <div class="dialog-part-host" data-dialog-heading="${id}" data-dialog-title="${title}"></div>
    ${wrapContent ? `<div class="settings-content scroll-area">${content}</div>` : content}
    ${footer}
  `, { id: `${id}-dialog`, variant: 'settings-dialog', attributes: `aria-labelledby="${id}-title"` });
}

function SettingsDialog() {
  const row = (id, label) => `<div class="settings-row"><label for="${id}">${label}</label>${SquishSwitch(id, label)}</div>`;
  return PreferenceDialog('settings', '설정', `
      <section aria-labelledby="appearance-title">
        <h3 id="appearance-title">화면 및 접근성</h3>
        <div class="settings-row">
          <span>화면 모드</span>
          <div id="theme-setting"></div>
        </div>
        ${row('reduce-motion', '모션 줄이기')}
        ${row('glass-mode', '리퀴드 글래스')}
        <div class="settings-row">
          <span>UI 크기</span>
          <div id="ui-size-setting"></div>
        </div>
      </section>
      <section aria-labelledby="notification-preferences-title">
        <h3 id="notification-preferences-title">알림</h3>
        <div class="settings-row">
          <span>보관함 알림</span>
          <div id="notification-preference"></div>
        </div>
      </section>
      <div id="admin-settings-content"></div>
  `);
}

function AccountDialog() {
  return PreferenceDialog('account', '계정', `
    <section aria-labelledby="profile-title">
      <h3 id="profile-title">계정 정보</h3>
      <div class="settings-row profile-image-row">
        <img class="avatar" data-profile-image src="${avatarUrl}" alt="프로필 이미지" width="32" height="32">
        <input id="profile-picture" class="visually-hidden" type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp">
        ${Button('사진 변경', { variant: 'row', shape: 'pill', surface: 'floating', attributes: 'id="profile-picture-change"' })}
      </div>
      <div class="settings-row"><span>이름</span><strong data-preview-user-name>${profileName}</strong></div>
      <div class="settings-row"><span>역할</span><strong data-preview-user-role>${profileRole}</strong></div>
      <p id="profile-status" role="status"></p>
    </section>
    <section aria-labelledby="permissions-title">
      <h3 id="permissions-title">상세 권한</h3>
      <ul class="profile-list">
        <li>거래, Alert, Episode 및 판정 보고서 열람</li>
        <li>내 담당 미판정 업무의 검토 시작 및 판정 저장</li>
      </ul>
    </section>
    <section aria-labelledby="login-history-title">
      <h3 id="login-history-title">세션별 로그인 기록</h3>
      <p>이 탭에서 로그인한 프리뷰 세션</p>
      <p id="login-history-empty">기록된 로그인이 없습니다.</p>
      <ol id="login-history" class="profile-list"></ol>
    </section>
  `, { footer: '<div class="dialog-part-host" id="preview-sign-out"></div>' });
}

document.body.innerHTML = Header() + NavigationSidebar() +
  '<main id="workspace" aria-label="콘텐츠"></main>' + Footer() +
  Inbox() + SearchDialog() + AccountDialog() + SettingsDialog() + PreferenceDialog('notification', '알림 상세', `
    <h3 id="notification-detail-title"></h3>
    <p><time id="notification-detail-time"></time></p>
    <p id="notification-detail-description"></p>
    <div id="notification-detail-cases" hidden></div>
  `) + PreferenceDialog('work-request', '업무 요청', '<div id="work-request-content"></div>', { wrapContent: false }) + Tooltip() +
  `<main id="preview-login" aria-label="로그인" hidden>
    <canvas class="login-scene" aria-hidden="true"></canvas>
    <section class="glass login-card">
      <div class="login-brand"><span class="login-brand-mark">${BrandSymbol()}</span><span>AML RADAR</span></div>
      <form id="preview-login-form" class="login-form" aria-label="로그인" novalidate>
        <label for="preview-login-id">아이디</label>
        <input id="preview-login-id" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="아이디 입력" required>
        <label for="preview-login-password">비밀번호</label>
        <div class="login-password-field">
          <input id="preview-login-password" name="password" type="password" autocomplete="current-password" placeholder="비밀번호 입력" required>
          ${Button('', { variant: 'icon-button login-password-toggle', shape: 'circle', attributes: 'id="login-password-toggle" aria-label="비밀번호 표시" aria-pressed="false" aria-controls="preview-login-password"' })}
        </div>
        <div class="login-error" id="preview-login-error" role="alert" aria-atomic="true"></div>
        <div id="preview-login-action"></div>
        <div id="preview-login-help-actions" class="login-help"></div>
      </form>
      ${serviceMode ? '' : '<div id="preview-login-sample-actions" class="login-sample"></div>'}
    </section>
    ${PreferenceDialog('login-help', '계정 찾기', '<p id="login-help-instructions"></p>')}
  </main>`;

function observeChromeHeight(element, onResize) {
  let frame;
  let measuredHeight;
  new ResizeObserver(([entry]) => {
    const height = entry.borderBoxSize[0].blockSize;
    if (height <= 0 || height === measuredHeight) return;
    measuredHeight = height;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => onResize(height));
  }).observe(element);
}

const header = document.querySelector('.app-header');
const footer = document.querySelector('.app-footer');
const accountFooter = footer.querySelector('.account-footer');
const chromeStyle = document.documentElement.style;
function alignSidebarFooter() {
  const reserve = footer.getBoundingClientRect().bottom - accountFooter.getBoundingClientRect().top;
  if (reserve > 0) chromeStyle.setProperty('--sidebar-footer-reserve', `${reserve}px`);
}
observeChromeHeight(header, height => chromeStyle.setProperty('--header-height', `${height}px`));
observeChromeHeight(footer, height => {
  chromeStyle.setProperty('--app-footer-height', `${height}px`);
  alignSidebarFooter();
});
observeChromeHeight(accountFooter, alignSidebarFooter);

const byId = id => document.getElementById(id);

function toggleDisclosure(button, label, open = byId(button.getAttribute('aria-controls')).hidden) {
  const target = byId(button.getAttribute('aria-controls'));
  target.hidden = !open;
  if (target.matches('.sidebar')) target.inert = !open;
  button.setAttribute('aria-expanded', String(open));
  if (label) button.setAttribute('aria-label', `${label} ${open ? '닫기' : '열기'}`);
  dismissals.mark(button, open);
}

const sidebarButton = byId('sidebar-toggle');
const inboxButton = byId('inbox-toggle');
const fullscreenButton = byId('fullscreen-toggle');
const widthButton = byId('workspace-width-toggle');
const narrowShell = matchMedia('(max-width: 680px)');

const dismissals = setupOverlayDismissal([
  { button: sidebarButton, surfaces: [byId('sidebar'), sidebarButton.closest('.brand-header'), document.querySelector('.account-footer')],
    keepOpenOn: '[data-add-work-tab]',
    dismiss: () => toggleDisclosure(sidebarButton, '사이드바', false) },
  { button: inboxButton, surfaces: [byId('inbox'), inboxButton.closest('.inbox-header')],
    keepOpenOn: '.header-view-controls, #work-request-dialog, .case-judgment-trigger',
    dismiss: () => toggleDisclosure(inboxButton, '보관함', false) },
]);
sidebarButton.addEventListener('click', () => toggleDisclosure(sidebarButton, '사이드바'));
inboxButton.addEventListener('click', () => {
  toggleDisclosure(inboxButton, '보관함');
  if (!byId('inbox').hidden) void refreshLiveInbox(liveInbox?.number ?? 0);
});
widthButton.addEventListener('click', () => setAppearancePreference('wideWorkspace', appearance.wideWorkspace !== true));
fullscreenButton.disabled = !document.fullscreenEnabled;
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.setAttribute('aria-label', active ? '전체화면 취소' : '전체화면 보기');
  fullscreenButton.innerHTML = Icon(active ? 'fullscreenExit' : 'fullscreen');
});
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    document.dispatchEvent(new CustomEvent('aml:notice', { detail: { title: '전체화면으로 전환할 수 없습니다.', status: 'warning' } }));
  }
});
const preferenceDialogs = ['account', 'settings'].map(id => {
  const trigger = byId(`${id}-toggle`);
  const dialog = byId(`${id}-dialog`);
  enableBackdropDismissal(dialog);
  trigger.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => {
    if (!document.body.hasAttribute('data-login-required')) trigger.focus({ preventScroll: true });
  });
  return dialog;
});
let adminSettingsLoading;
byId('settings-toggle').addEventListener('click', () => {
  adminSettingsLoading ??= import('../features/settings/admin-settings.jsx')
    .then(({ mountAdminSettings }) => mountAdminSettings(byId('admin-settings-content')))
    .catch(() => { adminSettingsLoading = undefined; });
  void refreshPreviewSessionUser();
});

const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const preferenceKey = 'aml-live-layout-appearance';
let appearance = {};
try {
  appearance = JSON.parse(localStorage.getItem(preferenceKey)) ?? {};
} catch {
  // The preview also runs with browser storage disabled.
}
const appearanceSwitches = [
  [byId('reduce-motion'), 'reduceMotion'],
  [byId('glass-mode'), 'glassmorphism'],
];
const themeOptions = [
  { value: 'light', label: '라이트', icon: createElement(Sun, { 'aria-hidden': true }) },
  { value: 'system', label: '시스템', icon: createElement(Monitor, { 'aria-hidden': true }) },
  { value: 'dark', label: '다크', icon: createElement(Moon, { 'aria-hidden': true }) },
];
const themeSetting = createRoot(byId('theme-setting'));
const uiSizeSetting = createRoot(byId('ui-size-setting'));
let activeGlassMode;
let disposeGlassMaterial;

function setAppearancePreference(key, value) {
  appearance = { ...appearance, [key]: value };
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(appearance));
  } catch {
    // Keep the chosen appearance for the current session.
  }
  syncAppearance();
}

function syncAppearance() {
  const theme = themeOptions.find(option => option.value === appearance.theme)?.value
    ?? (typeof appearance.dark === 'boolean' ? (appearance.dark ? 'dark' : 'light') : 'system');
  const dark = theme === 'dark' || (theme === 'system' && systemTheme.matches);
  const { reduceMotion = motionPreference.matches, glassmorphism = true } = appearance;
  const settings = { reduceMotion, glassmorphism };
  const { dataset } = document.documentElement;
  dataset.theme = dark ? 'dark' : 'light';
  dataset.themePreference = theme;
  dataset.reducedMotion = String(reduceMotion);
  dataset.glassmorphism = String(glassmorphism);
  dataset.uiSize = uiSizeOptions.find(option => option.value === appearance.uiSize)?.value ?? 'medium';
  const wide = appearance.wideWorkspace === true;
  dataset.workspaceWidth = wide ? 'wide' : 'narrow';
  widthButton.setAttribute('aria-pressed', String(wide));
  widthButton.setAttribute('aria-label', wide ? '좁게 보기' : '넓게 보기');
  widthButton.innerHTML = Icon(wide ? 'narrow' : 'wide');
  themeSetting.render(createElement(QueryRadio, {
    label: '화면 모드', items: themeOptions, value: theme,
    onChange: value => setAppearancePreference('theme', value),
  }));
  uiSizeSetting.render(createElement(QueryRadio, {
    label: 'UI 크기', items: uiSizeOptions, value: dataset.uiSize,
    onChange: value => setAppearancePreference('uiSize', value),
  }));
  if (activeGlassMode !== glassmorphism) {
    activeGlassMode = glassmorphism;
    disposeGlassMaterial?.();
    disposeGlassMaterial = glassmorphism ? setupGlassMaterial() : undefined;
  }
  for (const [button, key] of appearanceSwitches) {
    button.setAttribute('aria-checked', String(settings[key]));
  }
  refreshScreenNav();
  document.dispatchEvent(new Event('aml:appearance'));
}

for (const [button, key] of appearanceSwitches) {
  bindSquishSwitch(button, checked => setAppearancePreference(key, checked));
}
motionPreference.addEventListener('change', syncAppearance);
systemTheme.addEventListener('change', syncAppearance);
syncAppearance();

let activeWorkCode = '';
let activePath;
let unmountInvestigation;
let setLedgerView;
let mountedWorkflows;
let unmountRuleControls;
let unmountCaseGraph;
let unmountCaseEvidence;
let activeEvidence;
let benchmarkLedgerView;
let dashboardSource;
let caseListPage = { key: '', page: 0 };
let navigationFrame;
let headerPath;
let headerCode;
const queryToolStorage = document.createElement('div');
queryToolStorage.innerHTML = QueryToolbar();
const queryControls = setupQueryControls({
  onChange: tool => {
    if (tool === 'sort' && activePath?.startsWith('dashboard/')) {
      const { rows, sort } = queryControls.selection();
      if (mountedWorkflows?.updateDashboardSort(rows, sort)) {
        updateWorkspaceAddress(activePath, activeWorkCode, 'replace', queryControls.params(activePath), { scroll: false });
        queryControls.refresh();
        return;
      }
    }
    showWorkspace('', activeWorkCode, activePath, 'replace');
  },
  workspace: byId('workspace'),
  controls: queryToolStorage.firstElementChild,
});
mountWorkflowNotifications(byId('workflow-notifications'));
mountNotificationPreference(byId('notification-preference'));

function showWorkspaceNavigation(path, code) {
  if (headerPath === path && headerCode === code) return;
  headerPath = path;
  headerCode = code;
  const navigation = path ? ScreenNavigation(path, code) : { primary: [] };
  if (benchmarkLedgerRoute && isLedgerScreen(path)) {
    navigation.primary = navigation.primary.map(item => item.value === sections.T
      ? { ...item, label: '은행·계좌·거래' } : item);
  }
  renderScreenNav(navigation, navigateFromHeader);
}

function navigateFromHeader(path) {
  const code = /^(alert|episode)\//.test(path) || isLedgerScreen(path) && isLedgerScreen(headerPath) ? headerCode : '';
  if (path === headerPath && code === headerCode) return;
  queryControls.dismiss();
  showWorkspaceNavigation(path, code);
  cancelAnimationFrame(navigationFrame);
  // Let the persistent header paint before unmounting or building the next workspace.
  navigationFrame = requestAnimationFrame(() => {
    navigationFrame = requestAnimationFrame(() => showWorkspace('', code, path));
  });
}

function unmountWorkspace() {
  mountedWorkflows?.unmount();
  mountedWorkflows = undefined;
  unmountRuleControls?.();
  unmountRuleControls = undefined;
  unmountInvestigation?.();
  unmountInvestigation = undefined;
  setLedgerView = undefined;
  benchmarkLedgerView?.unmount();
  benchmarkLedgerView = undefined;
  unmountCaseGraph?.();
  unmountCaseGraph = undefined;
  unmountCaseEvidence?.();
  unmountCaseEvidence = undefined;
  queryControls.unmountTags();
}

function updateWorkspaceAddress(path, code, navigationMode, urlParams, { scroll = true } = {}) {
  if (code) document.querySelector(`.work-tabs [data-work-code="${code}"]`)?.setAttribute('aria-current', 'page');
  if (scroll) window.scrollTo(0, 0);
  if (navigationMode === 'none' || !path || /\/judge(?:-|\/|$)/.test(path)) return;
  if (dataMode) urlParams.set('data', dataMode);
  const url = previewUrl({ screen: path, code, benchmarkLedger: benchmarkLedgerRoute }, urlParams);
  if (url === location.pathname + location.search) return;
  if (navigationMode === 'replace') history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
}

function loadBenchmarkDataset() {
  benchmarkLoading ??= fetch(new URL('../mocks/ibm-hi-small-data.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error(`Benchmark data request failed (${response.status})`);
    return response.json();
  }).then(dataset => {
    benchmarkDataset = dataset;
    return dataset;
  }).catch(error => {
    benchmarkLoading = undefined;
    throw error;
  });
  return benchmarkLoading;
}

function loadBenchmarkSummary() {
  benchmarkSummaryLoading ??= fetch(new URL('../mocks/ibm-hi-small-summary.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error(`Benchmark summary request failed (${response.status})`);
    return response.json();
  }).catch(error => {
    benchmarkSummaryLoading = undefined;
    throw error;
  });
  return benchmarkSummaryLoading;
}

function registerBenchmarkExport(file, label, headers, rows) {
  queryControls.registerTableTools({ entries: [{
    label, format: 'CSV', count: rows.length, disabled: !rows.length,
    download: () => downloadCsv(file, headers, rows),
  }] });
}

function showBenchmarkWorkspace(path, code, navigationMode, params) {
  const ledger = isLedgerScreen(path);
  if (ledger && isLedgerScreen(activePath) && benchmarkLedgerView) {
    activePath = path;
    benchmarkLedgerView.showRecord(code, path === ledgerTableScreen);
    const heading = byId('workspace').querySelector('h1');
    heading.textContent = code ? `${code} · 은행·계좌·거래` : '은행·계좌·거래';
    updateWorkspaceAddress(path, code, navigationMode, queryControls.params(path));
    return;
  }
  activePath = path;
  unmountWorkspace();
  const dashboard = path.startsWith('dashboard/');
  queryControls.setScreen(dashboard || ledger ? path : undefined, [], { rows: [], dashboard }, params);
  const workflow = `benchmark-dashboard-${path.endsWith('/mine') ? 'mine' : 'all'}`;
  const content = ledger
    ? '<div data-benchmark-content><p role="status">IBM AMLworld 거래를 불러오는 중입니다.</p></div>'
    : `<div data-benchmark-content data-workflow="${workflow}"></div>`;
  const workspace = byId('workspace');
  workspace.innerHTML = ScreenLayout(path, { code, hasQuery: dashboard, content });
  updateWorkspaceAddress(path, code, navigationMode, queryControls.params(path));

  const host = workspace.querySelector('[data-benchmark-content]');
  if (dashboard) mountedWorkflows = mountWorkflows(workspace);
  const render = async dataset => {
    if (!host.isConnected) return;
    if (ledger) {
      host.replaceChildren();
      const { mountBenchmarkLedger } = await import('../features/investigation/ibm-ledger.jsx');
      if (!host.isConnected) return;
      if (code) {
        const entry = addWorkTab(code);
        entry?.tab.setAttribute('aria-current', 'page');
      }
      benchmarkLedgerView = mountBenchmarkLedger(host, {
        paginationHost: byId('footer-pagination'),
        dataset, code, tableView: path === ledgerTableScreen, onVisibleRecordsChange: records => {
          if (!host.isConnected) return;
          registerBenchmarkExport('ibm-hi-small-transactions', '조회된 원본 원장',
            ['거래 코드', '원본 시각', '송금 은행 코드', '송금 계좌', '수취 은행 코드', '수취 계좌', '송금 금액', '송금 통화', '수취 금액', '수취 통화', '거래 방식', '원본 세탁 라벨'],
            records.map(row => [row.code, row.timestamp, row.from.bank, row.from.account, row.to.bank, row.to.account,
              row.paidAmount, row.paidCurrency, row.receivedAmount, row.receivedCurrency, row.method, Number(row.labeled)]));
        },
      });
      return;
    }
    queryControls.setScreen(path, [], { rows: [], asOf: new Date(dataset.period.end + 'T00:00:00'), dashboard: true });
    const { range } = queryControls.selection();
    queryControls.renderTags(workspace.querySelector('[data-query-tags]'));
    mountedWorkflows.updateDashboard({ dataset, range });
    const days = dataset.days.filter(row => inDateRange(new Date(row.date + 'T00:00:00'), range));
    registerBenchmarkExport('ibm-hi-small-daily', '조회 기간 원본 집계',
      ['원본 일자', '전체 거래', '원본 세탁 라벨 거래', '최초 등장 계좌', '최초 등장 은행 코드'],
      days.map(row => [row.date, row.total, row.labeled, row.newAccounts, row.newBanks]));
  };
  const load = () => {
    if (dashboard) mountedWorkflows.updateDashboard(undefined);
    void (ledger ? loadBenchmarkDataset() : loadBenchmarkSummary()).then(render).catch(() => {
      if (!host.isConnected) return;
      if (dashboard) mountedWorkflows.updateDashboard({ error: true, retry: load });
      else showWorkspace('', '', path, 'replace', params, true);
    });
  };
  load();
}

function afterWorkspacePaint(callback) {
  requestAnimationFrame(() => setTimeout(callback, 0));
}

function loadPreviewDashboard(mounted, source, query) {
  const load = () => {
    mounted.updateDashboard(undefined);
    afterWorkspacePaint(() => {
      if (mountedWorkflows !== mounted) return;
      const show = summary => {
        if (mountedWorkflows !== mounted) return;
        mounted.updateDashboard(summary);
        afterWorkspacePaint(() => {
          if (mountedWorkflows !== mounted) return;
          const rows = query.mine ? summary.mine : summary.cases;
          const board = dashboardFixtureBoardPage(rows, { size: Math.max(1, rows.length) });
          mounted.updateDashboard({ ...summary, board });
        });
      };
      const fail = () => mounted.updateDashboard({ error: true, retry: load });
      if (serviceMode) {
        liveDashboardResponse(source, query).then(show, fail);
        return;
      }
      try {
        show(dashboardFixtureResponse(source, query));
      } catch {
        fail();
      }
    });
  };
  load();
}

function showWorkspace(prefix, code = '', override = '', navigationMode = 'push', params, benchmarkFailed = false) {
  cancelAnimationFrame(navigationFrame);
  for (const tab of document.querySelectorAll('#sidebar [aria-current="page"]')) {
    tab.removeAttribute('aria-current');
  }
  const selectedPath = override || (code ? initialDetail(code) : sections[prefix]);
  if (!benchmarkLedgerRoute && isBenchmarkTransactionCode(code)) code = '';
  const sameCode = activeWorkCode === code;
  const previousPath = activePath;
  activeWorkCode = code;
  const path = !override && code.startsWith('T-') && previousPath === ledgerTableScreen ? previousPath : selectedPath;
  showWorkspaceNavigation(path, code);
  const benchmarkLedger = isLedgerScreen(path) && benchmarkLedgerRoute && (!code || isBenchmarkTransactionCode(code));
  if (!sampleData && !benchmarkFailed && (benchmarkLedger || path === 'dashboard/all' && dataMode === 'ibm')) {
    showBenchmarkWorkspace(path, code, navigationMode, params);
    return;
  }
  if (setLedgerView && sameCode && isLedgerScreen(path) && isLedgerScreen(previousPath)) {
    activePath = path;
    setLedgerView(path === ledgerTableScreen);
    const label = path === ledgerTableScreen ? '통합 테이블' : '소유주·계좌·거래';
    byId('workspace').querySelector('h1').textContent = code ? `${code} · ${label}` : label;
    updateWorkspaceAddress(path, code, navigationMode, queryControls.params(path));
    return;
  }
  const groupPrefix = path?.includes('/alerts') ? 'A' : path?.includes('/episodes') ? 'E' : 'T';
  const group = tabGroups.find(item => item.prefix === groupPrefix);
  const isDashboard = path?.startsWith('dashboard/');
  const isReport = path?.startsWith('report/');
  const isCaseDetail = /^(alert|episode)\//.test(path ?? '');
  const isCaseList = /^add-tab\/(alerts|episodes)(?:-|\/|$)/.test(path ?? '');
  const groups = isDashboard || isReport || isCaseDetail || path?.startsWith('add-tab/')
    ? Object.fromEntries(tabGroups.map(group => [group.prefix, tabCodes(group)])) : undefined;
  if (isDashboard || isReport || isCaseDetail || isCaseList) dashboardSource ??= caseSource(groups);
  const opened = isCaseDetail ? dashboardSource.cases.find(row => row.code === code) : undefined;
  if (markPreviewCaseRead(opened)) {
    if (serviceMode) void markLiveRead(opened);
    dashboardSource = caseSource(groups);
  }
  const queryData = isDashboard ? {
    rows: path === sections.dashboard ? dashboardSource.mine : dashboardSource.cases,
    asOf: serviceMode ? liveDashboardAsOf(dashboardSource) : dashboardPeriodEnd,
    dashboard: true,
  } : isCaseList ? { rows: dashboardSource.cases.filter(row => row.code.startsWith(groupPrefix)) } : undefined;
  activePath = path;
  const codes = queryControls.setScreen(path, tabCodes(group), queryData, params);
  // 같은 목록·같은 조건으로 돌아오면 보던 페이지를 유지하고, 조건이 바뀌면 첫 페이지부터 보여 준다.
  const caseListKey = isCaseList ? `${path}?${queryControls.params(path)}` : '';
  const caseListPaging = isCaseList ? {
    initialPage: caseListPage.key === caseListKey ? caseListPage.page : 0,
    onPageChange: page => { caseListPage = { key: caseListKey, page }; },
    paginationHost: byId('footer-pagination'),
  } : {};
  unmountWorkspace();
  const selectedCase = isCaseDetail ? dashboardSource.cases.find(row => row.code === code) : undefined;
  const relatedTransactions = selectedCase?.related;
  const perPanel = path === 'alert/overview-perpanel';
  const initialPanel = perPanel ? params?.get('panel') : undefined;
  const selectedRule = path?.startsWith('rule-engine/') ? params?.get('rule') : undefined;
  const selectedReport = isReport ? params?.get('selected') : undefined;
  const reportDocument = /^J-\d{6}-\d{6}$/.test(selectedReport ?? '') ? selectedReport : undefined;
  const readOnly = params?.get('access') === 'read-only' || path?.includes('staff-readonly');
  const evidenceAlert = selectedCase?.kind === 'Alert' && !readOnly ? selectedCase.code : undefined;
  if (activeEvidence?.code !== evidenceAlert) {
    activeEvidence = evidenceAlert ? { code: evidenceAlert, selection: createCaseEvidenceSelection() } : undefined;
  }
  const evidenceSelection = activeEvidence?.selection;
  const workspace = byId('workspace');
  workspace.innerHTML = path ? ScreenLayout(path, {
    code, hasQuery: queryControls.hasQuery() || isReport, showCaseJudgment: Boolean(selectedCase) && !readOnly,
    source: benchmarkFailed ? '원본 데이터를 불러올 수 없습니다.' : undefined,
  }) : '';
  queryControls.renderTags(workspace.querySelector('[data-query-tags]'));
  mountedWorkflows = mountWorkflows(workspace, undefined, {
    actionsHost: byId('footer-actions'),
    paginationHost: byId('footer-pagination'),
    row: selectedCase, perPanel, initialPanel, reportData: isReport || isCaseDetail || isCaseList ? dashboardSource : undefined,
    openRelationRequest: workRequestActor()?.role === 'STAFF' ? relation => openWorkRequest(undefined, relation) : undefined,
    saveEpisode: options => {
      if (serviceMode) {
        return changeLiveEpisode(options).then(result => result.ok
          ? loadLiveSource().then(() => { dashboardSource = caseSource(groups); return result; }) : result);
      }
      const result = changePreviewEpisode({ ...options, cases: dashboardSource.cases, user: currentPreviewUser() });
      if (result.ok) dashboardSource = dashboardFixtures(groups);
      return result;
    },
    refreshEpisode: () => showWorkspace('', code, path, 'none', new URLSearchParams(location.search)),
    reportDocument, evidenceSelection,
    editTransactions: ({ codes: transactionCodes, targetCode, reason }) => {
      if (!evidenceSelection || activeWorkCode !== code || activeEvidence?.selection !== evidenceSelection) {
        return { ok: false, error: '현재 Alert에서 편집할 거래를 다시 선택해 주세요.' };
      }
      const applied = result => {
        if (!result.ok) return result;
        dashboardSource = caseSource(groups);
        const row = dashboardSource.cases.find(item => item.code === code);
        mountedWorkflows.updateCase(row, dashboardSource);
        unmountCaseGraph?.update({ active: row, cases: dashboardSource.cases });
        evidenceSelection.clear();
        document.dispatchEvent(new CustomEvent('aml:notice', { detail: {
          status: 'done',
          title: targetCode ? `거래 ${result.value.transactionCodes.length}건 이동` : `거래 ${result.value.transactionCodes.length}건 제외`,
          description: targetCode ? `${code} → ${targetCode}` : code,
        } }));
        return result;
      };
      if (serviceMode) {
        const mounted = mountedWorkflows;
        const find = wanted => dashboardSource.cases.find(item => item.code === wanted);
        return editLiveTransactions(find(code), transactionCodes, targetCode ? find(targetCode) : undefined, reason)
          .then(result => result.ok ? loadLiveSource().then(() => mountedWorkflows === mounted ? applied(result) : result) : result);
      }
      return applied(editPreviewAlertTransactions({
        cases: dashboardSource.cases, sourceCode: code, targetCode, transactionCodes, reason, user: currentPreviewUser(),
      }));
    },
    startReview: target => {
      if (readOnly || activeWorkCode !== target) return;
      const current = dashboardSource.cases.find(item => item.code === target);
      if (serviceMode) {
        const mounted = mountedWorkflows;
        if (!canStartPreviewReview(current, currentPreviewUser())) return;
        void startLiveReview(current).then(result => {
          if (!result.ok) {
            document.dispatchEvent(new CustomEvent('aml:notice', { detail: { status: 'failed', title: '상태를 바꾸지 못했습니다.', description: result.error } }));
            return;
          }
          return loadLiveSource().then(() => {
            if (mountedWorkflows !== mounted) return;
            dashboardSource = caseSource(groups);
            mountedWorkflows.updateCase(dashboardSource.cases.find(item => item.code === target), dashboardSource);
          });
        });
        return;
      }
      if (!startPreviewReview(current, currentPreviewUser())) return;
      dashboardSource = caseSource(groups);
      mountedWorkflows.updateCase(dashboardSource.cases.find(item => item.code === target), dashboardSource);
    },
    saveJudgment: (target, verdict, details, reasonCategory) => {
      const row = !readOnly && activeWorkCode === target ? dashboardSource.cases.find(item => item.code === target) : undefined;
      if (serviceMode) {
        return saveLiveJudgment(row, verdict, details, reasonCategory).then(result => result.ok
          ? loadLiveSource().then(() => { dashboardSource = caseSource(groups); return result; }) : result);
      }
      const actor = currentPreviewUser();
      const result = savePreviewJudgment(row, verdict, details, reasonCategory, actor?.username ?? '', actor);
      if (result.ok) dashboardSource = caseSource(groups);
      return result;
    },
    onJudgmentClose: () => {
      showWorkspace('', code, path, 'none', new URLSearchParams(location.search));
      workspace.querySelector('h1')?.focus({ preventScroll: true });
    },
    onJudgmentReport: id => {
      showWorkspace('', '', sections.report, 'push', new URLSearchParams({ selected: id }));
      workspace.querySelector('h1')?.focus({ preventScroll: true });
    },
    registerTableTools: queryControls.registerTableTools,
    rule: selectedRule && /^RULE-\d{3,}$/.test(selectedRule) ? selectedRule : undefined,
  });
  if (isDashboard) loadPreviewDashboard(mountedWorkflows, dashboardSource,
    { ...queryControls.selection(), mine: path === sections.dashboard });
  const caseGraphHost = byId('workspace').querySelector('[data-case-flow]');
  const evidenceHost = workspace.querySelector('[data-case-evidence]');
  const evidenceTable = evidenceHost && !caseGraphHost && mountTransactionEvidenceTable(evidenceHost, relatedTransactions);
  unmountCaseEvidence = evidenceTable?.unmount;
  if (caseGraphHost) void import('../features/investigation/preview-case-graph.jsx').then(({ mountCaseGraph }) => {
    if (caseGraphHost.isConnected) {
      unmountCaseGraph = mountCaseGraph(caseGraphHost, {
        active: dashboardSource.cases.find(row => row.code === code),
        cases: dashboardSource.cases,
        evidenceSelection,
        onComparedCases: (compared, noticeHost) => mountedWorkflows.updateBundle(compared, noticeHost),
      });
    }
  });
  const ruleTarget = byId('workspace').querySelector('[data-rule-editor], [data-rule-template], [data-risk-dial]');
  if (ruleTarget) void import('../features/rules/rule-controls.jsx').then(({ mountRuleControls }) => {
    if (ruleTarget.isConnected) unmountRuleControls = mountRuleControls(byId('workspace'), byId('footer-actions'));
  });
  const component = byId('workspace').querySelector('[data-investigation-component]');
  const caseTable = byId('workspace').querySelector('[data-case-list-table]');
  if (caseTable) void import('../features/investigation/preview-case-list-table.jsx').then(({ mountPreviewCaseTable }) => {
    if (!caseTable.isConnected) return;
    dashboardSource ??= caseSource(groups);
    const caseRows = new Map(dashboardSource.cases.map(row => [row.code, row]));
    unmountInvestigation = mountPreviewCaseTable(caseTable, caseTable.dataset.caseListTable,
      codes.map(recordCode => caseRows.get(recordCode)).filter(Boolean), groupPrefix === 'E', queryData.rows.length,
      { ...caseListPaging, pageSize: 20 });
  });
  if (component) void import('../features/investigation/investigation-components.jsx').then(({ mountInvestigation }) => {
    if (component.isConnected) {
      ({ unmount: unmountInvestigation, setLedgerView } = mountInvestigation(component, {
        codes,
        code,
        groups,
        cases: serviceMode ? liveSource().cases : undefined,
        label: component.dataset.label,
        tableView: path === ledgerTableScreen,
        ...caseListPaging,
      }));
    }
  });
  if (path) {
    const urlParams = queryControls.params(path);
    if (initialPanel) urlParams.set('panel', initialPanel);
    if (reportDocument) urlParams.set('selected', reportDocument);
    if (selectedRule && /^RULE-\d{3,}$/.test(selectedRule)) urlParams.set('rule', selectedRule);
    updateWorkspaceAddress(path, code, navigationMode, urlParams);
  }
}

const readWorkTabCodes = () => Array.from(document.querySelectorAll('.work-tabs [data-work-code]'), tab => tab.dataset.workCode);
persistWorkTabs();

function persistWorkTabs() {
  const codes = readWorkTabCodes();
  setWorkTabCodes(codes);
  try {
    sessionStorage.setItem(workTabsStorageKey, JSON.stringify({ version: 3, codes }));
  } catch {
    // Work tabs still function without storage.
  }
}

function addWorkTab(code, position = 'beforeend') {
  if (!validWorkCode(code)) return;
  if (isBenchmarkTransactionCode(code) && (!benchmarkLedgerRoute ||
    !benchmarkDataset?.records.some(record => record.code === code))) return;
  const group = byId(`group-${code[0]}`);
  if (!group) return;
  const selector = `[data-work-code="${code}"]`;
  const existing = group.querySelector(selector);
  if (!existing) {
    group.insertAdjacentHTML(position, WorkTab(code));
    persistWorkTabs();
  }
  return { group, tab: existing ?? group.querySelector(selector), added: !existing };
}

function addWorkTabFromCard(button, code) {
  const source = button.closest('.card-header, tr')?.querySelector('.card-header-main code, th code') ?? button;
  const verdict = button.closest('[data-verdict]')?.dataset.verdict;
  const from = source.getBoundingClientRect();
  const transferFocus = button.matches(':focus-visible');
  const destination = addWorkTab(code, 'afterbegin');
  if (!destination?.tab) return;
  const { group, tab, added } = destination;
  const sidebar = byId('sidebar');
  const closed = sidebar.hidden;
  const target = closed ? sidebarButton : tab;
  if (!closed) {
    const disclosure = group.previousElementSibling.querySelector('.group-toggle');
    if (group.hidden) toggleDisclosure(disclosure, undefined, true);
    const scrollArea = sidebar.querySelector('.scroll-area');
    const area = scrollArea.getBoundingClientRect();
    const position = tab.getBoundingClientRect();
    if (position.top < area.top) scrollArea.scrollTop += position.top - area.top;
    if (position.bottom > area.bottom) scrollArea.scrollTop += position.bottom - area.bottom;
  }
  function acknowledge() {
    if (transferFocus && target.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
    target.dataset.workTabReceived = '';
    window.setTimeout(() => delete target.dataset.workTabReceived, 550);
    document.dispatchEvent(new CustomEvent('aml:notice', { detail: {
      title: added ? '사이드바 탭에 추가됨' : '사이드바에 이미 있음',
      description: code,
      status: added ? 'done' : 'info',
      showTimer: false,
    } }));
  }
  if (document.documentElement.dataset.reducedMotion === 'true') {
    acknowledge();
    return;
  }
  const to = target.getBoundingClientRect();
  const arrival = closed || !added ? undefined : tab.closest('.work-tab').animate([
    { opacity: 0, transform: 'translateX(12px) scale(.97)' },
    { opacity: 1, transform: 'none' },
  ], { duration: 140, delay: 390, fill: 'backwards', easing: 'ease-out' });
  const flying = document.createElement('code');
  flying.className = 'work-tab-flight';
  if (verdict) flying.dataset.verdict = verdict;
  flying.setAttribute('aria-hidden', 'true');
  flying.textContent = code;
  flying.style.left = `${from.left}px`;
  flying.style.top = `${from.top + from.height / 2}px`;
  document.body.append(flying);
  const x = to.left + to.width / 2 - from.left - flying.offsetWidth / 2;
  const y = to.top + to.height / 2 - from.top - from.height / 2;
  const motion = flying.animate([
    { transform: 'translate(0, -50%) scale(1)', opacity: 1, easing: 'cubic-bezier(.3, 0, .85, .48)' },
    { transform: `translate(${x * .7}px, calc(-50% + ${y * .42}px)) scale(.78)`, opacity: 1, offset: .62,
      easing: 'cubic-bezier(.28, .6, .55, 1)' },
    { transform: `translate(${x}px, calc(-50% + ${y}px)) scale(.1)`, opacity: 0 },
  ], { duration: 480, fill: 'both' });
  motion.finished.then(() => {
    if (target.isConnected) {
      acknowledge();
      if (closed && sidebar.hidden) target.animate([
        { transform: 'scale(1)' }, { transform: 'scale(1.13)', offset: .35 }, { transform: 'scale(1)' },
      ], { duration: 260, easing: 'ease-out' });
    }
  }).catch(() => { arrival?.finish(); }).finally(() => flying.remove());
}

function openWorkCode(code, moveFocus = true) {
  addWorkTab(code);
  showWorkspace(code[0], code);
  if (moveFocus) byId('workspace').querySelector('h1')?.focus({ preventScroll: true });
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.matches('.group-toggle')) toggleDisclosure(button);
  if (button?.dataset.investigation) showWorkspace(button.dataset.investigation);
  if (button?.dataset.workCode) {
    const { workCode } = button.dataset;
    if (button.hasAttribute('data-add-work-tab')) addWorkTabFromCard(button, workCode);
    else openWorkCode(workCode, byId('workspace').contains(button));
  }
  if (button?.matches('[data-close-tab]')) {
    const tab = button.closest('.work-tab');
    const next = tab.nextElementSibling ?? tab.previousElementSibling;
    const focusTarget = next?.querySelector('button') ?? tab.closest('section').querySelector('.group-toggle');
    const code = tab.querySelector('[data-work-code]').dataset.workCode;
    tab.remove();
    persistWorkTabs();
    if (code === activeWorkCode) {
      const nextCode = next?.querySelector('[data-work-code]').dataset.workCode;
      showWorkspace(nextCode?.[0] ?? code[0], nextCode);
    }
    focusTarget.focus();
  }
  if (narrowShell.matches && button?.matches('[data-investigation], .work-tab-open') && button.closest('#sidebar')) {
    toggleDisclosure(sidebarButton, '사이드바', false);
    byId('workspace').querySelector('h1')?.focus({ preventScroll: true });
  }
});

const searchDialog = byId('search-dialog');
flushSync(() => createRoot(byId('search-field-host')).render(createElement(SearchField, {
  id: 'search-query', label: '작업 코드 검색', placeholder: '작업 코드 검색', autoFocus: true,
}, createElement(DialogClose, { id: 'search-close', label: '검색 닫기' }))));
const searchQuery = byId('search-query');
const searchResults = byId('search-results');

function SearchResult(code) {
  const row = document.createElement('li');
  row.className = 'list-item-enter';
  row.innerHTML = Button(`<code>${code}</code>`, { variant: 'row search-result', attributes: `data-search-code="${code}"` });
  return row;
}

function renderSearchResults() {
  const query = searchQuery.value.trim().toUpperCase();
  const codes = [...tabGroups.flatMap(tabCodes), ...(benchmarkDataset?.records ?? []).map(row => row.code)];
  const matches = [...new Set(codes.filter(code => code.includes(query)))];
  const focused = searchResults.contains(document.activeElement) ? document.activeElement : null;
  if (matches.length) {
    let list = searchResults.querySelector('ul');
    if (!list) {
      list = document.createElement('ul');
      list.setAttribute('aria-label', '검색 결과');
      searchResults.replaceChildren(list);
    }
    const visible = matches.slice(0, 30);
    const existing = new Map([...list.children].map(row => [row.firstElementChild.dataset.searchCode, row]));
    const visibleCodes = new Set(visible);
    for (const [code, row] of existing) if (!visibleCodes.has(code)) row.remove();
    visible.forEach((code, index) => {
      const row = existing.get(code) ?? SearchResult(code);
      const current = list.children[index];
      if (row !== current) list.insertBefore(row, current ?? null);
    });
  } else {
    searchResults.innerHTML = '<p>검색 결과가 없습니다.</p>';
  }
  if (focused && document.activeElement !== focused) {
    (focused.isConnected ? focused : searchQuery).focus({ preventScroll: true });
  }
  byId('search-status').textContent = matches.length ? `검색 결과 ${matches.length}건` : '검색 결과가 없습니다.';
}

byId('search-toggle').addEventListener('click', () => {
  renderSearchResults();
  searchDialog.showModal();
  if (benchmarkLedgerRoute && !benchmarkDataset) void loadBenchmarkDataset().then(() => {
    if (searchDialog.open) renderSearchResults();
  }).catch(() => {});
});
enableBackdropDismissal(searchDialog);
searchQuery.addEventListener('input', renderSearchResults);
searchResults.addEventListener('click', event => {
  const result = event.target.closest('[data-search-code]');
  if (!result) return;
  searchDialog.close();
  openWorkCode(result.dataset.searchCode);
});
searchDialog.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  const fromInput = event.target === searchQuery;
  const fromResult = event.target.matches('[data-search-code]');
  if (!fromInput && !fromResult) return;
  const results = [...searchResults.querySelectorAll('[data-search-code]')];
  if (!results.length) return;
  if (event.key === 'Enter' && fromInput && searchQuery.value.trim()) {
    event.preventDefault();
    results[0].click();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = results.indexOf(event.target);
    const next = event.key === 'ArrowDown' ? results[Math.min(index + 1, results.length - 1)] : results[index - 1];
    (next ?? searchQuery).focus();
  }
});
const unreadOnly = byId('unread-only');
const notificationDialog = byId('notification-dialog');
const workRequestDialog = byId('work-request-dialog');
const workRequestRoot = createRoot(byId('work-request-content'));
const inboxRequestFooter = byId('inbox-request-footer');
const inboxRequestRoot = createRoot(inboxRequestFooter);
let workRequestOrigin;
const notificationRows = new Map();
const emptyNotifications = document.createElement('p');
emptyNotifications.className = 'inbox-empty';
let openedNotificationId;

function openNotification(item) {
  if (item.request) return openWorkRequest(item.request);
  openedNotificationId = item.id;
  byId('notification-detail-title').textContent = item.title;
  const time = byId('notification-detail-time');
  time.dateTime = item.time.toISOString();
  time.textContent = dateFormat.format(item.time);
  byId('notification-detail-description').textContent = item.description || '알림에 추가 내용이 없습니다.';
  const related = byId('notification-detail-cases');
  related.hidden = !liveInbox;
  related.replaceChildren();
  notificationDialog.showModal();
  if (!item.read) void markInboxRead([item]);
  if (liveInbox) void loadNotificationCases(item, related);
}

function workRequestActor() {
  const actor = currentPreviewUser();
  if (serviceMode) return actor?.source === 'api' && liveWorkRequestsReady() ? actor : null;
  return dataMode !== 'ibm' && actor?.source === 'fixture' ? actor : null;
}

// 서비스 모드는 서버의 요청을, 프리뷰는 이 탭에 저장한 요청을 쓴다.
const workRequests = actor => serviceMode ? (actor ? liveWorkRequests() : []) : previewWorkRequests(actor);
const readWorkRequests = (actor, ids) => (serviceMode ? readLiveWorkRequests : readPreviewWorkRequests)(actor, ids);
// 서버가 요청을 받았으면 바뀐 업무와 요청 목록을 다시 받아 온다.
const afterLiveWorkRequest = (result, apply) => result.then(settled => settled.ok
  ? Promise.all([loadLiveSource(), loadLiveWorkRequests()]).then(() => { apply(); return settled; }, () => settled) : settled);

function requestCaseData() {
  if (serviceMode) return liveSource().cases;
  dashboardSource ??= dashboardFixtures(Object.fromEntries(tabGroups.map(group => [group.prefix, tabCodes(group)])));
  return dashboardSource.cases;
}

function applyWorkRequestChange() {
  dashboardSource = undefined;
  renderNotifications();
  if (activePath) showWorkspace('', activeWorkCode, activePath, 'none', new URLSearchParams(location.search));
}

function openWorkRequest(item, relation) {
  const actor = workRequestActor();
  if (!actor) return;
  workRequestOrigin = document.activeElement;
  const cases = requestCaseData();
  const onClose = () => workRequestDialog.close();
  if (item) {
    const showDetail = entry => {
      const row = requestCaseData().find(candidate => candidate.code === entry.code);
      workRequestRoot.render(createElement(WorkRequestDetail, {
        key: entry.at, item: entry, actor, currentAssignee: row && previewCaseAssignee(row),
        onOpenCase: code => { onClose(); toggleDisclosure(inboxButton, '보관함', false); openWorkCode(code); },
        onRespond: options => {
          const applied = () => {
            applyWorkRequestChange();
            showDetail(workRequests(actor).find(request => request.id === item.id));
          };
          if (serviceMode) return afterLiveWorkRequest(resolveLiveWorkRequest(options), applied);
          const result = resolvePreviewWorkRequest({ ...options, actor: workRequestActor(), cases: requestCaseData() });
          if (result.ok) applied();
          return result;
        },
      }));
    };
    if (item.unreadFor.includes(actor.username)) readWorkRequests(actor, [item.id]);
    renderNotifications();
    showDetail(item);
  } else {
    workRequestRoot.render(createElement(WorkRequestForm, {
      actor, cases, initialCode: activeWorkCode, relation,
      onSend: options => {
        const sent = () => {
          onClose();
          if (relation) {
            renderNotifications();
            relation.onSent();
          } else applyWorkRequestChange();
          document.dispatchEvent(new CustomEvent('aml:notice', { detail: { title: serviceMode ? '요청 전송' : 'Sample 요청 전송', status: 'done' } }));
        };
        if (serviceMode) return afterLiveWorkRequest(sendLiveWorkRequest({ ...options, cases: requestCaseData() }), sent);
        const result = sendPreviewWorkRequest({ ...options, actor: workRequestActor(), cases: requestCaseData() });
        if (result.ok) sent();
        return result;
      },
    }));
  }
  workRequestDialog.showModal();
}

enableBackdropDismissal(workRequestDialog);
workRequestDialog.addEventListener('close', () => {
  workRequestRoot.render(null);
  if (!byId('inbox').hidden) {
    (workRequestOrigin?.isConnected ? workRequestOrigin : inboxRequestFooter.querySelector('button'))?.focus({ preventScroll: true });
  }
});

enableBackdropDismissal(notificationDialog);
notificationDialog.addEventListener('close', () => {
  if (document.body.hasAttribute('data-login-required')) return;
  const list = byId('notifications');
  const button = Array.from(list.querySelectorAll('[data-notification-id]'))
    .find(row => row.dataset.notificationId === String(openedNotificationId)) ?? list.querySelector('button');
  (button ?? inboxButton).focus({ preventScroll: true });
});
function renderNotifications(arrivalIds) {
  const actor = workRequestActor();
  inboxRequestRoot.render(createElement(PrimaryButton, {
    tone: 'brand',
    disabled: !actor,
    'aria-description': actor ? undefined : '현재 연결에서는 업무 요청을 보낼 수 없습니다.',
    onClick: () => openWorkRequest(),
  }, '요청 보내기'));
  const requests = workRequests(actor).map(item => ({
    id: item.id, title: `${item.sender === actor.username ? '보낸 요청' : [item.recipient, item.assignee].includes(actor.username) ? '받은 요청' : '담당 변경 알림'} · ${workRequestTypes[item.type].label} · ${requestStateLabels[item.state]}`,
    time: new Date(item.at), read: !item.unreadFor.includes(actor.username), request: item,
  })).sort((left, right) => right.time - left.time);
  // 서버 알림은 페이지로 나뉘므로 업무 요청은 첫 페이지 위에 둔다.
  const items = liveInbox ? [...(liveInbox.number === 0 ? requests : []), ...liveInbox.content] : [...requests, ...notifications];
  const unreadCount = liveInbox ? liveInbox.unreadCount + requests.filter(item => !item.read).length
    : items.filter(item => !item.read).length;
  const countBadge = byId('inbox-count');
  countBadge.hidden = unreadCount === 0;
  countBadge.setAttribute('aria-label', `읽지 않은 알림 ${unreadCount}개`);
  const filtered = unreadOnly.getAttribute('aria-checked') === 'true';
  const list = byId('notifications');
  const activeRow = list.contains(document.activeElement) ? document.activeElement : null;
  const visible = new Map(items.filter(item => !filtered || !item.read)
    .map(item => [`${liveInbox ? 'live' : 'sample'}:${item.id}`, item]));
  for (const [key, row] of notificationRows) {
    if (visible.has(key)) continue;
    row.button.remove();
    notificationRows.delete(key);
  }
  if (visible.size) emptyNotifications.remove();
  else {
    emptyNotifications.textContent = filtered ? '현재 페이지에 읽지 않은 알림이 없습니다.' : '표시할 알림이 없습니다.';
    if (!emptyNotifications.isConnected) list.append(emptyNotifications);
  }
  const animate = arrivalIds instanceof Set && !byId('inbox').hidden && list.scrollTop === 0
    && document.documentElement.dataset.reducedMotion !== 'true' && !motionPreference.matches;
  let nextButton = list.firstChild;
  let stagger = 0;
  for (const [key, item] of visible) {
    let row = notificationRows.get(key);
    const created = !row;
    if (created) {
      row = Notification();
      notificationRows.set(key, row);
    }
    row.update(item);
    const { button } = row;
    if (button !== nextButton) list.insertBefore(button, nextButton);
    nextButton = button.nextSibling;
    if (animate && created && arrivalIds.has(item.id)) {
      button.animate?.([
        { opacity: 0, translate: '0 -12px', scale: '0.88 0.55', transformOrigin: 'left top' },
        { opacity: 1, translate: '0 0', scale: '1 1.02', transformOrigin: 'left top', offset: 0.72 },
        { opacity: 1, translate: '0 0', scale: '1', transformOrigin: 'left top' },
      ], { duration: 520, delay: Math.min(stagger++, 4) * 55, fill: 'backwards', easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
  }
  if (activeRow && !notificationDialog.open && document.activeElement !== activeRow) {
    (activeRow.isConnected ? activeRow : list.querySelector('button') ?? unreadOnly).focus({ preventScroll: true });
  }
  byId('mark-all-read').disabled = !items.some(item => !item.read);
  byId('inbox-pages').hidden = !liveInbox || liveInbox.totalPages <= 1;
  if (liveInbox) {
    byId('inbox-page-status').textContent = `${liveInbox.number + 1} / ${liveInbox.totalPages} 페이지`;
    byId('inbox-previous').disabled = liveInbox.number === 0;
    byId('inbox-next').disabled = liveInbox.number + 1 >= liveInbox.totalPages;
  }
}

async function refreshLiveInbox(page = 0) {
  if (!signedIn || currentPreviewUser()?.source !== 'api') return;
  const request = ++inboxRequest;
  try {
    const [result] = await Promise.all([fetchNotifications('', '', '', page), loadLiveWorkRequests()]);
    const content = result.content.map(item => ({ ...item, time: new Date(item.at) }));
    if (content.some(item => !Number.isFinite(+item.time))) throw new Error('Invalid notification timestamp');
    if (request !== inboxRequest || !signedIn) return;
    const existingIds = liveInbox?.number === result.number && new Set(liveInbox.content.map(item => item.id));
    liveInbox = { ...result, content };
    renderNotifications(existingIds ? new Set(content.filter(item => !existingIds.has(item.id)).map(item => item.id)) : undefined);
  } catch (error) {
    if (request !== inboxRequest || !signedIn) return;
    if (error.problem?.status === 401) {
      liveInbox = undefined;
      renderNotifications();
    }
  }
}

async function markInboxRead(items) {
  if (!items.length) return;
  if (liveInbox) {
    const requestIds = items.filter(item => item.request).map(item => item.id);
    if (requestIds.length) readWorkRequests(workRequestActor(), requestIds);
    items = items.filter(item => !item.request);
    if (!items.length) return renderNotifications();
    try {
      await setNotificationsRead(items.map(item => item.id), true);
      await refreshLiveInbox(liveInbox?.number ?? 0);
    } catch {
      document.dispatchEvent(new CustomEvent('aml:notice', { detail: { title: '알림 읽음 상태를 저장할 수 없습니다.', status: 'warning' } }));
    }
    return;
  }
  const requestIds = items.filter(item => item.request).map(item => item.id);
  if (requestIds.length) readWorkRequests(workRequestActor(), requestIds);
  items.filter(item => !item.request).forEach(item => { item.read = true; });
  renderNotifications();
}

async function loadNotificationCases(item, host) {
  try {
    const result = await fetchNotificationCases(item.id, 0);
    if (!notificationDialog.open || openedNotificationId !== item.id) return;
    const list = document.createElement('ul');
    for (const record of result.content) {
      const row = document.createElement('li');
      row.textContent = record.kind === 'ALERT' ? `Alert ${record.alertId ?? record.caseId}` : `Episode ${record.caseId}`;
      list.append(row);
    }
    if (list.children.length) host.replaceChildren(list);
  } catch {
    if (notificationDialog.open && openedNotificationId === item.id) host.textContent = '연결된 업무를 불러오지 못했습니다.';
  }
}
document.addEventListener('aml:result', ({ detail }) => {
  if (liveInbox || !receivesSampleNotifications() || typeof detail?.title !== 'string') return;
  notifications.unshift({ id: ++nextNotificationId, title: detail.title,
    description: typeof detail.description === 'string' ? detail.description : '', read: false, time: new Date() });
  renderNotifications(new Set([nextNotificationId]));
});
window.addEventListener('live-data-changed', () => {
  if (!byId('inbox').hidden) void refreshLiveInbox(liveInbox?.number ?? 0);
});
bindSquishSwitch(unreadOnly, renderNotifications);
byId('mark-all-read').addEventListener('click', () => {
  const actor = workRequestActor();
  if (actor) {
    const ids = workRequests(actor).filter(item => item.unreadFor.includes(actor.username)).map(item => item.id);
    if (ids.length) readWorkRequests(actor, ids);
  }
  void markInboxRead((liveInbox?.content ?? notifications).filter(item => !item.read));
  renderNotifications();
});
byId('inbox-previous').addEventListener('click', () => void refreshLiveInbox((liveInbox?.number ?? 1) - 1));
byId('inbox-next').addEventListener('click', () => void refreshLiveInbox((liveInbox?.number ?? 0) + 1));
renderNotifications();

bindCardGlow(document.body);

const tooltip = byId('tooltip');
for (const button of document.querySelectorAll('.icon-button[aria-label]:not([data-query-tool]), #unread-only, #account-toggle')) {
  bindTooltip(button, tooltip);
}

const previewSessionKey = 'aml-live-layout-signed-in';
const previewActorKey = 'aml-live-layout-signed-in-actor';
const demoActor = 'demo';
const loginHistoryKey = 'aml-live-layout-login-history';
const loginTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul',
});
let signedIn = false;
let previewActor;
let loginHistory = [];
try {
  signedIn = !serviceMode && sessionStorage.getItem(previewSessionKey) === 'true';
  if (signedIn) {
    previewActor = sessionStorage.getItem(previewActorKey) ?? demoActor;
    setPreviewUser(previewUserForActor(previewActor));
  }
  const history = JSON.parse(sessionStorage.getItem(loginHistoryKey));
  if (Array.isArray(history)) {
    loginHistory = history.filter(time => typeof time === 'string' && Number.isFinite(Date.parse(time)));
  }
} catch {
  // Start at sign-in when browser storage is unavailable.
}

function previewUserForActor(actor) {
  if (actor === alternatePreviewStaff.username) return alternatePreviewStaff;
  return actor === previewStaff.username || (actor === demoActor && !sampleData) ? previewStaff : previewAdmin;
}

function renderPreviewProfile() {
  const user = currentPreviewUser();
  for (const element of document.querySelectorAll('[data-preview-user-name]')) element.textContent = user?.name ?? profileName;
  for (const element of document.querySelectorAll('[data-preview-user-role]')) {
    element.textContent = user?.role === 'ADMIN' ? '관리자' : profileRole;
  }
}
subscribePreviewUser(renderPreviewProfile);
subscribePreviewUser(renderNotifications);
renderPreviewProfile();
renderNotifications();

async function refreshPreviewSessionUser() {
  const previous = currentPreviewUser();
  if (serviceMode || !signedIn || sampleData || previewActor !== demoActor) return;
  try {
    const user = await restoreSession();
    if (signedIn && currentPreviewUser() === previous) setPreviewUser({ ...user, source: 'api' });
  } catch {
    if (signedIn && previous === currentPreviewUser()) {
      if (previous === previewStaff) setPreviewUser(previewAdmin);
      else if (previous?.source === 'api') {
        inboxRequest++;
        liveInbox = undefined;
        setPreviewUser(null);
        renderNotifications();
      }
    }
  }
}

function renderLoginHistory() {
  byId('login-history-empty').hidden = loginHistory.length > 0;
  byId('login-history').replaceChildren(...loginHistory.map((timestamp, index) => {
    const entry = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = timestamp;
    time.textContent = `${loginTime.format(new Date(timestamp))} KST`;
    entry.append(time);
    if (index === 0 && signedIn) entry.append(' · 현재 세션');
    return entry;
  }));
}

function renderProfilePicture() {
  for (const image of document.querySelectorAll('[data-profile-image]')) image.src = profilePicture;
}

byId('account-toggle').addEventListener('click', () => {
  renderLoginHistory();
  byId('profile-status').textContent = '';
});
const pictureInput = byId('profile-picture');
byId('profile-picture-change').addEventListener('click', () => pictureInput.click());
pictureInput.addEventListener('change', async () => {
  const file = pictureInput.files[0];
  pictureInput.value = '';
  if (!file) return;
  const status = byId('profile-status');
  if (!profilePictureTypes.includes(file.type) || file.size > 1024 * 1024) {
    status.textContent = '1MB 이하의 PNG, JPG, WebP 사진을 선택하세요.';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('error', () => { status.textContent = '사진을 읽을 수 없습니다.'; });
  reader.addEventListener('load', async () => {
    const preview = new Image();
    preview.src = reader.result;
    try {
      await preview.decode();
    } catch {
      status.textContent = '사진을 읽을 수 없습니다.';
      return;
    }
    profilePicture = reader.result;
    try { sessionStorage.setItem(profilePictureKey, profilePicture); } catch { /* Keep the current preview. */ }
    renderProfilePicture();
    status.textContent = '프로필 사진을 변경했습니다.';
  });
  reader.readAsDataURL(file);
});
renderProfilePicture();

function setPreviewSession(actor, user) {
  const active = Boolean(actor);
  const isNewSession = active && !signedIn;
  signedIn = active;
  previewActor = actor;
  setPreviewUser(user ? { ...user, source: 'api' } : active ? previewUserForActor(actor) : null);
  if (!active) {
    inboxRequest++;
    liveInbox = undefined;
    renderNotifications();
  }
  if (isNewSession) loginHistory = [new Date().toISOString(), ...loginHistory].slice(0, 20);
  try {
    if (signedIn && !serviceMode) {
      sessionStorage.setItem(previewSessionKey, 'true');
      sessionStorage.setItem(previewActorKey, actor);
    } else {
      sessionStorage.removeItem(previewSessionKey);
      sessionStorage.removeItem(previewActorKey);
    }
    if (isNewSession) sessionStorage.setItem(loginHistoryKey, JSON.stringify(loginHistory));
  } catch {
    // The preview can run for this page even with browser storage off.
  }
}

function closeTransientViews() {
  if (searchDialog.open) searchDialog.close();
  if (notificationDialog.open) notificationDialog.close();
  if (workRequestDialog.open) workRequestDialog.close();
  searchQuery.value = '';
  for (const dialog of preferenceDialogs) if (dialog.open) dialog.close();
  queryControls.dismiss();
  toggleDisclosure(inboxButton, '보관함', false);
  hideTooltip(tooltip);
}

function showLogin() {
  loginScene.cancel();
  cancelAnimationFrame(navigationFrame);
  document.body.setAttribute('data-login-required', '');
  byId('preview-login').hidden = false;
  requestAnimationFrame(() => loginId.focus());
}

function showRoute(route, params, navigationMode) {
  loginScene.cancel();
  document.body.removeAttribute('data-login-required');
  byId('preview-login').hidden = true;
  if (serviceMode && !liveSourceLoaded()) {
    const actor = previewActor;
    const open = () => {
      if (!signedIn || previewActor !== actor) return;
      dashboardSource = undefined;
      showLoadedRoute(route, params, navigationMode);
    };
    void Promise.all([loadLiveSource(), loadLiveRules(), loadLiveWorkRequests().catch(() => undefined)]).then(open, () => {
      document.dispatchEvent(new CustomEvent('aml:notice', { detail: {
        status: 'failed', title: '데이터를 불러올 수 없습니다.', description: '잠시 후 다시 시도해 주세요.',
      } }));
      open();
    });
    return;
  }
  showLoadedRoute(route, params, navigationMode);
}

function showLoadedRoute(route, params, navigationMode) {
  if (serviceMode) {
    // 서버에 없는 사건 탭(이전 세션, 다른 데이터)은 열지 않는다.
    const cases = new Set(liveSource().cases.map(row => row.code));
    let removed = false;
    for (const tab of document.querySelectorAll('.work-tabs [data-work-code]')) {
      if (tab.dataset.workCode.startsWith('T-') || cases.has(tab.dataset.workCode)) continue;
      tab.closest('.work-tab').remove();
      removed = true;
    }
    if (removed) persistWorkTabs();
    if (route.code && !route.code.startsWith('T-') && !cases.has(route.code)) route = dashboardRoute;
  }
  if (route.code) addWorkTab(route.code);
  showWorkspace('', route.code, route.screen, navigationMode, params);
}

function restoreLocation() {
  closeTransientViews();
  const url = new URL(location.href);
  const route = readPreviewRoute(url);
  if (!signedIn || route.screen === loginRoute.screen) {
    if (route.screen !== loginRoute.screen) {
      history.replaceState({ previewNext: url.pathname + url.search }, '',
        previewUrl(loginRoute, dataMode ? new URLSearchParams({ data: dataMode }) : undefined));
    }
    showLogin();
    return;
  }
  showRoute(route, url.searchParams, 'replace');
}

const loginForm = byId('preview-login-form');
const loginScene = mountLoginScene(byId('preview-login'), motionPreference);
const loginId = byId('preview-login-id');
const loginPassword = byId('preview-login-password');
const passwordToggle = byId('login-password-toggle');
const passwordIcon = createRoot(passwordToggle);
function showLoginPassword(visible) {
  loginPassword.type = visible ? 'text' : 'password';
  passwordToggle.setAttribute('aria-pressed', String(visible));
  passwordIcon.render(createElement(visible ? EyeOff : Eye, { className: 'icon', 'aria-hidden': true }));
}
showLoginPassword(false);
passwordToggle.addEventListener('click', () => showLoginPassword(loginPassword.type === 'password'));
const loginError = byId('preview-login-error');
const loginFields = [loginId, loginPassword];
const sampleCredentials = { id: demoActor, password: 'radar-demo' };
let loginShake;
let loginAudio;

function playLoginWarning() {
  if (!window.AudioContext) return;
  try {
    loginAudio ??= new AudioContext();
    void loginAudio.resume().then(() => {
      const start = loginAudio.currentTime;
      const tone = loginAudio.createOscillator();
      const volume = loginAudio.createGain();
      tone.frequency.value = 660;
      volume.gain.value = 0;
      tone.connect(volume);
      volume.connect(loginAudio.destination);
      for (const delay of [0, .12]) {
        volume.gain.setValueAtTime(0, start + delay);
        volume.gain.linearRampToValueAtTime(.09, start + delay + .012);
        volume.gain.linearRampToValueAtTime(0, start + delay + .08);
      }
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      tone.start(start);
      tone.stop(start + .20);
    }).catch(() => {});
  } catch {
    // The visible warning also works if the browser cannot play audio.
  }
}

function clearLoginError() {
  loginError.textContent = '';
  for (const field of loginFields) {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }
}

function showLoginError(message, invalidFields) {
  loginError.textContent = message;
  for (const field of invalidFields) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', loginError.id);
  }
  playLoginWarning();
  loginShake?.cancel();
  if (document.documentElement.dataset.reducedMotion !== 'true') {
    loginShake = loginForm.animate([0, -7, 6, -4, 3, 0].map(x => ({ translate: `${x}px` })),
      { duration: 300, easing: 'ease-out' });
  }
}

const loginButton = (label, props) => createElement(PrimaryButton, { ...props, size: 'comfortable' }, label);
const loginActionRoot = createRoot(byId('preview-login-action'));
const setLoginDisabled = disabled => loginActionRoot.render(
  loginButton('로그인', { id: 'preview-sign-in', tone: 'brand', type: 'submit', disabled }),
);
setLoginDisabled(true);
const loginFailureLimit = 3;
let failedLogins = 0;
let signingIn = false;
function updateLoginButton() {
  const locked = failedLogins >= loginFailureLimit;
  loginForm.toggleAttribute('data-login-locked', locked);
  setLoginDisabled(locked || signingIn || !loginId.value.trim() || !loginPassword.value);
}
function rejectLogin() {
  failedLogins++;
  loginPassword.value = '';
  showLoginPassword(false);
  updateLoginButton();
  if (failedLogins >= loginFailureLimit) {
    showLoginError('로그인에 3번 실패했습니다. 아이디 또는 비밀번호 찾기를 이용해 주세요.', loginFields);
    loginForm.querySelector('[data-login-help]').focus();
  } else {
    showLoginError('아이디 또는 비밀번호가 올바르지 않습니다.', loginFields);
    loginPassword.focus();
  }
}
const loginHelp = byId('login-help-dialog');
enableBackdropDismissal(loginHelp);
createRoot(byId('preview-login-help-actions')).render(
  [['id', '아이디 찾기'], ['password', '비밀번호 찾기']].map(([kind, label]) => loginButton(label, {
    key: kind, 'data-login-help': kind, 'aria-haspopup': 'dialog',
    onClick() {
      const findId = kind === 'id';
      byId('login-help-title').textContent = label;
      byId('login-help-instructions').textContent = findId
        ? '관리자에게 본인 계정의 로그인 아이디를 확인해 주세요.'
        : '관리자에게 비밀번호 재설정을 요청해 주세요.';
      loginHelp.showModal();
    },
  })),
);
loginForm.addEventListener('input', () => {
  if (failedLogins < loginFailureLimit) clearLoginError();
  updateLoginButton();
});
loginForm.addEventListener('change', updateLoginButton);
window.addEventListener('pageshow', updateLoginButton);
if (!serviceMode) {
  const actors = [
    ['preview-sample-login', '관리자로 간편 로그인', previewAdmin],
    ['preview-staff-login', '분석가로 간편 로그인', previewStaff],
    ...(sampleData ? [['preview-alt-staff-login', '분석가 2로 간편 로그인', alternatePreviewStaff]] : []),
  ];
  createRoot(byId('preview-login-sample-actions')).render([
    createElement('p', { key: 'notice' }, '테스트 전용 간편 로그인 · 검수 종료 즉시 제거'),
    ...actors.map(([id, label, actor]) => loginButton(label, { key: id, id, onClick: () => enterPreview(actor.username) })),
  ]);
}
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (signingIn || loginScene.transitioning || failedLogins >= loginFailureLimit) return;
  clearLoginError();
  const id = loginId.value.trim();
  const password = loginPassword.value;
  if (!id || !password) {
    const missing = loginFields.filter(field => !field.value.trim());
    showLoginError('아이디와 비밀번호를 입력해 주세요.', missing);
    missing[0].focus();
    return;
  }
  if (serviceMode) {
    signingIn = true;
    updateLoginButton();
    loginForm.setAttribute('aria-busy', 'true');
    try {
      const user = await login(id, password);
      loginScene.enter(animated => enterWorkspace(user.username, animated, user));
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 401) rejectLogin();
      else showLoginError('로그인할 수 없습니다. 서버 연결을 확인해 주세요.', []);
    } finally {
      signingIn = false;
      loginForm.removeAttribute('aria-busy');
      updateLoginButton();
    }
    return;
  }
  if (id !== sampleCredentials.id || password !== sampleCredentials.password) {
    rejectLogin();
    return;
  }
  enterPreview(demoActor);
});
function enterPreview(actor) {
  if (loginScene.transitioning) return;
  loginShake?.cancel();
  loginScene.enter(animated => enterWorkspace(actor, animated));
}

function enterWorkspace(actor, animated, user) {
  loginForm.reset();
  failedLogins = 0;
  updateLoginButton();
  showLoginPassword(false);
  setPreviewSession(actor, user);
  void refreshPreviewSessionUser().then(() => refreshLiveInbox());
  const next = history.state?.previewNext;
  const previous = typeof next === 'string' && /^\/(?!\/)/.test(next) ? new URL(next, location.origin) : undefined;
  const route = previous ? readPreviewRoute(previous) : dashboardRoute;
  showRoute(route, previous?.searchParams, 'push');
  const workspace = byId('workspace');
  if (animated && route.screen.startsWith('dashboard/')) {
    workspace.querySelector('.screen-layout')?.animate([
      { transformOrigin: '50% 44vh', transform: 'perspective(900px) translate3d(0, 12px, -145px)', opacity: 0.16 },
      { transformOrigin: '50% 44vh', transform: 'perspective(900px) translate3d(0, 0, 0)', opacity: 1 },
    ], { duration: 460, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }
  workspace.querySelector('h1')?.focus({ preventScroll: true });
}
let signingOut = false;
async function signOut() {
  if (signingOut) return;
  if (serviceMode) {
    signingOut = true;
    try {
      await logout();
    } catch {
      byId('profile-status').textContent = '로그아웃에 실패했습니다. 다시 시도해 주세요.';
      return;
    } finally {
      signingOut = false;
    }
  }
  clearWorkspaceSession();
  history.replaceState(null, '', previewUrl(loginRoute));
  restoreLocation();
}
function clearWorkspaceSession() {
  setPreviewSession(null);
  activeEvidence = undefined;
  resetPreviewCaseRead();
  resetLiveSource();
  resetLiveWorkRequests();
  dashboardSource = undefined;
}
for (const host of document.querySelectorAll('[data-dialog-heading]')) {
  const { dialogHeading: id, dialogTitle: title } = host.dataset;
  createRoot(host).render(createElement(DialogHeader, {
    title, titleId: `${id}-title`, closeId: `${id}-close`, closeLabel: `${title} 닫기`,
  }));
}
createRoot(byId('preview-sign-out')).render(createElement(DialogFooter, null,
  createElement(ConfirmHoldButton, { tone: 'negative', onHold: signOut, doneLabel: '로그아웃' }, '길게 눌러 로그아웃')));
window.addEventListener('popstate', restoreLocation);
document.addEventListener('aml:model-risk', () => {
  if (signedIn && activePath) showWorkspace('', activeWorkCode, activePath, 'none', new URLSearchParams(location.search));
});
restoreLocation();
if (serviceMode) {
  window.addEventListener('auth-expired', () => {
    if (!signedIn) return;
    clearWorkspaceSession();
    restoreLocation();
  });
  void restoreSession().then(user => {
    if (!signingIn && !signedIn && !loginScene.transitioning) enterWorkspace(user.username, false, user);
  }, () => {
    // Leave the user at login when the server session is missing or unavailable.
  });
} else if (signedIn) {
  void refreshPreviewSessionUser().then(() => refreshLiveInbox());
}
