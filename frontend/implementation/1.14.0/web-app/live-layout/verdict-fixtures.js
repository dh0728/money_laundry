// Sample review events are keyed by record identity and independent of model scores.
const reviewedSamples = {
  'T-261111-00000001': { verdict: 'abnormal' },
  'T-261111-00000003': { verdict: 'normal' },
  'T-261111-00000005': { verdict: 'abnormal' },
  'A-261111-001042': { verdict: 'abnormal', completedAt: '2026-11-12T09:40:00+09:00' },
  'A-261111-001051': { verdict: 'normal', completedAt: '2026-11-12T11:05:00+09:00' },
  'A-261111-000004': { verdict: 'normal', completedAt: '2026-11-12T11:05:00+09:00' },
  'A-261111-000005': { verdict: 'abnormal', completedAt: '2026-11-12T10:20:00+09:00' },
  'A-261111-000001': { verdict: 'abnormal', completedAt: '2026-11-12T09:15:00+09:00' },
  'A-261111-000002': { verdict: 'normal', completedAt: '2026-11-12T11:05:00+09:00' },
  'E-261111-000001': { verdict: 'normal', completedAt: '2026-11-13T10:25:00+09:00' },
  'E-261111-000002': { verdict: 'abnormal', completedAt: '2026-11-13T14:10:00+09:00' },
  'E-261111-000004': { verdict: 'normal', completedAt: '2026-11-13T10:25:00+09:00' },
  'E-261111-000005': { verdict: 'abnormal', completedAt: '2026-11-13T14:10:00+09:00' },
};

export function fixtureVerdict(code) {
  return reviewedSamples[code]?.verdict ?? 'unjudged';
}

export function fixtureCompletionTime(code) {
  return reviewedSamples[code]?.completedAt;
}

export function fixtureReviewStatus(verdict, unjudgedStatus) {
  return verdict === 'unjudged' ? unjudgedStatus : '처리 완료';
}
