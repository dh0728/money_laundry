import React, { useId, useLayoutEffect, useRef, useSyncExternalStore, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronRight } from 'lucide-react';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardHeader } from '../../components/radar/card-header';
import { activateRecordCard, RecordCard, recordCardSurface } from '../../components/radar/record-card';
import { ModelScoreTag, PatternTag, ReviewStatusTag, StatusTag, VerdictTag, verdictLabels } from '../../components/radar/semantic-tags';
import { ACCOUNTS_PER_OWNER, OWNER_COUNT, accountCode, findLedgerSelection, ownerName, sampleTransactions } from '../../mocks/radar/transaction-fixtures';
import { CaseProgressBoard, PreviewCaseCard } from './preview-case-card';
import { dashboardFixtures } from '../../mocks/radar/dashboard-fixtures';
import { ActionButton, WorkTabAddButton } from '../../components/radar/primary-button';
import AnimatedList from '../../components/react-bits/AnimatedList';
import { TableFieldLabel, WorkflowTable } from '../../components/radar/workflow-table';
import { downloadCsv, TableQueryTools } from '../../components/radar/query-controls';
import './investigation-components.css';

export { sampleTransactions } from '../../mocks/radar/transaction-fixtures';
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

function LedgerConnections({ owner, account, transaction }) {
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
  }, [owner, account, transaction]);
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
      renderItemHeader={renderItemHeader} onItemSurfaceClick={onItemSurfaceClick} selectOnHover={false}
      animation={reduced ? 'none' : renderItemHeader ? 'fade' : 'pop'} stagger={0.035} animateOnce showGradients={false} frame={false}
      displayScrollbar width="100%" maxHeight="var(--ledger-list-limit, var(--workspace-list-limit))"
      accentColor="var(--focus-ring)" onItemSelect={onSelect}
      style={{ '--al-radius': 'var(--aml-radius-card)', '--al-ink': 'var(--text)', '--al-muted': 'var(--muted-text)',
        '--al-tile': 'var(--information-panel-surface)', '--al-tile-edge': 'var(--divider)',
        '--al-ring': 'var(--selected)', '--al-tile-shadow': 'none' }} />
  </div>;
}

function LedgerHeading({ as: Heading = 'h2', id, title, count, suffix }) {
  return <div className="ledger-panel-heading">
    <Heading id={id}>{title}</Heading><StatusTag preset="neutral">{count}{suffix}</StatusTag>
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
  return <CardHeader code={record.code} />;
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
      <ReviewStatusTag status={record.status} />
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

function LinkedCaseGroups({ transaction, caseRows }) {
  return <div className="ledger-case-groups">
    {['Alert', 'Episode'].map(label => {
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

function LedgerRecordId({ code, ...buttonProps }) {
  return <th scope="row"><div className="ledger-table-record-id">
    <WorkTabAddButton inline code={code} />
    <ActionButton className="ledger-table-select" {...buttonProps}><code>{code}</code></ActionButton>
  </div></th>;
}

function LedgerBranchToggle({ label, expanded, onClick, children }) {
  return <ActionButton className="ledger-branch-toggle" aria-expanded={expanded} aria-label={label} onClick={onClick}>
    <ChevronRight className="icon" aria-hidden="true" />{children}
  </ActionButton>;
}

function toggleBranch(set, key) {
  set(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

function LedgerHierarchy({ codes, owners, owner, account, records, selected, onSelect }) {
  const frame = useRef(null);
  const [openOwners, setOpenOwners] = useState(() => new Set(owner >= 0 ? [owner] : []));
  const [openAccounts, setOpenAccounts] = useState(() => new Set(
    owner >= 0 && account >= 0 ? [accountCode(owner, account)] : []));
  const selectedRecord = records[selected];
  const selectedCode = selectedRecord?.code;
  const branches = owners.map((name, ownerIndex) => ({
    name,
    ownerIndex,
    accounts: openOwners.has(ownerIndex) ? Array.from({ length: ACCOUNTS_PER_OWNER }, (_, accountIndex) => {
      const code = accountCode(ownerIndex, accountIndex);
      return { accountIndex, code, transactions: openAccounts.has(code) ? sampleTransactions(codes, ownerIndex, accountIndex) : [] };
    }) : [],
  }));
  const visibleAccounts = branches.flatMap(branch => branch.accounts);
  const visibleTransactions = visibleAccounts.reduce((count, entry) => count + entry.transactions.length, 0);
  const summary = `소유주 ${amountFormat.format(owners.length)}명 · 표시 계좌 ${amountFormat.format(visibleAccounts.length)}개 · 거래 ${amountFormat.format(visibleTransactions)}건`;
  const actions = { entries: [{
    label: '선택 계좌 거래', format: 'CSV', count: records.length,
    download: () => downloadCsv('account-transactions', ledgerColumns.map(([, label]) => label), records.map(record => [
      owners[owner], accountCode(owner, account), record.code, record.timestamp, transactionDirection(record), counterpartyCode(record),
      `${record.amount} ${record.currency}`, record.method, verdictLabels[record.verdict],
    ])),
  }] };

  useLayoutEffect(() => {
    const viewport = frame.current.querySelector('.ledger-hierarchy-scroll');
    const row = viewport?.querySelector('tr[data-ledger-depth="transaction"][data-selected="true"]');
    if (!row) return;
    const bounds = viewport.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const visibleTop = bounds.top + viewport.querySelector('thead').getBoundingClientRect().height;
    if (rowBounds.bottom > bounds.bottom) viewport.scrollTop += rowBounds.bottom - bounds.bottom;
    else if (rowBounds.top < visibleTop) viewport.scrollTop += rowBounds.top - visibleTop;
  }, [selectedCode]);

  return <div ref={frame} className="ledger-hierarchy">
    <WorkflowTable className="ledger-hierarchy-scroll" tableClassName="ledger-hierarchy-table" label="통합 테이블" summary={summary}
      tools={records.length > 0 && <TableQueryTools actions={actions} />}>
      <colgroup>{ledgerColumns.map(([key, , width]) => <col key={key} style={{ width: `${width}%` }} />)}</colgroup>
      <LedgerColumns columns={ledgerColumns} />
      {branches.map(({ name, ownerIndex, accounts }) => <TableBody key={name}>
        <TableRow data-ledger-depth="owner">
          <th scope="rowgroup"><LedgerBranchToggle label={`${name}의 계좌`} expanded={openOwners.has(ownerIndex)}
            onClick={() => toggleBranch(setOpenOwners, ownerIndex)}>{name}</LedgerBranchToggle></th>
          <TableCell colSpan={ledgerColumns.length - 1} />
        </TableRow>
        {accounts.map(({ code: accountId, accountIndex, transactions }) => <React.Fragment key={accountId}>
          <TableRow data-ledger-depth="account">
            <TableCell aria-hidden="true" />
            <th scope="row"><LedgerBranchToggle label={`${accountId}의 거래`} expanded={openAccounts.has(accountId)}
              onClick={() => toggleBranch(setOpenAccounts, accountId)}><code>{accountId}</code></LedgerBranchToggle></th>
            <TableCell colSpan={ledgerColumns.length - 2} />
          </TableRow>
          {transactions.map((record, index) => {
            const active = selectedCode === record.code;
            return <TableRow key={record.code} data-ledger-depth="transaction" data-selected={active || undefined}>
              <TableCell aria-hidden="true" /><TableCell aria-hidden="true" />
              <LedgerRecordId code={record.code} aria-pressed={active} aria-description={`${name} · ${accountId}`}
                onClick={() => onSelect(ownerIndex, accountIndex, index)} />
              <TableCell><time dateTime={`${record.timestamp.replace(' ', 'T')}+09:00`}>{record.timestamp}</time></TableCell>
              <TableCell>{transactionDirection(record)}</TableCell>
              <TableCell><code>{counterpartyCode(record)}</code></TableCell>
              <TableCell className="ledger-table-amount">{amountFormat.format(record.amount)} {record.currency}</TableCell>
              <TableCell>{record.method}</TableCell>
              <TableCell><VerdictTag verdict={record.verdict} /></TableCell>
            </TableRow>;
          })}
        </React.Fragment>)}
      </TableBody>)}
    </WorkflowTable>
  </div>;
}

function LinkedCaseTable({ transaction, caseRows }) {
  const entries = transaction ? linkedCaseEntries(caseRows, transaction) : [];
  const alertCount = entries.filter(row => row.kind === 'Alert').length;
  const actions = { entries: [{
    label: '연결 업무', format: 'CSV', count: entries.length,
    download: () => downloadCsv('linked-cases', linkedCaseColumns.map(([, label]) => label), entries.map(row => [
      row.code, row.kind, row.pattern, row.score, row.status, verdictLabels[row.verdict], row.related.length,
    ])),
  }] };
  return <WorkflowTable label="선택 거래와 연결된 Alert·Episode"
    summary={transaction && `${transaction.code} · Alert ${amountFormat.format(alertCount)}건 · Episode ${amountFormat.format(entries.length - alertCount)}건`}
    tools={entries.length > 0 && <TableQueryTools actions={actions} />}>
    <LedgerColumns columns={linkedCaseColumns} />
    <TableBody>
      {entries.map(row => <TableRow key={row.code}>
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

export function Ledger({ codes, code, caseRows, tableView = false }) {
  const [initial] = useState(() => code ? findLedgerSelection(codes, code) : { owner: 0, account: 0, index: 0 });
  const [owner, setOwner] = useState(initial?.owner ?? -1);
  const [account, setAccount] = useState(initial?.account ?? -1);
  const [selected, setSelected] = useState(initial?.index ?? -1);
  const reduced = useSyncExternalStore(subscribeAppearance, readReducedMotion);
  const owners = Array.from({ length: OWNER_COUNT }, (_, index) => ownerName(index));
  const accounts = owner < 0 ? [] : Array.from({ length: ACCOUNTS_PER_OWNER }, (_, index) => accountCode(owner, index));
  const activeAccount = accounts[account];
  const records = activeAccount ? sampleTransactions(codes, owner, account) : [];
  const transaction = records[selected];

  if (tableView) return <div className="ledger-tables" data-ledger-view="table">
    <LedgerHierarchy codes={codes} owners={owners} owner={owner} account={account} records={records} selected={selected}
      onSelect={(ownerIndex, accountIndex, index) => { setOwner(ownerIndex); setAccount(accountIndex); setSelected(index); }} />
    <LinkedCaseTable transaction={transaction} caseRows={caseRows} />
  </div>;

  return <div className="ledger-components" data-ledger-view="cards">
    <section className="ledger-pane ledger-owners" aria-labelledby="ledger-owner-title">
      <LedgerHeading id="ledger-owner-title" title="소유주" count={owners.length} suffix="명" />
      <List label="소유주 목록" items={owners} selected={owner} reduced={reduced} onSelect={(_, index) => {
        if (index === owner) return;
        setOwner(index); setAccount(0); setSelected(0);
      }} />
    </section>
    <section className="ledger-pane ledger-accounts" aria-labelledby="ledger-account-title">
      <LedgerHeading id="ledger-account-title" title="계좌" count={accounts.length} suffix="개" />
      <List key={owner} label={owners[owner] ? `${owners[owner]} 계좌 목록` : '계좌 목록'} items={accounts}
        selected={account} reduced={reduced} onSelect={(_, index) => {
          if (index === account) return;
          setAccount(index); setSelected(0);
        }} />
    </section>
    <section className="ledger-pane ledger-transactions" aria-labelledby="ledger-transaction-title">
      <LedgerHeading id="ledger-transaction-title" title="거래" count={records.length} suffix="건" />
      <List key={activeAccount} label={activeAccount ? `${activeAccount} 거래 목록` : '거래 목록'}
        items={records.map(record => ({ id: record.code, title: record.code }))}
        className="ledger-transaction-list" selected={selected} reduced={reduced} onSelect={(_, index) => setSelected(index)}
        itemData={(_, index) => recordCardSurface(records[index].verdict, true)}
        onItemSurfaceClick={activateRecordCard}
        renderItem={(_, index) => <TransactionRow record={records[index]} />}
        renderItemHeader={(_, index) => <TransactionHeader record={records[index]} />} />
    </section>
    <section className="ledger-pane ledger-related" aria-labelledby="ledger-related-title">
      <h2 id="ledger-related-title">선택 거래와 연결된 Alert·Episode</h2>
      {transaction ? <>
        <p className="ledger-source" aria-live="polite"><code>{transaction.code}</code></p>
        <LinkedCaseGroups transaction={transaction} caseRows={caseRows} />
      </> : <p className="ledger-empty" role="status">요청한 거래를 찾을 수 없습니다. 소유주를 선택해 계속 조사할 수 있습니다.</p>}
    </section>
    <LedgerConnections owner={owner} account={account} transaction={selected} />
  </div>;
}

export function CaseCards({ codes, label, caseRows }) {
  const reduced = useSyncExternalStore(subscribeAppearance, readReducedMotion);
  const rows = codes.map(code => caseRows.get(code)).filter(Boolean);
  return <section className="screen-section case-list-panel" aria-label={label}>
    <CaseProgressBoard rows={rows} reduced={reduced} />
  </section>;
}

export function mountInvestigation(host, props) {
  const root = createRoot(host);
  const caseRows = new Map(dashboardFixtures(props.groups).cases.map(row => [row.code, row]));
  const ledger = host.dataset.investigationComponent === 'ledger';
  const renderLedger = tableView => root.render(<Ledger {...props} caseRows={caseRows} tableView={tableView} />);
  if (ledger) renderLedger(props.tableView);
  else root.render(<CaseCards {...props} caseRows={caseRows} />);
  return { unmount: () => root.unmount(), setLedgerView: ledger ? renderLedger : undefined };
}
