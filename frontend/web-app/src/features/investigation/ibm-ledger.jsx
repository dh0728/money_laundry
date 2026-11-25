import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSelect } from '@/components/ui/select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CaseDataTable, RecordIdCell } from './case-table-components';
import { Panel } from '../../components/panel';
import { ActionButton } from '../../components/primary-button';
import { FooterPagination } from '../../components/footer-pagination';
import { CardHeader } from '../../components/card-header';
import { SearchField } from '../../components/search-field';
import { StatusTag } from '../../components/semantic-tags';
import { csvDownloadEntry, TableQueryTools } from '../../components/query-controls';
import { SectionDownload } from '../../components/section-download';
import { tableCount, TableFieldLabel, WorkflowQueryHeading } from '../../components/workflow-table';
import './ibm-ledger.css';
import { Box, Heading, Text } from '@/components/layout-primitives';

const pageSize = 30;
const integer = new Intl.NumberFormat('ko-KR');
const decimal = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });
const columns = ['거래 ID', '원본 거래 시각', '송금 은행 · 계좌', '수취 은행 · 계좌', '지급 금액', '수취 금액', '결제 수단', '원본 라벨'];
const labelText = labeled => labeled ? '세탁 라벨 1' : '세탁 라벨 0';

function ledgerEntry(label, file, records) {
  const headers = ['거래 코드', '원본 시각', '송금 은행 코드', '송금 계좌', '수취 은행 코드', '수취 계좌',
    '송금 금액', '송금 통화', '수취 금액', '수취 통화', '거래 방식', '원본 세탁 라벨'];
  return csvDownloadEntry(label, file, headers, records.map(row => [
    row.code, row.timestamp, row.from.bank, row.from.account, row.to.bank, row.to.account,
    row.paidAmount, row.paidCurrency, row.receivedAmount, row.receivedCurrency, row.method, Number(row.labeled),
  ]));
}

function dayKey(value) {
  if (!(value instanceof Date)) return value?.slice(0, 10) ?? '';
  if (!Number.isFinite(value.getTime())) return '';
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map(part => String(part).padStart(2, '0')).join('-');
}

function SourceTime({ timestamp }) {
  return <Text as="time" dateTime={timestamp.replace(' ', 'T')}>{timestamp}</Text>;
}

function Money({ amount, currency }) {
  return <>{decimal.format(amount)} <Text as="span">{currency}</Text></>;
}

function Account({ endpoint }) {
  return <Box className="benchmark-account"><Text as="span">{endpoint.bank}</Text><Text as="code">{endpoint.account}</Text></Box>;
}

function Detail({ record, card = false }) {
  return <Panel className="benchmark-detail" aria-label={card ? record.code : '선택 거래 상세'}>
    <Box as="header">
      {card ? <CardHeader code={record.code} /> : <Heading>선택 거래 <Text as="code">{record.code}</Text></Heading>}
      <StatusTag preset="neutral">{labelText(record.labeled)}</StatusTag>
      {!card && <SectionDownload label="선택 거래" entries={[ledgerEntry('선택 거래', record.code, [record])]} />}
    </Box>
    <Box as="dl">
      <Box><Box as="dt">원본 거래 시각</Box><Box as="dd"><SourceTime timestamp={record.timestamp} /></Box></Box>
      <Box><Box as="dt">결제 수단</Box><Box as="dd">{record.method}</Box></Box>
      <Box><Box as="dt">송금 은행 · 계좌</Box><Box as="dd"><Account endpoint={record.from} /></Box></Box>
      <Box><Box as="dt">수취 은행 · 계좌</Box><Box as="dd"><Account endpoint={record.to} /></Box></Box>
      <Box><Box as="dt">지급 금액</Box><Box as="dd"><Money amount={record.paidAmount} currency={record.paidCurrency} /></Box></Box>
      <Box><Box as="dt">수취 금액</Box><Box as="dd"><Money amount={record.receivedAmount} currency={record.receivedCurrency} /></Box></Box>
    </Box>
  </Panel>;
}

export function BenchmarkLedger({ dataset, code = '', filters, tableView = true, paginationHost }) {
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
  const visible = rows.slice(tableView ? shownPage * pageSize : 0, (shownPage + 1) * pageSize);
  const goToPage = index => setPaging({ code, from, to, index });
  const changePage = index => {
    goToPage(index);
    const scrollRegion = results.current.querySelector('.data-table-scroll');
    if (scrollRegion) scrollRegion.scrollTop = 0;
    results.current.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  };

  const download = useMemo(() => rows.length ? ledgerEntry('조회된 원본 원장', 'ibm-hi-small-transactions', rows) : null, [rows]);
  const tools = download && <TableQueryTools actions={{
    panelDownload: false,
    entries: [download],
  }} />;

  return <Box className="benchmark-ledger">
    <Panel className="benchmark-scope" aria-label="거래 원장 데이터 범위">
      <Box className="benchmark-source">
        <Heading>{source} 거래 원장</Heading>
        <Text>{period.start} ~ {period.end} · 벤치마크 원본 {integer.format(totals.transactions)}건</Text>
        <Text>세탁 라벨이 1인 거래 전체와 0인 일부 거래를 포함해 총 {integer.format(records.length)}건을 조회할 수 있습니다.
          벤치마크 라벨은 AML RADAR의 분석가 판정이나 모델 점수를 나타내지 않습니다.</Text>
      </Box>
      <Box className="benchmark-filters" role="group" aria-label="벤치마크 원장 조회 조건">
        <Box className="benchmark-search-group">
          <Text as="span">거래 ID</Text>
          <SearchField variant="compact" label="거래 ID" value={lookup} placeholder="정확한 거래 ID 입력"
            onChange={event => { setLookup(event.target.value); goToPage(0); }} />
        </Box>
        <Box as="label">거래일
          <NativeSelect value={selectedDay} onChange={event => { setSelectedDay(event.target.value); goToPage(0); }}
            options={[{ value: '', label: '전체 날짜' }, ...days.map(day => ({ value: day, label: day }))]} />
        </Box>
        <Box as="label">원본 라벨
          <NativeSelect value={label} onChange={event => { setLabel(event.target.value); goToPage(0); }}
            options={[
              { value: 'all', label: '전체 라벨' },
              { value: 'labeled', label: labelText(true) },
              { value: 'unlabeled', label: labelText(false) },
            ]} />
        </Box>
      </Box>
    </Panel>
    {selected && tableView && <Detail record={selected} />}
    {code && !selected && <Text className="benchmark-empty" role="status">이 원장에 포함된 거래에서 <Text as="code">{code}</Text>을 찾을 수 없습니다.</Text>}
    <Box className="benchmark-ledger-results" ref={results}>
      {tableView ? <CaseDataTable title="벤치마크 거래" summary={tableCount(rows.length)} className="benchmark-table" tools={tools}>
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
      </CaseDataTable> : <>
        <WorkflowQueryHeading title="벤치마크 거래" summary={tableCount(rows.length)} tools={tools} />
        <Box className="benchmark-ledger-cards" aria-label="벤치마크 거래 카드">
        {!visible.length && <Text className="benchmark-empty" role="status">조건과 일치하는 거래가 없습니다.</Text>}
        {visible.map(row => <Detail key={row.code} record={row} card />)}
        {shownPage + 1 < pageCount && <ActionButton shape="pill" surface="floating" onClick={() => goToPage(shownPage + 1)}>
          더 보기
        </ActionButton>}
        </Box>
      </>}
    </Box>
    {tableView && <FooterPagination host={paginationHost} label="거래 원장 페이지" page={shownPage}
      pageCount={pageCount} total={rows.length} onPageChange={changePage} />}
  </Box>;
}

export function mountBenchmarkLedger(host, options) {
  const root = createRoot(host);
  const draw = (code, tableView) => root.render(<BenchmarkLedger {...options} code={code} tableView={tableView} />);
  draw(options.code, options.tableView);
  return { showRecord: draw, unmount: () => root.unmount() };
}
