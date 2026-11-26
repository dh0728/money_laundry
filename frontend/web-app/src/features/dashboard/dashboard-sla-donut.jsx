import React, { useRef, useState } from 'react';
import { Box, Text } from '@/components/layout-primitives';
import { SectionDownloadHeading } from '@/components/section-download';
import { Panel } from '@/components/panel';
import { PieChart } from '@/components/charts/charts/pie/pie-chart';
import { PieSlice } from '@/components/charts/charts/pie/pie-slice';
import { readChartNumber } from '@/components/charts/chart-design-values';
import { useElementSize } from '@/components/charts/charts/use-element-size';
import { csvDownloadEntry } from '@/components/query-controls';
import { cautionAgeDays, isOverdueCaseAge } from '../investigation/case-age';
import { count } from './dashboard-flows';
import './dashboard-sla-donut.css';

const ageBands = [
  { key: 'caution', label: `${cautionAgeDays}일 이하`, color: 'var(--status-caution-accent)' },
  { key: 'danger', label: `${cautionAgeDays}일 초과`, color: 'var(--status-danger-accent)' },
];

// The same case status is displayed in the dashboard board and the daily chart.
export function countUnfinishedCaseAges(cases, statusByCode, kind) {
  const segments = ageBands.map(band => ({ ...band, value: 0 }));
  let total = 0;
  let unknown = 0;
  for (const row of cases) {
    const status = statusByCode[row.code];
    if (row.kind !== kind || (status == null ? !row.open : status === '처리 완료')) continue;
    total++;
    if (!Number.isFinite(row.elapsed) || row.elapsed < 0) {
      unknown++;
      continue;
    }
    const band = isOverdueCaseAge(row.elapsed) ? 1 : 0;
    segments[band].value++;
  }
  return { segments, total, unknown };
}

function DonutFigure({ label, segments, centerLabel, centerValue, note, reduced, layout }) {
  const plotRef = useRef(null);
  const { width } = useElementSize(plotRef);
  const size = Math.floor(width);
  const chartData = segments.filter(segment => segment.value > 0);
  return <Box as="figure" className="dashboard-sla-figure" aria-label={label}>
      <Box ref={plotRef} className="dashboard-sla-plot">
        {size > 0 && chartData.length > 0 && <Box className="dashboard-sla-ring" aria-hidden="true">
          <PieChart data={chartData} size={size} innerRadius={size * layout.innerRadiusRatio}
            cornerRadius={layout.cornerRadius} padAngle={chartData.length > 1 ? layout.segmentGap : 0}
            geometryScrubbing={reduced}>
            {!reduced && chartData.map(({ key }, index) => <PieSlice key={key} index={index} />)}
          </PieChart>
        </Box>}
        <Text as="span" className="dashboard-sla-total">
          <Text as="span">{centerLabel}</Text><Text as="strong">{centerValue}</Text>
        </Text>
      </Box>
      <Box as="ul" className="dashboard-legend dashboard-sla-legend">
        {segments.map(({ key, label, value, color }) => <Box as="li" className="dashboard-series-legend-item" key={key}>
          <Text as="i" aria-hidden="true" style={{ '--dashboard-series-swatch': color }} />
          {label} <Text as="strong">{count(value)}</Text>
        </Box>)}
      </Box>
      {note && <Text className="dashboard-note">{note}</Text>}
    </Box>;
}

export function DashboardSlaDonut({ data, reduced }) {
  const [layout] = useState(() => ({
    innerRadiusRatio: readChartNumber('--overview-donut-inner-radius-ratio', 0.34),
    cornerRadius: readChartNumber('--overview-donut-corner-radius', 8),
    segmentGap: readChartNumber('--overview-donut-segment-gap', 0.045),
  }));
  const workload = data?.institutionWorkload;
  const total = workload?.total ?? 0;
  const overdue = workload?.overdue?.length ?? 0;
  const unknown = workload?.unknownElapsed ?? 0;
  const remainingLabel = workload?.unknownElapsed == null ? `${cautionAgeDays}일 초과 이외` : ageBands[0].label;
  const segments = [
    { ...ageBands[0], label: remainingLabel, value: total - overdue - unknown },
    { ...ageBands[1], value: overdue },
  ];
  const title = '미처리 경과일';
  const chart = segments.some(segment => segment.value > 0);
  const entries = total ? [csvDownloadEntry(title, 'dashboard-unfinished-work-age', ['구간', '건수'], [
    ...segments.map(segment => [segment.label, segment.value]),
    ...(unknown > 0 ? [['미집계', unknown]] : []),
  ])] : [];
  const note = !workload ? '선택 기간 미처리 업무 미집계' : unknown > 0
    ? `개별 Alert · Episode · 경과일 미집계 ${count(unknown)}` : '개별 Alert · Episode · 선택 기간 생성 업무';

  return <Panel as="article" className="dashboard-chart dashboard-sla-donut">
    <SectionDownloadHeading as="h3" downloadLabel={chart ? title : undefined}
      printLabel={!chart ? title : undefined} entries={entries}>{title}</SectionDownloadHeading>
    <DonutFigure label="미처리 업무의 경과일 구간별 건수" segments={segments} centerLabel="미처리"
      centerValue={workload ? count(total) : '—'} note={note} reduced={reduced} layout={layout} />
  </Panel>;
}
