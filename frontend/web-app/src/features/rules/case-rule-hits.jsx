import React, { useEffect, useState } from 'react';
import { fetchCaseRuleHits } from '@/api/rules';
import { ActionButton } from '../../components/primary-button';
import { LinkTag, PatternTag, StatusTag } from '../../components/semantic-tags';
import { cmpSymbol } from './rule-definition';
import { problemText, ruleStatusNames, ruleStatusPresets } from './live-rule-store';
import { Box, Text } from '@/components/layout-primitives';
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

/**
 * "서로 다른 수취 계좌 수 ≥ 6개 → 실제 6개"
 * @param measuredLabel 실제 값 앞에 붙는 말. 거래 여러 건을 모은 카드는 그 가운데 가장 큰 값이라 "가장 큰 거래" 다
 */
function Condition({ condition, measuredLabel = '실제' }) {
  // 값이 없는 조건(같은 상대와 두 번 거래하지 않음 등)은 문구만 있다
  if (condition.cmp == null) return <Box as="li">{condition.label}</Box>;
  return <Box as="li">{condition.label} {cmpSymbol[condition.cmp] ?? condition.cmp} {withUnit(condition.value, condition.unit)}
    {' → '}<Text as="strong">{measuredLabel} {withUnit(condition.measured, condition.unit)}</Text></Box>;
}

// 한 역할의 계좌를 처음에 보여 주는 개수. 넘으면 "외 N개 더 보기" 로 접는다.
const ROLE_PREVIEW = 8;

/** roles 를 역할별로 묶는다. 서버가 준 순서(출발 계좌 → 경유 계좌, 경로는 지나간 순서)를 그대로 둔다. */
function roleGroups(roles = []) {
  const groups = new Map();
  for (const item of roles) {
    if (!groups.has(item.role)) groups.set(item.role, { role: item.role, label: item.label ?? item.role, accounts: [] });
    groups.get(item.role).accounts.push(item.accountId);
  }
  return [...groups.values()];
}

/** "경유 계좌 4개 a1b2c3d4 …". 대상 말고 이 적중에 나온 계좌다(SCATTER-GATHER 의 출발 · 경유 계좌, CYCLE · RANDOM 의 경로 계좌). */
function RoleAccounts({ group }) {
  const [open, setOpen] = useState(false);
  const hidden = group.accounts.length - ROLE_PREVIEW;
  const shown = open || hidden <= 0 ? group.accounts : group.accounts.slice(0, ROLE_PREVIEW);
  return <Box as="li">
    <Text as="span">{group.label} {group.accounts.length}개</Text>
    {shown.map(account => <Text as="code" key={account}>{account}</Text>)}
    {hidden > 0 && <ActionButton shape="pill" aria-expanded={open} aria-label={`${group.label} ${open ? '접기' : `${hidden}개 더 보기`}`}
      onClick={() => setOpen(value => !value)}>{open ? '접기' : `외 ${hidden}개 더 보기`}</ActionButton>}
  </Box>;
}

/**
 * @param state useCaseRuleHits 의 결과
 * @param records 사건의 거래(txId 와 화면 코드)
 * @param alertCode Episode 에서 카드가 어느 Alert 의 것인지 보여 줄 때 쓰는 alertId → 화면 코드
 */
export function CaseRuleHits({ state, records = [], alertCode }) {
  if (state.status === 'loading') return <Text className="overview-note" aria-busy="true">룰 적중을 불러오는 중입니다.</Text>;
  if (state.status === 'failed') return <Text role="alert">{state.error}</Text>;
  if (!state.hits.length) return <Text className="overview-note">이 사건의 거래에 걸린 운영 룰이 없습니다.</Text>;
  const codes = new Map(records.map(record => [record.txId, record.code]));
  return <>
    <Text className="overview-note">운영 중인 룰이 이 사건의 거래에 걸린 내역입니다. 모델 점수와는 별개의 근거입니다.</Text>
    <Box as="ul" className="overview-fact-list case-rule-hits" aria-label="룰 적중">
      {state.hits.map(hit => {
        const matched = hit.matchedTxIds.flatMap(txId => codes.get(txId) ?? []);
        const alert = alertCode?.(hit.alertId);
        // 대상이 거래인 룰(단건 고액거래): 걸린 거래를 한 장에 모은 카드다. 대상 계좌가 없고 걸린 거래가 곧 근거 거래다.
        const transactions = hit.subjectType === 'TX';
        return <Box as="li" key={`${hit.alertId}-${hit.versionId}-${hit.subject ?? 'tx'}`}>
          <LinkTag href={`/rules?rule=${hit.code}`} code={hit.code} />
          <Text as="strong">v{hit.versionNo} · {hit.name}</Text>
          <PatternTag>{hit.templateName}</PatternTag>
          {/* 지금은 중지했거나 물러난 버전이 운영 중일 때 만든 적중 */}
          {hit.versionStatus !== 'ACTIVE' && <StatusTag preset={ruleStatusPresets[hit.versionStatus]}>지금은 {ruleStatusNames[hit.versionStatus]}</StatusTag>}
          <Text as="span" className="overview-shared-target">
            {alert && <><LinkTag code={alert} /> · </>}
            {transactions ? `거래 ${hit.matchedTxIds.length}건` : <>{hit.subjectLabel ?? '대상'} <Text as="code">{hit.subject}</Text></>} · 적중 날짜 {hit.hitDates.join(', ')}
          </Text>
          <Box as="ul" className="overview-shared-target case-rule-hit-conditions" aria-label="조건과 실제 값">
            {hit.conditions.map((condition, index) => <Condition key={index} condition={condition}
              measuredLabel={transactions && hit.matchedTxIds.length > 1 ? '가장 큰 거래' : '실제'} />)}
          </Box>
          {hit.roles?.length > 0 && <Box as="ul" className="overview-shared-target case-rule-hit-roles" aria-label="함께 나온 계좌">
            {roleGroups(hit.roles).map(group => <RoleAccounts key={group.role} group={group} />)}
          </Box>}
          <Text as="span" className="overview-shared-target overview-note">
            {transactions ? `이 사건의 거래 ${hit.matchedTxIds.length}건이 이 룰에 걸렸습니다.`
              : `이 사건의 거래 ${hit.matchedTxIds.length}건이 이 적중의 근거 거래입니다(근거 거래 전체 ${hit.evidenceTxCount}건).`}
          </Text>
          {matched.length > 0 && <Text as="span" className="overview-shared-target semantic-tag-group">
            {matched.map(code => <LinkTag key={code} code={code} />)}
          </Text>}
        </Box>;
      })}
    </Box>
  </>;
}
