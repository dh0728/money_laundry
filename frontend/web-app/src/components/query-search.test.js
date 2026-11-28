import { expect, it } from 'vitest';
import { matchesSearch, visibleCaseRows } from './query-controls';

const rows = [
  { code: 'A-230916-002188', pattern: 'Fan-in 100%', assigned: true, assigneeName: '오분석', assignee: 'reviewer',
    status: '처리 전', verdict: 'unjudged', date: new Date(2023, 8, 16) },
  { code: 'A-230915-000123', pattern: 'Cycle 74%', assigned: false, assigneeName: '김조사', assignee: 'kim',
    status: '처리 중', verdict: 'unjudged', date: new Date(2023, 8, 15) },
  { code: 'E-230914-000013', pattern: 'Fan-out 60%', patterns: ['Fan-out', 'Gather-scatter'], assigned: false, assignee: 'lee',
    status: '처리 중', verdict: 'unjudged', date: new Date(2023, 8, 14) },
];
const query = search => ({ sort: '', risks: [], patterns: [], elapsed: [], statuses: [], verdicts: [], assignment: 'all', range: undefined, search });
const codes = search => visibleCaseRows(rows, query(search)).map(row => row.code);

it('Alert·Episode 목록은 ID·탐지 유형·담당자로 찾는다', () => {
  expect(codes('')).toEqual(rows.map(row => row.code));
  expect(codes('002188')).toEqual(['A-230916-002188']);
  expect(codes('FAN')).toEqual(['A-230916-002188', 'E-230914-000013']);
  expect(codes('gather')).toEqual(['E-230914-000013']);
  expect(codes('김조사')).toEqual(['A-230915-000123']);
  expect(codes('lee')).toEqual(['E-230914-000013']);
  expect(codes('내 담당')).toEqual(['A-230916-002188']);
  expect(codes('zzz')).toEqual([]);
});

it('여러 낱말은 모두 들어 있어야 맞는다', () => {
  expect(codes('fan 오분석')).toEqual(['A-230916-002188']);
  expect(matchesSearch(['J-230908-000001', 'A-230916-002188', '오분석'], ' j-2309  오분석 ')).toBe(true);
  expect(matchesSearch(['J-230908-000001', '오분석'], 'j-2309 김조사')).toBe(false);
});
