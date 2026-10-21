// Mobile full-screen sections: a page built from any mix of .outer-swiper and
// .split-section blocks (each a vertical Swiper), with ordinary free-scrolling
// content allowed between or after them. Proven out in mobile-ui/index.html;
// integration notes in MOBILE_SECTIONS.md.
//
// The one idea everything here serves: moving the PAGE between sections is
// done by this file, never by native scrolling. Swiper's releaseOnEdges /
// touchReleaseOnEdges + CSS scroll-snap looked like the obvious route, but
// midway through a native scroll the next swiper lands under the cursor or
// finger, eats the input, and leaves the page parked between two sections.
// So at a swiper's edge we smooth-scroll the page exactly onto the
// neighbouring section ourselves.
//
// Requires Swiper 11 (tested on 11.2.10) loaded first. Call once, after any
// <template data-view-variant> markup has been cloned in:
//
//   const mobileSections = MobileSections.init({ swiperOptions: { … } });
//   mobileSections.scrollToSection(2);
(function () {
	const DEFAULTS = {
		root: document,
		sectionSelector: ".outer-swiper, .split-section",
		// A macOS trackpad flick keeps emitting wheel events for 1-2s after the
		// fingers lift; Swiper reads that momentum as fresh gestures and skips
		// ahead. After every slide change or page move, wheel input is swallowed
		// until it has been quiet this long -- so one flick = one step.
		wheelQuietMs: 150,
		// How far a finger must drag past a swiper's edge to move the page on.
		touchHandoffPx: 40,
		// Safari has no scrollend event; a page move is treated as finished
		// after this long instead.
		scrollFallbackMs: 1000,
		speed: 500,
		// Merged into every vertical swiper's config (pagination, effects, `on`
		// handlers...). Handlers get the swiper; s.el.closest(".split-section")
		// finds the section.
		swiperOptions: {},
		// Merged into every horizontal .inner-swiper's config.
		innerSwiperOptions: {},
	};

	// A section counts as "resting" when its top is within this many px of
	// the viewport top.
	const REST_TOLERANCE_PX = 2;

	function pageTop(el) {
		return el.getBoundingClientRect().top + window.scrollY;
	}

	function init(options = {}) {
		const opts = { ...DEFAULTS, ...options };

		// Horizontal swipers nested inside a vertical slide.
		opts.root.querySelectorAll(".inner-swiper").forEach((el) => {
			new Swiper(el, {
				nested: true,
				centeredSlides: true,
				slidesPerView: 1,
				spaceBetween: 0,
				speed: 400,
				pagination: {
					el: el.querySelector(".inner-pagination"),
					clickable: true,
				},
				...opts.innerSwiperOptions,
			});
		});

		// Page order matters: sections[i + 1] is the next one down the page.
		const sections = [...opts.root.querySelectorAll(opts.sectionSelector)].map((el) => {
			const isSplit = el.matches(".split-section");
			const pagination = el.querySelector(isSplit ? ".split-pagination" : ".outer-pagination");
			const swiper = new Swiper(isSplit ? el.querySelector(".split-swiper") : el, {
				direction: "vertical",
				slidesPerView: 1,
				spaceBetween: 0,
				speed: opts.speed,
				touchReleaseOnEdges: false, // page moves are ours -- see top of file
				mousewheel: true,
				...(pagination ? { pagination: { el: pagination, clickable: true } } : {}),
				...opts.swiperOptions,
			});
			return { el, swiper };
		});

		// --- wheel momentum gate
		//
		// After every slide change or page move the wheel is locked. It unlocks
		// at the first event that follows wheelQuietMs of silence -- and no
		// sooner than one slide transition after locking. Gaps are measured
		// with event timestamps (when the input happened), not with timers or
		// handling time, so a main-thread stall (first image decode, say) can't
		// fake a pause in the middle of a flick's momentum.

		// Momentum tails also decay, each event no bigger than the last: input
		// resuming shortly, but smaller than where it left off, is still the
		// same flick.
		const MOMENTUM_GAP_MS = 400;

		let wheelLocked = false;
		let wheelLockMinUntil = 0;
		let lastWheelTs = -Infinity;
		let lastWheelDelta = 0;

		function lockWheel() {
			wheelLocked = true;
			wheelLockMinUntil = performance.now() + opts.speed;
		}

		// Call on every wheel event; true = swallow it.
		function wheelGate(e) {
			const ts = e.timeStamp; // same clock as performance.now()
			const delta = Math.abs(e.deltaY);
			const gap = ts - lastWheelTs;
			const decaying = gap < MOMENTUM_GAP_MS && delta < lastWheelDelta;
			lastWheelTs = ts;
			lastWheelDelta = delta;
			if (wheelLocked && gap >= opts.wheelQuietMs && ts >= wheelLockMinUntil && !decaying) {
				wheelLocked = false;
			}
			return wheelLocked;
		}

		// --- page moves

		let pageScrolling = false;
		// setLocked(true): an overlay (a drawer) owns input; no swipe, wheel or
		// scroll moves the page or any swiper until it's unlocked.
		let locked = false;
		let pageScrollFallback = null;
		let lastResting = -1; // section the page last came to rest on; re-pinned on resize

		// A finger fling's native momentum can keep running underneath our
		// smooth scroll and push the page past its target -- where the next
		// section then looks like it's "entering". So a move that ends off
		// target is re-aimed at the same target, a few times at most.
		const MAX_PAGE_SCROLL_RETRIES = 3;
		let pageScrollTarget = null;
		let pageScrollRetries = 0;

		function scrollPageTo(top, smooth = true) {
			pageScrolling = true;
			pageScrollTarget = top;
			pageScrollRetries = 0;
			startPageScroll(smooth);
		}
		function startPageScroll(smooth) {
			window.scrollTo({ top: pageScrollTarget, behavior: smooth ? "smooth" : "instant" });
			clearTimeout(pageScrollFallback);
			pageScrollFallback = setTimeout(endPageScroll, smooth ? opts.scrollFallbackMs : 0);
		}
		function endPageScroll() {
			if (!pageScrolling) return;
			const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
			const target = Math.min(Math.max(pageScrollTarget, 0), maxScroll);
			if (Math.abs(window.scrollY - target) > REST_TOLERANCE_PX && pageScrollRetries < MAX_PAGE_SCROLL_RETRIES) {
				pageScrollRetries++;
				return startPageScroll(true);
			}
			// Close enough to have stopped retrying, but land exactly.
			if (Math.abs(window.scrollY - target) <= REST_TOLERANCE_PX) {
				window.scrollTo({ top: target, behavior: "instant" });
			}
			pageScrolling = false;
			pageScrollTarget = null;
			clearTimeout(pageScrollFallback);
			lockWheel(); // swallow momentum left over from the flick that started it
			// Judged by where we were aiming, not where the page is: if a fling
			// outlasted the retries, the page still belongs on the target section
			// and the fling-window re-pin (see "native scrolling") pulls it back.
			lastResting = sections.findIndex(({ el }) => Math.abs(pageTop(el) - target) <= REST_TOLERANCE_PX);
			syncSwiperInput();
		}

		function restingIndex() {
			return sections.findIndex(({ el }) => Math.abs(el.getBoundingClientRect().top) <= REST_TOLERANCE_PX);
		}

		// Where the page goes when leaving section i past its edge: the
		// neighbouring section if it sits flush against this one, otherwise one
		// screen into the free content beside it. Null when there's nowhere to go.
		function handOffTarget(i, goingDown) {
			const { el } = sections[i];
			const top = pageTop(el);
			const bottom = top + el.offsetHeight;
			if (goingDown) {
				const next = sections[i + 1];
				if (next && Math.abs(pageTop(next.el) - bottom) <= REST_TOLERANCE_PX) return pageTop(next.el);
				const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
				return top < maxScroll - REST_TOLERANCE_PX ? Math.min(bottom, maxScroll) : null;
			}
			const prev = sections[i - 1];
			if (prev && Math.abs(pageTop(prev.el) + prev.el.offsetHeight - top) <= REST_TOLERANCE_PX) return pageTop(prev.el);
			return top > REST_TOLERANCE_PX ? Math.max(0, top - window.innerHeight) : null;
		}

		// Outside a resting section (free content, or mid-way): if a section is
		// partly on screen in the direction of travel, the page belongs on it.
		// With two on screen, the one reached first in that direction wins.
		function sectionEnteringView(goingDown) {
			return (goingDown ? sections : [...sections].reverse()).find(({ el }) => {
				const { top, bottom } = el.getBoundingClientRect();
				// a few-px sliver (sub-pixel rounding, an interrupted smooth
				// scroll) doesn't count as on screen
				if (top >= window.innerHeight - REST_TOLERANCE_PX || bottom <= REST_TOLERANCE_PX) return false;
				return goingDown ? top > REST_TOLERANCE_PX : top < -REST_TOLERANCE_PX;
			});
		}

		// A swiper only takes input while its section is resting. Otherwise a
		// half-visible swiper would grab the drag/wheel meant for the page --
		// the exact bug this file exists to prevent. touch-action is opened up
		// at the same time so the page can be panned natively over it.
		function syncSwiperInput() {
			const resting = restingIndex();
			sections.forEach(({ swiper }, i) => {
				const active = !locked && i === resting;
				swiper.allowTouchMove = active;
				swiper.el.style.touchAction = active ? "" : "pan-y";
			});
		}

		// --- wheel

		// Capture on window so this runs before Swiper's own wheel listeners.
		window.addEventListener("wheel", (e) => {
			if (locked) {
				// Keep it from every swiper; let it scroll only an element marked
				// as scrollable while locked (the drawer's own content).
				e.stopImmediatePropagation();
				if (!e.target.closest?.("[data-sections-lock-scroll]")) e.preventDefault();
				return;
			}
			const gated = wheelGate(e);
			if (pageScrolling || gated) {
				e.preventDefault();
				e.stopImmediatePropagation();
				return;
			}
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // sideways swipe

			const goingDown = e.deltaY > 0;
			const i = restingIndex();
			let target = null;
			if (i !== -1) {
				const { swiper } = sections[i];
				if (!(goingDown ? swiper.isEnd : swiper.isBeginning)) return; // the swiper's own slide change
				target = handOffTarget(i, goingDown);
				if (target === null) return; // page edge: let the swiper rubber-band
			} else {
				const entering = sectionEnteringView(goingDown);
				// Free scrolling -- but keep the event from any half-visible swiper.
				if (!entering) return e.stopImmediatePropagation();
				target = pageTop(entering.el);
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			scrollPageTo(target);
		}, { capture: true, passive: false });

		// --- touch

		sections.forEach(({ swiper }, i) => {
			// Edge state is read at touchStart: by touchEnd a drag may already
			// have nudged the swiper's progress.
			let edgeAtTouchStart = { isBeginning: false, isEnd: false };
			// The gesture is measured here rather than read from Swiper's
			// touches.diff, which Swiper stops updating once it decides a drag is
			// sideways -- a horizontal swipe would hand off with the previous
			// gesture's stale diff.
			let startPoint = null;
			const pointOf = (e) => {
				const t = e?.changedTouches?.[0] || e;
				return t && Number.isFinite(t.clientY) ? { x: t.clientX, y: t.clientY } : null;
			};

			swiper.on("slideChange", lockWheel);
			swiper.on("touchStart", (s, e) => {
				edgeAtTouchStart = { isBeginning: s.isBeginning, isEnd: s.isEnd };
				startPoint = pointOf(e);
			});
			swiper.on("touchEnd", (s, e) => {
				const endPoint = pointOf(e);
				if (pageScrolling || locked || !startPoint || !endPoint) return;
				// negative = finger moved up = go down
				const diff = endPoint.y - startPoint.y;
				if (Math.abs(endPoint.x - startPoint.x) > Math.abs(diff)) return; // sideways
				const goingDown = diff < -opts.touchHandoffPx && edgeAtTouchStart.isEnd;
				const goingUp = diff > opts.touchHandoffPx && edgeAtTouchStart.isBeginning;
				if (!goingDown && !goingUp) return;
				const target = handOffTarget(i, goingDown);
				if (target !== null) scrollPageTo(target);
			});
		});

		// --- native scrolling (free content), settle and resize

		// How long after a finger lifts its fling momentum may still be moving
		// the page. Inside this window, momentum is never allowed to carry the
		// page off the section it just landed on: a smooth scrollTo doesn't
		// cancel a touch fling (seen in Chrome), so the fling keeps pushing
		// after we've snapped, and would otherwise drag the page on into the
		// next section. Outside the window, native scrolls (anchor links,
		// keyboard) are left alone.
		const FLING_WINDOW_MS = 1500;

		let touching = false;
		let lastTouchEnd = -Infinity;
		let lastScrollY = window.scrollY;
		let scrollDirectionDown = true;
		let settleTimer = null;
		lastResting = restingIndex();

		window.addEventListener("touchstart", () => { touching = true; }, { passive: true });
		window.addEventListener("touchend", () => {
			touching = false;
			lastTouchEnd = performance.now();
			scheduleSettle();
		}, { passive: true });

		// When a native scroll (finger momentum in free content) comes to rest
		// with a section part-way on screen, finish the job and land on it.
		function scheduleSettle() {
			clearTimeout(settleTimer);
			settleTimer = setTimeout(() => {
				if (pageScrolling || touching) return;
				const entering = sectionEnteringView(scrollDirectionDown);
				if (entering) return scrollPageTo(pageTop(entering.el));
				lastResting = restingIndex();
				syncSwiperInput();
			}, 150);
		}

		window.addEventListener("scroll", () => {
			if (window.scrollY !== lastScrollY) scrollDirectionDown = window.scrollY > lastScrollY;
			lastScrollY = window.scrollY;
			if (pageScrolling) return;
			if (!touching) {
				// Leftover fling pulling the page off the section it landed on.
				const landed = sections[lastResting];
				if (landed && performance.now() - lastTouchEnd < FLING_WINDOW_MS
					&& Math.abs(landed.el.getBoundingClientRect().top) > 0.5) {
					return scrollPageTo(pageTop(landed.el));
				}
				// Finger lifted and momentum is carrying the page into a section:
				// catch it now -- waiting for the scroll to settle would let a
				// hard fling sail straight past the section.
				const entering = sectionEnteringView(scrollDirectionDown);
				if (entering) return scrollPageTo(pageTop(entering.el));
			}
			scheduleSettle();
		}, { passive: true });
		window.addEventListener("scrollend", endPageScroll);

		// Section heights follow the viewport (100dvh), so a resize -- including
		// iOS's toolbar collapsing -- moves every section's top. Re-pin the page
		// to the section it was resting on.
		let resizeTimer = null;
		window.addEventListener("resize", () => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				if (pageScrolling || lastResting === -1 || !sections[lastResting]) return;
				scrollPageTo(pageTop(sections[lastResting].el), false);
			}, 100);
		});

		syncSwiperInput();

		return {
			sections,
			// For chapter links etc.: move the page onto section `index`.
			scrollToSection(index, { smooth = true } = {}) {
				const section = sections[index];
				if (!section) return;
				lastResting = index;
				scrollPageTo(pageTop(section.el), smooth);
			},
			// Freeze (true) or release (false) all page and slide movement, for
			// overlays such as drawers. While locked, the page itself can't
			// scroll (html.sections-locked); wheel input only reaches elements
			// inside [data-sections-lock-scroll].
			setLocked(value) {
				locked = Boolean(value);
				document.documentElement.classList.toggle("sections-locked", locked);
				syncSwiperInput();
			},
			isLocked: () => locked,
		};
	}

	window.MobileSections = { init };
})();
