# bklit registry snapshot

Bklit UI chart sources fetched from `https://bklit.com/r/<name>.json` on 2026-11-23 for `composed-chart` (with `series-bar`, `line`, `x-axis`, `y-axis`, `grid`, `tooltip`) and `gauge`, plus everything they import. MIT license: see `LICENSE`.

Kept apart from `../charts/`, which is an older bklit snapshot the existing charts depend on; the two cores differ, so mixing them would change the existing charts.

Local changes, all for this repo's lint:
- Non-component exports moved from `*.tsx` into `*-shared.ts` siblings so each `.tsx` exports only components (react-refresh). Same split as `../charts/` (`chart-context.ts` / `chart-provider.tsx`).
- Ref writes during render moved into layout effects; the portal container starts as `null` and is set in effects.
- Unused type parameters and destructured props removed.
