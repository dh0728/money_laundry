# Preserved implementation design evidence

This is a code-backed record, not a copied private design document or a new design.

- `web-app/src/features/alerts/AlertDetail.tsx` and `episodes/EpisodeDetail.tsx` use `graph/timeline/TimeGraph.tsx` in mock mode.
- `TimeGraph.tsx` includes pattern/owner views, fixed account rows and a time axis; `PatternGraph.tsx` is a separate child view. Their recorded source lineage is 2026-10-12 commits 22fa227 and 0cdb468.
- `web-app/src/pages/LiveCasesPage.tsx` uses the separately preserved `graph/0.24.0` module. This preservation task does not change the selection.
- `web-app/ant-review.html` and investigation code are prior review material. Acceptance is not asserted. Sites SDS source is outside this bundle.
- Additional local design originals and QA evidence have not been integrated. Personal notes and meeting sources must remain outside the team bundle.
