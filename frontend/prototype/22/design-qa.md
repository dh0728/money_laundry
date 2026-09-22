# v22 Design QA

## Evidence

- Reference: `/var/folders/6_/fz58xlgx1r7_pk2vv35vsykm0000gn/T/TemporaryItems/NSIRD_screencaptureui_2o0z5Z/스크린샷 2026-09-22 09.36.17.png`
- Implementation: `http://127.0.0.1:5182/` (Codex in-app browser capture, 1280 × 720, light theme)
- Automated verification: 37 test files / 321 tests, TypeScript lint, production single-file build

## Comparison history

1. Initial v22 grouped the owner, account, and transaction hierarchy inside one shared table-like surface.
2. The reference FigJam communicates three distinct stages with explicit directional connections.
3. The implementation now uses three separately bordered panels and dedicated SVG connector columns. The selected owner branches to every matching account row, and the selected account branches to every visible transaction row; each orthogonal path terminates with an arrowhead aligned to its target row, matching the FigJam flow language.
4. Search focus was rechecked after removing the duplicate click opener and preventing Radix outside-interaction dismissal only when the event originated inside the search anchor. The `바로가기` panel remained open at 0ms, 100ms, and 500ms after one click.

## Required surfaces

- Fonts: existing product typography and mono treatment retained; no unintended fallback or clipping observed.
- Spacing/layout: distinct panel boundaries, consistent 12px inter-stage gaps, centered connectors, and the native bottom horizontal scrollbar remain legible at the narrow QA viewport.
- Colors: semantic foreground, muted foreground, border, accent, and selected-state tokens are preserved in both theme implementations; no primitive white selection ring remains on the account avatar.
- Image assets/icons: stage relationships are rendered as theme-aware inline SVG paths, endpoint dots, and arrowheads; no new raster asset or unsupported glyph was introduced.
- Copy: page title is `거래 내역`; panel labels and guidance explicitly identify `소유주`, `계좌`, and `거래`.
- Interaction: the global search quick links remain visible after click; owner/account selections drive the next panel; the viewport-bound native scrollbar remains directly draggable.

## Findings

- P0: none
- P1: none
- P2: none after fixes
- Horizontal-scroll regression: deleted the proxy scrollbar, reciprocal scroll listeners, `ResizeObserver`, and animation-frame synchronization. One viewport-bound native overflow container now owns both axes. The table data is memoized so TanStack Table no longer resets pagination on every unrelated render; the global pointer-tracking glow was also removed in favor of CSS-only hover/focus. Manual QA dragged the native scrollbar to `scrollLeft=895.5`, then opened the filter and changed the selected owner without a stall.
- Intentional difference: the FigJam is treated as an information-flow reference rather than a pixel specification. Runtime paths branch dynamically according to the selected owner/account and the currently visible result rows.

final result: passed
