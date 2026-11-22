import { expect, it, vi } from 'vitest';
import { createServerRuleRepository } from './rule-repository';
import { previewAdmin, previewStaff } from '../auth/preview-session-user.js';

const rule = (id, status, author = previewStaff.name) => ({ id, status, author, name: id, description: '', typeCode: null,
  scoreMin: 0.5, minTransactions: 1, windowHours: 24, history: [] });

function serverApi(rules) {
  return {
    fetchLiveRules: vi.fn(async () => rules),
    saveLiveRule: vi.fn(async (input, id) => ({ ok: true, value: { ...rule(id ?? 'RULE-900', 'DRAFT'), ...input } })),
    reviewLiveRule: vi.fn(async (id, status) => ({ ok: true, value: { ...rules.find(row => row.id === id), status } })),
    deleteLiveRule: vi.fn(async id => ({ ok: true, value: id })),
    liveBacktestScope: vi.fn(async () => ({ start: '2026-10-24', end: '2026-11-22', count: 3 })),
    runLiveBacktest: vi.fn(async () => ({ matchedCount: 0, transactions: [] })),
  };
}

it('sends supported rule changes to the server and explains the ones the server does not have yet', async () => {
  const api = serverApi([rule('RULE-001', 'ACTIVE'), rule('RULE-002', 'TESTING'), rule('RULE-003', 'DRAFT')]);
  const repository = createServerRuleRepository({ api, user: () => previewAdmin });
  const [active, testing] = await repository.list();
  expect(active.allowedActions).toContain('stop');
  expect(testing.blockedReasons.activate).toBe('서버에 아직 이 동작이 없어요.');
  expect(active.blockedReasons.archive).toBe('서버에 아직 이 동작이 없어요.');

  const stopped = await repository.transition('RULE-001', 'stop', '오탐 증가');
  expect(api.reviewLiveRule).toHaveBeenCalledWith('RULE-001', 'STOPPED', '오탐 증가');
  expect(stopped).toMatchObject({ ok: true, value: { id: 'RULE-001', status: 'STOPPED' } });
  expect(await repository.transition('RULE-002', 'activate', '운영')).toEqual({ ok: false, error: '서버에 아직 이 동작이 없어요.' });
  expect(await repository.archive('RULE-002', '보관')).toEqual({ ok: false, error: '서버에 아직 이 동작이 없어요.' });
  expect(api.reviewLiveRule).toHaveBeenCalledTimes(1);
});

it('deletes only draft or rejected rules through the server, for the author or an administrator', async () => {
  const api = serverApi([rule('RULE-001', 'ACTIVE'), rule('RULE-003', 'DRAFT'), rule('RULE-004', 'REJECTED', '다른 직원')]);
  const repository = createServerRuleRepository({ api, user: () => previewStaff });
  expect(await repository.delete('RULE-001')).toMatchObject({ ok: false });
  expect(await repository.delete('RULE-004')).toMatchObject({ ok: false });
  expect(await repository.delete('RULE-003')).toEqual({ ok: true, value: 'RULE-003' });
  expect(api.deleteLiveRule).toHaveBeenCalledTimes(1);
  expect((await repository.list()).map(row => row.id)).toEqual(['RULE-001', 'RULE-004']);
});

it('reads the server list again when asked for a fresh copy', async () => {
  const api = serverApi([rule('RULE-001', 'ACTIVE')]);
  const repository = createServerRuleRepository({ api, user: () => previewAdmin });
  await repository.list();
  await repository.list();
  expect(api.fetchLiveRules).toHaveBeenCalledTimes(1);
  await repository.list({ fresh: true });
  expect(api.fetchLiveRules).toHaveBeenCalledTimes(2);
});
