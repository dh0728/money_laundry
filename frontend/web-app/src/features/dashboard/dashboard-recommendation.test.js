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

it('shows connected account transfers with their actual Alert membership', () => {
  const firstMember = { ...alert, code: 'A-member-1', related: episode.related };
  const secondMember = { ...alert, code: 'A-member-2', related: [transfer('T-3', '12:00', 'ACC-C', 'ACC-D')] };
  const second = { ...episode, linkedAlertCodes: [firstMember.code, secondMember.code], linkedAlertCodesComplete: true,
    related: [...firstMember.related, ...secondMember.related] };
  const unrelated = { ...firstMember, code: 'A-standalone' };
  const trail = findAccountTrail([alert, second]);
  const comparison = accountTrailComparison(trail, [alert, second, firstMember, secondMember, unrelated]);
  expect(comparison.shared).toEqual(['ACC-B']);
  expect(comparison.transfers).toMatchObject([
    { code: 'T-1', comparison: true, memberAlerts: [] },
    { code: 'T-2', episode: true, memberAlerts: [firstMember.code] },
    { code: 'T-3', episode: true, memberAlerts: [secondMember.code] },
  ]);
  const incomplete = accountTrailComparison(trail, [alert, second, firstMember]);
  expect(incomplete.transfers[2]).toMatchObject({ code: 'T-3', episode: true, memberAlerts: [] });
});

it('keeps common transfers as one edge and omits records disconnected from the recommendation', () => {
  const detached = transfer('T-detached', '12:00', 'ACC-Y', 'ACC-Z');
  const second = { ...episode, related: [...alert.related, ...episode.related, detached] };
  const trail = findAccountTrail([alert, second]);
  const comparison = accountTrailComparison(trail, [alert, second]);
  expect(comparison.transfers).toMatchObject([
    { code: 'T-1', comparison: true, episode: true },
    { code: 'T-2', episode: true },
  ]);
  expect(comparison.omittedTransfers).toBe(1);
});
