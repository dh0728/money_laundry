import { expect, it, vi } from 'vitest';
import { attachAiReports, judgmentNumber } from './case-ai-report';

// "AI 보고서 다운로드" 때 '이상' 판정에만 서버 AI 보고서를 붙인다. 실패해도 나머지 PDF 는 만든다.

it('판정 ID 끝 번호를 서버 판정 번호로 읽는다', () => {
  expect(judgmentNumber('J-230916-000001')).toBe(1);
  expect(judgmentNumber('J-230916-012345')).toBe(12345);
  expect(judgmentNumber('sample')).toBeNull();
});

it("서비스 모드에서 '이상' 판정에만 AI 보고서를 붙이고, 실패는 표시만 한다", async () => {
  const fetch = vi.fn(async id => {
    if (id === 2) throw new Error('AI 보고서를 만들지 못했습니다.');
    return { reportId: 9, judgmentId: id };
  });
  const rows = [
    { id: 'J-230916-000001', verdict: 'abnormal' },
    { id: 'J-230916-000002', verdict: 'abnormal' },
    { id: 'J-230916-000003', verdict: 'normal' },
  ];
  const result = await attachAiReports(rows, { live: true, fetch });
  expect(fetch.mock.calls.map(([id]) => id)).toEqual([1, 2]);
  expect(result[0].aiReport).toEqual({ reportId: 9, judgmentId: 1 });
  expect(result[1].aiReportError).toBe('AI 보고서를 만들지 못했습니다.');
  expect(result[2]).toBe(rows[2]);
});

it('샘플 모드에서는 부르지 않는다', async () => {
  const fetch = vi.fn();
  const rows = [{ id: 'J-230916-000001', verdict: 'abnormal' }];
  expect(await attachAiReports(rows, { live: false, fetch })).toBe(rows);
  expect(fetch).not.toHaveBeenCalled();
});
