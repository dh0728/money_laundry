# App shell, login and dashboard handoff

Implemented in `frontend/implementation/1.14.0/web-app/src/next`. Scope ends at the personal and whole-team dashboards. No backend request, real authentication, verdict, or persistence of business records is connected.

## Run and routes

From `frontend/implementation/1.14.0/web-app`:

```sh
pnpm dev --host 127.0.0.1 --port 5211 --strictPort
pnpm lint
pnpm test
pnpm build
pnpm build-storybook
```

Root `/` now loads the new app. Routes use hashes: `#/login`, `#/dashboard/mine`, `#/dashboard/all`. The period and applied search live in the hash query (`?start=2026-11-09&end=2026-11-15&q=...`) and survive scope navigation, reload and browser history. Unknown authenticated routes fall back to the personal dashboard. The mock identity lives in tab-scoped session storage; appearance lives in local storage. Passwords are never stored. Blocked or malformed storage falls back safely.

Use the sample-account button or `demo` / `radar-demo`. `VITE_API_MODE` does not connect this new entry to the old app's live API. Existing source screens and `ant-review.html` remain in the repository; the new app imports none of those screens.

The original `ShellChrome.stories.tsx`, Storybook configuration, token snapshot, sync script and dependencies are preserved. `ShellChrome` gained optional header/sidebar/content slots; the new app uses those slots. Its default empty-content story and `/next-review.html` retain the original controls and sidebar collapse behavior. New `App/First bundle` stories expose login, mine/all, loading, empty, first-load error and refetch error. Storybook is a static component specimen; use the running app to verify navigation and sign-in.

## Screen correspondence and data provenance

| Screen | Figma reference | Displayed text and numbers | Code values | States and actual captures |
| --- | --- | --- | --- | --- |
| App shell | [Header `3510:13270`](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh?node-id=3510-13270); the dashboard frame composition below | Menu labels are product copy in `ui/AppShell.tsx`. Sample identity is `snapshot.userName` / `userId` in `dashboard-data.ts`. No fabricated unread count or fabricated open work tabs. | No new domain enum. `Scope` is local navigation state. | Sidebar expanded/hidden and restored; default legacy preview checked. `preserved-shell-preview.jpg`, `sidebar-hidden-dark.jpg`. |
| Login | Not drawn in Figma; explicitly included in this implementation bundle | Korean form labels/errors are product copy in `App.tsx`. The displayed account is a local mock fixture, not a backend account. No operational totals. | Mock STAFF identity only. No claim that a submitted password is server-authenticated. | Idle, validation failure, submitting, expired session; successful sample sign-in. `login-light-sky.jpg`, `login-dark-sky.jpg`, `login-validation-dark.jpg`, `login-expired-dark.jpg`. |
| Personal dashboard | [Dashboard / mine `3031:7466`](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh?node-id=3031-7466); AI summary `4148:13745`, KPI `3511:17333`, card `3511:17376` | All cards, column counts, KPIs, days elapsed and daily Alert counts derive from `cases` and `selectDashboard` in `dashboard-data.ts`. Only assignee 7 is included. AI prose is explicitly a synthetic summary example derived from current counts. | `TypeCode` and `typeDisplay` from `src/api/codes.ts`; case `status` uses `OPEN` / `CLOSED`. Human verdict is a separate display-only field. | Ready, loading, zero results, initial failure, failed refetch/retry; 16 visible records in the default period, four per workflow column. `mine-light-sky.jpg`, `mine-dark-sky.jpg`. |
| Whole-team dashboard | [Dashboard / all `3031:7805`](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh?node-id=3031-7805); chart row `3526:34982` | One fixture contains 126 transactions and 24 cases. Default-period totals: 94 model-suspicious transactions, 16 Alerts, 8 Episodes, 6 closed cases, 25.0% workflow completion. New accounts/owners use first appearance within the available fixture history. All eight KPIs, risk bands, daily charts and pattern counts derive from the same selection. Search restricts both cases and linked transactions; the UI names that scope. | All nine `TypeCode` values retained. Pattern charts count only suspicious transactions with code 1–8. Code 0 remains independently possible on suspicious transactions; it never means a human NORMAL verdict. | Same loading/empty/error treatment. Default board has 24 records, six per column. `all-light-sky.jpg`, `all-dark-sky.jpg`; middle/lower captures cover pattern charts and work cards. |

`patternName()` derives English display names from `typeDisplay()`; code 3 remains `GATHER-SCATTER` → `Gather-scatter`, code 4 remains `SCATTER-GATHER` → `Scatter-gather`. Display IDs and numeric case/source IDs are stored independently. Display IDs follow `{A|E}-YYMMDD-NNNNNN`. Names are masked. USD totals are not substituted with native-currency totals; missing totals render `값 없음`. Ratios with zero denominator render `값 없음`, not zero percent.

Four workflow labels (`열람 전`, `처리 전`, `처리 중`, `처리 완료`) are **frontend display state**, separate from backend status codes. `정상` / `이상` are display-only verdicts; neither `FALSE_POSITIVE` nor the unconfirmed API value `SUSPICIOUS` is offered or submitted. Model score remains visible after the human verdict. The risk thresholds are passed from the fixture's rule settings (`medium=0.7`, `high=0.9`), not embedded in a tag component.

## Data required from backend

These are screen needs for backend design, not assertions about existing API.md endpoints.

| Surface | Required data | Semantics to settle |
| --- | --- | --- |
| Login / shell | Current user ID, masked/display name, role, session status/expiry, allowed scopes; login errors; later logout/session endpoint | Real session and CSRF handling; permission to view all staff. Preferences can remain local. |
| Personal dashboard | Snapshot timestamp with offset; business date/timezone; current assignee; applied period; stable case/source/display IDs; kind; assignee ID/name; created timestamp; work-state evidence; backend status; human verdict; model score; type code/probability; transaction IDs/count; nullable USD total | Which events define unread, pending and in-progress; whether closed cases are in the selected cohort; creation-date vs detection-date period; age origin; independent ID mapping. |
| Personal summary | Daily created Alert counts for the same assignee/period; priority candidate counts; generated text, provenance, generation timestamp and stale/error status | AI generation/caching route is unconfirmed. Current prose is explicitly a local example. |
| Team intake KPIs | Received/analyzed transaction counts, suspicious count and denominator; new account/owner counts; daily bucket counts | Analysis coverage vs receipt coverage, timestamp defining period, first-seen history boundary. Current fixture has all 126 received transactions analyzed. |
| Team work KPIs | Created Alerts; pending Alert count; open Episode count; completed count and denominator; distinct suspicious transaction IDs linked to Alerts | Current local completion rate uses selected created cases, not the old Figma sample's unconfirmed rolling-30-day definition. Real comparison windows and prior-period changes are not invented. |
| Team charts | Suspicious score-band counts with rule settings/version; daily total/suspicious transaction counts; daily workflow cohorts; code 1–8 counts and NON_PATTERN exclusion count; scoped case list | Shared filters, consistent denominators and inclusive/exclusive dates; counted unit (transactions vs cases); distinct IDs for deduplication. |
| Loading / recovery | Nullable response, successful empty response, typed failure, last successful snapshot with its applied query and timestamp | Failed refetch retains the exact prior successful result, including a successful empty result. A new URL starts a fresh local projection from the cached fixture. Actual network/cache behavior awaits the API. |

The sample date is fixed at `2026-11-15`, with available transaction history `11-09` through `11-15`. Dates earlier than the available history do not fabricate older data. The UI says the sample snapshot time. Dates and searches affect counts consistently; preset period buttons edit a draft and Apply commits it. Removing the search FilterTag clears only search. Empty-screen reset clears all conditions.

## Visual system and states

All new colors reference v3 variables. Source `tokens.css` and `tokens.json` still match their recorded SHA-256 values in `tokens-source.json`. Four themes (Default Light/Dark, Solarized Light/Dark) and four accents (Sky/Violet/Pink/Lime) work on login and both dashboard scopes. Selected navigation uses opposite-brightness ink/fill tokens. Read-only cards do not expose fake click targets. Out-of-bundle menus are disabled and visibly labeled `준비 중`.

Source v3 tokens do not define a distinct unread/orange semantic role. Unread and 4–7-day age tags use the existing amber solid/text-on-accent pair; 0–3-day ages use amber subtle and over-7-day ages use negative. No old orange token or raw color was added. Labels show the actual age.

Loading has a distinct status message. Initial error hides unavailable totals and offers retry. Refetch error keeps the previous successful dataset with a single banner. The developer-only state selector and `?state=loading|empty|error` permit repeatable checks; the selector is omitted from production. A busy login disables duplicate submission. Session expiration and logout remove the mock identity and return to login, retaining appearance only.

## Verification and local evidence

Measured on the local Vite app with the in-app browser, not a production deployment:

- `pnpm lint`: zero errors; one existing TanStack React Compiler warning outside `src/next`. Generated `storybook-static` is excluded like `dist`; source rules, including all six shadcn rules, remain enabled.
- `pnpm test`: **51 files, 273 tests passed**, including ten new contract/journey regressions. Vitest workers disable Node's experimental WebStorage so Node 26 cannot shadow jsdom storage. Existing jsdom pseudo-element notices remain.
- `pnpm build` and `pnpm build-storybook`: passed. The retained legacy graph build still emits the existing large-chunk warning.
- Browser: 16 theme/accent combinations for each of login, personal dashboard and team dashboard; 48 main captures. Final 32 dashboard combinations all measured header 48px, sidebar 240px, zero document horizontal overflow and zero clipped card descendants at 1920×1080.
- Browser journeys: sample sign-in, invalid login, session expiry, logout, sidebar hide/restore, scoped search/clear, period draft/Apply, scope switch retaining period, missing-search aggregates, loading, empty, first-load failure, retry, and failed-refetch retention of both populated and empty results.
- Widths: 960×900 split view, 1280×720 and 2400×1350 effective CSS viewports passed the recorded overflow checks. The latter two approximate 150%/80% layout space at Full HD; they are not a claim that actual browser zoom controls were tested.
- Existing ShellChrome preview retains its empty-content main and functional sidebar collapse. Its existing story source is unchanged.
- Independent read-only review found three important issues (search-only clear, search aggregate scope, retained empty result); each was reproduced by a failing regression and fixed. No outstanding important finding from that review.

Local captures and JSON measurements are in `/tmp/aml-first-bundle-captures/`; raw screenshots/logs are not staged or added to the repository. Per-screen `*-light-sky.jpg` / `*-dark-sky.jpg` are full-size actual captures. `*-matrix.jpg` shows all 16 combinations; `*-light-dark.jpg` pairs light/dark. `states-matrix.jpg` covers state renders. Test/build logs use `/tmp/aml-first-*.log`. These are local review artifacts and need copying if long-term retention is required.

Limits: no real authentication/API/AI execution, actual browser-zoom control verification, screen-reader study, production deployment or human design approval. Bundled Playwright sweep was omitted because this checkout has no Playwright dependency; the available in-app browser supplied direct DOM geometry, interaction and screenshot evidence. An attempted isolated native Chrome launch crashed during startup; it was abandoned and all successful browser verification used the in-app browser.

Figma use for this task was read-only: create_session 1, get_metadata 3, get_design_context 5, get_screenshot 2 (**11 calls**). The usage table had no rows inside the last 24 hours when checked, so the visible-table rolling count plus this task is 11; other concurrent/unlogged work cannot be inferred. No Figma write, stage, commit, push or PR was performed.
