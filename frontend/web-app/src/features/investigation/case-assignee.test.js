import { expect, it } from 'vitest';
import { caseAssigneeLabel } from './case-assignee';

it('내 업무는 "내 담당", 남의 업무는 담당자 이름(없으면 아이디)을 쓴다', () => {
  expect(caseAssigneeLabel({ assigned: true, assigneeName: '김조사' })).toBe('내 담당');
  expect(caseAssigneeLabel({ assigned: false, assigneeName: '이조사', assignee: 'l1b' })).toBe('이조사');
  expect(caseAssigneeLabel({ assigned: false, assignee: 'l1b' })).toBe('l1b');
  expect(caseAssigneeLabel({ assigned: false })).toBe('다른 담당자');
});
