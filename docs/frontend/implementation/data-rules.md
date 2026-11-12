# Data and display rules

Screen rules: [frontend-handoff](frontend-handoff.md). Contract: [api](api.md).

## Display ID

Format `{A|E}-YYMMDD-NNNNNN`. `A` is Alert, `E` is Episode; six-digit date, six-digit serial. Examples: `A-261111-000007`, `E-261111-000001`.

- The same Alert or Episode shows the same display ID on every screen.
- Never derive a server numeric id (`alertId`, `caseId`, `episodeId`) from the display ID or the reverse. The conversion is unconfirmed ([api](api.md)); mock data carries both ids.
- Out of scope: transaction ids `T-…`, rule names like `RULE-001`.

## Pattern codes

The source is [API.md](../../../backend/api-server/API.md) section 2.3 and [codes.ts](../../../frontend/implementation/1.14.0/web-app/src/api/codes.ts).

| Code | API name | Screen name (tag) | Korean label in codes.ts |
| --- | --- | --- | --- |
| 0 | NON_PATTERN | NON_PATTERN | 패턴 없는 이상거래 |
| 1 | FAN-OUT | Fan-out | 분산 송금 |
| 2 | FAN-IN | Fan-in | 집중 수취 |
| 3 | G-SCATTER | Gather-scatter | 모아서 뿌리기 |
| 4 | S-GATHER | Scatter-gather | 뿌려서 모으기 |
| 5 | CYCLE | Cycle | 순환 거래 |
| 6 | RANDOM | Random | 무작위 경로 |
| 7 | BIPARTITE | Bipartite | 그룹 간 교차 송금 |
| 8 | STACK | Stack | 다층 중계 |

- Code 0 means no pattern. It is not the human verdict "normal".
- A PatternTag shows the English screen name and probability, like `Fan-out 82%`. No Korean next to it.
- The team decides whether to cut types. Do not remove one from a screen first.

## Status, age, score

Use the StatusTag presets below and the current Figma semantic variables.

- Work status: not opened, not handled, in progress, handled. Never just "done".
- Human verdict: normal or abnormal. "False positive" is not a choice.
- Risk: below 0.7 low, 0.7 up to 0.9 caution, 0.9 and above danger.
- Age: up to 3 days yellow, over 3 up to 7 orange, over 7 red.
- Scores are 0 to 1. Band thresholds come from rule-engine settings; never hard-code them in a component.

## StatusTag presets

Use `StatusTag` for work status, risk, age, and human verdict. Fill uses the existing `Status/*` variables; text and icons use the matching `Status/On/*` variables. Pattern names use `PatternTag`, numeric scores use `ScoreTag`, and applied filters use `FilterTag`.

| Preset | Default label | Fill |
| --- | --- | --- |
| abnormal | 이상 | Status/Negative |
| normal | 정상 | Status/Positive |
| unread | 열람 전 | Status/Unread |
| pending | 처리 전 | Status/Pending |
| inProgress | 처리 중 | Status/Info |
| done | 처리 완료 | Status/Positive |
| riskLow | 낮음 | Status/Positive |
| riskMedium | 주의 | Status/Cautionary |
| riskHigh | 위험 | Status/Negative |
| elapsedLow | 3일 경과 | Status/Cautionary |
| elapsedMid | 7일 경과 | Status/Unread |
| elapsedHigh | 13일 경과 | Status/Negative |

Age labels show the actual age; these defaults are examples. Age tags use the hourglass icon. Read current token bindings and component geometry from Figma.

## Names

- Mask sample assignees and reviewers (`김OO`); do not use real names in sample data.
- Use the honorific `님` when addressing a person in the UI.

## Sample data

Numbers on a screen must match its filter, period, and permission. If they do not, fix them before using the screen as a sample.

- A title with `N` items has `N` rows or cards.
- "My assignments" keeps only rows assigned to the current user.
- "Human verdict abnormal only" keeps only rows judged abnormal.
- A period label matches the transaction dates and age tags shown.
- One case has the same display ID, assignee, status, pattern, and score in list and detail, card and table, and notification text.
