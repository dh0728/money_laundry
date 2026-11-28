import { Hourglass, TriangleAlert, UserRound, UserRoundCheck, X } from 'lucide-react';
import React from 'react';
import { modelRiskBand } from '../features/settings/model-risk-settings';
import { cautionAgeDays, isOverdueCaseAge } from '../features/investigation/case-age';
import { ActionButton } from './primary-button';
import { Text } from './layout-primitives';
import { reviewStates } from '../lib/review-status';
import './semantic-tags.css';

export { reviewStates } from '../lib/review-status';

const statusTones = {
  abnormal: 'danger',
  unread: 'danger',
  high: 'danger',
  riskHigh: 'danger',
  elapsedOverdue: 'danger',
  failed: 'danger',
  normal: 'positive',
  done: 'positive',
  low: 'positive',
  riskLow: 'positive',
  elapsed: 'caution',
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

const strongReviewPresets = new Set(reviewStates.map(state => state.preset));

export function StatusTag({ preset, className = '', emphasis = 'solid', children }) {
  const style = strongReviewPresets.has(preset) ? 'solid' : emphasis;
  const Icon = className.includes('semantic-tag--human-verdict') ? UserRoundCheck
    : preset?.startsWith('elapsed') ? Hourglass : preset?.startsWith('risk') ? TriangleAlert : undefined;
  return <span className={`semantic-tag ${className}`.trim()} data-tag="status" data-emphasis={style} data-preset={preset}
    data-tone={statusTones[preset] ?? 'neutral'}>{Icon && <Icon className="semantic-tag-icon" aria-hidden="true" />}{children}</span>;
}

/** @param {{ days?: number, showRecent?: boolean, overdueFromDays?: number }} props */
export function CaseAgeTag({ days, showRecent = false, overdueFromDays }) {
  if (days == null || !(days >= (showRecent ? 0 : cautionAgeDays))) return null;
  const overdue = overdueFromDays == null ? isOverdueCaseAge(days) : days >= overdueFromDays;
  return <StatusTag preset={overdue ? 'elapsedOverdue' : 'elapsed'} emphasis="tint">{days}일 경과</StatusTag>;
}

const countFormat = new Intl.NumberFormat('ko-KR');

/**
 * 목록·표·레인·패널 제목 옆 개수. plain은 태그 없이 텍스트로 표시한다.
 * 일부만 보이면(더 보기·필터·페이지) "보이는 수 / 전체 수", 다 보이면 전체 수만 쓴다.
 */
export function CountTag({ label, count, total = count, unit = '건', plain = false }) {
  const value = count < total ? `${countFormat.format(count)} / ${countFormat.format(total)}` : countFormat.format(total);
  const text = (label ? label + ' ' : '') + value + unit;
  if (plain) return <Text as="span">{text}</Text>;
  return <StatusTag preset="neutral" className="count-tag">{text}</StatusTag>;
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
  return <span className="semantic-tag" data-tag="model-score" data-tone={statusTones[band]} data-emphasis="tint">
    <TriangleAlert className="semantic-tag-icon" aria-hidden="true" /><span>모델</span><span>{score}점</span>
  </span>;
}

export function LinkTag({ code, href, children, className = '', ...props }) {
  return <ActionButton as={href ? 'a' : 'button'} href={href} className={'semantic-tag ' + className} data-tag="link"
    data-record-link={/^[TAE]-/.test(code ?? '') || undefined}
    data-work-code={href ? undefined : code} aria-label={!href && code ? `${code} 상세 열기` : undefined} {...props}>
    {code ? <code>{code}</code> : children}
  </ActionButton>;
}

export function TransactionRoleTag({ context }) {
  return <span className="semantic-tag" data-tag="transaction-role" data-role={context ? 'context' : 'subject'}>
    {context ? '주변 거래' : '판정 거래'}
  </span>;
}

export function CaseActorTag({ children }) {
  return <span className="semantic-tag" data-tag="case-actor"><UserRound className="semantic-tag-icon" aria-hidden="true" />{children}</span>;
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
      aria-label={`${children} 조건 제거`}><X className="semantic-tag-icon" aria-hidden="true" /></ActionButton>
  </span>;
}
