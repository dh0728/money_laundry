import React from 'react';
import { createRoot } from 'react-dom/client';
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton';
import { Box, Stack, Text } from '@/components/layout-primitives';
import { Panel } from '@/components/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { AISummaryPanel } from '@/components/ai-summary-panel';
import { ActionButton } from '@/components/primary-button';
import { CaseProgressLanes } from './preview-case-card';
import './preview-case-overview.css';
import './investigation-components.css';
import './investigation-skeletons.css';

function Lines({ count = 2 }) {
  return Array.from({ length: count }, (_, index) => <Skeleton key={index} className="investigation-skeleton-line" />);
}

function TablePlaceholder({ columns, rows = 4 }) {
  return <DataTableSkeleton columnCount={columns} rowCount={rows} withViewOptions={false} withPagination={false} />;
}

function OverviewPlaceholder({ panel, span, chart, lines = 2, children }) {
  return <Panel data-overview-panel={panel} data-overview-span={span}>
    <Skeleton className="investigation-skeleton-title" />
    {chart && <Skeleton className={`investigation-skeleton-plot investigation-skeleton-${chart}`} />}
    {children ?? <Lines count={lines} />}
  </Panel>;
}

function OverviewSummary() {
  return <AISummaryPanel className="overview-ai-summary" reduced>
    <Skeleton className="investigation-skeleton-title" />
    <Lines count={3} />
  </AISummaryPanel>;
}

function OverviewTransactions() {
  return <OverviewPlaceholder panel="transactions" span={12}>
    <TablePlaceholder columns={9} rows={3} />
  </OverviewPlaceholder>;
}

function PerPanelPlaceholder({ panel }) {
  return <Box className="overview-panel-layout">
    <Panel className="overview-current">
      <Skeleton className="investigation-skeleton-title" />
      <Box className="overview-panel-visual">
        {panel === 'transactions' ? <TablePlaceholder columns={9} />
          : ['flow', 'detection', 'accounts', 'composition'].includes(panel)
            ? <Skeleton className="investigation-skeleton-plot investigation-skeleton-overview-visual" />
            : <Lines count={4} />}
      </Box>
    </Panel>
    <Panel className="overview-current overview-panel-details">
      <Skeleton className="investigation-skeleton-title" />
      <Lines count={4} />
    </Panel>
  </Box>;
}

export function CaseOverviewSkeleton({ episode, perPanel, initialPanel }) {
  return <Box className="investigation-loading" data-investigation-loading="overview" aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">{episode ? 'Episode' : 'Alert'} 개요 불러오는 중</Text>
    <Box className="preview-case-overview" data-per-panel={perPanel} aria-hidden="true">
      <Box className="semantic-tag-group">
        <Skeleton className="investigation-skeleton-tag" />
        <Skeleton className="investigation-skeleton-tag" />
        <Skeleton className="investigation-skeleton-tag" />
        <Skeleton className="investigation-skeleton-tag" />
      </Box>
      {perPanel ? <PerPanelPlaceholder panel={initialPanel} /> : <>
        <Box className="overview-top" data-alert-evidence={!episode || undefined} data-episode-evidence={episode || undefined}>
          <Stack>
            {episode && <OverviewPlaceholder panel="composition" lines={4} />}
            <OverviewPlaceholder panel="flow" chart="flow" />
            {!episode && <OverviewPlaceholder panel="detection" chart="score" />}
          </Stack>
          <Stack>
            <OverviewSummary />
            <OverviewPlaceholder panel="accounts" />
            {episode ? <>
              <OverviewPlaceholder panel="history" />
              <OverviewPlaceholder panel="judgment" />
              <OverviewPlaceholder panel="rules" />
            </> : <OverviewPlaceholder panel="past" />}
          </Stack>
        </Box>
        <Box className="overview-tiles">
          {episode ? <>
            <OverviewPlaceholder panel="detection" span={8} chart="score" />
            <OverviewPlaceholder panel="distribution" span={4} chart="distribution" />
            <OverviewTransactions />
          </> : <>
            <OverviewTransactions />
            <OverviewPlaceholder panel="composition" span={3} chart="distribution" />
            <OverviewPlaceholder panel="judgment" span={3} />
            <OverviewPlaceholder panel="history" span={3} />
            <OverviewPlaceholder panel="rules" span={3} />
          </>}
        </Box>
      </>}
    </Box>
  </Box>;
}

function CaseCardsPlaceholder() {
  return <Box className="screen-section case-list-panel">
    <CaseProgressLanes renderLane={({ preset }) => <Panel key={preset} className="case-progress-lane">
      <Skeleton className="investigation-skeleton-title" />
      <Skeleton className="investigation-skeleton-card" />
      <Skeleton className="investigation-skeleton-card" />
    </Panel>} />
  </Box>;
}

export function LedgerPaneSkeleton() {
  return <Box className="investigation-loading-lines" aria-hidden="true"><Lines count={4} /></Box>;
}

function LedgerCardsPlaceholder() {
  return <Box className="ledger-components">
    <Skeleton className="ledger-search-bar investigation-skeleton-bar" />
    {['owners', 'accounts', 'transactions', 'related'].map(name => <Box className={`ledger-pane ledger-${name}`} key={name}>
      <Skeleton className="investigation-skeleton-title" />
      <LedgerPaneSkeleton />
    </Box>)}
  </Box>;
}

export function mountInvestigationLoading(host, { label, kind, columns, relatedColumns }) {
  const root = createRoot(host);
  root.render(<Box className="investigation-loading" data-investigation-loading={kind} aria-busy="true">
    <Text as="span" className="visually-hidden" role="status">{label} 불러오는 중</Text>
    <Box aria-hidden="true">
      {kind === 'case-cards' ? <CaseCardsPlaceholder /> : kind === 'ledger-cards' ? <LedgerCardsPlaceholder />
        : kind === 'benchmark-cards' ? <Stack><Panel><Skeleton className="investigation-skeleton-title" /><Lines /></Panel>
          <Skeleton className="investigation-skeleton-card" /><Skeleton className="investigation-skeleton-card" /></Stack>
        : relatedColumns ? <Box className="ledger-tables">
          <Box className="ledger-hierarchy"><Skeleton className="investigation-skeleton-bar" />
            <Skeleton className="investigation-skeleton-title" /><TablePlaceholder columns={columns} />
          </Box>
          <Stack><Skeleton className="investigation-skeleton-title" /><TablePlaceholder columns={relatedColumns} rows={2} /></Stack>
        </Box> : <Stack><Skeleton className="investigation-skeleton-title" /><TablePlaceholder columns={columns} /></Stack>}
    </Box>
  </Box>);
  return {
    unmount: () => root.unmount(),
    showError: retry => root.render(<Panel role="alert">
      <Text>{label} 화면을 불러오지 못했습니다.</Text>
      <ActionButton surface="floating" shape="pill" onClick={retry}>다시 시도</ActionButton>
    </Panel>),
  };
}
