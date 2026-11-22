import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CaseDataTable, RecordIdCell } from './case-table-components';
import { Panel } from '../../components/panel';
import { FooterPagination } from '../../components/footer-pagination';
import { CardHeader } from '../../components/card-header';
import { StatusTag } from '../../components/semantic-tags';
import { tableCount, TableFieldLabel } from '../../components/workflow-table';
import './ibm-ledger.css';

const pageSize = 30;
const integer = new Intl.NumberFormat('ko-KR');
const decimal = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });
const columns = ['거래 ID', '원본 거래 시각', '송금 은행 · 계좌', '수취 은행 · 계좌', '지급 금액', '수취 금액', '결제 수단', '원본 라벨'];
const labelText = labeled => labeled ? '세탁 라벨 1' : '세탁 라벨 0';

function dayKey(value) {
  if (!(value instanceof Date)) return value?.slice(0, 10) ?? '';
  if (!Number.isFinite(value.getTime())) return '';
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map(part => String(part).padStart(2, '0')).join('-');
}

function SourceTime({ timestamp }) {
  return <time dateTime={timestamp.replace(' ', 'T')}>{timestamp}</time>;
}

function Money({ amount, currency }) {
  return <>{decimal.format(amount)} <span>{currency}</span></>;
}

function Account({ endpoint }) {
  return <div className="benchmark-account"><span>{endpoint.bank}</span><code>{endpoint.account}</code></div>;
}

function Detail({ record, card = false }) {
  return <Panel className="benchmark-detail" aria-label={card ? record.code : '선택 거래 상세'}>
    <header>
      {card ? <CardHeader code={record.code} /> : <h2>선택 거래 <code>{record.code}</code></h2>}
      <StatusTag preset="neutral">{labelText(record.labeled)}</StatusTag>
    </header>
    <dl>
      <div><dt>원본 거래 시각</dt><dd><SourceTime timestamp={record.timestamp} /></dd></div>
      <div><dt>결제 수단</dt><dd>{record.method}</dd></div>
      <div><dt>송금 은행 · 계좌</dt><dd><Account endpoint={record.from} /></dd></div>
      <div><dt>수취 은행 · 계좌</dt><dd><Account endpoint={record.to} /></dd></div>
      <div><dt>지급 금액</dt><dd><Money amount={record.paidAmount} currency={record.paidCurrency} /></dd></div>
      <div><dt>수취 금액</dt><dd><Money amount={record.receivedAmount} currency={record.receivedCurrency} /></dd></div>
    </dl>
  </Panel>;
}

export function BenchmarkLedger({ dataset, code = '', filters, tableView = true, paginationHost, onVisibleRecordsChange }) {
  const { source, period, totals, records } = dataset;
  const [lookup, setLookup] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [label, setLabel] = useState('labeled');
  const [paging, setPaging] = useState(null);
  const results = useRef(null);
  const from = dayKey(filters?.range?.from);
  const to = dayKey(filters?.range?.to);
  const exactCode = lookup.trim().toUpperCase();
  const days = useMemo(() => [...new Set(records.map(row => row.timestamp.slice(0, 10)))].sort(), [records]);
  const rows = useMemo(() => records.filter(row => {
    const day = row.timestamp.slice(0, 10);
    return (!exactCode || row.code === exactCode) && (!selectedDay || day === selectedDay)
      && (!from || day >= from) && (!to || day <= to)
      && (label === 'all' || row.labeled === (label === 'labeled'));
  }), [records, exactCode, selectedDay, from, to, label]);
  const selected = code ? records.find(row => row.code === code) : null;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const selectedPage = Math.floor(Math.max(0, rows.indexOf(selected)) / pageSize);
  const isCurrentPaging = paging?.code === code && paging.from === from && paging.to === to;
  const shownPage = Math.min(isCurrentPaging ? paging.index : selectedPage, pageCount - 1);
  const visible = rows.slice(shownPage * pageSize, (shownPage + 1) * pageSize);
  const goToPage = index => setPaging({ code, from, to, index });
  const changePage = index => {
    goToPage(index);
    const scrollRegion = results.current.querySelector('.data-table-scroll');
    if (scrollRegion) scrollRegion.scrollTop = 0;
    results.current.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  };

  useEffect(() => { onVisibleRecordsChange?.(rows); }, [onVisibleRecordsChange, rows]);

  return <div className="benchmark-ledger">
    <Panel className="benchmark-scope" aria-label="거래 원장 데이터 범위">
      <div className="benchmark-source">
        <h2>{source} 거래 원장</h2>
        <p>{period.start} ~ {period.end} · 벤치마크 원본 {integer.format(totals.transactions)}건</p>
        <p>세탁 라벨이 1인 거래 전체와 0인 일부 거래를 포함해 총 {integer.format(records.length)}건을 조회할 수 있습니다.
          벤치마크 라벨은 AML RADAR의 분석가 판정이나 모델 점수를 나타내지 않습니다.</p>
      </div>
      <div className="benchmark-filters" role="group" aria-label="벤치마크 원장 조회 조건">
        <label>거래 ID
          <input type="search" value={lookup} spellCheck={false} autoComplete="off" placeholder="정확한 거래 ID 입력"
            onChange={event => { setLookup(event.target.value); goToPage(0); }} />
        </label>
        <label>거래일
          <select value={selectedDay} onChange={event => { setSelectedDay(event.target.value); goToPage(0); }}>
            <option value="">전체 날짜</option>
            {days.map(day => <option key={day} value={day}>{day}</option>)}
          </select>
        </label>
        <label>원본 라벨
          <select value={label} onChange={event => { setLabel(event.target.value); goToPage(0); }}>
            <option value="all">전체 라벨</option>
            <option value="labeled">{labelText(true)}</option>
            <option value="unlabeled">{labelText(false)}</option>
          </select>
        </label>
      </div>
    </Panel>
    {selected && tableView && <Detail record={selected} />}
    {code && !selected && <p className="benchmark-empty" role="status">이 원장에 포함된 거래에서 <code>{code}</code>을 찾을 수 없습니다.</p>}
    <div className="benchmark-ledger-results" ref={results}>
      {tableView ? <CaseDataTable title="벤치마크 거래" summary={tableCount(rows.length)} className="benchmark-table" tools={false}>
        <TableHeader><TableRow>
          {columns.map(title => <TableHead key={title} scope="col">
            <TableFieldLabel column={title}>{title}</TableFieldLabel>
          </TableHead>)}
        </TableRow></TableHeader>
        <TableBody>
          {visible.map(row => <TableRow key={row.code} data-selected={row.code === code || undefined}>
            <RecordIdCell code={row.code} />
            <TableCell><SourceTime timestamp={row.timestamp} /></TableCell>
            <TableCell><Account endpoint={row.from} /></TableCell>
            <TableCell><Account endpoint={row.to} /></TableCell>
            <TableCell className="benchmark-amount"><Money amount={row.paidAmount} currency={row.paidCurrency} /></TableCell>
            <TableCell className="benchmark-amount"><Money amount={row.receivedAmount} currency={row.receivedCurrency} /></TableCell>
            <TableCell>{row.method}</TableCell>
            <TableCell><StatusTag preset="neutral">{labelText(row.labeled)}</StatusTag></TableCell>
          </TableRow>)}
          {!visible.length && <TableRow><TableCell colSpan={columns.length}>조건과 일치하는 거래가 없습니다.</TableCell></TableRow>}
        </TableBody>
      </CaseDataTable> : <div className="benchmark-ledger-cards" aria-label="벤치마크 거래 카드">
        {!visible.length && <p className="benchmark-empty" role="status">조건과 일치하는 거래가 없습니다.</p>}
        {visible.map(row => <Detail key={row.code} record={row} card />)}
      </div>}
    </div>
    <FooterPagination host={paginationHost} label="거래 원장 페이지" page={shownPage}
      pageCount={pageCount} onPageChange={changePage} />
  </div>;
}

export function mountBenchmarkLedger(host, options) {
  const root = createRoot(host);
  const draw = (code, tableView) => root.render(<BenchmarkLedger {...options} code={code} tableView={tableView} />);
  draw(options.code, options.tableView);
  return { showRecord: draw, unmount: () => root.unmount() };
}
