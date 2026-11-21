import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const alert = 'A-261111-000009';
const episode = 'E-261111-000003';
const fixture = { A: [alert], E: [episode] };
const storage = new Map();

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal('sessionStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  });
});

afterEach(() => vi.unstubAllGlobals());

test('first opening a case updates only its unread flag across fixture rebuild and reload', async () => {
  const { markPreviewCaseRead } = await import('./case-read-state.js');
  const { dashboardFixtures } = await import('../../mocks/dashboard-fixtures.js');
  const [unreadAlert, unreadEpisode] = dashboardFixtures(fixture).cases;
  expect(unreadAlert).toMatchObject({ code: alert, unread: true, status: '처리 전' });
  expect(unreadEpisode).toMatchObject({ code: episode, unread: true });
  expect(markPreviewCaseRead(unreadAlert)).toBe(true);
  expect(markPreviewCaseRead(unreadAlert)).toBe(false);
  expect(dashboardFixtures(fixture).cases).toMatchObject([
    { code: alert, unread: false, status: '처리 전' },
    { code: episode, unread: true },
  ]);

  vi.resetModules();
  const restored = await import('../../mocks/dashboard-fixtures.js');
  expect(restored.dashboardFixtures(fixture).cases[0]).toMatchObject({ unread: false, status: '처리 전' });
  const { markPreviewCaseRead: markRestoredCaseRead, resetPreviewCaseRead } = await import('./case-read-state.js');
  expect(markRestoredCaseRead(restored.dashboardFixtures(fixture).cases[1])).toBe(true);
  expect(restored.dashboardFixtures(fixture).cases[1]).toMatchObject({ unread: false, status: '처리 전' });
  resetPreviewCaseRead();
  expect(storage.size).toBe(0);
  expect(restored.dashboardFixtures(fixture).cases[0].unread).toBe(true);
});

test('opening a transaction, an already-read case or an unknown code stores nothing', async () => {
  const { markPreviewCaseRead } = await import('./case-read-state.js');
  expect(markPreviewCaseRead({ code: 'T-261111-00000009', unread: true })).toBe(false);
  expect(markPreviewCaseRead({ code: episode, unread: false })).toBe(false);
  expect(markPreviewCaseRead({ code: 'invalid', unread: true })).toBe(false);
  expect(markPreviewCaseRead(undefined)).toBe(false);
  expect(storage.size).toBe(0);
});

test('a pending case requires an explicit start and a saved judgment completes it on reload', async () => {
  const { markPreviewCaseRead } = await import('./case-read-state.js');
  const { dashboardFixtures } = await import('../../mocks/dashboard-fixtures.js');
  const { canStartPreviewReview, canJudgePreviewCase, startPreviewReview, savePreviewJudgment } =
    await import('./case-judgment-data.js');
  const unread = dashboardFixtures(fixture).cases[0];
  expect(startPreviewReview(unread)).toBe(false);
  expect(markPreviewCaseRead(unread)).toBe(true);
  const pending = dashboardFixtures(fixture).cases[0];
  expect(canStartPreviewReview(pending)).toBe(true);
  expect(canStartPreviewReview({ ...pending, assigned: false })).toBe(false);
  const details = { evidence: ' 대조한 원장 ', observations: ' 거래 금액 확인 ', rationale: ' 정상 영업 확인 ' };
  expect(savePreviewJudgment(pending, 'normal', details, 'normal-business', '분석가').ok).toBe(false);
  expect(startPreviewReview(pending)).toBe(true);
  expect(startPreviewReview(pending)).toBe(false);

  vi.resetModules();
  const { dashboardFixtures: restoredFixtures } = await import('../../mocks/dashboard-fixtures.js');
  const { savePreviewJudgment: saveAfterReload, previewJudgmentReason } = await import('./case-judgment-data.js');
  const [review, untouched] = restoredFixtures(fixture).cases;
  expect(review).toMatchObject({ status: '처리 중', unread: false });
  expect(untouched).toMatchObject({ status: '처리 전', unread: true });
  expect(canJudgePreviewCase(review)).toBe(true);
  expect(saveAfterReload(review, 'normal', details, 'invalid').ok).toBe(false);
  for (const field of Object.keys(details)) {
    expect(saveAfterReload(review, 'normal', { ...details, [field]: ' ' }, 'normal-business').ok).toBe(false);
  }
  expect(saveAfterReload(review, 'normal', details, 'normal-business', ' 분석가 ').ok).toBe(true);
  const completed = restoredFixtures(fixture).cases[0];
  expect(completed).toMatchObject({ status: '처리 완료', verdict: 'normal', open: false,
    judgment: { evidence: '대조한 원장', observations: '거래 금액 확인', reason: '정상 영업 확인',
      reasonCategory: 'normal-business', reviewer: '분석가' } });
  expect(previewJudgmentReason(completed.judgment)).toBe('정상 영업 거래 · 정상 영업 확인');
  vi.resetModules();
  const { dashboardFixtures: persistedFixtures } = await import('../../mocks/dashboard-fixtures.js');
  expect(persistedFixtures(fixture).cases[0].judgment).toEqual(completed.judgment);
});

test('existing saved judgments still restore even if the original fixture was pending', async () => {
  storage.set('aml-live-layout-case-judgments', JSON.stringify([{
    code: alert, id: 'J-261119-100001', verdict: 'abnormal', reason: '기존 판정', at: '2026-11-19T09:00:00Z',
  }]));
  const { dashboardFixtures } = await import('../../mocks/dashboard-fixtures.js');
  expect(dashboardFixtures(fixture).cases[0]).toMatchObject({ status: '처리 완료', verdict: 'abnormal', open: false });
});
