import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminTeamSettings } from './admin-team-settings';
import { ModelRiskDial } from './model-risk-dial';
import { getModelRiskThresholds, saveModelRiskThresholds } from './model-risk-settings';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user';
import { PanelDisclosure } from '../../components/panel';
import { PrimaryButton } from '../../components/primary-button';
import './admin-settings.css';
import { Box, Grid, Heading, Stack, Text } from '../../components/layout-primitives';

function ModelRiskSettings({ user }) {
  const [values, setValues] = useState(getModelRiskThresholds);
  const [result, setResult] = useState('');
  const [medium, high] = values;
  const canEdit = user.source === 'api' || user.source === 'fixture';
  const changed = getModelRiskThresholds().some((value, index) => value !== values[index]);
  return <Stack className="admin-model-settings">
    <Grid className="admin-model-risk-layout">
      <Stack className="admin-model-risk-labels">
        <Stack as="ul" className="model-risk-legend" aria-label="점수 구간">
          <Box as="li" data-band="low">낮음 {medium}점 미만</Box>
          <Box as="li" data-band="medium">주의 {medium}~{high - 1}점</Box>
          <Box as="li" data-band="high">위험 {high}점 이상</Box>
        </Stack>
        {canEdit && <Text as="span" role="status" className="model-risk-result">{result}</Text>}
      </Stack>
      <ModelRiskDial values={values} disabled={!canEdit} onChange={next => {
        setValues(next);
        setResult('');
      }} />
    </Grid>
    {canEdit && <PrimaryButton tone="brand" size="comfortable" disabled={!changed} onHold={() => {
      const applied = saved => setResult(saved ? '위험 구간을 적용했습니다.' : '위험 구간을 적용하지 못했습니다.');
      // 서비스 모드는 서버 응답을 기다린다.
      const saved = saveModelRiskThresholds(values);
      if (saved instanceof Promise) void saved.then(applied);
      else applied(saved);
    }}>위험 구간 적용</PrimaryButton>}
  </Stack>;
}

function AdminSettings() {
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  if (user?.role !== 'ADMIN') return null;
  return <Box as="section" className="admin-settings" aria-labelledby="admin-settings-title">
    <Heading level={3} id="admin-settings-title">관리자</Heading>
    <PanelDisclosure label="팀원 권한 관리">
      <AdminTeamSettings sessionUser={user} />
    </PanelDisclosure>
    <PanelDisclosure label="모델 설정 · 위험 구간" inset="control">
      <ModelRiskSettings key={`${user.source}:${user.id}`} user={user} />
    </PanelDisclosure>
  </Box>;
}

export function mountAdminSettings(host) {
  const root = createRoot(host);
  root.render(<AdminSettings />);
}
