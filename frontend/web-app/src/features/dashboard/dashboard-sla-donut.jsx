import React, { useMemo, useRef, useState } from 'react';
import { Box, Heading, Text } from '@/components/layout-primitives';
import { SectionDownloadHeading } from '@/components/section-download';
import { Panel } from '@/components/panel';
import { PieChart } from '@/components/charts/charts/pie/pie-chart';
import { PieSlice } from '@/components/charts/charts/pie/pie-slice';
import { readChartNumber } from '@/components/charts/chart-design-values';
import { useElementSize } from '@/components/charts/charts/use-element-size';
import { cautionAgeDays, isOverdueCaseAge } from '../investigation/case-age';
import { count } from './dashboard-flows';
import { ChartTopicSelect } from './dashboard-layout';
import './dashboard-sla-donut.css';

const kindOptions = [
  { value: 'Alert', label: '미처리 Alert 경과일' },
  { value: 'Episode', label: '미처리 Episode 경과일' },
];
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

// The dashboard remounts when query conditions change.
let selectedKind = 'Alert';

export function DashboardSlaDonut({ data, reduced }) {
  const [kind, setKind] = useState(selectedKind);
  const plotRef = useRef(null);
  const { width } = useElementSize(plotRef);
  const size = Math.floor(width);
  const [layout] = useState(() => ({
    innerRadiusRatio: readChartNumber('--overview-donut-inner-radius-ratio', 0.34),
    cornerRadius: readChartNumber('--overview-donut-corner-radius', 8),
    segmentGap: readChartNumber('--overview-donut-segment-gap', 0.045),
  }));
  const { cases, investigation } = data;
  const statusByCode = investigation?.statusByCode;
  const { segments, total, unknown } = useMemo(
    () => countUnfinishedCaseAges(cases ?? [], statusByCode ?? {}, kind), [cases, statusByCode, kind],
  );
  const chartData = segments.filter(segment => segment.value > 0);

  return <Panel as="article" className="dashboard-chart dashboard-sla-donut">
    <SectionDownloadHeading as={Box} downloadLabel={chartData.length ? `미처리 ${kind} 경과일` : undefined}
      printLabel={!chartData.length ? `미처리 ${kind} 경과일` : undefined}>
      <Heading level={2} className="visually-hidden">미처리 {kind} 경과일</Heading>
      <ChartTopicSelect label="미처리 업무 경과일 유형" value={kind} options={kindOptions} onChange={next => {
        selectedKind = next;
        setKind(next);
      }} />
    </SectionDownloadHeading>
    <Box as="figure" className="dashboard-sla-figure" aria-label={`${kind} 경과일 구간별 건수`}>
      <Box ref={plotRef} className="dashboard-sla-plot">
        {size > 0 && chartData.length > 0 && <Box className="dashboard-sla-ring" aria-hidden="true">
          <PieChart data={chartData} size={size} innerRadius={size * layout.innerRadiusRatio}
            cornerRadius={layout.cornerRadius} padAngle={chartData.length > 1 ? layout.segmentGap : 0}
            geometryScrubbing={reduced}>
            {!reduced && chartData.map(({ key }, index) => <PieSlice key={key} index={index} />)}
          </PieChart>
        </Box>}
        <Text as="span" className="dashboard-sla-total">
          <Text as="span">미처리</Text><Text as="strong">{count(total)}</Text>
        </Text>
      </Box>
      <Box as="ul" className="dashboard-legend dashboard-sla-legend">
        {segments.map(({ key, label, value, color }) => <Box as="li" className="dashboard-series-legend-item" key={key}>
          <Text as="i" aria-hidden="true" style={{ '--dashboard-series-swatch': color }} />
          {label} <Text as="strong">{count(value)}</Text>
        </Box>)}
      </Box>
      {unknown > 0 && <Text className="dashboard-note">경과일 미집계 {count(unknown)}</Text>}
    </Box>
  </Panel>;
}
