import React from 'react';
import { Panel } from '@/components/panel';
import { Text } from '@/components/layout-primitives';
import { SectionDownloadHeading } from '@/components/section-download';
import { CaseActorTag, CaseAgeTag, LinkTag, ModelScoreTag, PatternTag } from '@/components/semantic-tags';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { TableFieldLabel, WorkflowTable } from '@/components/workflow-table';
import { csvDownloadEntry } from '@/components/query-controls';
import { workRequestUserName } from '../investigation/preview-work-requests';
import './dashboard-priority-queue.css';

const title = '우선 처리 큐';
const limits = { queue: 8, maxScore: 100 };
const sourceLabels = new Map([['MODEL', '모델'], ['RULE', '룰'], ['BOTH', '모델·룰']]);
const queueColumns = [
  { key: 'ID', label: '업무' },
  { key: 'score', label: '위험 점수' },
  { key: '경과일', label: '경과일' },
  { key: 'pattern', label: '패턴' },
  { key: 'owner', label: '담당자' },
];
const sourceColumn = { key: 'target', label: '탐지 출처' };
const priority = ({ score, elapsed }) => score * elapsed;

export function rankPriorityCases(rows = []) {
  // The live case adapter uses score 0 when the model score is missing.
  return rows.filter(row => Number.isFinite(row.score) && row.score > 0 && row.score <= limits.maxScore &&
    Number.isFinite(row.elapsed) && row.elapsed >= 0)
    .sort((left, right) => priority(right) - priority(left) || right.score - left.score ||
      left.code.localeCompare(right.code))
    .slice(0, limits.queue);
}

export function DashboardPriorityQueue({ rows }) {
  const queue = rankPriorityCases(rows ?? []).map(row => ({
    ...row,
    assigneeLabel: row.assigneeName || workRequestUserName(row.assignee) || '미배정',
    sourceLabel: typeof row.detectionSource === 'string' ? sourceLabels.get(row.detectionSource.toUpperCase()) : undefined,
  }));
  const showSources = queue.some(row => row.sourceLabel);
  const columns = showSources ? [...queueColumns, sourceColumn] : queueColumns;
  const headers = columns.map(({ label }) => label);
  const entries = queue.length ? [csvDownloadEntry(title, 'priority-queue', headers, queue.map(row => {
    const values = [row.code, row.score, row.elapsed, row.pattern ?? '', row.assigneeLabel];
    return showSources ? [...values, row.sourceLabel ?? '미집계'] : values;
  }))] : [];
  const emptyMessage = rows == null ? '우선 처리 업무 집계를 사용할 수 없습니다.'
    : rows.length ? '위험 점수와 경과일이 집계된 업무가 없습니다.'
      : '현재 조회 범위에 표시할 우선 처리 업무가 없습니다.';

  return <Panel as="article" className="dashboard-chart dashboard-priority-queue" aria-label={title}>
    <SectionDownloadHeading entries={entries}>{title}</SectionDownloadHeading>
    {queue.length ? <>
      <Text className="dashboard-note">상위 {queue.length}건 · 위험 점수 × 경과일 높은 순{!showSources && ' · 탐지 출처 미집계'}</Text>
      <WorkflowTable label={`${title} 상위 ${queue.length}건`} title={null} tools={false} scrollbarGutter="auto">
        <TableHeader><TableRow>
          {columns.map(({ key, label }) => <TableHead key={key} scope="col"><TableFieldLabel column={key}>{label}</TableFieldLabel></TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{queue.map(row => <TableRow key={row.code}>
          <TableRowHead><LinkTag code={row.code} /></TableRowHead>
          <TableCell><ModelScoreTag score={row.score} /></TableCell>
          <TableCell><CaseAgeTag days={row.elapsed} showRecent /></TableCell>
          <TableCell>{row.pattern ? <PatternTag>{row.pattern}</PatternTag> : '미집계'}</TableCell>
          <TableCell><CaseActorTag>{row.assigneeLabel}</CaseActorTag></TableCell>
          {showSources && <TableCell>{row.sourceLabel ?? '미집계'}</TableCell>}
        </TableRow>)}</TableBody>
      </WorkflowTable>
    </> : <Text className="dashboard-note">{emptyMessage}</Text>}
  </Panel>;
}
