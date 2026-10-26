// Mobile view: the one-screen-at-a-time carousel built from the
// <template data-view-variant="mobile"> markup in index.html. Loaded only in
// the mobile view (see the <head> loader); main.js calls MobileSite.init()
// from loadAndRender() once the data is in, passing what this file needs:
//
//   siteCopy          copy lookup (view.js)
//   chapter1          { narrative(svg), explore(svg, { onSelect }) }: Chapter 1's
//                     charts, drawn by main.js (render, renderExploreChart)
//   portfolioFinale   (svg) -> { draw(t) }: Chapter 2's finale chart
//                     (renderThemesSankey in main.js)
//   themesModel       buildThemesModel(initData): themes -> companies
//   impacts           Chapter 3: { ready, walkCompany, walk(svg), explore(svg,
//                     { company }) } -- the Fervo walk's chart and the company
//                     explorer's (renderImpactsWalkChart and
//                     renderImpactsExploreChart in main.js); both carve once
//                     `ready` (avoided.json + node_details.json) resolves
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

	// --- Chapter 2 finale chart (page 30)
	//
	// Desktop's themes finale: every company lights its full chain in turn and
	// the links spider-web out from it. It plays from the start each time the
	// page comes on screen; the chips page before it simply fades it out.

	const FINALE_DURATION = 3;

	function setupPortfolioFinale(build) {
		const svg = document.querySelector("[data-m-finale]");
		if (!svg || !build) {
			return null;
		}
		let chart = build(svg);
		const clock = { t: 0 };
		let tween = null;

		function go(target, animate) {
			tween?.kill();
			if (!animate || reduceMotion || !window.gsap) {
				clock.t = target;
				chart?.draw(target);
				return;
			}
			clock.t = 0;
			chart?.draw(0);
			tween = gsap.to(clock, { t: target, duration: FINALE_DURATION, ease: "none", onUpdate: () => chart?.draw(clock.t) });
		}

		onResize(svg.parentElement, () => {
			chart = build(svg);
			chart?.draw(clock.t);
		});

		const section = svg.closest(".m-section");
		return {
			owns: (swiper) => swiper.el.closest(".m-section") === section,
			show(swiper, animate) {
				const slide = swiper.slides[swiper.activeIndex];
				if (slide?.dataset.topState !== "sankey") {
					return;
				}
				const jump = Math.abs(swiper.activeIndex - (swiper.previousIndex ?? swiper.activeIndex)) > 1;
				go(1, animate && !jump);
			}
		};
	}

	// --- Explore mode (pages 15-21, 38-41)
	//
	// A Sankey wider than the screen: three lenses at a time, panned by
	// swiping sideways or with the lens navigator above it. "node list" /
	// "company list" and "details" open drawers, and while one is open the
	// page can't be swiped.

	const LENS_COUNT = 7;
	const LENSES_ON_SCREEN = 3;
	const LAST_WINDOW = LENS_COUNT - LENSES_ON_SCREEN;

	// The pan and the lens navigator. `getChart()` is the chart on screen now
	// (both explorers rebuild theirs): { width, columnGap, stages }.
	function setupPan(root, getChart) {
		const svg = root.querySelector("[data-m-explore-chart]");
		const viewport = svg.parentElement;
		let windowStart = 0; // first of the three lenses on screen

		function apply(animate) {
			const chart = getChart();
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
				apply(animate);
			}
		}

		// --- lens navigator: seven swatches, a frame around the three on screen

		const nav = (() => {
			const navRoot = root.querySelector("[data-m-lensnav]");
			navRoot.innerHTML = "";
			const track = document.createElement("div");
			track.className = "m-lensnav__track";
			const lenses = getChart().stages.map((entry) => {
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

		apply(false);

		return {
			viewport,
			apply,
			setWindow,
			windowStart: () => windowStart
		};
	}

	// The drawers and their toggles. `onOpen(name)` fills a drawer as it opens.
	function setupDrawers(root, mobileSections, onOpen) {
		const toggles = Object.fromEntries(
			[...root.querySelectorAll("[data-m-drawer-toggle]")].map((el) => [el.dataset.mDrawerToggle, el])
		);
		const drawers = Object.fromEntries(
			[...root.querySelectorAll("[data-m-drawer]")].map((el) => [el.dataset.mDrawer, el])
		);
		let openDrawer = null;

		function set(name) {
			openDrawer = name;
			Object.entries(drawers).forEach(([key, el]) => {
				el.hidden = key !== name;
			});
			Object.entries(toggles).forEach(([key, el]) => {
				el.classList.toggle("is-open", key === name);
				el.setAttribute("aria-expanded", String(key === name));
			});
			root.classList.toggle("has-drawer", Boolean(name));
			if (name) {
				onOpen?.(name);
				drawers[name].querySelector("[data-sections-lock-scroll]")?.scrollTo?.(0, 0);
				drawers[name].scrollTo?.(0, 0);
			}
			mobileSections.setLocked(Boolean(name));
		}

		Object.entries(toggles).forEach(([key, el]) => {
			el.addEventListener("click", () => set(openDrawer === key ? null : key));
		});
		const close = root.querySelector("[data-m-drawer-close]");
		close.setAttribute("aria-label", siteCopy("mobile.explore.close"));
		close.addEventListener("click", () => set(null));

		return {
			toggles,
			set,
			open: () => openDrawer
		};
	}

	// --- Chapter 1 explore mode (pages 15-21)
	//
	// Every node of the global Sankey. Tapping a node isolates its chain and
	// fills the info bar; the node list picks one by lens.

	function setupExplore(build, mobileSections) {
		const root = document.querySelector('[data-m-explore="nodes"]');
		const svg = root?.querySelector("[data-m-explore-chart]");
		if (!svg || !build) {
			return null;
		}
		const infoEl = root.querySelector("[data-m-info]");
		const nodeList = root.querySelector("[data-m-nodelist]");

		let selection = null; // what onSelect last reported
		let openStage = null; // the node list's expanded stage

		let chart = build(svg, { onSelect });
		const pan = setupPan(root, () => chart);
		const drawers = setupDrawers(root, mobileSections, (name) => {
			if (name === "nodes") {
				openStage = selection ? selection.stage : pan.windowStart() + 1;
				fillNodeList();
			}
		});

		// Brings a stage on screen, in the middle column where there is one.
		function showStage(stage) {
			pan.setWindow(stage - 2);
		}

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
			drawers.toggles.details.hidden = !info;
			if (!info) {
				if (drawers.open() === "details") {
					drawers.set(null);
				}
				return;
			}
			root.querySelectorAll("[data-m-title]").forEach((el) => fillTitle(el, info));
			root.querySelector("[data-m-value]").textContent = info.throughputText;
			root.querySelector("[data-m-share]").textContent = info.shareText;
			root.querySelector("[data-m-desc]").textContent = info.description || "";
		}

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
							drawers.set(null);
						});
						chips.append(chip);
					});
					group.append(chips);
				}
				nodeList.append(group);
			});
		}

		onResize(pan.viewport, () => {
			const selectedId = chart.selectedId();
			chart = build(svg, { onSelect });
			if (selectedId) {
				chart.select(selectedId);
			}
			pan.apply(false);
		});

		return {
			closeDrawer: () => drawers.set(null)
		};
	}

	// --- Chapter 3 Fervo walk (pages 32-36)
	//
	// Fervo's node as a bar that fills to its avoided share (33-34), its
	// carved chain fading in behind it (35), then desktop's walk chart rippling
	// the avoided emissions through every stage (36). The chart's resting
	// points are beats on desktop's walk timeline.

	function setupImpactsWalk(impacts) {
		const svg = document.querySelector("[data-m-walk-chart]");
		if (!svg || !impacts) {
			return null;
		}
		const section = svg.closest(".m-section");
		const bar = section.querySelector("[data-m-walk-bar]");
		const pctEl = section.querySelector("[data-m-walk-pct]");
		let chart = impacts.walk(svg);
		const clock = { p: 0, fill: 0 };
		let tween = null;

		function paint() {
			chart?.draw(clock.p);
			const pct = clock.fill * 100;
			bar.style.setProperty("--impacts-node-avoided-height", `${pct}%`);
			bar.style.setProperty("--impacts-node-remaining-height", `${100 - pct}%`);
			pctEl.textContent = siteCopy("impacts.avoidedPct", { pct: pct.toFixed(1) });
		}

		function fillFacts() {
			const facts = chart?.facts;
			if (!facts) {
				return;
			}
			section.querySelector("[data-m-walk-name]").textContent = facts.nodeLabel;
			bar.style.setProperty("--impacts-node-color", `var(${facts.stageVar})`);
			section.querySelectorAll("[data-m-walk-sentence]").forEach((el) => {
				el.innerHTML = facts.sentenceHtml;
			});
		}

		function go(topState, animate) {
			if (!chart) {
				return;
			}
			const p = chart.at(topState === "sankey" ? "ripple-cascade" : "avoided-in");
			const fill = topState === "empty" || topState === "bar-0" ? 0 : chart.facts.avoidedRatio;
			tween?.kill();
			if (!animate || reduceMotion || !window.gsap) {
				clock.p = p;
				clock.fill = fill;
				paint();
				return;
			}
			// The ripple through every stage gets more time than the bar filling.
			const duration = Math.abs(p - clock.p) > 0.01 ? 2.4 : 1.2;
			tween = gsap.to(clock, { p, fill, duration, ease: "sine.inOut", onUpdate: paint });
		}

		const rebuild = () => {
			chart = impacts.walk(svg);
			fillFacts();
			paint();
		};
		fillFacts();
		paint();
		// The first build has no avoided data: the chart can't carve yet.
		impacts.ready.then(() => {
			rebuild();
			go(section.dataset.topState, false);
		});
		onResize(svg.parentElement, rebuild);

		return {
			owns: (swiper) => swiper.el.closest(".m-section") === section,
			show(swiper, animate) {
				const slide = swiper.slides[swiper.activeIndex];
				const jump = Math.abs(swiper.activeIndex - (swiper.previousIndex ?? swiper.activeIndex)) > 1;
				go(slide?.dataset.topState, animate && !jump);
			}
		};
	}

	// --- Chapter 3 company explore (pages 38-41)
	//
	// The impacts Sankey carved to one portfolio company's chain, panned like
	// Chapter 1's. It opens on the walk's company; the company list picks
	// another (or, tapping the selected one again, none: the full graph).

	function setupCompanyExplore(impacts, themesModel, mobileSections) {
		const root = document.querySelector('[data-m-explore="companies"]');
		const svg = root?.querySelector("[data-m-explore-chart]");
		if (!svg || !impacts) {
			return null;
		}
		const infoEl = root.querySelector("[data-m-company]");
		const companyList = root.querySelector("[data-m-companylist]");
		const bar = root.querySelector("[data-m-company-bar]");
		const more = root.querySelector("[data-m-company-more]");
		const tabs = [...root.querySelectorAll("[data-m-tab]")];
		const panels = Object.fromEntries(
			[...root.querySelectorAll("[data-m-tab-panel]")].map((el) => [el.dataset.mTabPanel, el])
		);
		const logos = [...root.querySelectorAll("[data-m-company-logo]")];
		logos.forEach((logo) => {
			logo.addEventListener("error", () => {
				logo.hidden = true;
			});
		});

		let selected =
			themesModel.flatMap((theme) => theme.companies).find((company) => company.businessId === impacts.walkCompany) ||
			null;
		let chart = impacts.explore(svg, { company: selected });
		const pan = setupPan(root, () => chart);
		const drawers = setupDrawers(root, mobileSections, (name) => {
			if (name === "companies") {
				fillCompanyList();
			}
		});

		function select(company, animate = true) {
			selected = company;
			chart = impacts.explore(svg, { company });
			fillInfo();
			pan.apply(false);
			focus(animate);
		}

		// The company's own lens first, as far right as the pan goes.
		function focus(animate) {
			if (chart.focusStage) {
				pan.setWindow(chart.focusStage - 1, animate);
			}
		}

		function fillInfo() {
			const facts = chart.facts;
			infoEl.hidden = !facts;
			drawers.toggles.details.hidden = !facts;
			root.classList.toggle("has-selection", Boolean(facts));
			if (!facts) {
				if (drawers.open() === "details") {
					drawers.set(null);
				}
				return;
			}
			root.style.setProperty("--m-stage-color", `var(${facts.nodeStageVar})`);
			logos.forEach((logo) => {
				logo.hidden = false;
				logo.src = facts.logoSrc;
				logo.alt = siteCopy("mobile.explore.logoAlt", { company: selected.label });
			});
			const pct = facts.loading ? 0 : Math.round(facts.avoidedRatio * 100);
			bar.style.setProperty("--impacts-node-color", `var(${facts.nodeStageVar})`);
			bar.style.setProperty("--impacts-node-avoided-height", `${pct}%`);
			bar.style.setProperty("--impacts-node-remaining-height", `${100 - pct}%`);
			root.querySelector("[data-m-company-node]").textContent = facts.nodeLabelText;
			root.querySelector("[data-m-company-pct]").textContent = facts.loading
				? siteCopy("impacts.loading")
				: facts.percentageText;
			root.querySelectorAll("[data-m-company-sentence]").forEach((el) => {
				el.innerHTML = facts.sentenceHtml;
			});
			fillList(panels.analysis, selected.bullets);
			fillList(panels.overview, selected.overview);
			more.hidden = !selected.url;
			more.href = selected.url || "#";
		}

		// Authored copy that may carry inline markup, as on desktop's card.
		function fillList(el, items) {
			el.innerHTML = "";
			(items?.length ? items : [siteCopy("impacts.noDetails")]).forEach((text) => {
				const li = document.createElement("li");
				li.innerHTML = text;
				el.append(li);
			});
		}

		function setTab(id) {
			tabs.forEach((tab) => {
				const active = tab.dataset.mTab === id;
				tab.classList.toggle("is-active", active);
				tab.setAttribute("aria-selected", String(active));
			});
			Object.entries(panels).forEach(([key, el]) => {
				el.hidden = key !== id;
			});
		}
		tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.mTab)));
		setTab("analysis");

		// The company list: one group per theme, in its colour.
		function fillCompanyList() {
			companyList.innerHTML = "";
			themesModel.forEach((theme) => {
				const group = document.createElement("section");
				group.className = "m-companylist__theme";
				group.style.setProperty("--m-theme-color", `var(${THEME_COLOR_VARS[theme.slug] || "--color-white"})`);
				const title = document.createElement("h3");
				title.className = "m-companylist__title";
				title.textContent = theme.label;
				const chips = document.createElement("div");
				chips.className = "m-companylist__chips";
				theme.companies.forEach((company) => {
					const chip = document.createElement("button");
					chip.type = "button";
					chip.className = "m-companylist__chip";
					chip.classList.toggle("is-selected", company === selected);
					chip.setAttribute("aria-pressed", String(company === selected));
					chip.textContent = company.label;
					chip.addEventListener("click", () => {
						select(company === selected ? null : company);
						drawers.set(null);
					});
					chips.append(chip);
				});
				group.append(title, chips);
				companyList.append(group);
			});
		}

		fillInfo();
		focus(false);
		// The first build has no avoided data: it can't carve yet.
		impacts.ready.then(() => select(selected, false));
		onResize(pan.viewport, () => {
			chart = impacts.explore(svg, { company: selected });
			pan.apply(false);
		});

		return {
			closeDrawer: () => drawers.set(null)
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
		explorers.forEach((explorer) => explorer?.closeDrawer()); // a drawer locks the page
		mobileSections.sections[index].swiper.slideTo(0, 0);
		mobileSections.scrollToSection(index);
	}

	let siteCopy = null;
	let explorers = [];

	function init(ctx) {
		siteCopy = ctx.siteCopy;
		fillThemes(ctx.themesModel || []);

		const narrative = setupNarrative(ctx.chapter1?.narrative);
		const finale = setupPortfolioFinale(ctx.portfolioFinale);
		const walk = setupImpactsWalk(ctx.impacts);
		const onSlide = (animate) => (swiper) => {
			syncSlideState(swiper);
			[narrative, finale, walk].forEach((scene) => {
				if (scene?.owns(swiper)) {
					scene.show(swiper, animate);
				}
			});
		};

		const mobileSections = MobileSections.init({
			swiperOptions: {
				on: {
					init: onSlide(false),
					slideChange: onSlide(true)
				}
			}
		});
		explorers = [
			setupExplore(ctx.chapter1?.explore, mobileSections),
			setupCompanyExplore(ctx.impacts, ctx.themesModel || [], mobileSections)
		];

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
