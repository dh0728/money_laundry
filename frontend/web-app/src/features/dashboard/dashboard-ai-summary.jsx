import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchDashboardAiSummary } from '@/api/aiSummary';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { SectionDownloadHeading } from '../../components/section-download';
import { csvDownloadEntry } from '../../components/query-controls';
import { Box, Heading, Stack, Text } from '../../components/layout-primitives';
import { PieChart } from '../../components/charts/charts/pie/pie-chart';
import { PieSlice } from '../../components/charts/charts/pie/pie-slice';
import { readChartNumber } from '../../components/charts/chart-design-values';
import { useElementSize } from '../../components/charts/charts/use-element-size';

// 전체 대시보드의 AI 요약(API.md §14). 종합 위험지수는 서버 코드가 계산하고, Claude 는 그 원인 설명만 쓴다.

/**
 * 대시보드 요약을 읽는다. 샘플 모드·실패면 'failed' 이고, 화면은 기존 "분석 추천" 카드를 그대로 쓴다.
 * @returns {{ status: 'loading' | 'ready' | 'failed', summary?: import('@/api/aiSummary').DashboardAiSummary }}
 */
export function useDashboardAiSummary(enabled) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    fetchDashboardAiSummary().then(summary => { if (current) setState({ status: 'ready', summary }); },
      () => { if (current) setState({ status: 'failed' }); });
    return () => { current = false; };
  }, [enabled]);
  return enabled ? state : { status: 'failed' };
}

/** Claude 문장이 없을 때 지표를 그대로 읽어 주는 문장 */
const indicatorLine = indicator => [
  `${indicator.label} ${indicator.current}`,
  indicator.ratio != null && `평소의 ${indicator.ratio}배`,
  indicator.score == null ? '기준선 없음' : `지표 ${indicator.score}점`,
].filter(Boolean).join(' · ');

// 0~100점을 원 둘레로 보여 준다. 12시에서 시계 방향으로 점수만큼 채우고, 색은 단계(preview-dashboard.css 의 --risk-gauge-ink)를 따른다.
function RiskGauge({ score, level, reduced }) {
  const plotRef = useRef(null);
  const { width } = useElementSize(plotRef);
  const size = Math.floor(width);
  // 마우스를 올려도 조각이 튀어나오지 않게 여백 없이 꽉 채우고, 고리 두께만큼 안쪽을 비운다.
  const [design] = useState(() => ({ ring: readChartNumber('--risk-gauge-stroke', 32),
    gap: readChartNumber('--overview-donut-segment-gap', .045) }));
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  const data = [
    { label: '위험 점수', value, color: 'var(--risk-gauge-ink)' },
    { label: '남은 점수', value: 100 - value, color: 'var(--inner-surface)' },
  ].filter(slice => slice.value > 0);
  return <Box ref={plotRef} className="dashboard-risk-gauge" role="meter" aria-label="종합 위험지수"
    aria-valuemin="0" aria-valuemax="100" aria-valuenow={value}>
    {size > 0 && <Box className="dashboard-risk-gauge-ring" aria-hidden="true">
      <PieChart data={data} size={size} hoverOffset={0} innerRadius={Math.max(0, size / 2 - design.ring)}
        cornerRadius={design.ring / 2} padAngle={data.length > 1 ? design.gap : 0} geometryScrubbing={reduced}>
        {!reduced && data.map(({ label }, index) => <PieSlice key={label} index={index} />)}
      </PieChart>
    </Box>}
    <Text as="span" className="dashboard-risk-gauge-score" aria-hidden="true">
      <Text as="strong">{value}</Text><Text as="span">/ 100</Text><Text as="b">{level}</Text>
    </Text>
  </Box>;
}

// 점수 원 색이 어느 단계인지 알려 주는 세로 막대. 위가 가장 높은 단계이고, 지금 단계는 틀과 단계 색 글자로 표시한다.
// 원과 오른쪽 설명 사이에 놓여 구분선 역할도 한다.
const riskLevels = [
  { name: '심각', range: '80~100' }, { name: '높음', range: '60~79' }, { name: '경계', range: '40~59' },
  { name: '보통', range: '20~39' }, { name: '낮음', range: '0~19' },
];
function RiskScale({ level }) {
  return <Box as="ol" className="dashboard-risk-scale" aria-label="위험 단계">
    {riskLevels.map(({ name, range }) => <Box as="li" key={name} data-risk-step={name} aria-current={name === level ? 'step' : undefined}>
      <Text as="span" title={`${range}점`}>{name}</Text>
    </Box>)}
  </Box>;
}

export function DashboardAiSummary({ summary, reduced }) {
  const { index, headline, points } = summary;
  const entries = [csvDownloadEntry('종합 위험지수', 'risk-index',
    ['지표', '가중치', '현재', '평소', '평소 대비 배수', '지표 점수'],
    index.indicators.map(i => [i.label, i.weight, i.current, i.baseline ?? '', i.ratio ?? '', i.score ?? '']))];
  return <AISummaryPanel as="section" reduced={reduced} className="dashboard-priority-panel" aria-labelledby="dashboard-ai-summary-title">
    <SectionDownloadHeading id="dashboard-ai-summary-title" headingClassName="dashboard-priority-heading" downloadLabel="AI 요약" entries={entries}>
      <Sparkles className="icon" aria-hidden="true" />AI 요약
    </SectionDownloadHeading>
    {/* 왼쪽: 제목·점수 원과 그 옆 단계 색 막대(제목 줄부터 원 바닥까지, 구분선 겸), 오른쪽: 원인 설명(위쪽 맞춤) */}
    <Box className="dashboard-risk-layout">
      <Stack className="dashboard-risk-index" data-risk-level={index.level} role="group"
        aria-label={`종합 위험지수 ${index.score}점, ${index.level}`}>
        <Heading level={3}>종합 위험지수</Heading>
        <RiskGauge score={index.score} level={index.level} reduced={reduced} />
        <RiskScale level={index.level} />
      </Stack>
      <Stack className="dashboard-risk-explain">
        {headline ? <>
          <Text as="strong" data-ai-summary="claude">{headline}</Text>
          <Box as="ul" className="overview-summary-facts">{points.map(point => <Box as="li" key={point.text}>{point.text}</Box>)}</Box>
        </> : <Box as="ul" className="overview-summary-facts">
          {index.indicators.map(indicator => <Box as="li" key={indicator.key}>{indicatorLine(indicator)}</Box>)}
        </Box>}
        <Text className="dashboard-note">최근 거래일 {index.latestTxDate ?? '—'} · 업무일 {index.businessDate} 기준</Text>
      </Stack>
    </Box>
  </AISummaryPanel>;
}
