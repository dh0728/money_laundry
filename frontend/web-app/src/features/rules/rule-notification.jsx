import React from 'react';
import { Text } from '@/components/layout-primitives';
import { LinkTag } from '../../components/semantic-tags';

// 보관함의 룰 알림. 서버는 다른 알림과 같은 목록에 caseKind=RULE, code=룰 번호(RULE-003)로 준다(API.md §11 "룰 알림").
// 받는 사람과 문구는 서버가 정한다. 화면은 어느 룰인지 보여 주고 그 룰의 화면으로 가는 길만 붙인다.

const ruleCode = /^RULE-\d{3,}$/;
const backtestKinds = new Set(['RULE_BACKTEST_DONE', 'RULE_BACKTEST_FAILED']);

/** 룰 알림이 여는 화면. 백테스트 결과는 백테스트 화면, 나머지는 룰 상세다. 룰 알림이 아니면 null. */
export function ruleNotificationLink(item) {
  if (item?.caseKind !== 'RULE' || !ruleCode.test(item.code ?? '')) return null;
  return backtestKinds.has(item.kind)
    ? { label: '백테스트', href: `/rules/backtest?rule=${item.code}` }
    : { label: '룰 상세', href: `/rules?rule=${item.code}` };
}

/** 보관함 한 줄의 제목. 룰 알림은 제목("룰 승인 요청")만으로는 어느 룰인지 몰라 룰 번호를 붙인다. */
export const notificationRowTitle = item => (ruleNotificationLink(item) ? `${item.title} · ${item.code}` : item.title);

/** 알림 상세 창에 넣는 한 줄: "룰 상세 [RULE-003]". 룰 알림이 아니면 아무것도 그리지 않는다. */
export function RuleNotificationLink({ item }) {
  const link = ruleNotificationLink(item);
  if (!link) return null;
  return <Text>{link.label} <LinkTag href={link.href} code={item.code} aria-label={`${item.code} ${link.label} 열기`} /></Text>;
}
