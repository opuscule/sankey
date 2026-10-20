// Mobile view: the one-screen-at-a-time carousel built from the
// <template data-view-variant="mobile"> markup in index.html. Loaded only in
// the mobile view (see the <head> loader); main.js calls MobileSite.init()
// from loadAndRender() once the data is in, passing what this file needs:
//
//   siteCopy          copy lookup (view.js)
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
		mobileSections.sections[index].swiper.slideTo(0, 0);
		mobileSections.scrollToSection(index);
	}

	function init(ctx) {
		fillThemes(ctx.themesModel || []);
		fillLensIndicators();
		document.querySelectorAll("[data-m-walk-sentence]").forEach((el) => {
			el.innerHTML = ctx.walkSentenceHtml || "";
		});

		const mobileSections = MobileSections.init({
			swiperOptions: {
				on: {
					init: syncSlideState,
					slideChange: syncSlideState
				}
			}
		});

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
