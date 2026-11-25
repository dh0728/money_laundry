import { createWorkspaceState, saveWorkspaceRule, transitionWorkspaceRule } from '@/next/workspace-data';
import { isRuleId, RULE_LIMITS, ruleActionState, ruleReasonProblem, ruleTransitionActions, runBacktest } from '@/next/features/rules-logic';
import { currentPreviewUser } from '../auth/preview-session-user.js';

// 룰 화면이 데이터를 읽고 쓰는 유일한 자리. 화면은 이 객체의 함수만 부르고, 모든 함수는 Promise를 돌려준다.
// - 조회(list·get·backtest·backtestScope)는 값을 주고, 읽지 못하면 reject 한다.
// - 변경(save·transition·archive·delete)은 { ok: true, value } 또는 { ok: false, error } 로 끝난다.
// - 룰마다 allowedActions(지금 할 수 있는 동작)와 blockedReasons(못 하는 이유)를 붙여 준다.
// duplicateDraft는 원본 조건으로 저장 전 입력값을 만든다.

const draftStorageKey = 'aml-preview-rule-drafts';
const deletedStorageKey = 'aml-preview-rule-deleted';
const sampleUnavailable = '이 브라우저 탭에 룰 변경을 저장할 수 없습니다.';
const notFound = { ok: false, error: '룰을 찾을 수 없습니다.' };

function readJson(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function createSampleRuleRepository({ storage = globalThis.sessionStorage, user = currentPreviewUser,
  seed = createWorkspaceState() } = {}) {
  const templatesById = new Map(seed.rules.map(rule => [rule.id, rule]));
  const listeners = new Set();
  let rules;

  function current() {
    if (rules) return rules;
    const byId = new Map(templatesById);
    for (const id of readJson(storage, deletedStorageKey)) byId.delete(id);
    for (const rule of readJson(storage, draftStorageKey)) if (rule && isRuleId(rule.id)) byId.set(rule.id, rule);
    rules = [...byId.values()];
    return rules;
  }

  const view = rule => ({ ...rule, ...ruleActionState(rule, user()) });
  const find = id => isRuleId(id) ? current().find(rule => rule.id === id) : undefined;

  function commit(next, deletedId) {
    try {
      storage.setItem(draftStorageKey, JSON.stringify(next.filter(rule => rule !== templatesById.get(rule.id))));
      if (deletedId && templatesById.has(deletedId)) {
        storage.setItem(deletedStorageKey, JSON.stringify([...new Set([...readJson(storage, deletedStorageKey), deletedId])]));
      }
    } catch {
      return false;
    }
    rules = next;
    listeners.forEach(listener => listener());
    return true;
  }

  function blocked(rule, action) {
    const { blockedReasons } = ruleActionState(rule, user());
    return blockedReasons[action];
  }

  function withActor(record, action) {
    const actor = user()?.name;
    const history = [...record.history];
    history[history.length - 1] = { ...history.at(-1), ...(actor && { actor }), ...(action && { action }) };
    return { ...record, history };
  }

  function replace(record) {
    const known = current().some(rule => rule.id === record.id);
    return known ? current().map(rule => rule.id === record.id ? record : rule) : [...current(), record];
  }

  const settle = run => new Promise(resolve => resolve(run()));

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    list: ({ includeArchived = false } = {}) => settle(() => current().filter(rule => includeArchived || !rule.archivedAt).map(view)),
    get: id => settle(() => {
      const rule = find(id);
      return rule ? view(rule) : null;
    }),
    save: (input, existingId) => settle(() => {
      const existing = existingId ? find(existingId) : undefined;
      if (existingId && !existing) return notFound;
      const problem = existing && blocked(existing, 'edit');
      if (problem) return { ok: false, error: problem };
      const result = saveWorkspaceRule({ ...seed, rules: current() }, input, existing?.id);
      if (!result.ok) return result;
      const actor = user()?.name;
      const saved = { ...withActor(result.value.value), ...(actor && { author: actor }) };
      return commit(replace(saved)) ? { ok: true, value: view(saved) } : { ok: false, error: sampleUnavailable };
    }),
    transition: (id, action, reason) => settle(() => {
      const rule = find(id);
      const definition = ruleTransitionActions[action];
      if (!rule || !definition) return notFound;
      const problem = blocked(rule, action) || ruleReasonProblem(reason);
      if (problem) return { ok: false, error: problem };
      const result = transitionWorkspaceRule({ ...seed, rules: current() }, id, definition.to, reason.trim());
      if (!result.ok) return result;
      const next = withActor(result.value.value, definition.label);
      return commit(replace(next)) ? { ok: true, value: view(next) } : { ok: false, error: sampleUnavailable };
    }),
    archive: (id, reason) => settle(() => {
      const rule = find(id);
      if (!rule || rule.archivedAt) return notFound;
      const problem = blocked(rule, 'archive') || ruleReasonProblem(reason);
      if (problem) return { ok: false, error: problem };
      const at = new Date().toISOString();
      const next = { ...rule, archivedAt: at, updatedAt: at,
        history: [...rule.history, { at, actor: user()?.name ?? '', action: '보관', reason: reason.trim() }] };
      return commit(replace(next)) ? { ok: true, value: view(next) } : { ok: false, error: sampleUnavailable };
    }),
    delete: id => settle(() => {
      const rule = find(id);
      if (!rule) return notFound;
      const problem = blocked(rule, 'delete');
      if (problem) return { ok: false, error: problem };
      return commit(current().filter(row => row.id !== id), id) ? { ok: true, value: id } : { ok: false, error: sampleUnavailable };
    }),
    duplicateDraft: id => settle(() => {
      const rule = find(id);
      if (!rule) return notFound;
      const suffix = ' (복제)';
      const { description, typeCode, scoreMin, minTransactions, windowHours } = rule;
      return { ok: true, value: { name: `${rule.name.slice(0, RULE_LIMITS.name - suffix.length)}${suffix}`,
        description, typeCode, scoreMin, minTransactions, windowHours } };
    }),
    backtest: (input, period, options) => settle(() => runBacktest(seed.transactions, input, period, options)),
    backtestScope: () => settle(() => {
      const dates = seed.transactions.map(record => record.date).sort();
      return { start: dates[0], end: dates.at(-1), count: seed.transactions.length };
    }),
  };
}

// 샘플 모드의 룰 화면(preview-rule-workspace · rule-controls 의 RuleDraft)이 쓰는 저장소다.
// 서비스 모드(VITE_API_MODE=live)의 룰 화면은 서버 룰엔진에 맞춘 live-rule-list · live-rule-builder · live-rule-backtest 이고
// 서버 호출은 @/api/rules 가 한다. 예전 /api/v1/rules(review · delete · backtest)를 부르던 서버 구현은 그 API 가 없어져 지웠다.
export const ruleRepository = createSampleRuleRepository();
