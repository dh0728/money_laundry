# AML RADAR v22 Design System Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate AML RADAR v22 around semantic tokens and proven shared components while giving Transactions one native scroll owner, natural-height hierarchy panels, and interaction styling that never makes static content look clickable.

**Architecture:** Keep `src/index.css` as the only token source and keep shadcn primitives as the base layer. Add one small Transactions stage component because owner and account stages are genuine instances of the same pattern; keep one-off graph and page compositions local. Delete unused implementations and replace animation/event loops with native CSS or resize-driven rendering.

**Tech Stack:** React 19, TypeScript 6, Tailwind CSS 4, shadcn/Radix UI, TanStack Table 8, Recharts, Vitest 4, Vite 8

**Spec:** `docs/superpowers/specs/2026-09-22-aml-radar-v22-design-system.md`

## Global Constraints

- Do not add a package, runtime theme library, Storybook, or Figma-writing workflow.
- Raw visual color values live only in the semantic token declarations in `src/index.css`; app components consume CSS variables or semantic Tailwind aliases.
- Preserve sliding tab and sidebar indicators, RDR dock/float modes, selected-row readability, keyboard focus, reduced motion, and narrow multi-window behavior.
- Transactions has exactly one horizontal/vertical overflow owner and no mirrored or proxy scrollbar JavaScript.
- Static sections, cards, headers, tables, graph canvases, and layout surfaces cannot receive hover edge glow.
- Every task follows red-green-refactor and ends in a focused commit.
- Run Vitest with `--maxWorkers=1`; the existing heavy single-file prototype imports are nondeterministic under parallel worker pressure.

## Review Focus

- A selected destructive/direction badge on a light selected row must retain readable foreground and border colors in both themes; Task 2 adds the selected-row contrast test.
- A 720px-wide multi-window viewport must keep search usable and make wide hierarchy content horizontally scrollable instead of shrinking it into unreadable columns; Task 3 adds the narrow-layout contract test.
- Hundreds of owners with one account each must produce one document flow with no nested wheel trap; Task 3 checks the DOM and native scroll owner.
- Updating `notifications:read` from the notification page must immediately update the header badge mounted elsewhere; Task 5 adds the same-key subscriber test.
- Reduced-motion users must see stable tab/sidebar state and no continuously animated login network; Tasks 1 and 5 add token and static-render checks.

---

### Task 1: Semantic Color, Typography, and Motion Foundations

**Files:**
- Create: `frontend/prototype/22/src/design-system-contract.test.ts`
- Modify: `frontend/prototype/22/src/index.css:6-140`
- Modify: `frontend/prototype/22/src/Agent.tsx:237-290`
- Modify: `frontend/prototype/22/src/Graph.tsx:42`
- Modify: `frontend/prototype/22/src/shared.tsx:117-136`
- Modify: `frontend/prototype/22/src/components/ui/slider.tsx:55`

**Interfaces:**
- Consumes: existing shadcn semantic variables such as `--background`, `--foreground`, `--primary`, and `--destructive`.
- Produces: CSS variables `--text-display-size`, `--text-title-size`, `--text-body-size`, `--text-caption-size`, `--text-micro-size`, `--motion-instant`, `--motion-fast`, `--motion-normal`, `--motion-morph`, `--ease-standard`, `--ease-emphasized`, `--interactive-edge-glow`, `--radar-core-hot`, `--radar-core-deep`, `--radar-bezel-light`, `--radar-bezel-mid`, `--radar-bezel-dark`, `--radar-disc`, and `--selection-fill`.

- [ ] **Step 1: Add a failing token contract test**

```ts
// src/design-system-contract.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('design-system contract', () => {
  it('declares semantic type, motion, interaction, and radar tokens', () => {
    for (const token of [
      '--text-display-size', '--text-title-size', '--text-body-size', '--text-caption-size', '--text-micro-size',
      '--motion-instant', '--motion-fast', '--motion-normal', '--motion-morph', '--ease-standard', '--ease-emphasized',
      '--interactive-edge-glow', '--radar-core-hot', '--radar-core-deep', '--radar-bezel-light', '--radar-bezel-mid', '--radar-bezel-dark', '--radar-disc',
    ]) expect(css).toContain(token)
  })

  it('keeps raw hex colors out of app-owned TSX', () => {
    for (const file of ['Agent.tsx', 'App.tsx', 'Dashboard.tsx', 'Detail.tsx', 'FlowDetail.tsx', 'Graph.tsx', 'Lists.tsx', 'LoginNetwork.tsx', 'shared.tsx', 'TransactionsV22.tsx', 'UtilityPages.tsx']) {
      expect(source(file), file).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })

  it('uses named motion tokens for product indicators', () => {
    expect(css).toMatch(/\.tab-indicator[^}]*var\(--motion-morph\)/s)
    expect(css).toMatch(/\.sidebar-indicator[^}]*var\(--motion-morph\)/s)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/design-system-contract.test.ts`

Expected: FAIL because the named typography, motion, glow, and radar tokens do not exist and `Agent.tsx` contains raw hex values.

- [ ] **Step 3: Define the semantic foundations once**

Add these declarations to both theme token blocks where color differs and once to the shared `:root` block where it does not:

```css
:root {
  --text-display-size: 1.875rem;
  --text-title-size: 1.25rem;
  --text-body-size: .875rem;
  --text-caption-size: .75rem;
  --text-micro-size: .6875rem;
  --motion-instant: 0ms;
  --motion-fast: 120ms;
  --motion-normal: 180ms;
  --motion-morph: 200ms;
  --ease-standard: cubic-bezier(.2, .8, .2, 1);
  --ease-emphasized: cubic-bezier(.16, 1, .3, 1);
  --interactive-edge-glow: 0 0 0 1px color-mix(in oklch, var(--destructive) 38%, transparent), 0 0 16px color-mix(in oklch, var(--destructive) 18%, transparent);
  --selection-fill: var(--selection-background);
  --radar-core-hot: #ff8189;
  --radar-core-deep: #38050a;
  --radar-bezel-light: #55555e;
  --radar-bezel-mid: #0a0a0c;
  --radar-bezel-dark: #2e2e35;
  --radar-disc: #08080a;
}
```

Replace product motion literals with variables:

```css
.tab-indicator,
.sidebar-indicator {
  transition-duration: var(--motion-morph);
  transition-timing-function: var(--ease-standard);
}
```

Replace Agent SVG stop/fill/stroke literals with `var(--radar-*)`; replace `Graph.tsx`'s `'#888'` fallback with `getComputedStyle(document.documentElement).color || 'currentColor'`; replace `text-white`, `bg-white`, and direct selection colors in app code with `text-selection-destructive-foreground`, `bg-background`, or the matching semantic variable exposed through `@theme inline`.

- [ ] **Step 4: Re-run the token contract and type-check**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/design-system-contract.test.ts && npm run lint`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 5: Commit the foundation**

```bash
git add frontend/prototype/22/src/design-system-contract.test.ts frontend/prototype/22/src/index.css frontend/prototype/22/src/Agent.tsx frontend/prototype/22/src/Graph.tsx frontend/prototype/22/src/shared.tsx frontend/prototype/22/src/components/ui/slider.tsx
git commit -m "refactor(v22): centralize semantic design tokens"
```

### Task 2: Interactive-Only Edge Glow and Selected-State Contrast

**Files:**
- Modify: `frontend/prototype/22/src/index.css:330-380`
- Modify: `frontend/prototype/22/src/components/ui/card.tsx`
- Modify: `frontend/prototype/22/src/components/data-table/data-table.tsx`
- Modify: `frontend/prototype/22/src/v24-polish.test.tsx`
- Modify: `frontend/prototype/22/src/v15b-color.test.ts`

**Interfaces:**
- Consumes: `--interactive-edge-glow`, selection tokens, native interactive HTML, and `[data-interactive="true"]`.
- Produces: one CSS contract in which only actionable elements glow; static surface components require no opt-out attribute.

- [ ] **Step 1: Tighten the interaction contract tests before CSS changes**

Add these assertions to `v24-polish.test.tsx`:

```ts
it('limits edge glow to actionable elements', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  expect(css).toMatch(/:is\([^}]*button[^}]*a\[href\][^}]*\[data-interactive=["']true["']\)[^{]*:is\(:hover,\s*:focus-visible\)/s)
  expect(css).not.toMatch(/:is\([^}]*\[data-slot=["']card["'][^}]*\.glass-surface[^}]*\)[^{]*:is\(:hover,\s*:focus-within\)/s)
  expect(css).not.toContain('[data-shine="surface"]')
})

it('keeps selected table content semantic in both themes', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  expect(css).toContain('[data-state=selected]')
  expect(css).toContain('var(--selection-foreground)')
  expect(css).toContain('var(--selection-destructive-foreground)')
})
```

- [ ] **Step 2: Run both color/interaction files and confirm the new assertion fails**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/v24-polish.test.tsx src/v15b-color.test.ts`

Expected: FAIL because static Card, `.work-card`, `.notification-card`, `.glass-surface`, and graph surfaces still share a hover/focus-within glow selector.

- [ ] **Step 3: Replace opt-out styling with positive interaction semantics**

Delete the static-surface hover selector and use one positive selector:

```css
:is(button, a[href], input, select, textarea, [data-interactive="true"]):not([data-variant="link"]):not([role="tab"]):is(:hover, :focus-visible):not(:disabled) {
  box-shadow: var(--interactive-edge-glow);
}

:is(button, a[href], input, select, textarea, [data-interactive="true"]):focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

```

Remove `data-shine="off"` and `.shine` from static JSX because static content now has no glow by default. Preserve each component's ordinary static shadow; only hover/focus edge-glow rules are removed from non-interactive surfaces. Keep selected table text, links, outline badges, and destructive badges mapped to `--selection-*` semantic variables rather than fixed white/black.

- [ ] **Step 4: Run focused tests and inspect keyboard semantics**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/v24-polish.test.tsx src/v15b-color.test.ts src/v17-table.test.tsx`

Expected: PASS; table rows still activate on Enter only when the row itself owns the event.

- [ ] **Step 5: Commit the interaction contract**

```bash
git add frontend/prototype/22/src/index.css frontend/prototype/22/src/components/ui/card.tsx frontend/prototype/22/src/components/data-table/data-table.tsx frontend/prototype/22/src/v24-polish.test.tsx frontend/prototype/22/src/v15b-color.test.ts
git commit -m "fix(v22): reserve edge glow for interactive controls"
```

### Task 3: Natural-Height Transactions Flow with One Native Scroll Owner

**Files:**
- Create: `frontend/prototype/22/src/components/transaction-stage.tsx`
- Modify: `frontend/prototype/22/src/TransactionsV22.tsx:71-200`
- Modify: `frontend/prototype/22/src/index.css:114-121,365-371`
- Modify: `frontend/prototype/22/src/v22-layout.test.tsx`
- Modify: `frontend/prototype/22/src/v21-transactions.test.tsx`

**Interfaces:**
- Produces: `StagePanel({ title, count, description, children, testId })` and `StageItem({ active, primary, secondary, mono, onSelect })`.
- Produces: `OrthogonalConnector({ id, sourceIndex, targetCount, targetOffset })` using CSS-positioned orthogonal paths and no measurement loop.
- Consumes: stable `visibleOwners`, `ownerAccounts`, `transactionRows`, and existing selection callbacks from `TransactionsV22`.

- [ ] **Step 1: Add failing hierarchy and overflow tests**

Add to `v22-layout.test.tsx`:

```ts
it('uses one native overflow owner and natural-height stages', () => {
  const source = readFileSync(new URL('./TransactionsV22.tsx', import.meta.url), 'utf8')
  expect(source.match(/overflow-auto/g)).toHaveLength(1)
  expect(source).not.toContain('max-h-[610px]')
  expect(source).not.toContain('overflow-y-auto')
  expect(source).not.toContain('const height = 610')
  expect(source).toContain('StagePanel')
  expect(source).toContain('OrthogonalConnector')
})

it('keeps compact hierarchy columns and a wide transaction stage', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  expect(css).toContain('--owner-stage-width: 13.5rem')
  expect(css).toContain('--account-stage-width: 14.5rem')
  expect(css).toContain('min-width: 180px')
})
```

Add a rendered assertion to `v21-transactions.test.tsx`:

```tsx
it('renders every hierarchy stage in one document flow', () => {
  const html = renderToStaticMarkup(<Transactions records={records} />)
  expect(html).toContain('data-testid="transactions-explorer"')
  expect(html).toContain('data-testid="owner-section"')
  expect(html).toContain('data-testid="account-section"')
  expect(html).toContain('data-testid="transaction-section"')
  expect(html).not.toContain('max-h-[610px]')
})
```

- [ ] **Step 2: Run the two focused files and confirm failure**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/v22-layout.test.tsx src/v21-transactions.test.tsx`

Expected: FAIL on nested stage scroll, fixed 610px connector height, and missing shared stage components.

- [ ] **Step 3: Extract the two proven hierarchy components**

Create `components/transaction-stage.tsx` with this public shape:

```tsx
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

export function StagePanel({ title, count, description, testId, children }: {
  title: string; count: number; description: string; testId: string; children: ReactNode
}) {
  return <section data-testid={testId} className="transaction-stage min-w-0 self-start overflow-hidden rounded-xl border bg-card">
    <header className="border-b px-4 py-3">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{title}</h2><Badge variant="secondary">{count}</Badge></div>
      <p className="mt-1 text-[var(--text-micro-size)] text-muted-foreground">{description}</p>
    </header>
    <div className="p-2">{children}</div>
  </section>
}

export function StageItem({ active, primary, secondary, mono = false, onSelect }: {
  active: boolean; primary: string; secondary: string; mono?: boolean; onSelect: () => void
}) {
  return <button type="button" aria-pressed={active} onClick={onSelect} className="transaction-stage-item w-full rounded-lg px-3 py-3 text-left hover:bg-muted/60 aria-pressed:bg-accent aria-pressed:text-accent-foreground">
    <span className={mono ? 'block font-mono text-sm' : 'block truncate text-sm font-medium'}>{primary}</span>
    <span className="mt-1 block text-[var(--text-micro-size)] text-muted-foreground">{secondary}</span>
  </button>
}
```

- [ ] **Step 4: Make the connector height follow the grid instead of a fixed panel**

Replace the SVG `StageConnector` with CSS-positioned `OrthogonalConnector`. Its wrapper stretches with the tallest grid item; each edge uses custom properties calculated from the stable 64px stage-row rhythm:

```tsx
function OrthogonalConnector({ id, sourceIndex, targetCount, targetOffset }: {
  id: string; sourceIndex: number; targetCount: number; targetOffset: number
}) {
  const sourceY = 69 + 32 + Math.max(0, sourceIndex) * 64
  return <div data-testid={id} aria-hidden className="transaction-connector self-stretch">
    {Array.from({ length: Math.min(targetCount, 20) }, (_, index) => {
      const targetY = targetOffset + index * 64
      return <i key={index} className="transaction-connector-edge" style={{ '--source-y': `${sourceY}px`, '--target-y': `${targetY}px` } as React.CSSProperties} />
    })}
  </div>
}
```

Use absolutely positioned horizontal segments, one vertical segment, and a CSS border arrowhead. Do not add `ResizeObserver`, `scroll` listeners, or animation frames.

- [ ] **Step 5: Use compact stage columns and one native overflow container**

```css
:root {
  --owner-stage-width: 13.5rem;
  --account-stage-width: 14.5rem;
}
.transactions-flow {
  grid-template-columns: var(--owner-stage-width) 2.75rem var(--account-stage-width) 2.75rem minmax(72.25rem, 1fr);
  min-width: calc(var(--owner-stage-width) + var(--account-stage-width) + 77.75rem);
}
.header-search-input { min-width: 180px; }
```

Render owner/account stage contents without `max-height` or `overflow-y-auto`. Keep `transactions-explorer` as `max-h-[calc(100dvh-220px)] overflow-auto`, retain its visible native scrollbar styling, and keep the table at `min-w-[1156px]`.

- [ ] **Step 6: Verify native scrolling and selection in a browser test pass**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/v22-layout.test.tsx src/v21-transactions.test.tsx src/v21-pagination.test.tsx && npm run lint`

Expected: PASS. In the browser, set `scrollLeft` through the native element, click a different owner, and confirm `scrollLeft` remains controllable and filter/selection clicks respond immediately.

- [ ] **Step 7: Commit the Transactions flow**

```bash
git add frontend/prototype/22/src/components/transaction-stage.tsx frontend/prototype/22/src/TransactionsV22.tsx frontend/prototype/22/src/index.css frontend/prototype/22/src/v22-layout.test.tsx frontend/prototype/22/src/v21-transactions.test.tsx
git commit -m "refactor(v22): use one natural-height transactions flow"
```

### Task 4: Consolidate Proven Components and Delete Unused Implementations

**Files:**
- Modify: `frontend/prototype/22/src/Dashboard.tsx:12-67,180-192`
- Modify: `frontend/prototype/22/src/FlowDetail.tsx:178-183`
- Modify: `frontend/prototype/22/src/UtilityPages.tsx:24-100`
- Replace: `frontend/prototype/22/src/Transactions.tsx`
- Modify: `frontend/prototype/22/src/components/data-table/data-table.tsx`
- Delete: `frontend/prototype/22/src/components/data-table/data-table-date-filter.tsx`
- Delete: `frontend/prototype/22/src/components/data-table/data-table-faceted-filter.tsx`
- Delete: `frontend/prototype/22/src/components/data-table/data-table-slider-filter.tsx`
- Delete: `frontend/prototype/22/src/components/data-table/data-table-toolbar.tsx`
- Delete: `frontend/prototype/22/src/components/data-table/data-table-view-options.tsx`
- Modify: `frontend/prototype/22/src/Lists.tsx:53-110`
- Modify: `frontend/prototype/22/src/index.css` to remove selectors whose class or data attribute has no remaining JSX consumer
- Modify: `frontend/prototype/22/src/v21-dashboard.test.tsx`
- Modify: `frontend/prototype/22/src/v22-layout.test.tsx`

**Interfaces:**
- Produces: local `WorkCard({ record, onOpen, meta })` in `Dashboard.tsx`; it is intentionally not a global component.
- Consumes: existing `IconButton`, `TransactionsV22`, `DataTable`, `DataTablePagination`, shadcn `Card`, and the existing two-column `settings-grid` contract.

- [ ] **Step 1: Add failing source-structure assertions**

```ts
it('has one transactions implementation and one dashboard work-card definition', () => {
  const transactions = readFileSync(new URL('./Transactions.tsx', import.meta.url), 'utf8')
  const dashboard = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8')
  expect(transactions.trim()).toBe("export { default } from './TransactionsV22'")
  expect(dashboard.match(/function WorkCard/g)).toHaveLength(1)
  expect(dashboard.match(/<WorkCard/g)?.length).toBeGreaterThanOrEqual(2)
})
```

Add to `v22-layout.test.tsx`:

```ts
it('keeps settings at two columns and uses shared icon controls', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  const flow = readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')
  expect(css).toMatch(/\.settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s)
  expect(flow).toContain('<IconButton label="축소"')
  expect(flow).toContain('<IconButton label="확대"')
})
```

Add a pagination reset assertion for removing a Lists filter chip:

```ts
it('returns to the first page when a filter chip is removed', () => {
  const source = readFileSync(new URL('./Lists.tsx', import.meta.url), 'utf8')
  expect(source).toMatch(/onRemove=\{\(\) => \{\s*setFilters\([^}]+toFirst\(\)/s)
})
```

- [ ] **Step 2: Run focused structure tests and confirm failure**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/v21-dashboard.test.tsx src/v22-layout.test.tsx`

Expected: FAIL because `Transactions.tsx` still contains the legacy implementation and Dashboard repeats full work-card markup.

- [ ] **Step 3: Consolidate only real repeated patterns**

Create one local Dashboard `WorkCard` with a required click callback and render it for both “먼저 확인할 업무” and “최근 내 활동”. Reuse `IconButton` for icon-only FlowDetail/Agent controls. Keep Settings at two columns with:

```css
.settings-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 760px) { .settings-grid { grid-template-columns: 1fr; } }
```

Do not introduce a global page-card abstraction.

- [ ] **Step 4: Delete legacy and unreachable DataTable code**

Replace all of `Transactions.tsx` with:

```ts
export { default } from './TransactionsV22'
```

Before deleting the advanced DataTable view cluster, run:

`cd frontend/prototype/22 && rg -n "DataTable(Date|Faceted|Slider|Toolbar|View)" src --glob '!components/data-table/data-table-*.tsx'`

Expected before cleanup: no live screen references the toolbar/filter/view cluster. Keep `useDataTable`, parsers, query config, pinning styles, and their hooks because `Lists.tsx` still consumes them. Remove only unused `actionBar` and `children` from `DataTableProps`, then delete the five orphaned view files listed above. Run the same search again; expected result is empty.

Change filter-chip removal to reset pagination in the same event:

```tsx
<FilterChip onRemove={() => { setFilters(previous => previous.filter((_, current) => current !== index)); toFirst() }}>
  {chipLabel(filter)}
</FilterChip>
```

Search each candidate dead selector from `index.css` with `rg` across `src`; remove only selectors with no JSX/TS consumer. Do not remove sliding-indicator, graph, RDR, selected-row, or reduced-motion rules.

- [ ] **Step 5: Run compile and focused regressions**

Run: `cd frontend/prototype/22 && npm run lint && npm test -- --maxWorkers=1 src/v21-dashboard.test.tsx src/v21-transactions.test.tsx src/v22-layout.test.tsx src/v17-detail.test.tsx`

Expected: PASS with no unresolved imports.

- [ ] **Step 6: Commit the consolidation**

```bash
git add -A frontend/prototype/22/src
git commit -m "refactor(v22): consolidate shared UI and remove dead paths"
```

### Task 5: Remove Render Loops and Make Shared Prototype State Observable

**Files:**
- Modify: `frontend/prototype/22/src/LoginNetwork.tsx`
- Modify: `frontend/prototype/22/src/Agent.tsx`
- Modify: `frontend/prototype/22/src/FlowDetail.tsx:204-230`
- Modify: `frontend/prototype/22/src/Graph.tsx`
- Modify: `frontend/prototype/22/src/memory.ts`
- Modify: `frontend/prototype/22/src/App.tsx`
- Modify: `frontend/prototype/22/src/components/ui/sidebar.tsx`
- Modify: `frontend/prototype/22/src/UtilityPages.tsx:24-38,109-113`
- Create: `frontend/prototype/22/src/memory.test.ts`
- Modify: `frontend/prototype/22/src/v21-agent-stability.test.tsx`
- Modify: `frontend/prototype/22/src/v17-shell.test.tsx`

**Interfaces:**
- Produces: `memorySnapshot<T>(key, initial)`, `writeMemory<T>(key, value)`, `subscribeMemory(key, listener)`, and `useMemoryState<T>(key, initial)` with the existing hook setter signature.
- Produces: `LoginNetwork` that redraws on initial mount, theme change, and container resize only.
- Consumes: `readPanelBounds`, the current Agent/FlowPanel geometry normalizers, `prefers-reduced-motion`, and existing sidebar public props.

- [ ] **Step 1: Add failing state and render-loop tests**

```ts
// src/memory.test.ts
import { describe, expect, it, vi } from 'vitest'
import { memorySnapshot, subscribeMemory, writeMemory } from './memory'

it('notifies every subscriber of the same memory key', () => {
  const first = vi.fn(), second = vi.fn()
  const stopFirst = subscribeMemory('shared-test-key', first)
  const stopSecond = subscribeMemory('shared-test-key', second)

  writeMemory('shared-test-key', 7)

  expect(memorySnapshot('shared-test-key', 0)).toBe(7)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  stopFirst(); stopSecond()
})
```

Add source assertions:

```ts
expect(readFileSync(new URL('./LoginNetwork.tsx', import.meta.url), 'utf8')).not.toContain("addEventListener('pointermove'")
expect(readFileSync(new URL('./LoginNetwork.tsx', import.meta.url), 'utf8')).not.toContain('requestAnimationFrame(draw)')
expect(readFileSync(new URL('./components/ui/sidebar.tsx', import.meta.url), 'utf8')).toContain('<div data-slot="sidebar-inset"')
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/memory.test.ts src/v21-agent-stability.test.tsx src/v17-shell.test.tsx`

Expected: FAIL because same-key memory consumers are isolated, LoginNetwork follows pointer animation frames, and SidebarInset renders a nested `<main>`.

- [ ] **Step 3: Replace in-memory isolation with a tiny keyed subscription**

```ts
const memory = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()

export const memorySnapshot = <T,>(key: string, initial: T): T => memory.has(key) ? memory.get(key) as T : initial

export const subscribeMemory = (key: string, listener: () => void) => {
  const group = listeners.get(key) ?? new Set()
  group.add(listener); listeners.set(key, group)
  return () => { group.delete(listener); if (!group.size) listeners.delete(key) }
}

export const writeMemory = <T,>(key: string, value: T) => {
  memory.set(key, value)
  listeners.get(key)?.forEach(listener => listener())
}
```

Implement `useMemoryState` with `useSyncExternalStore`, a `useRef(initial)` fallback, `memorySnapshot`, and `subscribeMemory`. Resolve functional setters against the current snapshot and call `writeMemory` exactly once. This keeps the current call sites unchanged and fixes header badge synchronization at the shared root.

- [ ] **Step 4: Remove continuous decoration work and unnecessary layout work**

In `LoginNetwork`, draw once on mount/theme and in a `ResizeObserver` callback; remove pointer listeners and the recursive animation frame. In Agent, remove no-op previous-conversation buttons and their history/layout state. In `FlowPanel`, merge the duplicate no-dependency layout effects into one resize observer plus one initial clamp. In Graph, memoize the node-key → connected-edge lookup from `model.edges` and read it during drawing instead of scanning all edges per node per frame.

- [ ] **Step 5: Fix landmarks and object URL lifetime**

Make `SidebarInset` render `<div data-slot="sidebar-inset">` and keep the single page landmark in `App.tsx` as `<main className="app-main">`. Replace unscoped responsive `main { ... }` CSS with `.app-main { ... }`. In Account, revoke the previous `URL.createObjectURL` in an effect cleanup whenever the selected image changes.

- [ ] **Step 6: Run focused behavior and performance-contract tests**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 src/memory.test.ts src/v21-agent-stability.test.tsx src/v17-shell.test.tsx src/v18-agent.test.tsx src/v19-graph.test.tsx && npm run lint`

Expected: PASS, one `<main>` landmark, no recursive decorative animation, and immediate same-key state updates.

- [ ] **Step 7: Commit the root-cause fixes**

```bash
git add frontend/prototype/22/src/LoginNetwork.tsx frontend/prototype/22/src/Agent.tsx frontend/prototype/22/src/FlowDetail.tsx frontend/prototype/22/src/Graph.tsx frontend/prototype/22/src/memory.ts frontend/prototype/22/src/memory.test.ts frontend/prototype/22/src/App.tsx frontend/prototype/22/src/components/ui/sidebar.tsx frontend/prototype/22/src/UtilityPages.tsx frontend/prototype/22/src/v21-agent-stability.test.tsx frontend/prototype/22/src/v17-shell.test.tsx
git commit -m "fix(v22): remove render loops and synchronize shared state"
```

### Task 6: Whole-Product Regression and Visual QA

**Files:**
- Modify: `frontend/prototype/22/design-qa.md`
- Modify: `frontend/prototype/22/README.md`
- Generated by build: `frontend/prototype/22/AML-RADAR-v22.html`

**Interfaces:**
- Consumes: all components and token contracts from Tasks 1–5.
- Produces: verified standalone `AML-RADAR-v22.html` and a dated QA matrix with evidence for every required page/theme/viewport combination.

- [ ] **Step 1: Run the complete deterministic test suite**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1`

Expected: all test files and all tests PASS; record the exact counts in `design-qa.md`.

- [ ] **Step 2: Run type-check and the single-file production build**

Run: `cd frontend/prototype/22 && npm run lint && npm run build`

Expected: both commands exit 0 and `AML-RADAR-v22.html` is refreshed by `postbuild`.

- [ ] **Step 3: Perform the wide and narrow interaction matrix**

Use viewport pairs `1440×900` and `720×1100` in both `.dark` and light theme. For Dashboard, Transactions, Alerts, Episodes, Notifications, Settings, Account, login, alert detail tabs, flow detail, and RDR:

1. Navigate with pointer and keyboard.
2. Confirm only buttons/links/inputs glow.
3. Confirm tab and sidebar indicators slide and honor reduced motion.
4. In Transactions, drag the native horizontal thumb, wheel horizontally, change owner/account, open Filter, select/deselect the same row, and follow Alert/Episode links.
5. In the tall viewport, scroll from page top to bottom and confirm there is no nested owner/account wheel trap.
6. Dock/float/close RDR and FlowDetail and confirm geometry stays inside header/sidebar/content bounds.

- [ ] **Step 4: Record concrete visual evidence**

Append a table to `design-qa.md` with columns `화면`, `테마`, `뷰포트`, `검증`, `결과`. Every matrix row records PASS or the exact defect fixed during this task. Add the test count, build result, and final file timestamp. Update README with the native-scroll and interactive-only glow rules so future edits preserve them.

- [ ] **Step 5: Re-run verification after any QA correction**

Run: `cd frontend/prototype/22 && npm test -- --maxWorkers=1 && npm run build`

Expected: the final run is green after the last visual correction; do not rely on a run performed before the correction.

- [ ] **Step 6: Commit the verified artifact**

```bash
git add frontend/prototype/22
git commit -m "feat(v22): finalize design-system prototype"
```

- [ ] **Step 7: Review the complete branch before sharing**

Run: `git diff --check HEAD~6..HEAD && git status --short && git log --oneline -7`

Expected: no whitespace errors; only intentionally generated/untracked files remain; six focused implementation commits follow the design-spec commit.
