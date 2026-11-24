import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionButton, ConfirmHoldButton, PrimaryButton } from '../components/primary-button';
import { Button, Divider, Icon, IconButton, ScrollArea, Tooltip, bindTooltip } from '../components/components';
import { WorkspaceNavigation } from '../app/screen-navigation';
import { ScreenNavigation } from '../app/screen-layouts';
import { Panel } from '../components/panel';
import { QueryCheck, QueryRadio, QueryToolbar, setupQueryControls } from '../components/query-controls';
import { CaseActorTag, FilterTag, ModelScoreTag, PatternTag, ReviewStatusTag, StatusTag, VerdictTag } from '../components/semantic-tags';
import { SquishSwitch, bindSquishSwitch } from '../components/squish-switch';
import { setupGlassMaterial } from '../components/glass-material';
import { bindCardGlow } from '../components/card-glow';
import { uiSizeOptions } from '../config/appearance-options';
import { CardSamples } from './component-card-samples';
import { DesignVariables } from './component-variables';
import { PreviewCaseTable } from '../features/investigation/preview-case-list-table';
import { CaseCards, Ledger } from '../features/investigation/investigation-components';
import { dashboardFixtures, dashboardPeriodEnd } from '../mocks/dashboard-fixtures';
import { PreviewDashboard } from '../features/dashboard/preview-dashboard';
import { ibmPatterns } from '../features/investigation/ibm-hi-small-aggregate';
import { RiskDial, RuleTemplateMenu } from '../features/rules/rule-controls';
import { mountWorkflows, mountWorkflowNotifications } from './workflow-components';
import AnimatedList from '../components/react-bits/AnimatedList';
import { NotificationPreference } from '../features/settings/notification-preference';
import CountUp from '../components/react-bits/CountUp';
import ScrollStack, { ScrollStackItem } from '../components/react-bits/ScrollStack';
import StatusMark from '../components/react-bits/StatusMark';
import '../app/layout.css';
import './component-catalogue.css';
import { systemReducedMotion } from '@/hooks/use-reduced-motion';
import { Box, Heading, Text } from '../components/layout-primitives';

const demoCodes = (prefix, size) => Array.from({ length: 8 }, (_, index) =>
  `${prefix}-261111-${String(index + 1).padStart(size, '0')}`);
const groups = { T: demoCodes('T', 8), A: demoCodes('A', 6), E: demoCodes('E', 6) };
const dashboard = dashboardFixtures(groups);
const caseRows = new Map(dashboard.cases.map(row => [row.code, row]));
const statusLabels = { pending: '대기 중', running: '처리 중', done: '처리 완료', failed: '실패', cancelled: '취소' };
const queryMarkup = { __html: QueryToolbar() };
const buttonMarkup = { __html: Button('기본 버튼', { surface: 'ghost', variant: 'row' }) };
const tooltipMarkup = { __html:
  IconButton(Icon('download'), '내보내기', '', '', 'floating') + Tooltip() };
const scrollbarMarkup = { __html: ScrollArea(groups.T.map(code =>
  `<div class="row"><code>${code}</code></div>`).join(Divider()), 'tabindex="0" aria-label="스크롤 영역"') };
const sections = [
  ['foundations', '기본 요소'], ['variables', '변수'], ['navigation', '탐색과 조회'],
  ['records', '카드와 목록'], ['workflows', '룰과 보고서'], ['shell', '앱 셸'],
];

function Demo({ title, children, wide = false }) {
  return <Box as="article" className={`catalogue-demo${wide ? ' catalogue-span' : ''}`}>
    <Heading level={3}>{title}</Heading>
    {children}
  </Box>;
}

function DemoGroup({ id, label, children }) {
  return <Box as="section" id={id} className="catalogue-group" aria-labelledby={`${id}-title`}>
    <Heading id={`${id}-title`}>{label}</Heading>
    <Box className="catalogue-grid">{children}</Box>
  </Box>;
}

function NativeSwitch({ id, label, initial, onChange }) {
  const host = useRef(null);
  useEffect(() => {
    host.current.innerHTML = SquishSwitch(id, label);
    const button = host.current.firstElementChild;
    button.setAttribute('aria-checked', String(!!initial));
    bindSquishSwitch(button, onChange);
  }, [id, label, initial, onChange]);
  return <Box className="catalogue-setting">
    <Box as="label" htmlFor={id}>{label}</Box>
    <Text as="span" ref={host} />
  </Box>;
}

function NativePrimitives({ onEvent }) {
  const tooltipSample = useRef(null);
  useEffect(() => {
    const host = tooltipSample.current;
    return bindTooltip(host.querySelector('button'), host.querySelector('#tooltip'));
  }, []);

  return <>
    <Box className="catalogue-actions"
      onClick={() => onEvent('기본 버튼 실행')}
      dangerouslySetInnerHTML={buttonMarkup} />
    <Box className="catalogue-actions" ref={tooltipSample}
      onClick={() => onEvent('아이콘 버튼 실행')} dangerouslySetInnerHTML={tooltipMarkup} />
    <Box className="catalogue-scroll" dangerouslySetInnerHTML={scrollbarMarkup} />
  </>;
}

function QueryDemo() {
  const host = useRef(null);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const workspace = host.current;
    const show = () => {
      setRows(controls.selection().rows);
      controls.unmountTags();
      controls.renderTags(workspace.querySelector('[data-query-tags]'));
    };
    const controls = setupQueryControls({ onChange: show, workspace,
      controls: workspace.querySelector('.context-query-tools'),
      tooltip: workspace.querySelector('.warm-tooltip-popover') });
    controls.setScreen('dashboard/all', [], { rows: dashboard.cases, asOf: dashboardPeriodEnd });
    show();
    return controls.dispose;
  }, []);
  return <Box ref={host}>
    <Box className="warm-tooltip-popover" popover="manual" />
    <Box className="catalogue-actions" role="group" aria-label="조회 도구 예시"
      dangerouslySetInnerHTML={queryMarkup} />
    <Box className="screen-query-tags" data-query-tags />
    <Text><Text as="strong">{rows.length}건</Text> · 현재 조회 결과</Text>
    <Box className="catalogue-query-codes">{rows.slice(0, 5).map(row =>
      <Text as="code" key={row.code}>{row.code}</Text>)}</Box>
  </Box>;
}

function WorkflowSample({ kind, view }) {
  const ref = useRef(null);
  useEffect(() => mountWorkflows(ref.current, undefined, { reportData: dashboard }).unmount, [kind, view]);
  return <Box ref={ref} className="catalogue-workflow"><Box data-workflow={kind} data-report-view={view} /></Box>;
}

function ResultSamples() {
  const [status, setStatus] = useState('pending');
  return <>
    <Box as="label" className="catalogue-status-select">처리 상태 <select className="aml-native-select" value={status} onChange={event => setStatus(event.target.value)}>
      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></Box>
    <StatusMark status={status} label={statusLabels[status]} color="var(--text)"
      doneColor="var(--tag-positive-ink)" errorColor="var(--tag-danger-ink)" strike={false} />
    <ActionButton className="row" shape="pill" surface="floating" onClick={() => document.dispatchEvent(new CustomEvent('aml:result', {
      detail: { status, title: statusLabels[status] },
    }))}>결과 알림 표시</ActionButton>
  </>;
}

function ShellDemo() {
  const [open, setOpen] = useState(false);
  return <Box as="details" onToggle={event => { if (event.currentTarget.open) setOpen(true); }}>
    <Box as="summary">앱 셸 열기</Box>
    {open && <iframe className="catalogue-shell" src="/dashboard/mine" loading="lazy"
      title="AML RADAR 헤더, 사이드바, 새 검색, 보관함, 설정, 로그인" />}
  </Box>;
}

function Catalogue() {
  const [dark, setDark] = useState(false);
  const [systemReduced] = useState(() => systemReducedMotion?.matches ?? false);
  const [reduced, setReduced] = useState(systemReduced);
  const [refraction, setRefraction] = useState(true);
  const [size, setSize] = useState('medium');
  const [checked, setChecked] = useState(false);
  const [useFilter, setUseFilter] = useState(true);
  const [count, setCount] = useState(0);
  const [screen, setScreen] = useState('alert/overview-allpanel');
  const [withSecondary, setWithSecondary] = useState(true);
  const [listSelection, setListSelection] = useState('');
  const [reportView, setReportView] = useState('table');
  const [dashOpen, setDashOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const root = useRef(null);
  const indexRef = useRef(null);
  useEffect(() => {
    const index = indexRef.current;
    const measureIndex = () => {
      root.current.style.setProperty('--catalogue-index-height', `${index.offsetHeight}px`);
    };
    const resize = new ResizeObserver(measureIndex);
    resize.observe(index);
    const hash = location.hash;
    const section = sections.find(([id]) => hash === `#${id}`);
    const firstAnchor = section && requestAnimationFrame(() => {
      if (location.hash !== hash) return;
      measureIndex();
      document.getElementById(section[0])?.scrollIntoView();
    });
    return () => {
      resize.disconnect();
      if (firstAnchor) cancelAnimationFrame(firstAnchor);
    };
  }, []);
  useEffect(() => {
    Object.assign(document.documentElement.dataset, {
      theme: dark ? 'dark' : 'light', reducedMotion: String(reduced), uiSize: size,
      glassmorphism: String(refraction),
    });
    document.dispatchEvent(new Event('aml:appearance'));
  }, [dark, reduced, size, refraction]);
  useEffect(() => refraction ? setupGlassMaterial() : undefined, [refraction]);
  useEffect(() => bindCardGlow(root.current), []);
  useEffect(() => mountWorkflowNotifications(document.getElementById('workflow-notifications')), []);

  const navGroups = ScreenNavigation(screen, groups.A[0]);
  const handleRecordClick = event => {
    const button = event.target.closest('[data-work-code]');
    if (!button) return;
    setFeedback(`${button.dataset.workCode} · ${button.hasAttribute('data-add-work-tab') ? '사이드바 탭으로 추가' : '상세 열기'}`);
  };
  return <Box as="main" className="catalogue" ref={root}>
    <Box as="header" className="catalogue-header">
      <Box><a href="/dashboard/mine">AML RADAR</a><Heading level={1}>컴포넌트</Heading></Box>
      <Box className="catalogue-preferences">
        <NativeSwitch id="catalogue-motion" label="모션 줄이기" initial={systemReduced} onChange={setReduced} />
      </Box>
    </Box>
    <Box as="nav" className="catalogue-index" ref={indexRef} aria-label="컴포넌트 분류">
      {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      <Box className="catalogue-index-preferences catalogue-preferences">
        <NativeSwitch id="catalogue-theme" label="다크 모드" initial={false} onChange={setDark} />
        <QueryRadio label="UI 크기" items={uiSizeOptions} value={size} onChange={setSize} />
      </Box>
    </Box>
    <Text as="output" className="catalogue-feedback" aria-live="polite">{feedback}</Text>
    <DemoGroup id="foundations" label="기본 요소">
      <Demo title="Button · IconButton · WarmTooltip · ScrollArea">
        <NativePrimitives onEvent={setFeedback} />
      </Demo>
      <Demo title="PrimaryButton · StarBorder · HoldButton">
        <Box className="catalogue-actions">
          <PrimaryButton tone="brand" onClick={() => setFeedback('강조 버튼 실행')}>실행</PrimaryButton>
          <PrimaryButton tone="brand" disabled>실행 불가</PrimaryButton>
          <ConfirmHoldButton tone="negative" doneLabel="확인 완료" onHold={() => setFeedback('길게 눌러 실행했습니다.')}>길게 눌러 확인</ConfirmHoldButton>
          <ActionButton className="row" onClick={() => setFeedback('보조 버튼 실행')}>보조 동작</ActionButton>
        </Box>
      </Demo>
      <Demo title="SquishSwitch · BellToggle · SpringCheck">
        <Box className="catalogue-control-stack">
          <NativeSwitch id="catalogue-refraction" label="리퀴드 글래스" initial onChange={setRefraction} />
          <Box className="catalogue-setting"><Text as="span">보관함 알림</Text><NotificationPreference demo /></Box>
          <QueryCheck label="Alert 선택" checked={checked} onChange={setChecked} />
        </Box>
      </Demo>
      <Demo title="StatusTag · PatternTag · FilterTag · GlassSurface">
        <Box className="catalogue-glass-sample">
          <Box className="glass catalogue-tags">
            <VerdictTag verdict="abnormal" /><VerdictTag verdict="unjudged" /><VerdictTag verdict="normal" />
            <StatusTag preset="elapsedOver1w">8일 경과</StatusTag><StatusTag preset="elapsedUnder1w">7일 경과</StatusTag>
            <ReviewStatusTag status="처리 전" /><ReviewStatusTag status="처리 중" /><ReviewStatusTag status="처리 완료" />
            <StatusTag preset="riskHigh">93점 위험</StatusTag><StatusTag preset="riskMedium">78점 주의</StatusTag><StatusTag preset="riskLow">29점 낮음</StatusTag>
            <ModelScoreTag band="high" score={93} />
            {ibmPatterns.map(({ label }) => <React.Fragment key={label}>
              <PatternTag emphasis="subtle">{label} 82%</PatternTag><PatternTag>{label} 82%</PatternTag>
            </React.Fragment>)}
            <PatternTag emphasis="subtle">+1</PatternTag><PatternTag>+1</PatternTag>
            <CaseActorTag>내 담당</CaseActorTag>
            {useFilter && <FilterTag onRemove={() => setUseFilter(false)}>담당자: 내 담당</FilterTag>}
          </Box>
        </Box>
        <ActionButton className="row" disabled={useFilter} onClick={() => setUseFilter(true)}>필터 다시 적용</ActionButton>
      </Demo>
      <Demo title="Panel · 정보 표면">
        <Box><Panel><Heading>탐지 근거</Heading></Panel></Box>
      </Demo>
    </DemoGroup>
    <DemoGroup id="variables" label="변수">
      <Demo title="토큰과 적용값" wide>
        <DesignVariables />
      </Demo>
    </DemoGroup>
    <DemoGroup id="navigation" label="탐색과 조회">
      <Demo title="WorkspaceNavigation · RubberSegment">
        <QueryCheck label="보기 방식 함께 표시" checked={withSecondary} onChange={setWithSecondary} />
        <Box className="screen-navigation catalogue-navigation">
          <WorkspaceNavigation {...navGroups} secondary={withSecondary ? navGroups.secondary : []}
            onRoute={setScreen} reduced={reduced} />
        </Box>
      </Demo>
      <Demo title="필터·정렬·기간 · CSV 다운로드"><QueryDemo /></Demo>
    </DemoGroup>
    <DemoGroup id="records" label="카드와 목록">
      <Demo title="Card · CardHeader · 사이드바 탭 추가" wide>
        <CardSamples onEvent={setFeedback} />
      </Demo>
      <Demo title="AnimatedList">
        <AnimatedList ariaLabel="소유주 예시" items={Array.from({ length: 12 }, (_, index) => `소유주-${String(index + 1).padStart(3, '0')}`)}
          initialSelectedIndex={0} displayScrollbar maxHeight={195} width="100%" showGradients={false} frame={false}
          animation={reduced ? 'none' : 'slide'} onItemSelect={setListSelection}
          style={{ '--al-ink': 'var(--text)', '--al-tile': 'var(--workspace-surface)', '--al-ring': 'var(--selected)' }} />
        <Text as="output">선택 · {listSelection || '소유주-001'}</Text>
      </Demo>
      <Demo title="ScrollStack · 이전 비교">
        <Text>현재 정보 카드에는 일반 스크롤을 사용합니다.</Text>
        <ScrollStack className="catalogue-stack" useWindowScroll={false} smoothScroll={false}
          itemDistance={8} itemStackDistance={8} baseScale={1}>
          {groups.A.slice(0, 5).map(code => <ScrollStackItem key={code}>
            <ActionButton className="row" shape="pill" surface="floating" onClick={() => setFeedback(`${code} 선택`)}>{code}</ActionButton>
          </ScrollStackItem>)}
        </ScrollStack>
      </Demo>
      <Demo title="ListCard · 소유주·계좌·거래 · BranchLines" wide>
        <Box className="catalogue-ledger" onClick={handleRecordClick}>
          <Ledger codes={groups.T} caseRows={caseRows} />
        </Box>
      </Demo>
      <Demo title="Alert 카드 목록 · 일괄 선택" wide>
        <Box onClick={handleRecordClick}><CaseCards codes={groups.A.slice(0, 3)} label="Alert" caseRows={caseRows} /></Box>
      </Demo>
      <Demo title="Alert·Episode 표 · 사람 판정" wide>
        <Box onClick={handleRecordClick}>
          <PreviewCaseTable title="Alert 목록" rows={groups.A.slice(0, 3).map(code => caseRows.get(code))} />
          <PreviewCaseTable title="Episode 목록" rows={groups.E.slice(0, 3).map(code => caseRows.get(code))} episode />
        </Box>
      </Demo>
    </DemoGroup>
    <DemoGroup id="workflows" label="룰과 보고서">
      <Demo title="BranchedMenu"><RuleTemplateMenu /></Demo>
      <Demo title="두 손잡이 위험도 조절"><RiskDial embedded /></Demo>
      <Demo title="StatusMark · FooterNotice"><ResultSamples /></Demo>
      <Demo title="Stepper · 백테스트" wide><WorkflowSample kind="backtest" /></Demo>
      <Demo title="판정 이력 · PDF" wide>
        <QueryRadio label="보고서 보기" items={[{ value: 'table', label: '표' }, { value: 'card', label: '카드' }]}
          value={reportView} onChange={setReportView} />
        <WorkflowSample kind="report" view={reportView} />
      </Demo>
      <Demo title="CountUp">
        <Text className="catalogue-count"><CountUp key={count} to={1234} separator="," duration={reduced ? 0 : .45} trigger="load" />건</Text>
        <ActionButton className="row" shape="pill" surface="floating" onClick={() => setCount(value => value + 1)}>다시 재생</ActionButton>
      </Demo>
      <Demo title="MagicBento · 대시보드 지표와 차트" wide>
        <Box as="details" onToggle={event => { if (event.currentTarget.open) setDashOpen(true); }}>
          <Box as="summary">대시보드 열기</Box>
          {dashOpen && <Box onClick={handleRecordClick}><PreviewDashboard data={dashboard} mine={false}
            appearance={{ theme: dark ? 'dark' : 'light', reduced }} /></Box>}
        </Box>
      </Demo>
    </DemoGroup>
    <DemoGroup id="shell" label="앱 셸">
      <Demo title="헤더 · 사이드바 · 전역 검색 · 보관함 · 계정 · 설정 · 로그인" wide><ShellDemo /></Demo>
    </DemoGroup>
    <Box id="workflow-notifications" />
  </Box>;
}

createRoot(document.getElementById('component-catalogue')).render(<Catalogue />);
