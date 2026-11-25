import React, { useCallback, useEffect, useState } from 'react';
import { cancelBacktest, fetchBacktest, fetchBacktests, fetchRule, requestBacktest } from '@/api/rules';
import { Box, Heading, Text } from '@/components/layout-primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { Panel } from '../../components/panel';
import { Progress } from '../../components/progress';
import { activateRecordCard } from '../../components/record-card';
import { ScreenActions } from '../../components/screen-actions';
import { StatusTag } from '../../components/semantic-tags';
import { csvDownloadEntry, TableQueryTools } from '../../components/query-controls';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from '../../components/workflow-table';
import { sidedText, sideOf, templateOf } from './rule-definition';
import { transactionCode } from '../investigation/live-data.js';
import {
  codeToRuleId, loadRuleCatalog, problemText, refreshLiveRules, ruleStatusNames, ruleStatusPresets,
} from './live-rule-store';
import './preview-rule-workspace.css';
import '../../components/form-dropdown.css';
import './live-rule-engine.css';

// 백테스트. 룰을 고르면 그 룰의 작업 중 버전(없으면 운영 버전)을 과거 원장에 돌린다.
// 운영 버전이 따로 있으면 서버가 같은 기간에 같이 돌려 새로 걸림 · 빠짐을 낸다. 실행은 서버가 하고 화면은 2초마다 상태를 읽는다.

const POLL_MS = 2000;
/** 사례 표에 한 번에 보여 주는 줄 수 */
const CASE_PAGE = 20;
/**
 * 근거 거래가 검사한 거래의 이 비율(%) 이상이면 "넓게 걸린다"고 알린다.
 * 실험(HI-Medium 09-08 ~ 09-16, 약 1,700만 건)에서 템플릿 10종의 기본값은 가장 넓은 단건 고액거래가 0.19% 였고,
 * "처음 거래하는 상대" 필터 없이 건 일반 룰은 넷 중 셋이 10% 이상이었다(룰-템플릿-정의 5.3). 그 사이의 값으로 잡았다.
 */
const WIDE_SHARE = 1;

const countFormat = new Intl.NumberFormat('ko-KR');
const decimalFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const timeFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
const count = value => (value == null ? '—' : countFormat.format(value));
const percent = value => (value == null ? '—' : `${decimalFormat.format(value)}%`);

const statusNames = { QUEUED: '대기 중', RUNNING: '실행 중', COMPLETED: '완료', FAILED: '실패', CANCELLED: '취소됨' };
const statusPresets = { QUEUED: 'pending', RUNNING: 'inProgress', COMPLETED: 'done', FAILED: 'caution', CANCELLED: 'cancelled' };
const errorTexts = {
  TIMEOUT: '쿼리 하나가 120초를 넘어 중단했습니다. 세는 거래 조건을 좁히거나 기간을 줄여 다시 실행해 주세요.',
  INTERRUPTED: '서버가 다시 시작돼 중단됐습니다. 다시 실행해 주세요.',
  INTERNAL: '실행 중 오류가 났습니다. 다시 실행해도 같으면 조건을 확인해 주세요.',
};
const caseStates = {
  HIT: { label: '적중', preset: 'neutral' },
  ADDED: { label: '새로 걸림', preset: 'inProgress' },
  DROPPED: { label: '빠짐', preset: 'cancelled' },
  KEPT: { label: '그대로', preset: 'neutral' },
};
const judgements = { SUSPICIOUS: '의심', NORMAL: '정상' };
const active = status => status === 'QUEUED' || status === 'RUNNING';
const windowText = minutes => (minutes % 60 === 0 ? `${minutes / 60}시간` : `${minutes}분`);

function runTimeText(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? `${timeFormat.format(date)} KST` : '';
}

function RunTime({ value }) {
  const text = runTimeText(value);
  return text ? <Text as="time" dateTime={value}>{text}</Text> : '—';
}

function Metric({ label, value, unit, note }) {
  return <Panel as="div" className="backtest-metric">
    <Box as="dt">{label}</Box>
    <Box as="dd"><Text as="strong">{value}</Text>{unit && <> <Text as="span">{unit}</Text></>}</Box>
    {note && <Box as="dd" className="backtest-meta">{note}</Box>}
  </Panel>;
}

/**
 * 측정값을 "수취 계좌 6개 · 보낸 총액 65,700 USD" 로 읽는다. 문구 · 단위 · 순서는 카탈로그에서 온다.
 * 경로형(CYCLE · RANDOM)의 측정값은 HOPS(그날 가장 긴 경로의 거래 수) 하나이고, 문구는 조건 값 minHops 의 것("순환 거래 수")을 쓴다.
 */
function measuredText(measured, catalog, side, order = [], templateKey = '') {
  const rank = key => (order.includes(key) ? order.indexOf(key) : order.length);
  return Object.entries(measured ?? {}).filter(([, value]) => value != null).sort(([a], [b]) => rank(a) - rank(b)).map(([key, value]) => {
    const hops = key === 'HOPS';
    // 대상이 거래인 룰(단건 고액거래)의 측정값은 그 거래의 금액이고, 문구는 세는 거래 항목 "건당 금액" 의 것이다
    const amount = key === 'TX_USD';
    const spec = hops ? catalog?.path?.minHops : amount ? catalog?.filterFields?.TX_USD : catalog?.metrics[key];
    const label = (hops ? sidedText(spec?.label, templateKey) : amount ? sidedText(spec?.label, side) : sidedText(spec?.short ?? spec?.label, side)) || key;
    return `${label} ${decimalFormat.format(value)}${spec?.unit ? (spec.unit.length > 1 ? ` ${spec.unit}` : spec.unit) : ''}`;
  }).join(' · ');
}

// 대상이 계좌인 룰과 거래인 룰(단건 고액거래)은 세는 말이 다르다: "대상 3개" / "거래 3건"
const subjectNouns = { ACCOUNT: { name: '대상', unit: '개' }, TX: { name: '거래', unit: '건' } };

/** 사례의 대상을 화면에 적는 글자. 계좌는 가명 ID 앞 8자리, 거래는 화면의 거래 코드(T-yymmdd-00000000)다. */
function subjectText(item) {
  return item.subjectType === 'TX' && item.txId != null && item.occurredAt ? transactionCode(item) : item.subject;
}

function Notices({ run, wholePath }) {
  const wide = run.evidenceShare != null && run.evidenceShare >= WIDE_SHARE;
  if (run.currentDefinition && !wide && !run.skippedBusySubjects && !run.chunkedCount) return null;
  return <Box as="ul" className="rule-check-warnings rule-backtest-notices" aria-label="알아 둘 것">
    {!run.currentDefinition && <Box as="li">이 결과는 조건을 고치기 전의 것입니다. 지금 조건으로 보려면 다시 실행해 주세요.</Box>}
    {wide && <Box as="li">근거 거래가 검사한 거래의 {percent(run.evidenceShare)} 입니다({count(run.evidenceTxCount)}건). 조건이 원장을 넓게 덮습니다. 세는 거래 조건을 좁히거나 적중 조건의 값을 올려 보세요.</Box>}
    {run.skippedBusySubjects > 0 && <Box as="li">바쁜 계좌 {count(run.skippedBusySubjects)}개는 평가하지 않았습니다(
      {windowText(run.busy.windowMinutes)} 안 같은 방향 거래 {count(run.busy.maxTransactions)}건 초과).
      {wholePath && ' 이 템플릿은 대상뿐 아니라 경유 · 경로 자리에 바쁜 계좌가 있는 거래도 잇지 않습니다.'}</Box>}
    {run.chunkedCount > 0 && <Box as="li">근거 거래가 32건을 넘는 대상이 {count(run.chunkedCount)}개 있습니다. Alert 로 묶이면 여러 개로 나뉩니다.</Box>}
  </Box>;
}

function Kpis({ run, noun }) {
  const { kpis } = run;
  const compared = run.baseline != null;
  return <Box as="dl" className="backtest-grid backtest-comparison" aria-label="백테스트 결과">
    <Metric label={`적중 ${noun.name}`} value={count(kpis.hits)} unit={noun.unit}
      note={compared ? `운영 v${run.baseline.versionNo} 은 ${count(kpis.baseHits)}${noun.unit}`
        : noun.name === '대상' ? `대상 × 날짜로는 ${count(run.hitDays)}건` : undefined} />
    <Metric label="새로 걸림" value={compared ? count(kpis.added) : '—'} unit={compared ? noun.unit : undefined}
      note={compared ? `운영 버전에는 없던 ${noun.name}` : '비교할 운영 버전이 없습니다'} />
    <Metric label="빠짐" value={compared ? count(kpis.dropped) : '—'} unit={compared ? noun.unit : undefined}
      note={compared ? `운영 버전에만 있던 ${noun.name}` : undefined} />
    <Metric label="사람 판정 기준 정확도" value={percent(kpis.precision)}
      note={kpis.judged ? `판정 ${count(kpis.judged)}건 기준${compared && kpis.baseJudged ? ` · 운영 v${run.baseline.versionNo} 은 ${percent(kpis.basePrecision)}` : ''}`
        : `적중 ${noun.name}${noun.name === '거래' ? '와' : '과'} 겹치는 Alert 가운데 사람이 종결한 것이 없습니다`} />
  </Box>;
}

/** @param noAlert 이 템플릿의 룰은 Alert 를 만들 수 없다(카탈로그의 alert.allowed). "예상 새 Alert" 를 보여 주지 않는다. */
function Sweep({ sweep, noun, noAlert }) {
  return <Box as="section" className="rule-backtest-sweep" aria-label="값을 바꾸면">
    <WorkflowTable label="값을 바꾸면" tableClassName="rule-backtest-table" tools={false}
      summary={<>{tableCount(sweep.rows.length)} <Text as="span">{sweep.label}만 바꿔 같은 기간에 다시 돌린 결과입니다.</Text></>}>
      <TableHeader><TableRow>
        <TableHead scope="col">{sweep.label}</TableHead><TableHead scope="col">적중 {noun.name}</TableHead><TableHead scope="col">근거 거래</TableHead>
        <TableHead scope="col">Alert 와 겹침</TableHead>{!noAlert && <TableHead scope="col">예상 새 Alert</TableHead>}
      </TableRow></TableHeader>
      <TableBody>{sweep.rows.map(row => <TableRow key={row.value} data-current={row.current || undefined}>
        <TableRowHead>{decimalFormat.format(row.value)}{sweep.unit?.length > 1 ? ` ${sweep.unit}` : sweep.unit}{row.current && <Text as="span" className="rule-backtest-current"> 이번 값</Text>}</TableRowHead>
        <TableCell>{count(row.hits)}</TableCell><TableCell>{count(row.txCount)}</TableCell><TableCell>{count(row.alertOverlap)}</TableCell>{!noAlert && <TableCell>{count(row.expectedNewAlerts)}</TableCell>}
      </TableRow>)}</TableBody>
    </WorkflowTable>
  </Box>;
}

function Scope({ run, noun, noAlert }) {
  return <Panel className="rule-backtest-scope" aria-label="검사 범위">
    <Heading>검사 범위</Heading>
    <Box as="dl" className="rule-condition-facts rule-backtest-facts">
      <Box><Box as="dt">기간</Box><Box as="dd">{run.period.from} ~ {run.period.to} ({count(run.period.days)}일)</Box></Box>
      <Box><Box as="dt">검사한 거래</Box><Box as="dd">{count(run.txCount)}건</Box></Box>
      <Box><Box as="dt">근거 거래</Box><Box as="dd">{count(run.evidenceTxCount)}건 · 검사한 거래의 {percent(run.evidenceShare)}</Box></Box>
      <Box><Box as="dt">이미 있는 Alert 와 겹침</Box><Box as="dd">{noun.name} {count(run.alertOverlap)}{noun.unit}</Box></Box>
      {!noAlert && <Box><Box as="dt">예상 새 Alert</Box><Box as="dd">대상 {count(run.expectedNewAlerts)}개 <Text as="span" className="workflow-rule-note">추정</Text></Box></Box>}
    </Box>
    <Text className="workflow-rule-note">{noAlert ? '이 템플릿의 룰은 Alert 를 만들지 않고 근거로만 표시합니다.'
      : '예상 새 Alert 는 어느 Alert 와도 겹치지 않고 근거 거래가 2건 이상인 대상 수입니다. 실제로 몇 개로 묶일지는 Alert 생성을 돌려야 압니다.'}</Text>
  </Panel>;
}

function Cases({ run, catalog, side, order, templateKey, noun, registerTableTools }) {
  const measuredOf = item => measuredText(item.measured, catalog, side, order, templateKey);
  const sorting = useTableSort(run.cases);
  const [shown, setShown] = useState(CASE_PAGE);
  const total = run.kpis.hits + (run.kpis.dropped ?? 0);
  useEffect(() => registerTableTools?.({
    panelDownload: false,
    entries: [csvDownloadEntry('백테스트 사례', 'rule-backtest-cases', ['대상', '구분', '근거 거래', '측정값', '연결 Alert', '사람 판정'],
      sorting.rows.map(item => [subjectText(item), caseStates[item.state].label, item.txCount, measuredOf(item),
        item.alertId ?? '', judgements[item.judgement] ?? '']))],
  }));
  return <Box as="section" className="rule-backtest-cases" aria-label="사례">
    <WorkflowTable label="사례" summary={tableCount(Math.min(shown, run.cases.length), total, noun.unit)}>
      <TableHeader><TableRow>
        <SortableTableHead sorting={sorting} column="account" value={subjectText}>{noun.name === '거래' ? '대상 거래' : '대상 계좌'}</SortableTableHead>
        <SortableTableHead sorting={sorting} column="status" value={item => caseStates[item.state].label}>구분</SortableTableHead>
        <SortableTableHead sorting={sorting} column="거래 건수" value={item => item.txCount}>근거 거래</SortableTableHead>
        <SortableTableHead sorting={sorting} column="value" value={measuredOf}>측정값</SortableTableHead>
        <SortableTableHead sorting={sorting} column="Alert" value={item => item.alertId ?? 0}>연결 Alert</SortableTableHead>
        <SortableTableHead sorting={sorting} column="verdict" value={item => judgements[item.judgement] ?? ''}>사람 판정</SortableTableHead>
      </TableRow></TableHeader>
      <TableBody>{sorting.rows.slice(0, shown).map(item => <TableRow key={`${item.subjectType}-${item.subject}`}>
        <TableRowHead><Text as="code">{subjectText(item)}</Text></TableRowHead>
        <TableCell><StatusTag preset={caseStates[item.state].preset}>{caseStates[item.state].label}</StatusTag></TableCell>
        <TableCell>{count(item.txCount)}건</TableCell>
        <TableCell className="workflow-rule-summary">{measuredOf(item)}</TableCell>
        <TableCell>{item.alertId ?? '—'}</TableCell>
        <TableCell>{judgements[item.judgement] ?? '—'}</TableCell>
      </TableRow>)}
        {!run.cases.length && <TableRow><TableCell colSpan={6}>이 기간에 걸린 {noun.name}{noun.name === '거래' ? '가' : '이'} 없습니다.</TableCell></TableRow>}
      </TableBody>
    </WorkflowTable>
    {shown < run.cases.length && <ActionButton className="rule-backtest-more" shape="pill" surface="floating"
      onClick={() => setShown(value => value + CASE_PAGE)}>더 보기 ({count(run.cases.length - shown)}{noun.unit} 남음)</ActionButton>}
    {run.cases.length < total
      && <Text className="workflow-rule-note">서버는 새로 걸린 {noun.name}, 빠진 {noun.name}, 근거 거래가 많은 {noun.name} 순으로 {count(run.cases.length)}{noun.unit}까지만 보냅니다.</Text>}
  </Box>;
}

const historyComparison = row => row.baseline ? `운영 v${row.baseline.versionNo} 과 비교` : '';
const historyPeriod = row => `${row.period.from} ~ ${row.period.to}`;
const previousConditions = '조건을 고치기 전';

function History({ rows, selectedId, onOpen, unavailableText }) {
  const sorting = useTableSort(rows);
  const download = csvDownloadEntry('실행 기록', 'rule-backtest-history',
    ['버전', '상태', '비교 기준', '검사 기간', '검사한 거래', '요청자', '요청 시각'], sorting.rows.map(row => [
      `v${row.versionNo}`, statusNames[row.status], historyComparison(row),
      row.currentDefinition ? historyPeriod(row) : `${historyPeriod(row)} · ${previousConditions}`,
      row.txCount ?? '', row.requestedBy, runTimeText(row.requestedAt),
    ]));
  return <Box as="section" className="rule-backtest-history" aria-label="실행 기록">
    <WorkflowTable label="실행 기록" summary={unavailableText ? undefined : tableCount(rows.length)}
      tools={rows.length > 0 && <TableQueryTools actions={{ entries: [download] }} />}>
      <TableHeader><TableRow>
        <SortableTableHead sorting={sorting} column="version" value={row => row.versionNo}>버전</SortableTableHead>
        <SortableTableHead sorting={sorting} column="status" value={row => statusNames[row.status]}>상태</SortableTableHead>
        <SortableTableHead sorting={sorting} column="kind" value={row => row.baseline?.versionNo}>비교 기준</SortableTableHead>
        <SortableTableHead sorting={sorting} column="거래 기간" value={row => `${row.period.from}/${row.period.to}`}>검사 기간</SortableTableHead>
        <SortableTableHead sorting={sorting} column="거래 건수" value={row => row.txCount}>검사한 거래</SortableTableHead>
        <SortableTableHead sorting={sorting} column="author" value={row => row.requestedBy}>요청자</SortableTableHead>
        <SortableTableHead sorting={sorting} column="시각" value={row => row.requestedAt}>요청 시각</SortableTableHead>
      </TableRow></TableHeader>
      <TableBody>{sorting.rows.map(row => {
        const selected = row.backtestId === selectedId;
        const comparison = historyComparison(row);
        const period = historyPeriod(row);
        const openRun = () => onOpen(row.backtestId);
        const label = [`v${row.versionNo}`, statusNames[row.status], comparison, period, runTimeText(row.requestedAt)].filter(Boolean).join(' · ');
        return <TableRow key={row.backtestId} data-selected={selected} onClick={event => activateRecordCard(event, openRun)}>
          <TableRowHead><ActionButton className="workflow-rule-select" aria-pressed={selected} aria-label={label}
            onClick={openRun}>v{row.versionNo}</ActionButton></TableRowHead>
          <TableCell><StatusTag preset={statusPresets[row.status]}>{statusNames[row.status]}</StatusTag></TableCell>
          <TableCell>{comparison || '—'}</TableCell>
          <TableCell>{period}{!row.currentDefinition && <> · <Text as="span" className="workflow-rule-note">{previousConditions}</Text></>}</TableCell>
          <TableCell numeric>{row.txCount == null ? '—' : `${count(row.txCount)}건`}</TableCell>
          <TableCell>{row.requestedBy}</TableCell>
          <TableCell><RunTime value={row.requestedAt} /></TableCell>
        </TableRow>;
      })}
        {!rows.length && <TableRow><TableCell colSpan={7}>{unavailableText ?? '아직 돌린 백테스트가 없습니다.'}</TableCell></TableRow>}
      </TableBody>
    </WorkflowTable>
  </Box>;
}

export function LiveRuleBacktest({ initialRule, registerTableTools, actionsHost }) {
  const [rules, setRules] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState(initialRule ?? null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [run, setRun] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    Promise.all([refreshLiveRules(), loadRuleCatalog()]).then(([list, loaded]) => {
      if (!current) return;
      setRules(list.content);
      setCatalog(loaded);
      setFailure('');
      setCode(chosen => (list.content.some(rule => rule.code === chosen) ? chosen : list.content[0]?.code ?? null));
    }, error => { if (current) setFailure(problemText(error, '룰 목록을 불러오지 못했습니다.')); });
    return () => { current = false; };
  }, [attempt]);

  const ruleId = codeToRuleId(code);
  // 룰을 바꾸면 그 룰의 조건과 실행 기록을 읽고, 가장 최근 백테스트를 연다
  useEffect(() => {
    if (ruleId == null || !rules) return undefined;
    let current = true;
    setDetail(null);
    setRun(null);
    setHistory([]);
    setMessage('');
    Promise.all([fetchRule(ruleId), fetchBacktests(ruleId)]).then(([loaded, runs]) => {
      if (!current) return;
      setDetail(loaded);
      setHistory(runs);
      if (runs[0]) fetchBacktest(runs[0].backtestId).then(latest => { if (current) setRun(latest); }, () => undefined);
    }, error => { if (current) setMessage(problemText(error, '룰을 불러오지 못했습니다.')); });
    return () => { current = false; };
  }, [ruleId, rules]);

  // 줄에 서 있거나 돌고 있으면 2초마다 다시 읽는다. 끝나면 실행 기록도 다시 읽는다.
  const runId = run?.backtestId;
  const running = active(run?.status);
  useEffect(() => {
    if (!running || runId == null) return undefined;
    let current = true;
    const timer = window.setInterval(() => {
      fetchBacktest(runId).then(next => {
        if (!current) return;
        setRun(next);
        if (!active(next.status)) fetchBacktests(next.ruleId).then(runs => { if (current) setHistory(runs); }, () => undefined);
      }, error => { if (current) setMessage(problemText(error, '백테스트 상태를 읽지 못했습니다.')); });
    }, POLL_MS);
    return () => { current = false; window.clearInterval(timer); };
  }, [runId, running]);

  const open = useCallback(backtestId => {
    setMessage('');
    fetchBacktest(backtestId).then(setRun, error => setMessage(problemText(error, '백테스트를 불러오지 못했습니다.')));
  }, []);

  if (failure) return <Panel className="rule-load-failure">
    <Heading>백테스트를 열 수 없습니다.</Heading>
    <Text role="alert">{failure}</Text>
    <ActionButton shape="pill" surface="floating" onClick={() => setAttempt(value => value + 1)}>다시 시도</ActionButton>
  </Panel>;
  if (!rules || !catalog) return <Panel aria-busy="true"><Heading>백테스트를 불러오는 중입니다.</Heading></Panel>;
  if (!rules.length) return <Panel><Heading>등록된 룰이 없습니다.</Heading>
    <Text>룰 만들기에서 룰을 만든 뒤에 백테스트할 수 있습니다.</Text>
    <ScreenActions host={actionsHost}><PrimaryButton tone="inverse" as="a" href="/rules/new">룰 만들기</PrimaryButton></ScreenActions>
  </Panel>;

  const target = detail?.working ?? detail?.operating ?? null;
  const baseline = detail?.working && detail?.operating ? detail.operating : null;
  const template = detail ? templateOf(catalog, detail.template) : null;
  // 방향을 고르는 템플릿(분할 입·출금, 같은 금액 반복)은 돌릴 버전의 방향을 따른다
  const side = template && target?.definition ? sideOf(template, target.definition) : template?.side ?? 'FROM';
  const noun = subjectNouns[template?.subject] ?? subjectNouns.ACCOUNT;
  const noAlert = template?.alert?.allowed === false;
  const supported = detail ? (catalog.backtestTemplates ?? []).includes(detail.template) : false;
  // 되는 템플릿은 서버가 알려 준다(backtestTemplates). 이름의 앞부분("FAN-OUT · 분산 송금" → "FAN-OUT")만 카탈로그 순서로 늘어놓는다.
  const supportedNames = catalog.templates.filter(item => (catalog.backtestTemplates ?? []).includes(item.key))
    .map(item => item.name.split(' · ')[0]).join(' · ');
  const blocked = !detail ? '' : !target ? '돌릴 버전이 없습니다.'
    : !supported ? `${detail.templateName} 템플릿의 백테스트는 아직 제공하지 않습니다.${supportedNames ? ` 지금은 ${supportedNames} 만 됩니다.` : ''}` : '';

  async function start() {
    if (!target || blocked || busy || running) return;
    setBusy(true);
    setMessage('');
    try {
      const accepted = await requestBacktest({ versionId: target.versionId });
      setRun(await fetchBacktest(accepted.backtestId));
      setHistory(await fetchBacktests(detail.ruleId));
    } catch (error) {
      setMessage(problemText(error, '백테스트를 시작하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!running) return;
    try {
      setRun(await cancelBacktest(run.backtestId));
      setHistory(await fetchBacktests(detail.ruleId));
    } catch (error) {
      setMessage(problemText(error, '백테스트를 취소하지 못했습니다.'));
    }
  }

  const done = run?.status === 'COMPLETED' && run.kpis ? run : null;
  return <Box as="section" className="screen-section workflow-panel workflow-backtest rule-backtest" aria-label="백테스트">
    <Box className="backtest-grid">
      <Panel className="backtest-card" aria-label="백테스트 대상 룰">
        <Box as="header" className="backtest-card-heading"><Heading>백테스트 대상 룰</Heading>
          {target && <StatusTag preset={ruleStatusPresets[target.status]}>{ruleStatusNames[target.status]}</StatusTag>}</Box>
        <Select value={code ?? ''} onValueChange={setCode} disabled={running || busy}>
          <SelectTrigger className="form-dropdown-trigger rule-backtest-rule" aria-label="룰"><SelectValue /></SelectTrigger>
          <SelectContent className="form-dropdown-options" position="popper" align="start">
            {rules.map(rule => <SelectItem key={rule.code} value={rule.code}>{rule.code} · {rule.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {detail && target ? <>
          <Text className="backtest-meta">{detail.templateName} · v{target.versionNo}</Text>
          <Text>{target.sentence || target.summary}</Text>
        </> : <Text className="backtest-meta">{message ? '' : '룰을 불러오는 중입니다.'}</Text>}
      </Panel>
      <Panel className="backtest-card" aria-label="비교 기준">
        <Box as="header" className="backtest-card-heading"><Heading>비교 기준</Heading></Box>
        {baseline ? <>
          <Text className="backtest-meta">운영 버전 · v{baseline.versionNo}</Text>
          <Text>{baseline.sentence || baseline.summary}</Text>
        </> : <Text className="backtest-meta">{detail?.operating ? '운영 버전 그대로 돌립니다. 비교할 새 버전이 없습니다.' : '운영 버전이 없어 비교하지 않습니다.'}</Text>}
      </Panel>
      <Panel className="backtest-card" aria-label="실행 상태">
        <Box as="header" className="backtest-card-heading"><Heading>실행 상태</Heading>
          {run && <StatusTag preset={statusPresets[run.status]}>{statusNames[run.status]}</StatusTag>}</Box>
        {run ? <>
          {running && <Progress className="rule-backtest-progress" max={100} value={run.progress} aria-label="진행률" />}
          <Text className="backtest-meta">v{run.versionNo} · {run.period.from} ~ {run.period.to} ({count(run.period.days)}일)</Text>
          <Text className="backtest-meta">{run.requestedBy} · <RunTime value={run.requestedAt} /></Text>
          {running && <Text>{run.status === 'QUEUED' ? '앞선 백테스트가 끝나기를 기다립니다.' : `${run.progress}% · 쿼리가 하나 끝날 때마다 올라갑니다.`}
            {run.cancelRequested ? ' 취소를 요청했습니다.' : ''}</Text>}
          {run.status === 'FAILED' && <Text role="alert" data-rule-block-error>{errorTexts[run.errorCode] ?? errorTexts.INTERNAL}</Text>}
        </> : <Text className="backtest-meta">아직 돌린 백테스트가 없습니다. 원장 첫 7일은 이력으로만 쓰고 그 뒤 날짜를 검사합니다.</Text>}
      </Panel>
    </Box>
    {blocked && <Text role="status" className="rule-backtest-blocked">{blocked}</Text>}
    {message && <Text role="alert" data-rule-block-error>{message}</Text>}
    {done && <>
      <Notices run={done} wholePath={template?.evaluator === 'TWO_HOP' || template?.evaluator === 'PATH'} />
      <Kpis run={done} noun={noun} />
      <Box className="screen-row rule-backtest-detail">
        {done.sweep && <Sweep sweep={done.sweep} noun={noun} noAlert={noAlert} />}
        <Scope run={done} noun={noun} noAlert={noAlert} />
      </Box>
      <Cases run={done} catalog={catalog} side={side} order={template?.metrics} templateKey={done.template} noun={noun} registerTableTools={registerTableTools} />
    </>}
    <History rows={history} selectedId={run?.backtestId} onOpen={open}
      unavailableText={!detail ? (message ? '실행 기록을 불러오지 못했습니다.' : '실행 기록을 불러오는 중입니다.') : undefined} />
    <ScreenActions host={actionsHost} stackOnNarrow>
      {running && <PrimaryButton tone="negative" disabled={run.cancelRequested} onClick={() => void cancel()}>취소</PrimaryButton>}
      <PrimaryButton tone="inverse" as="a" href={code ? `/rules?rule=${code}` : '/rules'}>룰 목록</PrimaryButton>
      {detail?.working?.editable
        && <PrimaryButton tone="inverse" as="a" href={`/rules/new?rule=${detail.code}`}>조건 고치기</PrimaryButton>}
      <PrimaryButton tone="brand" disabled={!target || Boolean(blocked) || busy || running} title={blocked || undefined}
        onHold={() => void start()}>{run && !running ? '다시 실행' : '백테스트 실행'}</PrimaryButton>
    </ScreenActions>
  </Box>;
}
