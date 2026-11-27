import { expect, it } from 'vitest';
import { nextReviewCase } from './case-judgment-data';

const row = (code, extra = {}) => ({
  code, assigned: true, open: true, verdict: 'unjudged', status: '처리 전', score: 50, elapsed: 1, ...extra,
});

it('판정 뒤 다음 건은 내 담당·열림·미판정 건만 고른다', () => {
  const rows = [
    row('A-230916-000001'),
    row('A-230916-000002', { assigned: false, reviewDueOn: '2023-09-01' }),
    row('A-230916-000003', { open: false, reviewDueOn: '2023-09-01' }),
    row('A-230916-000004', { verdict: 'normal', reviewDueOn: '2023-09-01' }),
    row('A-230916-000005', { status: '처리 완료', reviewDueOn: '2023-09-01' }),
  ];
  expect(nextReviewCase(rows, 'A-230916-000009')?.code).toBe('A-230916-000001');
  expect(nextReviewCase([row('A-230916-000001')], 'A-230916-000001')).toBeUndefined();
  expect(nextReviewCase(undefined, 'A-230916-000001')).toBeUndefined();
});

it('처리 기한 → 처리 중 → 위험 점수 × 경과일 → 코드 순으로 고른다', () => {
  const urgent = row('A-230916-000010', { score: 99, elapsed: 30 });
  const working = row('E-230916-000020', { status: '처리 중', score: 10, elapsed: 1 });
  const due = row('A-230916-000030', { reviewDueOn: '2023-09-20', score: 1, elapsed: 1 });
  const dueEarlier = row('A-230916-000040', { reviewDueOn: '2023-09-18', score: 1, elapsed: 1 });
  expect(nextReviewCase([urgent, working, due, dueEarlier])?.code).toBe('A-230916-000040');
  expect(nextReviewCase([urgent, working, due])?.code).toBe('A-230916-000030');
  expect(nextReviewCase([urgent, working])?.code).toBe('E-230916-000020');
  expect(nextReviewCase([row('A-230916-000060', { score: 20, elapsed: 2 }), row('A-230916-000050', { score: 30, elapsed: 2 })])?.code)
    .toBe('A-230916-000050');
  expect(nextReviewCase([row('A-230916-000080'), row('A-230916-000070')])?.code).toBe('A-230916-000070');
});
