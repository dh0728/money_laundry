import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchDashboardAiSummary } from '@/api/aiSummary';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { SectionDownloadHeading } from '../../components/section-download';
import { csvDownloadEntry } from '../../components/query-controls';
import { Meter } from '../../components/meter';
import { Box, Heading, Stack, Text } from '../../components/layout-primitives';

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

export function DashboardAiSummary({ summary, reduced }) {
  const { index, headline, points } = summary;
  const entries = [csvDownloadEntry('종합 위험지수', 'risk-index',
    ['지표', '가중치', '현재', '평소', '평소 대비 배수', '지표 점수'],
    index.indicators.map(i => [i.label, i.weight, i.current, i.baseline ?? '', i.ratio ?? '', i.score ?? '']))];
  return <AISummaryPanel as="section" reduced={reduced} className="dashboard-priority-panel" aria-labelledby="dashboard-ai-summary-title">
    <SectionDownloadHeading id="dashboard-ai-summary-title" headingClassName="dashboard-priority-heading" downloadLabel="AI 요약" entries={entries}>
      <Sparkles className="icon" aria-hidden="true" />AI 요약
    </SectionDownloadHeading>
    <Stack className="dashboard-risk-index" data-risk-level={index.level}>
      <Heading level={3}>종합 위험지수</Heading>
      <Text as="strong" aria-label={`종합 위험지수 ${index.score}점, ${index.level}`}>{index.score} / 100 · {index.level}</Text>
      <Meter min={0} max={100} low={40} high={60} optimum={0} value={index.score} aria-label="종합 위험지수" />
    </Stack>
    {headline ? <>
      <Text as="strong" data-ai-summary="claude">{headline}</Text>
      <Box as="ul" className="overview-summary-facts">{points.map(point => <Box as="li" key={point.text}>{point.text}</Box>)}</Box>
    </> : <Box as="ul" className="overview-summary-facts">
      {index.indicators.map(indicator => <Box as="li" key={indicator.key}>{indicatorLine(indicator)}</Box>)}
    </Box>}
    <Text className="dashboard-note">최근 거래일 {index.latestTxDate ?? '—'} · 업무일 {index.businessDate} 기준</Text>
  </AISummaryPanel>;
}
