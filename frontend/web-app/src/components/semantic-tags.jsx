import React from 'react';
import { modelRiskBand } from '../features/settings/model-risk-settings';
import { ActionButton } from './primary-button';
import './semantic-tags.css';

const statusTones = {
  abnormal: 'danger',
  unread: 'danger',
  high: 'danger',
  riskHigh: 'danger',
  elapsedOver1w: 'danger',
  failed: 'danger',
  normal: 'positive',
  done: 'positive',
  low: 'positive',
  riskLow: 'positive',
  elapsed: 'caution',
  elapsedUnder1w: 'caution',
  caution: 'caution',
  medium: 'caution',
  riskMedium: 'caution',
  pending: 'pending',
  running: 'info',
  inProgress: 'info',
  cancelled: 'neutral',
};

const patternNames = {
  'fan-out': 'FAN-OUT',
  'fan-in': 'FAN-IN',
  cycle: 'CYCLE',
  'scatter-gather': 'SC-GA',
  'gather-scatter': 'GA-SC',
  'sc-ga': 'SC-GA',
  'ga-sc': 'GA-SC',
  random: 'RANDOM',
};

export const reviewStates = [
  { value: '처리 전', label: '검토 대기', preset: 'pending' },
  { value: '처리 중', label: '처리 중', preset: 'inProgress' },
  { value: '처리 완료', label: '처리 완료', preset: 'done' },
];
const strongReviewPresets = new Set(reviewStates.map(state => state.preset));

export function StatusTag({ preset, className = '', emphasis = 'solid', children }) {
  const style = strongReviewPresets.has(preset) ? 'solid' : emphasis;
  return <span className={`semantic-tag ${className}`.trim()} data-tag="status" data-emphasis={style} data-preset={preset}
    data-tone={statusTones[preset] ?? 'neutral'}>{children}</span>;
}

const countFormat = new Intl.NumberFormat('ko-KR');

/**
 * 제목 오른쪽 개수 태그. 목록·표·레인·패널 제목 옆 개수는 모두 이 태그 하나로 쓴다.
 * 일부만 보이면(더 보기·필터·페이지) "보이는 수 / 전체 수", 다 보이면 전체 수만 쓴다.
 */
export function CountTag({ label, count, total = count, unit = '건' }) {
  const value = count < total ? `${countFormat.format(count)} / ${countFormat.format(total)}` : countFormat.format(total);
  return <StatusTag preset="neutral" className="count-tag">{label ? `${label} ` : ''}{value}{unit}</StatusTag>;
}

export const verdictLabels = {
  unjudged: '판정 전',
  abnormal: '이상',
  normal: '정상',
};

export function VerdictTag({ verdict }) {
  return <StatusTag className="semantic-tag--human-verdict" preset={verdict === 'unjudged' ? 'caution' : verdict}>
    {verdictLabels[verdict]}
  </StatusTag>;
}

export function PatternTag({ emphasis = 'solid', children }) {
  const parts = React.Children.toArray(children);
  const value = parts.every(part => typeof part === 'string' || typeof part === 'number')
    ? parts.join('') : undefined;
  const [name, probability] = value?.trim().split(/\s+(?=\d+(?:[.,]\d+)?%$)/) ?? [];
  const shortName = patternNames[name?.toLowerCase()] ?? name;
  return <span className="semantic-tag" data-tag="pattern" data-emphasis={emphasis}>
    {probability ? <><span>{shortName}</span>{' '}<span>{probability}</span></> : shortName ?? children}
  </span>;
}

export function ModelScoreTag({ score, band = modelRiskBand(score) }) {
  return <span className="semantic-tag" data-tag="model-score" data-tone={statusTones[band]} data-emphasis="solid">
    <span>모델</span><span>{score}점</span>
  </span>;
}

export function LinkTag({ code, href, children, ...props }) {
  return <ActionButton as={href ? 'a' : 'button'} href={href} className="semantic-tag" data-tag="link"
    data-work-code={href ? undefined : code} aria-label={!href && code ? `${code} 상세 열기` : undefined} {...props}>
    {code ? <code>{code}</code> : children}
  </ActionButton>;
}

export function CaseActorTag({ children }) {
  return <span className="semantic-tag" data-tag="case-actor">{children}</span>;
}

const reviewState = status => reviewStates.find(state => state.value === status);
export const reviewStatusLabel = status => reviewState(status)?.label ?? status;

export function ReviewStatusTag({ status, emphasis }) {
  return <StatusTag preset={reviewState(status)?.preset} emphasis={emphasis}>{reviewStatusLabel(status)}</StatusTag>;
}

export function FilterTag({ children, onEdit, onRemove, autoFocus, popupId }) {
  return <span className="semantic-tag" data-tag="filter">
    {onEdit
      ? <ActionButton className="filter-tag-label" onClick={onEdit} autoFocus={autoFocus}
        aria-label={`${children} 수정`} aria-haspopup={popupId ? 'dialog' : undefined} aria-controls={popupId}>{children}</ActionButton>
      : <span className="filter-tag-label">{children}</span>}
    <ActionButton className="filter-tag-remove" onClick={onRemove} autoFocus={!onEdit && autoFocus}
      aria-label={`${children} 조건 제거`} />
  </span>;
}
