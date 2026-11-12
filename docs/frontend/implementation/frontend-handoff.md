# Frontend handoff

Layout and component rules for the new screens. Related: [screens](screens.md), [data rules](data-rules.md), [API requirements](api.md).

The [Figma design](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh) decides sizes, frames, and node ids. Read the current design when implementing.

## Frame

- PC only, 1920×1080. Responsive layout is fine; no mobile screens.
- No AppHeader. Each screen starts with one PageHeader, full width.
- No page footer. Button rows inside cards, panels, and dialogs are fine.
- The sidebar holds global search, the menu, and the fixed 보고서 작성 tab (see Navigation and selection). AI summary lives in a summary card on the screen that needs it, never in the sidebar; the two do not conflict.
- Sidebar has one expanded form only. A collapsed screen has no Sidebar; it turns on the PageHeader component property `showSidebarButtons`, which shows the PageHeader `sidebar` frame. Do not build a collapsed sidebar variant.
- One scroll area: the screen `main`. No panel inside a panel, no scroll area inside a table or card list.
- Use existing components: StatusTag (status, risk, age, verdict), PatternTag, ScoreTag, FilterTag. Presets: [data rules](data-rules.md#statustag-presets).
- Search, filter, sort, and date popovers stay their own components, not Dialog instances. Their header, radius, padding, stroke, shadow, and color variables match Dialog.
- Screen text is Korean. Exceptions: fixed English pattern names (Fan-out, Cycle), IDs, code.
- Mask sample assignees and reviewers, like `김OO`.

## Layout

- Overview screens (Alert, Episode) open with tags, then the AI summary, then KPIs. Dashboards open with the AI summary and KPI band.
- AI summary card: width fill, height hug. KPI cards: width hug, height fill, so they match the row.
- Card lists use a minimum card width with fill, so the column count follows the screen width.
- Tables: header row and every data row share the same column widths. Count the fill columns before turning one more column to fill; each fill column gets narrower.
- A table-only screen is not wrapped in a card-list shell and has no outer border. Row count equals the count in the title.
- Analysis screens: fixed-width side panel, graph fills the rest, playback bar on the bottom edge with Zoom on the bar row. Do not label the panels `그래프` or `표`; the layout is enough. Every table panel has a CSV download button.

## Verdict and lists

- One verdict button, Primary, in the PageHeader. No separate select-and-bundle row in tabs. The verdict dialog is the same for one or many items.
- Investigation lists switch between card view and table view with two PageHeader tabs. Applied filters show as FilterTag; two or more tags add a clear-all button.
- Related tab: count and filter tags in the header; verdict via the PageHeader button.
- Verdict dialog footer: Cancel, Verdict done, Report download. Report download is Primary, disabled by default.
- A disabled Verdict done button is not clickable: no click handler, no prototype interaction, until it is enabled.
- Reports are AI-written. Report write page: verdict logs in table or card view, pick with checkboxes, download the picked ones as one PDF. No human input form, no draft or final step. Verdict IDs use `J-YYMMDD-NNNNNN` (example `J-261111-000001`); the report-write table and the verdict-dialog header may show this ID. Every table panel has a CSV download button; a vector PDF of the overview is under review.
- A judged item shows the human verdict first and the model score second.
- Build order, one confirmed screen at a time: Dashboard, Alert list, Episode list, Transactions, Rule engine.

## Left out

- The 12-tab limit and its toast are not on any screen. The Toast main component stays in the library.
- Table outer borders, AppHeader, nested scroll, a separate bundle button row.

## Carried-over UI rules

Carried-over rules for implementation. Where the current Figma differs, Figma wins; update this section.

### Build
- Start from proven components (shadcn/ui). Make a shared component only when two or more screens use it.
- Colors, spacing, type, and sizes come from tokens only. No one-off values per screen.
- Never carry meaning by color or line shape alone; show text, value, direction, or state too.
- Numbers carry units and align for comparison. "No value", "error", and "stale" differ from 0.
- A human checks AI-made screens on the real screen. Check at 80% to 150% browser zoom and split windows, not only full HD.
- A Figma sketch from a person is a shape idea. Do not copy its text, numbers, colors, or fonts.
- When matching one element's size to another, measure the rendered size; do not estimate.

### Navigation and selection
- Sidebar menu: Dashboard, Transactions, Alert list, Episode list, and a fixed Report write tab (decided 2026-11-11; position after Dashboard, Rule engine, Investigation). List screens have no big page title.
- Notifications and settings sit under the sidebar; the user area is the account entry.
- The current menu item is shown by strong contrast, not a faint background.
- A selected row, card, or menu item flips to the opposite theme brightness. Hover is a brief outline and selection stays; they never look the same. Read-only areas have no hover glow. Red means risk or error only.
- Underline tabs only for sections that change the content structure (Alert detail: overview, graph, transactions, review).

### Lists
- Conditions on one list (`my open`, `high risk`, `3 days or more`) are filters, not separate pill buttons or tabs.
- Period picker: one popover with presets (today, last 3 days, 7 days, 30 days, this month, custom) and a start to end range. The list changes only after Apply.
- Multi-select in the Alert list exists only in Episode bundling mode; otherwise a row click opens the detail.

### Status and tags
- Alert and Episode share one status vocabulary. Being bundled into an Episode is not a handling stage.
- Count badges and pattern tags are neutral. Red is for risk only. Do not add category colors to categories already named by text.
- Colored tags (age, risk) and neutral tags (pattern) go on separate lines in a card. Do not add a kind tag when the ID prefix `A-` or `E-` already says it.
- A detection pattern is never shown alone as fact; show it with the model probability.
- Risk bands come from rule-engine settings, not from fixed numbers.

### Charts and graph
- Do not fit values of different units into one bar length; label the unit per row or panel.
- Horizontal bars read name, then number in a fixed column, then bar.
- `NON_PATTERN` is left out of dashboard and summary pattern charts and type counts; detail screens may show it.
- Graph: every transaction line shows direction with the arrowhead on the target node center. Nodes, lines, arrowheads, and labels do not overlap. Line color means risk only, thickness means amount only, count is the text `N건`. Cap extreme thickness so the rest stay distinguishable. Risk checkboxes (high, medium, low) filter what is shown, all on by default. Default account nodes have no border; borders mark selection or focus only. "Fit to view" and "full screen" are two different icons.
- Check graph arrows on the final zoomed render, not by the existence of an SVG marker.

### Detail and buttons
- Processing history is a section under the overview, not a separate wide screen: case name, assignee, time, reason in one flow.
- In one action group the action that finishes the work has the strongest contrast (review screen: confirm closing is primary, save draft secondary, saved list a text button).
- Changing a transaction verdict: opposite button, then a confirm dialog with a required reason, then time and handler are logged. One abnormal transaction makes the account red.
- Remove repetitive descriptions of self-evident tabs, buttons, and tasks. Keep labels needed for evidence, scope, permissions, errors, or irreversible actions.
