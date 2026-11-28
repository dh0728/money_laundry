import { isRuleId } from '@/features/rules/rules-logic';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Eye, EyeOff, Monitor, Moon, Sun } from 'lucide-react';
import { login, logout, restoreSession } from '@/api/auth';
import { ApiError } from '@/api/common';
import { alternatePreviewStaff, currentPreviewUser, previewAdmin, previewStaff, setPreviewUser, subscribePreviewUser } from '../features/auth/preview-session-user.js';
import { fetchNotificationCases, fetchNotifications, setNotificationsRead } from '@/api/notifications';
import { bindCardGlow } from '../components/card-glow.js';
import { PrimaryButton } from '../components/primary-button.jsx';
import { DialogClose, DialogFooter, DialogHeader } from '../components/dialog-parts.jsx';
import { FooterPagination } from '../components/footer-pagination.jsx';
import { SearchField } from '../components/search-field.jsx';
import { reviewStatusLabels } from '../lib/review-status.js';
import { csvDownloadEntry, inDateRange, QueryRadio, setupQueryControls, WorkspaceQueryDock } from '../components/query-controls.jsx';
import { dashboardFixtureBoardPage, dashboardFixtureResponse, dashboardFixtures, dashboardPeriodEnd, dashboardRecordCodes } from '../mocks/dashboard-fixtures.js';
import { personalWorkHistory } from '../features/dashboard/personal-work-history.js';
import { liveCaseSignatures, liveCodes, liveLoadedAt, liveSource, liveSourceLoaded, loadLiveSource, markLiveJudged, markLiveReviewStarted, rebuildLiveSource,
  resetLiveSource } from '../features/investigation/live-data.js';
import { changeLiveEpisode, editLiveTransactions, markLiveRead, saveLiveJudgment, startLiveReview } from '../features/investigation/live-actions.js';
import { liveWorkRequests, liveWorkRequestsReady, loadLiveWorkRequests, readLiveWorkRequests, resetLiveWorkRequests, resolveLiveWorkRequest,
  sendLiveWorkRequest } from '../features/investigation/live-work-requests.js';
import { changePreviewEpisode } from '../features/investigation/preview-episode-transfer.js';
import { liveDashboardAsOf, liveDashboardResponse } from '../features/dashboard/live-dashboard.js';
import { clampDashboardDate, dashboardDateRange, shiftDateKey, sourceAsOf } from '../features/dashboard/dashboard-as-of.js';
import { refreshLiveRules } from '../features/rules/live-rule-store';
import { canStartPreviewReview, savePreviewJudgment, startPreviewReview } from '../features/investigation/case-judgment-data.js';
import { requestStateLabels, WorkRequestDetail, WorkRequestForm } from '../features/investigation/preview-work-request-dialog.jsx';
import { previewCaseAssignee, previewWorkRequests, readPreviewWorkRequests, resolvePreviewWorkRequest, sendPreviewWorkRequest,
  workRequestTypes } from '../features/investigation/preview-work-requests.js';
import { createCaseEvidenceSelection } from '../features/investigation/case-evidence-selection.js';
import { editPreviewAlertTransactions } from '../features/investigation/case-membership-data.js';
import { markPreviewCaseRead, resetPreviewCaseRead } from '../features/investigation/case-read-state.js';
import { mountTransactionEvidenceTable } from '../features/investigation/preview-case-table.jsx';
import { mountWorkflows, mountWorkflowNotifications } from '../pages/workflow-components.jsx';
import { mountInvestigationLoading } from '../features/investigation/investigation-skeletons.jsx';
import { renderScreenNav, refreshScreenNav } from './screen-navigation.jsx';
import { caseRoute, frameLabel, screenFrame, ScreenLayout, ScreenNavigation, sections } from './screen-layouts.js';
import { BoxHTML, BrandSymbol, Button, DecorativeCanvasHTML, Divider, GlassDialog, HeadingHTML, HTMLFragment, HTMLNode,
  Icon, IconButton, InputHTML, ProfileAvatarHTML, ScrollArea, Sidebar, TextHTML, Tooltip, bindTooltip, hideTooltip } from '../components/components.js';
import { Text } from '../components/layout-primitives.jsx';
import { setupGlassMaterial } from '../components/glass-material.js';
import { mountLoginScene } from '../features/auth/preview-login-scene.js';
import { uiSizeOptions } from '../config/appearance-options.js';
import { enableBackdropDismissal, setupOverlayDismissal } from '../lib/overlay-dismissal.js';
import { SquishSwitch, bindSquishSwitch } from '../components/squish-switch.js';
import { mountNotificationPreference, receivesSampleNotifications } from '../features/settings/notification-preference.jsx';
import { notificationRowTitle, ruleNotificationLink, RuleNotificationLink } from '../features/rules/rule-notification.jsx';
import { getModelRiskThresholds, loadLiveModelRiskThresholds } from '../features/settings/model-risk-settings.js';
import { restoreWorkTabCodes, setWorkTabCodes } from './work-tab-state.js';
import { startSessionKeepalive } from './session-keepalive.js';
import { changedCaseCount, startLiveRefresh } from './live-refresh.js';
import { benchmarkLedgerPath, dashboardRoute, initialDetail, isBenchmarkTransactionCode, isLedgerScreen, ledgerTableScreen, loginRoute, previewUrl, readPreviewRoute, validWorkCode } from './preview-route.js';
import { appMotionPreference, appReducedMotion, systemReducedMotion } from '@/hooks/use-reduced-motion';

const tabGroups = [
  { name: 'Transactions', prefix: 'T', digits: 8 },
  { name: 'Alert', prefix: 'A', digits: 6, first: [1042, 1051, 1069] },
  { name: 'Episode', prefix: 'E', digits: 6 },
];
const serviceMode = import.meta.env.VITE_API_MODE === 'live';
const localBenchmark = import.meta.env.DEV && !serviceMode;
const pendingEntry = location.pathname === '/login' ? history.state?.previewNext : undefined;
const entryPath = typeof pendingEntry === 'string' && pendingEntry.startsWith('/')
  ? new URL(pendingEntry, location.origin).pathname : location.pathname;
const benchmarkLedgerRoute = localBenchmark && entryPath.replace(/\/$/, '') === benchmarkLedgerPath;
function readDataMode() {
  if (serviceMode) return;
  if (benchmarkLedgerRoute) return 'ibm';
  const requested = new URLSearchParams(location.search).get('data');
  return requested === 'sample' || (localBenchmark && requested === 'ibm') ? requested : undefined;
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
  .filter(code => serviceMode || benchmarkLedgerRoute || !isBenchmarkTransactionCode(code));

// 대시보드·거래·Alert·Episode 메뉴마다 마지막에 본 화면(전체·개인, 표·카드와 조건)을 기억해 메뉴로 돌아올 때 그대로 연다.
const lastListsStorageKey = benchmarkLedgerRoute ? 'aml-live-layout-ibm-last-lists' : 'aml-live-layout-last-lists';
const listScreens = {
  D: path => /^dashboard\/(?:all|mine)$/.test(path),
  T: path => isLedgerScreen(path),
  A: path => /^add-tab\/alerts-(?:cards|table)(?:\/no-filter)?$/.test(path),
  E: path => /^add-tab\/episodes(?:-table)?(?:\/no-filter)?$/.test(path),
};
const listPrefix = path => Object.keys(listScreens).find(prefix => listScreens[prefix](path ?? ''));
let lastLists = {};
try {
  const stored = JSON.parse(sessionStorage.getItem(lastListsStorageKey)) ?? {};
  for (const [prefix, entry] of Object.entries(stored)) {
    if (listPrefix(entry?.path) === prefix && typeof entry.search === 'string') lastLists[prefix] = entry;
  }
} catch {
  // 저장소를 쓸 수 없으면 기본 목록부터 연다.
}

function rememberList(path, params) {
  const prefix = listPrefix(path);
  if (!prefix) return;
  const search = new URLSearchParams(params);
  search.delete('data');
  // 거래 메뉴는 보기(표·카드)와 조건만 기억한다. 고른 거래는 작업 탭이 맡는다.
  search.delete('transaction');
  lastLists = { ...lastLists, [prefix]: { path, search: search.toString() } };
  try { sessionStorage.setItem(lastListsStorageKey, JSON.stringify(lastLists)); } catch { /* 이번 페이지에서만 기억한다. */ }
}

const listDestination = prefix => lastLists[prefix]?.path ?? (prefix === 'D' ? sections.dashboard : sections[prefix]);
// 기억한 목록으로 갈 때만 그때의 조건을 함께 넘긴다.
const rememberedParams = path => {
  const entry = lastLists[listPrefix(path)];
  return entry?.path === path ? new URLSearchParams(entry.search) : undefined;
};

function forgetLists() {
  lastLists = {};
  try { sessionStorage.removeItem(lastListsStorageKey); } catch { /* 저장소를 쓸 수 없으면 메모리만 비운다. */ }
}
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
  `새 Alert가 ${reviewStatusLabels.pending} 상태로 등록되었습니다. 담당 업무 목록에서 근거 거래를 확인할 수 있습니다.`,
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
  return BoxHTML(
    BoxHTML(primary, 'class="drawer-chrome__primary"') +
    BoxHTML(accessory, 'class="drawer-chrome__accessory"'),
    `class="drawer-chrome ${className}" ${attributes}`,
  );
}

function Header() {
  const brand = BoxHTML(DrawerChromeRow('brand-header sidebar-chrome',
    IconButton(BrandSymbol('idle-icon') + Icon('left', 'alternate-icon') + TextHTML('AML RADAR', 'class="brand"'),
      '사이드바 열기', 'id="sidebar-toggle" aria-expanded="false" aria-controls="sidebar" data-drawer-button', 'brand-pill', 'floating', 'pill'),
    IconButton(Icon('search'), '검색',
      'id="search-toggle" aria-haspopup="dialog" aria-controls="search-dialog" data-drawer-button', '', 'floating'),
    'data-drawer-controls'), 'class="header-frame header-frame--left"');
  const navigation = BoxHTML(BoxHTML(
    BoxHTML('', 'id="screen-navigation" class="header-frame screen-navigation" hidden'),
    'class="contextual-header"',
  ), 'class="header-frame header-frame--center"');
  // 서비스 모드: 누르면 화면 데이터를 새로 받아 지금 화면을 다시 그린다. 다른 사람이 바꾼 건이 있으면 점으로 알린다.
  // 받은 시각은 대시보드의 기준일 옆과 이 버튼의 설명에 보인다.
  const liveStatus = serviceMode ? IconButton(Icon('refresh') + TextHTML('', 'class="live-refresh-dot unread-dot" hidden'),
    '새로고침', 'id="live-refresh" hidden', 'live-refresh') : '';
  const viewControls = BoxHTML(liveStatus +
    IconButton(Icon('fullscreen'), '전체화면 보기', 'id="fullscreen-toggle" aria-pressed="false"') +
    IconButton(Icon('wide'), '넓게 보기', 'id="workspace-width-toggle" aria-pressed="false"'),
    'class="header-view-controls" role="group" aria-label="화면 보기"',
  );
  const inbox = DrawerChromeRow('inbox-header',
    IconButton(Icon('check'), '현재 페이지 모두 읽음', 'id="mark-all-read"', '', '') +
      SquishSwitch('unread-only', '읽지 않은 항목만 표시'),
    IconButton(Icon('archive', 'idle-icon') + Icon('right', 'alternate-icon') +
      TextHTML('', 'id="inbox-count" class="inbox-count unread-dot"'), '보관함 열기',
      'id="inbox-toggle" aria-expanded="false" aria-controls="inbox" aria-describedby="inbox-count" data-drawer-button', 'inbox-pill', 'floating'),
    'data-drawer-controls');
  const controls = BoxHTML(viewControls + inbox, 'class="header-frame header-frame--right header-right"');
  return BoxHTML(brand + navigation + controls, 'class="app-header" aria-label="헤더"', 'header');
}

function WorkTab(code) {
  return BoxHTML(
    Button(TextHTML(code, '', 'code'), { variant: 'work-tab-open', attributes: `data-work-code="${code}"` }) +
    IconButton(Icon('close', 'icon-compact'), `${code} 닫기`, 'data-close-tab', '', ''),
    'class="work-tab"',
  );
}

// 서비스 모드는 서버에서 받은 사건을, 프리뷰는 샘플을 화면 데이터로 쓴다.
function caseSource(groups) {
  return serviceMode ? rebuildLiveSource() : dashboardFixtures(groups);
}

// 주기적으로 다시 받은 board 에서 아직 화면에 그리지 않은 변경 건수. 화면을 새로 그리면 0으로 돌린다.
let unshownLiveChanges = 0;
let refreshLiveNow = () => undefined;
// 지금 화면을 그릴 때 쓴 board 를 받은 시각(ms). 뒤에서 다시 받아도 화면을 새로 그리기 전에는 바뀌지 않는다.
let shownLoadedAt;
const kstClock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const receivedClock = time => `${kstClock.format(time)} KST`;

async function refreshLiveBoard() {
  const before = liveCaseSignatures();
  await loadLiveSource();
  unshownLiveChanges += changedCaseCount(before, liveCaseSignatures());
  // 지금 화면은 그대로 두고, 버튼 동작이 찾는 행만 새 데이터로 바꾼다. 다음에 그리는 화면은 새 데이터로 그린다.
  if (dashboardSource) dashboardSource = rebuildLiveSource();
  renderLiveRefreshStatus();
}

function renderLiveRefreshStatus() {
  const button = document.getElementById('live-refresh');
  const loadedAt = liveLoadedAt();
  if (!button) return;
  button.hidden = !signedIn || !loadedAt;
  if (button.hidden) return;
  button.toggleAttribute('data-changes', unshownLiveChanges > 0);
  button.querySelector('.live-refresh-dot').hidden = !unshownLiveChanges;
  // 설명(툴팁)은 aria-label 을 읽는다.
  button.setAttribute('aria-label', unshownLiveChanges
    ? `새로고침 · 다른 사람이 바꾼 ${unshownLiveChanges}건 반영`
    : `새로고침 · 화면 데이터 ${receivedClock(shownLoadedAt ?? loadedAt)}에 받음`);
}

// 버튼: 화면 데이터를 새로 받고, 지금 화면을 새 데이터로 다시 그린다. 받는 동안에는 다시 눌러도 한 번만 받는다.
function applyLiveRefresh() {
  const button = document.getElementById('live-refresh');
  if (button.hasAttribute('data-loading')) return;
  button.setAttribute('data-loading', '');
  void Promise.resolve(refreshLiveNow()).finally(() => {
    button.removeAttribute('data-loading');
    if (signedIn && activePath) showWorkspace('', activeWorkCode, activePath, 'none', new URLSearchParams(location.search));
  });
}

function tabCodes(group) {
  return serviceMode ? liveCodes(group.prefix) : dashboardRecordCodes(group);
}

function TabGroup(group) {
  const { name, prefix } = group;
  const tabs = initialWorkTabs.filter(code => code.startsWith(`${prefix}-`)).map(WorkTab);
  const id = `group-${prefix}`;
  const header = BoxHTML(
    Button(Icon('chevron', 'icon-compact') + name, {
      variant: 'group-toggle', attributes: `aria-expanded="true" aria-controls="${id}"`,
    }) +
    IconButton(Icon('add', 'icon-compact'), `조사 · ${name} 목록 열기`, `data-investigation="${prefix}"`, '', ''),
    'class="group-row"',
  );
  return BoxHTML(header + BoxHTML(tabs.join(''), `id="${id}" class="group-content"`), '', 'section');
}

function AccountControls() {
  const context = TextHTML(
    TextHTML(profileName, 'id="profile-display-name" data-preview-user-name') +
    TextHTML('·', 'aria-hidden="true"') +
    TextHTML(profileRole, 'data-preview-user-role'),
    'id="profile-context" class="account-text"',
  );
  const account = ProfileAvatarHTML(avatarUrl, '') + '\n    ' + context;
  return BoxHTML(Divider() + DrawerChromeRow('account-controls sidebar-chrome',
    Button(account, { variant: 'account', surface: 'floating', shape: 'pill', attributes: 'id="account-toggle" aria-label="계정" aria-describedby="profile-context" aria-haspopup="dialog" aria-controls="account-dialog"' }),
    IconButton(Icon('settings'), '설정', 'id="settings-toggle" aria-haspopup="dialog" aria-controls="settings-dialog"', '', 'floating')),
  'class="account-footer"');
}

function Footer() {
  return BoxHTML(AccountControls() +
    BoxHTML('', 'id="workflow-notifications"') +
    BoxHTML('', 'id="footer-pagination"') +
    BoxHTML('', 'id="footer-actions"'),
  'class="app-footer" aria-label="공통 하단 도구"', 'footer');
}

function NavigationSidebar() {
  const workTabs = ScrollArea(BoxHTML(tabGroups.map(TabGroup).join(''), 'class="work-tabs" aria-label="작업 탭"', 'nav'));
  return Sidebar(Divider() + workTabs, 'id="sidebar" aria-label="사이드바" hidden inert');
}

function Notification() {
  let item;
  const headingHTML = TextHTML(
    TextHTML('', 'class="notification-marker" aria-hidden="true"') +
    TextHTML('읽지 않음', 'class="visually-hidden"'),
    'class="notification-title"', 'strong',
  );
  const button = HTMLNode(Button(headingHTML + TextHTML('', '', 'time'), {
    variant: 'notification', attributes: 'aria-haspopup="dialog"',
  }));
  const [heading, timestamp] = button.children;
  const [marker, status] = heading.children;
  const title = document.createTextNode('');
  heading.insertBefore(title, status);
  button.addEventListener('click', () => openNotification(item));
  return {
    button,
    update(next) {
      item = next;
      button.dataset.notificationId = item.id;
      button.setAttribute('aria-controls', item.request ? 'work-request-dialog' : 'notification-dialog');
      title.data = notificationRowTitle(item);
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
  const pagination = BoxHTML('', 'class="inbox-pages" id="inbox-pages"');
  return Sidebar(Divider() + ScrollArea('', 'id="notifications"') + pagination +
    BoxHTML('', 'class="inbox-request-footer" id="inbox-request-footer"', 'footer'),
  'id="inbox" aria-label="보관함" hidden inert');
}

function SearchDialog() {
  return GlassDialog(
    BoxHTML('', 'class="search-heading" id="search-field-host"') +
    TextHTML('', 'id="search-status" class="visually-hidden" role="status"', 'p') +
    ScrollArea('', 'id="search-results"'),
    { id: 'search-dialog', variant: 'search-dialog', attributes: 'aria-label="검색"' },
  );
}

function PreferenceDialog(id, title, content, { wrapContent = true, footer = '' } = {}) {
  return GlassDialog(
    BoxHTML('', `class="dialog-part-host" data-dialog-heading="${id}" data-dialog-title="${title}"`) +
    (wrapContent ? BoxHTML(content, 'class="settings-content scroll-area"') : content) +
    footer,
    { id: `${id}-dialog`, variant: 'settings-dialog', attributes: `aria-labelledby="${id}-title"` },
  );
}

function PreferenceSection(titleId, title, content) {
  return BoxHTML(HeadingHTML(title, `id="${titleId}"`, 3) + content, `aria-labelledby="${titleId}"`, 'section');
}

function SettingsDialog() {
  const row = (label, control) => BoxHTML(label + control, 'class="settings-row"');
  const switchRow = (id, label) => row(TextHTML(label, `for="${id}"`, 'label'), SquishSwitch(id, label));
  return PreferenceDialog('settings', '설정',
    PreferenceSection('appearance-title', '화면 및 접근성',
      row(TextHTML('화면 모드'), BoxHTML('', 'id="theme-setting"')) +
      switchRow('reduce-motion', '모션 줄이기') +
      switchRow('glass-mode', '리퀴드 글래스') +
      row(TextHTML('UI 크기'), BoxHTML('', 'id="ui-size-setting"'))) +
    PreferenceSection('notification-preferences-title', '알림',
      row(TextHTML('보관함 알림'), BoxHTML('', 'id="notification-preference"'))) +
    BoxHTML('', 'id="admin-settings-content"'),
  );
}

function AccountDialog() {
  const profileImage = BoxHTML(
    ProfileAvatarHTML(avatarUrl, '프로필 이미지') +
    InputHTML('id="profile-picture" class="visually-hidden" type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp"') +
    Button('사진 변경', { variant: 'row', shape: 'pill', surface: 'floating', attributes: 'id="profile-picture-change"' }),
    'class="settings-row profile-image-row"',
  );
  return PreferenceDialog('account', '계정',
    PreferenceSection('profile-title', '계정 정보',
      profileImage +
      BoxHTML(TextHTML('이름') + TextHTML(profileName, 'data-preview-user-name', 'strong'), 'class="settings-row"') +
      BoxHTML(TextHTML('역할') + TextHTML(profileRole, 'data-preview-user-role', 'strong'), 'class="settings-row"') +
      TextHTML('', 'id="profile-status" role="status"', 'p')) +
    PreferenceSection('permissions-title', '상세 권한',
      BoxHTML(
        BoxHTML('거래, Alert, Episode 및 판정 보고서 열람', '', 'li') +
        BoxHTML('내 담당 미판정 업무의 검토 시작 및 판정 저장', '', 'li'),
        'class="profile-list"', 'ul',
      )) +
    PreferenceSection('login-history-title', '세션별 로그인 기록',
      TextHTML('이 탭에서 로그인한 프리뷰 세션', '', 'p') +
      TextHTML('기록된 로그인이 없습니다.', 'id="login-history-empty"', 'p') +
      BoxHTML('', 'id="login-history" class="profile-list"', 'ol')),
    { footer: BoxHTML('', 'class="dialog-part-host" id="preview-sign-out"') },
  );
}

function LoginScreen() {
  const passwordField = BoxHTML(
    InputHTML('id="preview-login-password" name="password" type="password" autocomplete="current-password" placeholder="비밀번호 입력" required') +
    Button('', { variant: 'icon-button login-password-toggle', shape: 'circle', attributes: 'id="login-password-toggle" aria-label="비밀번호 표시" aria-pressed="false" aria-controls="preview-login-password"' }),
    'class="login-password-field"',
  );
  const form = BoxHTML(
    TextHTML('아이디', 'for="preview-login-id"', 'label') +
    InputHTML('id="preview-login-id" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="아이디 입력" required') +
    TextHTML('비밀번호', 'for="preview-login-password"', 'label') +
    passwordField +
    BoxHTML('', 'class="login-error" id="preview-login-error" role="alert" aria-atomic="true"') +
    BoxHTML('', 'id="preview-login-action"') +
    BoxHTML('', 'id="preview-login-help-actions" class="login-help"'),
    'id="preview-login-form" class="login-form" aria-label="로그인" novalidate', 'form',
  );
  const card = BoxHTML(
    BoxHTML(TextHTML(BrandSymbol(), 'class="login-brand-mark"') + TextHTML('AML RADAR'), 'class="login-brand"') +
    form +
    (serviceMode ? '' : BoxHTML('', 'id="preview-login-sample-actions" class="login-sample"')),
    'class="glass login-card"', 'section',
  );
  return BoxHTML(
    BoxHTML('', 'class="login-particle-layer" aria-hidden="true"') + DecorativeCanvasHTML('class="login-scene"') +
    card +
    BoxHTML(
      BoxHTML(BrandSymbol(), 'id="preview-login-indicator" class="login-preparation-indicator" aria-hidden="true"') +
      BoxHTML('', 'id="preview-login-preparation-message"'),
      'id="preview-login-preparation" class="login-preparation" tabindex="-1" hidden',
    ) +
    PreferenceDialog('login-help', '계정 찾기', TextHTML('', 'id="login-help-instructions"', 'p')),
    'id="preview-login" aria-label="로그인" hidden', 'main',
  );
}

document.body.replaceChildren(HTMLFragment(Header() + NavigationSidebar() +
  BoxHTML('', 'id="workspace" aria-label="콘텐츠"', 'main') + Footer() +
  WorkspaceQueryDock() +
  Inbox() + SearchDialog() + AccountDialog() + SettingsDialog() + PreferenceDialog('notification', '알림 상세',
    HeadingHTML('', 'id="notification-detail-title"', 3) +
    TextHTML(TextHTML('', 'id="notification-detail-time"', 'time'), '', 'p') +
    TextHTML('', 'id="notification-detail-description"', 'p') +
    BoxHTML('', 'id="notification-detail-rule"') +
    BoxHTML('', 'id="notification-detail-cases" hidden'),
  ) + PreferenceDialog('work-request', '업무 요청', BoxHTML('', 'id="work-request-content"'), { wrapContent: false }) +
  Tooltip() + LoginScreen()));

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

function viewportUpTo(widthToken) {
  const width = getComputedStyle(document.documentElement).getPropertyValue(widthToken).trim();
  return matchMedia(`(max-width: ${width})`);
}

const narrowShell = viewportUpTo('--aml-shell-compact-max-width');

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
widthButton.addEventListener('click', () => {
  if (!widthButton.disabled) setAppearancePreference('wideWorkspace', !workspaceIsWide());
});
fullscreenButton.disabled = !document.fullscreenEnabled;
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.setAttribute('aria-label', active ? '전체화면 취소' : '전체화면 보기');
  fullscreenButton.replaceChildren(HTMLFragment(Icon(active ? 'fullscreenExit' : 'fullscreen')));
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

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
// 직접 고르기 전 기본값: 노트북 폭(1920px 미만)은 넓게 보기, 데스크탑 모니터 폭은 좁게 보기.
const laptopViewport = viewportUpTo('--aml-workspace-laptop-max-width');
const fullWidthViewport = viewportUpTo('--aml-layout-max-width');
const workspaceIsWide = () => fullWidthViewport.matches ||
  (typeof appearance.wideWorkspace === 'boolean' ? appearance.wideWorkspace : laptopViewport.matches);
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
  const { reduceMotion = systemReducedMotion?.matches ?? false, glassmorphism = true } = appearance;
  const settings = { reduceMotion, glassmorphism };
  const { dataset } = document.documentElement;
  dataset.theme = dark ? 'dark' : 'light';
  dataset.themePreference = theme;
  dataset.reducedMotion = String(reduceMotion);
  dataset.glassmorphism = String(glassmorphism);
  dataset.uiSize = uiSizeOptions.find(option => option.value === appearance.uiSize)?.value ?? 'medium';
  const wide = workspaceIsWide();
  dataset.workspaceWidth = wide ? 'wide' : 'narrow';
  widthButton.disabled = fullWidthViewport.matches;
  widthButton.setAttribute('aria-pressed', String(wide));
  widthButton.setAttribute('aria-label', wide ? '좁게 보기' : '넓게 보기');
  widthButton.replaceChildren(HTMLFragment(Icon(wide ? 'narrow' : 'wide')));
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
systemReducedMotion?.addEventListener('change', syncAppearance);
systemTheme.addEventListener('change', syncAppearance);
laptopViewport.addEventListener('change', syncAppearance);
fullWidthViewport.addEventListener('change', syncAppearance);
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
// 서비스 모드 대시보드의 기준일('YYYY-MM-DD'). undefined 는 오늘(업무일)이다. 전체·개인 대시보드가 같은 날짜를 본다.
let dashboardDate;
const institutionDashboardCache = new WeakMap();
const institutionDashboardFreshMs = 60_000;
let caseListPage = { key: '', page: 0 };
let navigationFrame;
let headerPath;
let headerCode;
const queryControls = setupQueryControls({
  onChange: tool => {
    if (tool === 'sort' && activePath?.startsWith('dashboard/')) {
      const { rows, sort } = queryControls.selection();
      if (mountedWorkflows?.updateDashboardSort(rows, sort)) {
        updateWorkspaceAddress(activePath, activeWorkCode, 'replace', screenParams(activePath), { scroll: false });
        queryControls.refresh();
        return;
      }
    }
    showWorkspace('', activeWorkCode, activePath, 'replace');
  },
  workspace: byId('workspace'),
  controls: byId('workspace-query-dock').firstElementChild,
  // 분석가는 Alert·Episode 목록을 내 담당 업무로 연다. 관리자는 전체 업무를 본다. 필터에서 '전체'로 바꿀 수 있다.
  defaultAssignment: scope => ['alerts', 'episodes'].includes(scope) && currentPreviewUser()?.role === 'STAFF' ? 'assigned' : 'all',
});
mountWorkflowNotifications(byId('workflow-notifications'));
mountNotificationPreference(byId('notification-preference'));

// 조회 조건으로 만든 주소에 대시보드 기준일을 덧붙인다. 오늘을 볼 때는 붙이지 않는다.
function screenParams(path) {
  const result = queryControls.params(path);
  if (serviceMode && dashboardDate && path?.startsWith('dashboard/')) result.set('date', dashboardDate);
  return result;
}

// 대시보드 기준일을 정하고 날짜 이동 표시를 그린다. 그 날짜를 마감한 시점의 업무 목록을 돌려준다(오늘이면 받은 목록 그대로).
function datedDashboardSource(source, params) {
  const range = dashboardDateRange(source);
  // 주소에 날짜가 있으면 그 날짜를, 주소 없이 다시 그릴 때(전체·개인 전환, 정렬)는 보던 날짜를 쓴다.
  dashboardDate = clampDashboardDate(params ? params.get('date') : dashboardDate, range);
  const shown = dashboardDate ?? range.last;
  queryControls.setDate(shown ? {
    value: shown,
    note: shownLoadedAt ? `${receivedClock(shownLoadedAt)}까지 업데이트` : '',
    previous: shown > range.first ? shiftDateKey(shown, -1) : undefined,
    next: dashboardDate ? shiftDateKey(shown, 1) : undefined,
    past: Boolean(dashboardDate),
    onChange: date => {
      const next = screenParams(activePath);
      if (date) next.set('date', date);
      else next.delete('date');
      showWorkspace('', '', activePath, 'replace', next);
    },
  } : undefined);
  return dashboardDate ? sourceAsOf(source, dashboardDate) : source;
}

function showWorkspaceNavigation(path, code) {
  if (headerPath === path && headerCode === code) return;
  headerPath = path;
  headerCode = code;
  const navigation = path ? ScreenNavigation(path, code) : { primary: [] };
  if (benchmarkLedgerRoute && isLedgerScreen(path)) {
    navigation.global = navigation.global.map(item => item.value === sections.T
      ? { ...item, label: '은행·계좌·거래' } : item);
  }
  // 대시보드·거래·Alert·Episode 메뉴는 지금 보는 화면, 아니면 마지막에 본 화면으로 보낸다.
  navigation.global = navigation.global?.map(item => {
    const prefix = listPrefix(item.value);
    if (!prefix) return item;
    return { ...item, value: listPrefix(path) === prefix ? path : listDestination(prefix) };
  });
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
    navigationFrame = requestAnimationFrame(() => showWorkspace('', code, path, 'push', rememberedParams(path)));
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

function loadInvestigationView(host, placeholder, load, mount, fallback) {
  const loading = mountInvestigationLoading(host, placeholder);
  unmountInvestigation = loading.unmount;
  void load().then(module => {
    if (!host.isConnected) return;
    loading.unmount();
    unmountInvestigation = undefined;
    mount(module);
  }, () => {
    if (!host.isConnected) return;
    if (fallback) fallback();
    else loading.showError(() => {
      loading.unmount();
      loadInvestigationView(host, placeholder, load, mount);
    });
  });
}

function updateWorkspaceAddress(path, code, navigationMode, urlParams, { scroll = true } = {}) {
  rememberList(path, urlParams);
  if (code) document.querySelector(`.work-tabs [data-work-code="${code}"]`)?.setAttribute('aria-current', 'page');
  if (scroll) window.scrollTo(0, 0);
  if (navigationMode === 'none' || !path || /\/judge(?:-|\/|$)/.test(path)) return;
  if (dataMode) urlParams.set('data', dataMode);
  const url = previewUrl({ screen: path, code, benchmarkLedger: benchmarkLedgerRoute, serviceMode }, urlParams);
  if (url === location.pathname + location.search) return;
  if (navigationMode === 'replace') history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
}

function loadBenchmarkDataset() {
  // Read from the development server without emitting the dataset as a build asset.
  benchmarkLoading ??= fetch(import.meta.env.BASE_URL + 'src/mocks/ibm-hi-small-data.json').then(response => {
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
  benchmarkSummaryLoading ??= fetch(import.meta.env.BASE_URL + 'src/mocks/ibm-hi-small-summary.json').then(response => {
    if (!response.ok) throw new Error(`Benchmark summary request failed (${response.status})`);
    return response.json();
  }).catch(error => {
    benchmarkSummaryLoading = undefined;
    throw error;
  });
  return benchmarkSummaryLoading;
}

function registerBenchmarkExport(file, label, headers, rows) {
  queryControls.registerTableTools({ entries: [csvDownloadEntry(label, file, headers, rows)] });
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
    ? BoxHTML('', 'data-benchmark-content')
    : BoxHTML('', `data-benchmark-content data-workflow="${workflow}"`);
  const workspace = byId('workspace');
  workspace.replaceChildren(HTMLFragment(ScreenLayout(path, { code, hasQuery: dashboard, content })));
  updateWorkspaceAddress(path, code, navigationMode, queryControls.params(path));

  const host = workspace.querySelector('[data-benchmark-content]');
  if (ledger) {
    const tableView = path === ledgerTableScreen;
    loadInvestigationView(host, { label: 'IBM AMLworld 거래', kind: tableView ? 'benchmark-table' : 'benchmark-cards', columns: 8 },
      () => Promise.all([loadBenchmarkDataset(), import('../features/investigation/ibm-ledger.jsx')]),
      ([dataset, { mountBenchmarkLedger }]) => {
        if (code) {
          const entry = addWorkTab(code);
          entry?.tab.setAttribute('aria-current', 'page');
        }
        benchmarkLedgerView = mountBenchmarkLedger(host, {
          paginationHost: byId('footer-pagination'),
          dataset, code, tableView,
        });
      }, () => showWorkspace('', '', path, 'replace', params, true));
    return;
  }
  mountedWorkflows = mountWorkflows(workspace);
  const render = dataset => {
    if (!host.isConnected) return;
    queryControls.setScreen(path, [], { rows: [], asOf: new Date(dataset.period.end + 'T00:00:00'), dashboard: true });
    const { range } = queryControls.selection();
    queryControls.renderTags();
    mountedWorkflows.updateDashboard({ dataset, range });
    const days = dataset.days.filter(row => inDateRange(new Date(row.date + 'T00:00:00'), range));
    registerBenchmarkExport('ibm-hi-small-daily', '조회 기간 원본 집계',
      ['원본 일자', '전체 거래', '원본 세탁 라벨 거래', '최초 등장 계좌', '최초 등장 은행 코드'],
      days.map(row => [row.date, row.total, row.labeled, row.newAccounts, row.newBanks]));
  };
  const load = () => {
    mountedWorkflows.updateDashboard(undefined);
    void loadBenchmarkSummary().then(render).catch(() => {
      if (host.isConnected) mountedWorkflows.updateDashboard({ error: true, retry: load });
    });
  };
  load();
}

function afterWorkspacePaint(callback) {
  requestAnimationFrame(() => setTimeout(callback, 0));
}

function loadPreviewDashboard(mounted, source, query) {
  if (!query.mine) {
    const key = `${getModelRiskThresholds().join(',')}:${screenParams('dashboard/all')}`;
    const previous = institutionDashboardCache.get(source);
    const entry = previous?.key === key ? previous : { key };
    const render = data => { if (mountedWorkflows === mounted) mounted.updateDashboard(data); };
    const load = () => {
      render(entry.data);
      if (entry.data && Date.now() - entry.loadedAt < institutionDashboardFreshMs) return;
      institutionDashboardCache.set(source, entry);
      afterWorkspacePaint(() => {
        if (mountedWorkflows !== mounted) return;
        entry.request ??= Promise.resolve().then(() => serviceMode
          ? liveDashboardResponse(source, query) : dashboardFixtureResponse(source, query)
        ).then(summary => {
          const rows = summary.cases;
          entry.data = { ...summary, board: dashboardFixtureBoardPage(rows, { size: Math.max(1, rows.length) }) };
          entry.loadedAt = Date.now();
          return entry.data;
        }).finally(() => { entry.request = undefined; });
        entry.request.then(render, () => {
          if (!entry.data) render({ error: true, retry: load });
        });
      });
    };
    load();
    return;
  }

  const withWorkHistory = summary => {
    const username = serviceMode ? currentPreviewUser()?.username : source.staff;
    const requests = serviceMode
      ? (liveWorkRequestsReady() ? liveWorkRequests() : undefined)
      : [...source.assignmentChanges, ...previewWorkRequests({ source: 'fixture', username })];
    // 지난 기준일을 볼 때는 그날까지의 기록만 보인다.
    const range = query.range ?? (source.asOfDate ? { to: new Date(`${source.asOfDate}T00:00:00`) } : undefined);
    return { ...summary, workHistory: personalWorkHistory(source.cases, requests, username, range) };
  };
  const load = () => {
    mounted.updateDashboard(undefined);
    afterWorkspacePaint(() => {
      if (mountedWorkflows !== mounted) return;
      const show = summary => {
        if (mountedWorkflows !== mounted) return;
        mounted.updateDashboard(withWorkHistory(summary));
        afterWorkspacePaint(() => {
          if (mountedWorkflows !== mounted) return;
          const rows = summary.mine;
          const board = dashboardFixtureBoardPage(rows, { size: Math.max(1, rows.length) });
          const data = { ...summary, board };
          mounted.updateDashboard(withWorkHistory(data));
          if (serviceMode && !liveWorkRequestsReady()) void liveWorkspaceRequests?.then(() => {
            if (mountedWorkflows === mounted && liveWorkRequestsReady()) {
              mounted.updateDashboard(current => current?.board ? withWorkHistory(current) : current);
            }
          });
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
  if (serviceMode) {
    unshownLiveChanges = 0;
    shownLoadedAt = liveLoadedAt();
    renderLiveRefreshStatus();
  }
  for (const tab of document.querySelectorAll('#sidebar [aria-current="page"]')) {
    tab.removeAttribute('aria-current');
  }
  const selectedPath = override || (code ? initialDetail(code) : sections[prefix]);
  if (!serviceMode && !benchmarkLedgerRoute && isBenchmarkTransactionCode(code)) code = '';
  const sameCode = activeWorkCode === code;
  const previousPath = activePath;
  activeWorkCode = code;
  const path = !override && code.startsWith('T-') && previousPath === ledgerTableScreen ? previousPath : selectedPath;
  showWorkspaceNavigation(path, code);
  if (sameCode && path !== previousPath) {
    const previousCase = caseRoute(previousPath);
    const nextCase = caseRoute(path);
    if (nextCase && previousCase?.family === nextCase.family && previousCase.detail === nextCase.detail &&
      previousCase.readOnly === nextCase.readOnly && previousCase.lens !== nextCase.lens &&
      ['analysis', 'related'].includes(nextCase.detail)) {
      const screen = byId('workspace').querySelector('.screen-layout');
      const graph = screen?.querySelector('[data-case-flow]');
      if (graph) {
        activePath = path;
        graph.dataset.lens = nextCase.lens;
        unmountCaseGraph?.render();
        screen.dataset.figmaFrame = screenFrame(path);
        screen.querySelector('h1').textContent = `${code} · ${frameLabel(path)}`;
        updateWorkspaceAddress(path, code, navigationMode, params ?? new URLSearchParams(location.search), { scroll: false });
        return;
      }
    }
  }
  const benchmarkLedger = isLedgerScreen(path) && benchmarkLedgerRoute && (!code || isBenchmarkTransactionCode(code));
  if (localBenchmark && !sampleData && !benchmarkFailed && (benchmarkLedger || path === 'dashboard/all' && dataMode === 'ibm')) {
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
  const isPersonalDashboard = path === 'dashboard/mine';
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
  // 서비스 모드 대시보드는 기간·필터 대신 기준일로 본다. 다른 화면은 받은 목록(지금 상태)을 그대로 쓴다.
  const datedDashboard = isDashboard && serviceMode;
  const dashboardView = datedDashboard ? datedDashboardSource(dashboardSource, params) : dashboardSource;
  if (!datedDashboard) queryControls.setDate(undefined);
  const queryData = isDashboard ? {
    rows: isPersonalDashboard ? dashboardView.mine : dashboardView.cases,
    asOf: serviceMode ? liveDashboardAsOf(dashboardView) : dashboardPeriodEnd,
    dashboard: true,
    dated: datedDashboard,
    sortScope: isPersonalDashboard ? '내 업무 현황' : '처리 상태',
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
  const screen = path ? ScreenLayout(path, {
    code, hasQuery: queryControls.hasQuery() || isReport, showCaseJudgment: Boolean(selectedCase) && !readOnly,
    source: benchmarkFailed ? '원본 데이터를 불러올 수 없습니다.' : undefined,
  }) : '';
  workspace.replaceChildren(HTMLFragment(screen));
  queryControls.renderTags();
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
    refreshEpisode: () => {
      if (activeWorkCode === code) showWorkspace('', code, activePath, 'none', new URLSearchParams(location.search));
    },
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
        const show = () => {
          if (mountedWorkflows !== mounted) return;
          dashboardSource = caseSource(groups);
          mountedWorkflows.updateCase(dashboardSource.cases.find(item => item.code === target), dashboardSource);
        };
        // 버튼은 이 약속이 끝날 때까지 막혀 있다. board 는 오래 걸릴 수 있어 기다리지 않는다.
        return startLiveReview(current).then(result => {
          if (!result.ok) {
            document.dispatchEvent(new CustomEvent('aml:notice', { detail: { status: 'failed', title: '조사를 시작하지 못했습니다.', description: result.error } }));
            return;
          }
          // 받아 둔 응답에 착수를 반영해 바로 [판정]으로 바꾼다. 착수는 그 사건의 상태만 바꾸므로 board 를 다시 받지 않는다.
          // 서버 쪽 최신 값은 주기적인 다시 받기(live-refresh.js)가 맞춘다.
          markLiveReviewStarted(current.caseId);
          show();
        });
      }
      if (!startPreviewReview(current, currentPreviewUser())) return;
      dashboardSource = caseSource(groups);
      mountedWorkflows.updateCase(dashboardSource.cases.find(item => item.code === target), dashboardSource);
    },
    saveJudgment: (target, verdict, details, reasonCategory) => {
      const row = !readOnly && activeWorkCode === target ? dashboardSource.cases.find(item => item.code === target) : undefined;
      if (serviceMode) {
        return saveLiveJudgment(row, verdict, details, reasonCategory).then(result => {
          if (!result.ok) return result;
          // 판정 응답만으로 완료 창을 띄운다. 판정은 그 사건만 닫으므로(ReviewService.judge) board 를 다시 받지 않고
          // 받아 둔 board 에 판정을 반영한다. 서버 쪽 최신 값은 주기적인 다시 받기(live-refresh.js)가 맞춘다.
          markLiveJudged(row, result.judgment);
          dashboardSource = caseSource(groups);
          return result;
        });
      }
      const actor = currentPreviewUser();
      const result = savePreviewJudgment(row, verdict, details, reasonCategory, actor?.username ?? '', actor);
      if (result.ok) dashboardSource = caseSource(groups);
      return result;
    },
    onJudgmentClose: () => {
      showWorkspace('', code, activePath, 'none', new URLSearchParams(location.search));
      workspace.querySelector('h1')?.focus({ preventScroll: true });
    },
    onJudgmentReport: id => {
      showWorkspace('', '', sections.report, 'push', new URLSearchParams({ selected: id }));
      workspace.querySelector('h1')?.focus({ preventScroll: true });
    },
    onJudgmentNext: nextCode => openWorkCode(nextCode),
    // 판정한 건의 목록(Alert·Episode)으로, 마지막에 본 보기와 조건 그대로 돌아간다.
    onJudgmentList: () => {
      const destination = listDestination(code[0]);
      showWorkspace(code[0], '', destination, 'push', rememberedParams(destination));
      workspace.querySelector('h1')?.focus({ preventScroll: true });
    },
    registerTableTools: queryControls.registerTableTools,
    rule: isRuleId(selectedRule) ? selectedRule : undefined,
  });
  if (isDashboard) loadPreviewDashboard(mountedWorkflows, dashboardView,
    { ...queryControls.selection(), mine: isPersonalDashboard });
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
  if (caseTable) loadInvestigationView(caseTable,
    { label: caseTable.dataset.caseListTable, kind: 'case-table', columns: groupPrefix === 'E' ? 13 : 11 },
    () => import('../features/investigation/preview-case-list-table.jsx'), ({ mountPreviewCaseTable }) => {
      dashboardSource ??= caseSource(groups);
      const caseRows = new Map(dashboardSource.cases.map(row => [row.code, row]));
      unmountInvestigation = mountPreviewCaseTable(caseTable, caseTable.dataset.caseListTable,
        codes.map(recordCode => caseRows.get(recordCode)).filter(Boolean), groupPrefix === 'E', queryData.rows.length,
        { ...caseListPaging, pageSize: 20 });
    });
  if (component) {
    const ledger = component.dataset.investigationComponent === 'ledger';
    const tableView = path === ledgerTableScreen;
    const placeholder = ledger ? { label: '거래 원장', kind: tableView ? 'ledger-table' : 'ledger-cards', columns: 9, relatedColumns: 7 }
      : { label: component.dataset.label, kind: 'case-cards' };
    loadInvestigationView(component, placeholder, () => import('../features/investigation/investigation-components.jsx'), ({ mountInvestigation }) => {
      ({ unmount: unmountInvestigation, setLedgerView } = mountInvestigation(component, {
        codes,
        code,
        groups,
        cases: serviceMode ? liveSource().cases : undefined,
        targetTransaction: serviceMode ? liveSource().transactions.find(row => row.code === code) : undefined,
        label: component.dataset.label,
        tableView,
        ...caseListPaging,
      }));
    });
  }
  if (path) {
    const urlParams = screenParams(path);
    if (initialPanel) urlParams.set('panel', initialPanel);
    if (reportDocument) urlParams.set('selected', reportDocument);
    if (isRuleId(selectedRule)) urlParams.set('rule', selectedRule);
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

function addWorkTab(code, prepend = false) {
  if (!validWorkCode(code)) return;
  if (!serviceMode && isBenchmarkTransactionCode(code) && (!benchmarkLedgerRoute ||
    !benchmarkDataset?.records.some(record => record.code === code))) return;
  const group = byId(`group-${code[0]}`);
  if (!group) return;
  const selector = `[data-work-code="${code}"]`;
  const existing = group.querySelector(selector);
  if (!existing) {
    const tab = HTMLNode(WorkTab(code));
    group.insertBefore(tab, prepend ? group.firstChild : null);
    persistWorkTabs();
  }
  return { group, tab: existing ?? group.querySelector(selector), added: !existing };
}

function addWorkTabFromCard(button, code) {
  const source = button.closest('.card-header, tr')?.querySelector('.card-header-main code, th code') ?? button;
  const verdict = button.closest('[data-verdict]')?.dataset.verdict;
  const from = source.getBoundingClientRect();
  const transferFocus = button.matches(':focus-visible');
  const destination = addWorkTab(code, true);
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
    { opacity: 0, transform: 'translateX(var(--aml-space-12)) scale(.97)' },
    { opacity: 1, transform: 'none' },
  ], { duration: 140, delay: 390, fill: 'backwards', easing: 'ease-out' });
  const flying = HTMLNode(TextHTML('', 'class="work-tab-flight" aria-hidden="true"', 'code'));
  if (verdict) flying.dataset.verdict = verdict;
  flying.textContent = code;
  flying.style.setProperty('--work-tab-flight-left', `${from.left}px`);
  flying.style.setProperty('--work-tab-flight-top', `${from.top + from.height / 2}px`);
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

// 앱 안의 <a> 링크는 페이지를 다시 불러오지 않고 뒤로 가기와 같은 경로(showRoute)로 화면만 바꾼다.
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.search === location.search) return;
  // 데이터셋과 저장 키가 로드 시점에 정해지는 경로는 전체 이동을 유지한다.
  if (benchmarkLedgerRoute || url.pathname.replace(/\/$/, '') === benchmarkLedgerPath) return;
  const linkData = url.searchParams.get('data');
  if (linkData && linkData !== dataMode) return;
  if (!signedIn) return;
  const route = readPreviewRoute(url, { serviceMode });
  if (route.screen === loginRoute.screen) return;
  event.preventDefault();
  closeTransientViews();
  showRoute(route, url.searchParams, 'push');
});

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.matches('.group-toggle')) toggleDisclosure(button);
  if (button?.dataset.investigation) {
    const prefix = button.dataset.investigation;
    const destination = listDestination(prefix);
    showWorkspace(prefix, '', destination, 'push', rememberedParams(destination));
  }
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
  return HTMLNode(BoxHTML(
    Button(TextHTML(code, '', 'code'), { variant: 'row search-result', attributes: `data-search-code="${code}"` }),
    'class="list-item-enter"', 'li',
  ));
}

function renderSearchResults() {
  const query = searchQuery.value.trim().toUpperCase();
  const codes = [...tabGroups.flatMap(tabCodes), ...(benchmarkDataset?.records ?? []).map(row => row.code)];
  const matches = [...new Set(codes.filter(code => code.includes(query)))];
  const focused = searchResults.contains(document.activeElement) ? document.activeElement : null;
  if (matches.length) {
    let list = searchResults.querySelector('ul');
    if (!list) {
      list = HTMLNode(BoxHTML('', 'aria-label="검색 결과"', 'ul'));
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
    searchResults.replaceChildren(HTMLFragment(TextHTML('검색 결과가 없습니다.', '', 'p')));
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
const notificationRuleRoot = createRoot(byId('notification-detail-rule'));
const workRequestDialog = byId('work-request-dialog');
const workRequestRoot = createRoot(byId('work-request-content'));
const inboxRequestFooter = byId('inbox-request-footer');
const inboxRequestRoot = createRoot(inboxRequestFooter);
const inboxPaginationRoot = createRoot(byId('inbox-pages'));
let workRequestOrigin;
const notificationRows = new Map();
const emptyNotifications = HTMLNode(TextHTML('', 'class="inbox-empty"', 'p'));
let openedNotificationId;

function openNotification(item) {
  if (item.request) return openWorkRequest(item.request);
  openedNotificationId = item.id;
  byId('notification-detail-title').textContent = item.title;
  const time = byId('notification-detail-time');
  time.dateTime = item.time.toISOString();
  time.textContent = dateFormat.format(item.time);
  byId('notification-detail-description').textContent = item.description || '알림에 추가 내용이 없습니다.';
  // 룰 알림은 이어진 사건이 없다. 그 룰의 화면으로 가는 길을 대신 둔다.
  const ruleLink = ruleNotificationLink(item);
  notificationRuleRoot.render(ruleLink ? createElement(RuleNotificationLink, { item }) : null);
  const related = byId('notification-detail-cases');
  related.hidden = !liveInbox || Boolean(ruleLink);
  related.replaceChildren();
  notificationDialog.showModal();
  if (!item.read) void markInboxRead([item]);
  if (liveInbox && !ruleLink) void loadNotificationCases(item, related);
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
    && !appReducedMotion();
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
        { opacity: 0, translate: '0 calc(-1 * var(--aml-space-12))', scale: '0.88 0.55', transformOrigin: 'left top' },
        { opacity: 1, translate: '0 0', scale: '1 1.02', transformOrigin: 'left top', offset: 0.72 },
        { opacity: 1, translate: '0 0', scale: '1', transformOrigin: 'left top' },
      ], { duration: 520, delay: Math.min(stagger++, 4) * 55, fill: 'backwards', easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
  }
  if (activeRow && !notificationDialog.open && document.activeElement !== activeRow) {
    (activeRow.isConnected ? activeRow : list.querySelector('button') ?? unreadOnly).focus({ preventScroll: true });
  }
  byId('mark-all-read').disabled = !items.some(item => !item.read);
  inboxPaginationRoot.render(liveInbox ? createElement(FooterPagination, {
    compact: true, label: '보관함 페이지 이동', page: liveInbox.number, pageCount: liveInbox.totalPages,
    onPageChange: refreshLiveInbox,
  }) : null);
}

async function refreshLiveInbox(page = 0, initialRequests) {
  if (!signedIn || currentPreviewUser()?.source !== 'api') return;
  const request = ++inboxRequest;
  try {
    const [result] = await Promise.all([fetchNotifications('', '', '', page), initialRequests ?? loadLiveWorkRequests()]);
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
    const list = HTMLNode(BoxHTML('', '', 'ul'));
    for (const record of result.content) {
      const row = HTMLNode(BoxHTML('', '', 'li'));
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
    const entry = HTMLNode(BoxHTML(TextHTML('', '', 'time'), '', 'li'));
    const time = entry.firstElementChild;
    time.dateTime = timestamp;
    time.textContent = `${loginTime.format(new Date(timestamp))} KST`;
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
  resetWorkspacePreparation();
  cancelAnimationFrame(navigationFrame);
  document.body.setAttribute('data-login-required', '');
  byId('preview-login').hidden = false;
  requestAnimationFrame(() => loginId.focus());
}

function revealWorkspace() {
  resetWorkspacePreparation();
  document.body.removeAttribute('data-login-required');
  byId('preview-login').hidden = true;
}

function resetWorkspacePreparation() {
  workspacePreparation++;
  loginScene.cancel();
  loginCard.hidden = false;
  loginPreparation.hidden = true;
  loginPreparationRoot.render(null);
}

function showRoute(route, params, navigationMode) {
  if (serviceMode && !liveSourceLoaded()) {
    void prepareWorkspaceRoute(route, params, navigationMode, false);
    return;
  }
  revealWorkspace();
  showLoadedRoute(route, params, navigationMode);
}

function preloadWorkspaceRoute({ screen }) {
  if (screen.startsWith('dashboard/')) return import('../features/dashboard/preview-dashboard.jsx');
  if (isLedgerScreen(screen)) return benchmarkLedgerRoute
    ? import('../features/investigation/ibm-ledger.jsx') : import('../features/investigation/investigation-components.jsx');
  if (/^add-tab\/(alerts|episodes)/.test(screen)) return screen.includes('-table')
    ? import('../features/investigation/preview-case-list-table.jsx') : import('../features/investigation/investigation-components.jsx');
  const tab = caseRoute(screen)?.tab;
  if (tab === 'analysis' || tab === 'related') return import('../features/investigation/preview-case-graph.jsx');
  if (tab === 'overview') return import('../features/investigation/preview-case-overview.jsx');
  if (screen === 'rule-engine/draft-create') return import('../features/rules/rule-controls.jsx');
}

async function prepareWorkspaceRoute(route, params, navigationMode, animate) {
  const attempt = ++workspacePreparation;
  const current = () => attempt === workspacePreparation && signedIn;
  const retry = () => void prepareWorkspaceRoute(route, params, navigationMode, animate);
  showWorkspacePreparation();
  warmLiveWorkspace();
  try {
    const board = serviceMode && !liveSourceLoaded() ? loadLiveSource() : undefined;
    const knownRoute = board && route.code && !route.code.startsWith('T-') ? undefined : availableRoute(route);
    await Promise.all([board, knownRoute && preloadWorkspaceRoute(knownRoute)]);
    if (!current()) return;
    if (board) dashboardSource = undefined;
    const target = knownRoute ?? availableRoute(route);
    if (!knownRoute) await preloadWorkspaceRoute(target);
    if (!current()) return;
    showLoadedRoute(target, params, navigationMode);
    const open = animated => {
      if (!current()) return;
      revealWorkspace();
      focusWorkspace(target, animated);
    };
    if (animate) loginScene.enter(open);
    else open(false);
  } catch {
    if (current()) showWorkspacePreparation(retry);
  }
}

function warmLiveWorkspace() {
  if (!serviceMode || liveWorkspaceRequests) return;
  const actor = previewActor;
  const thresholds = getModelRiskThresholds().join();
  liveWorkspaceRequests = loadLiveWorkRequests().catch(() => undefined);
  void refreshLiveRules().then(() => {
    if (!signedIn || previewActor !== actor || caseRoute(activePath)?.tab !== 'overview') return;
    const row = dashboardSource?.cases.find(item => item.code === activeWorkCode);
    if (row) mountedWorkflows?.updateCase(row, dashboardSource);
  }, () => undefined);
  void loadLiveModelRiskThresholds().then(() => {
    if (signedIn && previewActor === actor && liveSourceLoaded() && thresholds !== getModelRiskThresholds().join()) {
      document.dispatchEvent(new Event('aml:model-risk'));
    }
  }, () => undefined);
}

function availableRoute(route) {
  return serviceMode && route.code && !route.code.startsWith('T-') && !liveSource().cases.some(row => row.code === route.code)
    ? dashboardRoute : route;
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
    route = availableRoute(route);
  }
  if (route.code) addWorkTab(route.code);
  showWorkspace('', route.code, route.screen, navigationMode, params);
}

function restoreLocation() {
  closeTransientViews();
  const url = new URL(location.href);
  const route = readPreviewRoute(url, { serviceMode });
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
const loginHost = byId('preview-login');
const loginCard = loginForm.closest('.login-card');
const loginScene = mountLoginScene(loginHost, appMotionPreference);
const loginPreparation = byId('preview-login-preparation');
const loginIndicator = byId('preview-login-indicator');
const loginPreparationRoot = createRoot(byId('preview-login-preparation-message'));
let workspacePreparation = 0;
let liveWorkspaceRequests;

function showWorkspacePreparation(retry) {
  document.body.setAttribute('data-login-required', '');
  loginHost.hidden = false;
  loginCard.hidden = true;
  loginPreparation.hidden = false;
  loginIndicator.hidden = Boolean(retry);
  // Focus follows the login form into the preparation status, or to the retry action.
  flushSync(() => loginPreparationRoot.render(retry ? [
    createElement(Text, { key: 'message', role: 'alert' }, '작업 화면을 준비하지 못했습니다.'),
    createElement(PrimaryButton, { key: 'retry', tone: 'brand', onClick: retry }, '다시 시도'),
  ] : createElement(Text, { role: 'status' }, '작업 화면 준비 중')));
  (retry ? loginPreparation.querySelector('button') : loginPreparation).focus({ preventScroll: true });
}
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
    createElement(Text, { key: 'notice' }, '테스트 전용 간편 로그인 · 검수 종료 즉시 제거'),
    ...actors.map(([id, label, actor]) => loginButton(label, { key: id, id, onClick: () => enterPreview(actor.username) })),
  ]);
}
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (signingIn || loginCard.hidden || loginScene.transitioning || failedLogins >= loginFailureLimit) return;
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
      enterWorkspace(user.username, true, user);
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
  if (loginCard.hidden || loginScene.transitioning) return;
  loginShake?.cancel();
  enterWorkspace(actor, true);
}

function enterWorkspace(actor, animate, user) {
  loginForm.reset();
  failedLogins = 0;
  updateLoginButton();
  showLoginPassword(false);
  setPreviewSession(actor, user);
  void refreshPreviewSessionUser().then(() => refreshLiveInbox(0, liveWorkspaceRequests));
  const next = history.state?.previewNext;
  // 로그인 폼에서 들어오면 previewNext, 새로고침으로 세션을 복원하면 현재 주소로 돌아간다.
  const previous = typeof next === 'string' && /^\/(?!\/)/.test(next) ? new URL(next, location.origin)
    : location.pathname !== '/login' ? new URL(location.href) : undefined;
  const route = previous ? readPreviewRoute(previous, { serviceMode }) : dashboardRoute;
  void prepareWorkspaceRoute(route, previous?.searchParams, 'push', animate);
}

function focusWorkspace(route, animated) {
  const workspace = byId('workspace');
  if (animated && route.screen.startsWith('dashboard/')) {
    const transformOrigin = 'var(--aml-motion-workspace-enter-origin)';
    const perspective = 'perspective(var(--aml-motion-workspace-enter-perspective))';
    workspace.querySelector('.screen-layout')?.animate([
      { transformOrigin, transform: `${perspective} translate3d(0, var(--aml-space-12), calc(-1 * var(--aml-motion-workspace-enter-depth)))`,
        opacity: 'var(--aml-motion-workspace-enter-opacity)' },
      { transformOrigin, transform: `${perspective} translate3d(0, 0, 0)`, opacity: 1 },
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
  forgetLists();
  activeEvidence = undefined;
  resetPreviewCaseRead();
  resetLiveSource();
  resetLiveWorkRequests();
  liveWorkspaceRequests = undefined;
  dashboardSource = undefined;
  dashboardDate = undefined;
}
for (const host of document.querySelectorAll('[data-dialog-heading]')) {
  const { dialogHeading: id, dialogTitle: title } = host.dataset;
  createRoot(host).render(createElement(DialogHeader, {
    title, titleId: `${id}-title`, closeId: `${id}-close`, closeLabel: `${title} 닫기`,
  }));
}
createRoot(byId('preview-sign-out')).render(createElement(DialogFooter, null,
  // 계정 창을 열어야 보이는 버튼이고 다시 로그인하면 되므로 한 번 누르면 로그아웃한다.
  createElement(PrimaryButton, { tone: 'negative', onClick: signOut }, '로그아웃')));
window.addEventListener('popstate', restoreLocation);
document.addEventListener('aml:model-risk', () => {
  if (signedIn && activePath) showWorkspace('', activeWorkCode, activePath, 'none', new URLSearchParams(location.search));
});
if (serviceMode) {
  window.addEventListener('auth-expired', () => {
    if (!signedIn) return;
    clearWorkspaceSession();
    restoreLocation();
  });
  // 클릭·키 입력이 이어지는 동안 서버 세션이 만료되지 않게 한다. 이미 만료됐으면 그때 로그인 화면으로 보낸다.
  startSessionKeepalive({
    isActive: () => signedIn,
    ping: () => restoreSession().catch(error => {
      if (error instanceof ApiError && error.problem.status === 401) window.dispatchEvent(new Event('auth-expired'));
      throw error;
    }),
  });
  // 다른 사람이 처리한 결과·새 Alert가 보이게 board 를 주기적으로 다시 받는다(live-refresh.js).
  const liveRefresh = startLiveRefresh({ isActive: () => signedIn && liveSourceLoaded(), refresh: refreshLiveBoard });
  refreshLiveNow = liveRefresh.refreshNow;
  byId('live-refresh')?.addEventListener('click', applyLiveRefresh);
  // 서버 세션을 확인하기 전에는 로그인 화면 대신 준비 화면을 보여준다.
  if (location.pathname === '/login') restoreLocation();
  else showWorkspacePreparation();
  void restoreSession().then(user => {
    if (!signingIn && !signedIn && !loginScene.transitioning) enterWorkspace(user.username, false, user);
  }, () => {
    // 세션이 없거나 확인하지 못했을 때만 로그인 화면으로 보낸다.
    if (!signedIn) restoreLocation();
  });
} else {
  restoreLocation();
  if (signedIn) void refreshPreviewSessionUser().then(() => refreshLiveInbox());
}
