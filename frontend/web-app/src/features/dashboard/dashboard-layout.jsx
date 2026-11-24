import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import MagicBento from '../../components/react-bits/MagicBento';
import { Panel } from '../../components/panel';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { CaseProgressLanes } from '../investigation/preview-case-card';
import { readWorkspaceGap } from './workspace-metrics';
import './preview-dashboard.css';
import { Box, Grid, Stack, Text } from '@/components/layout-primitives';

export function DashboardMetricGrid({ items, appearance, loading = false }) {
  return <Box className="dashboard-metrics-box">
    <MagicBento key={String(appearance.reduced)} className="dashboard-metrics" items={items}
      columns={2} gap={readWorkspaceGap()} rowHeight={0}
      theme={appearance.theme} disableAnimations={loading || appearance.reduced} intro={false} textAutoHide={false}
      enableTilt={false} enableBorderGlow={false} enableSpotlight={false} clickEffect={false} enableStars={false} />
  </Box>;
}

export function DashboardIndicatorsGrid({ children, ...props }) {
  return <Grid as="section" columns={12} className="dashboard-priority-metrics" {...props}>{children}</Grid>;
}

export function PersonalDashboardOverview({ children, recommendation, ...props }) {
  return <Grid columns={12} className="dashboard-personal-overview" {...props}>
    <Grid as="section" columns={2} className="dashboard-personal-metrics" aria-label="내 우선 업무 지표">
      {children}
    </Grid>
    {recommendation}
  </Grid>;
}

function LoadingChart({ className = '', chartClass = 'dashboard-proportion-band', children, showNote = true }) {
  return <Panel as="article" className={`dashboard-chart ${className}`.trim()}>
    <Skeleton className="dashboard-loading-title" />
    {showNote && <Skeleton className="dashboard-loading-note" />}
    {children ?? <Skeleton className={chartClass} />}
  </Panel>;
}

function LoadingSeries({ className }) {
  return <LoadingChart className={className}>
    <Skeleton className="dashboard-loading-note" />
    <Box className="dashboard-series">
      <Skeleton className="dashboard-series-plot" />
    </Box>
  </LoadingChart>;
}

function LoadingMetric({ detail, trend, composition }) {
  return <Box className="dashboard-metric">
    <Skeleton className="dashboard-loading-title" />
    <Skeleton className="dashboard-loading-value" />
    {detail && <Skeleton className="dashboard-loading-note" />}
    {composition && <Stack className="dashboard-workload-composition">
      <Skeleton className="dashboard-score-band dashboard-workload-bar" />
      <Skeleton className="dashboard-loading-note" />
    </Stack>}
    {trend && <Skeleton className="dashboard-loading-trend" />}
  </Box>;
}

function LoadingRecommendation({ reduced }) {
  return <AISummaryPanel as="section" reduced={reduced} className="dashboard-priority-panel">
    <Skeleton className="dashboard-loading-title" />
    <Stack>
      <Skeleton className="dashboard-loading-note" />
      <Skeleton className="dashboard-loading-recommendation-plot" />
      <Skeleton className="dashboard-loading-note" />
      <Skeleton className="dashboard-loading-note" />
    </Stack>
  </AISummaryPanel>;
}

export function DashboardAnalyticsSkeleton({ reduced }) {
  return <Box className="dashboard-analytics dashboard-loading dashboard-workflow-charts" aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">대시보드 차트 불러오는 중</Text>
    <Box aria-hidden="true" className="dashboard-analytics">
      <Grid columns={12} className="dashboard-flow-family dashboard-work-overview-grid">
        <LoadingChart className="dashboard-transaction-flow" chartClass="staged-sankey-chart" />
        <LoadingSeries className="dashboard-flow-volume" />
        <LoadingChart className="dashboard-flow-risk">
          <Skeleton className="dashboard-score-band" />
          <Grid columns={3} className="dashboard-score-legend">
            <Skeleton className="dashboard-loading-note" />
            <Skeleton className="dashboard-loading-note" />
            <Skeleton className="dashboard-loading-note" />
          </Grid>
        </LoadingChart>
        <LoadingRecommendation reduced={reduced} />
      </Grid>
      <LoadingChart className="dashboard-investigation-flow" chartClass="staged-sankey-chart" />
      <Grid columns={12} className="dashboard-flow-status-grid">
        <LoadingSeries className="dashboard-flow-status" />
        <LoadingSeries className="dashboard-flow-status" />
      </Grid>
    </Box>
  </Box>;
}

export function DashboardSkeleton({ mine, appearance, benchmark = false }) {
  if (benchmark) return <BenchmarkDashboardSkeleton mine={mine} appearance={appearance} />;
  const indicators = mine ? ['workload', 'high-risk-alert', 'overdue', 'high-risk-episode'] : ['incoming', 'suspect', 'alerts'];
  const cards = indicators.map((indicator, index) => <Panel as="article" className="dashboard-priority-metric" key={indicator}>
    <LoadingMetric detail={mine ? index > 0 : index === 1} trend={!mine || index > 0} composition={mine && index === 0} />
  </Panel>);
  return <Box className="preview-dashboard dashboard-loading" data-mine={mine} aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">대시보드 불러오는 중</Text>
    {mine ? <PersonalDashboardOverview aria-hidden="true" recommendation={<LoadingRecommendation reduced={appearance.reduced} />}>
      {cards}
    </PersonalDashboardOverview> : <>
      <DashboardIndicatorsGrid aria-hidden="true">{cards}</DashboardIndicatorsGrid>
      <DashboardAnalyticsSkeleton reduced={appearance.reduced} />
    </>}
    <DashboardBoardSkeleton />
  </Box>;
}

function BenchmarkDashboardSkeleton({ mine, appearance }) {
  const items = Array.from({ length: 4 }, (_, index) => ({
    id: index,
    content: <LoadingMetric detail={index >= 2} />,
  }));
  return <Box className="preview-dashboard dashboard-loading" data-mine={mine} aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">대시보드 불러오는 중</Text>
    {mine && <Panel as="article" className="dashboard-personal-status" aria-hidden="true">
      <Skeleton className="dashboard-loading-title" />
      <Skeleton className="dashboard-loading-note" />
    </Panel>}
    <Box className="dashboard-top" aria-hidden="true">
      <Panel as="article" className="dashboard-summary-card">
        <Skeleton className="dashboard-loading-title" />
        <Skeleton className="dashboard-loading-value" />
        <Skeleton className="dashboard-loading-note" />
      </Panel>
      <DashboardMetricGrid items={items} appearance={appearance} loading />
    </Box>
    <BenchmarkAnalyticsSkeleton />
  </Box>;
}

export function BenchmarkAnalyticsSkeleton({ showPatterns = true } = {}) {
  return <Box className="dashboard-analytics dashboard-loading" aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">대시보드 차트 불러오는 중</Text>
    <Box className="dashboard-analytics-row">
      <LoadingChart chartClass="dashboard-bklit-series" showNote={false} />
      <LoadingChart chartClass="dashboard-bklit-series" />
    </Box>
    <LoadingChart>
      <Box className="dashboard-transaction-details">
        <Box className="dashboard-transaction-breakdown">
          <Box className="dashboard-composition-chart">
            <Skeleton className="dashboard-loading-note" />
            <Skeleton className="dashboard-proportion-band" />
          </Box>
        </Box>
        {showPatterns && <Box className="dashboard-transaction-breakdown">
          <Skeleton className="dashboard-loading-note" />
          <Skeleton className="dashboard-pattern-bars" />
        </Box>}
      </Box>
    </LoadingChart>
  </Box>;
}

export function DashboardBoardSkeleton() {
  return <Box className="dashboard-board dashboard-loading" aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">업무 현황 불러오는 중</Text>
    <Box className="dashboard-board-heading"><Skeleton className="dashboard-loading-title" /></Box>
    <CaseProgressLanes renderLane={({ preset }) => <LoadingLane key={preset} />} />
  </Box>;
}

function LoadingLane() {
  return <Panel className="case-progress-lane">
    <Skeleton className="dashboard-loading-title" />
    <Skeleton className="dashboard-loading-card" />
  </Panel>;
}
