# Sankey Implementation Overview

A reference file for new chat sessions. Covers architecture, dependencies, key idioms, and known quirks.

Last major revision: 2026-07-05 — full rebuild of the scroll narrative to match
`../TIF Sankey Mock-up 8_med.pdf` pages 6–19 (SCENES timeline, SVG title cards,
collapse/unstack choreography, detail zoom, dev scrub).

---

## Project at a Glance

A static single-page interactive data visualisation showing global greenhouse gas emissions (54 GT CO2e, 2025). No build tooling. No framework. The entire runtime is three files:

| File | Role |
|---|---|
| `index.html` | Page structure, inline hero animations, CDN script tags, asset preloads |
| `styles.css` | All layout and visual styles |
| `main.js` | Sankey data loading, layout, scroll animation, and interaction (single IIFE) |

Data is loaded at runtime from `init.json` (node metadata) and `baselines.json`
(scenario flow values) in the repo root. `node_details.json` (per-node full
flow chains, ~5 MB — fully populated by the data team 2026-07-06) is fetched
lazily when the chart first becomes interactive; it powers full-chain
click-to-isolate on the main chart and the portfolio highlight. The Option B
bundle's `avoided.json` and `STATUS.md` are not yet delivered.

Design assets in the repo root, one pair per stage
(`final-service, sector, equipment, device, final-energy, fuel, emissions`):

- `{stage}.svg` — title-card art: a 20-unit-wide bar `<rect>` + the stage name as
  vector-path wordmark, ~410-unit-tall viewBox.
- `{stage}.webp` — photo cover for that stage's intro card (preloaded via
  `<link rel="preload" as="image">` in `index.html`).

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

#app (main)
  #sankey-narrative   — Scroll-driven narrative + Sankey section
                        (min-height = --sankey-scroll-distance, currently 13000px)
    .sankey-layout    — CSS grid: copy column | chart (sticky, top:0, 100vh)
      .sankey-copy    — Left column: 11 scroll-paced beats, EMPTY in HTML
                        (rendered from SCENES in main.js)
      #full-sankey    — Right column: sticky chart container (100vh)
        .sankey-shell
          #sankey-status  — Status text (hidden in production)
          #sankey-chart   — SVG target for D3. Contains, in z-order:
                              <g.sankey-links>          real Sankey ribbons
                              <g.sankey-nodes>          real Sankey node rects+labels
                              <g.sankey-intro>          intro title cards (on top)
                              <g.sankey-stage-headers>  column headers (on top)
```

---

## The SCENES timeline (single source of truth)

`SCENES` (module scope, top of `main.js`) is an array of 11 scene objects:
`{ id, phase, start, end, copy, variant? }` with `start`/`end` in **percent
(0–100)** of the `#sankey-narrative` scroll. It drives **both**:

- the copy layer — `setupNarrativeBeats()` renders each scene's `copy` as a
  `<p class="sankey-snippet">` (beat 1 uses `variant: "headline"` →
  `.sankey-snippet--headline`, the yellow/white two-line opener) and fades it
  over its own window;
- the graphics — `drawMaster(p)` branches on `SCENE_BOUNDS[phase]` and uses
  `sceneT(p, phase)` for local 0–1 progress within a scene.

Because both layers read the same windows, copy and visuals cannot drift.

Scene windows map onto the first `ANIM_SPAN = 1 - HOLD_TAIL` (85%) of the
section scroll: both `drawMaster` and the beat fader divide section progress by
`ANIM_SPAN` (clamped). The final `HOLD_TAIL` (15%, ~2000px) is a pinned hold on
the finished interactive chart — the user keeps scrolling but nothing moves,
emphasizing that the Sankey is explorable before the page releases.

| # | phase | window | Graphic |
|---|---|---|---|
| 1 | `one-bar` | 0–9 | Emissions photo bar grows in at its card slot |
| 2 | `fan-out` | 9–17 | Other 6 photo bars fan out **leftward** from behind the emissions bar (whole-card group translate) |
| 3 | `wipe-reveal` | 17–27 | Photos swipe **up** (staggered via `WIPE_JITTER`) revealing colour bar + vector wordmark |
| 4 | `hold-services` | 27–34 | 7 title cards hold |
| 5 | `hold-lenses` | 34–43 | Title cards hold (copy lists the lenses) |
| 6 | `collapse` | 43–52 | Wordmarks fade; bars slide right into adjacent stripes at the Emissions x, then merge into one bar |
| 7 | `unstack` | 52–64 | Columns peel **leftward** to packed positions; per-gap ribbons + headers fade in |
| 8 | `expand` | 64–77 | Packed → expanded vertical spread; Final Service labels at the tail |
| 9 | `lens-focus` | 77–84 | Everything but the Final Service column fades to 0 |
| 10 | `cars-example` | 84–96 | Layout zoom to stages 1–3 with labels; Passenger-transport chain highlighted |
| 11 | `explore` | 96–100 | Un-zoom to full chart; faint ribbons; interaction unlocks at `INTERACTION_START = 0.985` |

Copy lives in each scene's `copy` (HTML allowed). Coloured keywords use
`<span class="kw kw-{stage}">` (7 per-stage colour classes in `styles.css`).

---

## Sankey Chart: How It Works

### Data pipeline

1. `loadAndRender()` fetches `init.json` and `baselines.json`, then passes both to `buildGraph()`.
2. `buildGraph()` creates node/link objects from JSON contracts:
  - node stage/order/group/description come from `init.nodes.nodes[]`
  - link values come from `baselines.links[]` under the active scenario key (default `2025`)
3. Each link carries `value`, `energy`, `process`, and `afolu` fields from `baselines.links[][scenario]`.

### Three layouts computed at render time

`render()` computes all three on every call (including resize), stored as
node/link Maps keyed by id:

- **Expanded** — `d3.sankey()` with `nodePadding: 9`, `nodeWidth: 20`,
  `sankeyJustify`. The final state.
- **Packed** — `derivePackedLayout()`: each stage column stacked with zero gap,
  same vertical ordering as expanded (prevents link crossovers in the morph).
- **Detail** — `computeDetailLayout()`: stages 1–3 re-spaced across the full
  chart width, stages 4–7 pushed off-screen right. Lerping expanded→detail is
  the scene-10 "zoom" — no viewBox change, no vertical distortion.

`applyLayout(t, nodeStartMap, nodeEndMap, linkStartMap, linkEndMap, opts)` is
the generic lerp that positions node rects, labels, and link paths for any pair
of layouts. It memoises on a signature (`opts.key` + t) to skip redundant
frames. `drawMaster` uses two pairs: `packed-expanded` (scenes 7–9) and
`expanded-detail` (scenes 10–11, with `forceStartAnchor` so off-screen columns
don't drift while hidden).

### Intro title cards (`<g.sankey-intro>`)

Built in `render()` from assets fetched once at load by `loadIntroAssets()`:

- Each `{stage}.svg` is fetched and parsed with `DOMParser`. A regex
  (`/M([\d.]+)[ ,]([\d.]+)h20v([\d.]+)h-20z/`) splits the **bar subpath** out of
  the artwork so the bar becomes an independent `<rect>` that can morph, while
  the remaining paths form the wordmark `<g>`. All fills are rewritten to the
  stage's `:root` CSS var (the shipped SVGs are slightly off-palette; the CSS
  vars match `TIF Sankey Color Codes.pdf` exactly).
- Cards are laid out evenly spaced and centred as a group (`groupWidth =
  extentW * 0.52`), scaled uniformly to the chart height.
- Each card gets a `{stage}.webp` photo `<image>` inside a clip-pathed `<g>`.
  The wipe animates the image translating **upward** inside a fixed clip window
  (scene 5), staggered per card by `WIPE_JITTER` over `WIPE_SPAN = 0.5`.
- `STAGE_META` (module scope) maps stage number → slug/label/CSS var.

If asset fetch fails, cards fall back to plain colour rects (no wordmark).

### Collapse → unstack choreography (scenes 6–7)

The intro bar rects themselves morph — the real Sankey stays hidden until the
swap:

1. **Collapse** (`tCollapse`): wordmarks fade (first 35%); each bar lerps
   x→`stripeX` (adjacent stripes at packed widths, butted against the Emissions
   column, `slide` 0.12–0.67), then all stripes lerp onto the Emissions x
   (`merge` 0.7–1.0) → single blue-topped bar.
2. **Unstack** (`tUnstack`): columns peel right-to-left. Stage `s` starts
   travelling at `unstackStart(s) = ((6-s)/6) * 0.55` and takes
   `UNSTACK_TRAVEL = 0.45` to reach its packed slot.
   - `columnSwap(s, t)`: the intro bar cross-fades to the real packed column
     only **after arrival** (0.04 window) so the two never show at mismatched
     positions. The Emissions intro bar stays opaque until `t = 0.75` so the
     merged stack reads blue while columns slide out from behind it (its real
     column, identical in geometry, already sits beneath — revealed at
     `t/0.05`).
   - `ribbonFactor(s, t)`: a gap's links appear only once both endpoint
     columns have arrived; link opacity =
     `ribbonFactor(source) * ribbonFactor(target) * LINK_PEAK_OPACITY`.
   - Headers fade in over `tUnstack` 0.55–0.95.
3. Intro group `display: none` once `p >= B.unstack.end`.

### Master choreography (`drawMaster`)

`drawMaster(p)` (inside `render()`) runs every frame. Per scene branch it fills
`stageNodeOpacity[1..7]` / `stageLabelOpacity[1..7]`, a `linkOpacityFn`,
`headerOpacity`, and picks the layout pair + t; then applies everything as
**inline styles**. Notable branches:

- **Scene 9 (lens-focus)**: stages 2–7 and all ribbons fade with
  `smoothstep(tFocus / 0.4)`; stage 1 stays full.
- **Scene 10 (cars-example)**: `expanded-detail` lerp; labels for stages 1–3;
  links touching the Passenger transport node (found at runtime:
  `stage === 2 && /passenger/i.test(label)`, chain limited to
  `target.stage <= 3`) at `CHAIN_LINK_OPACITY = 0.9`, other stage-1–3 links at
  `DIM_DETAIL_LINK_OPACITY = 0.04`, everything else 0.
- **Scene 11 (explore)**: un-zoom (`layoutT = 1 - unzoom`), links lerp to
  `FAINT_LINK_OPACITY = 0.16`, labels for stages 4–7 fade in late.
- At `p >= INTERACTION_START` (0.985) all inline opacities are **cleared
  (null)** and `setSankeyInteraction(true)` adds `.is-interactive` to
  `#sankey-chart` — from then on CSS owns opacity so the click-to-isolate
  classes (`is-active`/`is-faded`) work. Scrubbing back re-asserts inline
  styles and clears any selection.

### Stage headers (`<g.sankey-stage-headers>`)

7 horizontal `<text.stage-header>` labels on expanded column centres at
`y = sankeyExtentTop - 26` (`sankeyExtentTop = 70` gives them headroom inside
the viewBox). Column-1 x is clamped to `Math.max(cx, 58)` so "Final Service"
never clips the left edge. Per-stage `:root` colour, Helvetica Neue italic 1rem.
Opacity driven per-frame by `drawMaster`.

### Scroll binding

Uses `ScrollTrigger.matchMedia()`:

- **Desktop (min-width: 901px)**: GSAP tween scrubs `motionState.progress` 0→1
  (`ease: "none"`, `scrub: 0.8`) with a scrollTrigger on
  `#sankey-narrative` (`start: top top`, `end: bottom bottom`); `onUpdate` calls
  `drawMaster`. `#full-sankey` is CSS-sticky. `setupNarrativeBeats()` fades the
  copy beats on the same scroll span.
- **Mobile (max-width: 900px)** and **`prefers-reduced-motion`**:
  `drawMaster(1)` — jump straight to the final interactive state.
- **Dev scrub active**: ScrollTrigger is bypassed entirely (see below).

### SVG gradients

For every unique source-stage→target-stage pair, a horizontal
`<linearGradient id="link-gradient-{s}-{t}">` in `<defs>`; link strokes
reference them (stop opacity 0.3).

### Link and node CSS classes

Links (`<path class="sankey-link ...">`) receive semantic classes:
`stage-{s}-{t}`, `link-stage-{s}-{t}`, `link-from-{slug}`, `link-to-{slug}`,
`link-{fromSlug}-to-{toSlug}`.

### Node interaction — full-chain isolation

Clicking a node (only when `.is-interactive`) sets `state.selectedNodeId` and
runs `applySelection()`, which has two modes:

- **Full chain (default)**: the node's layer-1→7 chain from
  `node_details.json` is drawn as its own ribbons in `<g.sankey-chain>`
  (between links and nodes, `pointer-events: none`) at **attributed widths** —
  the chain's `6_Oil → 7_CO2` value is only the slice of that flow passing
  through the selected node, so widths come from chain values scaled by the
  expanded layout's px-per-Mt (`link.width / link.value`), not from the
  baseline ribbons. Slices stack from each node's top edge, ordered by the far
  endpoint's height. All baseline links get `is-faded`; nodes off the chain get
  `is-faded`; the selected node gets `is-selected`. Chain links are normalized
  in `chainLinksFor()` (module scope): endpoint ids aliased via
  `nodeIdAliases`, active-scenario value filter, duplicate pairs merged,
  unknown endpoints dropped with a one-time console warning; results cached
  per node id.
- **Direct-neighbor fallback** (`applyDirectSelection()`): the original
  one-hop behavior — used while `node_details.json` is still loading (upgrades
  in place when it resolves), if the fetch failed, or for a node whose chain
  is missing/empty in a future data drop.

`node_details.json` is fetched lazily by `ensureNodeDetails()` (shared with
the portfolio highlight): kicked off the first time `setSankeyInteraction(true)`
runs, cached, empty-object on failure. Background click resets everything and
clears the overlay. CSS: `.is-interactive .sankey-link { opacity: 0.16 }`,
`.is-active { 0.95 }`, `.is-faded { 0.03 }`, `.sankey-chain-link { 0.95 }`;
transitions are disabled while **not** interactive so scrubbing never animates.

### Resize handling

`setupResize()`: `ResizeObserver` on `#sankey-chart` + `window resize`, rAF
debounce → full `render()` (recomputes all three layouts, rebuilds SVG,
rebinds scroll trigger).

---

## Dev scrub (visual QA)

Append `?p=0.47` to the URL to render the narrative at exactly that master
progress with ScrollTrigger disabled. Keyboard `[` / `]` steps ±0.01
(shift: ±0.002); a readout appears bottom-left. `window.__sankeyScrub(v)` is
also exposed. The `<html>` element gets a `dev-scrub` class which CSS uses to
hide `#hero-intro`, so the narrative sits at the document origin — this is what
makes headless screenshots work:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --window-size=1600,900 --hide-scrollbars \
  --virtual-time-budget=15000 --screenshot=out.png "http://localhost:5500/?p=0.62"
```

`?p=` is **section** progress; the animation spans 0–0.85 and 0.85–1.0 is the
hold. Useful checkpoints vs the mock-up PDF: `p=0.04`→p.6, `0.10`→fan mid,
`0.19`→p.9 (wipe), `0.26`→p.10, `0.44`→p.12, `0.53`→p.13, `0.65`→p.15,
`0.68`→p.16, `0.77`→p.17, `0.85`–`1.0`→p.19 (hold, interactive).

`?select=<node id>` (dev scrub only, pair with `?p=1`, e.g.
`?p=1&select=3_Car`) auto-selects a node after render so the full-chain
isolation can be screenshotted headlessly.

Harmless in production (no `?p` → no hook), but can be stripped for the demo.

---

## Responsive Breakpoints

| Breakpoint | Behaviour |
|---|---|
| `min-width: 901px` | Two-column layout; scroll morph active; `#full-sankey` sticky |
| `max-width: 900px` | Single column; no scroll morph; final interactive state |

Desktop-only proof-of-concept for a small group of executives; mobile parity is
explicitly out of scope (the jump-to-final fallback is enough).

---

## Hero Animations (inline in `index.html`)

Separate from `main.js`. GSAP timeline + ScrollTrigger: globe scale-in, logo
slide, headline fade; scroll timeline parallaxes the headline and drifts the
starfield via the `--page-bg-shift` custom property.

---

## Key Idioms and Gotchas

- **`main.js` is an IIFE** — no globals except the dev-scrub hook.
- **Stage number comes from JSON node metadata** (`init.nodes.nodes[].layer`),
  with `{stage}_{Label}` id parsing as fallback.
- **All three layouts recomputed on every resize** — intentional.
- **Opacity ownership**: during the narrative, `drawMaster` sets inline
  opacities every frame; after `INTERACTION_START` they are nulled so CSS
  rules take over. Don't add CSS opacity rules that fight the inline phase.
- **The scrub tween must stay `ease: "none"`** — the copy beats fade on raw
  scroll position, so any ease on the graphics tween desynchronizes visuals
  from copy (this once made everything run a beat late). Scenes do their own
  smoothstep easing internally.
- **`.sankey-copy` grid column must stay `minmax(0, 1fr)`** — an auto track
  sizes to the widest snippet's max-content and blows out the layout.
- **`.sankey-snippet` must be `display: block`** — flex turns each coloured
  `<span>` into a separate flex item and scatters the copy.
- **`linkPaths` vs `linkSelection`** — same DOM nodes; `linkSelection` (on
  `state.rendered`) is what `applySelection()` uses.
- **`#sankey-status` is hidden** (`display: none`), still updated in JS.
- **No `netlify.toml`** — publishes repo root as-is (see `DEPLOYMENT.md`).

---

## Files to Touch for Common Changes

| Task | File(s) |
|---|---|
| Beat copy / scene windows / pacing | `main.js` — `SCENES` array (start/end are 0–100 %) |
| Beat spacing / font / keyword colours | `styles.css` — `.sankey-snippet`, `.sankey-snippet--headline`, `.kw-*` |
| Sankey layout math | `main.js` — `computeLayout()`, `derivePackedLayout()`, `computeDetailLayout()` |
| Collapse/unstack feel | `main.js` — `UNSTACK_TRAVEL`, `unstackStart`, `columnSwap`, `ribbonFactor`, collapse `slide`/`merge` windows |
| Title-card art / wipe | `main.js` — `loadIntroAssets()`, intro card build in `render()`, `WIPE_JITTER`/`WIPE_SPAN` |
| Overall scroll length | `main.js` — `NARRATIVE_SCROLL_DISTANCE` |
| Node/link colours | `styles.css` — `:root` CSS variables + `.sankey-node.stage-N rect` |
| Node click interaction | `main.js` — `applySelection()`, `applyDirectSelection()`, `chainLinksFor()`; CSS `.is-interactive` + `.sankey-chain` rules |
| Hero animation | `index.html` — inline `<script>` after `gsap.registerPlugin` |
| Data | `init.json` + `baselines.json` + `node_details.json` |

---

## Tunable Constants (in `main.js`)

| Constant | Value | Meaning |
|---|---|---|
| `NARRATIVE_SCROLL_DISTANCE` | 13000 | section scroll height, px (module scope) |
| `HOLD_TAIL` | 0.15 | end-of-section pinned hold on the interactive chart (module scope) |
| `SCENES[].start/end` | see table above | every scene window, copy + graphics (within `ANIM_SPAN`) |
| `LINK_PEAK_OPACITY` | 0.6 | ribbon opacity during the reveal/expand |
| `FAINT_LINK_OPACITY` | 0.16 | resting faint ribbons (final state) |
| `CHAIN_LINK_OPACITY` | 0.9 | highlighted cars-example chain |
| `DIM_DETAIL_LINK_OPACITY` | 0.04 | non-chain links in the detail view |
| `INTERACTION_START` | 0.985 | when node clicks unlock |
| `WIPE_JITTER` / `WIPE_SPAN` | per-card / 0.5 | photo swipe stagger and duration |
| `UNSTACK_TRAVEL` | 0.45 | fraction of scene 7 one column's peel takes |
| `sankeyExtentTop` | 70 | chart top inset (header headroom); headers at `-26` |

---

## How to Run & Verify

```
python3 -m http.server 5500      # from repo root
# open http://localhost:5500/ and scroll, or use ?p=… to land on a checkpoint
```

No build step; changes are live on reload. Verification workflow:

1. Dev scrub each checkpoint listed above against PDF pages 6–19.
2. Full manual scroll end-to-end: no jumps at scene seams; collapse→unstack
   reads as one continuous morph; interaction unlocks only at the very end.
3. Check `prefers-reduced-motion` / narrow viewport jump straight to the final
   interactive state; node click isolation works; resize mid-scroll re-renders.
