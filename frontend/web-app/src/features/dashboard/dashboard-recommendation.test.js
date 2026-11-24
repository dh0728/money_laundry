import { expect, it } from 'vitest';
import { accountTrailComparison, findAccountTrail } from './dashboard-recommendation';

const transfer = (code, time, from, to) => ({ code, timestamp: `2026-11-11 ${time}`, from: { code: from }, to: { code: to } });
const alert = { code: 'A-1', kind: 'Alert', open: true, related: [transfer('T-1', '10:00', 'ACC-A', 'ACC-B')] };
const episode = { code: 'E-1', kind: 'Episode', open: false, related: [transfer('T-2', '10:15', 'ACC-B', 'ACC-C')] };

it('returns verifiable receiving and sending evidence for the same account across two cases', () => {
  expect(findAccountTrail([episode, alert])).toMatchObject({ account: 'ACC-B',
    received: { record: alert, transaction: alert.related[0] }, sent: { record: episode, transaction: episode.related[0] } });
  expect(findAccountTrail([{ ...episode, related: [transfer('T-3', '08:30', 'ACC-C', 'ACC-A')] }, alert]))
    .toMatchObject({ account: 'ACC-A', received: { record: { code: episode.code } }, sent: { record: alert } });
});

it('skips known memberships, closed-only pairs and evidence with no chronological link', () => {
  expect(findAccountTrail([alert, { ...episode, linkedAlertCodes: [alert.code] }])).toBeNull();
  expect(findAccountTrail([{ ...alert, episodeCode: episode.code }, episode])).toBeNull();
  expect(findAccountTrail([{ ...alert, open: false }, episode])).toBeNull();
  expect(findAccountTrail([alert, { ...episode, related: [transfer('T-2', '09:00', 'ACC-B', 'ACC-C')] }])).toBeNull();
  expect(findAccountTrail([alert, { ...episode, related: [transfer('T-1', '10:15', 'ACC-B', 'ACC-C')] }])).toBeNull();
  expect(findAccountTrail([alert])).toBeNull();
});

it('prefers a cross-case return with the same currency and amount over a closer unrelated outgoing transfer', () => {
  const amount = { amount: 420, currency: 'USD' };
  const inbound = { ...alert, related: [{ ...alert.related[0], ...amount }] };
  const outbound = { ...episode, related: [
    transfer('T-2', '10:01', 'ACC-B', 'ACC-C'),
    { ...transfer('T-3', '10:15', 'ACC-B', 'ACC-A'), ...amount },
  ] };
  expect(findAccountTrail([inbound, outbound])).toMatchObject({ returned: true, sameAmount: true,
    sent: { transaction: { code: 'T-3' } } });
  expect(findAccountTrail([inbound, { ...outbound, related: [{ ...outbound.related[1], currency: 'EUR' }] }]))
    .toMatchObject({ returned: true, sameAmount: false });
});

it('shows exactly the member Alerts and identifies the member with intersecting evidence', () => {
  const firstMember = { ...alert, code: 'A-member-1', related: episode.related };
  const secondMember = { ...alert, code: 'A-member-2', related: [transfer('T-3', '12:00', 'ACC-C', 'ACC-D')] };
  const second = { ...episode, linkedAlertCodes: [firstMember.code, secondMember.code], linkedAlertCodesComplete: true,
    related: [...firstMember.related, ...secondMember.related] };
  const unrelated = { ...firstMember, code: 'A-standalone' };
  const trail = findAccountTrail([alert, second]);
  const comparison = accountTrailComparison(trail, [alert, second, firstMember, secondMember, unrelated]);
  expect(comparison.shared).toEqual(['ACC-B']);
  expect(comparison.members).toEqual([
    { code: firstMember.code, shared: ['ACC-B'], evidenceAvailable: true },
    { code: secondMember.code, shared: [], evidenceAvailable: true },
  ]);
  expect([trail.received.transaction.code, trail.sent.transaction.code]).toEqual(['T-1', 'T-2']);
  expect(accountTrailComparison(findAccountTrail([alert, second]), [alert, second, firstMember]).members[1])
    .toEqual({ code: secondMember.code, shared: [], evidenceAvailable: false });
});
