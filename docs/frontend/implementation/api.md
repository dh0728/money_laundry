# API requirements and gaps

For the new screens, [API.md](../../../backend/api-server/API.md) is reference material. Build with mocks first and hand the screen's required data to backend for API design. The first bundle's required fields and metric definitions are in [app shell, login and dashboard handoff](first-bundle.md#data-required-from-backend). Code labels in this branch are in [codes.ts](../../../frontend/implementation/1.14.0/web-app/src/api/codes.ts). Related: [data rules](data-rules.md), [screens](screens.md).

An unconfirmed item is `unconfirmed`. Never present a guess as fact.

## Frontend rules from the contract

- Never send the number in a display ID (`A-1042`) as `caseId`. Search an exact `alertId`, then open that row's `caseId`.
- Send `revision` back exactly as the GET returned it. Never merge it in the frontend.
- Times come as ISO-8601 with offset; show KST. A date filter includes the start day 00:00 and excludes the day after the end date 00:00.
- Without a USD total, never fill in a native-currency total. Scores are 0 to 1.
- Do not write "laundering scale" or "laundered transactions". Write "suspicious transactions"; show a pattern with its probability.
- Model result and human verdict are separate.

## Open gaps

| Screen or feature | What is missing | Status |
| --- | --- | --- |
| Related tab candidates | Whether API.md provides a route for the full related-case candidate list. Do not show old relatedFlows or relatedDecisions as the full candidate list. | unconfirmed |
| AI summary card | Route, model, and caching for the summary text. | unconfirmed |
| Dashboard intake metrics | New accounts and owners, score bands, daily totals, and share of Alerts; metric definitions remain unconfirmed. | unconfirmed |
| Rule engine | List, create, and backtest routes. | unconfirmed |
| Pattern tag name | Who maps the API type name to the screen name (`Fan-out 82%`); `codes.ts` labels are Korean. | unconfirmed |
| Display ID | Conversion between server numeric ids and `A-YYMMDD-NNNNNN`; whether the date is creation or closing. Figma samples are not a contract. | unconfirmed |
| Alert closing values | Product rule is normal or abnormal with a reason; `codes.ts` still holds a false-positive value. | unconfirmed |
| Pattern class count | The screens show nine types; the model team may drop some. | unconfirmed, team and model |
| Notifications | Field mapping between the screen samples and the notification routes in API.md. | unconfirmed |
| Table sort | Whether table view has sort parameters; the default list order is risk, descending. | unconfirmed |
| Filters "human verdict abnormal only" and "my assignments" | Whether the query names match the filter chips one to one. | unconfirmed |

## v3 전체 샘플 앱의 연동 경계 (2026-11-15)

새 `src/next` 앱은 전체 화면을 공유 메모리 샘플로 구현했다. 실제 endpoint 요청이나 운영 저장은 하지 않는다. 필드별 데이터 요구와 미확정 계약은 [전체 구현 인계](complete-bundle.md)를 따른다. 수억 건 운영 연동은 전체 원장 다운로드 대신 서버 KPI/집계·최대100행 cursor page·case-scoped evidence/neighborhood·비동기 backtest/export job이 필요하다. 클라이언트10,000건 제한은 샘플 adapter 보호 장치이며 서버 처리 성능이나 실제 대용량 지원의 증거가 아니다.
