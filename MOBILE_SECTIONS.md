# Mobile Sections — integration guide

Full-screen, swipe-driven sections for the mobile view: any mix of **`.outer-swiper`** and
**`.split-section`** blocks, in any order, with ordinary scrolling content (e.g. the
conclusion/legal block) allowed between or after them.

Proven out in [`mobile-ui/index.html`](mobile-ui/index.html), which now runs on the packaged files
below and serves as the working reference. This fits Phase 3 of
[`MOBILE_OVERHAUL.md`](MOBILE_OVERHAUL.md); read that first. Its decisions still hold: one DOM,
`<template data-view-variant>` for mobile-only markup, all text through `copy.js`.

---

## Files

| File | What |
|---|---|
| `mobile-sections.js` | The behaviour. Defines `window.MobileSections`. No dependencies but Swiper. |
| `mobile-sections.css` | Structural layout only (section sizes, split halves, pagination placement). |
| `mobile-ui/index.html` | Reference demo: two outer sections, one split section, shape morph driven by swiper progress. |

Swiper is pinned to **11.2.10**, the version everything was tested on. Don't float it to `@11`.

---

## How it works (the one idea)

Each section is a vertical Swiper. **Moving the page between sections is done by
`mobile-sections.js`, never by native scrolling.** When you swipe or scroll past a section's
first or last slide, the script smooth-scrolls the page exactly onto the neighbouring section.

The obvious approach (Swiper's `releaseOnEdges` / `touchReleaseOnEdges` plus CSS
`scroll-snap`) was tried first and fails. Midway through the native scroll, the next swiper lands
under the cursor or finger, takes over the input, and leaves the page parked between two sections.

What the script also handles:

- **Trackpad momentum.** A macOS flick sends scroll events for 1–2s after the fingers lift. After
  every slide change or page move, scroll input is ignored until it has been quiet for 150ms, so
  one flick moves one step.
- **Free-scrolling content.** Outside the sections, the page scrolls natively. When a section
  comes into view in the direction you're scrolling, the page lands on it.
- **Touch fling momentum.** A smooth `scrollTo` doesn't cancel a finger fling (seen in Chrome), so
  momentum can keep pushing after the page has snapped. For 1.5s after the finger lifts, momentum
  can't carry the page off the section it just landed on.
- **Half-visible sections.** A swiper only accepts input while its section fills the screen.
  Otherwise its touch handling is switched off so the page can be panned over it.
- **Resize** (including iOS's toolbar showing and hiding): the page is re-pinned to the section it
  was resting on.

---

## Integrating into `index.html`

### 1. Load order

```html
<head>
	…
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11.2.10/swiper-bundle.min.css" />
	<link rel="stylesheet" href="styles.css" />
	<link rel="stylesheet" href="mobile-sections.css" />
	<script src="copy.js"></script>
</head>
<body>
	… markup …
	<script src="view.js"></script>   <!-- clones templates + fills data-copy, as today -->
	… GSAP …
	<script src="https://cdn.jsdelivr.net/npm/swiper@11.2.10/swiper-bundle.min.js"></script>
	<script src="mobile-sections.js"></script>
	… d3 …
	<script src="main.js"></script>
</body>
```

`mobile-sections.js` only defines `MobileSections`. Nothing runs until `init()` is called, so it's
safe to load in both views. (To save desktop the ~150KB of Swiper, inject both Swiper tags only
when `data-view="mobile"`.)

### 2. Initialise from the mobile boot list

**Only call `init()` in the mobile view.** It installs a window-level wheel listener that would
take over desktop scrolling. The fork point is `loadAndRender()` in `main.js` (see
MOBILE_OVERHAUL.md §5):

```js
function initMobileSections() {
	window.mobileSections = MobileSections.init({
		swiperOptions: { on: { /* per-section behaviour, see below */ } },
	});
}

const MOBILE = [initMobileSections, /* … other mobile inits … */];
```

It must run **after** `view.js` has cloned the `<template data-view-variant="mobile">` markup.
That's already true for anything called from `loadAndRender()`.

### 3. Markup

All text goes through `data-copy` slots. The keys below are examples: add real ones to `copy.js`.

**`.outer-swiper`**: one vertical slide per screen. A slide can hold an optional horizontal
`.inner-swiper`.

```html
<div class="swiper outer-swiper">
	<div class="swiper-wrapper">
		<div class="swiper-slide">
			<p data-copy="mobile.intro.lead"></p>
		</div>
		<div class="swiper-slide">
			<!-- optional horizontal swiper inside a vertical slide -->
			<div class="swiper inner-swiper">
				<div class="swiper-wrapper">
					<div class="swiper-slide">…</div>
					<div class="swiper-slide">…</div>
				</div>
				<div class="swiper-pagination inner-pagination"></div>
			</div>
		</div>
	</div>
	<!-- optional: <div class="swiper-pagination outer-pagination"></div> -->
</div>
```

**`.split-section`**: a fixed top half over a vertical swiper whose slides use only their bottom
half.

```html
<div class="split-section">
	<div class="split-top">
		<!-- fixed content: chart, shape, image… -->
	</div>
	<div class="swiper split-swiper">
		<div class="swiper-wrapper">
			<div class="swiper-slide">
				<div class="split-slide-spacer"></div>
				<div class="split-slide-content">
					<p data-copy="mobile.split1.beat1"></p>
				</div>
			</div>
			<!-- …more slides… -->
		</div>
		<div class="swiper-pagination split-pagination"></div>
	</div>
</div>
```

**Free content**: any ordinary element between or after sections, at any height. No special
class needed.

### 4. Section-specific behaviour

`swiperOptions` is merged into every vertical swiper's config, so Swiper's own events drive
per-section effects. To find the section from a handler, use `s.el.closest(".split-section")`.
For example, the demo's shape morph, driven by how far through its slides the swiper is:

```js
MobileSections.init({
	swiperOptions: {
		on: {
			init(s)     { const shape = shapeFor(s); if (shape) updateShape(shape, s.progress); },
			progress(s) { const shape = shapeFor(s); if (shape) updateShape(shape, s.progress); },
		},
	},
});
```

### 5. Chapter links

For a link that targets a section, use `mobileSections.scrollToSection(index)`. Index is the
section's position in page order, counting `.outer-swiper` and `.split-section` blocks only.
Plain anchor jumps also work, but the page won't be marked as resting on that section until the
next scroll settles.

---

## API

```js
const mobileSections = MobileSections.init(options);
mobileSections.sections;                     // [{ el, swiper }] in page order
mobileSections.scrollToSection(i, { smooth = true });
```

| Option | Default | |
|---|---|---|
| `root` | `document` | Where to look for sections |
| `sectionSelector` | `".outer-swiper, .split-section"` | |
| `wheelQuietMs` | `150` | Quiet time that ends the trackpad momentum lock. If flicks still skip, raise to 200–250. If quick second flicks get ignored, lower to ~100 |
| `touchHandoffPx` | `40` | How far a finger must drag past an edge to move to the next section |
| `scrollFallbackMs` | `1000` | Safari has no `scrollend` event. After this long, a page move counts as finished |
| `speed` | `500` | Slide transition speed (ms) |
| `swiperOptions` | `{}` | Merged into every vertical swiper |
| `innerSwiperOptions` | `{}` | Merged into every `.inner-swiper` |

---

## Rules

- **Sections are `100dvh`** (set by `mobile-sections.css`). The page-move maths assumes a section
  fills the screen.
- **No ScrollTrigger pins on these sections.** This script owns scrolling inside them. Window-level
  ScrollTriggers that only watch scroll position (the bottom-nav scroll-spy) are fine: the page
  still scrolls the window.
- **No CSS `scroll-snap`.** A mandatory snap would also trap the free-scrolling content.
- **No `display: none` on a section.** Same reason as MOBILE_OVERHAUL.md: Swiper measures 0×0.
  Mobile-only markup goes in `<template data-view-variant="mobile">`.
- Keep `history.scrollRestoration = "manual"` (already in `index.html`). A restored mid-page offset
  would leave the page between sections.

---

## Verification

Serve locally (`python3 -m http.server`) and check in **both** input modes:

1. **Trackpad / wheel**, in a narrow desktop window in mobile view. One flick moves exactly one
   slide or one section, never two.
2. **Touch**, on a real iPhone (same Wi-Fi: `http://<mac-ip>:<port>/`). Swipe through every
   section and back. The page must always end flush on a section's top, never showing part of two.
3. **Free content.** Scroll through any free block in both directions. It must scroll freely, and
   a hard fling toward a section must land on it rather than skip past it.
4. **End of page.** The last free block (legal text) must be reachable and scroll to the bottom.

Tested in headless Chrome only: an emulated iPhone 13 with real touch events, and simulated
trackpad flicks that fade out like real momentum. Real iOS Safari fling behaviour is the thing
still worth checking on a device.
