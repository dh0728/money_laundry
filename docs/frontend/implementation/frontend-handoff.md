# Frontend implementation guide

Audience: FE implementation agents · Language: English · Updated: 2026-11-21.

This is the single current FE implementation reference. The other current reference is the [Korean API handoff for the backend](api.md). Read that document directly; do not maintain a second English copy of its contracts. Preserve Korean UI labels, code identifiers, enum values, and URLs exactly. [History](history/) contains dated evidence, not additional current requirements or design approval.

## Authority and scope

- Work in `frontend/web-app` on `fe/work`. The current 3.4.1 Liquid Glass app starts at `src/app/layout.js` and uses the existing `src` structure. See the [app runbook](../../../frontend/web-app/README.md) for the page, feature, and API paths. Preserve existing user changes and the comparison entries and Storybook.
- Use the user's [original Figma](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh) for layout, dimensions, component instances, variable bindings, and interactions. Do not replace it with the rejected generated review file.
- Latest authorized layout work may read original Figma structure and reuse cached exports. KMG owns border/contents and a separate session owns surface; do not edit those variable groups, collections or bindings to compensate for concurrent changes. Keep Figma calls scoped and read-only during this work.
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
## 2026-11-18 standalone shell trial (historical)

Use the [current preview runbook](../../../frontend/web-app/README.md#화면-검수) for the controls. The following describes the Liquid Glass interface. In the sample run, a tab session signs in to My Dashboard. The service entry uses JavaScript for the shell and React Bits for selected interactive surfaces. Workflows and work records still use local fixtures.

- The [standalone component catalogue](http://localhost:5215/components.html) mounts the same controls, workspace navigation, record cards, investigation ledger, case list, dashboard, rules, backtest and report. Toggle appearance, edit the fixture query, generate files and open a separate embedded shell to try search, inbox and Settings. The ScrollStack sample records an earlier comparison. The catalogue uses the app tooltip trigger and starts with the system motion preference. Its notification example changes only the sample state. The catalogue runs on its own Vite entry.
- The standalone address records the current dashboard, investigation list and view, case and detail tab, transaction, report view, or rule screen. Chrome Back and Forward recover earlier addresses. Reload and direct links recover the active record and committed sort, filters and date range. Changing a query updates the current history entry. Background tab addition does not navigate, and open work tabs survive reload in the same browser tab. An unsigned deep link resumes after sample login. Temporary overlays and unapplied inputs are cleared on history navigation.
- Workspace content uses an 8px outer inset and 8px spacing between panels and cards. The header contains left, center and right frames. Small, medium and large use 48px, 56px and 64px for a single header row and the expanded account footer. The center frame stays centered with one or two navigation groups. On narrow screens the header can wrap and the footer remains one strip. The 32px profile avatar stays in the same position in the expanded footer and the collapsed 40px pill. On short screens the navigation shortcuts and work tabs share one scroll area.
- Both 240px glass sidebars overlay the workspace. Drawer headers toggle from their own buttons. The title and gaps inside an open drawer header leave it open. The drawers ease out over 260ms on open and close. Reduce motion switches them immediately. Shared floating button states add a soft glow and 5% enlargement on hover, and a stronger glow, recessed shadow and 96% scale on press. Open drawer buttons and the adjacent search control use the ghost state with a transparent resting surface and distinct hover, focus and press states. Reduce motion disables scaling. The open inbox places Mark all read and the unread-only switch on the left, with the archive toggle and unread dot on the right.
- Search, Settings, the navigation sidebar, the inbox and the account menu close on outside click or Escape. Escape dismisses the topmost surface and restores focus to its trigger. The native query popover dismisses independently. Clicking a workspace control outside a drawer dismisses the drawer and still activates that control.
- Global search lists matching Alert, Episode and transaction work codes together. Selecting a result opens the corresponding work tab. Arrow keys move between results and Enter opens the focused result or the first match for a nonempty query.
- The archive button and unread notification rows share a red status dot. The row dot sits to the left of the title. Read rows keep the same title and timestamp alignment, and assistive technology reads the unread status.
- Lucide general icons are 16px, 20px and 24px for Small, Medium and Large UI. Sidebar tab close and group add, tag remove, card add and dense tag glyphs use the fixed 12px size. The icon policy preserves each control’s separate hit area.
- Scrollable lists, dialogs and tables share an 8px neutral scrollbar track with a 4px rounded thumb in Chromium. Thumb dragging and keyboard scrolling use the browser's scrolling behavior.
- WorkspaceNavigation places a static location label before the primary tabs and the optional view switch in one centered header frame. Transaction, Alert and Episode details show the current record ID there. The label stays outside the keyboard focus order. Tab and Shift+Tab traverse available choices, and Arrow, Home and End keys move focus. The current choice stays selected and outside the sequential focus order. Enter and Space activate a choice and move focus to an available nearby choice. StarBorder is the selected enabled Primary treatment. Disabled actions keep a static state. Cards, panels and their perimeter highlights use the shared `--aml-radius-card` token. The record surface clips its header backgrounds and draws the inset glow. MagicBento wrappers that supply tilt stay transparent and leave room for the record perimeter. Information panels and KPI tiles use a canvas-adjacent opaque surface and a shallow neutral shadow. Their appearance stays static on hover.
- My and All Dashboard show the summary, metrics, charts and case queues on one page. The header switches between My and All Dashboard. Existing dashboard view links open the unified page and preserve applied filters. My Dashboard keeps the linked transaction below its case queues.
- Alert and Episode details use three primary tabs: Overview, Analysis and Related. Alert Overview adds All / Per panel, and Analysis and Related add Pattern / Owner as a second header group. Investigation and Report use the same secondary group for Table / Card. Read-only, judgment and rule-reason frames keep their parent tab. Judgment remains a disabled preview action.
- Analysis and Related render React Flow from the selected sample’s actual transactions. Pattern view uses account nodes. Owner view groups accounts by owner. Selecting a graph node or edge scopes the evidence table. Related lists cases that share transactions or accounts and can compare their evidence in the same graph. Case overview displays the available model, transaction, date, account and verdict facts and identifies missing source fields.
- The account menu opens Settings and Sign out. Settings groups Dark mode, Reduce motion, Live light refraction and UI size under Appearance and accessibility, with separate notifications and permissions sections. JellyRadio sets Small, Medium (default), or Large, using shared typography and density tokens and 32px, 40px, or 48px header controls. Each appearance choice persists in browser storage. SquishSwitch also powers the inbox unread filter. The Settings BellToggle remembers whether sample workflow notices enter the inbox. The drawer keeps unread-only and mark-all-read controls, and its accessible name stays available. The light and dark canvases use solid colors. Live light refraction is on by default. With refraction on, the shell applies a 32px blur and a dense neutral tint to floating controls, popovers, dialogs, and drawers. The SVG renderer shares displacement maps across matching dimensions, corners, and blur settings. With refraction off, these surfaces use opaque theme colors with no backdrop filter, and the renderer releases its filter definitions and observers. Workspace cards and panels use opaque neutral surfaces.
- Investigation uses four unframed sections. Compact AnimatedList columns show scroll indicators for 12 sample owners and 12 accounts per owner. Bézier curves connect the selected owner and account rows to visible entries in the adjacent account and transaction lists. Endpoints follow scrolling, and the selected links use a stronger stroke. Narrow layouts keep links between adjacent columns and omit them where the transaction list wraps below. Six selectable ListCards per account show the transaction ID as the title, with verdict, direction, parties, flow, time, method, amount, currency and review status in the card. Selecting the transaction body refreshes the linked Alert and Episode lists. The Figma Card header, fields and status footer are shared across dashboard and investigation queues. The Card header joins an optional selection control, a full-width detail button, and an optional plus button in one row. Each control uses neutral color states. The middle button activates the record detail and its work tab. The plus button adds the work tab in the background. Existing codes reuse their tab. Investigation Card view uses controlled SpringCheck selection and shows its selected count. Information cards have rounded corners and 8px gaps. Dashboard queues use document scrolling. Investigation cases and related cases use plain list scrolling. The ledger and its case relationships are local fixtures.
- Sample verdict is keyed by record code across cards and tables. The whole record surface is yellow for 판정 전, red for 이상, and soft green for 정상. Human-reviewed cases show 처리 완료 and leave the open queues. The 63×20 human verdict tags use the original Figma label, fill and 12px icons. Model score and processing state have their own tags. Case cards and tables display account flow and transaction periods. Amounts are grouped by currency. Case-detail evidence tables link to the same canonical transaction records.
- Alert and Episode investigation lists use the shared React Table for tabular comparison and a four-column Card grid on desktop. The card grid reflows to two or one column on narrow screens. The table keeps native headers and an independently scrollable viewport. Both views keep the same query, detail and background work-tab actions.
- The workspace sizes scrollable lists from the viewport and measured header. Content extends beneath the floating account profile and bottom-right actions. The workspace stays below fixed shell chrome and drawers, and native search and settings dialogs stay in the top layer. Investigation lists and report history groups use flat section wrappers. Report table rows use dividers, and the card view keeps each record’s own surface. Narrow layouts reflow into fewer columns and scroll, while the primary-action glow stays within the viewport and query popovers fit the room available near the trigger.
- The right toolbar starts with Filter, then Sort, Period and Download. Applied filters appear as removable tags below the toolbar. Header query icons open their controls directly in My Dashboard, All Dashboard and the Alert and Episode lists. GlideSelect displays sort choices, period presets and CSV scope on the first activation. The compact Filter popover uses SpringCheck and puts Apply in its header. All Dashboard and investigation also provide a JellyRadio assignment filter. My Dashboard accepts status, date and sort options. Dashboard sort reorders each work queue. The date-range calendar also scopes transaction metrics. CSV can export the current matching work cases or the full fixture set for the current view. Queries are independent per dashboard and per case type, and each Alert or Episode query is shared by its table and card views. Report selection uses SpringCheck.
- Rule templates use BranchedMenu. A two-handle adaptation of CometDial's arc divides the rule risk scale into green, amber and red ranges. Dashboard and case overview use MagicBento. My Dashboard fills a two-metric summary and four workflow queues. All Dashboard fills eight metrics, risk and pattern distributions, hourly transaction and Alert status charts with expandable data tables, and three work queues. Counts use CountUp. The dashboard displays its sample period explicitly and reuses the Alert and Episode fixtures from investigation. The sample backtest uses Stepper, StatusMark and SwipeToast. The sample report exports a PDF.
- The Figma **4 screen** page (`3856:17597`) supplies 42 frame references. Detailed visual parity, production authentication, permissions, rule save, case judgment, and production-scale query/render verification remain open.

### Standalone preview and Figma layout reference

- The [interactive preview](http://localhost:5215/dashboard/mine) uses the standalone dashboard, investigation, and case detail components. The [layout reference](http://127.0.0.1:5216/?ui=new#/dashboard/mine) runs the clean `test_front` checkout at `792970ce` in the current local session. Compare section order, placement, and proportions in the reference. Keep query controls, charts, case graph interactions, and work tabs in the standalone preview.
- The standalone preview shares the AML color, spacing, typography, and control tokens through `preview-design-system.css`. The overview leads with the AI summary and KPIs. Graph playback and zoom share a toolbar below the canvas. The rule list puts selected-rule details and the model risk thresholds in a right-side column on wide screens. On narrow screens the navigation drawer starts closed, and selecting a destination dismisses it. Owner and account lists scroll independently so the selected account's transactions start within the first phone viewport.

#### Desktop contextual tools

The header reserves the same width for both side groups, based on the wider visible control group. Navigation and screen-level tools stay centered as one group, with the tools immediately to the right of navigation. An expanded tool grows the group symmetrically while the workspace stays in place. A table places supported tools to the right of its title. Each tool keeps its original button when opened. Table columns cycle from default order to ascending, then descending, then default. One column per table is active. Case query chips stay above the content.

| View | Screen-level tools | Table tools |
| --- | --- | --- |
| My Dashboard and All Dashboard | Filter, Sort, Period and sample CSV or visible charts |  |
| Alert and Episode lists | Filter, Sort, Period and CSV in card view | Filter, Period and CSV in table view |
| Rule list and change reason | PNG and SVG in the model risk dial panel | Rule status and matching CSV |
| Rule creation and backtest |  | Period and CSV for matching result transactions when available |
| Ledger and Alert or Episode detail | Download an active transaction or visualization | Payment method or owner, Period and matching CSV for transaction evidence or linked accounts when shown |
| Report table and cards | PDF Download after selections in card view | Verdict filter and PDF Download after selections |

The [variables catalogue](http://localhost:5215/components.html#variables) reads the standalone preview's effective CSS variables and displays theme swatches. The shared exterior card, panel and table radius resolves to 6px, 8px or 12px at small, medium and large density.

### Local analytical implementations

- My Dashboard uses the official BarSparkline for the two KPI cards. Hovering a bar shows the matching sample case count for that creation hour in KST. Current date and status filters govern those counts. The queues contain only cases assigned to the current sample user, including unread work. The linked transaction is outside the case totals. [Bklit Sparkline](https://bklit.com/docs/components/sparkline)
- All Dashboard uses the official Bar Chart for stacked hourly volume and Alert status, risk ranges, and the two proportion bars. Bézier curves connect the exact positive-label section of the upper bar and each lower category. Six PatternTags follow Figma. Additional source labels are accounted for as other patterns or no pattern. Hover details and a keyboard-accessible hourly table give exact values. [Bklit Bar Chart](https://bklit.com/docs/components/bar-chart)
- The composition and hourly volume panels use the fixed IBM AMLworld HI-Small benchmark period from September 1 through 18, 2022. The official CSV and pattern file yield 5,078,345 transactions and 5,177 positive labels. Model risk scores, case statuses and dashboard filters belong to the separate workflow fixtures. The benchmark panels identify their source and dates. [IBM AML-Data](https://github.com/IBM/AML-Data)
- Alert and Episode overview trends use interactive BarSparkline with a keyboard-readable series. Currency amounts are plotted separately. Investigation topology and playback use React Flow. The rule engine uses an editable two-handle dial and the report uses a judgment table.

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

[App codes.ts](../../../frontend/web-app/src/api/codes.ts) is authoritative. Recheck it when the app path changes. Existing backend API section 2.3 is reference only. Do not drop types before team agreement.

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

<a id="rule-version-implementation"></a>
## Rule version comparison implementation

- The local mock now preserves actual previous conditions on successful rule saves and status changes. Do not fabricate missing historical versions or call an unobserved version an operating baseline.
- Baseline selection defaults to none and is disabled when no prior condition is available. A version may differ only by status; identical matches are valid.
- Compare both conditions against the same current sample and period. Execution captures conditions, input rows and both results; changing drafts does not rewrite displayed results, and a failed retry retains the last successful pair.
- Counts use the complete matched sender-account sets, independent of the visible transaction page. Accuracy remains unavailable because the account-level reference-label policy is undefined.
- The existing sample workspace is memory-only. Refresh resets newly recorded versions; do not claim server persistence or historical production replay.
- The nine financial templates in Figma are not model-code presets. Do not translate their amount/counterparty/graph conditions into score/count/window values. Current backend data requirements and unresolved contracts live only in the [Korean handoff](api.md#rule-versions-and-templates).

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
2. Preserve regression coverage; the three earlier legacy test timeouts did not reproduce in the latest full run. Their earlier cause remains unconfirmed. A separate known mixed-offset comparator in `case-selectors.ts` remains unchanged: earlier automatic review rejected that selector/test edit scope and the coordinator deferred it. Passing tests do not clear this defect; the new related-merge regression covers only `case-related.ts`.
3. Complete per-screen evidence, actual graph/hover/click checks, and backend confirmation of the 11 open API items.
4. Obtain KMG's design review separately. Documentation completion is not product completion.

### Latest recorded automated run

Date: 2026-11-17; base HEAD `2d76ef15867512b4728dd4e6fe7cbc38e9cd3ca5` plus the preserved uncommitted working tree. Tests, lint and build were rerun after the related-evidence timestamp-order, nested candidate-list scroll and existing session-adapter response-validation fixes. These results are local, not a pushed revision.

| Check | Recorded result | Boundary |
| --- | --- | --- |
| `pnpm lint` | 0 errors, 1 existing warning | React Compiler/TanStack compatibility in `use-data-table.ts` |
| `pnpm build` | Passed | Existing large-bundle warnings |
| `pnpm test` | 77/77 files, 580/580 tests passed | Includes related-evidence chronology and session-response contract regressions; no failures in this run |

The following tests timed out in the historical 2026-11-16 run; all are included in the passing current suite. Earlier failure names retained for lookup:
- `src/app/App.live.test.tsx`: `명시적 로그아웃 후 같은 신원으로 로그인해도 이전 의견을 복원하지 않는다`.
- `src/app/App.test.tsx`: `mock Alert에서 제외한 거래는 상세와 목록의 건수에 함께 반영된다`.
- `src/app/App.test.tsx`: `RDR 9000을 닫고 다시 열 수 있으며, 화면 이동에도 패널 상태가 유지된다`.

Scoped browser checks at 1280×720 covered Episode graph/account-to-table selection, two-Alert sample bundling and two wrapping areas, related candidates/evidence, simulated loading/empty/refetch error, and sidebar hide/restore. Default Light and Dark/Sky were inspected in an isolated in-app browser; user Chrome and Figma were not controlled. Full 16-appearance visual parity, live API integration and user design acceptance remain unverified. See [dated checks](history/qa-checklist.md#최근-실행-결과). Dated implementation and QA evidence, including local paths that may no longer exist, remains in [history](history/); never promote it to a current pass without rechecking.
