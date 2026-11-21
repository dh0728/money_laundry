import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminTeamSettings } from './admin-team-settings';
import { ModelRiskDial } from './model-risk-dial';
import { getModelRiskThresholds, saveModelRiskThresholds } from './model-risk-settings';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user';
import { PrimaryButton } from '../../components/primary-button';
import './admin-settings.css';

function ModelRiskSettings({ user }) {
  const [values, setValues] = useState(getModelRiskThresholds);
  const [result, setResult] = useState('');
  const [medium, high] = values;
  const canEdit = user.source === 'fixture';
  const changed = getModelRiskThresholds().some((value, index) => value !== values[index]);
  return <div className="admin-model-settings">
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
    <p>{canEdit ? '프리뷰 화면의 모델 점수 표시 기준에 적용됩니다.' : '운영 모델의 구간 변경 API는 아직 제공되지 않습니다.'}</p>
    {canEdit && <div className="admin-model-actions">
      <span role="status">{result}</span>
      <PrimaryButton tone="brand" disabled={!changed} onHold={() => {
        if (saveModelRiskThresholds(values)) setResult('위험 구간을 적용했습니다.');
      }}>위험 구간 적용</PrimaryButton>
    </div>}
  </div>;
}

function AdminSettings() {
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  if (user?.role !== 'ADMIN') return null;
  return <section className="admin-settings" aria-labelledby="admin-settings-title">
    <h3 id="admin-settings-title">관리자</h3>
    <details className="admin-settings-group">
      <summary>팀원 권한 관리</summary>
      <AdminTeamSettings sessionUser={user} />
    </details>
    <details className="admin-settings-group">
      <summary>모델 설정 · 위험 구간</summary>
      <ModelRiskSettings key={`${user.source}:${user.id}`} user={user} />
    </details>
  </section>;
}

export function mountAdminSettings(host) {
  const root = createRoot(host);
  root.render(<AdminSettings />);
}
