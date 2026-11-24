import React, { useEffect, useState } from 'react';
import { fetchCaseRuleHits } from '@/api/rules';
import { LinkTag, PatternTag, StatusTag } from '../../components/semantic-tags';
import { cmpSymbol } from './rule-definition';
import { problemText, ruleStatusNames, ruleStatusPresets } from './live-rule-store';
import './case-rule-hits.css';

// Alert · Episode 상세의 "룰 적중"(서비스 모드). 운영 중인 룰이 이 사건의 거래에 걸린 내역이고 모델 점수와는 별개의 근거다.
// 서버는 연결을 저장하지 않고 "사건의 현재 거래와 적중의 근거 거래에 같은 거래가 있는가"로 찾는다.

const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const withUnit = (value, unit) => (value == null ? '—' : `${numberFormat.format(value)}${unit ? (unit.length > 1 ? ` ${unit}` : unit) : ''}`);

/**
 * 사건의 룰 적중을 읽는다.
 * @returns {{ status: 'loading' | 'ready' | 'failed', hits: import('@/api/rules').RuleHitCard[], error?: string }}
 */
export function useCaseRuleHits(caseId) {
  const [state, setState] = useState({ caseId: undefined, status: 'loading', hits: [] });
  useEffect(() => {
    if (caseId == null) return undefined;
    let current = true;
    fetchCaseRuleHits(caseId).then(hits => { if (current) setState({ caseId, status: 'ready', hits }); },
      error => { if (current) setState({ caseId, status: 'failed', hits: [], error: problemText(error, '룰 적중을 불러오지 못했습니다.') }); });
    return () => { current = false; };
  }, [caseId]);
  // 다른 사건으로 옮기면 새로 읽을 때까지 앞 사건의 적중을 보여 주지 않는다
  return state.caseId === caseId ? state : { status: 'loading', hits: [] };
}

/** "서로 다른 수취 계좌 수 ≥ 6개 → 실제 6개" */
function Condition({ condition }) {
  // 값이 없는 조건(같은 상대와 두 번 거래하지 않음 등)은 문구만 있다
  if (condition.cmp == null) return <li>{condition.label}</li>;
  return <li>{condition.label} {cmpSymbol[condition.cmp] ?? condition.cmp} {withUnit(condition.value, condition.unit)}
    {' → '}<strong>실제 {withUnit(condition.measured, condition.unit)}</strong></li>;
}

/**
 * @param state useCaseRuleHits 의 결과
 * @param records 사건의 거래(txId 와 화면 코드)
 * @param alertCode Episode 에서 카드가 어느 Alert 의 것인지 보여 줄 때 쓰는 alertId → 화면 코드
 */
export function CaseRuleHits({ state, records = [], alertCode }) {
  if (state.status === 'loading') return <p className="overview-note" aria-busy="true">룰 적중을 불러오는 중입니다.</p>;
  if (state.status === 'failed') return <p role="alert">{state.error}</p>;
  if (!state.hits.length) return <p className="overview-note">이 사건의 거래에 걸린 운영 룰이 없습니다.</p>;
  const codes = new Map(records.map(record => [record.txId, record.code]));
  return <>
    <p className="overview-note">운영 중인 룰이 이 사건의 거래에 걸린 내역입니다. 모델 점수와는 별개의 근거입니다.</p>
    <ul className="overview-fact-list case-rule-hits" aria-label="룰 적중">
      {state.hits.map(hit => {
        const matched = hit.matchedTxIds.flatMap(txId => codes.get(txId) ?? []);
        const alert = alertCode?.(hit.alertId);
        return <li key={`${hit.alertId}-${hit.versionId}-${hit.subject}`}>
          <LinkTag href={`/rules?rule=${hit.code}`} code={hit.code} />
          <strong>v{hit.versionNo} · {hit.name}</strong>
          <PatternTag>{hit.templateName}</PatternTag>
          {/* 지금은 중지했거나 물러난 버전이 운영 중일 때 만든 적중 */}
          {hit.versionStatus !== 'ACTIVE' && <StatusTag preset={ruleStatusPresets[hit.versionStatus]}>지금은 {ruleStatusNames[hit.versionStatus]}</StatusTag>}
          <span className="overview-shared-target">
            {alert && <><LinkTag code={alert} /> · </>}{hit.subjectLabel ?? '대상'} <code>{hit.subject}</code> · 적중 날짜 {hit.hitDates.join(', ')}
          </span>
          <ul className="overview-shared-target case-rule-hit-conditions" aria-label="조건과 실제 값">
            {hit.conditions.map((condition, index) => <Condition key={index} condition={condition} />)}
          </ul>
          <span className="overview-shared-target overview-note">
            이 사건의 거래 {hit.matchedTxIds.length}건이 이 적중의 근거 거래입니다(근거 거래 전체 {hit.evidenceTxCount}건).
          </span>
          {matched.length > 0 && <span className="overview-shared-target semantic-tag-group">
            {matched.map(code => <LinkTag key={code} code={code} />)}
          </span>}
        </li>;
      })}
    </ul>
  </>;
}
