import React, { useEffect, useState } from 'react';
import { fetchRules } from '@/api/rules';
import { Panel } from '@/components/panel';
import { Box, Text } from '@/components/layout-primitives';
import { ActionButton } from '@/components/primary-button';
import { SectionDownloadHeading } from '@/components/section-download';
import { csvDownloadEntry } from '@/components/query-controls';
import { LinkTag } from '@/components/semantic-tags';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { recordRowProps, TableFieldLabel, WorkflowTable } from '@/components/workflow-table';
import { codeToRuleId, liveRuleRows, refreshLiveRules } from '../rules/live-rule-store';

const rankLimit = 5;
const title = `룰 운영 적중 상위 ${rankLimit}`;
const refreshAfterMs = 60_000;
const formatCount = new Intl.NumberFormat('ko-KR');
const columns = [
  { key: 'rule', label: '룰' },
  { key: 'value', label: '운영 적중' },
  { key: 'date', label: '최근 적중일' },
];
let sampleRequest;
let liveRequest;
let cachedLiveRows;
let liveReadAt = 0;

function saveLiveRows(rows) {
  liveReadAt = Date.now();
  cachedLiveRows = rows;
  return rows;
}

function readRuleRows(dataSource) {
  if (dataSource === 'sample') {
    sampleRequest ??= fetchRules().then(result => result.content).catch(error => { sampleRequest = undefined; throw error; });
    return sampleRequest;
  }
  const sharedRows = liveRuleRows();
  if (sharedRows !== cachedLiveRows && (sharedRows.length || cachedLiveRows)) return Promise.resolve(saveLiveRows(sharedRows));
  if (cachedLiveRows && Date.now() - liveReadAt < refreshAfterMs) return Promise.resolve(cachedLiveRows);
  liveRequest ??= refreshLiveRules().then(result => saveLiveRows(result.content)).finally(() => { liveRequest = undefined; });
  return liveRequest;
}

const isOperatingRule = row => row.hitCount > 0 || (Number.isSafeInteger(row.operatingVersionNo) && row.operatingVersionNo > 0);

export function rankOperatingRuleHits(rows) {
  const ranked = rows.map(row => ({ row, id: codeToRuleId(row.code) }))
    .filter(({ row, id }) => Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(row.hitCount) && row.hitCount >= 0 &&
      isOperatingRule(row))
    .sort((left, right) => right.row.hitCount - left.row.hitCount || left.id - right.id);
  const distinct = new Set();
  return ranked.filter(({ id }) => {
    if (distinct.has(id)) return false;
    distinct.add(id);
    return true;
  }).slice(0, rankLimit).map(({ row }) => row);
}

// 적중 수는 지금까지의 누적만 있다. 지난 기준일(asOfDate)을 볼 때도 같은 값을 보이고 그 사실을 적는다.
export function DashboardRuleHits({ dataSource, asOfDate }) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    readRuleRows(dataSource).then(
      rows => { if (active) setResult({ dataSource, rows: rankOperatingRuleHits(rows) }); },
      () => { if (active) setResult({ dataSource, error: true }); },
    );
    return () => { active = false; };
  }, [dataSource, retry]);

  const visible = result?.dataSource === dataSource ? result : null;
  const rows = visible?.rows ?? [];
  const entries = rows.length ? [csvDownloadEntry(title, `operating-rule-hits-top-${rankLimit}`, ['룰 코드', ...columns.map(column => column.label)],
    rows.map(row => [row.code, row.name, row.hitCount, row.hitCount > 0 ? row.lastHitDate : null]))] : [];

  return <Panel as="article" fillContent className="dashboard-chart dashboard-rule-hits">
    <SectionDownloadHeading entries={entries} printLabel={title}>{title}</SectionDownloadHeading>
    <Text className="dashboard-note">{dataSource === 'sample' ? '샘플 전체 운영 기록' : '전체 운영 기록'} · {asOfDate ? '지금까지 누적 · 기준일과 별도' : '조회 기간과 별도'}</Text>
    {rows.length ? <WorkflowTable label={title} title={null} tools={false} scrollbarGutter="auto" fill>
      <TableHeader><TableRow>{columns.map(({ key, label }) => <TableHead key={key} scope="col"><TableFieldLabel column={key}>{label}</TableFieldLabel></TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.code} {...recordRowProps}>
        <TableRowHead><LinkTag href={`/rules?rule=${encodeURIComponent(row.code)}`} aria-label={`${row.code} ${row.name} 상세 열기`}>{row.name}</LinkTag></TableRowHead>
        <TableCell numeric>{formatCount.format(row.hitCount)}건</TableCell>
        <TableCell>{(row.hitCount > 0 ? row.lastHitDate : null) ?? '—'}</TableCell>
      </TableRow>)}</TableBody>
    </WorkflowTable> : visible?.error ? <Box>
      <Text className="dashboard-note" role="status">운영 적중 집계를 불러오지 못했습니다.</Text>
      <ActionButton shape="pill" onClick={() => { setResult(null); setRetry(value => value + 1); }}>다시 시도</ActionButton>
    </Box> : <Text className="dashboard-note" role="status">{visible ? '표시할 운영 룰이 없습니다.' : '운영 적중 집계를 불러오는 중입니다.'}</Text>}
  </Panel>;
}
