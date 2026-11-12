# Screen QA checklist

Before calling a screen done, check every item on the current screen or current Figma. An old screenshot does not pass. When one item is fixed, recheck every screen of the same kind. Rules: [frontend-handoff](frontend-handoff.md), [data-rules](data-rules.md).

## Layout

- [ ] No panel inside a panel. No scroll area except `main`.
- [ ] A table-only screen has no card-list shell and no outer border.
- [ ] Header and all rows share column start and end. Zero drift.
- [ ] Fill columns were counted before widths were set. IDs do not wrap; pattern tags are not cut.
- [ ] AI summary: width fill, height hug. KPI: width hug, height fill.
- [ ] Card lists keep their minimum card width and the column count follows the width.
- [ ] PageHeader is full width. A screen with a verdict has one Primary verdict button.
- [ ] The AI summary sits at the top of the body.
- [ ] Frames do not overlap and stay inside their section. No page footer.

## Text and components

- [ ] Screen text is Korean. Exceptions: fixed English pattern names, IDs, code. No placeholder text (`Button 1`, `Value`).
- [ ] No Korean beside a pattern tag. Format `Fan-out 82%`.
- [ ] Status, risk, age, and verdict use StatusTag presets. Age bands are 3 days, 7 days, over 7 days.
- [ ] Applied filters are FilterTag. Two or more chips add a clear-all button. Clicking a chip clears only that filter.
- [ ] Sample names are masked, and no real names appear in sample data.

## Data and filters

- [ ] Display IDs use `{A|E}-YYMMDD-NNNNNN` and match across screens. No old `A-0001`.
- [ ] Title count equals row or card count.
- [ ] Rows match the active filter, period, and permission.
- [ ] Filtered and unfiltered versions are not mixed on one screen.
- [ ] Amounts show their currency. No native-currency total stands in for a missing USD total.

## Removed features stay removed

- [ ] No tab-limit text, no "max tabs" toast, no max-tabs screen. The Toast component may exist.
- [ ] No AppHeader on new screens.
- [ ] No separate "select" or "bundle" row in the Related tab header.
- [ ] No "false positive" verdict choice.

## State screens

- [ ] Loading and zero results look different.
- [ ] A failed refetch keeps the last good list and shows a one-line banner.
- [ ] Verdict save shows success, failure, and needs-confirmation differently.
- [ ] Another assignee's Alert is read only; the verdict button is disabled.

## Access and tables

- [ ] Number columns right-aligned, text columns left-aligned. No centered text.
- [ ] A long account or ID does not cover the next cell.
- [ ] Browser zoom is not blocked.
- [ ] Whether filter, tab, and page state stay in the URL is noted. If not built, mark it not built.
