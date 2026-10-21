// Mobile view: the one-screen-at-a-time carousel built from the
// <template data-view-variant="mobile"> markup in index.html. Loaded only in
// the mobile view (see the <head> loader); main.js calls MobileSite.init()
// from loadAndRender() once the data is in, passing what this file needs:
//
//   siteCopy          copy lookup (view.js)
//   chapter1          { narrative(svg), explore(svg, { onSelect }) }: Chapter 1's
//                     charts, drawn by main.js (render, renderExploreChart)
//   themesModel       buildThemesModel(initData): themes -> companies
//   walkSentenceHtml  the Fervo walk's "By 2040, emissions are..." sentence
//
// Page movement belongs to mobile-sections.js; this file fills content,
// mirrors slide state onto sections for CSS, and drives the chapter bar.
(function () {
	// Theme slug -> the colour its chips and blurb highlight use.
	const THEME_COLOR_VARS = {
		Materials: "--color-sector",
		Energy: "--color-fuel",
		Electrification: "--color-final-energy"
	};

	function fillThemes(themesModel) {
		const chips = document.querySelector("[data-m-chips]");
		if (chips) {
			chips.innerHTML = "";
			themesModel.forEach((theme) => {
				const group = document.createElement("div");
				group.className = "m-chips__group";
				group.dataset.theme = theme.slug;
				group.style.setProperty("--m-theme-color", `var(${THEME_COLOR_VARS[theme.slug] || "--color-white"})`);
				theme.companies.forEach((company) => {
					const chip = document.createElement("span");
					chip.className = "m-chip";
					chip.textContent = company.label;
					group.append(chip);
				});
				chips.append(group);
			});
		}

		document.querySelectorAll("[data-m-theme-blurb]").forEach((el) => {
			const theme = themesModel.find((entry) => entry.slug === el.dataset.mThemeBlurb);
			el.innerHTML = theme ? theme.blurb : "";
			el.style.setProperty("--m-theme-color", `var(${THEME_COLOR_VARS[el.dataset.mThemeBlurb] || "--color-white"})`);
		});
	}

	// The seven-lens indicator above each explore chart.
	const LENS_COLOR_VARS = [
		"--color-final-service",
		"--color-sector",
		"--color-equipment",
		"--color-device",
		"--color-final-energy",
		"--color-fuel",
		"--color-emissions"
	];

	function fillLensIndicators() {
		document.querySelectorAll(".m-explore__lenses").forEach((row) => {
			row.innerHTML = "";
			LENS_COLOR_VARS.forEach((colorVar) => {
				const lens = document.createElement("span");
				lens.className = "m-explore__lens";
				lens.style.setProperty("--m-lens-color", `var(${colorVar})`);
				row.append(lens);
			});
		});
	}

	// A split slide's data-top-state / data-placeholder describe what the
	// top part shows while that slide is active. Mirror them onto the
	// section (for CSS) and the visual (for the placeholder caption).
	function syncSlideState(swiper) {
		const section = swiper.el.closest(".m-section");
		const slide = swiper.slides[swiper.activeIndex];
		if (!section || !slide) {
			return;
		}
		section.dataset.activeSlide = String(swiper.activeIndex);
		if (slide.dataset.topState) {
			section.dataset.topState = slide.dataset.topState;
		}
		const visual = section.querySelector(".m-visual");
		if (visual) {
			visual.dataset.placeholder = slide.dataset.placeholder || "";
		}
	}

	// Calls `rebuild` (debounced) when `el` changes size -- rotation, or iOS's
	// toolbar resizing the 100dvh sections. Charts are laid out in px.
	function onResize(el, rebuild) {
		let last = el.getBoundingClientRect();
		let timer = null;
		new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				const box = el.getBoundingClientRect();
				if (Math.abs(box.width - last.width) < 1 && Math.abs(box.height - last.height) < 1) {
					return;
				}
				last = box;
				rebuild();
			}, 150);
		}).observe(el);
	}

	const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

	// --- Chapter 1 narrative (pages 06-13)
	//
	// The chart is desktop's scroll choreography (render() in main.js). Each
	// slide names the point on its scene timeline it rests at
	// (data-m-progress); changing slide plays the timeline from one point to
	// the next, so the photo strips fan out, the bars stack and peel into the
	// Sankey exactly as they do on desktop.

	function setupNarrative(build) {
		const svg = document.querySelector("[data-m-narrative]");
		if (!svg || !build) {
			return null;
		}
		let chart = build(svg);
		const clock = { p: 0 };
		let tween = null;

		function go(target, animate) {
			tween?.kill();
			if (!animate || reduceMotion || !window.gsap) {
				clock.p = target;
				chart.draw(target);
				return;
			}
			// Longer stretches of timeline (the peel into the Sankey) get more time.
			const duration = Math.min(2.2, 0.6 + Math.abs(target - clock.p) * 4);
			tween = gsap.to(clock, { p: target, duration, ease: "sine.inOut", onUpdate: () => chart.draw(clock.p) });
		}

		onResize(svg.parentElement, () => {
			chart = build(svg);
			chart.draw(clock.p);
		});

		const section = svg.closest(".m-section");
		return {
			owns: (swiper) => swiper.el.closest(".m-section") === section,
			// A jump of more than one slide (a chapter link rewinding the
			// section) lands without playing everything in between.
			show(swiper, animate) {
				const slide = swiper.slides[swiper.activeIndex];
				const jump = Math.abs(swiper.activeIndex - (swiper.previousIndex ?? swiper.activeIndex)) > 1;
				go(Number(slide?.dataset.mProgress) || 0, animate && !jump);
			}
		};
	}

	// --- Chapter 1 explore mode (pages 15-21)
	//
	// The full Sankey, wider than the screen: three lenses at a time, panned
	// by swiping sideways or with the lens navigator above it. Tapping a node
	// isolates its chain and fills the info bar; "node list" and "details"
	// open drawers, and while one is open the page can't be swiped.

	const LENS_COUNT = 7;
	const LENSES_ON_SCREEN = 3;
	const LAST_WINDOW = LENS_COUNT - LENSES_ON_SCREEN;

	function setupExplore(build, mobileSections) {
		const root = document.querySelector('[data-m-explore="nodes"]');
		const svg = root?.querySelector("[data-m-explore-chart]");
		if (!svg || !build) {
			return null;
		}
		const viewport = svg.parentElement;
		const toggles = Object.fromEntries(
			[...root.querySelectorAll("[data-m-drawer-toggle]")].map((el) => [el.dataset.mDrawerToggle, el])
		);
		const drawers = Object.fromEntries(
			[...root.querySelectorAll("[data-m-drawer]")].map((el) => [el.dataset.mDrawer, el])
		);
		const infoEl = root.querySelector("[data-m-info]");
		const nodeList = root.querySelector("[data-m-nodelist]");

		let windowStart = 0; // first of the three lenses on screen
		let selection = null; // what onSelect last reported
		let openDrawer = null;
		let openStage = null; // the node list's expanded stage

		// --- the chart and its pan

		let chart = build(svg, { onSelect });

		function applyPan(animate) {
			const maxOffset = Math.max(0, chart.width - viewport.clientWidth);
			const offset = Math.min(windowStart * chart.columnGap, maxOffset);
			svg.style.transition = animate && !reduceMotion ? "" : "none";
			svg.style.transform = `translateX(${-offset}px)`;
			nav.root.style.setProperty("--m-window", String(windowStart));
			nav.prev.hidden = windowStart === 0;
			nav.next.hidden = windowStart === LAST_WINDOW;
			nav.lenses.forEach((lens, i) => {
				lens.classList.toggle("is-on-screen", i >= windowStart && i < windowStart + LENSES_ON_SCREEN);
			});
		}

		function setWindow(start, animate = true) {
			const next = Math.max(0, Math.min(LAST_WINDOW, start));
			if (next !== windowStart) {
				windowStart = next;
				applyPan(animate);
			}
		}

		// Brings a stage on screen, in the middle column where there is one.
		function showStage(stage) {
			setWindow(stage - 2);
		}

		// --- lens navigator: seven swatches, a frame around the three on screen

		const nav = (() => {
			const navRoot = root.querySelector("[data-m-lensnav]");
			navRoot.innerHTML = "";
			const track = document.createElement("div");
			track.className = "m-lensnav__track";
			const lenses = chart.stages.map((entry) => {
				const lens = document.createElement("button");
				lens.type = "button";
				lens.className = "m-lensnav__lens";
				lens.style.setProperty("--m-lens-color", `var(${entry.colorVar})`);
				lens.setAttribute("aria-label", siteCopy("mobile.explore.showLens", { lens: entry.label }));
				lens.addEventListener("click", () => {
					// Already on screen: stay put. Otherwise bring it to the near edge.
					const i = entry.stage - 1;
					if (i < windowStart) {
						setWindow(i);
					} else if (i >= windowStart + LENSES_ON_SCREEN) {
						setWindow(i - LENSES_ON_SCREEN + 1);
					}
				});
				track.append(lens);
				return lens;
			});
			const frame = document.createElement("div");
			frame.className = "m-lensnav__frame";
			const arrow = (dir, label) => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = `m-lensnav__arrow m-lensnav__arrow--${dir}`;
				button.setAttribute("aria-label", siteCopy(label));
				button.addEventListener("click", () => setWindow(windowStart + (dir === "next" ? 1 : -1)));
				frame.append(button);
				return button;
			};
			const prev = arrow("prev", "mobile.explore.prevLenses");
			const next = arrow("next", "mobile.explore.nextLenses");
			track.append(frame);
			navRoot.append(track);
			return { root: navRoot, lenses, prev, next };
		})();

		// --- sideways swipes and trackpad scrolls pan the chart. Vertical
		// movement stays with the page (Swiper ignores horizontal drags).

		let touchStart = null;
		viewport.addEventListener("touchstart", (event) => {
			const touch = event.touches[0];
			touchStart = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
		}, { passive: true });
		viewport.addEventListener("touchend", (event) => {
			if (!touchStart) {
				return;
			}
			const touch = event.changedTouches[0];
			const dx = touch.clientX - touchStart.x;
			const dy = touch.clientY - touchStart.y;
			touchStart = null;
			if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				setWindow(windowStart + (dx < 0 ? 1 : -1));
			}
		}, { passive: true });

		let wheelX = 0;
		let wheelQuietUntil = 0;
		viewport.addEventListener("wheel", (event) => {
			if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
				return;
			}
			// One step per gesture: momentum after a step is ignored.
			if (event.timeStamp < wheelQuietUntil) {
				wheelQuietUntil = event.timeStamp + 200;
				return;
			}
			wheelX += event.deltaX;
			if (Math.abs(wheelX) > 60) {
				setWindow(windowStart + Math.sign(wheelX));
				wheelX = 0;
				wheelQuietUntil = event.timeStamp + 200;
			}
		}, { passive: true });

		// --- selection: the info bar and the details drawer

		function fillTitle(el, info) {
			el.innerHTML = "";
			const stage = document.createElement("span");
			stage.textContent = `${info.stageLabel} / `;
			const name = document.createElement("strong");
			name.textContent = info.name;
			el.append(stage, name);
		}

		function onSelect(info) {
			selection = info;
			root.classList.toggle("has-selection", Boolean(info));
			root.style.setProperty("--m-stage-color", info ? `var(${info.stageVar})` : "var(--color-white)");
			infoEl.hidden = !info;
			toggles.details.hidden = !info;
			if (!info) {
				if (openDrawer === "details") {
					setDrawer(null);
				}
				return;
			}
			root.querySelectorAll("[data-m-title]").forEach((el) => fillTitle(el, info));
			root.querySelector("[data-m-value]").textContent = info.throughputText;
			root.querySelector("[data-m-share]").textContent = info.shareText;
			root.querySelector("[data-m-desc]").textContent = info.description || "";
		}

		// --- drawers

		function setDrawer(name) {
			openDrawer = name;
			Object.entries(drawers).forEach(([key, el]) => {
				el.hidden = key !== name;
			});
			Object.entries(toggles).forEach(([key, el]) => {
				el.classList.toggle("is-open", key === name);
				el.setAttribute("aria-expanded", String(key === name));
			});
			root.classList.toggle("has-drawer", Boolean(name));
			if (name === "nodes") {
				openStage = selection ? selection.stage : windowStart + 1;
				fillNodeList();
			}
			if (name) {
				drawers[name].querySelector("[data-sections-lock-scroll]")?.scrollTo?.(0, 0);
				drawers[name].scrollTo?.(0, 0);
			}
			mobileSections.setLocked(Boolean(name));
		}

		Object.entries(toggles).forEach(([key, el]) => {
			el.addEventListener("click", () => setDrawer(openDrawer === key ? null : key));
		});
		const close = root.querySelector("[data-m-drawer-close]");
		close.setAttribute("aria-label", siteCopy("mobile.explore.close"));
		close.addEventListener("click", () => setDrawer(null));

		// The node list: one row per lens, the open one showing its nodes as
		// chips. Choosing a node selects it and pans its lens on screen.
		function fillNodeList() {
			nodeList.innerHTML = "";
			chart.stages.forEach((entry) => {
				const group = document.createElement("section");
				group.className = "m-nodelist__stage";
				group.style.setProperty("--m-stage-color", `var(${entry.colorVar})`);
				const isOpen = entry.stage === openStage;
				group.classList.toggle("is-open", isOpen);

				const head = document.createElement("button");
				head.type = "button";
				head.className = "m-nodelist__head";
				head.setAttribute("aria-expanded", String(isOpen));
				head.textContent = entry.label;
				head.addEventListener("click", () => {
					openStage = isOpen ? null : entry.stage;
					fillNodeList();
				});
				group.append(head);

				if (isOpen) {
					const chips = document.createElement("div");
					chips.className = "m-nodelist__chips";
					entry.nodes.forEach((node) => {
						const chip = document.createElement("button");
						chip.type = "button";
						chip.className = "m-nodelist__chip";
						chip.classList.toggle("is-selected", node.id === selection?.id);
						chip.textContent = node.label;
						chip.addEventListener("click", () => {
							chart.select(node.id);
							showStage(entry.stage);
							setDrawer(null);
						});
						chips.append(chip);
					});
					group.append(chips);
				}
				nodeList.append(group);
			});
		}

		applyPan(false);

		onResize(viewport, () => {
			const selectedId = chart.selectedId();
			chart = build(svg, { onSelect });
			if (selectedId) {
				chart.select(selectedId);
			}
			applyPan(false);
		});

		return {
			closeDrawer: () => setDrawer(null)
		};
	}

	// --- Chapter bar
	//
	// The desktop .bottom-sticky-nav markup, restyled by mobile.css into a
	// top bar: one segment per chapter, the active one expanded to show its
	// title. Its "intro" segment is the site-title label.

	function setupChapterBar(mobileSections) {
		const nav = document.querySelector(".bottom-sticky-nav");
		if (!nav) {
			return;
		}
		nav.classList.add("is-visible");
		const label = nav.querySelector(".bottom-sticky-nav__item--label");
		if (label) {
			label.dataset.navGroup = "intro";
			label.setAttribute("role", "button");
			label.tabIndex = 0;
		}
		const items = [...nav.querySelectorAll("[data-nav-group]")];
		const blocks = [...document.querySelectorAll("#m-app [data-chapter]")];

		// The chapter on screen: whichever block covers the middle of the viewport.
		let current = null;
		function update() {
			const middle = window.innerHeight / 2;
			const block = blocks.find((el) => {
				const { top, bottom } = el.getBoundingClientRect();
				return top <= middle && bottom > middle;
			});
			const chapter = block ? block.dataset.chapter : current;
			if (chapter === current) {
				return;
			}
			current = chapter;
			items.forEach((item) => item.classList.toggle("is-active", item.dataset.navGroup === chapter));
		}

		let rafPending = false;
		window.addEventListener("scroll", () => {
			if (rafPending) {
				return;
			}
			rafPending = true;
			requestAnimationFrame(() => {
				rafPending = false;
				update();
			});
		}, { passive: true });
		window.addEventListener("resize", update);
		update();

		items.forEach((item) => {
			const go = (event) => {
				event.preventDefault();
				jumpToChapter(mobileSections, item.dataset.navGroup);
			};
			item.addEventListener("click", go);
			item.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					go(event);
				}
			});
		});
	}

	// Lands on the first screen of a chapter: its first section, rewound to
	// its first slide.
	function jumpToChapter(mobileSections, chapter) {
		const index = mobileSections.sections.findIndex(({ el }) => el.dataset.chapter === chapter);
		if (index !== -1) {
			jumpToSection(mobileSections, index);
		}
	}

	function jumpToSection(mobileSections, index) {
		explore?.closeDrawer(); // a drawer locks the page
		mobileSections.sections[index].swiper.slideTo(0, 0);
		mobileSections.scrollToSection(index);
	}

	let siteCopy = null;
	let explore = null;

	function init(ctx) {
		siteCopy = ctx.siteCopy;
		fillThemes(ctx.themesModel || []);
		fillLensIndicators();
		document.querySelectorAll("[data-m-walk-sentence]").forEach((el) => {
			el.innerHTML = ctx.walkSentenceHtml || "";
		});

		const narrative = setupNarrative(ctx.chapter1?.narrative);
		const onSlide = (animate) => (swiper) => {
			syncSlideState(swiper);
			if (narrative?.owns(swiper)) {
				narrative.show(swiper, animate);
			}
		};

		const mobileSections = MobileSections.init({
			swiperOptions: {
				on: {
					init: onSlide(false),
					slideChange: onSlide(true)
				}
			}
		});
		explore = setupExplore(ctx.chapter1?.explore, mobileSections);

		setupChapterBar(mobileSections);
		// In-page links (chapter cards, the "Conclusion" link inside the nav
		// note copy) name desktop section ids; each maps to the mobile section
		// carrying the same data-m-anchor.
		document.querySelector("#m-app")?.addEventListener("click", (event) => {
			const link = event.target.closest("a[href^='#']");
			const hash = link ? link.getAttribute("href").slice(1) : "";
			const index = hash
				? mobileSections.sections.findIndex(({ el }) => el.dataset.mAnchor === hash)
				: -1;
			if (index === -1) {
				return;
			}
			event.preventDefault();
			jumpToSection(mobileSections, index);
		});

		window.mobileSections = mobileSections;
		return mobileSections;
	}

	window.MobileSite = { init };
})();
