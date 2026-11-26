import React, { useEffect, useState } from 'react';
import { fetchRules } from '@/api/rules';
import { Panel } from '@/components/panel';
import { Box, Text } from '@/components/layout-primitives';
import { ActionButton } from '@/components/primary-button';
import { SectionDownloadHeading } from '@/components/section-download';
import { csvDownloadEntry } from '@/components/query-controls';
import { LinkTag } from '@/components/semantic-tags';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { TableFieldLabel, WorkflowTable } from '@/components/workflow-table';
import { codeToRuleId, liveRuleRows, refreshLiveRules } from '../rules/live-rule-store';

const titleBase = '룰 운영 적중';
const rankLimit = 5;
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

export function rankOperatingRuleHits(rows) {
  return rows.filter(row => codeToRuleId(row.code) !== undefined && Number.isSafeInteger(row.hitCount) && row.hitCount > 0)
    .toSorted((left, right) => right.hitCount - left.hitCount || left.code.localeCompare(right.code, 'en', { numeric: true }))
    .slice(0, rankLimit);
}

export function DashboardRuleHits({ dataSource }) {
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
  const title = rows.length ? `${titleBase} 상위 ${rows.length}` : titleBase;
  const entries = rows.length ? [csvDownloadEntry(title, `operating-rule-hits-top-${rows.length}`, ['룰 코드', ...columns.map(column => column.label)],
    rows.map(row => [row.code, row.name, row.hitCount, row.lastHitDate]))] : [];

  return <Panel as="article" className="dashboard-chart dashboard-rule-hits">
    <SectionDownloadHeading entries={entries} printLabel={title}>{title}</SectionDownloadHeading>
    <Text className="dashboard-note">{dataSource === 'sample' ? '룰 엔진 샘플의 전체 운영 기록 · 대시보드 조회 기간과 별도' : '전체 운영 기록 · 대시보드 조회 기간과 별도'}</Text>
    {rows.length ? <WorkflowTable label={title} title={null} tools={false} scrollbarGutter="auto">
      <TableHeader><TableRow>{columns.map(({ key, label }) => <TableHead key={key} scope="col"><TableFieldLabel column={key}>{label}</TableFieldLabel></TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.code}>
        <TableRowHead><LinkTag href={`/rules?rule=${encodeURIComponent(row.code)}`} aria-label={`${row.code} ${row.name} 상세 열기`}>{row.name}</LinkTag></TableRowHead>
        <TableCell numeric>{formatCount.format(row.hitCount)}건</TableCell>
        <TableCell>{row.lastHitDate ?? '—'}</TableCell>
      </TableRow>)}</TableBody>
    </WorkflowTable> : visible?.error ? <Box>
      <Text className="dashboard-note" role="status">운영 적중 집계를 불러오지 못했습니다.</Text>
      <ActionButton shape="pill" onClick={() => { setResult(null); setRetry(value => value + 1); }}>다시 시도</ActionButton>
    </Box> : <Text className="dashboard-note" role="status">{visible ? '기록된 운영 적중이 없습니다.' : '운영 적중 집계를 불러오는 중입니다.'}</Text>}
  </Panel>;
}
