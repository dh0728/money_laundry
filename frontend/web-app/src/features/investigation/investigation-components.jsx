import React, { useLayoutEffect, useMemo, useRef, useSyncExternalStore, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SearchField } from '../../components/search-field';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { TableBody, TableCell, TableColumns, TableHead, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { DataTableSkeletonRows } from '@/components/data-table/data-table-skeleton';
import { CardHeader } from '../../components/card-header';
import { RecordCard, recordCardSurface } from '../../components/record-card';
import { CountTag, LinkTag, ModelScoreTag, PatternTag, ReviewStatusTag, StatusTag, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user.js';
import { createSampleLedgerSource, createServerLedgerSource, useDebouncedValue, useLedgerList } from './ledger-source';
import { CaseProgressBoard, PreviewCaseCard } from './preview-case-card';
import { dashboardFixtures } from '../../mocks/dashboard-fixtures';
import { ActionButton, WorkTabAddButton } from '../../components/primary-button';
import AnimatedList from '../../components/react-bits/AnimatedList';
import { BorderGlowEdge } from '../../components/react-bits/BorderGlow';
import { TableBranchToggle, TableFieldLabel, TableRecordCell, WorkflowTable } from '../../components/workflow-table';
import { csvDownloadEntry, TableQueryTools } from '../../components/query-controls';
import { SectionDownload, SectionDownloadHeading } from '../../components/section-download';
import './investigation-components.css';
import { Box, Text } from '@/components/layout-primitives';
import { FlowConnectionOverlay, TransactionDirectionArrow } from '@/components/charts/charts/transaction-flow-graphics';
import { LedgerPaneSkeleton } from './investigation-skeletons';

export { sampleTransactions } from '../../mocks/transaction-fixtures';
const amountFormat = new Intl.NumberFormat('ko-KR');

const readReducedMotion = () => document.documentElement.dataset.reducedMotion === 'true';

function subscribeAppearance(notify) {
  document.addEventListener('aml:appearance', notify);
  return () => document.removeEventListener('aml:appearance', notify);
}

function linkedCaseEntries(caseRows, transaction, kind) {
  return [...caseRows.values()]
    .filter(row => (!kind || row.kind === kind) && row.related.some(record => record.code === transaction.code));
}

function visibleRowCenter(row, viewport) {
  const center = (row.top + row.bottom) / 2;
  return center >= viewport.top && center <= viewport.bottom ? center : null;
}

function LedgerConnections({ owner, account, transaction, version }) {
  const overlayRef = useRef(null);
  const [paths, setPaths] = useState([]);
  useLayoutEffect(() => {
    const ledger = overlayRef.current.parentElement;
    const lists = ['owners', 'accounts', 'transactions'].map(name => {
      const viewport = ledger.querySelector(`.ledger-${name} .animated-list__viewport`);
      return { viewport, rows: Array.from(viewport?.querySelectorAll('[data-index][data-state]') ?? []) };
    });
    const relations = [
      { name: 'owner', source: lists[0], target: lists[1], index: owner, selected: account },
      { name: 'account', source: lists[1], target: lists[2], index: account, selected: transaction },
    ];
    let frame = 0;
    let previous = '';
    const moving = new Set();
    const measure = () => {
      frame = 0;
      const bounds = ledger.getBoundingClientRect();
      const next = [];
      for (const { name, source, target, index, selected } of relations) {
        if (!source.viewport || !target.viewport) continue;
        const sourceItem = source.rows[index];
        if (sourceItem?.dataset.state !== 'in') continue;
        const sourceRow = sourceItem.getBoundingClientRect();
        const sourceCenter = visibleRowCenter(sourceRow, source.viewport.getBoundingClientRect());
        const targetBounds = target.viewport.getBoundingClientRect();
        // A folded column is a separate row of the layout. Leave its card content clear.
        if (sourceCenter === null || targetBounds.left <= sourceRow.right) continue;
        const startX = sourceRow.right - bounds.left;
        const startY = sourceCenter - bounds.top;
        target.rows.forEach((item, targetIndex) => {
          if (item.dataset.state !== 'in') return;
          const row = item.getBoundingClientRect();
          const center = visibleRowCenter(row, targetBounds);
          if (center === null) return;
          const endX = row.left - bounds.left;
          const endY = center - bounds.top;
          const bend = (endX - startX) * 0.55;
          const d = `M ${startX} ${startY} C ${startX + bend} ${startY} ${endX - bend} ${endY} ${endX} ${endY}`;
          next.push({ name, targetIndex, active: targetIndex === selected, d });
        });
      }
      next.sort((left, right) => Number(left.active) - Number(right.active));
      const signature = JSON.stringify(next);
      if (signature !== previous) {
        previous = signature;
        setPaths(next);
      }
      if (moving.size) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const trackMovement = event => {
      if (event.propertyName !== 'transform' || !event.target.matches('.animated-list__item')) return;
      if (event.type === 'transitionrun') moving.add(event.target);
      else moving.delete(event.target);
      schedule();
    };
    const transitionEvents = ['transitionrun', 'transitionend', 'transitioncancel'];
    const observer = new ResizeObserver(schedule);
    observer.observe(ledger);
    for (const { viewport, rows } of lists) {
      if (viewport) observer.observe(viewport);
      rows.forEach(row => observer.observe(row));
    }
    ledger.addEventListener('scroll', schedule, true);
    transitionEvents.forEach(event => ledger.addEventListener(event, trackMovement));
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      ledger.removeEventListener('scroll', schedule, true);
      transitionEvents.forEach(event => ledger.removeEventListener(event, trackMovement));
    };
  }, [owner, account, transaction, version]);
  return <FlowConnectionOverlay ref={overlayRef} connections={paths} />;
}

function List({ label, items, selected, onSelect, reduced, renderItem, renderItemHeader, itemData, className = '' }) {
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const viewport = listRef.current.querySelector('.animated-list__viewport');
    const item = viewport.querySelector('[aria-selected="true"]');
    if (!item) return;
    const range = viewport.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < range.top) viewport.scrollTop += row.top - range.top;
    else if (row.bottom > range.bottom) viewport.scrollTop += row.bottom - range.bottom;
  }, [selected]);
  return <Box ref={listRef} className={`ledger-scroll-shell ${className}`}>
    <AnimatedList ariaLabel={label} items={items} initialSelectedIndex={selected} renderItem={renderItem} itemData={itemData}
      itemClassName={itemData ? 'border-glow-card border-glow-card--record' : undefined}
      viewportClassName={itemData ? 'record-card-scroll' : undefined}
      itemDecoration={itemData ? <BorderGlowEdge /> : undefined}
      renderItemHeader={renderItemHeader} selectOnHover={false}
      animation={reduced ? 'none' : renderItemHeader ? 'fade' : 'pop'} stagger={0.035} animateOnce showGradients={false} frame={false}
      displayScrollbar width="100%" maxHeight="var(--ledger-list-limit, var(--workspace-list-limit))"
      accentColor="var(--focus-ring)" onItemSelect={onSelect} surface="ledger" />
  </Box>;
}

function LedgerHeading({ as: Heading = 'h2', id, title, count, total, suffix, entry }) {
  return <Box className="ledger-panel-heading">
    <Heading id={id}>{title}</Heading><CountTag count={count} total={total} unit={suffix} />
    {entry && !entry.disabled && <SectionDownload label={entry.label} entries={[entry]} />}
  </Box>;
}

function TransactionParty({ party, label, direction, verdict }) {
  return <Box className={`ledger-party ledger-party--${direction}`} data-account-verdict={verdict}>
    <Text as="span" className="screen-title-accessible">{label} · {verdictLabels[verdict]}</Text>
    <Text as="span">{party.owner}</Text>
    <Text as="code">{party.code}</Text>
  </Box>;
}

export function TransactionHeader({ record, onAction }) {
  return record.openable === false ? <CardHeader code={record.code} openRecord={false} showAdd={false} />
    : <CardHeader code={record.code} onAction={onAction} />;
}

export function TransactionFlow({ record }) {
  const sourceVerdict = record.from.verdict ?? record.verdict ?? 'unjudged';
  const destinationVerdict = record.to.verdict ?? record.verdict ?? 'unjudged';
  const sender = <TransactionParty party={record.from} label="송금 계좌" direction="source" verdict={sourceVerdict} />;
  const recipient = <TransactionParty party={record.to} label="수취 계좌" direction="destination" verdict={destinationVerdict} />;
  return <Box className="ledger-transaction-flow">
    {record.incoming ? recipient : sender}
    <Box className="ledger-transaction-details">
      <Text as="time" dateTime={`${record.timestamp.replace(' ', 'T')}+09:00`}>{record.timestamp}</Text>
      <TransactionDirectionArrow incoming={record.incoming} sourceVerdict={sourceVerdict} destinationVerdict={destinationVerdict} />
      <Text as="span">{record.method} · <Text as="strong">{amountFormat.format(record.amount)} {record.currency}</Text></Text>
    </Box>
    {record.incoming ? sender : recipient}
  </Box>;
}

export function TransactionRow({ record }) {
  return <Box className="ledger-transaction">
    <Box className="semantic-tag-group">
      <VerdictTag verdict={record.verdict} />
      {record.status && <ReviewStatusTag status={record.status} />}
      <StatusTag preset="neutral">{record.incoming ? '수취' : '송금'}</StatusTag>
    </Box>
    <TransactionFlow record={record} />
  </Box>;
}

export function TransactionCard({ record, onAction }) {
  return <RecordCard className="ledger-transaction-card" label={record.code} verdict={record.verdict} opensRecord>
    <TransactionHeader record={record} onAction={onAction} />
    <Box className="animated-list__item-content"><TransactionRow record={record} /></Box>
  </RecordCard>;
}

function CaseList({ entries, transaction }) {
  return <Box className="case-list record-card-scroll">
    {entries.map(row =>
      <Box className="list-item-enter" key={row.code}>
        <PreviewCaseCard row={row} selectedTransaction={transaction} />
      </Box>)}
  </Box>;
}

const serverCaseCode = (kind, id) => `${kind === 'Alert' ? 'A' : 'E'}-${id}`;
const serverCaseIds = (transaction, kind) => (kind === 'Alert' ? transaction.alertIds : transaction.episodeIds) ?? [];

function LinkedCaseGroups({ transaction, caseRows }) {
  const linked = linkedCaseRecords(transaction, caseRows);
  return <Box className="ledger-case-groups">
    {['Alert', 'Episode'].map(label => {
      const entries = linked.filter(row => row.kind === label);
      const entry = linkedCasesDownload(entries, `연결 ${label}`, `linked-${label.toLowerCase()}`);
      if (!caseRows) {
        return <Box as="section" key={label} aria-label={`연결 ${label} ${entries.length}건`}>
          <LedgerHeading as="h3" title={label} count={entries.length} suffix="건" entry={entry} />
          {entries.length ? <Box as="ul" className="ledger-linked-ids">
            {entries.map(row => <Box as="li" key={row.code}><Text as="code">{row.code}</Text></Box>)}
          </Box> : <Text className="ledger-empty">연결된 {label} 없음</Text>}
        </Box>;
      }
      return <Box as="section" key={label} aria-label={`연결 ${label} ${entries.length}건`}>
        <LedgerHeading as="h3" title={label} count={entries.length} suffix="건" entry={entry} />
        {entries.length ? <CaseList entries={entries} transaction={transaction} />
          : <Text className="ledger-empty">연결된 {label} 없음</Text>}
      </Box>;
    })}
  </Box>;
}

const ledgerColumns = [
  ['owner', '소유주', 11], ['account', '계좌', 12], ['거래 ID', '거래 ID', 19], ['시각', '시각', 14], ['방향', '방향', 7],
  ['상대 계좌', '상대 계좌', 11], ['금액', '금액', 10], ['결제 수단', '결제 수단', 9], ['판정', '판정', 7],
];
const linkedCaseColumns = [
  ['ID', '업무 ID'], ['kind', '구분'], ['pattern', '패턴'], ['score', '모델 점수'],
  ['status', '업무 상태'], ['verdict', '판정'], ['거래 건수', '근거 거래'],
];
const transactionDirection = record => record.incoming ? '수취' : '송금';
const counterpartyCode = record => (record.incoming ? record.from : record.to).code;

const ownerDownload = owners => csvDownloadEntry('불러온 소유주', 'ledger-owners', ['소유주 ID', '소유주'],
  owners.map(row => [row.id, row.name]));
const accountDownload = accounts => csvDownloadEntry('불러온 계좌', 'ledger-accounts', ['계좌 ID', '표시 계좌', '소유주', '은행 코드'],
  accounts.map(row => [row.id, row.label, row.ownerName, row.bankId]));
const transactionDownload = (records, account) => csvDownloadEntry(
  account ? '선택 계좌 거래(불러온 목록)' : '불러온 거래', account ? 'account-transactions' : 'ledger-transactions',
  ['거래 ID', '시각 (KST)', '송금 계좌', '송금 소유주', '수취 계좌', '수취 소유주', '금액', '통화', '결제 수단', '판정'],
  records.map(row => [row.code, row.timestamp, row.from.id ?? row.from.code, row.from.owner,
    row.to.id ?? row.to.code, row.to.owner, row.amount, row.currency, row.method, verdictLabels[row.verdict]]));

function linkedCaseRecords(transaction, caseRows) {
  if (!transaction) return [];
  return caseRows ? linkedCaseEntries(caseRows, transaction) : ['Alert', 'Episode'].flatMap(kind =>
    serverCaseIds(transaction, kind).map(id => ({ code: serverCaseCode(kind, id), kind, server: true })));
}

function linkedCasesDownload(records, label = '연결 업무', file = 'linked-cases') {
  return csvDownloadEntry(label, file, linkedCaseColumns.map(([, heading]) => heading), records.map(row => row.server
    ? [row.code, row.kind, '', '', '', '', '']
    : [row.code, row.kind, row.pattern, row.score, row.status, verdictLabels[row.verdict], row.related.length]));
}

function LedgerColumns({ columns }) {
  return <TableHeader><TableRow>
    {columns.map(([key, label]) => <TableHead key={key} scope="col">
      <TableFieldLabel column={key}>{label}</TableFieldLabel>
    </TableHead>)}
  </TableRow></TableHeader>;
}

function LedgerRecordId({ code, addable = true, ...buttonProps }) {
  return <TableRecordCell action={addable ? <WorkTabAddButton inline code={code} /> : null}>
    <LinkTag code={code} aria-label={undefined} data-work-code={undefined} {...buttonProps} />
  </TableRecordCell>;
}

const ledgerSearchOptions = [
  { value: 'owner', label: '소유주' },
  { value: 'account', label: '계좌' },
  { value: 'transaction', label: '거래' },
];

function LedgerSearch({ target, query, onChange }) {
  const label = `${target.label} 검색`;
  return <Box className="ledger-search-bar" role="group" aria-label="원장 목록 검색">
    <GlideSelect ariaLabel="원장 검색 대상" options={ledgerSearchOptions} value={target.value}
      onChange={value => onChange({ target: value, query: '' })} />
    <SearchField variant="compact" label={label} placeholder={label} value={query}
      onChange={event => onChange({ target: target.value, query: event.target.value })} />
  </Box>;
}

function LedgerListStatus({ list, empty }) {
  if (list.status === 'loading') return <Text className="visually-hidden" role="status">불러오는 중…</Text>;
  if (list.status === 'error' && !list.items.length) return <Text className="ledger-status" role="alert">{list.message}{' '}
    <ActionButton className="ledger-retry" onClick={list.retry}>다시 시도</ActionButton></Text>;
  if (list.status === 'success' && !list.items.length) return <Text className="ledger-status" role="status">{empty}</Text>;
  return null;
}

/** 목록 끝의 더 보기: 다음 20건(page+1)을 이어 붙인다. 대시보드 업무 레인처럼 패널 폭을 채우는 pill 버튼. */
function LedgerMore({ label, list }) {
  if (list.status === 'error' && list.items.length) return <Box className="ledger-more" role="alert">
    <Text as="span">{list.message}</Text>
    <ActionButton shape="pill" onClick={list.retry}>다시 시도</ActionButton>
  </Box>;
  if (!list.items.length || !list.hasMore) return null;
  return <Box className="ledger-more">
    <ActionButton shape="pill" aria-label={`${label} 20건 더 보기`}
      disabled={list.status === 'loading-more'} onClick={list.loadMore}>
      {list.status === 'loading-more' ? '불러오는 중…' : '더 보기'}</ActionButton>
  </Box>;
}

function LedgerMoreRow({ label, list, level }) {
  if (!list.hasMore && list.status !== 'error') return null;
  return <TableRow level={level}>
    <TableCell colSpan={ledgerColumns.length}><LedgerMore label={label} list={list} /></TableCell>
  </TableRow>;
}

function LedgerHierarchy({ owners, accounts, transactions, selection, select, search, searchTarget, filtering }) {
  const scroll = useRef(null);
  const selectedRow = useRef(null);
  const { owner, account, transaction } = selection;
  const records = transactions.items;
  const transactionResults = searchTarget === 'transaction' && !account;
  const accountResults = searchTarget === 'account' && !owner;
  const resultList = transactionResults ? transactions : accountResults ? accounts : owners;
  const loadingBranch = resultList.status === 'loading' || (owner && accounts.status === 'loading')
    || (account && transactions.status === 'loading');
  // A search can reveal an ancestor outside the first page. Leave its open branch visible when switching targets.
  const withOpenBranch = (rows, current, target) => current && (!filtering || searchTarget !== target) && !rows.some(row => row.id === current.id)
    ? [current, ...rows] : rows;
  const ownerOpen = row => owner?.id === row.id;
  const summary = <>
    {!transactionResults && !accountResults && <CountTag label="소유주" count={owners.items.length} total={owners.total} unit="명" />}
    {!transactionResults && (owner || accountResults) && <CountTag label="계좌" count={accounts.items.length} total={accounts.total} unit="개" />}
    {(account || transactionResults) && <CountTag label="거래" count={records.length} total={transactions.total} />}
  </>;
  const entries = [
    !transactionResults && !accountResults && ownerDownload(owners.items),
    !transactionResults && (owner || accountResults) && accountDownload(accounts.items),
    (account || transactionResults) && transactionDownload(records, account),
  ].filter(entry => entry && !entry.disabled);

  const emptyRow = (list, label) => list.status === 'success' && list.items.length === 0 && <TableRow>
    <TableCell colSpan={ledgerColumns.length}>조건과 일치하는 {label} 검색 결과가 없습니다.</TableCell>
  </TableRow>;
  const loadingRows = (list, level) => list.status === 'loading'
    && <DataTableSkeletonRows columnCount={ledgerColumns.length} rowCount={3} level={level} />;

  function transactionRows(ownerName, accountLabel) {
    return <>
      {records.map(record => {
        const active = transaction?.id === record.id;
        const subject = record.incoming ? record.to : record.from;
        return <TableRow key={record.id} level={3} ref={active ? selectedRow : undefined} data-selected={active || undefined}>
          <TableCell>{!ownerName && subject.owner}</TableCell>
          <TableCell>{!accountLabel && <Text as="code">{subject.code}</Text>}</TableCell>
          <LedgerRecordId code={record.code} addable={record.openable} aria-pressed={active}
            aria-description={`${ownerName || subject.owner} · ${accountLabel || subject.code}`} onClick={() => select.transaction(record)} />
          <TableCell><Text as="time" dateTime={`${record.timestamp.replace(' ', 'T')}+09:00`}>{record.timestamp}</Text></TableCell>
          <TableCell>{transactionDirection(record)}</TableCell>
          <TableCell><Text as="code">{counterpartyCode(record)}</Text></TableCell>
          <TableCell numeric>{amountFormat.format(record.amount)} {record.currency}</TableCell>
          <TableCell>{record.method}</TableCell>
          <TableCell><VerdictTag verdict={record.verdict} /></TableCell>
        </TableRow>;
      })}
      {loadingRows(transactions, 3)}
      {emptyRow(transactions, '거래')}
      <LedgerMoreRow label={accountLabel ? `${accountLabel} 거래` : '거래'} list={transactions} level={3} />
    </>;
  }

  function accountRows(ownerName) {
    return <>
      {withOpenBranch(accounts.items, account, 'account').map(item => {
        const open = account?.id === item.id;
        return <React.Fragment key={item.id}>
          <TableRow level={2}>
            <TableCell>{!ownerName && item.ownerName}</TableCell>
            <TableRowHead><TableBranchToggle label={`${item.label}의 거래`} expanded={open}
              onClick={() => select.account(open ? null : item)}><Text as="code" title={item.id}>{item.label}</Text></TableBranchToggle></TableRowHead>
            <TableCell colSpan={ledgerColumns.length - 2} />
          </TableRow>
          {open && transactionRows(ownerName || item.ownerName, item.label)}
        </React.Fragment>;
      })}
      {loadingRows(accounts, 2)}
      {emptyRow(accounts, '계좌')}
      <LedgerMoreRow label={ownerName ? `${ownerName} 계좌` : '계좌'} list={accounts} level={2} />
    </>;
  }

  useLayoutEffect(() => {
    const viewport = scroll.current;
    const row = selectedRow.current;
    if (!row || !viewport?.clientHeight) return;
    if (viewport.scrollHeight <= viewport.clientHeight) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const visibleTop = bounds.top + viewport.querySelector('thead').getBoundingClientRect().height;
    if (rowBounds.bottom > bounds.bottom) viewport.scrollTop += rowBounds.bottom - bounds.bottom;
    else if (rowBounds.top < visibleTop) viewport.scrollTop += rowBounds.top - visibleTop;
  }, [transaction?.id]);

  return <Box className="ledger-hierarchy">
    {search}
    <WorkflowTable hierarchy scrollRef={scroll} label="통합 테이블" summary={summary}
      tools={entries.length > 0 && <TableQueryTools actions={{ entries, panelDownload: Boolean(transaction) }} />}>
      <TableColumns widths={ledgerColumns.map(([key, , width]) => ({ key, width: `${width}%` }))} />
      <LedgerColumns columns={ledgerColumns} />
      <TableBody aria-busy={loadingBranch || undefined}>
      {transactionResults && transactionRows()}
      {accountResults && accountRows()}
      {!transactionResults && !accountResults && withOpenBranch(owners.items, owner, 'owner').map(row => <React.Fragment key={row.id}>
        <TableRow level={1}>
          <TableRowHead scope="rowgroup"><TableBranchToggle label={`${row.name}의 계좌`} expanded={ownerOpen(row)}
            onClick={() => select.owner(ownerOpen(row) ? null : row)}>{row.name}</TableBranchToggle></TableRowHead>
          <TableCell colSpan={ledgerColumns.length - 1} />
        </TableRow>
        {ownerOpen(row) && accountRows(row.name)}
      </React.Fragment>)}
        {!transactionResults && !accountResults && emptyRow(owners, '소유주')}
        {!transactionResults && !accountResults && loadingRows(owners, 1)}
        {!transactionResults && !accountResults && <LedgerMoreRow label="소유주" list={owners} level={1} />}
      </TableBody>
    </WorkflowTable>
    <LedgerListStatus list={resultList} empty="" />
    {loadingBranch && resultList.status !== 'loading' &&
      <Text className="visually-hidden" role="status">연결된 원장 항목 불러오는 중…</Text>}
  </Box>;
}

function LinkedCaseTable({ transaction, caseRows }) {
  const entries = linkedCaseRecords(transaction, caseRows);
  const alertCount = entries.filter(row => row.kind === 'Alert').length;
  const actions = { entries: [linkedCasesDownload(entries)] };
  return <WorkflowTable label="선택 거래와 연결된 Alert·Episode"
    summary={transaction && <><CountTag label="Alert" count={alertCount} /><CountTag label="Episode" count={entries.length - alertCount} /></>}
    tools={entries.length > 0 && <TableQueryTools actions={actions} />}>
    <LedgerColumns columns={linkedCaseColumns} />
    <TableBody>
      {entries.map(row => row.server ? <TableRow key={row.code}>
        <TableRowHead><Text as="code">{row.code}</Text></TableRowHead>
        <TableCell>{row.kind}</TableCell>
        <TableCell colSpan={linkedCaseColumns.length - 2}>서버 원장 연결 ID</TableCell>
      </TableRow> : <TableRow key={row.code}>
        <LedgerRecordId code={row.code} aria-label={`${row.code} 상세 열기`} data-work-code={row.code} />
        <TableCell>{row.kind}</TableCell>
        <TableCell><PatternTag emphasis="solid">{row.pattern}</PatternTag></TableCell>
        <TableCell><ModelScoreTag score={row.score} /></TableCell>
        <TableCell><ReviewStatusTag status={row.status} /></TableCell>
        <TableCell><VerdictTag verdict={row.verdict} /></TableCell>
        <TableCell>{amountFormat.format(row.related.length)}건</TableCell>
      </TableRow>)}
      {!entries.length && <TableRow><TableCell colSpan={linkedCaseColumns.length}>
        {transaction ? '이 거래와 연결된 Alert·Episode가 없습니다.' : '거래를 선택해 연결 업무를 확인하세요.'}
      </TableCell></TableRow>}
    </TableBody>
  </WorkflowTable>;
}

const readServerMode = () => currentPreviewUser()?.source === 'api';

/** 로그인 세션이 API 사용자면 서버 원장을, 아니면 Sample 원장을 같은 화면 계약으로 보여 준다. */
export function Ledger({ codes, code, caseRows, tableView = false, serverSource, targetTransaction }) {
  const server = useSyncExternalStore(subscribePreviewUser, readServerMode);
  const source = useMemo(() => server ? serverSource ?? createServerLedgerSource() : createSampleLedgerSource(codes),
    [server, serverSource, codes]);
  return <LedgerWorkspace key={source.kind} source={source} code={code}
    caseRows={caseRows} targetTransaction={server ? targetTransaction : undefined} tableView={tableView} />;
}

export function LedgerWorkspace({ source, code, caseRows, tableView = false, targetTransaction }) {
  const [initial] = useState(() => {
    if (targetTransaction) return { transaction: { ...targetTransaction, id: String(targetTransaction.txId), openable: false } };
    return code ? source.locate(code) ?? { missing: true } : undefined;
  });
  const [owner, setOwner] = useState(initial?.owner ?? null);
  const [account, setAccount] = useState(initial?.account ?? null);
  const [transaction, setTransaction] = useState(initial?.transaction ?? null);
  const [search, setSearch] = useState(() => targetTransaction
    ? { target: 'transaction', query: String(targetTransaction.txId) }
    : { target: 'owner', query: '' });
  const openedTarget = targetTransaction && transaction?.code === targetTransaction.code;
  const searchTarget = ledgerSearchOptions.find(option => option.value === search.target);
  const debouncedSearch = useDebouncedValue(search);
  const searchQuery = target => searchTarget.value === target && debouncedSearch.target === target ? debouncedSearch.query : '';
  const ownerSearch = searchQuery('owner');
  const accountSearch = searchQuery('account');
  const transactionSearch = searchQuery('transaction');
  const ownerKey = JSON.stringify([ownerSearch]);
  const accountKey = JSON.stringify([owner?.id ?? null, accountSearch]);
  const transactionKey = JSON.stringify([owner?.id ?? null, account?.id ?? null, transactionSearch]);
  const reduced = useSyncExternalStore(subscribeAppearance, readReducedMotion);

  // 검색·상위 선택이 바뀌면 key가 바뀌어 각 목록이 page=0부터 다시 조회한다.
  const owners = useLedgerList((page, active) => source.owners({ query: ownerSearch, page }, active), ownerKey);
  const accounts = useLedgerList((page, active) => source.accounts({ query: accountSearch, page, owner: owner?.id }, active), accountKey);
  const transactions = useLedgerList((page, active) => source.transactions({
    query: transactionSearch, page, owner: owner?.id, account: account?.id,
  }, active), transactionKey);

  const select = {
    owner: row => {
      if ((row?.id ?? null) === (owner?.id ?? null)) return;
      if (tableView && (search.target === 'transaction' || (!row && search.target === 'account'))) {
        setSearch({ target: 'owner', query: '' });
      }
      setOwner(row); setAccount(null); setTransaction(null);
    },
    account: row => {
      if ((row?.id ?? null) === (account?.id ?? null)) return;
      if (tableView && !row && search.target === 'transaction') setSearch({ target: 'account', query: '' });
      if (tableView && !owner && row?.ownerId) setOwner({ id: row.ownerId, name: row.ownerName });
      setAccount(row); setTransaction(null);
    },
    transaction: row => setTransaction(row),
  };
  const selection = { owner, account, transaction };
  const linkedCases = source.kind === 'server' && !openedTarget ? undefined : caseRows;
  const searchBar = <LedgerSearch target={searchTarget} query={search.query} onChange={setSearch} />;

  if (tableView) return <Box className="ledger-tables" data-ledger-view="table" data-ledger-source={source.kind}>
    <LedgerHierarchy owners={owners} accounts={accounts} transactions={transactions} selection={selection}
      select={select} search={searchBar} searchTarget={searchTarget.value} filtering={Boolean(searchQuery(searchTarget.value).trim())} />
    <LinkedCaseTable transaction={transaction} caseRows={linkedCases} />
  </Box>;

  const ownerRows = owners.items;
  const accountRows = accounts.items;
  const records = transactions.items;
  const ownerIndex = ownerRows.findIndex(row => row.id === owner?.id);
  const accountIndex = accountRows.findIndex(row => row.id === account?.id);
  const transactionIndex = records.findIndex(row => row.id === transaction?.id);
  // 더 보기로 이어 붙일 때는 목록을 다시 만들지 않고, 새 조건의 첫 응답에서만 다시 만든다.
  const listKey = (list, key) => `${key}:${list.status === 'loading' ? 'loading' : 'ready'}`;
  const pane = (name, title, suffix, list, emptyText, entry, content) =>
    <Box as="section" className={`ledger-pane ledger-${name}`} aria-labelledby={`ledger-${name}-title`} aria-busy={list.status === 'loading' || undefined}>
      <LedgerHeading id={`ledger-${name}-title`} title={title} count={list.items.length} total={list.total} suffix={suffix} entry={entry} />
      <LedgerListStatus list={list} empty={emptyText} />
      {list.status === 'loading' ? <LedgerPaneSkeleton /> : content}
      <LedgerMore label={title} list={list} />
    </Box>;

  return <Box className="ledger-components" data-ledger-view="cards" data-ledger-source={source.kind}>
    {searchBar}
    {pane('owners', '소유주', '명', owners, '조건과 일치하는 소유주가 없습니다.', ownerDownload(ownerRows),
      <List key={listKey(owners, ownerKey)} label="소유주 목록" items={ownerRows.map(row => ({ id: row.id, title: row.name }))}
        selected={ownerIndex} reduced={reduced} onSelect={(_, index) => select.owner(ownerRows[index])} />)}
    {pane('accounts', '계좌', '개', accounts, '조건과 일치하는 계좌가 없습니다.', accountDownload(accountRows),
      <List key={listKey(accounts, accountKey)} label={owner ? `${owner.name} 계좌 목록` : '계좌 목록'}
        items={accountRows.map(row => ({ id: row.id, title: row.label }))}
        selected={accountIndex} reduced={reduced} onSelect={(_, index) => select.account(accountRows[index])} />)}
    {pane('transactions', '거래', '건', transactions, '조건과 일치하는 거래가 없습니다.', transactionDownload(records, account),
      <List key={listKey(transactions, transactionKey)} label={account ? `${account.label} 거래 목록` : '거래 목록'}
        items={records.map(record => ({ id: record.id, title: record.code }))}
        className="ledger-transaction-list" selected={transactionIndex} reduced={reduced}
        onSelect={(_, index) => select.transaction(records[index])}
        itemData={(_, index) => recordCardSurface(records[index].verdict, true)}
        renderItem={(_, index) => <TransactionRow record={records[index]} />}
        renderItemHeader={(_, index) => <TransactionHeader record={records[index]} />} />)}
    <Box as="section" className="ledger-pane ledger-related" aria-labelledby="ledger-related-title">
      <SectionDownloadHeading id="ledger-related-title" entries={
        [linkedCasesDownload(linkedCaseRecords(transaction, linkedCases))].filter(entry => !entry.disabled)
      }>선택 거래와 연결된 Alert·Episode</SectionDownloadHeading>
      {transaction ? <>
        <Text className="ledger-source" aria-live="polite"><Text as="code">{transaction.code}</Text></Text>
        <LinkedCaseGroups transaction={transaction} caseRows={linkedCases} />
      </> : <Text className="ledger-empty" role="status">{initial?.missing
        ? '요청한 거래를 찾을 수 없습니다. 소유주를 선택해 계속 조사할 수 있습니다.'
        : '거래를 선택해 연결된 Alert·Episode를 확인하세요.'}</Text>}
    </Box>
    <LedgerConnections owner={ownerIndex} account={accountIndex} transaction={transactionIndex}
      version={`${ownerKey}|${ownerRows.length}|${owners.status}|${accountKey}|${accountRows.length}|${accounts.status}|${transactionKey}|${records.length}|${transactions.status}`} />
  </Box>;
}

export function CaseCards({ codes, label, caseRows }) {
  const reduced = useSyncExternalStore(subscribeAppearance, readReducedMotion);
  const rows = codes.map(code => caseRows.get(code)).filter(Boolean);
  return <Box as="section" className="screen-section case-list-panel" aria-label={label}>
    <CaseProgressBoard key={codes.join(',')} rows={rows} reduced={reduced} pageSize={8} className="record-card-scroll" />
  </Box>;
}

export function mountInvestigation(host, props) {
  const root = createRoot(host);
  const caseRows = new Map((props.cases ?? dashboardFixtures(props.groups).cases).map(row => [row.code, row]));
  const ledger = host.dataset.investigationComponent === 'ledger';
  const renderLedger = tableView => root.render(<Ledger {...props} caseRows={caseRows} tableView={tableView} />);
  if (ledger) renderLedger(props.tableView);
  else root.render(<CaseCards {...props} caseRows={caseRows} />);
  return { unmount: () => root.unmount(), setLedgerView: ledger ? renderLedger : undefined };
}
