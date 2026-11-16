# Screens and routes

Screen list for implementation. Routes are proposals; match them to the real routes in this repository when coding. Layout rules: [frontend handoff](frontend-handoff.md).

Figma sections: Dashboard, RuleEngine, AddTab, Alert, Episode, Report, ETC.

## Required variants and evidence

Every screen, including Login, supports Default Light/Dark and Solarized Light/Dark × Sky/Violet/Pink/Lime. Use v3 tokens and preserve component bindings. The target dates are maintained once in the [delivery schedule](frontend-handoff.md#delivery-schedule).

For each completed screen, add a screen entry below with: Figma frame link (or `no Figma reference` for Login), implementation version/commit and preview link, data requirements, domain mappings to `codes.ts`, loading/empty/error behavior, and light/dark captures. Label unavailable links and unverified states explicitly. A route in the table below is only a proposal, not a working preview.

## Screen inventory

| Section | Screen | Proposed route | Variants |
| --- | --- | --- | --- |
| Dashboard | dashboard/mine | `/dashboard/mine` | pair with all |
| Dashboard | dashboard/all | `/dashboard/all` | pair with mine |
| RuleEngine | rule-engine/draft-list | `/rules` | side panel with reason |
| RuleEngine | rule-engine/draft-create | `/rules/new` | none |
| RuleEngine | rule-engine/draft-backtest | `/rules/:id/backtest` | none |
| AddTab | add-tab/owner-account-transaction | `/investigate/ledger` | one of three investigation tabs |
| AddTab | add-tab/alerts-cards | `/investigate/alerts?view=cards` | with and without `내 담당`; table pair |
| AddTab | add-tab/alerts-table | `/investigate/alerts?view=table` | with and without `내 담당`; card pair |
| AddTab | add-tab/alerts-bundle | `/investigate/alerts?mode=bundle` | open: draw it, or add a panel to the list |
| AddTab | add-tab/episodes | `/investigate/episodes?view=cards` | with and without `사람 판정 이상만` (already drawn); table pair |
| AddTab | add-tab/episodes-table | `/investigate/episodes?view=table` | with and without `사람 판정 이상만`; card pair |
| Alert | alert/overview-allpanel | `/alerts/:id?tab=overview&mode=all` | pair with per-panel |
| Alert | alert/overview-perpanel | `/alerts/:id?tab=overview&mode=per` | pair with all-panel |
| Alert | alert/analysis | `/alerts/:id?tab=analysis&view=pattern` | owner view only |
| Alert | alert/related | `/alerts/:id?tab=related` | owner view |
| Alert | alert/judge-single, judge-bundle | dialog over overview / related | selected normal / abnormal state is open |
| Alert | alert/overview-staff-readonly | `/alerts/:id?tab=overview` | other assignee, read only |
| Episode | episode/overview | `/episodes/:id?tab=overview` | none |
| Episode | episode/analysis | `/episodes/:id?tab=analysis&view=pattern` | owner view only |
| Episode | episode/related | `/episodes/:id?tab=related` | owner view |
| Episode | episode/judge | dialog over overview | Episode verdict method is open with the team |
| Report | report/write | `/report` (proposal) | verdict logs in table or card view, checkbox select, PDF download |
| ETC | notifications | sidebar drawer | none |
| ETC | account | sidebar menu | none |
| ETC | settings | settings window | font size, theme |
| ETC | auth/login (no Figma reference) | `/login` | session expired; all 16 theme/brand combinations |
| ETC | state/loading-empty, refetch-error, judge-result | on top of a main screen | loading vs zero results; one-line retry banner; save success, failure, needs confirmation |

Not drawn: the 12-tab limit state (feature removed). Optional analysis versions (node selected, detail transactions off) are not drawn (decision 2026-11-11 18:02).

## Implemented screen entries

Current implementation reports are [complete mock app](complete-bundle.md) and [first bundle](first-bundle.md). They report mock behavior and verification limits, not final design acceptance or live API completion. Keep their evidence linked from this screen inventory rather than copying it. Add later verified entries newest first; each entry must link to its real preview or source and capture evidence.

Required data list per entry: visible field/metric → source mock field → meaning/unit/calculation → required domain code → missing/loading/error behavior → backend agreement status. Mark mock data as mock.
