import { expect, it } from 'vitest';
import { findAccountTrail } from './dashboard-recommendation';

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
