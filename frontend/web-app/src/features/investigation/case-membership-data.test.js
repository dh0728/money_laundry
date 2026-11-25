import { afterEach, expect, it, vi } from 'vitest';
import { dashboardFixtures, dashboardRecordCodes } from '../../mocks/dashboard-fixtures.js';
import {
  editPreviewAlertTransactions, membershipReasonLimit, previewAlertEditUnavailable, previewAlertMembershipTargets,
} from './case-membership-data.js';
import { previewAdmin, previewStaff } from '../auth/preview-session-user.js';

const codes = {
  T: dashboardRecordCodes({ prefix: 'T', digits: 8 }),
  A: dashboardRecordCodes({ prefix: 'A', digits: 6, first: [1042, 1051, 1069] }),
  E: dashboardRecordCodes({ prefix: 'E', digits: 6 }),
};
const closedCode = 'A-261111-001051';
const reason = '동일 거래의 조사 근거를 함께 검토합니다.';
const fixture = () => dashboardFixtures(codes);
const transactionCodes = row => row.related.map(transfer => transfer.code);

afterEach(() => {
  sessionStorage.removeItem('aml-live-layout-alert-membership');
  vi.restoreAllMocks();
});

it('moves existing evidence once and recalculates both Alerts and Episode links', () => {
  const before = fixture();
  const source = before.cases.find(row => row.code === 'A-261111-000018');
  const eligible = previewAlertMembershipTargets(before.cases, source.code, previewAdmin);
  const target = eligible.find(row => source.related.some(transfer => transactionCodes(row).includes(transfer.code)));
  const shared = source.related.find(transfer => transactionCodes(target).includes(transfer.code));
  const unique = source.related.find(transfer => !transactionCodes(target).includes(transfer.code));
  const request = { cases: before.cases, sourceCode: source.code, targetCode: target.code,
    transactionCodes: [shared.code, unique.code, shared.code], reason: `  ${reason}  `, user: previewAdmin };

  const result = editPreviewAlertTransactions(request);
  expect(result).toMatchObject({ ok: true, value: {
    action: 'move', sourceCode: source.code, targetCode: target.code, transactionCodes: [shared.code, unique.code],
    reason, reviewer: previewAdmin.name, at: expect.any(String),
  } });
  const after = fixture();
  const updatedSource = after.cases.find(row => row.code === source.code);
  const updatedTarget = after.cases.find(row => row.code === target.code);
  expect(transactionCodes(updatedSource)).toEqual(transactionCodes(source).filter(code => !result.value.transactionCodes.includes(code)));
  expect(transactionCodes(updatedTarget)).toEqual([...transactionCodes(target), unique.code]);
  expect(updatedTarget.amountByCurrency[unique.currency]).toBe((target.amountByCurrency[unique.currency] ?? 0) + unique.amount);
  expect(updatedTarget.score).toBe(Math.max(target.score, unique.score));
  expect(updatedSource.membershipHistory).toEqual([result.value]);
  expect(updatedTarget.membershipHistory).toEqual([result.value]);
  expect(after.transactions).toEqual(before.transactions);
  expect(after.cases.find(row => row.code === closedCode)).toEqual(before.cases.find(row => row.code === closedCode));
  for (const episode of after.cases.filter(row => row.kind === 'Episode')) {
    const overlap = after.cases.filter(row => row.kind === 'Alert' &&
      transactionCodes(row).some(code => transactionCodes(episode).includes(code)));
    expect(episode.overlappingAlerts).toEqual(overlap);
    expect(episode.linkedAlerts).toBe(episode.linkedAlertCodes.length);
  }
  expect(editPreviewAlertTransactions(request).ok).toBe(false);
  expect(fixture()).toEqual(after);
});

it('requires a fixture actor, an eligible source and destination, live membership, and a reason', () => {
  const before = fixture();
  const source = before.cases.find(row => row.kind === 'Alert' && row.open && row.assigned);
  const unassigned = before.cases.find(row => row.kind === 'Alert' && row.open && !row.assigned);
  const closed = before.cases.find(row => row.code === closedCode);
  const request = { cases: before.cases, sourceCode: source.code, transactionCodes: transactionCodes(source),
    reason, user: previewStaff };

  expect(previewAlertEditUnavailable(unassigned, previewAdmin)).toBe('');
  expect(previewAlertEditUnavailable(unassigned, previewStaff)).toMatch(/담당/);
  expect(previewAlertMembershipTargets(before.cases, closed.code, previewAdmin)).toEqual([]);
  for (const adjustment of [
    { user: { ...previewAdmin, source: 'api' } },
    { sourceCode: closed.code, transactionCodes: transactionCodes(closed), user: previewAdmin },
    { sourceCode: unassigned.code, transactionCodes: transactionCodes(unassigned) },
    { targetCode: unassigned.code },
    { targetCode: source.code },
    { targetCode: closed.code },
    { transactionCodes: ['T-261111-99999999'] },
    { reason: '   ' },
    { reason: '가'.repeat(membershipReasonLimit + 1) },
  ]) {
    expect(editPreviewAlertTransactions({ ...request, ...adjustment }).ok).toBe(false);
  }
  expect(fixture()).toEqual(before);
});

it('discards the whole change when storage fails and supports an Alert with zero evidence', () => {
  const before = fixture();
  const source = before.cases.find(row => row.kind === 'Alert' && row.open && row.assigned);
  const request = { cases: before.cases, sourceCode: source.code, transactionCodes: transactionCodes(source),
    reason, user: previewStaff };
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Storage unavailable'); });

  expect(editPreviewAlertTransactions(request).ok).toBe(false);
  expect(fixture()).toEqual(before);
  const result = editPreviewAlertTransactions(request);
  expect(result).toMatchObject({ ok: true, value: { action: 'remove', targetCode: null } });
  const after = fixture();
  expect(after.cases.find(row => row.code === source.code)).toMatchObject({
    related: [], score: 0, relatedAccounts: 0, amountByCurrency: {}, open: true, membershipHistory: [result.value],
  });
  expect(after.transactions).toEqual(before.transactions);
});
