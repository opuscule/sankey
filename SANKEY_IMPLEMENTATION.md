# Sankey Implementation Overview

A reference file for new chat sessions. Covers architecture, dependencies, key idioms, and known quirks.

---

## Project at a Glance

A static single-page interactive data visualisation showing global greenhouse gas emissions (54 GT CO2e, 2025). No build tooling. No framework. The entire runtime is three files:

| File | Role |
|---|---|
| `index.html` | Page structure, inline hero animations, CDN script tags |
| `styles.css` | All layout and visual styles (single `<style>` block inside the `<head>`) |
| `main.js` | Sankey data loading, layout, scroll animation, and interaction |

Data is loaded at runtime from `init.json` (node metadata) and `baselines.json` (scenario flow values) in the repo root.

---

## Dependencies (CDN, no install)

All loaded via `<script>` tags at the bottom of `index.html`:

| Library | Version | Purpose |
|---|---|---|
| GSAP | 3.12.7 | Hero scroll animations, Sankey scroll scrubbing |
| GSAP ScrollTrigger | 3.12.7 | Scroll-driven animation triggers and scrub |
| D3 | 7.9.0 | Data parsing, SVG rendering, layout math |
| d3-sankey | 0.12.3 | Sankey node/link layout algorithm |

`gsap.registerPlugin(ScrollTrigger)` is called inline in `index.html` before `main.js` runs.

---

## Page Structure

```
#hero-intro           — Full-screen hero (globe, logo, headline)
  .hero-stage         — Pinned scroll stage for hero animation
  .hero-copy-2        — Scrolling copy block 1
  .hero-copy-3        — Scrolling copy block 2

#intro-anchor         — Zero-height scroll anchor

#app (main)
  #sankey-narrative   — Two-column narrative + Sankey section
    .sankey-layout    — CSS grid: 30% copy | 65% chart
      .sankey-copy    — Left column: four scroll-paced snippets
        #snippet-1..4   Narrative paragraphs (~92vh min-height each)
      #full-sankey    — Right column: sticky chart container (100vh)
        .sankey-shell
          #sankey-status  — Status text (hidden in production)
          #sankey-chart   — SVG target for D3
```

---

## Sankey Chart: How It Works

### Data pipeline

1. `loadAndRender()` fetches `init.json` and `baselines.json`, then passes both to `buildGraph()`.
2. `buildGraph()` creates node/link objects from JSON contracts:
  - node stage/order/group/description come from `init.nodes.nodes[]`
  - link values come from `baselines.links[]` under the active scenario key (default `2025`)
3. Each link carries `value`, `energy`, `process`, and `afolu` fields from `baselines.links[][scenario]`.

### Two layouts computed at render time

`render()` computes both layouts once on every call (including on resize):

- **Expanded layout** — `d3.sankey()` with `nodePadding: 9`, `nodeWidth: 20`, `sankeyJustify` alignment. This is the final state.
- **Packed (collapsed) layout** — derived from the expanded layout via `derivePackedLayout()`. Nodes in each stage column are stacked with zero gap, preserving the same vertical ordering as expanded to prevent link crossovers during the morph.

Both layouts are stored in Maps (`nodeStartMap`/`nodeEndMap`, `linkStartMap`/`linkEndMap`) keyed by ID. `drawLayout(progress)` lerps between them on every animation frame.

### Morph animation

`drawLayout(progress)` receives a value `0→1` and:
- Interpolates every node's `x0, x1, y0, y1` between packed and expanded.
- Interpolates every link's path and stroke width.
- Fades in link opacity starting at progress `0.06` over a `0.3` span.
- Fades in node label opacity starting at progress `0.16` over a `0.28` span.
- Enables click interaction when `progress >= 0.999`.

### Scroll binding

Uses `ScrollTrigger.matchMedia()` to branch by breakpoint:

- **Desktop (min-width: 901px)**: A GSAP tween scrubs `motionState.progress` from `0→1`. A `ScrollTrigger.create()` on `#sankey-narrative` (`start: "top top"`, `end: "bottom bottom"`, `scrub: true`) drives the tween. `#full-sankey` is CSS-sticky (`position: sticky; top: 0; height: 100vh`) so the chart stays centered while left-column snippets scroll past.
- **Mobile (max-width: 900px)**: `drawLayout(1)` and `setSankeyInteraction(true)` are called immediately — no scroll morph, fully expanded state shown at once.
- **`prefers-reduced-motion`**: Same as mobile — immediately jumps to fully expanded state.

### SVG gradients

For every unique source-stage→target-stage pair in the data, a horizontal `<linearGradient>` is created in SVG `<defs>`. Gradient IDs follow the pattern `link-gradient-{sourceStage}-{targetStage}`. Link strokes reference these gradients. Stop opacity is `0.3` so links render as semi-transparent.

### Link and node CSS classes

Links (`<path class="sankey-link ...">`) receive semantic classes:
- `stage-{s}-{t}` — combined source/target stage
- `link-stage-{s}-{t}` — same, alternate prefix
- `link-from-{nodeSlug}` — slug of source node
- `link-to-{nodeSlug}` — slug of target node
- `link-{fromSlug}-to-{toSlug}` — full pair

This lets CSS (or future JS) target specific flows precisely.

### Node interaction

Clicking a node:
- Sets `state.selectedNodeId`.
- `applySelection()` adds `is-active` to directly connected links and `is-faded` to all others. Adds `is-selected` to the clicked node rect and `is-faded` to unconnected nodes.
- Clicking background resets selection.
- All clicks are no-ops while `state.sankeyInteractive === false` (during morph).

### Resize handling

`setupResize()` attaches a `ResizeObserver` to `#sankey-chart` and a `window resize` listener. Both schedule a `requestAnimationFrame` debounce that calls `render()` fresh (recomputes both layouts, rebuilds SVG, rebinds scroll trigger).

---

## Responsive Breakpoints

| Breakpoint | Behaviour |
|---|---|
| `min-width: 901px` | Two-column layout; scroll morph active; `#full-sankey` sticky |
| `max-width: 900px` | Single column (stacked); no scroll morph; `#full-sankey` relative, auto-height |

---

## Hero Animations (inline in `index.html`)

Separate from `main.js`. Uses GSAP timeline + ScrollTrigger:
- Load timeline: globe scale-in, logo slide, headline fade.
- Scroll timeline: globe moves up and fades, headline parallaxes, subtitle fades in then scrolls out.
- A global `--page-bg-shift` CSS custom property is animated via GSAP to slowly drift the starfield background image as the user scrolls the whole page.

---

## Key Idioms and Gotchas

- **`main.js` is an IIFE** — everything is scoped inside `(function () { ... })()`. No globals exported.
- **Stage number is sourced from JSON node metadata** — `init.nodes.nodes[].layer` is the primary source. Stage can still be derived from `{stage}_{Label}` IDs as a fallback for malformed metadata.
- **Both layouts are recomputed on every resize** — intentional; avoids stale geometry on narrow→wide transitions.
- **`linkPaths` vs `linkSelection`** — The D3 selection of `<path>` elements is stored as `linkPaths` inside `render()` and as `linkSelection` on `state.rendered`. They reference the same DOM nodes; `linkSelection` is used by `applySelection()`.
- **Stage labels are removed** — `renderStageHeaders()` and `stageLabels` map were removed; stage header text no longer renders. CSS also hides `.sankey-stage-label` as a fallback.
- **`#sankey-status` is hidden** — `.sankey-meta` has `display: none` in CSS. The status text still updates in JS but is not visible to users.
- **No `netlify.toml`** — Netlify is configured to publish the repo root as-is with no build command (see `DEPLOYMENT.md`).

---

## Files to Touch for Common Changes

| Task | File(s) |
|---|---|
| Snippet copy | `index.html` — `#snippet-1` through `#snippet-4` |
| Snippet spacing / font | `styles.css` — `.sankey-snippet` |
| Sankey layout math | `main.js` — `computeLayout()`, `derivePackedLayout()` |
| Scroll start/end pacing | `main.js` — `ScrollTrigger.create()` options; `styles.css` — `.sankey-snippet` `min-height` |
| Node/link colours | `styles.css` — `:root` CSS variables (`--color-*`) + `.sankey-node.stage-N rect` |
| Node click interaction | `main.js` — `applySelection()` |
| Hero animation | `index.html` — inline `<script>` block after `gsap.registerPlugin` |
| Data | `init.json` + `baselines.json` — update `main.js` `initPath` / `baselinesPath` constants if renamed |
