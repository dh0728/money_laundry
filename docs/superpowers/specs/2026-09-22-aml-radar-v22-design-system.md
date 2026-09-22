# AML RADAR v22 Design System Consolidation

## Intent

AML RADAR v22 should behave like a single product governed by one design system, not a collection of individually styled screens. Updating a shared component or semantic token must update every instance that consumes it. The result must also be simpler and faster than the current prototype: native browser behavior first, deletion before abstraction, and no visual affordance that implies interaction when none exists.

## Success criteria

- Transactions uses one native overflow owner. The owner, account, and transaction stages grow to their content height and have no nested vertical scroll regions.
- Horizontal overflow remains directly draggable and wheel-scrollable without JavaScript synchronization.
- Only interactive elements receive hover/focus edge glow. Static cards, sections, headers, and layout surfaces never look clickable.
- Light and dark themes derive UI colors from semantic tokens; components do not select primitive colors directly.
- Product typography and motion timings/easings are named tokens rather than repeated arbitrary values.
- Repeated custom UI is rendered through one component definition. One-off UI remains local instead of being forced into a generic abstraction.
- Dead, legacy, fake, or unused UI and supporting code are removed.
- Existing explicitly requested behavior remains: selected-row contrast, sliding tab/sidebar indicators, RDR modes, responsive narrow-window behavior, keyboard focus, and reduced-motion support.

## Architecture

### 1. Foundations: one token source

`frontend/prototype/22/src/index.css` remains the single source of design tokens because Tailwind v4 and the shadcn components already consume CSS custom properties there. No new runtime theme library is introduced.

Tokens are grouped by purpose:

- Semantic color: background, foreground, surface, border, interactive states, selection, risk, positive, graph, login, and RDR artwork roles.
- Typography: display, title, body, caption, micro, mono, weights, line heights, and tracking where the product uses distinct roles.
- Motion: instant, fast, normal, morph, standard easing, emphasized easing, and continuous-flow duration.

Light and dark values live under `:root` and `.dark`. Tailwind-facing aliases remain in `@theme inline`. Raw color values may appear only in token definitions; TSX and component CSS consume semantic variables. Illustration-specific colors receive explicit role names such as `--radar-bezel-start` rather than leaking hex values into SVG JSX.

### 2. Components: consolidate only proven instances

Existing shared boundaries are retained and made authoritative:

- shadcn primitives in `components/ui`
- `PageHeading`, `DateRangeButton`, `FilterChip`, `IconButton`
- `DataTable`, `DataTableColumnHeader`, and pagination
- domain badges and formatting helpers

Proven duplication is consolidated:

- Transactions owner/account stages share one `StagePanel` and one `StageItem` definition; their content remains data-driven instances.
- Repeated dashboard work cards share one local `WorkCard` component.
- Manually recreated ghost icon buttons use the existing `IconButton`.
- Card-shaped static content uses the shadcn `Card` family where its structure matches; unique graph canvases and artwork remain purpose-built.

No component is created solely because two blocks look vaguely similar. If the props required to generalize a block exceed the duplicated markup, the block stays local.

### 3. Interaction semantics

The visual rule is explicit:

- Native `button`, link, input, select, textarea, Radix trigger, and an intentionally marked `[data-interactive=true]` surface may receive interactive hover/focus styling.
- Static `Card`, `.glass-surface`, section, table wrapper, graph layout, and page container never receive edge glow.
- `:focus-visible` remains for keyboard users even when hover glow is absent.
- Selected states use semantic selection tokens and preserve readable badge/link contrast in both themes.

No global pointer listener, geometry read, or per-frame inline style write is allowed for lighting.

### 4. Transactions scrolling and hierarchy

`transactions-explorer` is the only scrolling container for the three-stage flow. It owns horizontal and vertical overflow and is bounded by the available viewport height.

The owner and account stage bodies remove `max-height` and `overflow-y-auto`. Their panels use natural content height. The transaction stage follows the same vertical flow. The outer container exposes one native horizontal scrollbar at its bottom; there is no proxy scrollbar, scroll mirroring, `ResizeObserver`, or animation-frame synchronization.

The orthogonal owner → account → transaction connectors remain visual guidance. Their height follows the rendered flow rather than assuming a separately scrolled 610px stage.

### 5. Deletion-first cleanup

The following have no current product value and are removed rather than componentized:

- the unused legacy Transactions implementation and its duplicated filters/detail card
- unused advanced DataTable toolbar/filter/view modules and unused pinning/action-bar paths
- dead graph/drawer/pair/login CSS with no DOM consumers
- no-op RDR previous-conversation buttons and their supporting history layout state
- unused compatibility exports, aliases, and imports
- visual settings that only mutate isolated local state and have no consumer, unless a current test or user-visible workflow proves they are required

Removal is verified by repository-wide reference search before deletion.

### 6. Performance

- TanStack Table data and column inputs remain referentially stable between unrelated renders.
- No dual scroll owners or scroll event feedback loops.
- No global pointer-move visual effects.
- Expensive graph-derived data is memoized at its true input boundary.
- Login decoration renders statically and redraws only when its size changes; it does not run an all-pairs animation loop every frame.

### 7. Responsive and accessibility behavior

The service remains desktop-first but usable in narrow multi-window layouts. Wide information structures may overflow horizontally rather than collapsing into unreadable cards. Search retains a usable minimum width. Page landmarks are not nested. All interactive custom elements have native semantics or an accessible equivalent, and reduced-motion preferences disable nonessential transitions and animation.

## Verification

- Static tests enforce semantic token usage and reject primitive UI colors outside the token block.
- Component tests prove shared components render every intended instance.
- Transactions tests cover one scroll owner, no nested stage scrolling, scrollbar movement, post-scroll filter interaction, and owner/account/transaction selection.
- Interaction tests verify static surfaces have no hover glow while buttons retain hover and focus-visible feedback.
- Existing functional tests must pass in a single-worker deterministic run.
- TypeScript lint and the single-file production build must pass.
- Visual QA covers Dashboard, Transactions, Alerts, Episodes, detail tabs, flow detail, notifications, settings, account, login, and RDR in light/dark, narrow/wide, and tall viewport combinations.

## Non-goals

- Creating or modifying a Figma library file.
- Adding Storybook or another component-catalog dependency.
- Turning every one-off composition into a global component.
- Replacing shadcn primitives with custom equivalents.
- Adding mobile-specific navigation or a separate mobile product.
