import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { CaseDataTable, RecordIdCell } from './case-table-components';
import { ModelScoreTag, ReviewStatusTag, reviewStatusLabel, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import { currencyColumn, SortableTableHead, tableCount,
  recordRowProps, useTableSelection, useTableSort } from '../../components/workflow-table';
import { csvDownloadEntry, dateFromCode, inDateRange, TableQueryTools } from '../../components/query-controls';
import { Box, Text } from '@/components/layout-primitives';

const columns = [
  { name: '거래', value: row => row.code },
  { name: '시각', value: row => row.timestamp },
  { name: '송금 계좌', value: row => row.from.code },
  { name: '수취 계좌', value: row => row.to.code },
  { name: '금액', ...currencyColumn(row => ({ [row.currency]: row.amount })) },
  { name: '결제 수단', value: row => row.method },
  { name: '조사 상태', value: row => reviewStatusLabel(row.status) },
];
const formatAmount = new Intl.NumberFormat('ko-KR');
const scoreColumn = { name: '모델 점수', value: row => row.score };

const analysisColumns = [
  columns[0], scoreColumn, columns[1], columns[2],
  { name: '송금 소유주', value: row => row.from.owner ?? null },
  columns[3], { name: '수취 소유주', value: row => row.to.owner ?? null },
  ...columns.slice(4, 6), { name: '판정', value: row => verdictLabels[row.verdict] }, columns[6],
];

export function TransactionEvidenceTable({ title, transactions = [], showScore = false, analysis = false,
  linkedSelection, selectionControl, highlightedCodes }) {
  const scoresVisible = showScore || analysis;
  const headers = analysis ? analysisColumns : scoresVisible ? [columns[0], scoreColumn, ...columns.slice(1)] : columns;
  const [method, setMethod] = useState('all');
  const [range, setRange] = useState();
  const methods = [...new Set(transactions.map(row => row.method))];
  const activeMethod = methods.includes(method) ? method : 'all';
  const sorting = useTableSort(transactions.filter(row => (activeMethod === 'all' || row.method === activeMethod)
    && inDateRange(dateFromCode(row.code), range)));
  const selection = useTableSelection(sorting.rows, undefined, linkedSelection, selectionControl);
  const lastCode = transactions.map(row => row.code).sort().at(-1);
  const actions = {
    filter: methods.length > 1 ? { label: '결제 수단', value: activeMethod, onChange: setMethod,
      options: ['전체', ...methods].map((label, index) => ({ label, value: index ? label : 'all' })) } : undefined,
    period: lastCode ? { asOf: dateFromCode(lastCode), range, onChange: setRange } : undefined,
    entries: sorting.rows.length ? [csvDownloadEntry('표시 중인 근거 거래', 'evidence-transactions', [
      '거래', ...(scoresVisible ? ['모델 점수'] : []), '시각', '송금 계좌', ...(analysis ? ['송금 소유주'] : []),
      '수취 계좌', ...(analysis ? ['수취 소유주'] : []), '금액', '통화', '결제 수단', '판정', '조사 상태',
    ], sorting.rows.map(row => [
      row.code, ...(scoresVisible ? [row.score ?? ''] : []), row.timestamp, row.from.code, ...(analysis ? [row.from.owner ?? ''] : []),
      row.to.code, ...(analysis ? [row.to.owner ?? ''] : []),
      row.amount, row.currency, row.method, analysis ? verdictLabels[row.verdict] : row.verdict, reviewStatusLabel(row.status),
    ]))] : [],
  };
  return <Box as="section" className="screen-section screen-table case-evidence-table">
    <CaseDataTable title={title} summary={tableCount(sorting.rows.length, transactions.length, '건', selection.selectedCount)}
      className="screen-table-scroll" selection={selection} tools={lastCode ? <TableQueryTools actions={actions} /> : false}>
      <TableHeader><TableRow>
        {headers.map(({ name, ...options }) => <SortableTableHead key={name} sorting={sorting} column={name} {...options}>
          {name}
        </SortableTableHead>)}
      </TableRow></TableHeader>
      <TableBody>
        {sorting.rows.map(({ code, timestamp, from, to, amount, currency, method, status, verdict, score }) =>
          <TableRow key={code} data-verdict={verdict} data-selected={selection.has(code) || undefined}
            related={highlightedCodes?.has(code)} {...recordRowProps}>
            <RecordIdCell code={code} />
            {scoresVisible && <TableCell>{Number.isFinite(score)
              ? <ModelScoreTag score={score} /> : '—'}</TableCell>}
            <TableCell><Text as="time" dateTime={timestamp.replace(' ', 'T') + '+09:00'}>{timestamp}</Text></TableCell>
            <TableCell><Text as="code">{from.code}</Text></TableCell>
            {analysis && <TableCell>{from.owner || '—'}</TableCell>}
            <TableCell><Text as="code">{to.code}</Text></TableCell>
            {analysis && <TableCell>{to.owner || '—'}</TableCell>}
            <TableCell numeric>{formatAmount.format(amount)} {currency}</TableCell>
            <TableCell>{method}</TableCell>
            {analysis ? <>
              <TableCell><VerdictTag verdict={verdict} /></TableCell>
              <TableCell><ReviewStatusTag status={status} /></TableCell>
            </> : <TableCell><Box className="semantic-tag-group">
              <VerdictTag verdict={verdict} /><ReviewStatusTag status={status} />
            </Box></TableCell>}
          </TableRow>)}
        {!sorting.rows.length && <TableRow><TableCell colSpan={headers.length}>
          {transactions.length ? '조회 조건과 일치하는 거래가 없습니다.' : '연결된 거래가 없습니다.'}
        </TableCell></TableRow>}
      </TableBody>
    </CaseDataTable>
  </Box>;
}

export function mountTransactionEvidenceTable(host, transactions) {
  const root = createRoot(host);
  const title = host.dataset.caseEvidence;
  const update = (rows, linkedSelection) => root.render(<TransactionEvidenceTable title={title} transactions={rows}
    linkedSelection={linkedSelection} />);
  update(transactions);
  return { update, unmount: () => root.unmount() };
}
