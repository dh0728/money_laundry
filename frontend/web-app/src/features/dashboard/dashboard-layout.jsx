import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import MagicBento from '../../components/react-bits/MagicBento';
import { Panel } from '../../components/panel';
import { CaseProgressLanes } from '../investigation/preview-case-card';
import { readWorkspaceGap } from './workspace-metrics';
import './preview-dashboard.css';

// Tetris-style packer on a columns-wide occupancy grid. Blocks (the AI summary) are placed first;
// each cell then drops into the first free slot (row-major), takes ceil(run / k) of the free run so the
// run is shared by the k cells that still fit at minSpan, and fills holes left beside taller cells.
// Returns explicit 1-based { colStart, colSpan, rowStart, rowSpan } so no CSS auto-flow can leave gaps.
export function packBento(cells, { columns = 12, minSpan = 3, blocks = [] } = {}) {
  const taken = [];
  const free = (row, col) => !taken[row]?.[col];
  const mark = (row, col, rowSpan, colSpan) => {
    for (let r = row; r < row + rowSpan; r += 1) {
      taken[r] ??= [];
      for (let c = col; c < col + colSpan; c += 1) taken[r][c] = true;
    }
  };
  blocks.forEach(block => mark(block.row, block.col, block.rowSpan, block.colSpan));
  const runAt = (row, col, rowSpan) => {
    let length = 0;
    while (col + length < columns && Array.from({ length: rowSpan }, (_, r) => free(row + r, col + length)).every(Boolean)) length += 1;
    return length;
  };
  return cells.map((cell, index) => {
    const rowSpan = Math.max(1, cell.rowSpan ?? 1);
    for (let row = 0; ; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        if (!free(row, col)) continue;
        const run = runAt(row, col, rowSpan);
        if (run === 0) continue;
        const fit = Math.max(1, Math.min(cells.length - index, Math.floor(run / minSpan)));
        const colSpan = Math.ceil(run / fit);
        mark(row, col, rowSpan, colSpan);
        return { colStart: col + 1, colSpan, rowStart: row + 1, rowSpan };
      }
    }
  });
}

const wideLayout = { columns: 12, minSpan: 3, blocks: [{ row: 0, col: 0, rowSpan: 2, colSpan: 4 }] };

export function DashboardMetricGrid({ items, wide = false, appearance, loading = false }) {
  const placed = wide ? packBento(items, wideLayout) : [];
  return <div className="dashboard-metrics-box" data-wide={wide}>
    <MagicBento key={String(appearance.reduced)} className="dashboard-metrics" items={items.map((item, index) => ({
      ...item,
      ...(wide ? placed[index] : { colSpan: 1, rowSpan: 1 }),
    }))} columns={wide ? wideLayout.columns : 2} fixedColumns={wide} gap={readWorkspaceGap()} rowHeight={0}
      theme={appearance.theme} disableAnimations={loading || appearance.reduced} intro={false} textAutoHide={false}
      enableTilt={false} enableBorderGlow={false} enableSpotlight={false} clickEffect={false} enableStars={false}
      style={{ '--mb-ink': 'var(--text)', '--mb-muted': 'var(--muted-text)' }} />
  </div>;
}

function LoadingChart({ chartClass = 'dashboard-proportion-band', children, showNote = true }) {
  return <Panel as="article" className="dashboard-chart">
    <Skeleton className="dashboard-loading-title" />
    {showNote && <Skeleton className="dashboard-loading-note" />}
    {children ?? <Skeleton className={chartClass} />}
  </Panel>;
}

function LoadingDonut({ legendRows }) {
  return <div className="dashboard-risk-chart">
    <Skeleton className="dashboard-loading-donut" />
    <div className="dashboard-loading-legend" style={{ width: 'min(100%, 9rem)' }}>
      {Array.from({ length: legendRows }, (_, index) => <Skeleton key={index} className="dashboard-loading-label" />)}
    </div>
  </div>;
}

function LoadingDailyCharts() {
  return <div className="dashboard-analytics-row">
    <LoadingChart chartClass="dashboard-bklit-series" showNote={false} />
    <LoadingChart chartClass="dashboard-bklit-series" />
  </div>;
}

export function DashboardSkeleton({ mine, appearance, benchmark = false }) {
  const items = Array.from({ length: benchmark ? 4 : mine ? 2 : 8 }, (_, index) => ({
    id: index,
    content: <div className="dashboard-metric">
      <Skeleton className="dashboard-loading-title" />
      <Skeleton className="dashboard-loading-value" />
      {(benchmark ? index >= 2 : mine || ![0, 3].includes(index)) && <Skeleton className="dashboard-loading-note" />}
      {!benchmark && <Skeleton className="dashboard-loading-trend" />}
    </div>,
  }));
  return <div className="preview-dashboard dashboard-loading" data-mine={mine} aria-busy="true">
    <span className="visually-hidden" role="status">대시보드 불러오는 중</span>
    {benchmark && mine && <Panel as="article" className="dashboard-personal-status" aria-hidden="true">
      <Skeleton className="dashboard-loading-title" />
      <Skeleton className="dashboard-loading-note" />
    </Panel>}
    <div className="dashboard-top" aria-hidden="true">
      <Panel as="article" className="dashboard-summary-card">
        <Skeleton className="dashboard-loading-title" />
        <Skeleton className="dashboard-loading-value" />
        <Skeleton className="dashboard-loading-note" />
        {!benchmark && <>
          <Skeleton className="dashboard-loading-trend" />
          <Skeleton className="dashboard-loading-note dashboard-loading-period" />
        </>}
      </Panel>
      <DashboardMetricGrid items={items} wide={!benchmark && !mine} appearance={appearance} loading />
    </div>
    {(!mine || benchmark) && <DashboardAnalyticsSkeleton benchmark={benchmark} />}
    {!benchmark && <DashboardBoardSkeleton />}
  </div>;
}

export function DashboardAnalyticsSkeleton({ benchmark = false, showPatterns = true } = {}) {
  return <div className="dashboard-analytics dashboard-loading" aria-busy="true">
    <span className="visually-hidden" role="status">대시보드 차트 불러오는 중</span>
    {benchmark && <LoadingDailyCharts />}
    <LoadingChart>
      <div className="dashboard-transaction-details">
        <div className="dashboard-transaction-breakdown">
          {benchmark ? <div className="dashboard-composition-chart">
            <Skeleton className="dashboard-loading-note" />
            <Skeleton className="dashboard-proportion-band" />
          </div> : <LoadingDonut legendRows={2} />}
        </div>
        {(!benchmark || showPatterns) && <div className="dashboard-transaction-breakdown">
          <Skeleton className="dashboard-loading-note" />
          <Skeleton className="dashboard-pattern-bars" />
        </div>}
      </div>
    </LoadingChart>
    {!benchmark && <>
      <div className="dashboard-analytics-row dashboard-detection-row">
        <LoadingChart showNote={false}><LoadingDonut legendRows={3} /></LoadingChart>
        <LoadingChart chartClass="dashboard-bklit-series" />
      </div>
      <LoadingChart chartClass="dashboard-bklit-series" />
    </>}
  </div>;
}

export function DashboardBoardSkeleton() {
  return <div className="dashboard-board dashboard-loading" aria-busy="true">
    <span className="visually-hidden" role="status">업무 현황 불러오는 중</span>
    <div className="dashboard-board-heading"><Skeleton className="dashboard-loading-title" /></div>
    <CaseProgressLanes renderLane={({ preset }) => <LoadingLane key={preset} />} />
  </div>;
}

function LoadingLane() {
  return <Panel className="case-progress-lane">
    <Skeleton className="dashboard-loading-title" />
    <Skeleton className="dashboard-loading-card" />
  </Panel>;
}
