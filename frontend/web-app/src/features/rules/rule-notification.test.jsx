import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { notificationRowTitle, ruleNotificationLink, RuleNotificationLink } from './rule-notification';

// 서버가 주는 알림 한 줄(API.md §11). 룰 알림은 caseKind=RULE, caseId=null, code=룰 번호다.
const rule = (kind, title, more = {}) => ({
  id: 'rule-event:7', kind, title, description: '급속 통과 감시 v1 · L1 심사자 A', code: 'RULE-004', count: 1,
  at: '2023-09-17T09:00:00+09:00', read: false, caseId: null, caseKind: 'RULE', ...more,
});
const assigned = { id: 'batch:1', kind: 'ALERT_ASSIGNED', title: '새 Alert 배정', description: '3건의 Alert가 배정되었습니다.',
  code: 'ANALYSIS-12', count: 3, at: '2023-09-17T09:00:00+09:00', read: false, caseId: null, caseKind: 'ALERT' };

it('룰 알림은 그 룰의 상세를, 백테스트 결과는 백테스트 화면을 연다', () => {
  for (const kind of ['RULE_SUBMITTED', 'RULE_WITHDRAWN', 'RULE_APPROVED', 'RULE_REJECTED', 'RULE_PAUSED', 'RULE_RESUMED', 'RULE_SHADOW_STARTED', 'RULE_RUN_FAILED'])
    expect(ruleNotificationLink(rule(kind, '룰 알림'))).toEqual({ label: '룰 상세', href: '/rules?rule=RULE-004' });
  for (const kind of ['RULE_BACKTEST_DONE', 'RULE_BACKTEST_FAILED'])
    expect(ruleNotificationLink(rule(kind, '백테스트 완료'))).toEqual({ label: '백테스트', href: '/rules/backtest?rule=RULE-004' });
  // 서버가 새 종류를 더해도 룰 알림이면 룰 상세로 간다
  expect(ruleNotificationLink(rule('RULE_SOMETHING_NEW', '새 알림'))).toEqual({ label: '룰 상세', href: '/rules?rule=RULE-004' });
});

it('사건 알림과 룰 번호가 아닌 code 에는 길을 만들지 않는다', () => {
  expect(ruleNotificationLink(assigned)).toBeNull();
  expect(ruleNotificationLink(rule('RULE_APPROVED', '룰 승인', { code: 'A-230917-000001' }))).toBeNull();
  expect(ruleNotificationLink(rule('RULE_APPROVED', '룰 승인', { code: 'RULE-4&x=1' }))).toBeNull();
  expect(ruleNotificationLink(rule('RULE_APPROVED', '룰 승인', { code: undefined }))).toBeNull();
  expect(ruleNotificationLink(undefined)).toBeNull();
});

it('보관함 한 줄에서 룰 알림은 제목 뒤에 룰 번호를 붙이고 다른 알림은 그대로 둔다', () => {
  expect(notificationRowTitle(rule('RULE_SUBMITTED', '룰 승인 요청'))).toBe('룰 승인 요청 · RULE-004');
  expect(notificationRowTitle(assigned)).toBe('새 Alert 배정');
  expect(notificationRowTitle({ id: 3, title: '[테스트] 알림 03', description: '', read: true })).toBe('[테스트] 알림 03');
});

it('알림 상세 창에는 그 룰로 가는 링크 한 줄을 그린다', () => {
  const { rerender, container } = render(<RuleNotificationLink item={rule('RULE_REJECTED', '룰 반려')} />);
  expect(screen.getByRole('link', { name: 'RULE-004 룰 상세 열기' })).toHaveAttribute('href', '/rules?rule=RULE-004');
  expect(container).toHaveTextContent('룰 상세 RULE-004');
  rerender(<RuleNotificationLink item={rule('RULE_BACKTEST_FAILED', '백테스트 실패')} />);
  expect(screen.getByRole('link', { name: 'RULE-004 백테스트 열기' })).toHaveAttribute('href', '/rules/backtest?rule=RULE-004');
  rerender(<RuleNotificationLink item={assigned} />);
  expect(container).toBeEmptyDOMElement();
});
