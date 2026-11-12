# API requirements and gaps

The contract lives in [API.md](../../../backend/api-server/API.md). Code labels in this branch are in [codes.ts](../../../frontend/implementation/1.14.0/web-app/src/api/codes.ts); recheck the active app path when implementing. Related: [data rules](data-rules.md), [screens](screens.md).

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
