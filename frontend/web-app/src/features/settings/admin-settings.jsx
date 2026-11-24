import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminTeamSettings } from './admin-team-settings';
import { ModelRiskDial } from './model-risk-dial';
import { getModelRiskThresholds, saveModelRiskThresholds } from './model-risk-settings';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user';
import { DialogFooter } from '../../components/dialog-parts';
import { PanelDisclosure } from '../../components/panel';
import { PrimaryButton } from '../../components/primary-button';
import './admin-settings.css';

function ModelRiskSettings({ user }) {
  const [values, setValues] = useState(getModelRiskThresholds);
  const [result, setResult] = useState('');
  const [medium, high] = values;
  const live = user.source === 'api';
  const canEdit = live || user.source === 'fixture';
  const changed = getModelRiskThresholds().some((value, index) => value !== values[index]);
  return <>
    <div className="admin-model-settings">
      <ModelRiskDial values={values} disabled={!canEdit} onChange={next => {
        setValues(next);
        setResult('');
      }} />
      <ul className="model-risk-legend" aria-label="점수 구간">
        <li data-band="low">낮음 {medium}점 미만</li>
        <li data-band="medium">주의 {medium}~{high - 1}점</li>
        <li data-band="high">위험 {high}점 이상</li>
      </ul>
      <p className="model-graph-note">개발 브랜치 · 탐지 Multi-FraudGT + HGB · 유형 SALT-GNN R</p>
      <p>{live ? '모델 점수 표시 기준에 적용됩니다.' : '프리뷰 화면의 모델 점수 표시 기준에 적용됩니다.'}</p>
      {canEdit && <span role="status">{result}</span>}
    </div>
    {canEdit && <DialogFooter>
      <PrimaryButton tone="brand" disabled={!changed} onHold={() => {
        const applied = saved => setResult(saved ? '위험 구간을 적용했습니다.' : '위험 구간을 적용하지 못했습니다.');
        // 서비스 모드는 서버 응답을 기다린다.
        const saved = saveModelRiskThresholds(values);
        if (saved instanceof Promise) void saved.then(applied);
        else if (saved) applied(saved);
      }}>위험 구간 적용</PrimaryButton>
    </DialogFooter>}
  </>;
}

function AdminSettings() {
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  if (user?.role !== 'ADMIN') return null;
  return <section className="admin-settings" aria-labelledby="admin-settings-title">
    <h3 id="admin-settings-title">관리자</h3>
    <PanelDisclosure label="팀원 권한 관리">
      <AdminTeamSettings sessionUser={user} />
    </PanelDisclosure>
    <PanelDisclosure label="모델 설정 · 위험 구간">
      <ModelRiskSettings key={`${user.source}:${user.id}`} user={user} />
    </PanelDisclosure>
  </section>;
}

export function mountAdminSettings(host) {
  const root = createRoot(host);
  root.render(<AdminSettings />);
}
