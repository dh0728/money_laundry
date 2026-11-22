import { beforeEach, expect, test } from 'vitest';
import { alternatePreviewStaff, previewAdmin, previewStaff } from '../auth/preview-session-user';
import { previewWorkRequestEffects, previewWorkRequests, readPreviewWorkRequests,
  resolvePreviewWorkRequest, sendPreviewWorkRequest } from './preview-work-requests';

const closed = { code: 'A-261111-000009', kind: 'Alert', assigned: true, open: false,
  status: '처리 완료', verdict: 'normal', judgment: { reason: '기존 판정 사유' } };
const open = { ...closed, code: 'A-261111-000010', open: true, status: '처리 중', verdict: 'unjudged' };
const cases = [closed, open];

beforeEach(() => sessionStorage.clear());

test('종결 판정은 관리자 승인 시에만 재검토로 열리고 이전 판정은 이력에 남는다', () => {
  const request = { actor: previewStaff, cases, typeKey: 'reopen', code: closed.code, reason: '거래 원장 재대조' };
  expect(sendPreviewWorkRequest(request).ok).toBe(true);
  expect(sendPreviewWorkRequest(request).ok).toBe(false);
  expect(previewWorkRequestEffects().size).toBe(0);
  expect(previewWorkRequests(alternatePreviewStaff)).toEqual([]);
  const [received] = previewWorkRequests(previewAdmin);
  readPreviewWorkRequests(previewStaff, [received.id]);
  expect(previewWorkRequests(previewAdmin)[0].unreadFor).toEqual([previewAdmin.username]);
  const approval = { cases, id: received.id, action: 'approved', note: '다시 검토' };
  expect(resolvePreviewWorkRequest({ ...approval, actor: previewStaff }).ok).toBe(false);
  expect(resolvePreviewWorkRequest({ ...approval, actor: previewAdmin }).ok).toBe(true);
  expect(resolvePreviewWorkRequest({ ...approval, actor: previewAdmin }).ok).toBe(false);
  expect(previewWorkRequestEffects().get(closed.code)).toMatchObject({
    reviewStateAt: expect.any(String), reviewStatus: '처리 중',
  });
  expect(previewWorkRequests(previewStaff)[0]).toMatchObject({
    state: 'approved', unreadFor: [previewStaff.username], before: { verdict: 'normal', judgment: closed.judgment },
  });
});

test('업무 재배정은 새 담당자에게 즉시 적용되고 받은 담당자만 처리 결과를 보낸다', () => {
  expect(sendPreviewWorkRequest({ actor: previewAdmin, cases, typeKey: 'assign',
    code: open.code, recipient: alternatePreviewStaff.username, reason: '담당 변경' }).ok).toBe(true);
  expect(previewWorkRequestEffects().get(open.code)).toEqual({ assignee: alternatePreviewStaff.username });
  const [item] = previewWorkRequests(alternatePreviewStaff);
  expect(previewWorkRequests(previewStaff)[0]).toMatchObject({ id: item.id,
    unreadFor: [alternatePreviewStaff.username, previewStaff.username] });
  expect(resolvePreviewWorkRequest({ actor: previewStaff, cases, id: item.id,
    action: 'completed', note: '이전 담당자' }).ok).toBe(false);
  expect(resolvePreviewWorkRequest({ actor: previewAdmin, cases, id: item.id, action: 'cancelled' }).ok).toBe(false);
  expect(resolvePreviewWorkRequest({ actor: alternatePreviewStaff, cases, id: item.id,
    action: 'completed', note: '배정 확인' }).ok).toBe(true);
  expect(previewWorkRequests(previewAdmin)[0]).toMatchObject({
    state: 'completed', unreadFor: [previewStaff.username, previewAdmin.username],
  });
});

test('관리자는 종결 건을 처리 전으로 되돌릴 수 있고 진행 건도 원하는 처리 상태로 바꿀 수 있다', () => {
  const request = { actor: previewAdmin, cases, recipient: previewStaff.username, reason: '다시 확인' };
  expect(sendPreviewWorkRequest({ ...request, typeKey: 'reviewAgain', code: closed.code, reviewStatus: '처리 전' }).ok).toBe(true);
  expect(sendPreviewWorkRequest({ ...request, typeKey: 'changeStatus', code: open.code, reviewStatus: '처리 완료' }).ok).toBe(false);
  expect(sendPreviewWorkRequest({ ...request, typeKey: 'changeStatus', code: open.code, reviewStatus: '처리 전' }).ok).toBe(true);
  expect(previewWorkRequestEffects().get(closed.code)).toMatchObject({ reviewStatus: '처리 전' });
  expect(previewWorkRequestEffects().get(open.code)).toMatchObject({ reviewStatus: '처리 전' });
});

test('편입된 Alert를 다시 열 수 없고 미처리 요청을 취소하면 업무 상태가 유지된다', () => {
  expect(sendPreviewWorkRequest({ actor: previewStaff, cases: [{ ...closed, episodeCode: 'E-261111-000003' }],
    typeKey: 'reopen', code: closed.code, reason: '재검토' }).ok).toBe(false);
  expect(sendPreviewWorkRequest({ actor: previewStaff, cases, typeKey: 'extension',
    code: open.code, reason: '자료 도착 지연', deadline: '2026-11-25' }).ok).toBe(true);
  const [item] = previewWorkRequests(previewStaff);
  expect(resolvePreviewWorkRequest({ actor: previewStaff, cases, id: item.id, action: 'cancelled' }).ok).toBe(true);
  expect(previewWorkRequests(previewAdmin)[0]).toMatchObject({ state: 'cancelled' });
  expect(previewWorkRequestEffects().size).toBe(0);
});

test('다른 담당자의 종결 건도 공통 근거와 함께 요청할 수 있고 승인만으로 판정은 바뀌지 않는다', () => {
  const tx = { code: 'T-261111-00000001', from: { code: 'ACC-1' }, to: { code: 'ACC-2' } };
  const request = { actor: previewStaff, code: open.code, typeKey: 'relationReview', reason: '관련 거래 확인',
    relatedCodes: [closed.code],
    cases: [{ ...open, related: [tx] }, { ...closed, assigned: false, related: [tx] }] };
  expect(sendPreviewWorkRequest({ ...request, relatedCodes: [open.code] }).ok).toBe(false);
  expect(sendPreviewWorkRequest(request).ok).toBe(true);
  expect(sendPreviewWorkRequest(request).ok).toBe(false);
  const [item] = previewWorkRequests(previewAdmin);
  expect(item.related).toMatchObject([{ code: closed.code, verdict: 'normal', assignee: alternatePreviewStaff.username,
    transactions: [tx.code], accounts: ['ACC-1', 'ACC-2'] }]);
  expect(resolvePreviewWorkRequest({ actor: previewAdmin, cases: request.cases, id: item.id,
    action: 'approved', note: '공통 거래 재검토' }).ok).toBe(true);
  expect(previewWorkRequestEffects().size).toBe(0);
});
