import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import MagicBento from '../../components/react-bits/MagicBento';
import { Panel } from '../../components/panel';
import { SectionDownloadHeading } from '../../components/section-download';
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

export function InstitutionMetricsGrid({ children, ...props }) {
  return <Grid as="section" columns={12} className="dashboard-institution-metrics" {...props}>{children}</Grid>;
}

export function PersonalDashboardOverview({ children, recommendation, ...props }) {
  return <Grid columns={12} className="dashboard-personal-overview" {...props}>
    <Grid as="section" columns={2} className="dashboard-personal-work" aria-label="내 담당 업무와 처리 기록">
      {children}
    </Grid>
    {recommendation}
  </Grid>;
}

function LoadingChart({ className = '', chartClass = 'dashboard-proportion-band', children, showNote = true, showTools = false }) {
  const title = <Skeleton className="dashboard-loading-title" />;
  return <Panel as="article" className={`dashboard-chart ${className}`.trim()}>
    {showTools ? <Stack>
      {title}
      <Skeleton className="dashboard-loading-note dashboard-loading-actions" />
    </Stack> : title}
    {showNote && <Skeleton className="dashboard-loading-note" />}
    {children ?? <Skeleton className={chartClass} />}
  </Panel>;
}

function LoadingSeries({ className }) {
  return <LoadingChart className={className}>
    <Skeleton className="dashboard-loading-note dashboard-loading-series-legend" />
    <Box className="dashboard-series">
      <Skeleton className="dashboard-series-plot" />
    </Box>
  </LoadingChart>;
}

function LoadingStaffChart() {
  return <LoadingChart className="dashboard-priority-metric dashboard-staff-metric">
    <Skeleton className="dashboard-loading-note dashboard-loading-staff-legend" />
    <Skeleton className="dashboard-loading-staff-plot" />
  </LoadingChart>;
}

function LoadingMetric({ detail, trend }) {
  return <Box className="dashboard-metric">
    <Skeleton className="dashboard-loading-title" />
    <Skeleton className="dashboard-loading-value" />
    {detail && <Skeleton className="dashboard-loading-note" />}
    {trend && <Skeleton className="dashboard-loading-trend" />}
  </Box>;
}

function LoadingInstitutionMetrics() {
  return <InstitutionMetricsGrid>
    {Array.from({ length: 6 }, (_, index) => index === 3
      ? <LoadingChart className="dashboard-completion" showTools key={index}>
        <Box className="dashboard-metric-reading dashboard-completion-reading">
          <Skeleton className="dashboard-loading-note" />
          <Skeleton className="dashboard-loading-value" />
        </Box>
        <Skeleton className="dashboard-loading-completion-legend" />
        <Box className="dashboard-series">
          <Skeleton className="dashboard-series-plot" />
        </Box>
      </LoadingChart> :
      <Panel as="article" key={index} data-compact-kpi={index >= 4 || undefined}>
        <LoadingMetric detail={index >= 4} trend />
      </Panel>)}
  </InstitutionMetricsGrid>;
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
      <LoadingInstitutionMetrics />
      <DashboardIndicatorsGrid>
        <LoadingSeries className="dashboard-priority-metric dashboard-new-entities" />
        <LoadingStaffChart />
        <LoadingStaffChart />
      </DashboardIndicatorsGrid>
      <Grid columns={12} className="dashboard-flow-family dashboard-work-overview-grid">
        <LoadingChart className="dashboard-transaction-flow" chartClass="staged-sankey-chart" />
        <LoadingSeries className="dashboard-flow-volume" />
        <LoadingChart className="dashboard-flow-risk" chartClass="dashboard-score-band" showNote={false} />
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
  return <Box className="preview-dashboard dashboard-loading" data-mine={mine} aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">대시보드 불러오는 중</Text>
    {mine ? <PersonalDashboardOverview aria-hidden="true" recommendation={<LoadingRecommendation reduced={appearance.reduced} />}>
      <LoadingChart className="dashboard-personal-flow" chartClass="staged-sankey-chart" showNote={false} />
      <LoadingChart className="dashboard-personal-history" chartClass="dashboard-loading-history" />
      <LoadingChart className="dashboard-personal-history" chartClass="dashboard-loading-history" />
    </PersonalDashboardOverview> : <DashboardAnalyticsSkeleton reduced={appearance.reduced} />}
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
  return <Panel className="case-progress-lane" aria-hidden="true">
    <SectionDownloadHeading as={Box} className="case-progress-lane-header" headingClassName="case-progress-heading">
      <Skeleton className="dashboard-loading-title" />
    </SectionDownloadHeading>
    <Skeleton className="dashboard-loading-card" />
  </Panel>;
}
