import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { TableBody, TableCell, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PanelLeft, Settings2, X } from 'lucide-react';
import { ActionButton } from '../../components/primary-button';
import { QueryCheck } from '../../components/selection-check';
import { Panel } from '../../components/panel';
import { PreviewCaseCard } from './preview-case-card';
import { TransactionEvidenceTable } from './preview-case-table';
import { useCaseEvidenceSelection } from './case-evidence-selection';
import { SquishSwitchControl } from '../../components/squish-switch';
import { RangeInput } from '../../components/ui/input';
import { currencyColumn, SortableTableHead, tableCount,
  useTableSelection, useTableSort, WorkflowTable } from '../../components/workflow-table';
import { csvDownloadEntry, dateFromCode, inDateRange, LocalQueryTools, TableQueryTools, visibleCaseRows } from '../../components/query-controls';
import { ChartSectionDownload, SectionDownloadHeading } from '../../components/section-download';
import { SankeyChart, SankeyLink, SankeyNode, SankeyTooltip } from '../../components/charts/charts/sankey';
import { TooltipContent } from '../../components/charts/charts/tooltip/tooltip-content';
import { caseSankeyGraph, caseSankeyLayers, layoutCaseSankey } from './case-sankey-data';
import { complexSankeySampleCode } from '../../mocks/dashboard-fixtures';
import { buildCaseNetwork, casePlaybackCursor, graphRiskBand, graphTableSelection, graphVerdict, graphVerdictLabels,
  mergeCaseTransactions, sharedCaseEvidence, transactionsWithinHops } from './case-graph-scope';
import { caseAccountLayout } from './case-pattern-layout';
import { CountTag, LinkTag, ModelScoreTag } from '../../components/semantic-tags';
import { caseGroupColor, caseMembership } from '../graph/graph-case-groups';
import { ForceCaseCanvas } from '../graph/force-case-canvas';
import { GraphIconButton, GraphPlayback, GraphZoomControls } from '../graph/preview-graph-controls';
import { GraphFlowStroke, readGraphFlowDuration } from '../../components/charts/charts/graph-flow-pulse';
import { OwnerGraphTimeline } from '../graph/owner-graph-timeline';
import { useSpringNodeDrag } from '../graph/graph-node-drag';
import { modelRiskLabels } from '../settings/model-risk-settings';
import '../../components/form-dropdown.css';
import './preview-case-graph.css';
import { Box, Heading, Text } from '@/components/layout-primitives';
import { dataSeriesColors } from '@/components/charts/charts/chart-context';
import { readChartNumber } from '@/components/charts/chart-design-values';

function casesSharingEvidence(active, cases) {
  return cases.flatMap(record => {
    if (record.code === active.code || (active.kind === 'Episode' && record.kind !== 'Alert')) return [];
    const { transactions, accounts } = sharedCaseEvidence(active, record);
    const sharedTransactions = transactions.length;
    const sharedAccounts = accounts.length;
    return sharedTransactions || sharedAccounts ? [{ record, sharedTransactions, sharedAccounts }] : [];
  }).sort((a, b) => b.sharedTransactions - a.sharedTransactions || b.sharedAccounts - a.sharedAccounts ||
    a.record.code.localeCompare(b.record.code));
}

const formatAmount = new Intl.NumberFormat('ko-KR');
function riskLegend() {
  const labels = modelRiskLabels();
  return { high: `위험 · ${labels.high}`, medium: `주의 · ${labels.medium}`, low: `낮음 · ${labels.low}`, unknown: labels.unknown };
}
const hopSteps = [1, 2, 3, 4, 5];
const allGraphRelations = ':all-relations:';

function GraphSettings({ id, groups, showDetails, onDetailsChange, ownerView, sankeyView, anchor, hops, onHopsChange,
  network, selection, onSelect, shownCases, highlightedCase, onHighlight, hiddenCases, onVisibilityChange,
  showSankeySample, accountCount, ownerCount, patternLayout }) {
  const trigger = useRef(null);
  const [expanded, setExpanded] = useState(() => window.innerWidth > 768);
  function closeOnEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
    event.preventDefault();
    setExpanded(false);
    trigger.current?.focus({ preventScroll: true });
  }
  const caseEntry = ({ id, color }) => {
    const isBase = id === groups[0].id;
    const hidden = !isBase && hiddenCases.has(id);
    const interactive = shownCases.has(id);
    const membership = <>
      <Text as="i" className="preview-flow-swatch" style={{ '--case-graph-swatch-ink': color }} aria-hidden="true" />
      <Text as="code">{id}</Text>{isBase && <Text as="span">기준</Text>}
      {hidden ? <Text as="span">숨김</Text> : !interactive && <Text as="span">범위 밖</Text>}
    </>;
    return <Box as="li" key={id}>
      <QueryCheck label={null} ariaLabel={`${id} 그래프 표시`} checked={!hidden} disabled={isBase}
        onChange={checked => onVisibilityChange(id, checked)} />
      {interactive
        ? <ActionButton aria-pressed={highlightedCase === id} onClick={() => onHighlight(id)}>{membership}</ActionButton>
        : <Text as="span" className="preview-graph-case-included">{membership}</Text>}
    </Box>;
  };
  return <Box as="aside" className="glass floating-glass preview-graph-settings" data-expanded={expanded}
    aria-label="그래프 설정" data-figma-graph-settings onKeyDown={closeOnEscape}>
    <Box as="header" className="preview-graph-settings-heading">
      <GraphIconButton ref={trigger} grouped label="그래프 설정" icon={Settings2} alternateIcon={PanelLeft}
        title={expanded ? '그래프 설정 접기' : '그래프 설정 열기'}
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(open => !open)} />
      <Heading level={3} aria-hidden={!expanded}>그래프 설정</Heading>
    </Box>
    <Box className="preview-graph-settings-body" id={id} inert={!expanded} aria-hidden={!expanded}
      tabIndex={expanded ? 0 : undefined}>
      <Text className="preview-graph-counts"><CountTag label="계좌" count={accountCount} unit="개" />
        {ownerCount !== undefined && <CountTag label="소유주" count={ownerCount} unit="명" />}</Text>
      {showSankeySample && <LinkTag href={`/alerts/${complexSankeySampleCode}?tab=analysis&view=sankey`}>복합 거래 흐름 보기</LinkTag>}
      {groups.length > 0 && <Box as="section" className="preview-graph-cases" aria-labelledby="preview-graph-cases-title">
        <Heading level={4} id="preview-graph-cases-title">그래프에 표시 중 <CountTag count={groups.length} /></Heading>
        <Box as="ul" className="preview-graph-case-list" aria-label="그래프에 포함된 업무">
          {groups.map(caseEntry)}
        </Box>
      </Box>}
      <Text className="preview-graph-lens-note">{sankeyView
        ? '띠의 굵기는 거래 건수를 나타냅니다.'
        : ownerView
        ? '소유주 블록에 계좌를 모아 표시합니다. 왼쪽은 수취, 오른쪽은 송금입니다.'
        : `가로 · 계좌의 첫 거래 시각(KST) / 세로 · ${patternLayout === 'pattern' ? '거래 패턴' : '송금·수취 연결'}`}</Text>
      {!sankeyView && <Box className="preview-graph-detail-toggle">
        <Box as="label" htmlFor="case-graph-details">그래프 거래 라벨 표시</Box>
        <Text as="span"><SquishSwitchControl id="case-graph-details" label="그래프 거래 라벨 표시"
          checked={showDetails} onChange={onDetailsChange} /></Text>
      </Box>}
      <Box className="preview-graph-picker">
        <Box as="label" htmlFor="case-graph-selection">계좌·연결 선택</Box>
        <Select value={selection ?? allGraphRelations} disabled={!network.nodes.length}
          onValueChange={value => onSelect(value === allGraphRelations ? undefined : value)}>
          <SelectTrigger id="case-graph-selection" className="form-dropdown-trigger preview-graph-picker-trigger" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="form-dropdown-options preview-graph-picker-options" position="popper" align="start">
            <SelectItem value={allGraphRelations}>전체 관계</SelectItem>
            {!ownerView && selection?.startsWith('owner:') &&
              <SelectItem value={selection}>{selection.slice('owner:'.length)} 전체</SelectItem>}
            {ownerView
              ? [...Map.groupBy(network.nodes, node => node.owner)].map(([owner, nodes]) =>
                <SelectGroup key={owner ?? ''}>
                  <SelectLabel>{owner || '소유주 미상'}</SelectLabel>
                  {owner && <SelectItem value={`owner:${owner}`}>{owner} 전체</SelectItem>}
                  {nodes.map(node => <SelectItem key={node.id} value={node.id}>{node.id}</SelectItem>)}
                </SelectGroup>)
              : <SelectGroup>
                <SelectLabel>계좌</SelectLabel>
                {network.nodes.map(node => <SelectItem key={node.id} value={node.id}>{node.id}</SelectItem>)}
              </SelectGroup>}
            <SelectGroup>
              <SelectLabel>연결</SelectLabel>
              {network.edges.map(edge => <SelectItem key={edge.id} value={edge.id}>{edge.source} → {edge.target}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Box>
      <Box className="preview-graph-hops">
        <Box as="label" htmlFor="case-graph-hops">선택 계좌 기준 연결 단계 (hop)</Box>
        <RangeInput id="case-graph-hops" min={hopSteps[0]} max={hopSteps.at(-1)} step={1}
          value={hops} aria-valuetext={`${hops}홉`} disabled={!anchor}
          aria-describedby={!anchor ? 'case-graph-hops-hint' : undefined}
          onChange={event => onHopsChange(Number(event.target.value))} />
        <Box className="preview-graph-hop-steps" aria-hidden="true">
          {hopSteps.map(step => <Text as="span" key={step} data-current={step === hops || undefined}>{step}</Text>)}
        </Box>
        {!anchor && <Text id="case-graph-hops-hint">계좌를 선택하면 범위를 조절할 수 있습니다.</Text>}
      </Box>
      <Heading level={4}>색상 · 모델 위험도</Heading>
      <Box as="ul" className="preview-graph-legend" aria-label="모델 위험도">
        {Object.entries(riskLegend()).map(([value, label]) =>
          <Box as="li" key={value}><Text as="i" className="preview-graph-risk-mark" data-graph-risk={value} aria-hidden="true" />{label}</Box>)}
      </Box>
      <Text className="preview-graph-lens-note">노드와 선의 색은 연결 거래의 최고 모델 점수입니다.</Text>
      <Text className="preview-graph-lens-note preview-graph-motion-note">빛이 송금 계좌에서 수취 계좌로 이동합니다.</Text>
    </Box>
  </Box>;
}

const flowRiskColor = ({ peakScore }) => `var(--case-graph-risk-${graphRiskBand(peakScore)})`;
const flowRiskLabel = ({ peakScore }) => graphRiskBand(peakScore) === 'unknown' ? '점수 없음' : `${peakScore}점`;
const instantChartTransition = { duration: 0 };

const flowAmount = (amount, currency) => `${formatAmount.format(amount)} ${currency}`;
const flowAmounts = amounts => [...amounts].sort(([a], [b]) => a.localeCompare(b));

function DirectTransferChart({ flow, layers, returnLinks, linkAction, flowPulse, playing, zoom }) {
  const { links, nodes } = flow;
  const lanes = Math.max(...layers.map(layer => layer.length)) + Math.min(returnLinks.size, 4);
  const root = getComputedStyle(document.documentElement);
  const space = step => Number.parseFloat(root.getPropertyValue(`--aml-space-${step}`));
  const side = space(64) + space(8);
  const amountRows = (label, amounts) => flowAmounts(amounts).map(([currency, amount]) => ({
    label: `${label} · ${currency}`, value: flowAmount(amount, currency), color: dataSeriesColors.teal,
  }));
  const scoreRow = entry => ({ label: '최고 모델 점수', value: flowRiskLabel(entry), color: flowRiskColor(entry) });
  const { offsetFor, nodeHandlers, activeId } = useSpringNodeDrag(zoom);
  const nodeOffset = index => offsetFor(nodes[index]?.name);
  return <Box as="figure" className="preview-graph-sankey" data-export-visualization style={{ '--sankey-lanes': lanes }}
    aria-label={`송금에서 수취로 · 계좌 ${nodes.length}개 · 경로 ${links.length}개`}>
    <Box as="figcaption">띠 두께 · 거래 건수</Box>
    <SankeyChart data={flow} layout={layoutCaseSankey}
      className="preview-graph-sankey-chart" aspectRatio="auto" interactionLabel="송금 → 수취 연결선 선택"
      margin={{ top: space(8), right: side, bottom: space(8), left: side }}
      nodeWidth={space(8)} nodePadding={space(16)}
      animationDuration={0} enterTransition={instantChartTransition}>
      <SankeyLink reveal={false} getLinkColor={flowRiskColor} getNodeOffset={nodeOffset}
        strokeOpacity={readChartNumber('--case-graph-sankey-link-opacity', 0.68)}
        linkAction={linkAction}
        renderLinkOverlay={(link, path, width) => {
          const pulseWidth = Math.max(2, Math.min(8, width * 0.28));
          if (flowPulse && link.codes.has(flowPulse.code)) {
            return <GraphFlowStroke key={flowPulse.startedAt} path={path} pulse={flowPulse}
              color={`var(--case-graph-risk-${flowPulse.risk})`} width={pulseWidth} />;
          }
          return playing || flowPulse ? null : <GraphFlowStroke path={path} color={flowRiskColor(link)}
            width={pulseWidth} ambientDelay={(link.index % 8) * .22} />;
        }} />
      <SankeyNode getNodeColor={flowRiskColor} lineCap={space(4)} showValueLabels={false}
        getGroupProps={index => {
          const name = nodes[index].name;
          const { x, y } = nodeOffset(index);
          return {
            ...nodeHandlers(name),
            'data-sankey-draggable': '',
            'data-sankey-dragging': activeId === name || undefined,
            transform: x || y ? `translate(${x} ${y})` : undefined,
          };
        }} />
      <SankeyTooltip className="preview-graph-sankey-tooltip" entrance={false} exit={false}
        nodeContent={({ node }) => <TooltipContent title={node.name}
          rows={[...amountRows('송금 합계', node.outgoing), ...amountRows('수취 합계', node.incoming), scoreRow(node)]} />}
        linkContent={({ link }) => <TooltipContent title={`${link.source.name} → ${link.target.name}`}
          rows={[{ label: '거래 건수', value: `${link.value}건`, color: flowRiskColor(link) },
            ...amountRows('송금액', link.amounts), scoreRow(link)]} />} />
    </SankeyChart>
  </Box>;
}

function CaseSankey({ rows, linkAction, controlsHost, flowPulse, playing }) {
  const flow = useMemo(() => caseSankeyGraph(rows), [rows]);
  const { layers, returnLinks } = useMemo(() => caseSankeyLayers(flow), [flow]);
  const viewport = useRef(null);
  const drag = useRef(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });

  function scaleBy(factor, point) {
    const view = viewport.current;
    const rect = view.getBoundingClientRect();
    const x = point ? point.clientX - rect.left : view.clientWidth / 2;
    const y = point ? point.clientY - rect.top : view.clientHeight / 2;
    setCamera(current => {
      const zoom = Math.max(.25, Math.min(3, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return { x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, zoom };
    });
  }

  useEffect(() => {
    const view = viewport.current;
    function wheel(event) {
      if (!event.deltaY) return;
      event.preventDefault();
      scaleBy(Math.exp(-event.deltaY * .008), event);
    }
    view.addEventListener('wheel', wheel, { passive: false });
    return () => view.removeEventListener('wheel', wheel);
  }, []);

  function finishDrag() {
    const view = viewport.current;
    if (!drag.current?.moved) drag.current = null;
    delete view.dataset.panning;
  }

  return <>
    <Box className="preview-graph-sankey-viewport" ref={viewport} tabIndex={0}
      role="region" aria-label="송금 흐름 그래프 · 방향키로 이동"
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        drag.current = {
          pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: camera.x, top: camera.y, moved: false,
        };
      }}
      onPointerMove={event => {
        const start = drag.current;
        const view = event.currentTarget;
        if (!start || start.pointerId !== event.pointerId || !event.buttons) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 5) return;
        if (!start.moved) {
          start.moved = true;
          view.dataset.panning = '';
          view.setPointerCapture(event.pointerId);
        }
        setCamera(current => ({ ...current, x: start.left + dx, y: start.top + dy }));
      }}
      onPointerUp={finishDrag} onLostPointerCapture={finishDrag}
      onPointerCancel={() => { drag.current = null; finishDrag(); }}
      onClickCapture={event => {
        if (!event.detail || !drag.current?.moved) return;
        drag.current = null;
        event.stopPropagation();
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction) return;
        event.preventDefault();
        setCamera(current => ({ ...current, x: current.x - direction[0] * 48, y: current.y - direction[1] * 48 }));
      }}>
      <Box className="preview-graph-sankey-flows" style={{
        '--case-graph-pan-x': `${camera.x}px`, '--case-graph-pan-y': `${camera.y}px`, '--case-graph-zoom': camera.zoom,
      }}>
        <Box className="preview-graph-sankey-layout" style={{ '--sankey-columns': layers.length }}>
          {flow.links.length
            ? <DirectTransferChart flow={flow} layers={layers} returnLinks={returnLinks} linkAction={linkAction}
              flowPulse={flowPulse} playing={playing} zoom={camera.zoom} />
            : <Text className="preview-graph-empty" role="status">현재 범위에 표시할 송금 거래가 없습니다.</Text>}
        </Box>
      </Box>
    </Box>
    {controlsHost && createPortal(<GraphZoomControls zoom={Math.round(camera.zoom * 100)}
      onZoom={scaleBy} onFit={() => {
        const view = viewport.current;
        const chart = view.querySelector('.preview-graph-sankey-layout');
        setCamera({ x: 0, y: 0, zoom: Math.min(1, view.clientWidth / chart.offsetWidth) });
      }} />, controlsHost)}
  </>;
}

function AccountBreakdown({ rows, linkedSelection, selectionControl }) {
  const [owner, setOwner] = useState('all');
  const [range, setRange] = useState();
  const accounts = new Map();
  const owners = [...new Set(rows.flatMap(row => [row.from.owner, row.to.owner]))].sort();
  const activeOwner = owners.includes(owner) ? owner : 'all';
  for (const row of rows.filter(record => inDateRange(dateFromCode(record.code), range))) {
    for (const [party, direction] of [[row.from, 'sent'], [row.to, 'received']]) {
      if (activeOwner !== 'all' && party.owner !== activeOwner) continue;
      const account = accounts.get(party.code) ?? {
        ...party, sent: new Map(), received: new Map(), sentCount: 0, receivedCount: 0,
      };
      account[`${direction}Count`] += 1;
      account[direction].set(row.currency, (account[direction].get(row.currency) ?? 0) + row.amount);
      accounts.set(party.code, account);
    }
  }
  const money = totals => [...totals].sort(([a], [b]) => a.localeCompare(b))
    .map(([code, value]) => `${formatAmount.format(value)} ${code}`).join(' · ') || '—';
  const accountRows = [...accounts.values()].map(account => ({
    ...account,
    net: new Map([...new Set([...account.sent.keys(), ...account.received.keys()])].map(currency => [
      currency, (account.received.get(currency) ?? 0) - (account.sent.get(currency) ?? 0),
    ])),
  }));
  const sorting = useTableSort(accountRows);
  const selection = useTableSelection(sorting.rows, undefined, linkedSelection, selectionControl);
  const lastCode = rows.map(row => row.code).sort().at(-1);
  const actions = {
    filter: owners.length > 1 ? { label: '소유주', value: activeOwner, onChange: setOwner,
      options: ['전체', ...owners].map((label, index) => ({ label, value: index ? label : 'all' })) } : undefined,
    period: lastCode ? { asOf: dateFromCode(lastCode), range, onChange: setRange } : undefined,
    entries: sorting.rows.length ? [csvDownloadEntry('표시 중인 연결 계좌', 'linked-accounts',
      ['계좌', '소유주', '수취 건수', '수취 합계', '송금 건수', '송금 합계', '순유입'],
      sorting.rows.map(account => [account.code, account.owner, account.receivedCount, money(account.received),
        account.sentCount, money(account.sent), money(account.net)]))] : [],
  };
  const totalAccounts = new Set(rows.flatMap(row => [row.from.code, row.to.code])).size;
  return <WorkflowTable label="연결 계좌" selection={selection} summary={tableCount(accounts.size, totalAccounts, '개', selection.selectedCount)}
    tools={lastCode ? <TableQueryTools actions={actions} /> : false}>
      <TableHeader><TableRow>
        <SortableTableHead sorting={sorting} column="account" value={row => row.code}>계좌</SortableTableHead>
        <SortableTableHead sorting={sorting} column="owner" value={row => row.owner}>소유주</SortableTableHead>
        <SortableTableHead sorting={sorting} column="incomingCount" value={row => row.receivedCount}>수취 건수</SortableTableHead>
        <SortableTableHead sorting={sorting} column="incoming" {...currencyColumn(row => Object.fromEntries(row.received))}>수취 합계</SortableTableHead>
        <SortableTableHead sorting={sorting} column="outgoingCount" value={row => row.sentCount}>송금 건수</SortableTableHead>
        <SortableTableHead sorting={sorting} column="outgoing" {...currencyColumn(row => Object.fromEntries(row.sent))}>송금 합계</SortableTableHead>
        <SortableTableHead sorting={sorting} column="net" {...currencyColumn(row => Object.fromEntries(row.net))}>순유입</SortableTableHead>
      </TableRow></TableHeader>
      <TableBody>{sorting.rows.map(account => <TableRow key={account.code} data-selected={selection.has(account.code) || undefined}>
        <TableRowHead><Text as="code">{account.code}</Text></TableRowHead><TableCell>{account.owner}</TableCell>
        <TableCell>{formatAmount.format(account.receivedCount)}</TableCell><TableCell>{money(account.received)}</TableCell>
        <TableCell>{formatAmount.format(account.sentCount)}</TableCell><TableCell>{money(account.sent)}</TableCell>
        <TableCell>{money(account.net)}</TableCell>
      </TableRow>)}
      {!sorting.rows.length && <TableRow><TableCell colSpan={7}>현재 표시 범위에 계좌가 없습니다.</TableCell></TableRow>}
      </TableBody>
    </WorkflowTable>;
}

function ComparisonEvidence({ active, candidates }) {
  const comparisons = candidates.map(candidate => ({ code: candidate.code, ...sharedCaseEvidence(active, candidate) }));
  const downloads = comparisons.length ? [csvDownloadEntry('연결 근거', 'comparison-evidence',
    ['기준 업무', '비교 업무', '공통 거래', '공통 계좌'], comparisons.map(({ code, transactions, accounts }) =>
      [active.code, code, transactions.join(' · '), accounts.join(' · ')]))] : [];
  return <Panel className="preview-comparison-evidence">
    <SectionDownloadHeading entries={downloads}>연결 근거</SectionDownloadHeading>
    {comparisons.length ? comparisons.map(({ code, transactions, accounts }) =>
      <Box as="section" key={code}>
        <Heading level={3}><LinkTag code={code} /></Heading>
        <Box as="dl"><Box><Box as="dt">공통 거래</Box><Box as="dd">{transactions.join(', ') || '없음'}</Box></Box>
          <Box><Box as="dt">공통 계좌</Box><Box as="dd">{accounts.join(', ') || '없음'}</Box></Box></Box>
      </Box>) : <Text>후보를 선택하면 공통 거래와 계좌가 표시됩니다.</Text>}
  </Panel>;
}

const candidateDropType = 'application/x-aml-case-id';
const workspaceGraphSelections = new WeakMap();

function CaseGraph({ active, candidates, lens, related, evidenceHost, accountsHost, caseGraphSelections, evidenceSelection, onComparedCases }) {
  const bundleNoticeHost = useRef(null);
  const selectedEvidence = useCaseEvidenceSelection(evidenceSelection);
  const alertTransactions = useMemo(() => new Set(active?.related.map(row => row.code)), [active]);
  const ownerView = lens === 'owner';
  const sankeyView = lens === 'sankey';
  const scopeKey = active?.code ? `${active.code}:${related ? 'related' : 'analysis'}` : undefined;
  const initialSelection = caseGraphSelections.get(scopeKey);
  const [candidateIds, setCandidateIds] = useState(() => initialSelection?.candidateIds ?? new Set());
  const [hiddenCases, setHiddenCases] = useState(() => initialSelection?.hiddenCases ?? new Set());
  const [highlightedCase, setHighlightedCase] = useState(initialSelection?.highlightedCase);
  const [selection, setSelection] = useState(initialSelection?.selection);
  const [selectedCodes, setSelectedCodes] = useState(initialSelection?.selectedCodes);
  const [tablePicks, setTablePicks] = useState(() => initialSelection?.tablePicks ?? new Map());
  const [hops, setHops] = useState(initialSelection?.hops ?? 3);
  const [showDetails, setShowDetails] = useState(initialSelection?.showDetails ?? true);
  useLayoutEffect(() => {
    if (!scopeKey) return;
    if (candidateIds.size || hiddenCases.size || highlightedCase || selection || tablePicks.size || hops !== 3 || !showDetails) {
      caseGraphSelections.set(scopeKey, { candidateIds, hiddenCases, highlightedCase, selection, selectedCodes, tablePicks, hops, showDetails });
    } else {
      caseGraphSelections.delete(scopeKey);
    }
  }, [caseGraphSelections, scopeKey, candidateIds, hiddenCases, highlightedCase, selection, selectedCodes, tablePicks, hops, showDetails]);
  const settingsId = useId();
  const [through, setThrough] = useState();
  const [playing, setPlaying] = useState(false);
  const [flowPulse, setFlowPulse] = useState();
  const [controlsHost, setControlsHost] = useState(null);
  const [draggingCase, setDraggingCase] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState();
  const candidatesByCode = useMemo(() => new Map(candidates.map(candidate => [candidate.record.code, candidate])), [candidates]);
  const candidateRows = useMemo(() => candidates.map(({ record }) => record), [candidates]);
  const visibleCandidates = candidateQuery
    ? visibleCaseRows(candidateRows, candidateQuery).map(row => candidatesByCode.get(row.code)) : candidates;
  const compared = useMemo(() => candidates.filter(({ record }) => candidateIds.has(record.code)).map(({ record }) => record),
    [candidates, candidateIds]);
  useLayoutEffect(() => {
    if (related) onComparedCases?.(compared, bundleNoticeHost.current);
  }, [related, compared, onComparedCases]);
  const comparedCases = useMemo(() => [active, ...compared].filter(Boolean), [active, compared]);
  const groups = useMemo(() => related ? comparedCases.map(record => ({
    id: record.code, transactionIds: new Set(record.related.map(row => row.code)),
    color: caseGroupColor(record === active ? 0 : candidates.findIndex(item => item.record.code === record.code) + 1),
  })) : [], [active, candidates, comparedCases, related]);
  const shownGroups = useMemo(() => groups.filter(group => group.id === active?.code || !hiddenCases.has(group.id)),
    [active, groups, hiddenCases]);
  const transactions = useMemo(() => mergeCaseTransactions(comparedCases.filter(record => record === active || !hiddenCases.has(record.code))),
    [active, comparedCases, hiddenCases]);
  const cursor = casePlaybackCursor(transactions, through);
  const current = useMemo(() => transactions.slice(0, cursor), [transactions, cursor]);
  const network = useMemo(() => buildCaseNetwork(transactions), [transactions]);
  const accountLayout = useMemo(() => lens === 'pattern' ? caseAccountLayout(network, active?.pattern) : undefined,
    [lens, network, active?.pattern]);
  const currentGraph = useMemo(() => buildCaseNetwork(current), [current]);
  const hasOwnerScope = selection?.startsWith('owner:') ?? false;
  const ownerNodes = useMemo(() => hasOwnerScope ? buildCaseNetwork(current, true).nodes.filter(node => node.owner) : [],
    [current, hasOwnerScope]);
  const ownerAnchor = ownerNodes.find(node => `owner:${node.id}` === selection);
  const anchor = ownerAnchor ?? currentGraph.nodes.find(node => node.id === selection);
  const selectedEdge = currentGraph.edges.find(edge => edge.id === selection);
  const selected = anchor ?? selectedEdge;
  const scopedRows = useMemo(() => anchor ? transactionsWithinHops(current, anchor.id, hops, Boolean(ownerAnchor)) : current,
    [anchor, current, hops, ownerAnchor]);
  const visible = useMemo(() => anchor ? buildCaseNetwork(scopedRows) : currentGraph,
    [anchor, scopedRows, currentGraph]);
  const shownCases = useMemo(() => new Set(caseMembership(shownGroups,
    new Set(visible.edges.flatMap(edge => [...edge.codes])))), [shownGroups, visible]);
  const shownHighlight = shownCases.has(highlightedCase) ? highlightedCase : undefined;
  const emphasizedTransactions = groups.find(group => group.id === shownHighlight)?.transactionIds;
  const scopedFlowPulse = flowPulse && scopedRows.some(row => row.code === flowPulse.code)
    && (!emphasizedTransactions || emphasizedTransactions.has(flowPulse.code)) ? flowPulse : undefined;
  const evidence = useMemo(() => selectedEdge
    ? scopedRows.filter(row => selectedEdge.codes.has(row.code) && (!selectedCodes || selectedCodes.has(row.code)))
    : scopedRows, [selectedEdge, selectedCodes, scopedRows]);
  const graphSelection = graphTableSelection(current, selected, selectedCodes);
  const linkedSelection = related ? undefined : graphSelection;
  const select = (id, codes) => {
    setSelection(id);
    setSelectedCodes(codes);
  };
  const activateNode = id => {
    const pickedInTable = tablePicks.get(id) === 'accounts';
    if (selection === id) select();
    else if (!pickedInTable) select(id);
    if (pickedInTable) {
      setTablePicks(previous => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
    }
  };
  const pickedAccounts = new Set();
  const pickedTransactions = new Set(selectedEvidence);
  const edgesByCode = new Map();
  for (const edge of visible.edges) {
    for (const code of edge.codes) edgesByCode.set(code, edge);
  }
  const selectedIds = new Set(selected ? [selection] : []);
  if (ownerAnchor) for (const code of ownerAnchor.accounts) selectedIds.add(code);
  let tableTarget;
  for (const [code, type] of tablePicks) {
    const accountPick = type === 'accounts';
    if (!accountPick && evidenceSelection && alertTransactions.has(code)) continue;
    (accountPick ? pickedAccounts : pickedTransactions).add(code);
    const target = accountPick ? visible.nodes.find(node => node.id === code) : edgesByCode.get(code);
    if (!target) continue;
    selectedIds.add(target.id);
    tableTarget = target;
  }
  for (const code of selectedEvidence) {
    const target = edgesByCode.get(code);
    if (!target) continue;
    selectedIds.add(target.id);
    tableTarget = target;
  }
  const hasSelection = Boolean(selected || tableTarget);
  const peakScore = hasSelection ? evidence.reduce((peak, row) => {
    const included = graphSelection ? graphSelection.transactions.has(row.code)
      : pickedTransactions.has(row.code) || pickedAccounts.has(row.from.code) || pickedAccounts.has(row.to.code);
    return included && graphRiskBand(row.score) !== 'unknown' ? Math.max(peak, row.score) : peak;
  }, -Infinity) : -Infinity;
  const peakRisk = graphRiskBand(peakScore);
  const linkAction = ({ source, target, value, codes, peakScore, amounts, verdicts }) => {
    const edgeId = `${source.name}>${target.name}`;
    const activeLink = selection === edgeId && (!selectedCodes || [...codes].every(code => selectedCodes.has(code)));
    return {
      label: [`${source.name} → ${target.name}`, `${value}건`, ...flowAmounts(amounts).map(([currency, amount]) => flowAmount(amount, currency)),
        graphVerdictLabels[graphVerdict(verdicts)], `최고 모델 점수 ${flowRiskLabel({ peakScore })}`].join(' · '),
      selected: activeLink || [...codes].some(code => pickedTransactions.has(code)),
      emphasized: emphasizedTransactions && [...codes].some(code => emphasizedTransactions.has(code)),
      activate: () => activeLink ? select() : select(edgeId, codes),
    };
  };
  const selectionControl = (type, picks) => ({
    selected: picks,
    change(keys, checked) {
      const alertCodes = type === 'transactions' && evidenceSelection
        ? keys.filter(code => alertTransactions.has(code)) : [];
      if (alertCodes.length) evidenceSelection.change(alertCodes, checked);
      const graphKeys = alertCodes.length ? keys.filter(code => !alertTransactions.has(code)) : keys;
      if (graphKeys.length) setTablePicks(previous => {
        const next = new Map(previous);
        for (const code of graphKeys) {
          if (checked) next.set(code, type);
          else next.delete(code);
        }
        return next;
      });
      if (checked || keys.some(code => linkedSelection?.[type].has(code))) select();
    },
  });
  const clearSelection = () => {
    evidenceSelection?.clear();
    setTablePicks(new Map());
    select();
  };
  useEffect(() => {
    if (!playing || cursor >= transactions.length) return;
    const timer = setTimeout(() => {
      const row = transactions[cursor];
      setFlowPulse({ code: row.code, risk: graphRiskBand(row.score), startedAt: performance.now() });
      setThrough(cursor + 1 < transactions.length ? row : undefined);
      if (cursor + 1 >= transactions.length) setPlaying(false);
    }, 650);
    return () => clearTimeout(timer);
  }, [playing, cursor, transactions]);
  useEffect(() => {
    if (!flowPulse) return;
    const timer = setTimeout(() => setFlowPulse(undefined),
      Math.max(0, readGraphFlowDuration() - (performance.now() - flowPulse.startedAt)));
    return () => clearTimeout(timer);
  }, [flowPulse]);
  const updateCandidate = (record, include) => {
    setCandidateIds(previous => {
      if (previous.has(record.code) === include) return previous;
      const next = new Set(previous);
      if (include) next.add(record.code);
      else next.delete(record.code);
      return next;
    });
    if (include && hiddenCases.has(record.code)) setCaseVisible(record.code, true);
    if (!include && selected && !comparedCases.some(entry => entry.code !== record.code &&
        entry.related.some(row => (selectedCodes ?? selected.codes).has(row.code)))) select();
    if (!include && highlightedCase === record.code) setHighlightedCase(undefined);
  };
  function setCaseVisible(id, visible) {
    if (id === active?.code) return;
    setHiddenCases(previous => {
      const next = new Set(previous);
      if (visible) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const dragCandidate = (event, code) => {
    event.dataTransfer.setData(candidateDropType, code);
    event.dataTransfer.effectAllowed = 'copy';
    setDraggingCase(true);
  };
  const acceptCandidate = event => {
    if (!event.dataTransfer.types.includes(candidateDropType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const dropCandidate = event => {
    if (!event.dataTransfer.types.includes(candidateDropType)) return;
    event.preventDefault();
    setDraggingCase(false);
    const candidate = candidates.find(({ record }) => record.code === event.dataTransfer.getData(candidateDropType));
    if (candidate) updateCandidate(candidate.record, true);
  };
  const seek = next => {
    setFlowPulse(undefined);
    setThrough(next === transactions.length ? undefined : next ? transactions[next - 1] : null);
    select();
    setPlaying(false);
  };
  const play = () => {
    setFlowPulse(undefined);
    if (cursor === transactions.length) {
      setThrough(null);
      select();
      setPlaying(true);
    } else {
      setPlaying(!playing);
    }
  };
  return <>
    {related && <Panel className="preview-related-cases">
      <Box className="preview-related-heading">
        <Heading>{active?.kind === 'Episode' ? '추가 후보 Alert' : '연관 후보'}
          <CountTag count={visibleCandidates.length} total={candidates.length} /></Heading>
        <LocalQueryTools relatedRows={candidateRows} onRelatedQuery={setCandidateQuery} />
      </Box>
      <Box className="related-bundle-notice" ref={bundleNoticeHost} />
      {compared.length > 0 && <Text className="preview-graph-scope-label" role="status">그래프에서 {compared.length}건 비교 중</Text>}
      {visibleCandidates.length ? <Box as="ul">{visibleCandidates.map(({ record, sharedTransactions, sharedAccounts }) =>
        <Box as="li" className="list-item-enter" key={record.code}>
          <PreviewCaseCard row={record} sharedEvidence={{ transactions: sharedTransactions, accounts: sharedAccounts }}
            drag={{ onDragStart: event => dragCandidate(event, record.code), onDragEnd: () => setDraggingCase(false) }}
            selection={{ label: `${record.code} 그래프에서 비교`,
            checked: candidateIds.has(record.code), onChange: checked => updateCandidate(record, checked) }} />
        </Box>)}</Box> : <Text>{candidates.length ? '조회 조건에 맞는 후보가 없습니다.' : '공통 거래나 계좌가 확인된 업무가 없습니다.'}</Text>}
    </Panel>}
    <Panel embedded className="preview-case-network" aria-label={related ? '합친 그래프' : '그래프'}>
      {network.nodes.length || groups.length ?
        <Box className="preview-graph-workspace">
          <Box className="preview-graph-center" data-visualization={sankeyView && network.nodes.length ? 'sankey' : undefined}
            data-case-drop-active={draggingCase || undefined} onDragOver={related ? acceptCandidate : undefined}
            onDrop={related ? dropCandidate : undefined}>
            <Box as="header" className="preview-graph-center-heading">
              <GraphSettings id={settingsId} groups={groups}
                showDetails={showDetails} onDetailsChange={setShowDetails} ownerView={ownerView} sankeyView={sankeyView} anchor={anchor} hops={hops}
                onHopsChange={setHops} network={currentGraph} selection={selected ? selection : tableTarget?.id} onSelect={select}
                showSankeySample={sankeyView && active?.code !== complexSankeySampleCode}
                shownCases={shownCases} highlightedCase={shownHighlight}
                hiddenCases={hiddenCases} onVisibilityChange={setCaseVisible}
                accountCount={visible.nodes.length}
                ownerCount={ownerView ? new Set(visible.nodes.map(node => node.owner).filter(Boolean)).size : undefined}
                patternLayout={accountLayout?.kind}
                onHighlight={id => setHighlightedCase(previous => previous === id ? undefined : id)} />
              <Box className="preview-graph-metadata">
                {hasSelection && <Box className="semantic-tag-group">
                  <Text as="span" className="preview-graph-scope-label">선택 범위 최고</Text>
                  {peakRisk === 'unknown' ? <Text as="span" className="preview-graph-scope-label">모델 점수 없음</Text>
                    : <ModelScoreTag band={peakRisk} score={peakScore} />}
                </Box>}
                {(selected || tablePicks.size > 0) &&
                  <GraphIconButton label="그래프 선택 해제" icon={X} onClick={clearSelection} />}
                {network.nodes.length > 0 && <ChartSectionDownload label="거래 그래프" surface="floating"
                  readRoot={host => host.closest('.preview-graph-center')} />}
              </Box>
            </Box>
            {!network.nodes.length ? <Box className="preview-evidence-canvas preview-graph-empty" role="status">
              <Text>그래프에 표시할 거래가 없습니다.</Text>
            </Box> : sankeyView
              ? <CaseSankey rows={scopedRows} linkAction={linkAction} controlsHost={controlsHost} flowPulse={scopedFlowPulse} playing={playing} />
              : ownerView
              ? <OwnerGraphTimeline records={transactions} visible={scopedRows} selection={selected ? selection : undefined}
                selectedCodes={selectedCodes} selectedAccounts={pickedAccounts} selectedTransactions={pickedTransactions}
                onNodeSelect={activateNode} onSelect={select} controlsHost={controlsHost}
                groups={shownGroups} showDetails={showDetails} highlightedCase={shownHighlight} flowPulse={scopedFlowPulse} playing={playing} />
              : <ForceCaseCanvas network={network} visible={visible} records={transactions}
                selection={selectedIds} onNodeSelect={activateNode} onSelect={select} controlsHost={controlsHost} groups={shownGroups}
                positions={accountLayout?.positions}
                showDetails={showDetails} highlightedCase={shownHighlight} flowPulse={scopedFlowPulse} playing={playing} />}
            {network.nodes.length > 0 && <Box className="preview-graph-actions">
              <GraphPlayback records={transactions} cursor={cursor} playing={playing && cursor < transactions.length} onPlay={play} onSeek={seek} />
              <Box className="preview-graph-controls" ref={setControlsHost} />
            </Box>}
          </Box>
        </Box>
      : <Box className="preview-graph-empty">
        <Text>그래프로 표시할 거래가 없습니다.</Text>
      </Box>}
    </Panel>
    {related && <ComparisonEvidence active={active} candidates={compared} />}
    {evidenceHost && createPortal(<TransactionEvidenceTable title={evidenceHost.dataset.caseEvidence}
      transactions={evidence} analysis={!related}
      linkedSelection={evidenceSelection ? undefined : linkedSelection?.transactions}
      highlightedCodes={evidenceSelection ? linkedSelection?.transactions : undefined}
      selectionControl={selectionControl('transactions', pickedTransactions)} />, evidenceHost)}
    {accountsHost && createPortal(<AccountBreakdown rows={evidence} linkedSelection={linkedSelection?.accounts}
      selectionControl={selectionControl('accounts', pickedAccounts)} />, accountsHost)}
  </>;
}

export function mountCaseGraph(host, { active, cases, evidenceSelection, onComparedCases }) {
  const root = createRoot(host);
  const workspace = host.closest('#workspace') ?? host.parentElement ?? host;
  if (!workspaceGraphSelections.has(workspace)) workspaceGraphSelections.set(workspace, new Map());
  const caseGraphSelections = workspaceGraphSelections.get(workspace);
  const related = host.dataset.caseFlow === 'related';
  const evidenceHost = host.nextElementSibling?.matches('[data-case-evidence]') ? host.nextElementSibling : undefined;
  const accountsHost = evidenceHost?.nextElementSibling?.matches('[data-case-accounts]') ? evidenceHost.nextElementSibling : undefined;
  let caseData;
  const render = () => root.render(<CaseGraph {...caseData}
    related={related} lens={host.dataset.lens ?? 'pattern'} evidenceHost={evidenceHost} accountsHost={accountsHost}
    caseGraphSelections={caseGraphSelections} evidenceSelection={evidenceSelection} onComparedCases={onComparedCases} />);
  const update = ({ active, cases }) => {
    caseData = { active, candidates: related && active ? casesSharingEvidence(active, cases) : [] };
    render();
  };
  update({ active, cases });
  return Object.assign(() => root.unmount(), { update, render });
}
