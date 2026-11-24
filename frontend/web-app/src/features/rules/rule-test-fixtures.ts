import type { RuleCatalog, RuleCheck, RuleDetail, RuleList } from '@/api/rules'

// 룰 화면 테스트가 쓰는 서버 응답. 실제 서버 응답(API.md §12)에서 템플릿 5개와 룰 2개만 남기고 항목 설명을 뺀 것이다.

export const catalogFixture = {
  "schema": 2,
  "templates": [
    {"key": "FAN_OUT", "name": "FAN-OUT · 분산 송금", "group": "PATTERN", "available": true, "pattern": 1, "evaluator": "AGGREGATE", "shape": "A → 여러 계좌", "axis": "송금 계좌 × 기간", "subject": "ACCOUNT", "subjectLabel": "송금 계좌", "trigger": "그 계좌의 출금", "side": "FROM", "directionSelectable": false, "windowRequired": true, "maxWindowMinutes": 43200, "alert": {"allowed": true, "maxWindowMinutes": 10080}, "references": ["R17"], "filterFields": ["TX_USD", "FIRST_PAIR", "FX_FOLLOW"], "requiredFilterFields": [], "metrics": ["DISTINCT_COUNTERPARTIES", "TX_COUNT", "SUM_USD", "NO_REPEAT"], "whereMin": 1, "sweep": "DISTINCT_COUNTERPARTIES", "defaults": {"windowMinutes": 10080, "filter": {"op": "ALL", "items": [{"field": "FIRST_PAIR"}, {"field": "TX_USD", "cmp": "GTE", "value": 1000}]}, "where": {"op": "ALL", "items": [{"metric": "DISTINCT_COUNTERPARTIES", "cmp": "GTE", "value": 6}]}, "then": "ATTACH_EVIDENCE"}, "performance": {"dataset": "HI-Medium", "period": "09-08 ~ 09-16", "precision": 96.2, "recall": 70.8, "pickedTransactions": 2449, "recallBase": "이 템플릿이 노리는 패턴의 세탁 거래"}, "note": "수취 계좌 수를 낮추면 작은 시도를 더 잡지만 정상이 들어온다. 시도의 절반 이상이 5건 이하라 6개 조건에서 잘린다."},
    {"key": "RANDOM", "name": "RANDOM · 연쇄 경유", "group": "PATTERN", "available": true, "pattern": 6, "evaluator": "PATH", "shape": "A → B → C → D (돌아오지 않음)", "axis": "경로의 끝 계좌 × 기간", "subject": "ACCOUNT", "subjectLabel": "경로의 끝 계좌", "trigger": "경로의 마지막 거래", "side": "TO", "directionSelectable": false, "windowRequired": true, "maxWindowMinutes": 20160, "alert": {"allowed": true, "maxWindowMinutes": 20160, "stepRatioMin": 0.8, "stepRatioMax": 1.25}, "references": ["R17"], "filterFields": ["TX_USD", "FIRST_PAIR", "FX_FOLLOW"], "requiredFilterFields": [], "metrics": [], "whereMin": 0, "sweep": "minHops", "defaults": {"windowMinutes": 4320, "filter": {"op": "ALL", "items": [{"field": "TX_USD", "cmp": "GTE", "value": 1000}, {"op": "ANY", "items": [{"field": "FIRST_PAIR"}, {"field": "FX_FOLLOW"}]}]}, "path": {"minHops": 3, "maxHops": 12, "stepRatioMin": 0.8, "stepRatioMax": 1.25}, "where": {"op": "ALL", "items": []}, "then": "ATTACH_EVIDENCE"}, "performance": {"dataset": "HI-Medium", "period": "09-08 ~ 09-16", "precision": 89.7, "recall": 55.4, "pickedTransactions": 1333, "recallBase": "이 템플릿이 노리는 패턴의 세탁 거래"}, "note": "기간을 늘리면 정밀도가 무너진다(기본 3일). 필터의 OR 가 첫거래 필터로 끊긴 경로를 이어 준다."},
    {"key": "LARGE_TX", "name": "단건 고액거래", "group": "GENERAL", "available": true, "pattern": null, "evaluator": "AGGREGATE", "oracle": "Large Reportable Transactions", "shape": "거래 1건", "axis": "거래 1건", "subject": "TX", "subjectLabel": "거래 1건", "trigger": "모든 거래", "side": null, "directionSelectable": false, "windowRequired": false, "maxWindowMinutes": null, "alert": {"allowed": false}, "references": ["R12", "R16"], "filterFields": ["TX_USD", "FIRST_PAIR", "FX_FOLLOW"], "requiredFilterFields": ["TX_USD"], "metrics": [], "whereMin": 0, "sweep": "TX_USD", "defaults": {"filter": {"op": "ALL", "items": [{"field": "FIRST_PAIR"}, {"field": "TX_USD", "cmp": "GTE", "value": 10000}]}, "where": {"op": "ALL", "items": []}, "then": "ATTACH_EVIDENCE"}, "performance": {"dataset": "HI-Medium", "period": "09-08 ~ 09-16", "precision": 11.5, "recall": 40.8, "pickedTransactions": 32912, "recallBase": "6종 패턴 세탁 거래 전체(9,288건)"}, "note": "세는 거래를 통과하면 곧 적중이다. 처음 거래하는 상대 조건을 빼면 평가 구간 거래의 16.1%가 걸린다. 금액 기준을 올려도 정밀도는 좋아지지 않는다."},
    {"key": "STRUCTURING", "name": "분할 입·출금", "group": "GENERAL", "available": true, "pattern": null, "evaluator": "AGGREGATE", "oracle": "Structuring – Avoidance of Reporting Thresholds", "shape": "기준 금액 바로 아래 거래 여러 건", "axis": "계좌 × 기간", "subject": "ACCOUNT", "subjectLabel": "계좌", "trigger": "그 방향의 띠 안 거래", "side": null, "directionSelectable": true, "windowRequired": true, "maxWindowMinutes": 43200, "alert": {"allowed": true, "maxWindowMinutes": 10080}, "references": ["R12", "R16"], "filterFields": ["TX_USD", "FIRST_PAIR", "FX_FOLLOW"], "requiredFilterFields": ["TX_USD"], "metrics": ["TX_COUNT", "DISTINCT_COUNTERPARTIES", "SUM_USD"], "whereMin": 1, "sweep": "TX_COUNT", "defaults": {"direction": "OUT", "windowMinutes": 10080, "filter": {"op": "ALL", "items": [{"field": "FIRST_PAIR"}, {"field": "TX_USD", "cmp": "GTE", "value": 5000}, {"field": "TX_USD", "cmp": "LT", "value": 10000}]}, "where": {"op": "ALL", "items": [{"metric": "TX_COUNT", "cmp": "GTE", "value": 2}]}, "then": "ATTACH_EVIDENCE"}, "performance": {"dataset": "HI-Medium", "period": "09-08 ~ 09-16", "precision": 96.8, "recall": 7.4, "pickedTransactions": 710, "recallBase": "6종 패턴 세탁 거래 전체(9,288건)"}, "note": "금액 띠는 건당 금액 두 줄(하한, 상한)이다. 출금 방향은 FAN-OUT 의 좁은 버전이고, 입금 방향은 같은 조건에서 정밀도가 32.4%다."},
    {"key": "DORMANT_ACTIVATION", "name": "휴면계좌 활성화", "group": "GENERAL", "available": false, "oracle": "Escalation in Inactive Accounts", "note": "이후 제공. 원장이 16일뿐이라 휴면 기간을 일 단위로 줄여야 한다."},
  ],
  "filterFields": {
    "TX_USD": {"label": "건당 금액", "short": "건당", "kind": "number", "type": "decimal", "unit": "USD", "comparators": ["GTE", "GT", "LTE", "LT", "EQ"], "min": 0, "max": 1000000000000, "step": 1000, "anyGroup": true},
    "FIRST_PAIR": {"label": "처음 거래하는 상대", "short": "첫 거래 상대", "kind": "flag", "anyGroup": true},
    "FX_FOLLOW": {"label": "환전 직후 송금", "short": "환전 직후", "kind": "flag", "anyGroup": true},
    "NEAR_TRIGGER_AMOUNT": {"label": "검사 거래와 비슷한 금액", "short": "검사 거래 금액", "kind": "number", "type": "decimal", "unit": "%", "comparators": ["WITHIN"], "min": 0, "max": 100, "step": 1, "anyGroup": false},
  },
  "metrics": {
    "DISTINCT_COUNTERPARTIES": {"label": {"FROM": "서로 다른 수취 계좌 수", "TO": "서로 다른 송금 계좌 수"}, "short": {"FROM": "수취 계좌", "TO": "송금 계좌"}, "kind": "number", "type": "int", "unit": "개", "min": 1, "max": 1000, "step": 1},
    "TX_COUNT": {"label": "거래 건수", "short": "거래", "kind": "number", "type": "int", "unit": "건", "min": 1, "max": 10000, "step": 1},
    "SUM_USD": {"label": {"FROM": "보낸 총액", "TO": "받은 총액"}, "short": {"FROM": "보낸 총액", "TO": "받은 총액"}, "kind": "number", "type": "decimal", "unit": "USD", "min": 1, "max": 1000000000000, "step": 5000},
    "NO_REPEAT": {"label": "같은 상대와 두 번 이상 거래하지 않음", "short": "상대마다 1건", "phrase": "상대 계좌마다 거래가 한 번뿐", "kind": "flag"},
  },
  "path": {
    "minHops": {"label": {"CYCLE": "순환 거래 수", "RANDOM": "경로 거래 수"}, "type": "int", "unit": "건", "min": 2, "default": 3},
    "maxHops": {"label": "따라가는 최대 거래 수", "type": "int", "unit": "건", "min": 2, "max": 12, "default": 12},
    "stepRatioMin": {"label": "이어지는 두 거래의 금액 비 하한", "type": "decimal", "min": 0.5, "max": 2, "default": 0.8},
    "stepRatioMax": {"label": "이어지는 두 거래의 금액 비 상한", "type": "decimal", "min": 0.5, "max": 2, "default": 1.25},
  },
  "windows": [
    60,
    360,
    1440,
    4320,
    10080,
    20160,
    43200,
  ],
  "comparators": [
    "GTE",
    "GT",
    "LTE",
    "LT",
    "EQ",
  ],
  "directions": [
    {"key": "OUT", "label": "출금"},
    {"key": "IN", "label": "입금"},
  ],
  "then": [
    {"key": "ATTACH_EVIDENCE", "label": "근거로만 표시", "enabled": true},
    {"key": "CREATE_ALERT", "label": "Alert 생성", "enabled": false, "note": "아직 제공하지 않는다."},
  ],
  "limits": {
    "whereDepth": 2,
    "whereConditions": 10,
    "filterConditions": 10,
    "nameLength": 80,
  },
  "backtestTemplates": [
    "FAN_IN",
    "FAN_OUT",
    "GATHER_SCATTER",
  ],
} as unknown as RuleCatalog

/** FAN-OUT 기본값을 검증한 결과 */
export const checkFixture = {
  "items": [
    {"key": "FORMAT", "label": "형식", "ok": true, "message": "템플릿 · 항목 · 구조가 맞습니다.", "errors": []},
    {"key": "CONDITIONS", "label": "조건", "ok": true, "message": "값이 모두 채워졌고 범위 안입니다.", "errors": []},
    {"key": "DATA", "label": "데이터", "ok": true, "message": "원장 3일치로 계산할 수 있습니다.", "errors": []},
    {"key": "COST", "label": "실행 비용", "ok": true, "message": "기간 7일 (이 템플릿의 상한 30일)", "errors": []},
  ],
  "warnings": [
    "원장에 쌓인 기간이 3일입니다. '처음 거래하는 상대'는 5일 이상 쌓인 뒤에야 가르는 힘이 생깁니다.",
  ],
  "canSave": true,
  "canRun": true,
  "sentence": "처음 거래하는 상대이고 건당 금액이 1,000 USD 이상인 거래만 세어, 한 송금 계좌에서 7일 안에 서로 다른 수취 계좌 수가 6개 이상이면 Alert에 근거로 표시합니다.",
  "summary": "첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일",
} as unknown as RuleCheck

export const rulesFixture = {
  "content": [
    {"ruleId": 2, "code": "RULE-002", "name": "운영 FAN-IN", "template": "FAN_IN", "templateName": "FAN-IN · 집중 수취", "summary": "첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일", "status": "ACTIVE", "then": "ATTACH_EVIDENCE", "versionNo": 1, "versionId": 2, "operatingVersionNo": 1, "operatingStatus": "ACTIVE", "operatingSummary": "첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일", "workingVersionNo": null, "workingStatus": null, "owner": "L1 심사자 A", "changedAt": "2023-09-17T00:00:00Z", "hitCount": null, "lastHitDate": null, "linkedAlertCount": null, "normalRate": null, "alertedHitCount": null, "skippedBusySubjects": null, "lastRunFailed": null},
    {"ruleId": 4, "code": "RULE-004", "name": "분산 송금 감시", "template": "FAN_OUT", "templateName": "FAN-OUT · 분산 송금", "summary": "첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일", "status": "DRAFT", "then": "ATTACH_EVIDENCE", "versionNo": 1, "versionId": 5, "operatingVersionNo": null, "operatingStatus": null, "operatingSummary": null, "workingVersionNo": 1, "workingStatus": "DRAFT", "owner": "L1 심사자 A", "changedAt": "2023-09-17T00:00:00Z", "hitCount": null, "lastHitDate": null, "linkedAlertCount": null, "normalRate": null, "alertedHitCount": null, "skippedBusySubjects": null, "lastRunFailed": null},
  ],
  "counts": {
    "ACTIVE": 1,
    "DRAFT": 1,
  },
} as unknown as RuleList

/** 내가 만든 작성 중 룰 (RULE-004) */
export const draftRuleFixture = {
  "ruleId": 4,
  "code": "RULE-004",
  "name": "분산 송금 감시",
  "template": "FAN_OUT",
  "templateName": "FAN-OUT · 분산 송금",
  "owner": "L1 심사자 A",
  "createdAt": "2023-09-17T00:00:00Z",
  "status": "DRAFT",
  "operating": null,
  "working": {"versionId": 5, "versionNo": 1, "status": "DRAFT", "summary": "첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일", "author": "L1 심사자 A", "createdAt": "2023-09-17T00:00:00Z", "submittedAt": null, "decidedAt": null, "decidedBy": null, "revision": 0, "definition": {"schema": 2, "template": "FAN_OUT", "windowMinutes": 10080, "filter": {"op": "ALL", "items": [{"field": "FIRST_PAIR"}, {"field": "TX_USD", "cmp": "GTE", "value": 1000}]}, "where": {"op": "ALL", "items": [{"metric": "DISTINCT_COUNTERPARTIES", "cmp": "GTE", "value": 6}]}, "then": "ATTACH_EVIDENCE"}, "digest": "ca4ebece429e96e595df7fb156e4549e9369347859709d5dfca8d59845c9ccaa", "sentence": "처음 거래하는 상대이고 건당 금액이 1,000 USD 이상인 거래만 세어, 한 송금 계좌에서 7일 안에 서로 다른 수취 계좌 수가 6개 이상이면 Alert에 근거로 표시합니다.", "editable": true, "deletable": true},
  "versions": [{"versionId": 5, "versionNo": 1, "status": "DRAFT", "summary": "첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일", "author": "L1 심사자 A", "createdAt": "2023-09-17T00:00:00Z", "submittedAt": null, "decidedAt": null, "decidedBy": null}],
  "events": [{"at": "2023-09-17T00:00:00Z", "actor": "L1 심사자 A", "action": "CREATED", "comment": "", "versionNo": 1}],
} as unknown as RuleDetail

/** 운영 중 룰 (RULE-002). 작업 중 버전이 없다. */
export const activeRuleFixture = {
  "ruleId": 2,
  "code": "RULE-002",
  "name": "운영 FAN-IN",
  "template": "FAN_IN",
  "templateName": "FAN-IN · 집중 수취",
  "owner": "L1 심사자 A",
  "createdAt": "2023-09-17T00:00:00Z",
  "status": "ACTIVE",
  "operating": {"versionId": 2, "versionNo": 1, "status": "ACTIVE", "summary": "첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일", "author": "L1 심사자 A", "createdAt": "2023-09-17T00:00:00Z", "submittedAt": null, "decidedAt": null, "decidedBy": null, "revision": 0, "definition": {"schema": 2, "template": "FAN_IN", "windowMinutes": 10080, "filter": {"op": "ALL", "items": [{"field": "FIRST_PAIR"}, {"field": "FX_FOLLOW"}]}, "where": {"op": "ALL", "items": [{"metric": "DISTINCT_COUNTERPARTIES", "cmp": "GTE", "value": 3}]}, "then": "ATTACH_EVIDENCE"}, "digest": "3ead40bf6f443d930b7b4a632b89c082dd5112ab5c99fc4e86c048533af3ef50", "sentence": "처음 거래하는 상대이고 환전 직후 송금인 거래만 세어, 한 수취 계좌에서 7일 안에 서로 다른 송금 계좌 수가 3개 이상이면 Alert에 근거로 표시합니다.", "editable": false, "deletable": false},
  "working": null,
  "versions": [{"versionId": 2, "versionNo": 1, "status": "ACTIVE", "summary": "첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일", "author": "L1 심사자 A", "createdAt": "2023-09-17T00:00:00Z", "submittedAt": null, "decidedAt": null, "decidedBy": null}],
  "events": [{"at": "2023-09-17T00:00:00Z", "actor": "관리자", "action": "DRAFT_DELETED", "comment": "", "versionNo": 2}, {"at": "2023-09-17T00:00:00Z", "actor": "L1 심사자 A", "action": "CREATED", "comment": "", "versionNo": 1}],
} as unknown as RuleDetail
