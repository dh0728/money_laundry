import { describe, expect, it } from 'vitest';
import { caseOverviewEvidence, relatedJudgments } from './case-overview-evidence';

const hub = { code: 'ACC-1002', owner: '소유주-001' };
const sender = { code: 'ACC-1066', owner: '소유주-006' };
const recipient = { code: 'ACC-1040', owner: '소유주-004' };
const transfers = [
  { code: 'T-1', from: hub, to: recipient, amount: 435000, currency: 'KRW', score: 57, timestamp: '2026-11-11 13:32' },
  { code: 'T-2', from: hub, to: recipient, amount: 1680, currency: 'USD', score: 95, timestamp: '2026-11-11 14:33' },
  { code: 'T-3', from: sender, to: hub, amount: 725000, currency: 'KRW', score: 82, timestamp: '2026-11-11 15:34' },
];

describe('case overview evidence', () => {
  it('deduplicates transactions and compares flows only in their own currency', () => {
    const result = caseOverviewEvidence([...transfers, transfers[2]]);
    expect(result.records).toHaveLength(3);
    expect(result.focus?.code).toBe(hub.code);
    expect(result.lead?.code).toBe('T-2');
    expect(result.flows).toEqual([
      { currency: 'KRW', inflow: 725000, outflow: 435000, net: 290000, ratio: 60 },
      { currency: 'USD', inflow: 0, outflow: 1680, net: -1680, ratio: null },
    ]);
  });

  it('does not assign a center when participation is tied', () => {
    expect(caseOverviewEvidence([transfers[0]])).toMatchObject({ focus: undefined, flows: [] });
  });

  it('finds other judgments by actual shared accounts and retains only matching targets', () => {
    const other = { code: 'ACC-9000' };
    const judgments = [{ id: 'J-1', targets: [
      { code: 'A-current', related: transfers },
      { code: 'A-other', related: [{ from: other, to: hub }] },
      { code: 'A-unrelated', related: [{ from: other, to: other }] },
    ] }];
    expect(relatedJudgments(judgments, 'A-current', caseOverviewEvidence(transfers))
      .map(({ targets }) => targets.map(({ code, sharedAccounts }) => [code, sharedAccounts])))
      .toEqual([[['A-other', [hub.code]]]]);
  });
});
