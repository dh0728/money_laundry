# Figma implementation review

Updated: 2026-11-16. Editable design review artifact, not a new application release or design acceptance.

## Open the work

- [Latest review entry](https://www.figma.com/design/14dbGFblPyKdMQAg4lsKr9/AML-RADAR?node-id=63-3): `AML RADAR · 구현 검수 · 2026-11-16`, in the team AML RADAR project.
- [Application handoff and local run instructions](complete-bundle.md#실행과-상태-보존): `frontend/implementation/1.14.0/web-app` on `fe/work`. A localhost address works only while that machine's server is running; it is not a hosted preview.
- [Original design reference](https://www.figma.com/design/eHgUPAyr9bZ2UC7oTZNmwh) is preserved. The new review file does not silently replace the approved design source; no full design approval has been recorded.

## Work history

Newest first. This entry records the Figma worker's structural validation, not a fresh browser comparison by the documentation author.

| Date | Work | Artifact / verification | Remaining boundary |
| --- | --- | --- | --- |
| 2026-11-16 | Core functionality takes priority; login background decoration is optional only if time remains after core completion. | Current team lead direction. | No decoration requirement or implementation change added. |
| 2026-11-16 | Code-based editable screens, reusable components, variables, and prepared interaction states arranged for design review. | [Entry frame 63:3](https://www.figma.com/design/14dbGFblPyKdMQAg4lsKr9/AML-RADAR?node-id=63-3); 23 main flow screens and grouped supporting states. Structural report: 1,619 navigation actions, 218 distinct targets, 0 invalid targets; 0 reported top-level/section overlaps. | Actual prototype playback and browser visual fidelity remain unverified. This is not app code, deployment, API integration, or user acceptance. |

## Scope and source

React JSX and fixture outputs were used to construct native editable Figma frames, text, components/instances, variables, and Auto Layout. This was not screenshot reconstruction. Covered routes include login, shell, personal/team dashboards, rules/editor/backtest, Alert/Episode lists and detail tabs, ledger, verdict dialogs, reports, notifications, account, and settings. Prepared states include loading, empty, error, selection, validation, and sample success/failure outcomes.

The review file uses Inter intentionally. The code's declared font and its actual runtime font still need comparison; do not claim exact browser typography parity. Shared variables were resolved across 4 themes × 4 brands, but resolution is not a contrast or visual acceptance test. Some chart text retains scaled numeric typography values, so not every numeric property is token-bound.

Fixture data is synthetic. Domain values remain governed by `src/api/codes.ts`; the Figma copy is not a replacement data contract. Existing [per-screen data requirements](complete-bundle.md#화면figma출처필요-데이터) and [API needs](api.md) remain the backend handoff.

## Review loop

1. KMG opens the entry frame and directly edits layout, typography, components, and variables in the team review file.
2. When KMG says the changes are ready, inspect changed nodes, properties, variable bindings, and components, then apply the accepted changes to code. There is no automatic two-way synchronization.
3. Check the actual web app for text input/validation, persistence/API behavior, generated PDF files, and dynamic draggable/force-directed graphs. Prepared Figma transitions cannot prove these work.
4. Update the affected implementation rules/data requirements and version record with the exact artifact link, code revision, tests, and acceptance status. Design changes require KMG review; structural validation alone is not approval.

## Unverified checks

- Interactive Figma prototype replay was blocked by the cloud login wall; navigation structure was inspected instead.
- Browser fidelity and graph viewport fit were not verified; the attempted browser run hit an environment socket permission failure.
- Whole-file one-to-one correspondence of every code component has not been independently certified.
- Theme resolution and overlap checks do not certify all 16 visual combinations or accessibility.
- Real input, saved state, API operations, PDF generation, and graph physics must be tested in the actual app.
