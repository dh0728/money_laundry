# Frontend implementation guide

Audience: FE implementation agents · Language: English · Updated: 2026-11-16.

This is the single current FE implementation reference. The other current reference is the [Korean API handoff for the backend](api.md). Read that document directly; do not maintain a second English copy of its contracts. Preserve Korean UI labels, code identifiers, enum values, and URLs exactly. [History](history/) contains dated evidence, not additional current requirements or design approval.

## Authority and scope

- Build React + TypeScript + Vite in `frontend/implementation/1.14.0/web-app` on `fe/work`. Preserve existing user changes, Storybook, v3 tokens in `src/next/styles`, and `ShellChrome.stories.tsx`.
- Use the user's [original Figma](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh) for layout, dimensions, component instances, variable bindings, and interactions. Do not replace it with the rejected generated review file.
- **Figma access is currently paused, including reads**, while another worker edits the original. This consolidation does not inspect or modify Figma.
- The rejected artifact is the Figma review copy, not all existing code. Preserve and reuse functionality; rework the layout against the user's original. Ask KMG about ambiguous behavior or application choices instead of inventing them. Continue independent confirmed work.
- Current delivery target: runnable draft-based code for review on **2026-11-17**, followed by iteration. Do not delay implementation waiting for a perfect design. The earlier November 16–21 daily plan is historical, not a separate active schedule.
- Core functionality comes first. Login background decoration is optional only after functionality is complete. Verify draggable graphs and hover/click effects in the actual web app; static images or temporary stand-ins do not prove these work.
- Start with clearly identified mock data. Record each screen's required data in [api.md](api.md). `backend/api-server/API.md` is a reference to existing backend behavior, not a mandate to redesign the UI around it. Do not invent endpoints or claim live authentication, server persistence, or production-scale performance.
- Distinguish implementation, automated checks, actual browser checks, and KMG's design approval. Existing mock behavior is evidence, not automatic approval of a new requirement.

<a id="current-implementation-boundary"></a>
## Implementation boundary and themes

Use the left sidebar plus work area. All screens, including login (which has no source Figma frame), must support Default Light/Dark and Solarized Light/Dark × Sky/Violet/Pink/Lime: **16 combinations**. Use v3 tokens for colors, spacing, typography and sizes; do not introduce arbitrary per-screen values. Reuse validated existing components (including shadcn/ui); share components when used on multiple screens. Preserve accessibility and measure rendered geometry rather than guessing.

<a id="frame"></a>
<a id="layout"></a>
## Layout and components

- Desktop reference: 1920×1080. Responsive adjustments are allowed; mobile screens are out of scope. Verify browser zoom 80%–150% and split windows without disabling zoom.
- Use one full-width PageHeader per page; no AppHeader or page footer. Dialog/card/panel action areas are allowed.
- Put global search, navigation, and the fixed report tab in the sidebar. AI summaries belong in the relevant page summary card, not the sidebar. Notifications/settings belong at the sidebar bottom; account controls belong in the user area.
- Sidebar is expanded or hidden, not a separately designed collapsed variant. When hidden, use PageHeader `showSidebarButtons` and the `sidebar` frame to restore it. Do not infer unverified behavior from old mock screens.
- Use one body `main` scroll area, not nested panels and independently scrolling card/table lists. Table-only views have no card wrapper or outer border.
- Alert/Episode overview order: tags → AI summary → KPIs. Dashboard begins with summary and KPIs. Summary: width fill / height hug; KPI cards: width hug / height fill so row heights align.
- Card collections combine minimum card width and fill. Table header/body column boundaries must match; inspect existing fill columns before adding another. IDs must not wrap; tags must not clip.
- Analysis has a fixed-width side panel and graph filling the remaining width. Playback and Zoom share the bottom row. Do not add redundant `그래프`/`표` titles. Every table panel offers CSV download.
- Keep search/filter/sort/date popovers as separate components, not Dialog instances; align their header, radius, spacing, border, shadow and tokens with Dialog.
- UI text is Korean except established pattern names, IDs and code. Avoid redundant explanations, but retain scope, evidence, permissions, errors, and irreversible-action guidance.

<a id="verdict-and-lists"></a>
## Navigation, selection and judgments

- One Primary judgment action in PageHeader; no duplicate selection/bundling action strip inside tabs. Single and bulk judgment use the same dialog.
- Card/table switching uses the list PageHeader tabs. Applied conditions use FilterTag, not a new pill-button navigation system. Offer clear-all when two or more filters are applied.
- Related-tab header shows count and filters; judgment remains a PageHeader action.
- Judgment dialog footer: cancel, complete judgment, report download. Report download is Primary and initially disabled. Disabled completion actions have no click/prototype connection until activation conditions are met.
- Reports select existing judgment history in a table/card list and export one PDF. No manual authoring form or draft/final workflow. Judgment ID: `J-YYMMDD-NNNNNN` (for example `J-261111-000001`). Overview vector PDF is still under consideration; existing mock reports are not real AI-generated output.
- Human judgment precedes model score on completed work; keep both visible. `정상` and `이상` are UI choices, not authorization to submit an unconfirmed enum.
- Date selection uses one popover (today, 3/7/30 days, current month, custom start/end); Apply commits changes. Bulk Alert selection is for Episode bundling mode; otherwise rows open detail.
- Selected rows/cards/navigation use opposite-theme contrast. Hover is temporary outline; selection persists. Read-only areas must not suggest clickability. Underline tabs represent content structure.
- Keep removed features removed: 12-tab limit and its notices/toast views, AppHeader, page footer, nested scroll areas, outer table border, redundant bundling strip. The Toast library component itself may remain.

<a id="charts-and-graph"></a>
## Graphs, charts and details

- Never compare different units with a single bar length. Label units; horizontal bars are label → fixed numeric column → bar.
- Dashboard/summary pattern charts exclude `NON_PATTERN`; detail may include it. Show model probability, not a claim of proven laundering.
- Transaction arrows point toward destination-node centers. Avoid node/edge/arrow/label overlap. Edge color encodes risk, width amount (cap extreme widths), count `N건`. High/medium/low risk filters start enabled. Account nodes have no default border; selection/focus may use one. Fit-to-view and fullscreen use distinct icons.
- An SVG marker in code is not sufficient evidence: inspect arrows in the final rendered zoomed view. Test dragging, selection, playback and related-table effects in the actual web app.
- Processing history is an overview section, showing case, assignee, time and reason together, not a separate oversized screen. For transaction judgment changes, use opposite judgment → required-reason confirmation and record actor/time.

<a id="carried-over-ui-rules"></a>
## Unresolved conflicts in inherited rules

These conflicts are preserved for clarification, not resolved by preference:

| Earlier rule | Current boundary |
| --- | --- |
| Figma is only a sketch; do not copy text/colors/fonts | User's original layout and variables now take precedence. Display numbers still come from fixture/response data. Ask about remaining inconsistencies. |
| Sidebar names: Dashboard, Transactions, Alert, Episode, Report | A later record uses Dashboard, Rule engine, Investigation. Confirm current source navigation rather than guessing. |
| Detail tabs: overview, graph, transactions, review | Current screen inventory includes overview, analysis, related. Confirm mismatches. |
| Close judgment Primary / save draft Secondary / saved list text action | This historical review example does not reinstate report draft stages removed above. |
| Red only for risk/error; neutral counts and category tags | Preserve the semantic token mapping below. Do not recolor unread tags or override variables without confirmation. |
| Any abnormal transaction turns its account red | Historical rule; validate its applicability when rebuilding the actual account view. |

<a id="display-id"></a>
## Display IDs and numeric values

- `{A|E}-YYMMDD-NNNNNN`: Alert `A`, Episode `E`, six-digit date and serial. Examples `A-261111-000007`, `E-261111-000001`.
- Same case, same display ID everywhere. Keep numeric `alertId`/`caseId`/`episodeId` separate; no parsing or synthesizing display IDs from numeric IDs. Server mapping is unconfirmed. Transaction `T-…` IDs and `RULE-001` names are outside this format.
- Use units and readable alignment. Missing/error/stale is not zero. Do not substitute native-currency totals for missing USD totals; zero denominator is not automatically 0%.
- Mock assignees/reviewers are masked (`김OO`), never real names. Address people with `님` in UI.
- Counts, dates, assignees, status, patterns and scores must agree across filters, lists, cards, detail and notifications. `내 담당` restricts to the current assignee; `사람 판정 이상만` restricts to human abnormal judgments, not model risk.

<a id="pattern-codes"></a>
## Pattern codes

[App codes.ts](../../../frontend/implementation/1.14.0/web-app/src/api/codes.ts) is authoritative. Recheck it when the app path changes. Existing backend API section 2.3 is reference only. Do not drop types before team agreement.

| Code | codes.ts key | Tag label | Existing Korean code label |
| --- | --- | --- | --- |
| 0 | NON_PATTERN | NON_PATTERN | 패턴 없는 이상거래 |
| 1 | FAN-OUT | Fan-out | 분산 송금 |
| 2 | FAN-IN | Fan-in | 집중 수취 |
| 3 | GATHER-SCATTER | Gather-scatter | 모아서 뿌리기 |
| 4 | SCATTER-GATHER | Scatter-gather | 뿌려서 모으기 |
| 5 | CYCLE | Cycle | 순환 거래 |
| 6 | RANDOM | Random | 무작위 경로 |
| 7 | BIPARTITE | Bipartite | 그룹 간 교차 송금 |
| 8 | STACK | Stack | 다층 중계 |

Code 0 means no pattern, not human NORMAL. PatternTag is e.g. `Fan-out 82%`, without adjacent Korean translation. Do not shorten codes 3/4. Do not add a kind tag if the `A-`/`E-` prefix already distinguishes it.

<a id="status-age-score"></a>
<a id="statustag-presets"></a>
## Status, score and semantic tokens

Work labels: `열람 전`, `처리 전`, `처리 중`, `처리 완료` (not shortened to `완료`). Being bundled into an Episode is not a processing state. UI human judgment: `정상`/`이상`, no `오탐` choice.

Scores are 0–1. Boundaries come from rule settings, not component literals. Current fixture `dashboard-data.ts` uses `riskSettings = { medium: 0.7, high: 0.9 }`: below 0.7 low, 0.7 inclusive to below 0.9 medium, 0.9+ high. These are not approved production thresholds; API handoff must establish source, rule version and effective period.

Age: ≤3 days yellow, >3 to ≤7 orange, >7 red, using existing semantic tokens. Defaults below are examples; render actual elapsed days with an hourglass icon. Use StatusTag for work/risk/age/judgment, PatternTag for pattern, ScoreTag for numeric score, FilterTag for filters. Background uses `Status/*`; text/icons use matching `Status/On/*`.

| Preset | Default label | Background variable |
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

Use neutral counts and pattern tags; separate age/risk tags from pattern tags on cards. Do not imply Figma dimensions/token bindings were verified while access is paused.

<a id="domain-reconciliation"></a>
## UI-to-domain reconciliation

`codes.ts` also defines `AlertStatus`, `EpisodeStatus`, `AlertResolution`, `EpisodeResolution`. UI processing labels are not necessarily stored enums. Document per-screen mapping. Existing `FALSE_POSITIVE` conflicts with the UI's no-false-positive rule; do not delete that enum or invent a replacement API value. Consult [API unresolved items](api.md#open-gaps).

<a id="screen-inventory"></a>
## Screen inventory

These are design proposals, not verified live URLs. Existing mock routes and evidence remain in [the dated complete-bundle record](history/complete-bundle.md). Figma sections: Dashboard, RuleEngine, AddTab, Alert, Episode, Report, ETC.

| Section | Screen ID | Proposed route | Variant / unresolved detail |
| --- | --- | --- | --- |
| Dashboard | dashboard/mine | `/dashboard/mine` | Paired with all |
| Dashboard | dashboard/all | `/dashboard/all` | Paired with mine |
| RuleEngine | rule-engine/draft-list | `/rules` | Reason side panel |
| RuleEngine | rule-engine/draft-create | `/rules/new` | No extra variant recorded |
| RuleEngine | rule-engine/draft-backtest | `/rules/:id/backtest` | No extra variant recorded |
| AddTab | add-tab/owner-account-transaction | `/investigate/ledger` | One of three investigation tabs |
| AddTab | add-tab/alerts-cards | `/investigate/alerts?view=cards` | My-assignee filter on/off |
| AddTab | add-tab/alerts-table | `/investigate/alerts?view=table` | My-assignee filter on/off; paired with cards |
| AddTab | add-tab/alerts-bundle | `/investigate/alerts?mode=bundle` | Separate page or inline panel undecided |
| AddTab | add-tab/episodes | `/investigate/episodes?view=cards` | Human-abnormal-only on/off, inherited proposal |
| AddTab | add-tab/episodes-table | `/investigate/episodes?view=table` | Human-abnormal-only on/off; paired with cards |
| Alert | alert/overview-allpanel | `/alerts/:id?tab=overview&mode=all` | Paired with per-panel |
| Alert | alert/overview-perpanel | `/alerts/:id?tab=overview&mode=per` | Paired with all |
| Alert | alert/analysis | `/alerts/:id?tab=analysis&view=pattern` | Inventory says owner view only; reconcile before selecting behavior |
| Alert | alert/related | `/alerts/:id?tab=related` | Owner view |
| Alert | alert/judge-single, judge-bundle | Dialog over overview/related | Normal/abnormal selection design undecided |
| Alert | alert/overview-staff-readonly | `/alerts/:id?tab=overview` | Other assignee, read-only |
| Episode | episode/overview | `/episodes/:id?tab=overview` | No extra variant recorded |
| Episode | episode/analysis | `/episodes/:id?tab=analysis&view=pattern` | Inventory says owner view only; reconcile |
| Episode | episode/related | `/episodes/:id?tab=related` | Owner view |
| Episode | episode/judge | Dialog over overview | Team confirmation required |
| Report | report/write | `/report` | History table/cards, selection, PDF |
| ETC | notifications | Sidebar drawer | No extra variant recorded |
| ETC | account | Sidebar menu | No extra variant recorded |
| ETC | settings | Settings dialog | Font size and theme |
| ETC | auth/login | `/login` | No source frame; expiry and all 16 combinations |
| ETC | state/loading-empty, refetch-error, judge-result | Per-screen content | Loading/empty, retry, save success/failure/additional confirmation |

The old 12-tab-limit state is excluded. A dated November 11 record omitted separate drawings for node selection and hidden transaction detail; omission of a drawing is not proof that the interaction is implemented or approved.

<a id="per-screen-handoff"></a>
## Required evidence for each screen

1. Exact source Figma frame link (login: explicitly no source frame).
2. Origin and meaning of every displayed number/string, with mock labeling; fields → mock source → meaning/unit/formula → domain code → missing/loading/error behavior → backend agreement status.
3. Exact `codes.ts` mappings.
4. Executed loading/empty/error behavior and evidence.
5. Light/dark screenshots and checks across all 16 theme/brand combinations. Screenshots are supporting evidence, not a substitute for working interactions.
6. Actual implementation version/commit and runnable/source links; distinguish local-only, unreachable and unverified links. Keep new records newest first.
7. Separate automated results, actual browser checks, design approval and remaining defects. KMG owns design acceptance.

<a id="verification"></a>
## Verification checklist

After fixing one screen or component, recheck other screens with the same pattern.

- No nested panels/scrolls, no table wrapper/outer border; header and row columns align; no wrapped IDs or clipped tags; summary/KPI sizing and minimum-card widths match; one full-width PageHeader and one judgment Primary action.
- Korean UI, no `Button 1`/`Value` placeholders; correct tag types/age boundaries; filters clear individually and all when appropriate; masked sample names.
- Correct display IDs, count/row agreement, matching filter/date/permission scope; no mixing filtered and unfiltered metrics; currency shown, missing USD not substituted.
- No removed tab-limit features, AppHeader, redundant bundling strip or false-positive selection.
- Distinct loading/empty states. Refetch failure preserves the last successful result, including a successful empty result, with one-line notice. Distinct save success/failure/additional-confirmation states. Other-assignee cases are read-only with judgment disabled.
- Numeric columns right-aligned, text left-aligned (not centered). Long IDs/account numbers do not cover adjacent cells. Browser zoom works. Record URL persistence of filters/tabs/pages and explicitly note omissions.
- No overlapping frames or frames outside sections in design evidence; no unsupported claims of visual approval.

### Remaining work, in priority order

1. Compare source frames to rebuilt layouts once access is allowed; preserve existing functionality and record regression evidence. Clarify only genuinely ambiguous details.
2. Reproduce and diagnose the three legacy test timeouts below; do not invent their cause.
3. Complete per-screen evidence, actual graph/hover/click checks, and backend confirmation of the 11 open API items.
4. Obtain KMG's design review separately. Documentation completion is not product completion.

### Latest recorded automated run

Date: 2026-11-16; code base `680e5fd6336f52ddeb4b8015655423b34bd63498`. Subsequent documentation edits did not rerun or change code.

| Check | Recorded result | Boundary |
| --- | --- | --- |
| `pnpm lint` | 0 errors, 1 existing warning | React Compiler/TanStack compatibility in `use-data-table.ts` |
| `pnpm build` | Passed | Existing large-bundle warnings |
| `pnpm test` | 67/69 files, 399/402 tests passed | Three 5-second timeouts; cause unconfirmed, not a fully passing suite |

Failed test names are retained verbatim for lookup:
- `src/app/App.live.test.tsx`: `명시적 로그아웃 후 같은 신원으로 로그인해도 이전 의견을 복원하지 않는다`.
- `src/app/App.test.tsx`: `mock Alert에서 제외한 거래는 상세와 목록의 건수에 함께 반영된다`.
- `src/app/App.test.tsx`: `RDR 9000을 닫고 다시 열 수 있으며, 화면 이동에도 패널 상태가 유지된다`.

This run did not verify new layout parity, live API integration or user design acceptance. Dated implementation and QA evidence, including local paths that may no longer exist, remains in [history](history/); never promote it to a current pass without rechecking.
