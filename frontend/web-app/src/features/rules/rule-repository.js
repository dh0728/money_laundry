import { createWorkspaceState, saveWorkspaceRule, transitionWorkspaceRule } from '@/features/rules/workspace-data';
import { isRuleId, RULE_LIMITS, ruleActionState, ruleReasonProblem, ruleTransitionActions, runBacktest } from '@/features/rules/rules-logic';
import { currentPreviewUser } from '../auth/preview-session-user.js';
import { deleteLiveRule, fetchLiveRules, liveBacktestScope, liveRules, reviewLiveRule, runLiveBacktest, saveLiveRule } from './live-rules.js';

// 룰 화면이 데이터를 읽고 쓰는 유일한 자리. 화면은 이 객체의 함수만 부르고, 모든 함수는 Promise를 돌려준다.
// - 조회(list·get·backtest·backtestScope)는 값을 주고, 읽지 못하면 reject 한다.
// - 변경(save·transition·archive·delete)은 { ok: true, value } 또는 { ok: false, error } 로 끝난다.
// - 룰마다 allowedActions(지금 할 수 있는 동작)와 blockedReasons(못 하는 이유)를 붙여 준다.
// 서버 구현(createServerRuleRepository)도 같은 모양이다. 아래 목록은 서버가 최종적으로 갖출 계약이다.
//   list          GET  /api/v1/rules?status=&q=&page=&size=     → Page<룰 + allowedActions>
//   get           GET  /api/v1/rules/{id}                        → 룰 + 이력 + 이전 버전 + allowedActions
//   save          POST /api/v1/rules · /api/v1/rules/{id}        → 초안 (수정 시 expectedVersion)
//   transition    POST /api/v1/rules/{id}/transitions            → { action, reason, expectedVersion }
//   archive       POST /api/v1/rules/{id}/archive                → { reason, expectedVersion }
//   delete        DELETE /api/v1/rules/{id}                      → 초안·반려만
//   backtest      POST /api/v1/rules/backtest                    → 일치 건수·검사 건수·계좌 수·금액·거래 페이지
// duplicateDraft는 서버 호출 없이 원본 조건으로 저장 전 입력값을 만든다.

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

// 지금 서버(/api/v1/rules)가 받는 상태 변경. 나머지 동작은 서버 API가 생기면 여기서 연다.
const serverTransitions = { requestReview: ['DRAFT'], approve: ['PENDING_APPROVAL'], reject: ['PENDING_APPROVAL'], stop: ['TESTING', 'ACTIVE'] };
const serverMissing = '서버에 아직 이 동작이 없어요.';

/** 서비스 모드 구현. 서버 호출은 live-rules.js가 하고, 화면에는 샘플 구현과 같은 모양으로 돌려준다. */
export function createServerRuleRepository({ api = { fetchLiveRules, saveLiveRule, reviewLiveRule, deleteLiveRule, liveBacktestScope,
  runLiveBacktest }, user = currentPreviewUser } = {}) {
  const listeners = new Set();
  let rules;
  let loading;

  function view(rule) {
    const { allowedActions, blockedReasons } = ruleActionState(rule, user());
    const reasons = { ...blockedReasons };
    for (const action of Object.keys(ruleTransitionActions)) {
      if (!reasons[action] && !serverTransitions[action]?.includes(rule.status)) reasons[action] = serverMissing;
    }
    if (!reasons.archive) reasons.archive = serverMissing;
    return { ...rule, allowedActions: allowedActions.filter(action => !reasons[action]), blockedReasons: reasons };
  }

  function current() {
    if (rules) return Promise.resolve(rules);
    loading ??= api.fetchLiveRules().then(value => {
      rules = value;
      return rules;
    }, error => {
      throw new Error(error?.problem?.detail ?? error?.problem?.title ?? '룰을 불러오지 못했습니다.');
    }).finally(() => { loading = undefined; });
    return loading;
  }

  function changed(next) {
    rules = next;
    listeners.forEach(listener => listener());
  }

  function apply(result) {
    if (!result.ok) return result;
    const known = rules?.some(rule => rule.id === result.value.id);
    changed(known ? rules.map(rule => rule.id === result.value.id ? result.value : rule) : [...rules ?? [], result.value]);
    return { ok: true, value: view(result.value) };
  }

  async function find(id) {
    return isRuleId(id) ? (await current()).find(rule => rule.id === id) : undefined;
  }

  async function blocked(id, action) {
    const rule = await find(id);
    if (!rule) return notFound;
    const problem = view(rule).blockedReasons[action];
    return problem ? { ok: false, error: problem } : undefined;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // fresh: 로그인 직후처럼 서버 목록을 새로 받아야 할 때.
    list: async ({ fresh = false } = {}) => {
      if (fresh && !loading) rules = undefined;
      return (await current()).map(view);
    },
    get: async id => {
      const rule = await find(id);
      return rule ? view(rule) : null;
    },
    save: async (input, existingId) => {
      const problem = existingId && await blocked(existingId, 'edit');
      return problem || apply(await api.saveLiveRule(input, existingId));
    },
    transition: async (id, action, reason) => {
      const definition = ruleTransitionActions[action];
      if (!definition) return notFound;
      const problem = await blocked(id, action) || (ruleReasonProblem(reason) && { ok: false, error: ruleReasonProblem(reason) });
      return problem || apply(await api.reviewLiveRule(id, definition.to, reason.trim()));
    },
    archive: async id => (await blocked(id, 'archive')) ?? { ok: false, error: serverMissing },
    delete: async id => {
      const problem = await blocked(id, 'delete');
      if (problem) return problem;
      const result = await api.deleteLiveRule(id);
      if (result.ok) changed(rules.filter(rule => rule.id !== id));
      return result;
    },
    duplicateDraft: async id => {
      const rule = await find(id);
      if (!rule) return notFound;
      const suffix = ' (복제)';
      const { description, typeCode, scoreMin, minTransactions, windowHours } = rule;
      return { ok: true, value: { name: `${rule.name.slice(0, RULE_LIMITS.name - suffix.length)}${suffix}`,
        description, typeCode, scoreMin, minTransactions, windowHours } };
    },
    backtest: (input, period, options) => api.runLiveBacktest(input, period, options),
    backtestScope: () => api.liveBacktestScope(),
  };
}

// 서비스 모드(VITE_API_MODE=live)는 서버 구현, 그 밖에는 샘플 구현을 쓴다.
export const ruleRepository = liveRules ? createServerRuleRepository() : createSampleRuleRepository();
