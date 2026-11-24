import React, { useState } from 'react';
import { PreviewCaseCard } from '../features/investigation/preview-case-card';
import { TransactionCard } from '../features/investigation/investigation-components';
import { dashboardFixtures } from '../mocks/dashboard-fixtures';
import './component-card-samples.css';
import { Box, Heading } from '../components/layout-primitives';

const { cases, transactions } = dashboardFixtures({
  T: ['T-261111-00000001', 'T-261111-00000002', 'T-261111-00000003'],
  A: ['A-261111-001042', 'A-261111-001051', 'A-261111-001069'],
  E: ['E-261111-000001', 'E-261111-000002', 'E-261111-000003'],
});
const episode = cases.find(row => row.kind === 'Episode');
const alert = cases.find(row => row.kind === 'Alert' && row.open);

export function CardSamples({ onEvent }) {
  const [checked, setChecked] = useState(false);
  function reportAction(event) {
    const button = event.target.closest('button[data-work-code]');
    if (!button) return;
    const { workCode } = button.dataset;
    onEvent?.(button.hasAttribute('data-add-work-tab')
      ? `${workCode} · 사이드바 탭으로 추가`
      : `${workCode} · 상세 열기 요청`);
  }

  return <Box className="catalogue-card-samples" onClick={reportAction}>
    <Box>
      <Heading level={3}>선택 포함 · Episode</Heading>
      <PreviewCaseCard row={episode}
        selection={{ checked, onChange(next) {
          setChecked(next);
          onEvent?.(`${episode.code} · ${next ? '선택' : '선택 해제'}`);
        } }} />
    </Box>
    <Box>
      <Heading level={3}>상세 열기만 · Alert</Heading>
      <PreviewCaseCard row={alert} showAdd={false} />
    </Box>
    <Box>
      <Heading level={3}>사이드바 탭 추가 · 거래</Heading>
      <TransactionCard record={transactions[0]} />
    </Box>
  </Box>;
}
