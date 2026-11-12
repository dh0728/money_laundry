# Screens and routes

Screen list for implementation. Routes are proposals; match them to the real routes in this repository when coding. Layout rules: [frontend handoff](frontend-handoff.md).

Figma sections: Dashboard, RuleEngine, AddTab, Alert, Episode, Report, ETC.

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
| ETC | auth/login | `/login` | session expired |
| ETC | state/loading-empty, refetch-error, judge-result | on top of a main screen | loading vs zero results; one-line retry banner; save success, failure, needs confirmation |

Not drawn: the 12-tab limit state (feature removed). Optional analysis versions (node selected, detail transactions off) are not drawn (decision 2026-11-11 18:02).
