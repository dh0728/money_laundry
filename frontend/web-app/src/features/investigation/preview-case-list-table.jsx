import React, { useEffect, useRef, useState } from 'react';
import { FooterPagination } from '../../components/footer-pagination';
import { createRoot } from 'react-dom/client';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { CaseDataTable, RecordIdCell } from './case-table-components';
import { CaseActorTag, ModelScoreTag, PatternTag, ReviewStatusTag, reviewStatusLabel, VerdictTag } from '../../components/semantic-tags';
import { currencyColumn, SortableTableHead, tableCount,
  recordRowProps, useTableSelection, useTableSort } from '../../components/workflow-table';
import { Box, LineBreak, Text } from '@/components/layout-primitives';
import { caseAssigneeLabel } from './case-assignee';

const flowsFor = records => [...new Set(records.map(({ from, to }) => `${from.code} → ${to.code}`))];
const timesFor = records => records.map(record => record.timestamp).sort();
const columns = [
  { name: 'ID', value: row => row.code },
  { name: '패턴', value: row => row.pattern },
  { name: '모델 점수·사람 판정', compactName: '점수·판정', label: '모델 점수', value: row => row.score },
  { name: '담당자', value: caseAssigneeLabel },
  { name: '업무 상태', value: row => reviewStatusLabel(row.status) },
  { name: '경과일', value: row => row.open ? row.elapsed : null },
  { name: '계좌 흐름', value: row => flowsFor(row.related).join(' ') || null },
  { name: '기간 · KST', value: row => timesFor(row.related)[0] },
];
const measures = [
  { name: '거래 건수', value: row => row.related.length },
  { name: '거래 금액', ...currencyColumn(row => row.amountByCurrency) },
];
const episodeMeasures = [
  { name: '거래가 겹치는 Alert 수', compactName: '겹친 Alert', value: row => row.linkedAlerts },
  { name: '관련 계좌 수', compactName: '관련 계좌', value: row => row.relatedAccounts },
];
const number = new Intl.NumberFormat('ko-KR');

function EvidencePeriod({ records }) {
  if (!records.length) return '미제공';
  const times = timesFor(records);
  const start = times[0];
  const end = times.at(-1);
  const time = value => <Text as="time" dateTime={value.replace(' ', 'T') + '+09:00'}>{value}</Text>;
  return <>{time(start)}{start !== end && <><LineBreak />{time(end)}</>}</>;
}

function AccountFlows({ records }) {
  const flows = flowsFor(records);
  if (!flows.length) return '미제공';
  return <>{flows.slice(0, 2).map(flow => <Text as="code" key={flow}>{flow}</Text>)}
    {flows.length > 2 && <Text as="small">외 {flows.length - 2}개 흐름</Text>}</>;
}

/** pageSize를 주면 표 정렬까지 적용한 전체 결과를 먼저 구한 뒤 페이지로 나눈다. 정렬을 바꾸면 첫 페이지로 돌아간다. */
export function PreviewCaseTable({ title, rows, episode = false, totalCount = rows.length, pageSize, initialPage = 0, onPageChange,
  paginationHost }) {
  const scope = episode ? 'episodes' : 'alerts';
  const sorting = useTableSort(rows, scope);
  const selection = useTableSelection(sorting.rows, scope);
  const sortKey = `${sorting.active?.column ?? ''}:${sorting.active?.direction ?? 0}`;
  const [paging, setPaging] = useState(() => ({ key: sortKey, page: initialPage }));
  const frame = useRef(null);
  const paged = pageSize > 0;
  const pageCount = paged ? Math.max(1, Math.ceil(sorting.rows.length / pageSize)) : 1;
  const page = Math.min(paging.key === sortKey ? paging.page : 0, pageCount - 1);
  const visibleRows = paged ? sorting.rows.slice(page * pageSize, (page + 1) * pageSize) : sorting.rows;
  const changePage = next => {
    setPaging({ key: sortKey, page: next });
    onPageChange?.(next);
    const scrollRegion = frame.current?.querySelector('.data-table-scroll');
    if (scrollRegion) scrollRegion.scrollTop = 0;
    window.scrollTo?.(0, 0);
  };
  useEffect(() => {
    if (paging.key !== sortKey && paging.page !== 0) onPageChange?.(0);
  }, [paging.key, paging.page, sortKey, onPageChange]);
  const numericHeadings = episode ? [...episodeMeasures, ...measures] : measures;
  const headings = [...columns, ...numericHeadings];
  return <Box ref={frame} className="case-table-pages"><CaseDataTable title={title}
    summary={tableCount(rows.length, totalCount, '건', selection.selectedCount)} className="entry-list" selection={selection} compact={episode}>
      <TableHeader><TableRow>
        {headings.map(({ name, compactName, ...options }) =>
          <SortableTableHead key={name} sorting={sorting} column={name} label={options.label ?? name} {...options}>
            {episode ? compactName ?? name : name}
          </SortableTableHead>)}
      </TableRow></TableHeader>
      <TableBody>
        {visibleRows.map(row => {
          const { code, verdict, pattern, score, status, elapsed, open, related, relatedAccounts, linkedAlerts, amountByCurrency } = row;
          const totals = Object.entries(amountByCurrency);
          return <TableRow key={code} data-verdict={verdict} data-selected={selection.has(code) || undefined} {...recordRowProps}>
            <RecordIdCell code={code} />
            <TableCell><PatternTag emphasis="solid">{pattern}</PatternTag></TableCell>
            <TableCell><Box className="semantic-tag-group"><VerdictTag verdict={verdict} /><ModelScoreTag score={score} /></Box></TableCell>
            <TableCell><CaseActorTag>{caseAssigneeLabel(row)}</CaseActorTag></TableCell>
            <TableCell><ReviewStatusTag status={status} /></TableCell>
            <TableCell>{open ? `${elapsed}일` : '—'}</TableCell>
            <TableCell stacked><AccountFlows records={related} /></TableCell>
            <TableCell><EvidencePeriod records={related} /></TableCell>
            {episode && <>
              <TableCell numeric>{linkedAlerts}건</TableCell>
              <TableCell numeric>{relatedAccounts}개</TableCell>
            </>}
            <TableCell numeric>{related.length}건</TableCell>
            <TableCell numeric stacked>
              {totals.length ? totals.map(([currency, amount]) => <Text as="span" key={currency}>{number.format(amount)} {currency}</Text>) : '미제공'}
            </TableCell>
          </TableRow>;
        })}
        {!rows.length && <TableRow><TableCell colSpan={headings.length}>조회 조건과 일치하는 항목이 없습니다.</TableCell></TableRow>}
      </TableBody>
    </CaseDataTable>
    {paged && <FooterPagination host={paginationHost} label={`${title} 페이지`} page={page} pageCount={pageCount} total={sorting.rows.length}
      onPageChange={changePage} alwaysShow />}
  </Box>;
}

export function mountPreviewCaseTable(host, title, rows, episode, totalCount, paging = {}) {
  const root = createRoot(host);
  root.render(<PreviewCaseTable title={title} rows={rows} episode={episode} totalCount={totalCount} {...paging} />);
  return () => root.unmount();
}
