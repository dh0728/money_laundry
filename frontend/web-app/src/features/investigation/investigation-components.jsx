import React, { useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronRight } from 'lucide-react';
import { SearchField } from '../../components/search-field';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardHeader } from '../../components/card-header';
import { activateRecordCard, RecordCard, recordCardSurface } from '../../components/record-card';
import { CountTag, LinkTag, ModelScoreTag, PatternTag, ReviewStatusTag, StatusTag, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user.js';
import { createSampleLedgerSource, createServerLedgerSource, useDebouncedValue, useLedgerList } from './ledger-source';
import { CaseProgressBoard, PreviewCaseCard } from './preview-case-card';
import { dashboardFixtures } from '../../mocks/dashboard-fixtures';
import { ActionButton, WorkTabAddButton } from '../../components/primary-button';
import AnimatedList from '../../components/react-bits/AnimatedList';
import { BorderGlowEdge } from '../../components/react-bits/BorderGlow';
import { TableFieldLabel, WorkflowTable } from '../../components/workflow-table';
import { downloadCsv, TableQueryTools } from '../../components/query-controls';
import './investigation-components.css';

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
      return { viewport, rows: [...viewport.querySelectorAll('[data-index][data-state]')] };
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
      observer.observe(viewport);
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
  return <svg ref={overlayRef} className="ledger-connections" aria-hidden="true" focusable="false">
    {paths.map(({ name, targetIndex, active, d }) => <path key={`${name}-${targetIndex}`} data-source={name}
      data-target-index={targetIndex} data-active={active || undefined} d={d} />)}
  </svg>;
}

function List({ label, items, selected, onSelect, reduced, renderItem, renderItemHeader, onItemSurfaceClick, itemData, className = '' }) {
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
  return <div ref={listRef} className={`ledger-scroll-shell ${className}`}>
    <AnimatedList ariaLabel={label} items={items} initialSelectedIndex={selected} renderItem={renderItem} itemData={itemData}
      itemClassName={itemData ? 'border-glow-card border-glow-card--record' : undefined}
      itemDecoration={itemData ? <BorderGlowEdge /> : undefined}
      renderItemHeader={renderItemHeader} onItemSurfaceClick={onItemSurfaceClick} selectOnHover={false}
      animation={reduced ? 'none' : renderItemHeader ? 'fade' : 'pop'} stagger={0.035} animateOnce showGradients={false} frame={false}
      displayScrollbar width="100%" maxHeight="var(--ledger-list-limit, var(--workspace-list-limit))"
      accentColor="var(--focus-ring)" onItemSelect={onSelect}
      style={{ '--al-radius': 'var(--aml-radius-card)', '--al-ink': 'var(--text)', '--al-muted': 'var(--muted-text)',
        '--al-tile': 'var(--information-panel-surface)', '--al-tile-edge': 'var(--divider)',
        '--al-ring': 'var(--selected)', '--al-tile-shadow': 'none' }} />
  </div>;
}

function LedgerHeading({ as: Heading = 'h2', id, title, count, total, suffix }) {
  return <div className="ledger-panel-heading">
    <Heading id={id}>{title}</Heading><CountTag count={count} total={total} unit={suffix} />
  </div>;
}

function TransactionParty({ party, label, direction, verdict }) {
  return <div className={`ledger-party ledger-party--${direction}`} data-account-verdict={verdict}>
    <span className="screen-title-accessible">{label} · {verdictLabels[verdict]}</span>
    <span>{party.owner}</span>
    <code>{party.code}</code>
  </div>;
}

export function TransactionHeader({ record }) {
  return record.openable === false ? <CardHeader code={record.code} openRecord={false} showAdd={false} />
    : <CardHeader code={record.code} />;
}

export function TransactionFlow({ record }) {
  const gradientId = useId();
  const sourceVerdict = record.from.verdict ?? record.verdict ?? 'unjudged';
  const destinationVerdict = record.to.verdict ?? record.verdict ?? 'unjudged';
  const mixed = sourceVerdict !== destinationVerdict;
  const sender = <TransactionParty party={record.from} label="송금 계좌" direction="source" verdict={sourceVerdict} />;
  const recipient = <TransactionParty party={record.to} label="수취 계좌" direction="destination" verdict={destinationVerdict} />;
  return <div className="ledger-transaction-flow">
    {record.incoming ? recipient : sender}
    <div className="ledger-transaction-details">
      <time dateTime={`${record.timestamp.replace(' ', 'T')}+09:00`}>{record.timestamp}</time>
      <svg className="ledger-transaction-arrow" data-incoming={record.incoming || undefined} aria-hidden="true">
        {mixed && <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" data-account-verdict={record.incoming ? destinationVerdict : sourceVerdict} stopColor="var(--transaction-endpoint-fill)" />
            <stop offset="100%" data-account-verdict={record.incoming ? sourceVerdict : destinationVerdict} stopColor="var(--transaction-endpoint-fill)" />
          </linearGradient>
        </defs>}
        <rect className="ledger-arrow-shaft" x={record.incoming ? 18 : 0} y="9.5" height="4" data-account-verdict={sourceVerdict}
          fill={mixed ? `url(#${gradientId})` : 'var(--transaction-endpoint-fill)'} />
        <svg x={record.incoming ? '0' : '100%'} y="0" width="20" height="23" overflow="visible">
          <path data-account-verdict={destinationVerdict} fill="var(--transaction-endpoint-fill)"
            d={record.incoming ? 'M20 0 0 11.5 20 23Z' : 'M-20 0 0 11.5 -20 23Z'} />
        </svg>
      </svg>
      <span>{record.method} · <strong>{amountFormat.format(record.amount)} {record.currency}</strong></span>
    </div>
    {record.incoming ? sender : recipient}
  </div>;
}

export function TransactionRow({ record }) {
  return <div className="ledger-transaction">
    <div className="semantic-tag-group">
      <VerdictTag verdict={record.verdict} />
      {record.status && <ReviewStatusTag status={record.status} />}
      <StatusTag preset="neutral">{record.incoming ? '수취' : '송금'}</StatusTag>
    </div>
    <TransactionFlow record={record} />
  </div>;
}

export function TransactionCard({ record }) {
  return <RecordCard className="ledger-transaction-card" label={record.code} verdict={record.verdict} opensRecord>
    <TransactionHeader record={record} />
    <div className="animated-list__item-content"><TransactionRow record={record} /></div>
  </RecordCard>;
}

function CaseList({ entries, transaction }) {
  return <div className="case-list">
    {entries.map(row =>
      <div className="list-item-enter" key={row.code}>
        <PreviewCaseCard row={row} selectedTransaction={transaction} />
      </div>)}
  </div>;
}

const serverCaseCode = (kind, id) => `${kind === 'Alert' ? 'A' : 'E'}-${id}`;
const serverCaseIds = (transaction, kind) => (kind === 'Alert' ? transaction.alertIds : transaction.episodeIds) ?? [];

function LinkedCaseGroups({ transaction, caseRows }) {
  return <div className="ledger-case-groups">
    {['Alert', 'Episode'].map(label => {
      if (!caseRows) {
        const ids = serverCaseIds(transaction, label);
        return <section key={label} aria-label={`연결 ${label} ${ids.length}건`}>
          <LedgerHeading as="h3" title={label} count={ids.length} suffix="건" />
          {ids.length ? <ul className="ledger-linked-ids">
            {ids.map(id => <li key={id}><code>{serverCaseCode(label, id)}</code></li>)}
          </ul> : <p className="ledger-empty">연결된 {label} 없음</p>}
        </section>;
      }
      const entries = linkedCaseEntries(caseRows, transaction, label);
      return <section key={label} aria-label={`연결 ${label} ${entries.length}건`}>
        <LedgerHeading as="h3" title={label} count={entries.length} suffix="건" />
        {entries.length ? <CaseList entries={entries} transaction={transaction} />
          : <p className="ledger-empty">연결된 {label} 없음</p>}
      </section>;
    })}
  </div>;
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

function LedgerColumns({ columns }) {
  return <TableHeader><TableRow>
    {columns.map(([key, label]) => <TableHead key={key} scope="col">
      <TableFieldLabel column={key}>{label}</TableFieldLabel>
    </TableHead>)}
  </TableRow></TableHeader>;
}

function LedgerRecordId({ code, addable = true, ...buttonProps }) {
  return <th scope="row"><div className="ledger-table-record-id">
    {addable && <WorkTabAddButton inline code={code} />}
    <LinkTag code={code} className="ledger-table-select" aria-label={undefined} data-work-code={undefined} {...buttonProps} />
  </div></th>;
}

function LedgerBranchToggle({ label, expanded, onClick, children }) {
  return <ActionButton className="ledger-branch-toggle" aria-expanded={expanded} aria-label={label} onClick={onClick}>
    <ChevronRight className="icon" aria-hidden="true" />{children}
  </ActionButton>;
}

/** 상단 작업 코드 검색과 같은 pill 검색 필드(.search-field)를 쓴다. */
function LedgerSearch({ label, value, onChange, placeholder, disabled }) {
  return <SearchField variant="compact" className="ledger-search" label={label} placeholder={placeholder} value={value} disabled={disabled}
    onChange={event => onChange(event.target.value)} />;
}

function LedgerListStatus({ list, empty }) {
  if (list.status === 'loading') return <p className="ledger-status" role="status">불러오는 중…</p>;
  if (list.status === 'error' && !list.items.length) return <p className="ledger-status" role="alert">{list.message}{' '}
    <ActionButton className="ledger-retry" onClick={list.retry}>다시 시도</ActionButton></p>;
  if (list.status === 'success' && !list.items.length) return <p className="ledger-status" role="status">{empty}</p>;
  return null;
}

/** 목록 끝의 더 보기: 다음 20건(page+1)을 이어 붙인다. 대시보드 업무 레인처럼 패널 폭을 채우는 pill 버튼. */
function LedgerMore({ label, list }) {
  if (list.status === 'error' && list.items.length) return <div className="ledger-more" role="alert">
    <span>{list.message}</span>
    <ActionButton shape="pill" onClick={list.retry}>다시 시도</ActionButton>
  </div>;
  if (!list.items.length || !list.hasMore) return null;
  return <div className="ledger-more">
    <ActionButton shape="pill" aria-label={`${label} 20건 더 보기`}
      disabled={list.status === 'loading-more'} onClick={list.loadMore}>
      {list.status === 'loading-more' ? '불러오는 중…' : '더 보기'}</ActionButton>
  </div>;
}

function LedgerMoreRow({ label, list, depth }) {
  if (!list.hasMore && list.status !== 'error') return null;
  return <TableRow data-ledger-depth={depth} data-ledger-more="">
    <TableCell colSpan={ledgerColumns.length}><LedgerMore label={label} list={list} /></TableCell>
  </TableRow>;
}

function LedgerHierarchy({ owners, accounts, transactions, selection, select, queries }) {
  const frame = useRef(null);
  const { owner, account, transaction } = selection;
  const records = transactions.items;
  const ownerOpen = row => owner?.id === row.id;
  const summary = <>
    <CountTag label="소유주" count={owners.items.length} total={owners.total} unit="명" />
    {owner && <CountTag label="계좌" count={accounts.items.length} total={accounts.total} unit="개" />}
    {account && <CountTag label="거래" count={records.length} total={transactions.total} />}
  </>;
  const actions = { entries: [{
    label: '선택 계좌 거래(불러온 목록)', format: 'CSV', count: account ? records.length : 0,
    download: () => downloadCsv('account-transactions', ledgerColumns.map(([, label]) => label), records.map(record => [
      owner?.name ?? '', account?.label ?? '', record.code, record.timestamp, transactionDirection(record), counterpartyCode(record),
      `${record.amount} ${record.currency}`, record.method, verdictLabels[record.verdict],
    ])),
  }] };

  useLayoutEffect(() => {
    const viewport = frame.current.querySelector('.ledger-hierarchy-scroll');
    const row = viewport?.querySelector('tr[data-ledger-depth="transaction"][data-selected="true"]');
    if (!row || !viewport.clientHeight) return;
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

  return <div ref={frame} className="ledger-hierarchy">
    <div className="ledger-table-controls" role="group" aria-label="원장 목록 검색">
      {[['소유주', queries.owner, true], ['계좌', queries.account, Boolean(owner)], ['거래', queries.transaction, Boolean(account)]]
        .map(([label, query, enabled]) => <LedgerSearch key={label} label={`${label} 검색`}
          placeholder={enabled ? `${label} 검색` : `${label} 검색 · 상위 항목을 먼저 선택`} value={query.value} onChange={query.set}
          disabled={!enabled} />)}
    </div>
    <WorkflowTable className="ledger-hierarchy-scroll" tableClassName="ledger-hierarchy-table" label="통합 테이블" summary={summary}
      tools={account && records.length > 0 && <TableQueryTools actions={actions} />}>
      <colgroup>{ledgerColumns.map(([key, , width]) => <col key={key} style={{ width: `${width}%` }} />)}</colgroup>
      <LedgerColumns columns={ledgerColumns} />
      <TableBody>
      {owners.items.map(row => <React.Fragment key={row.id}>
        <TableRow data-ledger-depth="owner">
          <th scope="rowgroup"><LedgerBranchToggle label={`${row.name}의 계좌`} expanded={ownerOpen(row)}
            onClick={() => select.owner(ownerOpen(row) ? null : row)}>{row.name}</LedgerBranchToggle></th>
          <TableCell colSpan={ledgerColumns.length - 1} />
        </TableRow>
        {ownerOpen(row) && <>
          {accounts.items.map(item => {
            const open = account?.id === item.id;
            return <React.Fragment key={item.id}>
              <TableRow data-ledger-depth="account">
                <TableCell aria-hidden="true" />
                <th scope="row"><LedgerBranchToggle label={`${item.label}의 거래`} expanded={open}
                  onClick={() => select.account(open ? null : item)}><code title={item.id}>{item.label}</code></LedgerBranchToggle></th>
                <TableCell colSpan={ledgerColumns.length - 2} />
              </TableRow>
              {open && records.map(record => {
                const active = transaction?.id === record.id;
                return <TableRow key={record.id} data-ledger-depth="transaction" data-selected={active || undefined}>
                  <TableCell aria-hidden="true" /><TableCell aria-hidden="true" />
                  <LedgerRecordId code={record.code} addable={record.openable} aria-pressed={active}
                    aria-description={`${row.name} · ${item.label}`} onClick={() => select.transaction(record)} />
                  <TableCell><time dateTime={`${record.timestamp.replace(' ', 'T')}+09:00`}>{record.timestamp}</time></TableCell>
                  <TableCell>{transactionDirection(record)}</TableCell>
                  <TableCell><code>{counterpartyCode(record)}</code></TableCell>
                  <TableCell className="ledger-table-amount">{amountFormat.format(record.amount)} {record.currency}</TableCell>
                  <TableCell>{record.method}</TableCell>
                  <TableCell><VerdictTag verdict={record.verdict} /></TableCell>
                </TableRow>;
              })}
              {open && <LedgerMoreRow label={`${item.label} 거래`} list={transactions} depth="transaction" />}
            </React.Fragment>;
          })}
          <LedgerMoreRow label={`${row.name} 계좌`} list={accounts} depth="account" />
        </>}
      </React.Fragment>)}
        {owners.status === 'success' && !owners.items.length && <TableRow>
          <TableCell colSpan={ledgerColumns.length}>조건과 일치하는 소유주가 없습니다.</TableCell>
        </TableRow>}
        <LedgerMoreRow label="소유주" list={owners} depth="owner" />
      </TableBody>
    </WorkflowTable>
    <LedgerListStatus list={owners} empty="" />
  </div>;
}

function LinkedCaseTable({ transaction, caseRows }) {
  const entries = !transaction ? [] : caseRows ? linkedCaseEntries(caseRows, transaction)
    : ['Alert', 'Episode'].flatMap(kind => serverCaseIds(transaction, kind).map(id => ({ code: serverCaseCode(kind, id), kind, server: true })));
  const alertCount = entries.filter(row => row.kind === 'Alert').length;
  const actions = { entries: [{
    label: '연결 업무', format: 'CSV', count: entries.length,
    download: () => downloadCsv('linked-cases', linkedCaseColumns.map(([, label]) => label), entries.map(row => row.server
      ? [row.code, row.kind, '', '', '', '', '']
      : [row.code, row.kind, row.pattern, row.score, row.status, verdictLabels[row.verdict], row.related.length])),
  }] };
  return <WorkflowTable label="선택 거래와 연결된 Alert·Episode"
    summary={transaction && <><CountTag label="Alert" count={alertCount} /><CountTag label="Episode" count={entries.length - alertCount} /></>}
    tools={entries.length > 0 && <TableQueryTools actions={actions} />}>
    <LedgerColumns columns={linkedCaseColumns} />
    <TableBody>
      {entries.map(row => row.server ? <TableRow key={row.code}>
        <th scope="row"><code>{row.code}</code></th>
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
export function Ledger({ codes, code, caseRows, tableView = false, serverSource }) {
  const server = useSyncExternalStore(subscribePreviewUser, readServerMode);
  const source = useMemo(() => server ? serverSource ?? createServerLedgerSource() : createSampleLedgerSource(codes),
    [server, serverSource, codes]);
  return <LedgerWorkspace key={source.kind} source={source} code={server ? '' : code}
    caseRows={server ? undefined : caseRows} tableView={tableView} />;
}

export function LedgerWorkspace({ source, code, caseRows, tableView = false }) {
  const [initial] = useState(() => code ? source.locate(code) ?? { missing: true } : undefined);
  const [owner, setOwner] = useState(initial?.owner ?? null);
  const [account, setAccount] = useState(initial?.account ?? null);
  const [transaction, setTransaction] = useState(initial?.transaction ?? null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [transactionQuery, setTransactionQuery] = useState('');
  const ownerSearch = useDebouncedValue(ownerQuery);
  const accountSearch = useDebouncedValue(accountQuery);
  const transactionSearch = useDebouncedValue(transactionQuery);
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
      setOwner(row); setAccount(null); setTransaction(null);
    },
    account: row => {
      if ((row?.id ?? null) === (account?.id ?? null)) return;
      setAccount(row); setTransaction(null);
    },
    transaction: row => setTransaction(row),
  };
  const queries = {
    owner: { value: ownerQuery, set: setOwnerQuery },
    account: { value: accountQuery, set: setAccountQuery },
    transaction: { value: transactionQuery, set: setTransactionQuery },
  };
  const selection = { owner, account, transaction };

  if (tableView) return <div className="ledger-tables" data-ledger-view="table" data-ledger-source={source.kind}>
    <LedgerHierarchy owners={owners} accounts={accounts} transactions={transactions} selection={selection}
      select={select} queries={queries} />
    <LinkedCaseTable transaction={transaction} caseRows={caseRows} />
  </div>;

  const ownerRows = owners.items;
  const accountRows = accounts.items;
  const records = transactions.items;
  const ownerIndex = ownerRows.findIndex(row => row.id === owner?.id);
  const accountIndex = accountRows.findIndex(row => row.id === account?.id);
  const transactionIndex = records.findIndex(row => row.id === transaction?.id);
  // 더 보기로 이어 붙일 때는 목록을 다시 만들지 않고, 새 조건의 첫 응답에서만 다시 만든다.
  const listKey = (list, key) => `${key}:${list.status === 'loading' ? 'loading' : 'ready'}`;
  const pane = (name, title, suffix, list, query, emptyText, content) =>
    <section className={`ledger-pane ledger-${name}`} aria-labelledby={`ledger-${name}-title`} aria-busy={list.status === 'loading' || undefined}>
      <LedgerHeading id={`ledger-${name}-title`} title={title} count={list.items.length} total={list.total} suffix={suffix} />
      <LedgerSearch label={`${title} 검색`} placeholder={`${title} 검색`} value={query.value} onChange={query.set} />
      <LedgerListStatus list={list} empty={emptyText} />
      {content}
      <LedgerMore label={title} list={list} />
    </section>;

  return <div className="ledger-components" data-ledger-view="cards" data-ledger-source={source.kind}>
    {pane('owners', '소유주', '명', owners, queries.owner, '조건과 일치하는 소유주가 없습니다.',
      <List key={listKey(owners, ownerKey)} label="소유주 목록" items={ownerRows.map(row => ({ id: row.id, title: row.name }))}
        selected={ownerIndex} reduced={reduced} onSelect={(_, index) => select.owner(ownerRows[index])} />)}
    {pane('accounts', '계좌', '개', accounts, queries.account, '조건과 일치하는 계좌가 없습니다.',
      <List key={listKey(accounts, accountKey)} label={owner ? `${owner.name} 계좌 목록` : '계좌 목록'}
        items={accountRows.map(row => ({ id: row.id, title: row.label }))}
        selected={accountIndex} reduced={reduced} onSelect={(_, index) => select.account(accountRows[index])} />)}
    {pane('transactions', '거래', '건', transactions, queries.transaction, '조건과 일치하는 거래가 없습니다.',
      <List key={listKey(transactions, transactionKey)} label={account ? `${account.label} 거래 목록` : '거래 목록'}
        items={records.map(record => ({ id: record.id, title: record.code }))}
        className="ledger-transaction-list" selected={transactionIndex} reduced={reduced}
        onSelect={(_, index) => select.transaction(records[index])}
        itemData={(_, index) => recordCardSurface(records[index].verdict, true)}
        onItemSurfaceClick={activateRecordCard}
        renderItem={(_, index) => <TransactionRow record={records[index]} />}
        renderItemHeader={(_, index) => <TransactionHeader record={records[index]} />} />)}
    <section className="ledger-pane ledger-related" aria-labelledby="ledger-related-title">
      <h2 id="ledger-related-title">선택 거래와 연결된 Alert·Episode</h2>
      {transaction ? <>
        <p className="ledger-source" aria-live="polite"><code>{transaction.code}</code></p>
        <LinkedCaseGroups transaction={transaction} caseRows={caseRows} />
      </> : <p className="ledger-empty" role="status">{initial?.missing
        ? '요청한 거래를 찾을 수 없습니다. 소유주를 선택해 계속 조사할 수 있습니다.'
        : '거래를 선택해 연결된 Alert·Episode를 확인하세요.'}</p>}
    </section>
    <LedgerConnections owner={ownerIndex} account={accountIndex} transaction={transactionIndex}
      version={`${ownerKey}|${ownerRows.length}|${owners.status}|${accountKey}|${accountRows.length}|${accounts.status}|${transactionKey}|${records.length}|${transactions.status}`} />
  </div>;
}

export function CaseCards({ codes, label, caseRows }) {
  const reduced = useSyncExternalStore(subscribeAppearance, readReducedMotion);
  const rows = codes.map(code => caseRows.get(code)).filter(Boolean);
  return <section className="screen-section case-list-panel" aria-label={label}>
    <CaseProgressBoard key={codes.join(',')} rows={rows} reduced={reduced} pageSize={8} />
  </section>;
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
