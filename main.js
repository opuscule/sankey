(function () {
	const initPath = "init-08192026.json";
	const baselinesPath = "baselines-08192026.json";
	const nodeDetailsPath = "node_details-08192026.json";
	const avoidedPath = "avoided-08192026.json";
	const themesDataPath = initPath;
	const defaultScenario = "2025";
	const chart = document.getElementById("sankey-chart");
	const portfolioChart = document.getElementById("portfolio-sankey-chart");
	const scenarioChart = document.getElementById("scenario-sankey-chart");
	const impactsChart = document.getElementById("impacts-sankey-chart");
	const themesChart = document.getElementById("themes-sankey-chart");
	const timelineChart = document.getElementById("timeline-sankey-chart");
	const statusEl = document.getElementById("sankey-status");
	const narrativeSection = document.getElementById("sankey-narrative");
	const impactsLayoutEl = document.querySelector(".impacts-layout");
	// Queried lazily (not cached at module load): the .viewport-frame div sits
	// after this <script> tag in the DOM, so it doesn't exist yet when this
	// file first parses.
	let viewportFrame = null;
	// .viewport-frame punctuates every "the scene has gone interactive" moment
	// across sections. Each section owns a pair of these plain module
	// bindings (rather than fields on `state`) and flips them from its own
	// scroll handler; updateViewportFrame() just ORs them together. Plain
	// bindings avoid a temporal-dead-zone crash: applyBeatProgress(0) runs
	// synchronously during setupNarrativeBeats(), before `const state` exists.
	let chartIsInteractive = false;
	let narrativeExiting = false;
	let impactsIsInteractive = false;
	let impactsExiting = false;
	function updateViewportFrame() {
		if (!viewportFrame) {
			viewportFrame = document.querySelector(".viewport-frame");
		}
		if (viewportFrame) {
			const sankeyActive = chartIsInteractive && !narrativeExiting;
			const impactsActive = impactsIsInteractive && !impactsExiting;
			viewportFrame.classList.toggle("is-active", sankeyActive || impactsActive);
		}
	}

	// --- Shared math helpers --------------------------------------------------
	const lerp = (start, end, progress) => start + (end - start) * progress;
	const clamp01 = (value) => Math.max(0, Math.min(1, value));
	const smoothstep = (value) => {
		const t = clamp01(value);
		return t * t * (3 - 2 * t);
	};
	// Remap a 0-1 section progress onto a [start, end] sub-window, clamped outside it.
	const windowProgress = (value, [start, end]) => clamp01((value - start) / (end - start || 1));

	// --- Scene timeline (single source of truth) ------------------------------
	// One scroll clock drives both the copy beats and the Sankey choreography.
	// Each scene owns a [start, end] window in percent (0-100) of the
	// #sankey-narrative scroll range. `phase` names the graphic state handled in
	// drawMaster; `copy` is the narrative snippet shown in the left column.
	// Storyboard reference: "TIF Sankey Mock-up 8_med.pdf" pages 6-19.
	const SCENES = [
		{
			id: "beat-1",
			phase: "one-bar",
			start: 0,
			end: 9,
			variant: "headline",
			copy: '<span class="headline-plain">In 2025, global emissions totaled <strong>54 Gt of CO2e</strong>.</span>'
		},
		{
			id: "beat-2",
			phase: "fan-out",
			start: 9,
			end: 17,
			copy: "Transitioning to a low-carbon economy requires understanding the origin of these emissions."
		},
		{
			id: "beat-3",
			phase: "wipe-reveal",
			start: 17,
			end: 27,
			copy: "Total emissions can be viewed through seven different lenses."
		},
		{
			id: "beat-4",
			phase: "hold-services",
			start: 27,
			end: 34,
			copy: 'These lenses include the <span class="kw kw-final-service">final services</span> provided to us, such as travel and food.'
		},
		{
			id: "beat-5",
			phase: "hold-lenses",
			start: 34,
			end: 43,
			copy: 'They also include the economic <span class="kw kw-sector">sectors</span> that provide those final services, the <span class="kw kw-equipment">equipment</span> that composes each sector, the <span class="kw kw-device">devices</span> that make up equipment, the <span class="kw kw-final-energy">final energy</span> that powers devices, <span class="kw kw-fuel">fuels</span> we use, and the type of greenhouse gas <span class="kw kw-emissions">emissions</span>.'
		},
		{
			id: "beat-6",
			phase: "collapse",
			start: 43,
			end: 52,
			copy: "Each lens is inclusive of all the world&rsquo;s emissions."
		},
		{
			id: "beat-7",
			phase: "unstack",
			start: 52,
			end: 64,
			copy: "Emissions can be <strong>traced between lenses</strong> as they <strong>flow through the global economy</strong>."
		},
		{
			id: "beat-8",
			phase: "expand",
			start: 64,
			end: 77,
			copy: 'Each lens can be broken down into nodes, such as <strong>travel</strong> and <strong>food</strong> when looking through the lens of <span class="kw kw-final-service">final services</span>.'
		},
		{
			id: "beat-9",
			phase: "lens-focus",
			start: 77,
			end: 84,
			copy: '<strong>Together, all the nodes for one lens sum to global <span class="kw kw-emissions">emissions</span>.</strong>'
		},
		{
			id: "beat-10",
			phase: "cars-example",
			start: 84,
			end: 96,
			copy: 'Flows between neighboring nodes show how <strong>emissions are connected across lenses</strong>, with the width of the flow reflecting the magnitude of such connections.<br><br>For example, of the 6 Gt CO2e due to <span class="kw kw-sector">Passenger Transport</span>, 4.4 Gt are due to <span class="kw kw-equipment">cars</span>.'
		},
		{
			id: "beat-11",
			phase: "explore",
			start: 96,
			end: 100,
			copy: "<strong>Select any node</strong> for yourself to see the amount of emissions it contributes today and how it connects to others."
		}
	];

	const SCENE_BOUNDS = {};
	SCENES.forEach((scene) => {
		SCENE_BOUNDS[scene.phase] = { start: scene.start / 100, end: scene.end / 100 };
	});

	// Local progress (0-1) within one scene's window, clamped outside it.
	const sceneT = (p, phase) => {
		const bounds = SCENE_BOUNDS[phase];
		if (!bounds) {
			return 0;
		}
		return clamp01((p - bounds.start) / (bounds.end - bounds.start));
	};

	// Total scroll length of the narrative section, in px. Longer distance =
	// more breathing room per scene.
	const NARRATIVE_SCROLL_DISTANCE = 10400;

	// The final HOLD_TAIL fraction of the section is a pinned hold on the
	// finished interactive chart — the user keeps scrolling but nothing moves,
	// emphasizing that the Sankey is now theirs to explore before the page
	// releases to the next section. Scene windows map onto the first
	// (1 - HOLD_TAIL) of the scroll.
	const HOLD_TAIL = 0.15;
	const ANIM_SPAN = 1 - HOLD_TAIL;

	// Raw scroll progress (0-1, full "top top" to "bottom bottom" range) where
	// the pinned narrative starts fading out, finishing exactly at 1 so it is
	// already invisible before it un-pins and would otherwise scroll up.
	const NARRATIVE_EXIT_START = 0.94;

	// --- Dev scrub (?p=0.47) ---------------------------------------------------
	// Lets QA land on an exact master progress without fighting an 11000px
	// sticky scroll. Keyboard: [ and ] step by 0.01 (shift: 0.002).
	const DEV_SCRUB = (() => {
		try {
			const raw = new URLSearchParams(window.location.search).get("p");
			if (raw === null) {
				return null;
			}
			const parsed = Number.parseFloat(raw);
			return Number.isFinite(parsed) ? clamp01(parsed) : 0;
		} catch (err) {
			return null;
		}
	})();

	// ?select=3_Car (dev scrub only): auto-select a node after render so the
	// chain isolation can be screenshotted headlessly. Pair with ?p=1.
	const DEV_SELECT = (() => {
		if (DEV_SCRUB === null) {
			return null;
		}
		try {
			return new URLSearchParams(window.location.search).get("select");
		} catch (err) {
			return null;
		}
	})();

	const devState = { progress: DEV_SCRUB ?? 0, beatsHook: null, chartHook: null, readout: null };

	const devApply = () => {
		if (DEV_SCRUB === null) {
			return;
		}
		if (!devState.readout) {
			const readout = document.createElement("div");
			readout.id = "sankey-scrub-readout";
			readout.style.cssText =
				"position:fixed;left:12px;bottom:12px;z-index:99;padding:6px 10px;background:rgba(0,0,0,0.75);color:#9f9;font:12px/1.4 monospace;pointer-events:none;";
			document.body.appendChild(readout);
			devState.readout = readout;
		}
		devState.readout.textContent = `p = ${devState.progress.toFixed(3)}  ( [ / ] to step )`;
		if (devState.beatsHook) {
			devState.beatsHook(devState.progress);
		}
		if (devState.chartHook) {
			devState.chartHook(devState.progress);
		}
	};

	if (DEV_SCRUB !== null) {
		// Collapse everything before the narrative section so the scrubbed state
		// is visible at the top of the page (headless screenshots always capture
		// the document origin).
		document.documentElement.classList.add("dev-scrub");
		window.__sankeyScrub = (value) => {
			devState.progress = clamp01(Number.parseFloat(value) || 0);
			devApply();
		};
		window.addEventListener("keydown", (event) => {
			if (event.key !== "[" && event.key !== "]") {
				return;
			}
			const step = event.shiftKey ? 0.002 : 0.01;
			window.__sankeyScrub(devState.progress + (event.key === "]" ? step : -step));
		});
	}

	function setupNarrativeBeats() {
		const copyContainer = narrativeSection
			? narrativeSection.querySelector(".sankey-copy")
			: null;
		const sankeyLayoutEl = narrativeSection
			? narrativeSection.querySelector(".sankey-layout")
			: null;

		if (!copyContainer || !SCENES.length) {
			return;
		}

		copyContainer.innerHTML = "";
		const beatEls = SCENES.map((scene) => {
			const el = document.createElement("p");
			el.className =
				scene.variant === "headline"
					? "sankey-snippet sankey-snippet--headline"
					: "sankey-snippet";
			el.id = scene.id;
			el.innerHTML = scene.copy;
			copyContainer.appendChild(el);
			return el;
		});

		narrativeSection.style.setProperty("--sankey-snippet-count", String(SCENES.length));
		narrativeSection.style.setProperty("--sankey-scroll-distance", `${NARRATIVE_SCROLL_DISTANCE}px`);

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
			beatEls.forEach((el) => {
				el.style.opacity = "";
				el.style.visibility = "";
			});
			return;
		}

		// Fade shape applied within each beat's own [start, end] window.
		const fadeInPortion = 0.15;
		const fadeOutStart = 0.85;

		const lastBeatEnd = SCENES[SCENES.length - 1].end;

		const getBeatOpacity = (globalPercent, beat) => {
			const span = beat.end - beat.start;
			if (span <= 0) {
				return 0;
			}
			const localProgress = (globalPercent - beat.start) / span;
			if (localProgress <= 0) {
				return 0;
			}
			// Final beat is the "pause and explore" moment: hold it fully visible
			// through the end of the scroll instead of fading it back out.
			if (localProgress >= 1) {
				return beat.end >= lastBeatEnd ? 1 : 0;
			}
			if (localProgress < fadeInPortion) {
				return localProgress / fadeInPortion;
			}
			if (localProgress <= fadeOutStart) {
				return 1;
			}
			if (beat.end >= lastBeatEnd) {
				return 1;
			}
			return (1 - localProgress) / (1 - fadeOutStart);
		};

		const applyBeatProgress = (progress) => {
			const globalPercent = clamp01(progress / ANIM_SPAN) * 100;
			beatEls.forEach((el, index) => {
				const opacity = Math.max(0, Math.min(1, getBeatOpacity(globalPercent, SCENES[index])));
				gsap.set(el, { autoAlpha: opacity, filter: "blur(0px)" });
			});

			// Fade the whole pinned narrative out at the very end of its scroll
			// runway (linear, no ease -- matches the beat fades above) so it is
			// invisible by the time it un-pins, instead of visibly scrolling up.
			const exitT = clamp01((progress - NARRATIVE_EXIT_START) / (1 - NARRATIVE_EXIT_START));
			narrativeExiting = exitT > 0;
			if (sankeyLayoutEl) {
				gsap.set(sankeyLayoutEl, { opacity: 1 - exitT });
			}
			updateViewportFrame();
		};

		gsap.set(beatEls, { autoAlpha: 0, filter: "blur(0px)" });
		applyBeatProgress(0);

		if (DEV_SCRUB !== null) {
			devState.beatsHook = applyBeatProgress;
			devApply();
			return;
		}

		ScrollTrigger.create({
			trigger: "#sankey-narrative",
			start: "top top",
			end: "bottom bottom",
			onUpdate: (self) => applyBeatProgress(self.progress)
		});
	}

	// --- Selected-node info panel (left copy column) ----------------------
	function getNodePanel() {
		if (state.nodePanel) {
			return state.nodePanel;
		}
		const copy = document.querySelector("#sankey-narrative .sankey-copy");
		if (!copy) {
			return null;
		}
		const root = document.createElement("div");
		root.className = "sankey-node-panel";
		root.setAttribute("aria-live", "polite");
		root.innerHTML =
			'<h3 class="node-panel__title">' +
			'<span class="node-panel__stage"></span>' +
			'<span class="node-panel__sep"> / </span>' +
			'<span class="node-panel__name"></span>' +
			"</h3>" +
			'<p class="node-panel__desc"></p>' +
			'<div class="node-panel__callout">' +
			'<div class="node-panel__throughput"></div>' +
			'<div class="node-panel__share"></div>' +
			"</div>";
		copy.appendChild(root);
		state.nodePanel = {
			root,
			title: root.querySelector(".node-panel__title"),
			stage: root.querySelector(".node-panel__stage"),
			name: root.querySelector(".node-panel__name"),
			desc: root.querySelector(".node-panel__desc"),
			throughput: root.querySelector(".node-panel__throughput"),
			share: root.querySelector(".node-panel__share")
		};
		return state.nodePanel;
	}

	function showNodePanel(info) {
		const panel = getNodePanel();
		if (!panel) {
			return;
		}
		panel.stage.textContent = info.stageLabel;
		panel.name.textContent = info.name;
		panel.title.style.color = info.stageVar ? `var(${info.stageVar})` : "";
		panel.desc.textContent = info.description || "";
		panel.throughput.textContent = `${fmtMt(info.throughputMt / 1000)} Gt`;
		panel.share.textContent = `${d3.format(".1f")(info.sharePct)}% of ${info.stageLabel}`;
		panel.root.classList.add("is-visible");
		const copy = document.querySelector("#sankey-narrative .sankey-copy");
		if (copy) {
			copy.classList.add("node-selected");
		}
	}

	function hideNodePanel() {
		if (state.nodePanel) {
			state.nodePanel.root.classList.remove("is-visible");
		}
		const copy = document.querySelector("#sankey-narrative .sankey-copy");
		if (copy) {
			copy.classList.remove("node-selected");
		}
	}

	setupNarrativeBeats();

	if (!chart || !statusEl || !window.d3 || !d3.sankey) {
		return;
	}

	const stageColorVars = {
		1: "--color-final-service",
		2: "--color-sector",
		3: "--color-equipment",
		4: "--color-device",
		5: "--color-final-energy",
		6: "--color-fuel",
		7: "--color-emissions"
	};

	// Per-stage asset slug + human label. The `{slug}.svg` files are the designed
	// title cards (color bar + vector wordmark); `{slug}.webp` are the photo covers.
	const STAGE_META = {
		1: { slug: "final-service", label: "Final Service" },
		2: { slug: "sector", label: "Sector" },
		3: { slug: "equipment", label: "Equipment" },
		4: { slug: "device", label: "Device" },
		5: { slug: "final-energy", label: "Final Energy" },
		6: { slug: "fuel", label: "Fuel" },
		7: { slug: "emissions", label: "Emissions" }
	};

	const nodeIdAliases = {
		"5_Cement Kiln": "5_(Cement kiln)",
		"5_Chemical use": "5_(Chemical use)",
		"5_Waste": "5_(Waste)",
		// Early node_details.json drops used ids that don't exist in
		// init/baselines. Fixed in the 2026-07-06 drop; kept as a cheap defense
		// against regressions in future bundles.
		"1_Personal travel": "1_Travel",
		"6_Land-use change": "6_Land use change"
	};

	const state = {
		nodes: [],
		links: [],
		initData: null,
		baselinesData: null,
		selectedNodeId: null,
		rendered: null,
		sankeyInteractive: false,
		portfolioRendered: null,
		scenarioRendered: null,
		impactsRendered: null,
		impactsScenarioId: "enacted-policies",
		impactsBusinessId: "",
		impactsCompanyKey: "",
		impactsRosterIndex: new Map(),
		impactsCard: null,
		impactsWalkRendered: null,
		impactsWalkCopy: null,
		impactsWalkProgress: 0,
		impactsWalkPreselected: false,
		impactsWalkChartStale: false,
		impactsHandedOff: false,
		impactsTabId: "avoided",
		avoidedData: null,
		avoidedPromise: null,
		portfolioBusinessNodeMap: new Map(),
		nodeDetails: null,
		nodeDetailsPromise: null,
		introAssets: null,
		nodePanel: null,
		themesData: null,
		themesPromise: null,
		themesModel: null,
		themesRendered: null,
		themesProgress: 0,
		themesLeadEl: null,
		themesFinaleLeadEl: null,
		finaleOrder: null,
		timelineRendered: null,
		timelineProgress: 0
	};

	const fmtMt = d3.format(",.2f");
	const fmtPct = d3.format(".2f");
	const linkGradientId = (sourceStage, targetStage) => `link-gradient-${sourceStage}-${targetStage}`;
	const portfolioLinkGradientId = (sourceStage, targetStage) =>
		`portfolio-link-gradient-${sourceStage}-${targetStage}`;
	const classSlug = (value) =>
		String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown";

	// Populated from init's intervention.companies roster by
	// buildPortfolioBusinessNodeMap(), so adding a company is a data-only change.
	const supportedPortfolioBusinesses = new Set();

	// Filenames are company-name slugs, which do not always match the businessId
	// (e.g. "whisperaero" -> whisper-aero.webp). Static hosting is case-sensitive
	// even though macOS is not — keep these exact.
	const impactsLogoByBusiness = {
		"fervo": "logos/fervo-energy.webp",
		"electric-hydrogen": "logos/electric-hydrogen.webp",
		"propel-aero": "logos/propel-aero.webp",
		"redwood-materials": "logos/redwood-materials.webp",
		"whisperaero": "logos/whisper-aero.webp",
		"harbingermotors": "logos/harbinger.webp",
		"heronpower": "logos/heron-power.webp",
		"seurat": "logos/seurat.webp",
		"quantumscape": "logos/quantum-scape.webp",
		"span": "logos/span.webp",
		"navitas": "logos/navitas-semiconductor.webp",
		"jobyaviation": "logos/joby.webp",
		"electra": "logos/electra.webp",
		"limelightsteel": "logos/limelight-steel.webp",
		"helion": "logos/helion.webp",
		"chement": "logos/chement.webp",
		"erthos": "logos/erthos.webp",
		"formenergy": "logos/form-energy.webp",
		"magratheametals": "logos/magrathea.webp",
		"summitnanotech": "logos/summit-nanotech.webp",
		"twelve": "logos/twelve.webp"
	};

	const impactsLogoFallback = "https://placehold.co/240x60?text=logo";

	const impactsNodeLabelByBusiness = {
		"fervo": "Electricty and heat",
		"propel-aero": "Plane"
	};

	const scenarioKeyById = {
		"enacted-policies": "2040A"
	};
	const warnedMissingScenarioKeys = new Set();

	// Total 2040 emissions (GT) per scenario, matching the on-page copy. Drives
	// the scenario Sankey's vertical scale: the tallest scenario (60 GT) fills the
	// full chart height and lower-total scenarios shrink proportionally, so column
	// height reads as an absolute GT quantity instead of always filling the frame.
	// `null` = not yet defined (renders at full height as a neutral fallback).
	const scenarioTotalsGt = {
		"enacted-policies": 60
	};
	const SCENARIO_MAX_GT = 60;
	// Reference-axis gridlines, kept independent of which scenarios ship data.
	const SCENARIO_AXIS_TICKS_GT = [46, 60];

	function scenarioGtFor(scenarioId) {
		const gt = scenarioTotalsGt[scenarioId];
		return Number.isFinite(gt) ? gt : null;
	}

	// Previous-render link geometry (per link id) so scenario switches can tween
	// the ribbon paths (SVG path `d` strings don't interpolate on their own).
	let scenarioLinkGeom = new Map();

	// --- Climate Impacts (avoided emissions) ---------------------------------
	// The impacts view is fixed to 2040A (Enacted Policies) in this version.
	// Selecting a company narrows to that company's connected avoided-emissions
	// subgraph; non-mapped companies keep the full baseline graph and show
	// a no-data details state in the left column card.
	const IMPACTS_SCENARIO_ID = "enacted-policies";

	// --- Impacts walkthrough choreography ------------------------------------
	// Beats are authored as scroll DURATIONS in vh, not as percentages: `hold`
	// dwells on the previous state, `vh` is the length of this beat's transition.
	// The total runway is therefore an OUTPUT of the table, which means beats can
	// be retimed without renumbering every downstream percentage.
	const IMPACTS_WALK_COMPANY = "fervo";
	const IMPACTS_WALK_BEATS = [
		{ id: "copy-in", hold: 0, vh: 60 },
		{ id: "chart-in", hold: 32, vh: 60 },
		{ id: "carve-morph", hold: 48, vh: 96 },
		{ id: "node-visual-in", hold: 40, vh: 64 },
		{ id: "copy1-out", hold: 40, vh: 40 },
		{ id: "avoided-in", hold: 0, vh: 60 },
		{ id: "copy2-in", hold: 32, vh: 48 },
		// Copy 2 is a full sentence, so it needs its own dwell before leaving;
		// without this hold it fades straight back out and is unreadable.
		{ id: "copy2-out", hold: 48, vh: 48 },
		{ id: "copy3-in", hold: 28, vh: 52 },
		{ id: "ripple-final-service", hold: 0, vh: 24 },
		{ id: "ripple-cascade", hold: 0, vh: 136 },
		{ id: "copy3-out", hold: 40, vh: 40 },
		{ id: "copy4-in", hold: 0, vh: 48 },
		{ id: "roster-in", hold: 40, vh: 60 },
		{ id: "company-bold", hold: 0, vh: 20 },
		{ id: "card-reveal", hold: 0, vh: 60 },
		// Interaction unlocks the instant the card finishes revealing, so this
		// dwell is the beat's `vh`, not a leading `hold`. A leading hold here
		// would push the handoff's start to 1.0 and make the roster and tabs
		// clickable only at the very last pixel of the runway.
		{ id: "handoff", hold: 0, vh: 120 }
	];
	const IMPACTS_WALK_TOTAL_VH = IMPACTS_WALK_BEATS.reduce(
		(total, beat) => total + beat.hold + beat.vh,
		0
	);
	const IMPACTS_WALK_BOUNDS = {};
	{
		let cursor = 0;
		IMPACTS_WALK_BEATS.forEach((beat) => {
			cursor += beat.hold;
			const start = cursor / IMPACTS_WALK_TOTAL_VH;
			cursor += beat.vh;
			IMPACTS_WALK_BOUNDS[beat.id] = { start, end: cursor / IMPACTS_WALK_TOTAL_VH };
		});
	}
	// Raw progress (0-1) within .impacts-walk's own scroll runway where the
	// pinned .impacts-layout starts fading out, finishing at 1 so it is
	// already invisible before it un-pins and would otherwise scroll up. The
	// "handoff" beat above starts the interactive dwell at ~0.913, so this
	// leaves room to explore before the fade begins.
	const IMPACTS_EXIT_START = 0.965;

	// Section progress -> 0-1 progress within a single named beat.
	const walkT = (p, id) => {
		const bounds = IMPACTS_WALK_BOUNDS[id];
		if (!bounds) {
			return 0;
		}
		if (bounds.end <= bounds.start) {
			return p >= bounds.start ? 1 : 0;
		}
		return clamp01((p - bounds.start) / (bounds.end - bounds.start));
	};
	// Cascade order for the ripple beats. Final Energy (5) is deliberately absent:
	// it is the origin stage and already carries its avoided cap by then.
	const IMPACTS_RIPPLE_STAGES = [2, 3, 4, 6, 7];

	// Resolve the avoided.json company key (e.g. "FervoEnergy") for a normalized
	// business slug (e.g. "fervo"). Returns null until avoided.json has loaded.
	function avoidedCompanyKeyForBusiness(businessId) {
		const data = state.avoidedData;
		if (!data || !businessId) {
			return null;
		}
		for (const key of Object.keys(data)) {
			if (normalizeBusinessSlug(key) === businessId) {
				return key;
			}
		}
		return null;
	}

	// Map of "sourceId|targetId" -> avoided value for the company under
	// scenarioKey (positive values only), normalized onto the rendered node ids.
	function avoidedValueMapForCompany(companyKey, scenarioKey, nodeById) {
		const company = state.avoidedData?.[companyKey];
		const rawLinks = Array.isArray(company?.links) ? company.links : [];
		const map = new Map();
		for (const link of rawLinks) {
			const value = toFiniteNumber(link?.[scenarioKey]?.value, 0);
			if (value <= 0) {
				continue;
			}
			const sourceId = normalizeNodeId(link?.source, nodeById);
			const targetId = normalizeNodeId(link?.target, nodeById);
			if (!nodeById.has(sourceId) || !nodeById.has(targetId)) {
				continue;
			}
			map.set(`${sourceId}|${targetId}`, value);
		}
		return map;
	}

	// Builds a closed area path for a ribbon band between a top and bottom edge,
	// matching d3-sankey's horizontal cubic curve. Lets us fill the "remaining"
	// band and outline the "avoided" band (a stroke-only empty region).
	function impactsRibbonArea(sx, tx, sTop, sBot, tTop, tBot) {
		const mx = (sx + tx) / 2;
		return (
			`M${sx},${sTop}` +
			`C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}` +
			`L${tx},${tBot}` +
			`C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}` +
			`Z`
		);
	}

	function resolveScenarioRequest(rawScenarioId) {
		const scenarioId = Object.prototype.hasOwnProperty.call(scenarioKeyById, rawScenarioId)
			? rawScenarioId
			: "enacted-policies";
		const requestedScenarioKey = scenarioKeyById[scenarioId] || scenarioKeyById["enacted-policies"];
		const availableScenarios = Array.isArray(state.baselinesData?.scenarios)
			? state.baselinesData.scenarios
			: [];
		const enactedScenarioKey = scenarioKeyById["enacted-policies"];

		const resolvedScenarioKey = availableScenarios.includes(requestedScenarioKey)
			? requestedScenarioKey
			: availableScenarios.includes(enactedScenarioKey)
				? enactedScenarioKey
				: availableScenarios[0] || requestedScenarioKey;

		if (resolvedScenarioKey !== requestedScenarioKey && !warnedMissingScenarioKeys.has(requestedScenarioKey)) {
			warnedMissingScenarioKeys.add(requestedScenarioKey);
			console.warn(
				`[Sankey] Scenario "${requestedScenarioKey}" not yet available; using "${resolvedScenarioKey}" for now.`
			);
		}

		return {
			scenarioId,
			requestedScenarioKey,
			resolvedScenarioKey,
			enactedScenarioKey
		};
	}

	const toFiniteNumber = (value, fallback = 0) => {
		const parsed = Number.parseFloat(String(value ?? "").trim());
		return Number.isFinite(parsed) ? parsed : fallback;
	};

	const deriveLabelFromId = (rawId) => {
		const id = String(rawId || "").trim();
		const firstUnderscore = id.indexOf("_");
		if (firstUnderscore === -1) {
			return id;
		}
		return id.slice(firstUnderscore + 1);
	};

	const deriveStageFromId = (rawId) => {
		const id = String(rawId || "").trim();
		const firstUnderscore = id.indexOf("_");
		if (firstUnderscore === -1) {
			return 0;
		}

		const stage = Number.parseInt(id.slice(0, firstUnderscore), 10);
		return Number.isFinite(stage) ? stage : 0;
	};

	const nodeQualityScore = (node) => {
		let score = 0;
		if ((node.description || "").trim()) {
			score += 4;
		}
		if (Number.isFinite(node.group) && node.group !== 0) {
			score += 3;
		}
		if (Number.isFinite(node.order) && node.order < 900) {
			score += 2;
		}
		if (Number.isFinite(node.layer) && node.layer > 0) {
			score += 1;
		}
		if (Array.isArray(node.keywords) && node.keywords.length > 0) {
			score += 1;
		}
		return score;
	};

	const normalizeNodeId = (rawId, nodeById) => {
		const id = String(rawId || "").trim();
		if (!id) {
			return "";
		}

		if (nodeById.has(id)) {
			return id;
		}

		const aliased = nodeIdAliases[id];
		if (aliased && nodeById.has(aliased)) {
			return aliased;
		}

		return id;
	};

	// --- Intro title-card assets -----------------------------------------------
	// Each {slug}.svg bundles one plain-rect bar subpath ("M{x} {y}h{w}v{h}h-{w}z",
	// or the absolute-close variant "...H{x}z") with the wordmark letterforms, all
	// in a single fill. Bar size varies per asset, and some letterforms are
	// themselves small rects (e.g. "I"), so every path is scanned for rect
	// candidates and the tallest one wins -- a stray letter-rect is always much
	// shorter than the real bar. We split the bar out at parse time so the bar
	// rect can morph independently of the wordmark, and recolor everything with
	// the official palette CSS vars (the shipped asset fills are slightly
	// off-palette or, for newer assets, unset).
	async function loadIntroAssets() {
		const parser = new DOMParser();
		const barPattern = /M([\d.]+)[ ,]([\d.]+)h([\d.]+)v([\d.]+)(?:h-\3|H\1)z/g;

		const entries = await Promise.all(
			Object.entries(STAGE_META).map(async ([stageRaw, meta]) => {
				const stage = Number.parseInt(stageRaw, 10);
				try {
					const response = await fetch(`${meta.slug}.svg`);
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}
					const text = await response.text();
					const doc = parser.parseFromString(text, "image/svg+xml");
					const svg = doc.querySelector("svg");
					if (!svg) {
						throw new Error("no <svg> root");
					}
					const viewBoxParts = (svg.getAttribute("viewBox") || "0 0 100 410")
						.trim()
						.split(/\s+/)
						.map(Number);
					const viewBox = { width: viewBoxParts[2] || 100, height: viewBoxParts[3] || 410 };

					const paths = Array.from(doc.querySelectorAll("path"));
					let bestCandidate = null;
					paths.forEach((path, pathIndex) => {
						const d = path.getAttribute("d") || "";
						for (const match of d.matchAll(barPattern)) {
							const height = Number.parseFloat(match[4]);
							if (!bestCandidate || height > bestCandidate.height) {
								bestCandidate = {
									pathIndex,
									match: match[0],
									x: Number.parseFloat(match[1]),
									y: Number.parseFloat(match[2]),
									width: Number.parseFloat(match[3]),
									height
								};
							}
						}
					});

					if (!bestCandidate) {
						throw new Error("bar subpath not found");
					}

					const bar = {
						x: bestCandidate.x,
						y: bestCandidate.y,
						width: bestCandidate.width,
						height: bestCandidate.height
					};
					const markPaths = [];
					paths.forEach((path, pathIndex) => {
						let d = path.getAttribute("d") || "";
						if (pathIndex === bestCandidate.pathIndex) {
							d = d.replace(bestCandidate.match, "").trim();
						}
						if (d) {
							markPaths.push(d);
						}
					});

					return [stage, { viewBox, bar, markPaths }];
				} catch (err) {
					console.warn(`[Sankey] Could not load intro asset ${meta.slug}.svg:`, err);
					return [stage, null];
				}
			})
		);

		return new Map(entries);
	}

	loadAndRender().catch((err) => {
		console.error(err);
		statusEl.textContent = "Could not load Sankey data";
	});

	async function loadAndRender() {
		const [initResponse, baselinesResponse, introAssets] = await Promise.all([
			fetch(initPath),
			fetch(baselinesPath),
			loadIntroAssets()
		]);

		if (!initResponse.ok) {
			throw new Error(`Failed to fetch ${initPath}: ${initResponse.status}`);
		}
		if (!baselinesResponse.ok) {
			throw new Error(`Failed to fetch ${baselinesPath}: ${baselinesResponse.status}`);
		}

		const [initData, baselinesData] = await Promise.all([
			initResponse.json(),
			baselinesResponse.json()
		]);

		state.introAssets = introAssets;
		state.initData = initData;
		state.baselinesData = baselinesData;

		const graph = buildGraph(initData, baselinesData, defaultScenario);
		state.nodes = graph.nodes;
		state.links = graph.links;
		state.portfolioBusinessNodeMap = buildPortfolioBusinessNodeMap(initData);

		if (!state.nodes.length || !state.links.length) {
			statusEl.textContent = `No positive flows found for scenario ${graph.scenario}`;
			return;
		}

		render();
		renderPortfolioSankey();
		renderScenarioSankey(window.currentScenarioId || "enacted-policies");
		setupImpactsBusinessSync();
		setupPortfolioBusinessSync();
		setupScenarioSync();
		setupLeadFades();
		setupScenarioLeadFades();
		initHeroCopyIntroSection();
		initImpactsIntroSection();
		initImpactsWalk();
		initClosingTransitionSection();
		setupAcknowledgementsVideoScrub();
		initThemesSection();
		initTimelineIntroSection();
		initTimelineSection();
		initPortfolioIntroSection();
		setupBottomStickyNav();
		setupResize();
		statusEl.textContent = "Click a node to isolate direct flows";
	}

	// Boundaries used for the bottom-nav scroll-spy active state.
	const NAV_GROUPS = [
		{ group: "global-emissions", startSelector: "#global-emissions-picture", endSelector: "#tif-tgif-portfolio" },
		{ group: "portfolio", startSelector: "#tif-tgif-portfolio", endSelector: "#climate-impacts" },
		{ group: "climate-impacts", startSelector: "#climate-impacts", endSelector: "#acknowledgements-citations" },
		{ group: "acknowledgements", startSelector: "#acknowledgements-citations", endSelector: null }
	];

	// Cached per-group link widths (px) and each group's last-known scroll progress (0-1).
	const navProgressWidths = {};
	const navProgressByGroup = {};

	function measureNavProgressGeometry() {
		const list = document.querySelector(".bottom-sticky-nav__list");
		if (!list) {
			return;
		}

		const listLeft = list.getBoundingClientRect().left;
		let firstLinkLeft = null;

		NAV_GROUPS.forEach(({ group }) => {
			const item = list.querySelector(`[data-nav-group="${group}"]`);
			if (!item) {
				return;
			}
			const li = item.closest("li");
			const rect = (li || item).getBoundingClientRect();
			navProgressWidths[group] = rect.width;
			if (firstLinkLeft === null) {
				firstLinkLeft = rect.left - listLeft;
			}
		});

		list.style.setProperty("--nav-progress-left", `${firstLinkLeft || 0}px`);
		updateNavProgressBar();
	}

	function updateNavProgressBar() {
		const list = document.querySelector(".bottom-sticky-nav__list");
		if (!list) {
			return;
		}

		const totalPx = NAV_GROUPS.reduce((sum, { group }) => {
			const width = navProgressWidths[group] || 0;
			const progress = Math.min(Math.max(navProgressByGroup[group] || 0, 0), 1);
			return sum + width * progress;
		}, 0);

		list.style.setProperty("--nav-progress-width", `${totalPx}px`);
	}

	function setupBottomStickyNav() {
		const nav = document.querySelector(".bottom-sticky-nav");
		const portfolioSection = document.querySelector("#tif-tgif-portfolio");
		if (!nav || !portfolioSection) {
			return;
		}

		if (!window.gsap || !window.ScrollTrigger) {
			nav.classList.add("is-visible");
			return;
		}

		ScrollTrigger.create({
			trigger: portfolioSection,
			start: "top center",
			onEnter: () => nav.classList.add("is-visible"),
			onLeaveBack: () => nav.classList.remove("is-visible")
		});

		measureNavProgressGeometry();

		NAV_GROUPS.forEach(({ group, startSelector, endSelector }) => {
			const item = nav.querySelector(`[data-nav-group="${group}"]`);
			const startEl = document.querySelector(startSelector);
			const endEl = endSelector ? document.querySelector(endSelector) : null;
			if (!item || !startEl) {
				return;
			}

			ScrollTrigger.create({
				trigger: startEl,
				start: "top center",
				// document.body is unreliable as an endTrigger (GSAP treats it ambiguously as the scroller);
				// fall back to the section's own bottom hitting the viewport bottom instead.
				endTrigger: endEl || startEl,
				end: endEl ? "top center" : "bottom bottom",
				onToggle: (self) => item.classList.toggle("is-active", self.isActive),
				onUpdate: (self) => {
					navProgressByGroup[group] = self.progress;
					updateNavProgressBar();
				}
			});
		});
	}

	function normalizeBusinessSlug(rawValue) {
		const slug = String(rawValue || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");

		if (!slug) {
			return "";
		}
		if (slug.includes("fervo")) {
			return "fervo";
		}
		if (slug.includes("propel")) {
			return "propel-aero";
		}
		if (slug.includes("electric") && slug.includes("hydrogen")) {
			return "electric-hydrogen";
		}
		if (slug.includes("redwood")) {
			return "redwood-materials";
		}

		return slug;
	}

	function buildPortfolioBusinessNodeMap(initData) {
		const map = new Map();

		const companies = initData?.intervention?.companies;
		if (!Array.isArray(companies)) {
			return map;
		}

		for (const company of companies) {
			const businessId = normalizeBusinessSlug(company?.company || company?.company_label);
			if (!businessId) {
				continue;
			}

			supportedPortfolioBusinesses.add(businessId);

			// null for the companies whose placement is a multi-node "flow".
			const nodeId = String(company?.node || "").trim();
			map.set(businessId, nodeId || null);
		}

		return map;
	}

	// Derive a sensible label cap from the actual column spacing so labels never
	// run into the neighbouring column. minGap is the horizontal distance between
	// adjacent columns; we subtract the node width plus a little breathing room.
	function computeLabelMaxWidth(graph, fallback = 180) {
		const xs = Array.from(new Set(graph.nodes.map((n) => Math.round(n.x0)))).sort((a, b) => a - b);
		let minGap = Infinity;
		for (let i = 1; i < xs.length; i += 1) {
			minGap = Math.min(minGap, xs[i] - xs[i - 1]);
		}
		if (!Number.isFinite(minGap)) {
			return fallback;
		}
		return Math.max(72, minGap - 32);
	}

	// Column x-extents per stage (all nodes in a stage share the same x0/x1).
	// Used to anchor link gradients in user space instead of the referencing
	// path's bounding box — a perfectly horizontal link has a zero-height bbox,
	// and objectBoundingBox gradients are not painted on a zero-area box (so the
	// top-line links would silently disappear).
	function stageXBounds(graph) {
		const map = new Map();
		graph.nodes.forEach((node) => {
			if (!map.has(node.stage)) {
				map.set(node.stage, { x0: node.x0, x1: node.x1 });
			}
		});
		return map;
	}

	// Spread each stage's nodes to fill the vertical extent [top, bottom] so every
	// column aligns top *and* bottom; node heights (value) stay the same, the
	// slack is distributed as equal gaps between nodes. Mutates node/link y in
	// place. Shared by any sankey that wants full-height, top/bottom-aligned columns.
	function spreadStageHeights(graph, top, bottom) {
		const extentHeight = bottom - top;
		const deltaByNode = new Map();
		d3.group(graph.nodes, (node) => node.stage).forEach((stageNodes) => {
			const ordered = stageNodes.slice().sort((a, b) => a.y0 - b.y0);
			const count = ordered.length;
			const totalHeight = d3.sum(ordered, (node) => node.y1 - node.y0);
			const slack = Math.max(0, extentHeight - totalHeight);

			if (count === 1) {
				const node = ordered[0];
				const newY0 = top + slack / 2;
				deltaByNode.set(node.id, newY0 - node.y0);
				const nodeHeight = node.y1 - node.y0;
				node.y0 = newY0;
				node.y1 = newY0 + nodeHeight;
				return;
			}

			const gap = slack / (count - 1);
			let cursor = top;
			ordered.forEach((node) => {
				const nodeHeight = node.y1 - node.y0;
				deltaByNode.set(node.id, cursor - node.y0);
				node.y0 = cursor;
				node.y1 = cursor + nodeHeight;
				cursor += nodeHeight + gap;
			});
		});

		graph.links.forEach((link) => {
			link.y0 += deltaByNode.get(link.source.id) || 0;
			link.y1 += deltaByNode.get(link.target.id) || 0;
		});

		return graph;
	}

	// Rendered height of every node's wrapped label, measured in a throwaway
	// hidden group inside the chart's own <svg> so it picks up the real
	// `.sankey-node text` font. Returns id -> px.
	function measureLabelHeights(chartEl, graph, maxWidth) {
		const heights = new Map();
		if (!chartEl) {
			return heights;
		}
		const probeGroup = d3
			.select(chartEl)
			.append("g")
			.attr("class", "sankey-nodes")
			.attr("visibility", "hidden");
		const probe = probeGroup.append("g").attr("class", "sankey-node").append("text");

		graph.nodes.forEach((node) => {
			probe.text(node.label);
			wrapNodeLabels(probe, maxWidth);
			let box = null;
			try {
				box = probe.node().getBBox();
			} catch (error) {
				box = null;
			}
			heights.set(node.id, box && box.height ? box.height : 0);
		});

		probeGroup.remove();
		return heights;
	}

	// Give every node at least as much vertical room as its own label needs, so
	// labels can stay centred on the node they belong to instead of being nudged
	// off it. Nodes keep their height (value) and are re-centred inside
	// label-sized slots; overlapping slots are merged into blocks that sit on the
	// average of what their members want, so a crowded run drifts symmetrically
	// rather than cascading off one end of the column. Mutates node/link y in
	// place, like `spreadStageHeights`, so ribbons follow their endpoints.
	function spreadNodesForLabels(chartEl, graph, top, bottom, gap = 2) {
		const labelHeights = measureLabelHeights(chartEl, graph, computeLabelMaxWidth(graph));
		const available = Math.max(0, bottom - top);

		// A column can only afford so much label breathing room. Per stage, work out
		// how much of the labels' overhang past their node bodies actually fits in
		// the band; anything beyond that is given up (proportionally) so a crowded
		// column degrades toward its raw sankey layout instead of demanding more
		// height than the chart has and being clipped at both ends.
		const stageFit = new Map();
		d3.group(graph.nodes, (node) => node.stage).forEach((stageNodes, stage) => {
			const gapCount = Math.max(0, stageNodes.length - 1);
			const bodyTotal = d3.sum(stageNodes, (node) => node.y1 - node.y0);
			const overhangTotal = d3.sum(stageNodes, (node) =>
				Math.max(0, (labelHeights.get(node.id) || 0) - (node.y1 - node.y0))
			);
			const stageGap = gapCount ? Math.max(0, Math.min(gap, (available - bodyTotal) / gapCount)) : 0;
			const room = available - bodyTotal - stageGap * gapCount;
			stageFit.set(stage, {
				gap: stageGap,
				scale: overhangTotal > 0 ? Math.max(0, Math.min(1, room / overhangTotal)) : 1
			});
		});

		const slotHeightByNode = new Map();
		const entries = graph.nodes.map((node) => {
			const nodeHeight = node.y1 - node.y0;
			const overhang = Math.max(0, (labelHeights.get(node.id) || 0) - nodeHeight);
			const height = nodeHeight + overhang * (stageFit.get(node.stage)?.scale ?? 1);
			slotHeightByNode.set(node.id, height);
			return {
				id: node.id,
				stage: node.stage,
				height,
				offset: 0,
				center: node.y0 + nodeHeight / 2
			};
		});

		const slotTops = resolveLabelYByStage(entries, top, bottom, (stage) => stageFit.get(stage)?.gap ?? gap);
		const deltaByNode = new Map();

		graph.nodes.forEach((node) => {
			const slotTop = slotTops.get(node.id);
			if (slotTop === undefined) {
				return;
			}
			const nodeHeight = node.y1 - node.y0;
			const newY0 = slotTop + (slotHeightByNode.get(node.id) - nodeHeight) / 2;
			deltaByNode.set(node.id, newY0 - node.y0);
			node.y0 = newY0;
			node.y1 = newY0 + nodeHeight;
		});

		graph.links.forEach((link) => {
			link.y0 += deltaByNode.get(link.source.id) || 0;
			link.y1 += deltaByNode.get(link.target.id) || 0;
		});

		return graph;
	}

	// Draws the horizontal per-stage column labels (`.stage-header`) into `group`,
	// centered over each stage's column. Joins by stage so it can be re-run on
	// re-render without tearing the labels down. Mirrors the portfolio chart's
	// `.sankey-stage-headers`.
	function renderStageHeaders(group, graph, headerY) {
		const columns = Array.from(stageXBounds(graph).entries())
			.filter(([stage]) => STAGE_META[stage])
			.map(([stage, bounds]) => ({ stage, cx: (bounds.x0 + bounds.x1) / 2 }));

		return group
			.selectAll("text.stage-header")
			.data(columns, (d) => d.stage)
			.join("text")
			.attr("class", "stage-header")
			.attr("x", (d) => Math.max(d.cx, 58))
			.attr("y", headerY)
			.attr("text-anchor", "middle")
			.attr("fill", (d) => `var(${stageColorVars[d.stage]})`)
			.text((d) => STAGE_META[d.stage].label);
	}

	// Select the first matching child of `sel`, appending it (with `cls`) if it
	// does not exist yet. Lets the scenario chart keep persistent groups/elements
	// across re-renders so their geometry can be transitioned instead of torn down.
	function ensureChild(sel, selector, tag, cls) {
		let child = sel.select(selector);
		if (child.empty()) {
			child = sel.append(tag).attr("class", cls);
		}
		return child;
	}

	function createGtScale(height, scenarioId) {
		const axisX = 18;
		const axisTop = 44;
		const axisBottom = height - 34;
		const activeGt = scenarioGtFor(scenarioId);
		const layoutGt = activeGt == null ? SCENARIO_MAX_GT : activeGt;
		const scaleFactor = layoutGt / SCENARIO_MAX_GT;
		const gtToY = (gt) => {
			const clamped = Math.max(0, Math.min(SCENARIO_MAX_GT, gt));
			return axisBottom - (axisBottom - axisTop) * (clamped / SCENARIO_MAX_GT);
		};

		return {
			axisX,
			axisBottom,
			activeGt,
			layoutGt,
			scaleFactor,
			gtToY
		};
	}

	function renderGtReferenceAxis({ axisGroup, markerGroup, width, height, scenarioId, duration = 0, ease = d3.easeCubicInOut }) {
		const { axisX, activeGt, layoutGt, gtToY } = createGtScale(height, scenarioId);

		ensureChild(axisGroup, "line.scenario-axis__line", "line", "scenario-axis__line")
			.attr("x1", axisX)
			.attr("x2", axisX)
			.attr("y1", gtToY(0))
			.attr("y2", gtToY(SCENARIO_MAX_GT));

		const tickData = SCENARIO_AXIS_TICKS_GT;
		const ticks = axisGroup
			.selectAll("g.scenario-axis__tick")
			.data(tickData, (d) => d)
			.join((enter) => {
				const group = enter.append("g").attr("class", "scenario-axis__tick");
				group
					.append("line")
					.attr("class", "scenario-axis__tick-dash")
					.attr("x1", axisX)
					.attr("x2", axisX + 8);
				group
					.append("text")
					.attr("class", "scenario-axis__tick-label")
					.attr("x", axisX + 12)
					.attr("dy", "0.32em")
					.attr("text-anchor", "start")
					.text((d) => `${d}GT`);
				group.attr("transform", (d) => `translate(0,${gtToY(d)})`);
				return group;
			});

		ticks.classed("is-active", (d) => activeGt != null && Math.abs(d - activeGt) < 0.5);
		ticks
			.transition()
			.duration(duration)
			.ease(ease)
			.attr("transform", (d) => `translate(0,${gtToY(d)})`);

		ensureChild(markerGroup, "line.scenario-marker__line", "line", "scenario-marker__line")
			.attr("x1", axisX)
			.attr("x2", width - 28)
			.transition()
			.duration(duration)
			.ease(ease)
			.attr("y1", gtToY(layoutGt))
			.attr("y2", gtToY(layoutGt));
	}

	// SVG <text> has no max-width / text-wrap, so wrap long labels into multiple
	// <tspan> lines. We measure with getComputedTextLength() and re-flow toward a
	// balanced line width (emulating CSS `text-wrap: balance`). Vertical centering
	// is done with a negative dy on the first line so the block stays centred on
	// the node even as the layout animates (text `y` is updated elsewhere).
	function wrapNodeLabels(textSelection, maxWidth) {
		const lineHeightEm = 1.05;
		textSelection.each(function () {
			const text = d3.select(this);
			const label = text.text();
			const words = label.split(/\s+/).filter(Boolean);
			if (words.length < 2) {
				return;
			}
			const anchorX = text.attr("x") || 0;

			const buildLines = (targetWidth) => {
				text.text(null);
				const probe = text.append("tspan").attr("x", anchorX);
				const lines = [];
				let current = [];
				for (const word of words) {
					current.push(word);
					probe.text(current.join(" "));
					if (probe.node().getComputedTextLength() > targetWidth && current.length > 1) {
						current.pop();
						lines.push(current.join(" "));
						current = [word];
					}
				}
				lines.push(current.join(" "));
				return lines;
			};

			let lines = buildLines(maxWidth);
			if (lines.length > 1) {
				text.text(null);
				const probe = text.append("tspan").attr("x", anchorX).text(label);
				const fullWidth = probe.node().getComputedTextLength();
				const balancedTarget = Math.min(maxWidth, Math.ceil(fullWidth / lines.length) + 2);
				const balanced = buildLines(balancedTarget);
				if (balanced.length === lines.length) {
					lines = balanced;
				}
			}

			text.text(null);
			const startDy = -((lines.length - 1) / 2) * lineHeightEm;
			lines.forEach((lineText, index) => {
				text
					.append("tspan")
					.attr("x", anchorX)
					.attr("dy", `${index === 0 ? startDy : lineHeightEm}em`)
					.text(lineText);
			});
		});
	}

	// Push overlapping node labels apart within each stage. A carved column
	// collapses most of its nodes to slivers far shorter than their own text, so
	// centring every label on its node body stacks them into an unreadable pile.
	// Overlapping labels are merged into blocks, and each block is centred on the
	// average of what its members want, so a crowded run drifts symmetrically
	// around its nodes instead of cascading downward off the top of the column.
	// `entries` are {id, stage, height, offset, center}; the returned map is
	// id -> resolved absolute `y` attribute value. `gap` may be a per-stage
	// function so an over-subscribed column can tighten its spacing.
	function resolveLabelYByStage(entries, top, bottom, gap = 2) {
		const resolved = new Map();
		d3.group(entries, (entry) => entry.stage).forEach((stageEntries, stage) => {
			const stageGap = typeof gap === "function" ? gap(stage) : gap;
			const ordered = stageEntries.slice().sort((a, b) => a.center - b.center);
			const blocks = [];

			ordered.forEach((entry) => {
				blocks.push({
					entries: [entry],
					height: entry.height,
					want: entry.center - entry.height / 2
				});

				while (blocks.length > 1) {
					const below = blocks[blocks.length - 1];
					const above = blocks[blocks.length - 2];
					if (above.want + above.height + stageGap <= below.want) {
						break;
					}
					// `below` would sit this far down inside the merged block, so
					// discount that when averaging the two blocks' wanted tops.
					const offset = above.height + stageGap;
					const aboveCount = above.entries.length;
					const belowCount = below.entries.length;
					blocks.splice(blocks.length - 2, 2, {
						entries: above.entries.concat(below.entries),
						height: offset + below.height,
						want:
							(above.want * aboveCount + (below.want - offset) * belowCount) /
							(aboveCount + belowCount)
					});
				}
			});

			blocks.forEach((block) => {
				block.top = Math.min(Math.max(block.want, top), Math.max(top, bottom - block.height));
			});

			// Clamping to the band can re-introduce overlap when a column is
			// over-subscribed, so settle the blocks downward then back up.
			let cursor = top;
			blocks.forEach((block) => {
				block.top = Math.max(block.top, cursor);
				cursor = block.top + block.height + stageGap;
			});
			cursor = bottom;
			for (let i = blocks.length - 1; i >= 0; i -= 1) {
				blocks[i].top = Math.min(blocks[i].top, cursor - blocks[i].height);
				cursor = blocks[i].top - stageGap;
			}

			blocks.forEach((block) => {
				let y = block.top;
				block.entries.forEach((entry) => {
					resolved.set(entry.id, y - entry.offset);
					y += entry.height + stageGap;
				});
			});
		});
		return resolved;
	}

	function renderPortfolioSankey() {
		if (!portfolioChart || !state.nodes.length || !state.links.length) {
			return;
		}

		const bounds = portfolioChart.getBoundingClientRect();
		const width = Math.max(820, Math.floor(bounds.width));
		const height = Math.max(560, Math.floor(bounds.height));

		d3.select(portfolioChart).selectAll("*").remove();

		const svg = d3
			.select(portfolioChart)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.style("pointer-events", "none");

		const graph = {
			nodes: state.nodes.map((node) => ({ ...node })),
			links: state.links.map((link) => ({ ...link }))
		};

		d3
			.sankey()
			.nodeId((d) => d.id)
			.nodeWidth(20)
			.nodePadding(9)
			.nodeAlign(d3.sankeyJustify)
			.extent([
				[28, 44],
				[width - 28, height - 34]
			])
			.iterations(64)(graph);

		// Align every stage top *and* bottom so the expanded columns are equal height.
		spreadStageHeights(graph, 44, height - 34);
		spreadNodesForLabels(portfolioChart, graph, 44, height - 34);

		const defs = svg.append("defs");
		const stageBounds = stageXBounds(graph);
		const stagePairs = Array.from(
			new Set(
				graph.links.map(
					(link) => `${link.source?.stage ?? "unknown"}-${link.target?.stage ?? "unknown"}`
				)
			)
		);

		stagePairs.forEach((pair) => {
			const [sourceStageRaw, targetStageRaw] = pair.split("-");
			const sourceStage = Number.parseInt(sourceStageRaw, 10);
			const targetStage = Number.parseInt(targetStageRaw, 10);
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];

			if (!sourceColorVar || !targetColorVar) {
				return;
			}

			const sourceX = stageBounds.get(sourceStage)?.x1 ?? 0;
			const targetX = stageBounds.get(targetStage)?.x0 ?? width;
			const gradient = defs
				.append("linearGradient")
				.attr("id", portfolioLinkGradientId(sourceStage, targetStage))
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", sourceX)
				.attr("y1", 0)
				.attr("x2", targetX)
				.attr("y2", 0);

			gradient
				.append("stop")
				.attr("offset", "0%")
				.style("stop-color", `var(${sourceColorVar})`)
				.attr("stop-opacity", 0.35);
			gradient
				.append("stop")
				.attr("offset", "100%")
				.style("stop-color", `var(${targetColorVar})`)
				.attr("stop-opacity", 0.35);
		});

		const linksGroup = svg
			.append("g")
			.attr("fill", "none")
			.attr("stroke-opacity", 1)
			.attr("class", "sankey-links");

		const linkSelection = linksGroup
			.selectAll("path")
			.data(graph.links, (d) => d.id)
			.join("path")
			.attr("class", "sankey-link")
			.style("stroke", (link) => {
				const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
				const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;
				if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
					return `url(#${portfolioLinkGradientId(sourceStage, targetStage)})`;
				}
				return "rgba(208, 222, 235, 0.38)";
			})
			.attr("d", d3.sankeyLinkHorizontal())
			.attr("stroke-width", (d) => Math.max(1, d.width));

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");
		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(graph.nodes, (d) => d.id)
			.join("g")
			.attr("class", (d) => `sankey-node stage-${d.stage}`)
			.attr("transform", (d) => `translate(${d.x0},${d.y0})`);

		nodeSelection
			.append("rect")
			.attr("width", (d) => Math.max(1, d.x1 - d.x0))
			.attr("height", (d) => Math.max(3, d.y1 - d.y0));

		nodeSelection
			.append("title")
			.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));

		nodeSelection
			.append("text")
			.attr("x", (d) => (d.stage !== 7 ? Math.max(1, d.x1 - d.x0) + 7 : -7))
			.attr("y", (d) => Math.max(3, d.y1 - d.y0) / 2)
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.stage !== 7 ? "start" : "end"))
			.text((d) => d.label);

		wrapNodeLabels(nodeSelection.selectAll("text"), computeLabelMaxWidth(graph));

		const headersGroup = svg.append("g").attr("class", "sankey-stage-headers");
		renderStageHeaders(headersGroup, graph, 24);

		state.portfolioRendered = {
			nodeSelection,
			linkSelection,
			graph
		};

		// Start fully illuminated with no company isolated. If the user has
		// already picked a company before a re-render (e.g. resize), re-apply it.
		applyPortfolioBusinessHighlight(window.currentPortfolioBusinessId || "");
	}

	function setupPortfolioBusinessSync() {
		document.addEventListener("portfolio-business-change", (event) => {
			applyPortfolioBusinessHighlight(event?.detail?.businessId);
		});
	}

	function renderScenarioSankey(rawScenarioId) {
		if (!scenarioChart || !state.initData || !state.baselinesData) {
			return;
		}

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const duration = reduceMotion ? 0 : 720;
		const ease = d3.easeCubicInOut;

		const scenarioRequest = resolveScenarioRequest(rawScenarioId);

		const scenarioGraph = buildGraph(
			state.initData,
			state.baselinesData,
			scenarioRequest.resolvedScenarioKey
		);
		const baselineGraph = buildGraph(
			state.initData,
			state.baselinesData,
			scenarioRequest.enactedScenarioKey
		);

		const bounds = scenarioChart.getBoundingClientRect();
		const width = Math.max(820, Math.floor(bounds.width));
		const height = Math.max(560, Math.floor(bounds.height));

		const graph = {
			nodes: scenarioGraph.nodes.map((node) => ({ ...node })),
			links: scenarioGraph.links.map((link) => ({ ...link }))
		};

		// Vertical scale: the full inner band maps 0 GT (bottom) -> SCENARIO_MAX_GT
		// (top). The layout extent is bottom-anchored to this scenario's GT total so
		// a 46 GT scenario physically occupies 46/60 of the height, leaving a visible
		// gap above it that reads as the emissions avoided vs the 60 GT case.
		const { axisBottom, gtToY, layoutGt, scaleFactor } = createGtScale(
			height,
			scenarioRequest.scenarioId
		);

		d3
			.sankey()
			.nodeId((d) => d.id)
			.nodeWidth(20)
			.nodePadding(Math.max(4, 9 * scaleFactor))
			.nodeAlign(d3.sankeyJustify)
			.extent([
				[28, gtToY(layoutGt)],
				[width - 28, axisBottom]
			])
			.iterations(64)(graph);

		// Align every stage top *and* bottom within the GT-scaled band so columns are
		// equal height; the band's own top still encodes this scenario's GT total.
		spreadStageHeights(graph, gtToY(layoutGt), axisBottom);
		spreadNodesForLabels(scenarioChart, graph, gtToY(layoutGt), axisBottom);

		// Persistent layer groups so scenario switches can tween geometry instead of
		// tearing the chart down and rebuilding it from scratch each time.
		const svg = d3
			.select(scenarioChart)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.style("pointer-events", "none");

		let layers = state.scenarioLayers;
		if (!layers || svg.select("defs").empty()) {
			svg.selectAll("*").remove();
			scenarioLinkGeom = new Map();
			layers = {
				defs: svg.append("defs"),
				markerGroup: svg.append("g").attr("class", "scenario-marker"),
				linksGroup: svg
					.append("g")
					.attr("class", "sankey-links")
					.attr("fill", "none")
					.attr("stroke-opacity", 1),
				nodesGroup: svg.append("g").attr("class", "sankey-nodes"),
				axisGroup: svg.append("g").attr("class", "scenario-axis"),
				headersGroup: svg.append("g").attr("class", "sankey-stage-headers")
			};
			state.scenarioLayers = layers;
		}
		const { defs, markerGroup, linksGroup, nodesGroup, axisGroup, headersGroup } = layers;

		// Link gradients depend on stage x-positions (and chart width), so rebuild
		// them on every render — they are cheap and never animated.
		defs.selectAll("*").remove();
		const stageBounds = stageXBounds(graph);
		const stagePairs = Array.from(
			new Set(
				graph.links.map(
					(link) => `${link.source?.stage ?? "unknown"}-${link.target?.stage ?? "unknown"}`
				)
			)
		);

		stagePairs.forEach((pair) => {
			const [sourceStageRaw, targetStageRaw] = pair.split("-");
			const sourceStage = Number.parseInt(sourceStageRaw, 10);
			const targetStage = Number.parseInt(targetStageRaw, 10);
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];

			if (!sourceColorVar || !targetColorVar) {
				return;
			}

			const sourceX = stageBounds.get(sourceStage)?.x1 ?? 0;
			const targetX = stageBounds.get(targetStage)?.x0 ?? width;
			const gradient = defs
				.append("linearGradient")
				.attr("id", `scenario-link-gradient-${sourceStage}-${targetStage}`)
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", sourceX)
				.attr("y1", 0)
				.attr("x2", targetX)
				.attr("y2", 0);

			gradient
				.append("stop")
				.attr("offset", "0%")
				.style("stop-color", `var(${sourceColorVar})`)
				.attr("stop-opacity", 0.35);
			gradient
				.append("stop")
				.attr("offset", "100%")
				.style("stop-color", `var(${targetColorVar})`)
				.attr("stop-opacity", 0.35);
		});

		// --- Links (tween the ribbon `d` between renders) ---------------------
		const linkGen = d3.sankeyLinkHorizontal();
		const linkPathFromGeom = (g) =>
			linkGen({ source: { x1: g.sx }, target: { x0: g.tx }, y0: g.y0, y1: g.y1 });
		const geomFor = (d) => ({ sx: d.source.x1, tx: d.target.x0, y0: d.y0, y1: d.y1 });
		const linkStroke = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;
			if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
				return `url(#scenario-link-gradient-${sourceStage}-${targetStage})`;
			}
			return "rgba(208, 222, 235, 0.38)";
		};
		const prevGeom = scenarioLinkGeom;

		const linkSelection = linksGroup
			.selectAll("path.sankey-link")
			.data(graph.links, (d) => d.id)
			.join(
				(enter) =>
					enter
						.append("path")
						.attr("class", "sankey-link")
						.style("stroke", linkStroke)
						.attr("d", (d) => linkGen(d))
						.attr("stroke-width", (d) => Math.max(1, d.width))
						.style("opacity", 0)
						.call((sel) =>
							sel
								.transition()
								.duration(duration)
								.ease(ease)
								.style("opacity", 1)
								.on("end", function () {
									d3.select(this).style("opacity", null);
								})
						),
				(update) =>
					update
						.interrupt()
						.style("opacity", null)
						.style("stroke", linkStroke)
						.call((sel) =>
							sel
								.transition()
								.duration(duration)
								.ease(ease)
								.attr("stroke-width", (d) => Math.max(1, d.width))
								.attrTween("d", function (d) {
									const start = prevGeom.get(d.id) || geomFor(d);
									const end = geomFor(d);
									const iy0 = d3.interpolateNumber(start.y0, end.y0);
									const iy1 = d3.interpolateNumber(start.y1, end.y1);
									const isx = d3.interpolateNumber(start.sx, end.sx);
									const itx = d3.interpolateNumber(start.tx, end.tx);
									return (t) =>
										linkPathFromGeom({ sx: isx(t), tx: itx(t), y0: iy0(t), y1: iy1(t) });
								})
						),
				(exit) =>
					exit.call((sel) =>
						sel.transition().duration(duration).ease(ease).style("opacity", 0).remove()
					)
			);

		const nextGeom = new Map();
		graph.links.forEach((d) => nextGeom.set(d.id, geomFor(d)));
		scenarioLinkGeom = nextGeom;

		// --- Nodes (tween height/position between renders) --------------------
		const labelMaxWidth = computeLabelMaxWidth(graph);
		const nodeHeight = (d) => Math.max(3, d.y1 - d.y0);
		const nodeTextX = (d) => (d.stage !== 7 ? Math.max(1, d.x1 - d.x0) + 7 : -7);

		const nodeSelection = nodesGroup
			.selectAll("g.sankey-node")
			.data(graph.nodes, (d) => d.id)
			.join(
				(enter) => {
					const group = enter
						.append("g")
						.attr("class", (d) => `sankey-node stage-${d.stage}`)
						.attr("transform", (d) => `translate(${d.x0},${d.y0})`)
						.style("opacity", 0);
					group
						.append("rect")
						.attr("width", (d) => Math.max(1, d.x1 - d.x0))
						.attr("height", nodeHeight);
					group
						.append("title")
						.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));
					group
						.append("text")
						.attr("x", nodeTextX)
						.attr("y", (d) => nodeHeight(d) / 2)
						.attr("dy", "0.35em")
						.attr("text-anchor", (d) => (d.stage !== 7 ? "start" : "end"))
						.text((d) => d.label);
					group.each(function () {
						wrapNodeLabels(d3.select(this).selectAll("text"), labelMaxWidth);
					});
					group
						.transition()
						.duration(duration)
						.ease(ease)
						.style("opacity", 1)
						.on("end", function () {
							d3.select(this).style("opacity", null);
						});
					return group;
				},
				(update) => {
					update.interrupt().style("opacity", null);
					update
						.select("rect")
						.transition()
						.duration(duration)
						.ease(ease)
						.attr("width", (d) => Math.max(1, d.x1 - d.x0))
						.attr("height", nodeHeight);
					update
						.select("text")
						.transition()
						.duration(duration)
						.ease(ease)
						.attr("y", (d) => nodeHeight(d) / 2);
					update
						.transition()
						.duration(duration)
						.ease(ease)
						.attr("transform", (d) => `translate(${d.x0},${d.y0})`);
					return update;
				},
				(exit) =>
					exit.call((sel) =>
						sel.transition().duration(duration).ease(ease).style("opacity", 0).remove()
					)
			);

		// --- Left reference axis + moving GT marker ---------------------------
		renderGtReferenceAxis({
			axisGroup,
			markerGroup,
			width,
			height,
			scenarioId: scenarioRequest.scenarioId,
			duration,
			ease
		});

		renderStageHeaders(headersGroup, graph, 24);

		state.scenarioRendered = {
			nodeSelection,
			linkSelection,
			graph,
			baselineGraph,
			scenarioId: scenarioRequest.scenarioId,
			requestedScenarioKey: scenarioRequest.requestedScenarioKey,
			resolvedScenarioKey: scenarioRequest.resolvedScenarioKey
		};

		applyScenarioHighlight();
	}

	function setupScenarioSync() {
		document.addEventListener("scenario-change", (event) => {
			renderScenarioSankey(event?.detail?.scenarioId);
		});
	}

	function clearScenarioHighlight(linkSelection, nodeSelection) {
		linkSelection
			.classed("scenario-is-highlight", false)
			.classed("scenario-is-muted", false);
		nodeSelection
			.classed("scenario-is-highlight", false)
			.classed("scenario-is-muted", false);
	}

	// Only one 2040 scenario ships data today, so there is no comparison state
	// to highlight — the scenario Sankey always renders unmuted.
	function applyScenarioHighlight() {
		if (!state.scenarioRendered) {
			return;
		}

		const { nodeSelection, linkSelection } = state.scenarioRendered;
		clearScenarioHighlight(linkSelection, nodeSelection);
	}

	// avoided.json is large; fetch it lazily (only the Climate Impacts "after"
	// highlight needs it) and cache the parsed result. Empty object cached on
	// failure so we don't refetch.
	function ensureAvoidedData() {
		if (state.avoidedData) {
			return Promise.resolve(state.avoidedData);
		}
		if (!state.avoidedPromise) {
			state.avoidedPromise = fetch(avoidedPath)
				.then((response) => {
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}
					return response.json();
				})
				.then((data) => {
					state.avoidedData = data || {};
					return state.avoidedData;
				})
				.catch((err) => {
					console.warn(`[Sankey] Could not load ${avoidedPath}:`, err);
					state.avoidedData = {};
					return state.avoidedData;
				});
		}
		return state.avoidedPromise;
	}

	// Renders the Climate Impacts Sankey. With no business selected it shows the
	// full baseline graph for the active scenario. When a portfolio business is
	// selected it narrows to that company's connected subgraph (only edges with
	// avoided-emissions data) and carves the avoided amount out of each node and
	// ribbon as an empty, 1px-bordered region (remaining flow stays filled below).
	function renderImpactsChart(chartEl, options = {}) {
		if (!chartEl || !state.initData || !state.baselinesData) {
			return;
		}

		const {
			businessId: rawBusinessId = "",
			scenarioId = IMPACTS_SCENARIO_ID,
			storeInState = false,
			waitForAvoidedData = false
		} = options;

		const scenarioRequest = resolveScenarioRequest(scenarioId);
		const businessId = normalizeBusinessSlug(rawBusinessId);
		const companySelected = !!businessId;

		if (storeInState) {
			state.impactsScenarioId = scenarioId;
		}

		const fullGraph = buildGraph(
			state.initData,
			state.baselinesData,
			scenarioRequest.resolvedScenarioKey
		);
		const baselineNodeById = new Map(fullGraph.nodes.map((node) => [node.id, node]));

		// Resolve the company's avoided edges for the active scenario. When avoided
		// data has not loaded yet, kick off the fetch and re-render once ready.
		let avoidedMap = new Map();
		if (companySelected) {
			if (!state.avoidedData) {
				if (waitForAvoidedData) {
					d3.select(chartEl).selectAll("*").remove();
				}
				ensureAvoidedData().then(() => {
					if (storeInState) {
						if (state.impactsBusinessId === businessId) {
							renderImpactsSankey();
							const selected = state.impactsRosterIndex.get(state.impactsCompanyKey);
							updateImpactsCompanyCard(selected || null);
						}
						return;
					}

					renderImpactsChart(chartEl, options);
				});

				if (waitForAvoidedData) {
					return null;
				}
			} else {
				const companyKey = avoidedCompanyKeyForBusiness(businessId);
				if (companyKey) {
					avoidedMap = avoidedValueMapForCompany(
						companyKey,
						scenarioRequest.resolvedScenarioKey,
						baselineNodeById
					);
				}
			}
		}

		const carve = companySelected && avoidedMap.size > 0;

		// The company's intervention node (from init.intervention.companies) gets a
		// highlight border, mirroring a click-selected node in the main chart.
		const interventionNodeId = companySelected
			? state.portfolioBusinessNodeMap.get(businessId) || null
			: null;

		// Subgraph = only the edges the company avoids (plus their endpoint nodes).
		let graphNodes = fullGraph.nodes;
		let graphLinks = fullGraph.links;
		if (carve) {
			const subLinks = fullGraph.links.filter((link) =>
				avoidedMap.has(`${link.source}|${link.target}`)
			);
			const subNodeIds = new Set();
			subLinks.forEach((link) => {
				subNodeIds.add(link.source);
				subNodeIds.add(link.target);
			});
			graphLinks = subLinks;
			graphNodes = fullGraph.nodes.filter((node) => subNodeIds.has(node.id));
		}

		const bounds = chartEl.getBoundingClientRect();
		const width = Math.max(820, Math.floor(bounds.width));
		const height = Math.max(480, Math.floor(bounds.height));
		const { axisBottom, gtToY, layoutGt, scaleFactor } = createGtScale(
			height,
			scenarioRequest.scenarioId
		);

		d3.select(chartEl).selectAll("*").remove();

		const svg = d3
			.select(chartEl)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.style("pointer-events", "none");

		const graph = {
			nodes: graphNodes.map((node) => ({ ...node })),
			links: graphLinks.map((link) => ({
				...link,
				avoided: avoidedMap.get(`${link.source}|${link.target}`) || 0
			}))
		};

		d3
			.sankey()
			.nodeId((d) => d.id)
			.nodeWidth(20)
			.nodePadding(Math.max(4, 9 * scaleFactor))
			.nodeAlign(d3.sankeyJustify)
			.extent([
				[28, gtToY(layoutGt)],
				[width - 28, axisBottom]
			])
			.iterations(64)(graph);

		// Align every stage top *and* bottom within the GT-scaled band so columns are
		// equal height; run before the avoided sub-height math so ribbons stay aligned.
		if (!carve) {
			spreadStageHeights(graph, gtToY(layoutGt), axisBottom);
		}
		spreadNodesForLabels(chartEl, graph, gtToY(layoutGt), axisBottom + 8);

		// Per-node avoided amount, summed on the node's height-defining side so it
		// aligns with the carved ribbons entering/leaving that side.
		if (carve) {
			graph.nodes.forEach((node) => {
				let inBase = 0;
				let outBase = 0;
				let inAvoided = 0;
				let outAvoided = 0;
				graph.links.forEach((link) => {
					if (link.target === node) {
						inBase += link.value;
						inAvoided += link.avoided || 0;
					}
					if (link.source === node) {
						outBase += link.value;
						outAvoided += link.avoided || 0;
					}
				});
				node.avoided = inBase >= outBase ? inAvoided : outAvoided;
			});
		}

		const defs = svg.append("defs");
		const stageBounds = stageXBounds(graph);
		const stagePairs = Array.from(
			new Set(
				graph.links.map(
					(link) => `${link.source?.stage ?? "unknown"}-${link.target?.stage ?? "unknown"}`
				)
			)
		);

		stagePairs.forEach((pair) => {
			const [sourceStageRaw, targetStageRaw] = pair.split("-");
			const sourceStage = Number.parseInt(sourceStageRaw, 10);
			const targetStage = Number.parseInt(targetStageRaw, 10);
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];

			if (!sourceColorVar || !targetColorVar) {
				return;
			}

			const sourceX = stageBounds.get(sourceStage)?.x1 ?? 0;
			const targetX = stageBounds.get(targetStage)?.x0 ?? width;
			const gradient = defs
				.append("linearGradient")
				.attr("id", `${chartEl.id || "impacts-chart"}-gradient-${sourceStage}-${targetStage}`)
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", sourceX)
				.attr("y1", 0)
				.attr("x2", targetX)
				.attr("y2", 0);

			gradient
				.append("stop")
				.attr("offset", "0%")
				.style("stop-color", `var(${sourceColorVar})`)
				.attr("stop-opacity", 0.4);
			gradient
				.append("stop")
				.attr("offset", "100%")
				.style("stop-color", `var(${targetColorVar})`)
				.attr("stop-opacity", 0.4);
		});

		const linkStroke = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;
			if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
				return `url(#${chartEl.id || "impacts-chart"}-gradient-${sourceStage}-${targetStage})`;
			}
			return "rgba(208, 222, 235, 0.38)";
		};

		const linksGroup = svg
			.append("g")
			.attr("fill", "none")
			.attr("stroke-opacity", 1)
			.attr("class", "sankey-links");

		let linkSelection;
		if (carve) {
			// Filled "remaining" band + outlined "avoided" band (avoided at top).
			linkSelection = linksGroup
				.selectAll("g.impacts-link")
				.data(graph.links, (d) => d.id)
				.join("g")
				.attr("class", "impacts-link");

			linkSelection.each(function (link) {
				const group = d3.select(this);
				const w = Math.max(1, link.width);
				const ratio = link.value > 0 ? Math.min(1, (link.avoided || 0) / link.value) : 0;
				const avoidedW = w * ratio;
				const sx = link.source.x1;
				const tx = link.target.x0;
				const sTop = link.y0 - w / 2;
				const tTop = link.y1 - w / 2;

				group
					.append("path")
					.attr("class", "impacts-link-remaining")
					.attr(
						"d",
						impactsRibbonArea(sx, tx, sTop + avoidedW, sTop + w, tTop + avoidedW, tTop + w)
					)
					.style("fill", linkStroke(link));

				if (avoidedW > 0.25) {
					group
						.append("path")
						.attr("class", "impacts-link-avoided")
						.attr(
							"d",
							impactsRibbonArea(sx, tx, sTop, sTop + avoidedW, tTop, tTop + avoidedW)
						)
						.style("stroke", () => {
							// Border takes the colour of the node the ribbon comes from
							// (the upstream / final-service side of the flow).
							const colorVar = stageColorVars[link.source?.stage];
							return colorVar ? `var(${colorVar})` : null;
						});
				}
			});
		} else {
			linkSelection = linksGroup
				.selectAll("path")
				.data(graph.links, (d) => d.id)
				.join("path")
				.attr("class", "sankey-link")
				.style("stroke", linkStroke)
				.attr("d", d3.sankeyLinkHorizontal())
				.attr("stroke-width", (d) => Math.max(1.5, d.width));
		}

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");
		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(graph.nodes, (d) => d.id)
			.join("g")
			.attr("class", (d) => {
				const isIntervention = interventionNodeId && d.id === interventionNodeId;
				return `sankey-node stage-${d.stage}${isIntervention ? " impacts-is-intervention" : ""}`;
			})
			.attr("transform", (d) => `translate(${d.x0},${d.y0})`);

		// Node body: a filled "remaining" rect, and (when carving) an empty
		// bordered "avoided" rect stacked on top. The avoided border is inset by
		// half its stroke width so it sits inside the node footprint (flush with the
		// remaining rect) instead of extending past it, and is drawn in the node's
		// own stage colour to match the remaining fill.
		const avoidedStrokeInset = 0.5;
		nodeSelection.each(function (node) {
			const group = d3.select(this);
			const nodeW = Math.max(1, node.x1 - node.x0);
			const nodeH = Math.max(3, node.y1 - node.y0);
			const ratio = carve && node.value > 0 ? Math.min(1, (node.avoided || 0) / node.value) : 0;
			const avoidedH = nodeH * ratio;

			if (avoidedH > 0.5) {
				const stageColorVar = stageColorVars[node.stage];
				group
					.append("rect")
					.attr("class", "impacts-node-avoided")
					.attr("x", avoidedStrokeInset)
					.attr("y", avoidedStrokeInset)
					.attr("width", Math.max(0, nodeW - avoidedStrokeInset * 2))
					.attr("height", Math.max(0, avoidedH - avoidedStrokeInset))
					.style("stroke", stageColorVar ? `var(${stageColorVar})` : null);
			}

			group
				.append("rect")
				.attr("class", "impacts-node-remaining")
				.attr("x", 0)
				.attr("y", avoidedH)
				.attr("width", nodeW)
				.attr("height", Math.max(0, nodeH - avoidedH));

			// Intervention node: a full-height outline marking the company's
			// placement, mirroring a click-selected node in the main chart.
			if (interventionNodeId && node.id === interventionNodeId) {
				group
					.append("rect")
					.attr("class", "impacts-node-intervention")
					.attr("x", 0)
					.attr("y", 0)
					.attr("width", nodeW)
					.attr("height", nodeH);
			}
		});

		nodeSelection
			.append("title")
			.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));

		nodeSelection
			.append("text")
			.attr("x", (d) => (d.stage !== 7 ? Math.max(1, d.x1 - d.x0) + 8 : -8))
			.attr("y", (d) => Math.max(3, d.y1 - d.y0) / 2)
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.stage !== 7 ? "start" : "end"))
			.text((d) => d.label);

		wrapNodeLabels(nodeSelection.selectAll("text"), computeLabelMaxWidth(graph));

		const headersGroup = svg.append("g").attr("class", "sankey-stage-headers");
		renderStageHeaders(headersGroup, graph, 24);

		const rendered = {
			nodeSelection,
			linkSelection,
			graph,
			scenarioId,
			scenarioKey: scenarioRequest.resolvedScenarioKey
		};

		if (storeInState) {
			state.impactsRendered = rendered;
		}

		return rendered;
	}

	function renderImpactsSankey() {
		return renderImpactsChart(impactsChart, {
			businessId: state.impactsBusinessId,
			scenarioId: IMPACTS_SCENARIO_ID,
			storeInState: true,
			waitForAvoidedData: false
		});
	}

	// Reveal ramp for item `index` of `count`, staggered across a 0-1 window so
	// each item fades over `perFade` of that window and the last one lands on 1.
	function staggeredReveal(t, index, count, perFade) {
		if (count <= 1) {
			return smoothstep(clamp01(t / perFade));
		}
		const stagger = (1 - perFade) / (count - 1);
		return smoothstep(clamp01((t - index * stagger) / perFade));
	}

	// The walkthrough chart is one rendering that morphs between two
	// independently-computed layouts: the uncarved baseline graph and the focal
	// company's avoided-emissions subgraph. d3-sankey link ids are positional and
	// therefore unstable across layouts, so the two sides are matched on
	// "sourceId|targetId" (same technique as the timeline chart). Anything present
	// on only one side collapses to zero height at its own position.
	function renderImpactsWalkChart() {
		if (!impactsChart || !state.initData || !state.baselinesData) {
			return;
		}

		const scenarioRequest = resolveScenarioRequest(IMPACTS_SCENARIO_ID);
		const scenarioKey = scenarioRequest.resolvedScenarioKey;

		const built = buildGraph(state.initData, state.baselinesData, scenarioKey);
		const baselineNodeById = new Map(built.nodes.map((node) => [node.id, node]));

		const companyKey = avoidedCompanyKeyForBusiness(IMPACTS_WALK_COMPANY);
		const avoidedMap = companyKey
			? avoidedValueMapForCompany(companyKey, scenarioKey, baselineNodeById)
			: new Map();

		const bounds = impactsChart.getBoundingClientRect();
		const width = Math.max(820, Math.floor(bounds.width));
		const height = Math.max(480, Math.floor(bounds.height));
		const { axisBottom, gtToY, layoutGt, scaleFactor } = createGtScale(
			height,
			scenarioRequest.scenarioId
		);
		const bandTop = gtToY(layoutGt);

		const layoutGraph = (nodes, links, spread) => {
			const graph = {
				nodes: nodes.map((node) => ({ ...node })),
				links: links.map((link) => ({
					...link,
					avoided: avoidedMap.get(`${link.source}|${link.target}`) || 0
				}))
			};
			d3
				.sankey()
				.nodeId((d) => d.id)
				.nodeWidth(20)
				.nodePadding(Math.max(4, 9 * scaleFactor))
				.nodeAlign(d3.sankeyJustify)
				.extent([
					[28, bandTop],
					[width - 28, axisBottom]
				])
				.iterations(64)(graph);
			if (spread) {
				spreadStageHeights(graph, bandTop, axisBottom);
			}
			spreadNodesForLabels(impactsChart, graph, bandTop, axisBottom + 8);
			return graph;
		};

		// Matches renderImpactsChart: the full graph gets stage-height spreading,
		// the carved subgraph does not.
		const fullGraph = layoutGraph(built.nodes, built.links, true);

		const subLinks = built.links.filter((link) =>
			avoidedMap.has(`${link.source}|${link.target}`)
		);
		const subNodeIds = new Set();
		subLinks.forEach((link) => {
			subNodeIds.add(link.source);
			subNodeIds.add(link.target);
		});
		const carveGraph = subLinks.length
			? layoutGraph(
					built.nodes.filter((node) => subNodeIds.has(node.id)),
					subLinks,
					false
			  )
			: fullGraph;

		// Per-node avoided amount, summed on the node's height-defining side so it
		// aligns with the ribbons entering/leaving that side.
		carveGraph.nodes.forEach((node) => {
			let inBase = 0;
			let outBase = 0;
			let inAvoided = 0;
			let outAvoided = 0;
			carveGraph.links.forEach((link) => {
				if (link.target === node) {
					inBase += link.value;
					inAvoided += link.avoided || 0;
				}
				if (link.source === node) {
					outBase += link.value;
					outAvoided += link.avoided || 0;
				}
			});
			node.avoided = inBase >= outBase ? inAvoided : outAvoided;
		});

		const linkKey = (link) => `${link.source.id}|${link.target.id}`;
		const nodeGeomMap = (graph) => {
			const map = new Map();
			graph.nodes.forEach((node) => {
				map.set(node.id, { x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1, node });
			});
			return map;
		};
		const linkGeomMap = (graph) => {
			const map = new Map();
			graph.links.forEach((link) => {
				map.set(linkKey(link), {
					sx: link.source.x1,
					tx: link.target.x0,
					y0: link.y0,
					y1: link.y1,
					width: link.width,
					link
				});
			});
			return map;
		};

		const fullNodes = nodeGeomMap(fullGraph);
		const carveNodes = carveGraph === fullGraph ? fullNodes : nodeGeomMap(carveGraph);
		const fullLinks = linkGeomMap(fullGraph);
		const carveLinks = carveGraph === fullGraph ? fullLinks : linkGeomMap(carveGraph);

		// A node/link missing from one side collapses to a zero-height sliver at its
		// own position on that side, so it grows out of / shrinks into the layout.
		const collapseNode = (geom) =>
			geom
				? {
						x0: geom.x0,
						x1: geom.x1,
						y0: (geom.y0 + geom.y1) / 2,
						y1: (geom.y0 + geom.y1) / 2
				  }
				: null;
		const collapseLink = (geom) =>
			geom
				? {
						sx: geom.sx,
						tx: geom.tx,
						y0: (geom.y0 + geom.y1) / 2,
						y1: (geom.y0 + geom.y1) / 2,
						width: 0
				  }
				: null;

		const fullNodeOf = (id) => fullNodes.get(id) || collapseNode(carveNodes.get(id));
		const carveNodeOf = (id) => carveNodes.get(id) || collapseNode(fullNodes.get(id));
		const fullLinkOf = (key) => fullLinks.get(key) || collapseLink(carveLinks.get(key));
		const carveLinkOf = (key) => carveLinks.get(key) || collapseLink(fullLinks.get(key));

		// Collapsing to zero height is not enough on its own: a dropped node still
		// paints its text label, and a dropped ribbon still paints a hairline. Both
		// also need to fade against the side they are absent from.
		const nodePresence = (id) => [fullNodes.has(id) ? 1 : 0, carveNodes.has(id) ? 1 : 0];
		const linkPresence = (key) => [fullLinks.has(key) ? 1 : 0, carveLinks.has(key) ? 1 : 0];

		const nodeData = Array.from(new Set([...fullNodes.keys(), ...carveNodes.keys()])).map(
			(id) => (carveNodes.get(id) || fullNodes.get(id)).node
		);
		const linkData = Array.from(new Set([...fullLinks.keys(), ...carveLinks.keys()])).map(
			(key) => {
				const ref = (carveLinks.get(key) || fullLinks.get(key)).link;
				return { id: key, key, source: ref.source, target: ref.target };
			}
		);

		// Ripple bookkeeping: each node's avoided share, plus its top-to-bottom
		// position within its own stage in the carved layout.
		const avoidedRatioById = new Map();
		const rippleOrderById = new Map();
		const byStage = new Map();
		carveGraph.nodes.forEach((node) => {
			const total = Math.max(0, toFiniteNumber(node.value, 0));
			const avoided = Math.max(0, Math.min(total, toFiniteNumber(node.avoided, 0)));
			avoidedRatioById.set(node.id, total > 0 ? avoided / total : 0);
			if (!byStage.has(node.stage)) {
				byStage.set(node.stage, []);
			}
			byStage.get(node.stage).push(node);
		});
		byStage.forEach((nodes) => {
			nodes
				.slice()
				.sort((a, b) => a.y0 - b.y0)
				.forEach((node, index) => {
					rippleOrderById.set(node.id, { index, count: nodes.length });
				});
		});

		const svg = d3
			.select(impactsChart)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.style("pointer-events", "none");
		svg.selectAll("*").remove();

		const defs = svg.append("defs");
		const stageBounds = stageXBounds(fullGraph);
		const stagePairs = Array.from(
			new Set(
				linkData.map((link) => `${link.source?.stage ?? "unknown"}-${link.target?.stage ?? "unknown"}`)
			)
		);
		stagePairs.forEach((pair) => {
			const [sourceStage, targetStage] = pair.split("-").map((v) => Number.parseInt(v, 10));
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];
			if (!sourceColorVar || !targetColorVar) {
				return;
			}
			const gradient = defs
				.append("linearGradient")
				.attr("id", `impacts-walk-gradient-${sourceStage}-${targetStage}`)
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", stageBounds.get(sourceStage)?.x1 ?? 0)
				.attr("y1", 0)
				.attr("x2", stageBounds.get(targetStage)?.x0 ?? width)
				.attr("y2", 0);
			gradient
				.append("stop")
				.attr("offset", "0%")
				.style("stop-color", `var(${sourceColorVar})`)
				.attr("stop-opacity", 0.4);
			gradient
				.append("stop")
				.attr("offset", "100%")
				.style("stop-color", `var(${targetColorVar})`)
				.attr("stop-opacity", 0.4);
		});

		const linkStroke = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;
			if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
				return `url(#impacts-walk-gradient-${sourceStage}-${targetStage})`;
			}
			return "rgba(208, 222, 235, 0.38)";
		};

		const linkGen = d3.sankeyLinkHorizontal();
		const linkPathFromGeom = (geom) =>
			linkGen({ source: { x1: geom.sx }, target: { x0: geom.tx }, y0: geom.y0, y1: geom.y1 });

		const linksGroup = svg
			.append("g")
			.attr("fill", "none")
			.attr("stroke-opacity", 1)
			.attr("class", "sankey-links");
		const linkSelection = linksGroup
			.selectAll("path")
			.data(linkData, (d) => d.id)
			.join("path")
			.attr("class", "sankey-link")
			.style("stroke", linkStroke);

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");
		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(nodeData, (d) => d.id)
			.join("g")
			.attr("class", (d) => `sankey-node stage-${d.stage}`);

		// The white "avoided" cap sits above the remaining body; the ripple beats
		// grow it downward from zero. Geometry is applied in drawImpactsWalkChart.
		nodeSelection.append("rect").attr("class", "impacts-node-avoided").attr("x", 0).attr("y", 0);
		nodeSelection.append("rect").attr("class", "impacts-node-remaining").attr("x", 0);

		nodeSelection
			.append("title")
			.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));

		nodeSelection
			.append("text")
			.attr("x", (d) => {
				const geom = carveNodeOf(d.id);
				return d.stage !== 7 ? Math.max(1, geom.x1 - geom.x0) + 8 : -8;
			})
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.stage !== 7 ? "start" : "end"))
			.text((d) => d.label);

		wrapNodeLabels(nodeSelection.selectAll("text"), computeLabelMaxWidth(carveGraph));

		const headersGroup = svg
			.append("g")
			.attr("class", "sankey-stage-headers")
			.style("opacity", 0);
		renderStageHeaders(headersGroup, carveGraph, 24);

		state.impactsWalkRendered = {
			svg,
			nodeSelection,
			linkSelection,
			headersGroup,
			fullNodeOf,
			carveNodeOf,
			fullLinkOf,
			carveLinkOf,
			nodePresence,
			linkPresence,
			linkPathFromGeom,
			avoidedRatioById,
			rippleOrderById
		};

		// The company card reads its numbers off state.impactsRendered, so point it
		// at the carved graph the walkthrough lands on.
		state.impactsRendered = {
			nodeSelection,
			linkSelection,
			graph: carveGraph,
			scenarioId: IMPACTS_SCENARIO_ID,
			scenarioKey
		};

		drawImpactsWalkChart(state.impactsWalkProgress || 0);
	}

	// Right column: chart fade-in, the full -> carved layout morph, and the
	// avoided-emissions ripple spreading stage by stage.
	function drawImpactsWalkChart(p) {
		const r = state.impactsWalkRendered;
		if (!r) {
			return;
		}

		r.svg.style("opacity", smoothstep(walkT(p, "chart-in")));

		const t = smoothstep(walkT(p, "carve-morph"));
		r.headersGroup.style("opacity", t);

		const geomFor = (id) => {
			const a = r.fullNodeOf(id);
			const b = r.carveNodeOf(id);
			return {
				x0: lerp(a.x0, b.x0, t),
				y0: lerp(a.y0, b.y0, t),
				w: lerp(Math.max(1, a.x1 - a.x0), Math.max(1, b.x1 - b.x0), t),
				h: lerp(Math.max(3, a.y1 - a.y0), Math.max(3, b.y1 - b.y0), t)
			};
		};

		const focalNodeId = state.portfolioBusinessNodeMap.get(IMPACTS_WALK_COMPANY) || null;
		const focalReveal = smoothstep(walkT(p, "avoided-in"));
		const serviceLocal = walkT(p, "ripple-final-service");
		const cascadeLocal = walkT(p, "ripple-cascade");
		// Stage windows overlap slightly so the cascade reads as a wave rather than
		// a sequence of discrete steps.
		const stageSpan = 0.4;
		const stageStep =
			IMPACTS_RIPPLE_STAGES.length > 1 ? (1 - stageSpan) / (IMPACTS_RIPPLE_STAGES.length - 1) : 0;

		const revealFor = (node) => {
			if (focalNodeId && node.id === focalNodeId) {
				return focalReveal;
			}
			const order = r.rippleOrderById.get(node.id);
			if (!order) {
				return 0;
			}
			if (node.stage === 1) {
				return staggeredReveal(serviceLocal, order.index, order.count, 0.45);
			}
			const stageIndex = IMPACTS_RIPPLE_STAGES.indexOf(node.stage);
			if (stageIndex < 0) {
				return 0;
			}
			const local = clamp01((cascadeLocal - stageIndex * stageStep) / stageSpan);
			return staggeredReveal(local, order.index, order.count, 0.45);
		};

		r.nodeSelection.each(function (d) {
			const group = d3.select(this);
			const geom = geomFor(d.id);
			const avoidedH = geom.h * (r.avoidedRatioById.get(d.id) || 0) * revealFor(d);

			group.attr("transform", `translate(${geom.x0},${geom.y0})`);
			const [inFull, inCarve] = r.nodePresence(d.id);
			group.style("opacity", lerp(inFull, inCarve, t));
			group.select("rect.impacts-node-avoided").attr("width", geom.w).attr("height", avoidedH);
			group
				.select("rect.impacts-node-remaining")
				.attr("width", geom.w)
				.attr("y", avoidedH)
				.attr("height", Math.max(0, geom.h - avoidedH));
			group.selectAll("text").attr("y", geom.h / 2);
		});

		r.linkSelection
			.attr("d", (d) => {
				const a = r.fullLinkOf(d.key);
				const b = r.carveLinkOf(d.key);
				return r.linkPathFromGeom({
					sx: lerp(a.sx, b.sx, t),
					tx: lerp(a.tx, b.tx, t),
					y0: lerp(a.y0, b.y0, t),
					y1: lerp(a.y1, b.y1, t)
				});
			})
			.attr("stroke-width", (d) =>
				Math.max(0, lerp(r.fullLinkOf(d.key).width, r.carveLinkOf(d.key).width, t))
			)
			.style("opacity", (d) => {
				const [inFull, inCarve] = r.linkPresence(d.key);
				return lerp(inFull, inCarve, t);
			});
	}

	function findNodeLabelById(nodeId) {
		const initNodes = state.initData?.nodes?.nodes;
		if (!nodeId || !Array.isArray(initNodes)) {
			return "";
		}
		const node = initNodes.find((entry) => String(entry?.id || "").trim() === nodeId);
		if (!node) {
			return deriveLabelFromId(nodeId);
		}
		return String(node?.label || deriveLabelFromId(nodeId) || "").trim();
	}

	function resolveImpactsNodeLabel(selection) {
		const businessId = normalizeBusinessSlug(selection?.businessId);
		const mappedNodeId =
			String(selection?.nodeId || "").trim() ||
			String(state.portfolioBusinessNodeMap?.get(businessId) || "").trim();

		const fromNodeId = mappedNodeId ? findNodeLabelById(mappedNodeId) : "";
		if (fromNodeId) {
			return fromNodeId;
		}

		if (impactsNodeLabelByBusiness[businessId]) {
			return impactsNodeLabelByBusiness[businessId];
		}

		return "No mapped node available";
	}

	function impactsNodeMetrics(nodeId) {
		if (!nodeId || !Array.isArray(state.impactsRendered?.graph?.nodes)) {
			return {
				totalMt: 0,
				avoidedMt: 0,
				remainingMt: 0,
				avoidedRatio: 0
			};
		}

		const node = state.impactsRendered.graph.nodes.find(
			(entry) => String(entry?.id || "").trim() === String(nodeId || "").trim()
		);

		if (!node) {
			return {
				totalMt: 0,
				avoidedMt: 0,
				remainingMt: 0,
				avoidedRatio: 0
			};
		}

		const totalMt = Math.max(0, toFiniteNumber(node.value, 0));
		const avoidedMt = Math.max(0, Math.min(totalMt, toFiniteNumber(node.avoided, 0)));
		const remainingMt = Math.max(0, totalMt - avoidedMt);
		const avoidedRatio = totalMt > 0 ? avoidedMt / totalMt : 0;

		return {
			totalMt,
			avoidedMt,
			remainingMt,
			avoidedRatio
		};
	}

	// Several companies ship with `technology: null` until the client fills them
	// in, so fall back to the company's own name rather than the theme label,
	// which reads oddly mid-sentence ("Clean energy generation has the potential…").
	function resolveImpactsTechnologyLabel(selection) {
		const technology = String(selection?.technologyLabel || "").trim();
		if (technology) {
			return technology;
		}
		const label = String(selection?.label || "").trim();
		if (label) {
			return `${label}'s technology`;
		}
		return "This technology";
	}

	// The card sentence is also used verbatim as beat 2 of the walkthrough copy,
	// so it lives in one place rather than being duplicated per call site.
	function impactsSentenceHtml(technologyLabel, amountText) {
		return (
			`When deployed at a transformative scale, ${technologyLabel} has the potential to reduce global emissions by ` +
			`<strong class="impacts-company-card__sentence-accent">${amountText}</strong> in 2040.`
		);
	}

	function updateImpactsCompanyCard(selection) {
		const card = state.impactsCard;
		if (!card) {
			return;
		}

		if (!selection) {
			card.prompt.hidden = false;
			card.content.hidden = true;
			card.root.classList.remove("is-active");
			return;
		}

		const nodeLabel = resolveImpactsNodeLabel(selection);
		const nodeLabelText = nodeLabel || "No mapped node available";
		const nodeStage = deriveStageFromId(selection.nodeId);
		const nodeStageVar = stageColorVars[nodeStage] || "--color-final-energy";
		const logoSrc = impactsLogoByBusiness[selection.businessId] || impactsLogoFallback;
		const nodeMetrics = impactsNodeMetrics(selection.nodeId);
		const avoidedHeightPct = Math.round(Math.min(1, Math.max(0, nodeMetrics.avoidedRatio)) * 100);
		const remainingHeightPct = Math.max(0, 100 - avoidedHeightPct);
		const technologyLabel = resolveImpactsTechnologyLabel(selection);

		if (selection.businessId && !state.avoidedData) {
			card.logo.src = logoSrc;
			card.logo.alt = `${selection.label} logo`;
			card.sentence.innerHTML = impactsSentenceHtml(technologyLabel, "loading...");
			card.nodeBar.style.setProperty("--impacts-node-color", `var(${nodeStageVar})`);
			card.nodeBar.style.setProperty("--impacts-node-avoided-height", "0%");
			card.nodeBar.style.setProperty("--impacts-node-remaining-height", "100%");
			card.nodeName.textContent = nodeLabelText;
			if (card.nodeSavings) {
				card.nodeSavings.textContent = "- loading...";
			}
			if (card.nodePercentage) {
				card.nodePercentage.hidden = true;
				card.nodePercentage.textContent = "";
			}
			card.prompt.hidden = true;
			card.content.hidden = false;
			card.root.classList.add("is-active");
			return;
		}

		card.logo.src = logoSrc;
		card.logo.alt = `${selection.label} logo`;
		card.nodeBar.style.setProperty("--impacts-node-color", `var(${nodeStageVar})`);
		card.nodeBar.style.setProperty("--impacts-node-avoided-height", `${avoidedHeightPct}%`);
		card.nodeBar.style.setProperty("--impacts-node-remaining-height", `${remainingHeightPct}%`);
		card.nodeName.textContent = nodeLabelText;
		card.nodeBar.setAttribute(
			"aria-label",
			`Avoided ${formatMass(nodeMetrics.avoidedMt)}; remaining ${formatMass(nodeMetrics.remainingMt)}.`
		);

		const nodeAvoidedGt = nodeMetrics.avoidedMt / 1000;
		const nodeAvoidedGtText = nodeAvoidedGt > 0 ? `${d3.format(".2f")(nodeAvoidedGt)} Gt` : "N/A";
		const nodeSavingsText = nodeAvoidedGtText === "N/A" ? "- N/A" : `-${nodeAvoidedGtText}`;
		const sentenceAmountText = nodeSavingsText.replace(/^\s*-\s*/, "");
		const showNodePercentage = nodeMetrics.totalMt > 0;
		const nodeAvoidedPctText = `${d3.format(".1f")(Math.max(0, Math.min(1, nodeMetrics.avoidedRatio)) * 100)}% avoided`;

		if (card.nodePercentage) {
			if (showNodePercentage) {
				card.nodePercentage.hidden = false;
				card.nodePercentage.textContent = nodeAvoidedPctText;
			} else {
				card.nodePercentage.hidden = true;
				card.nodePercentage.textContent = "";
			}
		}

		if (nodeAvoidedGtText !== "N/A") {
			card.sentence.innerHTML = impactsSentenceHtml(technologyLabel, sentenceAmountText);
			if (card.nodeSavings) {
				card.nodeSavings.textContent = nodeSavingsText;
			}
		} else {
			card.sentence.innerHTML = impactsSentenceHtml(technologyLabel, "data pending");
			if (card.nodeSavings) {
				card.nodeSavings.textContent = nodeSavingsText;
			}
		}

		renderImpactsCardTabs(selection);

		card.prompt.hidden = true;
		card.content.hidden = false;
		card.root.classList.add("is-active");
	}

	// Populates the two prose tab panels. Bullets are still being authored for
	// most companies, so an empty list renders an explicit placeholder rather
	// than an empty panel.
	function renderImpactsCardTabs(selection) {
		const card = state.impactsCard;
		if (!card) {
			return;
		}

		if (card.bullets) {
			card.bullets.innerHTML = "";
			const bullets = Array.isArray(selection?.bullets) ? selection.bullets : [];
			const items = bullets.length ? bullets : ["data not found"];
			items.forEach((text) => {
				const li = document.createElement("li");
				li.textContent = text;
				card.bullets.append(li);
			});
		}

		if (card.overview) {
			card.overview.innerHTML = "";
			const paragraphs = Array.isArray(selection?.overview) ? selection.overview : [];
			const items = paragraphs.length ? paragraphs : ["data not found"];
			items.forEach((text) => {
				const p = document.createElement("p");
				p.textContent = text;
				card.overview.append(p);
			});
		}
	}

	function setActiveImpactsTab(tabId) {
		const card = state.impactsCard;
		if (!card?.tabs?.length) {
			return;
		}
		state.impactsTabId = tabId;
		card.tabs.forEach((tab) => {
			const isActive = tab.dataset.impactsTab === tabId;
			tab.classList.toggle("is-active", isActive);
			tab.setAttribute("aria-selected", isActive ? "true" : "false");
		});
		card.panels.forEach((panel) => {
			panel.hidden = panel.dataset.impactsPanel !== tabId;
		});
	}

	function renderImpactsRoster(model) {
		const rosterWrap = document.querySelector("[data-impacts-roster]");
		if (!rosterWrap) {
			return;
		}

		rosterWrap.innerHTML = "";
		state.impactsRosterIndex = new Map();

		model.forEach((theme) => {
			const col = document.createElement("div");
			col.className = "impacts-roster__col";
			col.dataset.theme = theme.slug;
			const colTitle = document.createElement("h4");
			colTitle.className = "impacts-roster__title";
			colTitle.textContent = theme.label;
			const list = document.createElement("ul");
			list.className = "impacts-roster__list";

			theme.companies.forEach((company, index) => {
				const key = `${theme.slug}:${index}`;
				const item = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.className = "impacts-businesses__company";
				button.textContent = company.label;
				button.dataset.impactsBusinessId = company.businessId || "";
				button.dataset.impactsCompanyKey = key;
				button.setAttribute("aria-pressed", "false");
				item.append(button);
				list.append(item);

				state.impactsRosterIndex.set(key, {
					key,
					label: company.label,
					themeLabel: theme.label,
					technologyLabel: company.technologyLabel,
					bullets: company.bullets || [],
					overview: company.overview || [],
					businessId: company.businessId,
					nodeId: company.nodeId
				});
			});

			col.append(colTitle, list);
			rosterWrap.append(col);
		});
	}

	function syncImpactsBusinessButtons(activeCompanyKey) {
		const buttons = Array.from(document.querySelectorAll("[data-impacts-company-key]"));
		buttons.forEach((button) => {
			const isActive = button.dataset.impactsCompanyKey === activeCompanyKey;
			button.classList.toggle("is-active", isActive);
			button.setAttribute("aria-pressed", isActive ? "true" : "false");
		});
	}

	function setActiveImpactsBusiness(companyKey) {
		if (!state.impactsRosterIndex?.has(companyKey)) {
			return;
		}
		// The roster is inert until the walkthrough hands control over.
		if (!state.impactsHandedOff) {
			return;
		}

		const company = state.impactsRosterIndex.get(companyKey);
		const businessId = normalizeBusinessSlug(company.businessId);

		// Toggle off if the active company is clicked again -> back to baseline.
		const nextCompanyKey = state.impactsCompanyKey === companyKey ? "" : companyKey;
		state.impactsCompanyKey = nextCompanyKey;

		const activeBusinessId =
			nextCompanyKey && supportedPortfolioBusinesses.has(businessId) ? businessId : "";
		state.impactsBusinessId = activeBusinessId;
		window.currentImpactsBusinessId = activeBusinessId;

		syncImpactsBusinessButtons(nextCompanyKey);
		// Selecting a company hands the chart to the interactive renderer, which
		// tears down the walkthrough's rendering; flag it so scrolling back up
		// rebuilds the morph instead of scrubbing a detached selection.
		renderImpactsSankey();
		state.impactsWalkChartStale = true;
		updateImpactsCompanyCard(nextCompanyKey ? company : null);
	}

	function setupImpactsBusinessSync() {
		const cardRoot = document.querySelector("[data-impacts-company-card]");
		if (cardRoot) {
			state.impactsCard = {
				root: cardRoot,
				prompt: cardRoot.querySelector("[data-impacts-card-prompt]"),
				content: cardRoot.querySelector("[data-impacts-card-content]"),
				logo: cardRoot.querySelector("[data-impacts-card-logo]"),
				sentence: cardRoot.querySelector("[data-impacts-card-sentence]"),
				nodeBar: cardRoot.querySelector("[data-impacts-card-node-bar]"),
				nodeAvoided: cardRoot.querySelector("[data-impacts-card-node-avoided]"),
				nodeRemaining: cardRoot.querySelector("[data-impacts-card-node-remaining]"),
				nodeName: cardRoot.querySelector("[data-impacts-card-node-name]"),
				nodeSavings: cardRoot.querySelector("[data-impacts-card-node-savings]"),
				nodePercentage: cardRoot.querySelector("[data-impacts-card-node-percentage]"),
				bullets: cardRoot.querySelector("[data-impacts-card-bullets]"),
				overview: cardRoot.querySelector("[data-impacts-card-overview]"),
				tabs: Array.from(cardRoot.querySelectorAll("[data-impacts-tab]")),
				panels: Array.from(cardRoot.querySelectorAll("[data-impacts-panel]"))
			};

			state.impactsCard.tabs.forEach((tab) => {
				tab.addEventListener("click", () => {
					setActiveImpactsTab(tab.dataset.impactsTab || "avoided");
				});
			});
			setActiveImpactsTab(state.impactsTabId);

			if (state.impactsCard.logo) {
				state.impactsCard.logo.addEventListener("error", () => {
					state.impactsCard.logo.src = impactsLogoFallback;
				});
			}

			updateImpactsCompanyCard(null);
		}

		ensureThemesData()
			.then((data) => {
				const model = state.themesModel || buildThemesModel(data);
				if (!state.themesModel) {
					state.themesModel = model;
				}

				renderImpactsRoster(model);
				const buttons = Array.from(document.querySelectorAll("[data-impacts-company-key]"));
				buttons.forEach((button) => {
					button.addEventListener("click", () => {
						setActiveImpactsBusiness(button.dataset.impactsCompanyKey || "");
					});
				});

				syncImpactsBusinessButtons(state.impactsCompanyKey);
			})
			.catch((error) => {
				console.warn("[Sankey] Could not initialize impacts roster:", error);
			});
	}

	// Left column: the four copy beats, the standalone node visual, the roster,
	// and finally the interactive company card.
	function drawImpactsWalkCopy(p) {
		const c = state.impactsWalkCopy;
		if (!c) {
			return;
		}

		const copy1Out = smoothstep(walkT(p, "copy1-out"));
		const copy3Out = smoothstep(walkT(p, "copy3-out"));
		const rosterIn = smoothstep(walkT(p, "roster-in"));
		const cardIn = smoothstep(walkT(p, "card-reveal"));

		const setOpacity = (el, value) => {
			if (el) {
				el.style.opacity = String(value);
			}
		};

		setOpacity(c.copies[0], smoothstep(walkT(p, "copy-in")) * (1 - copy1Out));
		setOpacity(
			c.copies[1],
			smoothstep(walkT(p, "copy2-in")) * (1 - smoothstep(walkT(p, "copy2-out")))
		);
		setOpacity(c.copies[2], smoothstep(walkT(p, "copy3-in")) * (1 - copy3Out));
		// Copy 4 hands the column over to the roster, so it clears as the roster arrives.
		setOpacity(c.copies[3], smoothstep(walkT(p, "copy4-in")) * (1 - rosterIn));

		// The copy starts vertically centred in the column and rises to the top as
		// the chart carves down to the company's own subgraph.
		if (c.stack) {
			const rise = smoothstep(walkT(p, "carve-morph"));
			c.stack.style.transform = `translateY(${lerp(c.centerOffset || 0, 0, rise)}px)`;
		}

		if (c.node) {
			// Trails the copy out so the two don't leave in lockstep.
			const nodeOut = smoothstep(clamp01((walkT(p, "copy3-out") - 0.3) / 0.7));
			setOpacity(c.node, smoothstep(walkT(p, "node-visual-in")) * (1 - nodeOut));
		}

		const avoidedPct = (c.avoidedRatio || 0) * smoothstep(walkT(p, "avoided-in")) * 100;
		if (c.nodeBar) {
			c.nodeBar.style.setProperty("--impacts-node-avoided-height", `${avoidedPct}%`);
			c.nodeBar.style.setProperty("--impacts-node-remaining-height", `${100 - avoidedPct}%`);
		}
		if (c.nodePercentage) {
			c.nodePercentage.textContent = `${d3.format(".1f")(avoidedPct)}% avoided`;
		}

		if (c.roster) {
			setOpacity(c.roster, rosterIn);
			c.roster.style.pointerEvents = state.impactsHandedOff ? "auto" : "none";
		}

		if (c.card) {
			setOpacity(c.card, cardIn);
			c.card.classList.toggle("is-live", state.impactsHandedOff);
		}
	}

	// One scroll clock drives both columns, plus the handoff into the live
	// interactive state once the final transition beat completes.
	function drawImpactsWalk(progress) {
		const p = clamp01(progress);
		state.impactsWalkProgress = p;

		const boldStart = IMPACTS_WALK_BOUNDS["company-bold"]?.start ?? 1;
		const handoffStart = IMPACTS_WALK_BOUNDS["handoff"]?.start ?? 1;

		// The walkthrough presets the focal company so the roster and card read as
		// already-selected the moment the visitor takes over.
		const shouldPreselect = p >= boldStart;
		if (shouldPreselect !== state.impactsWalkPreselected) {
			state.impactsWalkPreselected = shouldPreselect;
			if (shouldPreselect) {
				applyImpactsWalkPreselection();
			} else {
				state.impactsCompanyKey = "";
				syncImpactsBusinessButtons("");
			}
		}

		state.impactsHandedOff = p >= handoffStart;
		impactsIsInteractive = state.impactsHandedOff;
		updateViewportFrame();

		if (!state.impactsHandedOff && state.impactsWalkChartStale) {
			state.impactsWalkChartStale = false;
			renderImpactsWalkChart();
		}

		drawImpactsWalkCopy(p);
		drawImpactsWalkChart(p);
	}

	// Fades the whole pinned stage out at the very end of its scroll runway
	// (linear, no ease) so #climate-impacts is invisible by the time it
	// un-pins, instead of visibly scrolling up. Kept separate from
	// drawImpactsWalk() itself, which is also called with a bare `1` by the
	// static (reduced-motion / mobile) fallbacks below -- those want the
	// finished, fully-visible end state, not a faded-out one.
	function applyImpactsExitFade(progress) {
		const p = clamp01(progress);
		const exitT = clamp01((p - IMPACTS_EXIT_START) / (1 - IMPACTS_EXIT_START));
		impactsExiting = exitT > 0;
		if (impactsLayoutEl) {
			impactsLayoutEl.style.opacity = String(1 - exitT);
		}
		updateViewportFrame();
	}

	function impactsWalkRosterKey() {
		for (const [key, entry] of state.impactsRosterIndex) {
			if (normalizeBusinessSlug(entry.businessId) === IMPACTS_WALK_COMPANY) {
				return key;
			}
		}
		return "";
	}

	function applyImpactsWalkPreselection() {
		const key = impactsWalkRosterKey();
		if (!key) {
			return;
		}
		state.impactsCompanyKey = key;
		state.impactsBusinessId = supportedPortfolioBusinesses.has(IMPACTS_WALK_COMPANY)
			? IMPACTS_WALK_COMPANY
			: "";
		window.currentImpactsBusinessId = state.impactsBusinessId;
		syncImpactsBusinessButtons(key);
		updateImpactsCompanyCard(state.impactsRosterIndex.get(key) || null);
	}

	// The copy stack starts centred in the column, so its travel distance has to
	// be measured rather than hardcoded; re-run on resize.
	function measureImpactsWalkCopy() {
		const c = state.impactsWalkCopy;
		if (!c?.stack || !c.stage) {
			return;
		}
		const stageH = c.stage.getBoundingClientRect().height;
		const stackH = c.stack.getBoundingClientRect().height;
		c.centerOffset = Math.max(0, (stageH - stackH) / 2);
		drawImpactsWalkCopy(state.impactsWalkProgress || 0);
	}

	// Wires up the walkthrough: caches left-column elements, fills the copy that
	// is generated from data, renders the morphing chart, then attaches the
	// scroll clock. Avoided data must be resolved first or the data-driven beats
	// would render a "loading" state.
	function initImpactsWalk() {
		const walkEl = document.querySelector(".impacts-walk");
		if (!walkEl) {
			return;
		}

		walkEl.style.setProperty("--impacts-walk-vh", String(IMPACTS_WALK_TOTAL_VH));

		state.impactsWalkCopy = {
			stage: walkEl.querySelector(".impacts-walk__stage"),
			stack: walkEl.querySelector("[data-impacts-walk-copy-stack]"),
			copies: [1, 2, 3, 4].map((n) =>
				walkEl.querySelector(`[data-impacts-walk-copy="${n}"]`)
			),
			node: walkEl.querySelector("[data-impacts-walk-node]"),
			nodeBar: walkEl.querySelector("[data-impacts-walk-node-bar]"),
			nodeName: walkEl.querySelector("[data-impacts-walk-node-name]"),
			nodePercentage: walkEl.querySelector("[data-impacts-walk-node-percentage]"),
			roster: walkEl.querySelector(".impacts-businesses"),
			card: walkEl.querySelector("[data-impacts-company-card]"),
			avoidedRatio: 0,
			centerOffset: 0
		};

		ensureAvoidedData()
			.then(() => {
				renderImpactsWalkChart();
				populateImpactsWalkCopy();
				measureImpactsWalkCopy();
				setupImpactsWalkScroll();
			})
			.catch((error) => {
				console.warn("[Sankey] Could not initialize impacts walkthrough:", error);
			});
	}

	// Beat 2's sentence and the node visual's labels are derived from the focal
	// company's own data rather than hardcoded in markup.
	function populateImpactsWalkCopy() {
		const c = state.impactsWalkCopy;
		if (!c) {
			return;
		}

		const nodeId = state.portfolioBusinessNodeMap.get(IMPACTS_WALK_COMPANY) || "";
		const metrics = impactsNodeMetrics(nodeId);
		c.avoidedRatio = Math.max(0, Math.min(1, metrics.avoidedRatio));

		if (c.nodeName) {
			c.nodeName.textContent = findNodeLabelById(nodeId) || "";
		}
		if (c.nodeBar) {
			const stageVar = stageColorVars[deriveStageFromId(nodeId)] || "--color-final-energy";
			c.nodeBar.style.setProperty("--impacts-node-color", `var(${stageVar})`);
		}

		if (c.copies[1]) {
			const company = state.initData?.intervention?.companies?.find(
				(entry) =>
					normalizeBusinessSlug(entry?.company || entry?.company_label) === IMPACTS_WALK_COMPANY
			);
			const technologyLabel = resolveImpactsTechnologyLabel({
				technologyLabel: String(company?.technology || "").trim(),
				label: String(company?.company_label || company?.company || "").trim()
			});
			const avoidedGt = metrics.avoidedMt / 1000;
			const amountText = avoidedGt > 0 ? `${d3.format(".2f")(avoidedGt)} Gt` : "data pending";
			c.copies[1].innerHTML = impactsSentenceHtml(technologyLabel, amountText);
		}
	}

	// A plain scrubbed ScrollTrigger over the walkthrough's own runway; the
	// sticky pinning is handled in CSS by .impacts-layout. Reduced motion still
	// gets the full walk (it is scroll-driven, not autoplaying) — only a missing
	// GSAP falls back to the end state.
	function setupImpactsWalkScroll() {
		const walkEl = document.querySelector(".impacts-walk");
		if (!walkEl) {
			return;
		}

		if (!window.gsap || !window.ScrollTrigger) {
			drawImpactsWalk(1);
			return;
		}

		ScrollTrigger.matchMedia({
			"(min-width: 901px)": () => {
				const scrubST = ScrollTrigger.create({
					trigger: walkEl,
					start: "top top",
					end: "bottom bottom",
					scrub: true,
					invalidateOnRefresh: true,
					onUpdate: (self) => {
						drawImpactsWalk(self.progress);
						applyImpactsExitFade(self.progress);
					},
					onRefresh: (self) => {
						drawImpactsWalk(self.progress);
						applyImpactsExitFade(self.progress);
					}
				});

				return () => {
					scrubST.kill();
				};
			},
			"(max-width: 900px)": () => {
				// No scroll clock on mobile: land on the end state.
				drawImpactsWalk(1);
				return () => {};
			}
		});
	}

	// --- Hero copy intro (two crossfading panels, locked once .hero-stage has
	// scrolled off #hero-intro's pin). Same in/hold/out beat lengths as the
	// timeline/impacts/portfolio intros (48/40/40/48/60/80vh) over a 316vh
	// scrub range + 80vh pinned viewport; their 96vh bg-fade-in lead-in is
	// dropped since this block has no __bg layer.
	const HCI_TOTAL_VH = 316;
	const HCI_LINE1_IN = [0, 48 / HCI_TOTAL_VH];
	const HCI_LINE1_OUT = [88 / HCI_TOTAL_VH, 128 / HCI_TOTAL_VH];
	const HCI_LINE2_IN = [128 / HCI_TOTAL_VH, 176 / HCI_TOTAL_VH];
	const HCI_ALL_OUT = [236 / HCI_TOTAL_VH, 1];

	function drawHeroCopyIntro(progress) {
		state.heroCopyIntroProgress = progress;
		const allOut = windowProgress(progress, HCI_ALL_OUT);
		if (state.heroCopyIntroLine1El) {
			const inAmt = windowProgress(progress, HCI_LINE1_IN);
			const outAmt = windowProgress(progress, HCI_LINE1_OUT);
			state.heroCopyIntroLine1El.style.opacity = String(inAmt * (1 - outAmt));
		}
		if (state.heroCopyIntroLine2El) {
			const inAmt = windowProgress(progress, HCI_LINE2_IN);
			state.heroCopyIntroLine2El.style.opacity = String(inAmt * (1 - allOut));
		}
	}

	function setupHeroCopyIntroScroll() {
		const section = document.querySelector(".hero-copy-intro");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawHeroCopyIntro(1);
			return;
		}
		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawHeroCopyIntro(self.progress),
			onRefresh: (self) => drawHeroCopyIntro(self.progress)
		});
		drawHeroCopyIntro(0);
	}

	function initHeroCopyIntroSection() {
		const section = document.querySelector(".hero-copy-intro");
		if (!section) {
			return;
		}
		state.heroCopyIntroLine1El = document.querySelector(".hero-copy-intro .hero-copy-2");
		state.heroCopyIntroLine2El = document.querySelector(".hero-copy-intro .hero-copy-3");
		setupHeroCopyIntroScroll();
	}

	// Bg fade + two crossfading lines, locked .impacts-intro (mirrors the
	// portfolio/timeline intros: 412vh scrub range + 80vh pinned viewport,
	// sequential bg-in 96vh, line1-in 48vh, hold 40vh, line1-out 40vh,
	// line2-in 48vh, hold 60vh, line2+bg fade-out together over the final 80vh).
	const II_TOTAL_VH = 412;
	const II_BG_IN = [0, 96 / II_TOTAL_VH];
	const II_LINE1_IN = [96 / II_TOTAL_VH, 144 / II_TOTAL_VH];
	const II_LINE1_OUT = [184 / II_TOTAL_VH, 224 / II_TOTAL_VH];
	const II_LINE2_IN = [224 / II_TOTAL_VH, 272 / II_TOTAL_VH];
	const II_ALL_OUT = [332 / II_TOTAL_VH, 1];

	function drawImpactsIntro(progress) {
		state.impactsIntroProgress = progress;
		const bgIn = windowProgress(progress, II_BG_IN);
		const allOut = windowProgress(progress, II_ALL_OUT);
		if (state.impactsIntroBgEl) {
			state.impactsIntroBgEl.style.opacity = String(bgIn * (1 - allOut));
		}
		if (state.impactsIntroLine1El) {
			const inAmt = windowProgress(progress, II_LINE1_IN);
			const outAmt = windowProgress(progress, II_LINE1_OUT);
			state.impactsIntroLine1El.style.opacity = String(inAmt * (1 - outAmt));
		}
		if (state.impactsIntroLine2El) {
			const inAmt = windowProgress(progress, II_LINE2_IN);
			state.impactsIntroLine2El.style.opacity = String(inAmt * (1 - allOut));
		}
	}

	function setupImpactsIntroScroll() {
		const section = document.querySelector(".impacts-intro");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawImpactsIntro(1);
			return;
		}
		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawImpactsIntro(self.progress),
			onRefresh: (self) => drawImpactsIntro(self.progress)
		});
		drawImpactsIntro(0);
	}

	function initImpactsIntroSection() {
		const section = document.querySelector(".impacts-intro");
		if (!section) {
			return;
		}
		state.impactsIntroBgEl = document.querySelector(".impacts-intro .impacts-intro__bg");
		state.impactsIntroLine1El = document.querySelector(".impacts-intro .impacts-intro__line--1");
		state.impactsIntroLine2El = document.querySelector(".impacts-intro .impacts-intro__line--2");
		setupImpactsIntroScroll();
	}

	// --- Closing transition (night sky hand-off, locked #closing-transition) --
	// Hands the persistent #site-bg starfield off to a section-local canvas that
	// brightens toward the real opening frame of the closing video, while 4
	// headline lines crossfade over the top. 900vh scroll range: a short lead-in
	// (sky only), then 4 sequential in/hold/out line windows, then a tail
	// crossfade into closing-transition-frame.jpg (the video's real frame 0)
	// before the video section takes over.
	// The sticky pin (80vh viewport) releases at (CT_TOTAL_VH-80)/CT_TOTAL_VH =
	// 640/720 and then scrolls away over the section's final 80vh. Everything
	// below must finish settling comfortably before that release point, or the
	// pin ends up mid-fade while it's already physically scrolling off-screen.
	const CT_TOTAL_VH = 720;
	const CT_LINE1_IN = [32 / CT_TOTAL_VH, 64 / CT_TOTAL_VH];
	const CT_LINE1_OUT = [120 / CT_TOTAL_VH, 152 / CT_TOTAL_VH];
	const CT_LINE2_IN = [168 / CT_TOTAL_VH, 200 / CT_TOTAL_VH];
	const CT_LINE2_OUT = [256 / CT_TOTAL_VH, 288 / CT_TOTAL_VH];
	const CT_LINE3_IN = [304 / CT_TOTAL_VH, 336 / CT_TOTAL_VH];
	const CT_LINE3_OUT = [392 / CT_TOTAL_VH, 424 / CT_TOTAL_VH];
	const CT_LINE4_IN = [440 / CT_TOTAL_VH, 472 / CT_TOTAL_VH];
	const CT_LINE4_OUT = [528 / CT_TOTAL_VH, 560 / CT_TOTAL_VH];
	// Crossfade completes by 608/720, leaving a 32vh fully-settled hold before
	// the 640/720 release so the handoff into the video happens on a static frame.
	const CT_CROSSFADE = [560 / CT_TOTAL_VH, 608 / CT_TOTAL_VH];

	// Gradient stops the canvas interpolates between as progress goes 0 -> 1.
	// FROM matches night-sky-bg-static.html's gradient exactly (the persistent
	// #site-bg starfield visible through #climate-impacts) so the hand-off is
	// invisible. TO is sampled directly from frame 0 of closing-video-opt-v1.mp4
	// so the tail crossfade into closing-transition-frame.jpg is seamless.
	const CT_SKY_FROM = [[0, [4, 5, 10]], [0.55, [5, 5, 6]], [1, [11, 16, 32]]];
	const CT_SKY_TO = [[0, [15, 22, 29]], [0.25, [16, 26, 36]], [0.5, [17, 33, 54]], [0.7, [23, 51, 78]], [0.85, [43, 79, 117]], [1, [74, 113, 157]]];

	function drawClosingTransitionText(progress) {
		state.closingTransitionProgress = progress;
		const crossfade = windowProgress(progress, CT_CROSSFADE);
		if (state.closingTransitionFrameEl) {
			state.closingTransitionFrameEl.style.opacity = String(crossfade);
		}
		const lines = [
			[state.closingTransitionLine1El, CT_LINE1_IN, CT_LINE1_OUT],
			[state.closingTransitionLine2El, CT_LINE2_IN, CT_LINE2_OUT],
			[state.closingTransitionLine3El, CT_LINE3_IN, CT_LINE3_OUT],
			[state.closingTransitionLine4El, CT_LINE4_IN, CT_LINE4_OUT]
		];
		for (const [el, inWindow, outWindow] of lines) {
			if (!el) {
				continue;
			}
			const inAmt = windowProgress(progress, inWindow);
			const outAmt = windowProgress(progress, outWindow);
			el.style.opacity = String(inAmt * (1 - outAmt));
		}
	}

	function buildClosingTransitionStars(width, height) {
		const rand = (a, b) => Math.random() * (b - a) + a;
		const total = Math.max(400, Math.round((width * height) / 620));
		const opening = Math.max(90, Math.round((width * height) / 14000));
		const stars = [];
		for (let i = 0; i < total; i++) {
			const early = i < opening;
			const size = early
				? (Math.random() < 0.82 ? 1 : Math.random() < 0.97 ? 2 : 3)
				: (Math.random() < 0.9 ? 1 : 2);
			const tint = Math.random() < 0.25 ? "255,241,221" : Math.random() < 0.5 ? "209,224,255" : "255,255,255";
			stars.push({
				x: Math.random() * width,
				y: Math.random() * height,
				size,
				tint,
				baseAlpha: early ? (size === 1 ? rand(0.25, 0.55) : rand(0.45, 0.8)) : rand(0.3, 0.95),
				appearAt: early ? 0 : Math.pow(Math.random(), 0.55) * 0.9,
				phase: rand(0, Math.PI * 2),
				speed: rand(0.6, 1.5),
				amplitude: rand(0.08, 0.2)
			});
		}
		return stars;
	}

	function resizeClosingTransitionCanvas() {
		const canvas = state.closingTransitionCanvasEl;
		const ctx = state.closingTransitionCtx;
		if (!canvas || !ctx) {
			return;
		}
		const width = window.innerWidth;
		const height = window.innerHeight;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		state.closingTransitionW = width;
		state.closingTransitionH = height;
		state.closingTransitionStars = buildClosingTransitionStars(width, height);
	}

	function drawClosingTransitionSky(time) {
		const ctx = state.closingTransitionCtx;
		const w = state.closingTransitionW;
		const h = state.closingTransitionH;
		if (!ctx || !w || !h) {
			state.closingTransitionRaf = requestAnimationFrame(drawClosingTransitionSky);
			return;
		}

		const p = state.closingTransitionProgress || 0;
		const mix = (c1, c2, t) => `rgb(${c1.map((v, i) => Math.round(lerp(v, c2[i], t))).join(",")})`;

		const grad = ctx.createLinearGradient(0, 0, 0, h);
		for (let i = 0; i < CT_SKY_TO.length; i++) {
			const stop = CT_SKY_TO[i][0];
			let fromColor = CT_SKY_FROM[0][1];
			for (let j = 0; j < CT_SKY_FROM.length - 1; j++) {
				if (stop >= CT_SKY_FROM[j][0] && stop <= CT_SKY_FROM[j + 1][0]) {
					const t = (stop - CT_SKY_FROM[j][0]) / (CT_SKY_FROM[j + 1][0] - CT_SKY_FROM[j][0]);
					fromColor = CT_SKY_FROM[j][1].map((v, k) => lerp(v, CT_SKY_FROM[j + 1][1][k], t));
					break;
				}
			}
			grad.addColorStop(stop, mix(fromColor, CT_SKY_TO[i][1], p));
		}
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		for (const star of state.closingTransitionStars || []) {
			const life = star.appearAt === 0 ? 1 : windowProgress(p, [star.appearAt, Math.min(1, star.appearAt + 0.22)]);
			if (life <= 0.01) {
				continue;
			}
			const twinkle = reduceMotion ? 0 : Math.sin(time * 0.001 * star.speed + star.phase) * star.amplitude;
			const alpha = clamp01((star.baseAlpha + twinkle) * life);
			if (alpha < 0.02) {
				continue;
			}
			ctx.fillStyle = `rgba(${star.tint},${alpha.toFixed(3)})`;
			ctx.fillRect(star.x, star.y, star.size, star.size);
			if (star.size >= 2) {
				ctx.fillStyle = `rgba(${star.tint},${(alpha * 0.14).toFixed(3)})`;
				ctx.fillRect(star.x - 1, star.y - 1, star.size + 2, star.size + 2);
			}
		}

		state.closingTransitionRaf = requestAnimationFrame(drawClosingTransitionSky);
	}

	function setupClosingTransitionScroll() {
		const section = document.getElementById("closing-transition");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawClosingTransitionText(1);
			return;
		}
		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawClosingTransitionText(self.progress),
			onRefresh: (self) => drawClosingTransitionText(self.progress)
		});
		drawClosingTransitionText(0);
	}

	function initClosingTransitionSection() {
		const section = document.getElementById("closing-transition");
		if (!section) {
			return;
		}
		state.closingTransitionCanvasEl = document.querySelector("#closing-transition .closing-transition__sky");
		state.closingTransitionFrameEl = document.querySelector("#closing-transition .closing-transition__frame");
		state.closingTransitionLine1El = document.querySelector("#closing-transition .closing-transition__line--1");
		state.closingTransitionLine2El = document.querySelector("#closing-transition .closing-transition__line--2");
		state.closingTransitionLine3El = document.querySelector("#closing-transition .closing-transition__line--3");
		state.closingTransitionLine4El = document.querySelector("#closing-transition .closing-transition__line--4");

		if (state.closingTransitionCanvasEl) {
			state.closingTransitionCtx = state.closingTransitionCanvasEl.getContext("2d");
			resizeClosingTransitionCanvas();
			window.addEventListener("resize", resizeClosingTransitionCanvas, { passive: true });
			if (!state.closingTransitionRaf) {
				state.closingTransitionRaf = requestAnimationFrame(drawClosingTransitionSky);
			}
		}

		setupClosingTransitionScroll();
	}

	// Scroll-scrubs closing-video-opt-v1.mp4 by mapping scroll progress to currentTime; desktop only.
	function setupAcknowledgementsVideoScrub() {
		const wrapperEl = document.querySelector(".acknowledgements-video");
		const video = document.querySelector(".acknowledgements-video__el");
		if (!wrapperEl || !video) {
			return;
		}

		// Paused videos render nothing in some browsers until seeked once metadata is ready.
		video.addEventListener("loadedmetadata", () => {
			video.currentTime = 0.01;
		});

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
			return;
		}

		ScrollTrigger.matchMedia({
			"(min-width: 901px)": () => {
				const scrubST = ScrollTrigger.create({
					trigger: wrapperEl,
					start: "top top",
					end: "bottom bottom",
					scrub: true,
					invalidateOnRefresh: true,
					onUpdate: (self) => {
						if (isFinite(video.duration)) {
							video.currentTime = self.progress * video.duration;
						}
					}
				});

				return () => {
					scrubST.kill();
				};
			}
		});
	}

	function setupScenarioLeadFades() {
		const stageEl = document.querySelector(".scenario-layout__lead-stage");
		const leadEls = Array.from(document.querySelectorAll(".scenario-layout__lead"));
		const selectorEl = document.querySelector(".scenario-selector");
		if (!stageEl || !leadEls.length) {
			return;
		}

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
			return;
		}

		const seg = (p, a, b, c, d) => {
			if (p <= a || p >= d) return 0;
			if (p < b) return (p - a) / (b - a);
			if (p <= c) return 1;
			return (d - p) / (d - c);
		};

		const applyLeadProgress = (progress) => {
			const n = leadEls.length;
			const slot = 1 / n;
			const fade = slot * 0.26;
			leadEls.forEach((el, i) => {
				const start = i * slot;
				const end = (i + 1) * slot;
				const opacity = i === n - 1
					? seg(progress, start, start + fade, 1, 1.05)
					: seg(progress, start, start + fade, end - fade, end);
				gsap.set(el, { autoAlpha: Math.max(0, Math.min(1, opacity)) });
			});
		};

		ScrollTrigger.matchMedia({
			"(min-width: 901px)": () => {
				stageEl.classList.add("is-pinned");
				if (selectorEl) {
					selectorEl.classList.add("is-held");
				}
				gsap.set(leadEls, { autoAlpha: 0 });

				const stageST = ScrollTrigger.create({
					trigger: stageEl,
					start: "top top",
					end: "bottom bottom",
					scrub: 0.55,
					invalidateOnRefresh: true,
					onRefresh: (self) => applyLeadProgress(self.progress),
					onUpdate: (self) => applyLeadProgress(self.progress)
				});

				applyLeadProgress(0);

				let selectorTween = null;
				if (selectorEl) {
					selectorTween = gsap.fromTo(
						selectorEl,
						{ autoAlpha: 0, y: 40 },
						{
							autoAlpha: 1,
							y: 0,
							ease: "none",
							scrollTrigger: {
								trigger: selectorEl,
								start: "top 79%",
								end: "top 54%",
								scrub: 0.55,
								invalidateOnRefresh: true
							}
						}
					);
				}

				return () => {
					stageST.kill();
					if (selectorTween) {
						selectorTween.scrollTrigger && selectorTween.scrollTrigger.kill();
						selectorTween.kill();
					}
					stageEl.classList.remove("is-pinned");
					if (selectorEl) {
						selectorEl.classList.remove("is-held");
					}
					gsap.set(leadEls, { clearProps: "opacity,visibility" });
					if (selectorEl) {
						gsap.set(selectorEl, { clearProps: "opacity,visibility,transform" });
					}
				};
			}
		});
	}

	function setupLeadFades() {
		const stageEl = document.querySelector(".portfolio-layout__lead-stage");
		const leadEls = Array.from(document.querySelectorAll(".portfolio-layout__lead"));
		const businessesEl = document.querySelector(".portfolio-businesses");
		if (!stageEl || !leadEls.length) return;

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
			// Fallback: leads flow normally, both visible; panel stays visible.
			return;
		}

		// Trapezoidal opacity for a lead's [in→hold→out] scroll window.
		const seg = (p, a, b, c, d) => {
			if (p <= a || p >= d) return 0;
			if (p < b) return (p - a) / (b - a);
			if (p <= c) return 1;
			return (d - p) / (d - c);
		};

		// Both leads live in one pinned cell and crossfade — no x/y movement.
		const applyLeadProgress = (progress) => {
			const n = leadEls.length;
			const slot = 1 / n;
			const fade = slot * 0.28;
			leadEls.forEach((el, i) => {
				const start = i * slot;
				const end = (i + 1) * slot;
				const opacity =
					i === n - 1
						? Math.min(1, Math.max(0, (progress - start) / fade)) // last: fade in, hold to end
						: seg(progress, start, start + fade, end - fade, end);
				gsap.set(el, { autoAlpha: Math.max(0, Math.min(1, opacity)) });
			});
		};

		ScrollTrigger.matchMedia({
			"(min-width: 901px)": () => {
				stageEl.classList.add("is-pinned");
				if (businessesEl) businessesEl.classList.add("is-held");
				gsap.set(leadEls, { autoAlpha: 0 });

				const stageST = ScrollTrigger.create({
					trigger: stageEl,
					start: "top top",
					end: "bottom bottom",
					scrub: 0.5,
					invalidateOnRefresh: true,
					onRefresh: (self) => applyLeadProgress(self.progress),
					onUpdate: (self) => applyLeadProgress(self.progress),
				});
				applyLeadProgress(0);

				// Company panel fades in once the lead text has passed. Opacity only.
				let businessTween = null;
				if (businessesEl) {
					businessTween = gsap.fromTo(
						businessesEl,
						{ autoAlpha: 0 },
						{
							autoAlpha: 1,
							ease: "none",
							scrollTrigger: {
								trigger: businessesEl,
								start: "top 77%",
								end: "top 55%",
								scrub: 0.5,
								invalidateOnRefresh: true,
							},
						}
					);
				}

				return () => {
					stageST.kill();
					if (businessTween) {
						businessTween.scrollTrigger && businessTween.scrollTrigger.kill();
						businessTween.kill();
					}
					stageEl.classList.remove("is-pinned");
					if (businessesEl) businessesEl.classList.remove("is-held");
					gsap.set(leadEls, { clearProps: "opacity,visibility" });
					if (businessesEl) gsap.set(businessesEl, { clearProps: "opacity,visibility" });
				};
			},
		});
	}

	// Clears every isolation class → the full chart is illuminated again.
	function clearPortfolioHighlight(linkSelection, nodeSelection) {
		linkSelection
			.classed("portfolio-is-highlight", false)
			.classed("portfolio-is-muted", false);
		nodeSelection
			.classed("portfolio-is-highlight", false)
			.classed("portfolio-is-muted", false);
	}

	// Fallback isolation: keep the node itself plus the ribbons directly touching
	// it. Used until node_details.json is loaded, or for a node whose full chain
	// has not been generated yet.
	function applyPortfolioDirectHighlight(nodeId, linkSelection, nodeSelection, graph) {
		const isConnected = (link) => link.source.id === nodeId || link.target.id === nodeId;
		const connectedNodeIds = new Set([nodeId]);
		graph.links.forEach((link) => {
			if (isConnected(link)) {
				connectedNodeIds.add(link.source.id);
				connectedNodeIds.add(link.target.id);
			}
		});

		linkSelection
			.classed("portfolio-is-highlight", isConnected)
			.classed("portfolio-is-muted", (link) => !isConnected(link));
		nodeSelection
			.classed("portfolio-is-highlight", (node) => connectedNodeIds.has(node.id))
			.classed("portfolio-is-muted", (node) => !connectedNodeIds.has(node.id));
	}

	// node_details.json holds each node's full layer-1→7 flow chain, shared by
	// the portfolio highlight and the main chart's click-to-isolate. It is large
	// once populated, so fetch it lazily on first use and cache the parsed
	// result (an empty object is cached on failure so we don't refetch).
	function ensureNodeDetails() {
		if (state.nodeDetails) {
			return Promise.resolve(state.nodeDetails);
		}
		if (!state.nodeDetailsPromise) {
			state.nodeDetailsPromise = fetch(nodeDetailsPath)
				.then((response) => {
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}`);
					}
					return response.json();
				})
				.then((data) => {
					state.nodeDetails = data || {};
					return state.nodeDetails;
				})
				.catch((err) => {
					console.warn(`[Sankey] Could not load ${nodeDetailsPath}:`, err);
					state.nodeDetails = {};
					return state.nodeDetails;
				});
		}
		return state.nodeDetailsPromise;
	}

	// Normalized full-chain links for the main chart's click-to-isolate:
	// endpoint ids aliased onto the rendered graph, restricted to the active
	// scenario, zero/null flows dropped, duplicate pairs merged. Returns null
	// when the node's chain has not been generated yet (README: empty links
	// array), which callers treat as "fall back to direct-neighbor isolation".
	// Cached per node id — chain data and node ids are static for a session.
	const chainLinkCache = new Map();
	const warnedChainIds = new Set();
	function chainLinksFor(nodeId, nodeById) {
		if (chainLinkCache.has(nodeId)) {
			return chainLinkCache.get(nodeId);
		}

		const rawLinks = state.nodeDetails?.[nodeId]?.links;
		if (!Array.isArray(rawLinks) || !rawLinks.length) {
			chainLinkCache.set(nodeId, null);
			return null;
		}

		const merged = new Map();
		rawLinks.forEach((raw) => {
			const value = toFiniteNumber(raw?.[defaultScenario]?.value, 0);
			if (value <= 0) {
				return;
			}
			const sourceId = normalizeNodeId(raw.source, nodeById);
			const targetId = normalizeNodeId(raw.target, nodeById);
			for (const id of [sourceId, targetId]) {
				if (!nodeById.has(id)) {
					if (!warnedChainIds.has(id)) {
						warnedChainIds.add(id);
						console.warn(
							`[Sankey] node_details chain references unknown node id "${id}"; link skipped.`
						);
					}
					return;
				}
			}
			const key = `${sourceId}|${targetId}`;
			const entry = merged.get(key);
			if (entry) {
				entry.value += value;
			} else {
				merged.set(key, { sourceId, targetId, value });
			}
		});

		const links = merged.size ? Array.from(merged.values()) : null;
		chainLinkCache.set(nodeId, links);
		return links;
	}

	function applyPortfolioBusinessHighlight(rawBusinessId) {
		if (!state.portfolioRendered) {
			return;
		}

		const businessId = normalizeBusinessSlug(rawBusinessId);
		const { nodeSelection, linkSelection, graph } = state.portfolioRendered;

		// No / unsupported selection → full illuminated chart.
		if (!businessId || !supportedPortfolioBusinesses.has(businessId)) {
			clearPortfolioHighlight(linkSelection, nodeSelection);
			return;
		}

		const nodeId = state.portfolioBusinessNodeMap.get(businessId);
		if (!nodeId) {
			clearPortfolioHighlight(linkSelection, nodeSelection);
			return;
		}

		// Full-chain isolation needs node_details.json. Until it has loaded, show
		// the direct-connected fallback, then re-run once the data is available
		// (only if this company is still the active selection).
		if (!state.nodeDetails) {
			applyPortfolioDirectHighlight(nodeId, linkSelection, nodeSelection, graph);
			ensureNodeDetails().then(() => {
				if (normalizeBusinessSlug(window.currentPortfolioBusinessId) === businessId) {
					applyPortfolioBusinessHighlight(businessId);
				}
			});
			return;
		}

		const chainLinks = Array.isArray(state.nodeDetails[nodeId]?.links)
			? state.nodeDetails[nodeId].links
			: [];

		// Node's chain not generated yet → direct-connected fallback.
		if (!chainLinks.length) {
			applyPortfolioDirectHighlight(nodeId, linkSelection, nodeSelection, graph);
			return;
		}

		const chainPairs = new Set(chainLinks.map((link) => `${link.source}|${link.target}`));
		const chainNodeIds = new Set([nodeId]);
		for (const link of chainLinks) {
			chainNodeIds.add(link.source);
			chainNodeIds.add(link.target);
		}
		const inChain = (link) => chainPairs.has(`${link.source.id}|${link.target.id}`);

		linkSelection
			.classed("portfolio-is-highlight", inChain)
			.classed("portfolio-is-muted", (link) => !inChain(link));
		nodeSelection
			.classed("portfolio-is-highlight", (node) => chainNodeIds.has(node.id))
			.classed("portfolio-is-muted", (node) => !chainNodeIds.has(node.id));
	}

	function buildGraph(initData, baselinesData, requestedScenario) {
		const initNodes = initData?.nodes?.nodes;
		const baselineLinks = baselinesData?.links;
		const scenarios = baselinesData?.scenarios;

		if (!Array.isArray(initNodes)) {
			throw new Error("Invalid init.json: expected nodes.nodes[] array");
		}
		if (!Array.isArray(baselineLinks)) {
			throw new Error("Invalid baselines.json: expected links[] array");
		}
		if (!Array.isArray(scenarios) || !scenarios.length) {
			throw new Error("Invalid baselines.json: expected scenarios[]");
		}

		const scenario = scenarios.includes(requestedScenario) ? requestedScenario : scenarios[0];
		if (scenario !== requestedScenario) {
			console.warn(
				`[Sankey] Scenario \"${requestedScenario}\" not found in baselines; using \"${scenario}\" instead.`
			);
		}

		const nodeById = new Map();
		let dedupeCount = 0;
		let dedupeReplacedCount = 0;
		for (const rawNode of initNodes) {
			const nodeId = String(rawNode?.id || "").trim();
			if (!nodeId) {
				continue;
			}

			const normalizedNode = {
				id: nodeId,
				label: deriveLabelFromId(nodeId),
				stage: Number.isFinite(rawNode?.layer) ? rawNode.layer : deriveStageFromId(nodeId),
				order: Number.isFinite(rawNode?.order) ? rawNode.order : Number.MAX_SAFE_INTEGER,
				group: Number.isFinite(rawNode?.group) ? rawNode.group : 0,
				description: String(rawNode?.description || "")
			};

			if (!nodeById.has(nodeId)) {
				nodeById.set(nodeId, normalizedNode);
				continue;
			}

			dedupeCount += 1;
			const existing = nodeById.get(nodeId);
			if (nodeQualityScore(normalizedNode) > nodeQualityScore(existing)) {
				nodeById.set(nodeId, normalizedNode);
				dedupeReplacedCount += 1;
			}
		}

		if (dedupeCount > 0) {
			console.warn(
				`[Sankey] Deduplicated ${dedupeCount} init node entries (${dedupeReplacedCount} replaced with higher-quality metadata).`
			);
		}

		const links = [];
		const linkedNodeIds = new Set();
		let remappedIds = 0;
		let droppedLinks = 0;
		let nullScenarioPayloads = 0;

		for (const link of baselineLinks) {
			const sourceId = normalizeNodeId(link?.source, nodeById);
			const targetId = normalizeNodeId(link?.target, nodeById);
			if (sourceId !== String(link?.source || "").trim()) {
				remappedIds += 1;
			}
			if (targetId !== String(link?.target || "").trim()) {
				remappedIds += 1;
			}

			if (!sourceId || !targetId || !nodeById.has(sourceId) || !nodeById.has(targetId)) {
				droppedLinks += 1;
				continue;
			}

			const scenarioValues = link?.[scenario];
			if (!scenarioValues || typeof scenarioValues !== "object") {
				nullScenarioPayloads += 1;
				continue;
			}

			const value = toFiniteNumber(scenarioValues.value, 0);
			if (value <= 0) {
				continue;
			}

			const energy = toFiniteNumber(scenarioValues.energy, 0);
			const process = toFiniteNumber(scenarioValues.process, 0);
			const afolu = toFiniteNumber(scenarioValues.afolu, 0);

			links.push({
				id: `link-${links.length}`,
				source: sourceId,
				target: targetId,
				value,
				energy,
				process,
				afolu
			});

			linkedNodeIds.add(sourceId);
			linkedNodeIds.add(targetId);
		}

		if (remappedIds > 0) {
			console.warn(`[Sankey] Normalized ${remappedIds} link endpoint IDs using alias mappings.`);
		}
		if (droppedLinks > 0) {
			console.warn(`[Sankey] Dropped ${droppedLinks} links with missing or unknown nodes.`);
		}
		if (nullScenarioPayloads > 0) {
			console.warn(`[Sankey] Skipped ${nullScenarioPayloads} links with null or missing ${scenario} payloads.`);
		}

		const nodes = Array.from(linkedNodeIds)
			.map((id) => nodeById.get(id))
			.filter(Boolean)
			.sort((a, b) => {
			if (a.stage !== b.stage) {
				return a.stage - b.stage;
			}
			if (a.order !== b.order) {
				return a.order - b.order;
			}
			return a.label.localeCompare(b.label);
		});

		return { nodes, links, scenario };
	}

	function render() {
		if (state.rendered?.layoutScrollTrigger) {
			state.rendered.layoutScrollTrigger.kill();
		}

		const bounds = chart.getBoundingClientRect();
		const width = Math.max(920, Math.floor(bounds.width));
		const height = Math.max(560, Math.floor(bounds.height));

		d3.select(chart).selectAll("*").remove();

		const svg = d3
			.select(chart)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet");

		const graph = {
			nodes: state.nodes.map((node) => ({ ...node })),
			links: state.links.map((link) => ({ ...link }))
		};

		// Extra top headroom so the horizontal stage headers fit inside the viewBox.
		const sankeyExtentTop = 70;
		const sankeyExtentBottom = height - 34;
		const sankeyExtentLeft = 28;
		const sankeyExtentRight = width - 28;

		const computeLayout = (nodePadding) => {
			const layoutGraph = {
				nodes: graph.nodes.map((node) => ({ ...node })),
				links: graph.links.map((link) => ({ ...link }))
			};

			d3
				.sankey()
				.nodeId((d) => d.id)
				.nodeWidth(20)
				.nodePadding(nodePadding)
				.nodeAlign(d3.sankeyJustify)
				.extent([
					[sankeyExtentLeft, sankeyExtentTop],
					[sankeyExtentRight, sankeyExtentBottom]
				])
				.iterations(64)(layoutGraph);

			// Spread each stage's nodes to fill the full vertical extent so every
			// column aligns top *and* bottom (shared helper).
			spreadStageHeights(layoutGraph, sankeyExtentTop, sankeyExtentBottom);

			return layoutGraph;
		};

		const derivePackedLayout = (expandedLayout) => {
			const expandedNodeById = new Map(expandedLayout.nodes.map((node) => [node.id, node]));
			const expandedLinkById = new Map(expandedLayout.links.map((link) => [link.id, link]));

			const packedNodes = expandedLayout.nodes.map((node) => ({ ...node }));
			const packedNodeById = new Map(packedNodes.map((node) => [node.id, node]));

			const nodesByStage = d3.group(packedNodes, (node) => node.stage);
			nodesByStage.forEach((stageNodes) => {
				const ordered = stageNodes
					.slice()
					.sort((a, b) => {
						const expandedA = expandedNodeById.get(a.id);
						const expandedB = expandedNodeById.get(b.id);
						return (expandedA?.y0 || 0) - (expandedB?.y0 || 0);
					});

				let cursor = sankeyExtentTop;
				ordered.forEach((node) => {
					const expandedNode = expandedNodeById.get(node.id);
					const nodeHeight = Math.max(3, (expandedNode?.y1 || 0) - (expandedNode?.y0 || 0));
					node.y0 = cursor;
					node.y1 = cursor + nodeHeight;
					cursor = node.y1;
				});
			});

			const packedLinks = expandedLayout.links.map((link) => ({
				...link,
				source: packedNodeById.get(link.source.id),
				target: packedNodeById.get(link.target.id)
			}));

			const sourceLinksByNode = d3.group(packedLinks, (link) => link.source.id);
			const targetLinksByNode = d3.group(packedLinks, (link) => link.target.id);

			packedNodes.forEach((node) => {
				const sourceLinks = (sourceLinksByNode.get(node.id) || [])
					.slice()
					.sort((a, b) => (expandedLinkById.get(a.id)?.y0 || 0) - (expandedLinkById.get(b.id)?.y0 || 0));
				let sourceCursor = node.y0;
				sourceLinks.forEach((link) => {
					link.y0 = sourceCursor + link.width / 2;
					sourceCursor += link.width;
				});

				const targetLinks = (targetLinksByNode.get(node.id) || [])
					.slice()
					.sort((a, b) => (expandedLinkById.get(a.id)?.y1 || 0) - (expandedLinkById.get(b.id)?.y1 || 0));
				let targetCursor = node.y0;
				targetLinks.forEach((link) => {
					link.y1 = targetCursor + link.width / 2;
					targetCursor += link.width;
				});
			});

			return {
				nodes: packedNodes,
				links: packedLinks
			};
		};

		// Detail ("zoom") layout for the cars-example scene: stages 1-3 re-spaced
		// across the full chart width (same vertical geometry, so no distortion);
		// stages 4-7 pushed off the right edge.
		const computeDetailLayout = (expandedLayout) => {
			const nodeW = 20;
			const labelRoom = Math.min(320, width * 0.26);
			const detailRight = sankeyExtentRight - labelRoom;
			const x0ByStage = {
				1: sankeyExtentLeft,
				2: (sankeyExtentLeft + detailRight) / 2 - nodeW / 2,
				3: detailRight
			};

			const nodes = expandedLayout.nodes.map((node) => {
				const x0 = x0ByStage[node.stage] ?? width + 120 + (node.stage - 4) * 180;
				return { ...node, x0, x1: x0 + nodeW };
			});
			const nodeById = new Map(nodes.map((node) => [node.id, node]));
			const links = expandedLayout.links.map((link) => ({
				...link,
				source: nodeById.get(link.source.id),
				target: nodeById.get(link.target.id)
			}));

			return { nodes, links };
		};

		const expandedGraph = computeLayout(9);
		spreadNodesForLabels(chart, expandedGraph, sankeyExtentTop, sankeyExtentBottom);
		const collapsedGraph = derivePackedLayout(expandedGraph);
		const detailGraph = computeDetailLayout(expandedGraph);

		const nodePackedMap = new Map(collapsedGraph.nodes.map((node) => [node.id, node]));
		const nodeExpandedMap = new Map(expandedGraph.nodes.map((node) => [node.id, node]));
		const nodeDetailMap = new Map(detailGraph.nodes.map((node) => [node.id, node]));
		const linkPackedMap = new Map(collapsedGraph.links.map((link) => [link.id, link]));
		const linkExpandedMap = new Map(expandedGraph.links.map((link) => [link.id, link]));
		const linkDetailMap = new Map(detailGraph.links.map((link) => [link.id, link]));

		// Packed column footprints per stage, used by the intro bar morph and the
		// collapse/unstack choreography.
		const packedColumnByStage = new Map(
			Array.from(d3.group(collapsedGraph.nodes, (node) => node.stage), ([stage, nodes]) => [
				stage,
				{
					x0: d3.min(nodes, (node) => node.x0),
					x1: d3.max(nodes, (node) => node.x1),
					y0: d3.min(nodes, (node) => node.y0),
					y1: d3.max(nodes, (node) => node.y1)
				}
			])
		);

		const defs = svg.append("defs");
		const stageBounds = stageXBounds(expandedGraph);
		const stagePairs = Array.from(
			new Set(
				expandedGraph.links
					.map((link) => `${link.source?.stage ?? "unknown"}-${link.target?.stage ?? "unknown"}`)
			)
		);

		stagePairs.forEach((pair) => {
			const [sourceStageRaw, targetStageRaw] = pair.split("-");
			const sourceStage = Number.parseInt(sourceStageRaw, 10);
			const targetStage = Number.parseInt(targetStageRaw, 10);
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];

			if (!sourceColorVar || !targetColorVar) {
				return;
			}

			const sourceX = stageBounds.get(sourceStage)?.x1 ?? 0;
			const targetX = stageBounds.get(targetStage)?.x0 ?? width;
			const gradient = defs
				.append("linearGradient")
				.attr("id", linkGradientId(sourceStage, targetStage))
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", sourceX)
				.attr("y1", 0)
				.attr("x2", targetX)
				.attr("y2", 0);

			gradient.append("stop").attr("offset", "0%").style("stop-color", `var(${sourceColorVar})`).attr("stop-opacity", 0.3);
			gradient.append("stop").attr("offset", "100%").style("stop-color", `var(${targetColorVar})`).attr("stop-opacity", 0.3);
		});

		const linksGroup = svg
			.append("g")
			.attr("fill", "none")
			.attr("stroke-opacity", 1)
			.attr("class", "sankey-links");

		const linkClassNames = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : "unknown";
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : "unknown";
			const fromId = classSlug(link.source?.id);
			const toId = classSlug(link.target?.id);

			return [
				"sankey-link",
				`stage-${sourceStage}-${targetStage}`,
				`link-stage-${sourceStage}-${targetStage}`,
				`link-from-${fromId}`,
				`link-to-${toId}`,
				`link-${fromId}-to-${toId}`
			].join(" ");
		};

		const linkStroke = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;

			if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
				return `url(#${linkGradientId(sourceStage, targetStage)})`;
			}

			return "rgba(208, 222, 235, 0.38)";
		};

		const linkPaths = linksGroup
			.selectAll("path")
			.data(expandedGraph.links, (d) => d.id)
			.join("path")
			.attr("class", linkClassNames)
			.style("stroke", linkStroke)
			.attr("stroke-width", 1)
			;

		linkPaths
			.append("title")
			.text((d) => {
				const source = d.source.label;
				const target = d.target.label;
				return `${source} -> ${target}\n${fmtMt(d.value)} Mt CO2e\nEnergy ${fmtMt(d.energy)} | Process ${fmtMt(d.process)} | AFOLU ${fmtMt(d.afolu)}`;
			});

		// Full-chain isolation overlay, populated by applySelection(): the
		// selected node's chain drawn as its own ribbons at attributed widths.
		// Sits above the baseline ribbons, below the nodes.
		const chainGroup = svg.append("g").attr("class", "sankey-chain");

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");

		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(expandedGraph.nodes, (d) => d.id)
			.join("g")
			.attr("class", (d) => `sankey-node stage-${d.stage}`)
			.attr("transform", "translate(0,0)")
			.style("cursor", "pointer")
			.on("click", function (event, d) {
				if (!state.sankeyInteractive) {
					return;
				}

				event.stopPropagation();
				state.selectedNodeId = state.selectedNodeId === d.id ? null : d.id;
				applySelection();
			});

		nodeSelection
			.append("rect")
			.attr("height", 1)
			.attr("width", 20);

		nodeSelection
			.append("title")
			.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));

		nodeSelection
			.append("text")
			.attr("x", 0)
			.attr("y", 0)
			.attr("dy", "0.35em")
			.attr("text-anchor", "start")
			.text((d) => d.label);

		wrapNodeLabels(
			nodeSelection.selectAll("text"),
			Math.max(78, (width - 76) / 6 - 32)
		);

		svg.on("click", () => {
			if (!state.sankeyInteractive) {
				return;
			}

			if (!state.selectedNodeId) {
				return;
			}
			state.selectedNodeId = null;
			applySelection();
		});

		// --- Intro title cards (photo cover -> designed color bar + wordmark) ---
		// 7 cards evenly spaced and centered as a group; each card is a narrow
		// full-height photo strip covering the inlined .svg title-card art.
		const introGroup = svg.append("g").attr("class", "sankey-intro");
		const introCards = [];
		{
			const extentH = sankeyExtentBottom - sankeyExtentTop;
			const extentW = sankeyExtentRight - sankeyExtentLeft;
			const groupWidth = extentW * 0.52;
			const groupLeft = sankeyExtentLeft + (extentW - groupWidth) / 2;
			const slotGap = groupWidth / 6;
			const cardTop = sankeyExtentTop;

			// Bars sit as a short stub at the bottom of each card (per the mock-up)
			// rather than spanning the full card height. Each card uses its own
			// asset's bar-subpath height, scaled to extentH -- this is exactly the
			// gap the design baked in below that word, so shorter words (SECTOR,
			// FUEL, ...) get taller bars that reach higher, matching the mock-up.
			const naturalBarHeightByStage = Array.from({ length: 7 }, (_, i) => {
				const asset = state.introAssets?.get(i + 1) || null;
				if (!asset) {
					return null;
				}
				const assetScale = extentH / asset.viewBox.height;
				return asset.bar.height * assetScale;
			});

			for (let stage = 1; stage <= 7; stage += 1) {
				const meta = STAGE_META[stage];
				const asset = state.introAssets?.get(stage) || null;
				const cx = groupLeft + (stage - 1) * slotGap;
				const scale = extentH / (asset ? asset.viewBox.height : 412);
				const barW = (asset ? asset.bar.width : 20) * scale;

				const card = introGroup.append("g").attr("class", `intro-card intro-card-stage-${stage}`);

				// Short bottom-anchored stub, matching the mock-up; the wordmark reads
				// upward above it. barRect is appended before mark so the mark paints
				// on top and stays legible instead of being occluded by the bar. Width
				// is a fixed 27px per card, independent of the photo/mark's own barW.
				const barH = naturalBarHeightByStage[stage - 1] ?? extentH * 0.3;
				const barScreen = {
					x: cx - 27 / 2,
					y: cardTop + extentH - barH,
					w: 27,
					h: barH
				};
				const barRect = card
					.append("rect")
					.attr("class", "intro-card-bar")
					.attr("fill", `var(${stageColorVars[stage]})`)
					.attr("x", barScreen.x)
					.attr("y", barScreen.y)
					.attr("width", barScreen.w)
					.attr("height", barScreen.h)
					.style("opacity", 0);

				let mark = null;
				if (asset && asset.markPaths.length) {
					mark = card
						.append("g")
						.attr("class", "intro-card-mark")
						.attr("fill", `var(${stageColorVars[stage]})`)
						.attr(
							"transform",
							`translate(${cx - (asset.bar.x + asset.bar.width / 2) * scale}, ${cardTop}) scale(${scale})`
						)
						.style("opacity", 0);
					asset.markPaths.forEach((d) => mark.append("path").attr("d", d));
				}

				const photoGeom = { x: cx - barW / 2, y: cardTop, w: barW, h: extentH };
				const clipId = `intro-photo-clip-${stage}`;
				const clipRect = defs
					.append("clipPath")
					.attr("id", clipId)
					.append("rect")
					.attr("x", photoGeom.x)
					.attr("y", photoGeom.y)
					.attr("width", photoGeom.w)
					.attr("height", 0);

				const photoWrap = card.append("g").attr("clip-path", `url(#${clipId})`);
				const photo = photoWrap
					.append("image")
					.attr("href", `${meta.slug}.webp`)
					.attr("x", photoGeom.x)
					.attr("y", photoGeom.y)
					.attr("width", photoGeom.w)
					.attr("height", photoGeom.h)
					.attr("preserveAspectRatio", "xMidYMid slice");

				introCards.push({ stage, group: card, slotCx: cx, mark, barRect, photo, clipRect, photoGeom, barScreen });
			}
		}

		// Horizontal stage headers over the chart columns (visible from the
		// packed state onward, per the mock-up).
		const columnCenter = (nodes) => {
			const x0 = d3.min(nodes, (node) => node.x0);
			const x1 = d3.max(nodes, (node) => node.x1);
			return (x0 + x1) / 2;
		};
		const expandedColumns = Array.from(d3.group(expandedGraph.nodes, (node) => node.stage).entries())
			.filter(([stage]) => STAGE_META[stage])
			.map(([stage, nodes]) => ({ stage, cx: columnCenter(nodes) }));

		const headerGroup = svg.append("g").attr("class", "sankey-stage-headers").style("opacity", 0);
		const headerY = sankeyExtentTop - 26;
		expandedColumns.forEach((col) => {
			headerGroup
				.append("text")
				.attr("class", "stage-header")
				.attr("x", Math.max(col.cx, 58))
				.attr("y", headerY)
				.attr("text-anchor", "middle")
				.attr("fill", `var(${stageColorVars[col.stage]})`)
				.text(STAGE_META[col.stage].label);
		});

		// Scene 9 ("...sum to global emissions"): a "54 Gt" reference caliper
		// 180px right of the isolated stage-1 column's visible edge -- a
		// vertical line spanning the full node-column height, capped top and
		// bottom by short ticks, with the total labeled alongside.
		const stage1Nodes = expandedGraph.nodes.filter((node) => node.stage === 1);
		const stage1Right = stage1Nodes.length
			? d3.max(stage1Nodes, (node) => node.x1)
			: sankeyExtentLeft + 20;
		const lensAxisX = stage1Right + 180;

		const lensAxisGroup = svg.append("g").attr("class", "lens-focus-axis").style("opacity", 0);
		lensAxisGroup
			.append("line")
			.attr("class", "lens-focus-axis__line")
			.attr("x1", lensAxisX)
			.attr("x2", lensAxisX)
			.attr("y1", sankeyExtentTop)
			.attr("y2", sankeyExtentBottom);
		[sankeyExtentTop, sankeyExtentBottom].forEach((y) => {
			lensAxisGroup
				.append("line")
				.attr("class", "lens-focus-axis__tick")
				.attr("x1", lensAxisX - 20)
				.attr("x2", lensAxisX)
				.attr("y1", y)
				.attr("y2", y);
		});
		lensAxisGroup
			.append("text")
			.attr("class", "lens-focus-axis__label")
			.attr("x", lensAxisX + 12)
			.attr("y", (sankeyExtentTop + sankeyExtentBottom) / 2)
			.attr("dy", "0.35em")
			.attr("text-anchor", "start")
			.text("54 Gt");

		const setSankeyInteraction = (enabled) => {
			if (state.sankeyInteractive === enabled) {
				return;
			}

			state.sankeyInteractive = enabled;
			chart.style.pointerEvents = enabled ? "auto" : "none";
			chart.classList.toggle("is-interactive", enabled);

			chartIsInteractive = enabled;
			if (narrativeSection) {
				narrativeSection.classList.toggle("chart-interactive", enabled);
			}
			updateViewportFrame();

			if (enabled) {
				// Prefetch the chain data so the first node click can usually
				// isolate the full chain immediately (still lazy: not on page load).
				ensureNodeDetails();
			}

			if (!enabled && state.selectedNodeId) {
				state.selectedNodeId = null;
				applySelection();
			}

			if (!state.selectedNodeId) {
				statusEl.textContent = enabled
					? "Click a node to isolate direct flows"
					: "Scroll to expand Sankey";
			}
		};

		// --- Layout interpolation ---------------------------------------------
		// Lerps every node rect + link ribbon between two precomputed layouts.
		// Opacity is not handled here; drawMaster owns all opacities.
		let lastLayoutSig = null;
		const applyLayout = (progressValue, nodeStartMap, nodeEndMap, linkStartMap, linkEndMap, opts = {}) => {
			const t = clamp01(progressValue);
			const sig = `${opts.key || "layout"}:${t.toFixed(4)}:${opts.forceStartAnchor ? 1 : 0}`;
			if (sig === lastLayoutSig) {
				return;
			}
			lastLayoutSig = sig;

			nodeSelection.each(function (nodeDatum) {
				const startNode = nodeStartMap.get(nodeDatum.id);
				const endNode = nodeEndMap.get(nodeDatum.id);
				if (!startNode || !endNode) {
					return;
				}

				const x0 = lerp(startNode.x0, endNode.x0, t);
				const x1 = lerp(startNode.x1, endNode.x1, t);
				const y0 = lerp(startNode.y0, endNode.y0, t);
				const y1 = lerp(startNode.y1, endNode.y1, t);
				const nodeWidth = Math.max(1, x1 - x0);
				const nodeHeight = Math.max(3, y1 - y0);
				const anchorStart = opts.forceStartAnchor || nodeDatum.stage !== 7;

				const nodeGroup = d3.select(this);
				nodeGroup.attr("transform", `translate(${x0},${y0})`);
				nodeGroup.select("rect").attr("width", nodeWidth).attr("height", nodeHeight);
				const labelX = anchorStart ? nodeWidth + 7 : -7;
				const textSel = nodeGroup.select("text");
				textSel
					.attr("x", labelX)
					.attr("y", nodeHeight / 2)
					.attr("text-anchor", anchorStart ? "start" : "end");
				textSel.selectAll("tspan").attr("x", labelX);
			});

			linkPaths.each(function (linkDatum) {
				const startLink = linkStartMap.get(linkDatum.id);
				const endLink = linkEndMap.get(linkDatum.id);
				if (!startLink || !endLink) {
					return;
				}

				const startSource = nodeStartMap.get(startLink.source.id);
				const endSource = nodeEndMap.get(endLink.source.id);
				const startTarget = nodeStartMap.get(startLink.target.id);
				const endTarget = nodeEndMap.get(endLink.target.id);
				if (!startSource || !endSource || !startTarget || !endTarget) {
					return;
				}

				const pathDatum = {
					source: {
						x0: lerp(startSource.x0, endSource.x0, t),
						x1: lerp(startSource.x1, endSource.x1, t),
						y0: lerp(startSource.y0, endSource.y0, t),
						y1: lerp(startSource.y1, endSource.y1, t)
					},
					target: {
						x0: lerp(startTarget.x0, endTarget.x0, t),
						x1: lerp(startTarget.x1, endTarget.x1, t),
						y0: lerp(startTarget.y0, endTarget.y0, t),
						y1: lerp(startTarget.y1, endTarget.y1, t)
					},
					y0: lerp(startLink.y0, endLink.y0, t),
					y1: lerp(startLink.y1, endLink.y1, t)
				};

				d3.select(this)
					.attr("d", d3.sankeyLinkHorizontal()(pathDatum))
					.attr("stroke-width", Math.max(1, lerp(startLink.width, endLink.width, t)));
			});
		};

		// --- Master scroll choreography -----------------------------------------
		const LINK_PEAK_OPACITY = 0.6;
		const FAINT_LINK_OPACITY = 0.16;
		const CHAIN_LINK_OPACITY = 0.9;
		const DIM_DETAIL_LINK_OPACITY = 0.04;
		const INTERACTION_START = 0.985;

		// Per-card wipe stagger offsets ("slightly varied rates" per the mock-up).
		const WIPE_JITTER = [0.06, 0.34, 0.16, 0, 0.28, 0.1, 0.42];
		const WIPE_SPAN = 0.5;

		// Scene 7: right-to-left column peel. Stage 7 (Emissions) is the anchor and
		// swaps to the real Sankey immediately; stages 6..1 travel in staggered
		// sub-windows.
		const UNSTACK_TRAVEL = 0.45;
		const unstackStart = (stage) => ((6 - stage) / 6) * 0.55;
		const unstackSettle = (stage, t) => {
			if (stage === 7) {
				return clamp01(t / 0.12);
			}
			return smoothstep(clamp01((t - unstackStart(stage)) / UNSTACK_TRAVEL));
		};
		// Intro bar -> real column swap happens only AFTER a column has arrived at
		// its packed slot, so the two never show at mismatched positions. The
		// Emissions bar stays opaque until the peel is nearly done so the merged
		// stack reads blue while columns slide out from behind it (its real
		// column, identical in geometry and colour, sits beneath).
		const columnSwap = (stage, t) => {
			if (stage === 7) {
				return clamp01((t - 0.75) / 0.2);
			}
			return clamp01((t - (unstackStart(stage) + UNSTACK_TRAVEL)) / 0.04);
		};

		// Ribbon reveal per stage: a gap's links appear once the columns on both
		// sides have arrived at their packed positions.
		const ribbonFactor = (stage, t) => {
			if (stage === 7) {
				return 1;
			}
			return clamp01((t - (unstackStart(stage) + UNSTACK_TRAVEL)) / 0.08);
		};

		// Cars-example highlight: all links touching the Passenger transport node
		// within the visible stage range.
		const carsHighlightNode = expandedGraph.nodes.find(
			(node) => node.stage === 2 && /passenger/i.test(node.label)
		);
		const carsHighlightNodeId = carsHighlightNode ? carsHighlightNode.id : null;
		const isChainLink = (link) =>
			Boolean(carsHighlightNodeId) &&
			(link.source.id === carsHighlightNodeId || link.target.id === carsHighlightNodeId) &&
			link.target.stage <= 3;
		const carsLinkOpacity = (link, reveal) => {
			if (isChainLink(link)) {
				return CHAIN_LINK_OPACITY * reveal;
			}
			if (link.source.stage <= 3 && link.target.stage <= 3) {
				return DIM_DETAIL_LINK_OPACITY * reveal;
			}
			return 0;
		};

		const drawMaster = (progress) => {
			// Remap section progress onto the animation span; the HOLD_TAIL at the
			// end clamps to the finished state.
			const p = clamp01(clamp01(progress) / ANIM_SPAN);
			const B = SCENE_BOUNDS;
			const tFan = sceneT(p, "fan-out");
			const tReveal = sceneT(p, "wipe-reveal");
			const tCollapse = sceneT(p, "collapse");
			const tUnstack = sceneT(p, "unstack");
			const tExpand = sceneT(p, "expand");
			const tFocus = sceneT(p, "lens-focus");
			const tCars = sceneT(p, "cars-example");
			const tExplore = sceneT(p, "explore");

			// ---------------- intro overlay ----------------
			const introDone = p >= B.unstack.end;
			introGroup.style("display", introDone ? "none" : null);
			if (!introDone) {
				const artReady = tReveal > 0 ? 1 : 0;
				const emissionsSlotCx = introCards.find((card) => card.stage === 7)?.slotCx ?? 0;

				introCards.forEach((card) => {
					const { stage, photoGeom, barScreen } = card;

					// Scene 1: the emissions strip grows in alone. Scene 2: the other
					// six strips fan out leftward from behind it — full height, all
					// travelling together so the spread reads as a fan opening.
					let grow;
					if (stage === 7) {
						grow = smoothstep(sceneT(p, "one-bar"));
						card.group.attr("transform", null);
					} else {
						grow = smoothstep(clamp01(tFan / 0.12));
						const move = smoothstep(tFan);
						const dx = (emissionsSlotCx - card.slotCx) * (1 - move);
						card.group.attr("transform", dx > 0.5 ? `translate(${dx}, 0)` : null);
					}

					// Scene 5: photo swipes upward out of a fixed clip window.
					const wipeStart = WIPE_JITTER[stage - 1] * (1 - WIPE_SPAN);
					const wipe = smoothstep(clamp01((tReveal - wipeStart) / WIPE_SPAN));

					const visibleH = photoGeom.h * grow;
					card.clipRect
						.attr("y", photoGeom.y + (photoGeom.h - visibleH))
						.attr("height", Math.max(0, visibleH));
					card.photo.attr("transform", `translate(0, ${-wipe * (photoGeom.h + 4)})`);

					if (card.mark) {
						const markFade = 1 - smoothstep(clamp01(tCollapse / 0.35));
						card.mark.style("opacity", artReady * markFade);
					}

					// Bar geometry: title card -> stripe row -> merged single bar ->
					// packed Sankey column.
					let bx = barScreen.x;
					let by = barScreen.y;
					let bw = barScreen.w;
					let bh = barScreen.h;
					const packedCol = packedColumnByStage.get(stage);
					if (packedCol) {
						const stripeW = Math.max(1, packedCol.x1 - packedCol.x0);
						const emissionsCol = packedColumnByStage.get(7) || packedCol;
						const stripeX = emissionsCol.x0 - (7 - stage) * stripeW;
						const slide = smoothstep(clamp01((tCollapse - 0.12) / 0.55));
						const merge = smoothstep(clamp01((tCollapse - 0.7) / 0.3));
						const settle = unstackSettle(stage, tUnstack);

						let x = lerp(bx, stripeX, slide);
						x = lerp(x, emissionsCol.x0, merge);
						x = lerp(x, packedCol.x0, settle);
						bx = x;
						by = lerp(by, packedCol.y0, slide);
						bw = lerp(bw, stripeW, slide);
						bh = lerp(bh, packedCol.y1 - packedCol.y0, slide);
					}
					card.barRect
						.attr("x", bx)
						.attr("y", by)
						.attr("width", Math.max(1, bw))
						.attr("height", Math.max(1, bh))
						.style("opacity", artReady * (1 - columnSwap(stage, tUnstack)));
				});
			}

			// ---------------- real Sankey ----------------
			const stageNodeOpacity = [0, 0, 0, 0, 0, 0, 0, 0];
			const stageLabelOpacity = [0, 0, 0, 0, 0, 0, 0, 0];
			let layoutPair = "packed-expanded";
			let layoutT = 0;
			let forceStartAnchor = false;
			let linkOpacityFn = () => 0;
			let headerOpacity = 0;
			let axisOpacity = 0;
			let interactiveNow = false;

			if (p < B.unstack.start) {
				// Intro scenes: real chart fully hidden, held at packed geometry.
			} else if (p < B.expand.start) {
				// Scene 7: unstack + per-gap ribbon reveal.
				for (let s = 1; s <= 6; s += 1) {
					stageNodeOpacity[s] = columnSwap(s, tUnstack);
				}
				// Real Emissions column shows early, hidden beneath its intro bar.
				stageNodeOpacity[7] = clamp01(tUnstack / 0.05);
				linkOpacityFn = (link) =>
					LINK_PEAK_OPACITY *
					ribbonFactor(link.source.stage, tUnstack) *
					ribbonFactor(link.target.stage, tUnstack);
				headerOpacity = clamp01((tUnstack - 0.55) / 0.4);
			} else if (p < B["lens-focus"].start) {
				// Scene 8: vertical expand; Final Service labels at the tail.
				layoutT = smoothstep(clamp01(tExpand / 0.85));
				for (let s = 1; s <= 7; s += 1) {
					stageNodeOpacity[s] = 1;
				}
				stageLabelOpacity[1] = clamp01((tExpand - 0.86) / 0.14);
				linkOpacityFn = () => LINK_PEAK_OPACITY;
				headerOpacity = 1;
			} else if (p < B["cars-example"].start) {
				// Scene 9: everything but the Final Service lens fades away.
				layoutT = 1;
				const focus = smoothstep(clamp01(tFocus / 0.4));
				stageNodeOpacity[1] = 1;
				stageLabelOpacity[1] = 1;
				for (let s = 2; s <= 7; s += 1) {
					stageNodeOpacity[s] = 1 - focus;
				}
				linkOpacityFn = () => LINK_PEAK_OPACITY * (1 - focus);
				headerOpacity = 1 - focus;
				axisOpacity = focus;
			} else if (p < B.explore.start) {
				// Scene 10: zoom to stages 1-3, highlight the Passenger transport chain.
				const zoom = smoothstep(clamp01(tCars / 0.3));
				layoutPair = "expanded-detail";
				layoutT = zoom;
				forceStartAnchor = true;
				stageNodeOpacity[1] = 1;
				stageNodeOpacity[2] = zoom;
				stageNodeOpacity[3] = zoom;
				stageLabelOpacity[1] = 1;
				stageLabelOpacity[2] = zoom;
				stageLabelOpacity[3] = zoom;
				linkOpacityFn = (link) => carsLinkOpacity(link, zoom);
				headerOpacity = 0;
			} else {
				// Scene 11: zoom back out to the full interactive chart.
				const unzoom = smoothstep(clamp01(tExplore / 0.4));
				layoutPair = "expanded-detail";
				layoutT = 1 - unzoom;
				forceStartAnchor = layoutT > 0.001;
				const lateLabels = clamp01((tExplore - 0.45) / 0.3);
				for (let s = 1; s <= 7; s += 1) {
					stageNodeOpacity[s] = s <= 3 ? 1 : unzoom;
					stageLabelOpacity[s] = s <= 3 ? 1 : lateLabels;
				}
				linkOpacityFn = (link) => lerp(carsLinkOpacity(link, 1), FAINT_LINK_OPACITY, unzoom);
				headerOpacity = unzoom;
				interactiveNow = p >= INTERACTION_START;
			}

			if (layoutPair === "packed-expanded") {
				applyLayout(layoutT, nodePackedMap, nodeExpandedMap, linkPackedMap, linkExpandedMap, {
					key: "packed-expanded"
				});
			} else {
				applyLayout(layoutT, nodeExpandedMap, nodeDetailMap, linkExpandedMap, linkDetailMap, {
					key: "expanded-detail",
					forceStartAnchor
				});
			}

			if (interactiveNow) {
				// Hand opacity control to CSS so the click-to-isolate classes work.
				nodeSelection.style("opacity", null);
				nodeSelection.select("text").style("opacity", null);
				linkPaths.style("opacity", null);
			} else {
				nodeSelection.style("opacity", (d) => stageNodeOpacity[d.stage] ?? 0);
				nodeSelection.select("text").style("opacity", (d) => stageLabelOpacity[d.stage] ?? 0);
				linkPaths.style("opacity", linkOpacityFn);
			}

			headerGroup.style("opacity", headerOpacity);
			lensAxisGroup.style("opacity", axisOpacity);
			setSankeyInteraction(interactiveNow);
		};

		let layoutScrollTrigger = null;
		if (DEV_SCRUB !== null) {
			devState.chartHook = drawMaster;
			devApply();
		} else if (prefersReducedMotion || !window.gsap || !window.ScrollTrigger) {
			drawMaster(1);
		} else {
			drawMaster(0);

			ScrollTrigger.matchMedia({
				"(max-width: 900px)": () => {
					drawMaster(1);
				},
				"(min-width: 901px)": () => {
					drawMaster(0);

					const motionState = { progress: 0 };
					const tween = gsap.fromTo(
						motionState,
						{ progress: 0 },
						{
							progress: 1,
							// Linear: the copy beats fade on raw scroll position, so any
							// ease here desynchronizes graphics from copy. Scenes apply
							// their own smoothstep internally.
							ease: "none",
							onUpdate: () => drawMaster(motionState.progress),
							scrollTrigger: {
								trigger: "#sankey-narrative",
								start: "top top",
								end: "bottom bottom",
								scrub: 0.8,
								invalidateOnRefresh: true
							}
						}
					);

					layoutScrollTrigger = tween.scrollTrigger || null;

					return () => {
						tween.kill();
						if (layoutScrollTrigger) {
							layoutScrollTrigger.kill();
							layoutScrollTrigger = null;
						}
					};
				}
			});
		}

		state.rendered = {
			nodeSelection,
			linkSelection: linkPaths,
			graph: expandedGraph,
			chainGroup,
			layoutScrollTrigger
		};

		applySelection();

		if (DEV_SELECT && !state.selectedNodeId) {
			ensureNodeDetails().then(() => {
				if (!state.selectedNodeId) {
					state.selectedNodeId = DEV_SELECT;
					applySelection();
				}
			});
		}
	}

	function applySelection() {
		if (!state.rendered) {
			return;
		}

		const { nodeSelection, linkSelection, graph, chainGroup } = state.rendered;

		chainGroup.selectAll("*").remove();

		if (!state.selectedNodeId) {
			linkSelection.classed("is-faded", false).classed("is-active", false);
			nodeSelection.classed("is-faded", false).classed("is-selected", false);
			statusEl.textContent = "Click a node to isolate direct flows";
			hideNodePanel();
			return;
		}

		const selectedId = state.selectedNodeId;

		// Populate the left-column info panel for the selected node (shown in
		// all selection modes, before chain data resolves).
		{
			const panelNode = graph.nodes.find((node) => node.id === selectedId);
			if (panelNode) {
				const inflowByNode = new Map();
				const outflowByNode = new Map();
				graph.links.forEach((link) => {
					inflowByNode.set(link.target.id, (inflowByNode.get(link.target.id) || 0) + link.value);
					outflowByNode.set(link.source.id, (outflowByNode.get(link.source.id) || 0) + link.value);
				});
				const throughputOf = (id) =>
					(inflowByNode.get(id) || 0) > 0 ? inflowByNode.get(id) : outflowByNode.get(id) || 0;
				const throughputMt = throughputOf(selectedId);
				const stageTotal = d3.sum(
					graph.nodes.filter((node) => node.stage === panelNode.stage),
					(node) => throughputOf(node.id)
				);
				showNodePanel({
					stageLabel: STAGE_META[panelNode.stage]?.label ?? `Stage ${panelNode.stage}`,
					name: panelNode.label,
					description: panelNode.description,
					stageVar: stageColorVars[panelNode.stage],
					throughputMt,
					sharePct: stageTotal > 0 ? (throughputMt / stageTotal) * 100 : 0
				});
			}
		}

		// Full-chain isolation needs node_details.json; show the direct-neighbor
		// fallback until it arrives, then upgrade in place if still selected.
		if (!state.nodeDetails) {
			applyDirectSelection(selectedId);
			ensureNodeDetails().then(() => {
				if (state.selectedNodeId === selectedId) {
					applySelection();
				}
			});
			return;
		}

		const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
		const chainLinks = chainLinksFor(selectedId, nodeById);

		// Chain not generated for this node yet -> direct-neighbor fallback.
		if (!chainLinks) {
			applyDirectSelection(selectedId);
			return;
		}

		// --- Full-chain isolation: fade the whole baseline chart and draw the
		// chain as its own ribbons at attributed widths. The chain's values are
		// per-node slices (e.g. Car's share of Oil->CO2), so widths must come
		// from the chain data, not the baseline ribbons.
		const chainNodeIds = new Set([selectedId]);
		chainLinks.forEach((link) => {
			chainNodeIds.add(link.sourceId);
			chainNodeIds.add(link.targetId);
		});

		linkSelection.classed("is-active", false).classed("is-faded", true);
		nodeSelection
			.classed("is-selected", (node) => node.id === selectedId)
			.classed("is-faded", (node) => !chainNodeIds.has(node.id));

		// px per Mt from the expanded layout so overlay widths share the chart scale.
		const scaleLink = graph.links.find((link) => link.value > 0 && link.width > 0);
		const pxPerMt = scaleLink ? scaleLink.width / scaleLink.value : 0;

		const datums = chainLinks.map((link) => ({
			source: nodeById.get(link.sourceId),
			target: nodeById.get(link.targetId),
			value: link.value,
			width: Math.max(1, link.value * pxPerMt),
			y0: 0,
			y1: 0
		}));

		// Stack each node's chain slices from its top edge, ordered by the far
		// endpoint's height, so slices fan out without crossing.
		const nodeCenter = (node) => (node.y0 + node.y1) / 2;
		d3.group(datums, (d) => d.source.id).forEach((group) => {
			group.sort((a, b) => nodeCenter(a.target) - nodeCenter(b.target));
			let offset = 0;
			group.forEach((d) => {
				d.y0 = d.source.y0 + offset + d.width / 2;
				offset += d.width;
			});
		});
		d3.group(datums, (d) => d.target.id).forEach((group) => {
			group.sort((a, b) => nodeCenter(a.source) - nodeCenter(b.source));
			let offset = 0;
			group.forEach((d) => {
				d.y1 = d.target.y0 + offset + d.width / 2;
				offset += d.width;
			});
		});

		chainGroup
			.selectAll("path")
			.data(datums)
			.join("path")
			.attr("class", "sankey-chain-link")
			.style("stroke", (d) =>
				stageColorVars[d.source.stage] && stageColorVars[d.target.stage]
					? `url(#${linkGradientId(d.source.stage, d.target.stage)})`
					: "rgba(208, 222, 235, 0.6)"
			)
			.attr("d", d3.sankeyLinkHorizontal())
			.attr("stroke-width", (d) => d.width);

		const selectedNode = nodeById.get(selectedId);
		const inflow = d3.sum(datums, (d) => (d.target.id === selectedId ? d.value : 0));
		const outflow = d3.sum(datums, (d) => (d.source.id === selectedId ? d.value : 0));
		const throughput = inflow > 0 ? inflow : outflow;
		statusEl.textContent = `${selectedNode?.label ?? selectedId}: ${formatMass(throughput)} traced end-to-end`;
	}

	// Direct-neighbor isolation (one hop each way): the behavior for nodes
	// whose full chain hasn't been generated yet, and while node_details.json
	// is still loading.
	function applyDirectSelection(selectedId) {
		const { nodeSelection, linkSelection, graph } = state.rendered;

		const connectedLinks = graph.links.filter(
			(link) => link.source.id === selectedId || link.target.id === selectedId
		);

		const connectedNodeIds = new Set([selectedId]);
		for (const link of connectedLinks) {
			connectedNodeIds.add(link.source.id);
			connectedNodeIds.add(link.target.id);
		}

		linkSelection
			.classed("is-active", (link) => link.source.id === selectedId || link.target.id === selectedId)
			.classed("is-faded", (link) => !(link.source.id === selectedId || link.target.id === selectedId));

		nodeSelection
			.classed("is-selected", (node) => node.id === selectedId)
			.classed("is-faded", (node) => !connectedNodeIds.has(node.id));

		const selectedNode = graph.nodes.find((node) => node.id === selectedId);
		if (!selectedNode) {
			statusEl.textContent = "Click a node to isolate direct flows";
			return;
		}

		const total = d3.sum(connectedLinks, (link) => link.value);
		const topConnection = connectedLinks
			.map((link) => ({
				label: link.source.id === selectedId ? link.target.label : link.source.label,
				value: link.value
			}))
			.sort((a, b) => b.value - a.value)[0];

		if (!topConnection || total <= 0) {
			statusEl.textContent = `${selectedNode.label} selected`;
			return;
		}

		statusEl.textContent = `${selectedNode.label}: ${formatMass(total)} total, top path ${topConnection.label} (${fmtPct((topConnection.value / total) * 100)}%)`;
	}

	// --- Portfolio Themes section --------------------------------------------
	// A scroll-driven walk through the portfolio themes. On entry the roster
	// is dimmed and the themes Sankey is dark; each theme's scroll window lights
	// its companies and their nodes, then resets before the next theme.

	// Scroll budget (vh) that composes #portfolio-themes min-height (1280vh in CSS).
	// The walk is split evenly across however many themes the data ships, then the
	// section keeps the layout pinned for a finale: fade the lead copy out,
	// re-light every company/node, sweep the links in, then a plain hold before
	// the sticky layout releases.
	const THEMES_TRAVEL_VH = 624; // whole-theme walk
	const FINALE_LEAD_FADE_VH = 48; // "Consider four themes" fade-out
	const FINALE_ANIM_VH = 192; // 0-100 finale timeline
	const FINALE_HOLD_VH = 80; // pinned hold before unpin
	const THEMES_SCROLL_VH =
		THEMES_TRAVEL_VH + FINALE_LEAD_FADE_VH + FINALE_ANIM_VH + FINALE_HOLD_VH;
	const P_THEMES_END = THEMES_TRAVEL_VH / THEMES_SCROLL_VH;
	const P_LEAD_END = (THEMES_TRAVEL_VH + FINALE_LEAD_FADE_VH) / THEMES_SCROLL_VH;
	const P_FINALE_END =
		(THEMES_TRAVEL_VH + FINALE_LEAD_FADE_VH + FINALE_ANIM_VH) / THEMES_SCROLL_VH;

	// The layout only becomes visible once the section is fully pinned (its
	// sticky top:0 has already engaged, so this window is scrubbed with zero
	// motion) — carved out of the front of THEMES_TRAVEL_VH rather than added
	// on top, so it doesn't shift any of the fractions above or the section's
	// CSS min-height.
	const ENTRY_FADE_VH = 48;
	const P_ENTRY_END = ENTRY_FADE_VH / THEMES_SCROLL_VH;

	// The themes roster comes from init's intervention block, which is already
	// fetched at page load; reuse it rather than pulling the file down twice.
	function ensureThemesData() {
		if (state.themesData) {
			return Promise.resolve(state.themesData);
		}
		if (state.initData) {
			state.themesData = state.initData;
			return Promise.resolve(state.themesData);
		}
		if (state.themesPromise) {
			return state.themesPromise;
		}
		state.themesPromise = fetch(themesDataPath)
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Failed to fetch ${themesDataPath}: ${response.status}`);
				}
				return response.json();
			})
			.then((data) => {
				state.themesData = data;
				return data;
			})
			.catch((error) => {
				state.themesPromise = null;
				throw error;
			});
		return state.themesPromise;
	}

	// Group companies by their theme id. Theme order, labels and blurbs all come
	// from intervention.themes[], so a theme change is a data-only change.
	function buildThemesModel(data) {
		const companies = data?.intervention?.companies;
		if (!Array.isArray(companies)) {
			return [];
		}

		const themeMeta = new Map();
		const rawThemes = Array.isArray(data?.intervention?.themes)
			? data.intervention.themes
			: [];
		rawThemes.forEach((theme, index) => {
			const slug = String(theme?.theme || "").trim();
			if (!slug) {
				return;
			}
			themeMeta.set(slug, {
				label: String(theme?.theme_label || slug).trim(),
				blurb: String(theme?.description || "").trim(),
				order: Number.isFinite(theme?.order) ? theme.order : index
			});
		});

		const byTheme = new Map();
		companies.forEach((company) => {
			const slug = String(company?.theme || "").trim();
			if (!slug) {
				return;
			}
			if (!byTheme.has(slug)) {
				const meta = themeMeta.get(slug);
				byTheme.set(slug, {
					slug,
					label: meta?.label || slug,
					blurb: meta?.blurb || "",
					order: meta?.order ?? Number.MAX_SAFE_INTEGER,
					companies: [],
					nodeIds: new Set()
				});
			}
			const theme = byTheme.get(slug);
			const label = String(company?.company_label || company?.company || "")
				.replace(/^_+/, "")
				.trim();
			const nodeId = String(company?.node || "").trim();
			const technologyLabel = String(company?.technology || "").trim();
			const bullets = Array.isArray(company?.bullets)
				? company.bullets.map((entry) => String(entry || "").trim()).filter(Boolean)
				: [];
			// Long-form prose for the company-overview tab in the impacts card.
			const overview = [company?.par1, company?.par2]
				.map((entry) => String(entry || "").trim())
				.filter(Boolean);
			theme.companies.push({
				label,
				nodeId,
				technologyLabel,
				bullets,
				overview,
				businessId: normalizeBusinessSlug(company?.company || company?.company_label)
			});
			if (nodeId) {
				theme.nodeIds.add(nodeId);
			}
		});

		return Array.from(byTheme.values()).sort((a, b) => a.order - b.order);
	}

	// Build the left-column info blocks and the persistent roster columns,
	// caching element references on the model for the scroll handler to toggle.
	function renderThemesRoster(model) {
		const infoWrap = document.querySelector(".themes-info");
		const rosterWrap = document.querySelector(".themes-roster");
		if (!infoWrap || !rosterWrap) {
			return;
		}
		const finaleLeadEl = infoWrap.querySelector(".themes-finale-lead");
		infoWrap.innerHTML = "";
		if (finaleLeadEl) {
			infoWrap.append(finaleLeadEl);
		}
		rosterWrap.innerHTML = "";
		model.forEach((theme) => {
			const info = document.createElement("div");
			info.className = "themes-info__block";
			info.dataset.theme = theme.slug;
			info.style.opacity = "0";
			const infoBody = document.createElement("p");
			infoBody.className = "themes-info__body";
			infoBody.innerHTML = theme.blurb;
			info.append(infoBody);
			infoWrap.append(info);
			theme.infoEl = info;

			const col = document.createElement("div");
			col.className = "themes-col";
			col.dataset.theme = theme.slug;
			const colTitle = document.createElement("h4");
			colTitle.className = "themes-col__title";
			colTitle.textContent = theme.label;
			const list = document.createElement("ul");
			list.className = "themes-col__list";
			theme.companies.forEach((company) => {
				const item = document.createElement("li");
				item.className = "themes-company";
				item.textContent = company.label;
				list.append(item);
				company.el = item;
			});
			col.append(colTitle, list);
			rosterWrap.append(col);
			theme.columnEl = col;
		});
	}

	// Non-interactive full baseline Sankey for the themes section. Nodes start
	// dark; drawThemes drives per-node opacity so only the active theme lights up.
	function renderThemesSankey() {
		if (!themesChart || !state.nodes.length || !state.links.length) {
			return;
		}

		const bounds = themesChart.getBoundingClientRect();
		const width = Math.max(820, Math.floor(bounds.width));
		const height = Math.max(560, Math.floor(bounds.height));

		d3.select(themesChart).selectAll("*").remove();

		const svg = d3
			.select(themesChart)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.style("pointer-events", "none");

		const graph = {
			nodes: state.nodes.map((node) => ({ ...node })),
			links: state.links.map((link) => ({ ...link }))
		};

		d3
			.sankey()
			.nodeId((d) => d.id)
			.nodeWidth(20)
			.nodePadding(9)
			.nodeAlign(d3.sankeyJustify)
			.extent([
				[28, 44],
				[width - 28, height - 34]
			])
			.iterations(64)(graph);

		// Align every stage top *and* bottom so the expanded columns are equal height.
		spreadStageHeights(graph, 44, height - 34);
		spreadNodesForLabels(themesChart, graph, 44, height - 34);

		// Per-stage-pair link gradients (themes-specific ids, anchored in user
		// space to this chart's columns) so each ribbon reads in its stage colors.
		const defs = svg.append("defs");
		const stageBounds = stageXBounds(graph);
		const stagePairs = Array.from(
			new Set(
				graph.links.map((link) => `${link.source?.stage ?? "?"}-${link.target?.stage ?? "?"}`)
			)
		);
		stagePairs.forEach((pair) => {
			const [sourceStage, targetStage] = pair.split("-").map((v) => Number.parseInt(v, 10));
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];
			if (!sourceColorVar || !targetColorVar) {
				return;
			}
			const gradient = defs
				.append("linearGradient")
				.attr("id", `themes-link-gradient-${sourceStage}-${targetStage}`)
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", stageBounds.get(sourceStage)?.x1 ?? 0)
				.attr("y1", 0)
				.attr("x2", stageBounds.get(targetStage)?.x0 ?? width)
				.attr("y2", 0);
			gradient.append("stop").attr("offset", "0%").style("stop-color", `var(${sourceColorVar})`);
			gradient.append("stop").attr("offset", "100%").style("stop-color", `var(${targetColorVar})`);
		});
		const themesLinkStroke = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;
			if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
				return `url(#themes-link-gradient-${sourceStage}-${targetStage})`;
			}
			return "rgba(208, 222, 235, 0.38)";
		};

		const linksGroup = svg.append("g").attr("fill", "none").attr("class", "sankey-links");
		const linkSelection = linksGroup
			.selectAll("path")
			.data(graph.links, (d) => d.id)
			.join("path")
			.attr("class", "sankey-link")
			.attr("d", d3.sankeyLinkHorizontal())
			.style("stroke", themesLinkStroke)
			.attr("stroke-width", (d) => Math.max(1, d.width));

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");
		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(graph.nodes, (d) => d.id)
			.join("g")
			.attr("class", (d) => `sankey-node stage-${d.stage}`)
			.attr("transform", (d) => `translate(${d.x0},${d.y0})`);

		nodeSelection
			.append("rect")
			.attr("width", (d) => Math.max(1, d.x1 - d.x0))
			.attr("height", (d) => Math.max(3, d.y1 - d.y0));

		nodeSelection
			.append("title")
			.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));

		nodeSelection
			.append("text")
			.attr("x", (d) => (d.stage !== 7 ? Math.max(1, d.x1 - d.x0) + 7 : -7))
			.attr("y", (d) => Math.max(3, d.y1 - d.y0) / 2)
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.stage !== 7 ? "start" : "end"))
			.text((d) => d.label);

		wrapNodeLabels(nodeSelection.selectAll("text"), computeLabelMaxWidth(graph));

		const headersGroup = svg.append("g").attr("class", "sankey-stage-headers");
		renderStageHeaders(headersGroup, graph, 24);

		state.themesRendered = { nodeSelection, linkSelection, graph };
		drawThemes(state.themesProgress || 0);
	}

	// Split scroll progress into one equal window per theme. Within the active
	// window: fade the theme copy in/out, brighten its roster column, and reveal
	// all of its companies (and their nodes) together, simultaneously. Non-
	// active themes are fully reset, so only one theme is ever lit.
	function drawThemesWalk(progress) {
		const model = state.themesModel;
		const rendered = state.themesRendered;
		if (!model || !model.length) {
			return;
		}

		const count = model.length;
		const activeIdx = Math.min(count - 1, Math.floor(progress * count));
		const local = clamp01(progress * count - activeIdx);

		const fade = 0.12;
		let presence = 1;
		if (local < fade) {
			presence = local / fade;
		} else if (local > 1 - fade) {
			presence = (1 - local) / fade;
		}
		presence = clamp01(presence);

		const revealStart = 0.16;
		const perCompanyFade = 0.14;

		model.forEach((theme, index) => {
			const isActive = index === activeIdx;
			if (theme.infoEl) {
				theme.infoEl.style.opacity = String(isActive ? presence : 0);
			}
			if (theme.columnEl) {
				theme.columnEl.classList.toggle("is-active", isActive && presence > 0.4);
			}
			if (!isActive) {
				theme.companies.forEach((company) => {
					if (company.el) {
						company.el.classList.remove("is-lit");
					}
				});
			}
		});

		const active = model[activeIdx];
		const nodeLit = new Map();
		// All companies in the active theme reveal together (no per-company stagger).
		active.companies.forEach((company) => {
			const lit = smoothstep(clamp01((local - revealStart) / perCompanyFade)) * presence;
			if (company.el) {
				company.el.classList.toggle("is-lit", lit > 0.45);
			}
			if (company.nodeId) {
				nodeLit.set(company.nodeId, Math.max(nodeLit.get(company.nodeId) || 0, lit));
			}
		});

		if (rendered && rendered.nodeSelection) {
			rendered.nodeSelection.style("opacity", (d) => 0.05 + 0.95 * (nodeLit.get(d.id) || 0));
		}
	}

	// A deterministic non-linear reveal order for the finale (seeded so scrubbing
	// back and forth is stable, yet not the top-to-bottom order used per theme).
	function getFinaleOrder() {
		if (state.finaleOrder) {
			return state.finaleOrder;
		}
		const flat = [];
		(state.themesModel || []).forEach((theme) => {
			theme.companies.forEach((company) => flat.push(company));
		});
		let seed = 0x9e3779b9;
		const rand = () => {
			seed |= 0;
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		for (let i = flat.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[flat[i], flat[j]] = [flat[j], flat[i]];
		}
		state.finaleOrder = flat;
		return flat;
	}

	// Precompute each company's FULL impact chain (all nodes/links it touches
	// across the columns), reusing the same node_details.json chains as the
	// portfolio-business highlight. Owners are stored by finale reveal index so
	// the spider-web can time each link/node to when its company lights up.
	// `ring` = column distance from the company's main node (concentric rings).
	// Falls back to direct neighbours until node_details.json has loaded, and
	// only caches once it has (so we never lock in the fallback).
	function buildFinaleChains() {
		if (state.finaleChains) {
			return state.finaleChains;
		}
		const rendered = state.themesRendered;
		const result = {
			nodeOwners: new Map(),
			linkOwners: new Map(),
			mainNodeIndices: new Map()
		};
		if (!rendered || !rendered.graph) {
			return result;
		}
		const nodeById = new Map(rendered.graph.nodes.map((node) => [node.id, node]));
		const addNodeOwner = (nodeId, index) => {
			let arr = result.nodeOwners.get(nodeId);
			if (!arr) {
				arr = [];
				result.nodeOwners.set(nodeId, arr);
			}
			arr.push(index);
		};
		const addLinkOwner = (key, index, ring) => {
			let arr = result.linkOwners.get(key);
			if (!arr) {
				arr = [];
				result.linkOwners.set(key, arr);
			}
			arr.push({ companyIndex: index, ring });
		};

		getFinaleOrder().forEach((company, index) => {
			const mainNodeId = company.nodeId;
			if (!mainNodeId || !nodeById.has(mainNodeId)) {
				return;
			}
			const mainStage = nodeById.get(mainNodeId).stage;
			let mains = result.mainNodeIndices.get(mainNodeId);
			if (!mains) {
				mains = [];
				result.mainNodeIndices.set(mainNodeId, mains);
			}
			mains.push(index);
			addNodeOwner(mainNodeId, index);

			// Only reach for the full chain once node_details.json is loaded, so we
			// don't poison chainLinksFor's cache with a premature null.
			const chainLinks = state.nodeDetails ? chainLinksFor(mainNodeId, nodeById) : null;
			const pairs = chainLinks
				? chainLinks.map((link) => [link.sourceId, link.targetId])
				: rendered.graph.links
						.filter((link) => link.source.id === mainNodeId || link.target.id === mainNodeId)
						.map((link) => [link.source.id, link.target.id]);

			pairs.forEach(([sourceId, targetId]) => {
				addNodeOwner(sourceId, index);
				addNodeOwner(targetId, index);
				const sStage = nodeById.get(sourceId)?.stage ?? mainStage;
				const tStage = nodeById.get(targetId)?.stage ?? mainStage;
				const ring = Math.min(Math.abs(sStage - mainStage), Math.abs(tStage - mainStage));
				addLinkOwner(`${sourceId}|${targetId}`, index, ring);
			});
		});

		if (state.nodeDetails) {
			state.finaleChains = result;
		}
		return result;
	}

	// Drive the whole section: the four-theme walk, then the pinned finale
	// (lead crossfade -> re-light everything -> sweep links -> hold).
	function drawThemes(progress) {
		state.themesProgress = progress;
		const model = state.themesModel;
		if (!model || !model.length) {
			return;
		}

		if (!state.themesLeadEl) {
			state.themesLeadEl = document.querySelector(".themes-lead");
			state.themesFinaleLeadEl = document.querySelector(".themes-finale-lead");
			state.themesLayoutEl = document.querySelector(".themes-layout");
		}

		// Entry: the layout is invisible while the section approaches (so the
		// ordinary scroll that carries it up from below the fold isn't seen),
		// then fades in over ENTRY_FADE_VH once already pinned in place. Exit:
		// past the finale, the pinned layout holds static for the first half of
		// the hold budget, then dissolves to the shared black background over the
		// second half so the section disappears instead of visibly unsticking.
		if (state.themesLayoutEl) {
			const entryT = clamp01(progress / P_ENTRY_END);
			const holdLocal =
				progress <= P_FINALE_END
					? 0
					: clamp01((progress - P_FINALE_END) / (1 - P_FINALE_END));
			const exitFadeT = clamp01((holdLocal - 0.5) / 0.5);
			state.themesLayoutEl.style.opacity = String(entryT * (1 - exitFadeT));
		}

		if (progress < P_THEMES_END) {
			drawThemesWalk(clamp01(progress / P_THEMES_END));
			if (state.themesLeadEl) {
				state.themesLeadEl.style.opacity = "1";
			}
			if (state.themesFinaleLeadEl) {
				state.themesFinaleLeadEl.style.opacity = "0";
			}
			drawFinale(0, true);
			return;
		}

		// Beyond the walk the roster/nodes are driven entirely by the finale;
		// the per-theme blurbs stay hidden so the finale sentence stands alone.
		model.forEach((theme) => {
			if (theme.infoEl) {
				theme.infoEl.style.opacity = "0";
			}
		});

		const leadT = clamp01((progress - P_THEMES_END) / (P_LEAD_END - P_THEMES_END));
		if (state.themesLeadEl) {
			state.themesLeadEl.style.opacity = String(1 - leadT);
		}

		const finaleLocal = clamp01((progress - P_LEAD_END) / (P_FINALE_END - P_LEAD_END));
		drawFinale(finaleLocal * 100, false);
	}

	// Finale on a 0-100 timeline: 1-35 sentence fades in and holds; 10-50 every
	// company (shuffled order) lights its FULL impact chain (all nodes it touches
	// across the columns), main nodes get the white .is-selected border, and each
	// company's links spider-web out from its main node (concentric rings, so
	// closer columns light first). Non-chain links stay dark. Past 100 it holds.
	function drawFinale(t, idle) {
		const model = state.themesModel;
		const rendered = state.themesRendered;
		if (!model || !model.length) {
			return;
		}

		if (idle) {
			// The walk owns column/company/node opacity; the links and the selected
			// border are finale-owned, so hold links faint and clear the border.
			if (rendered && rendered.linkSelection) {
				rendered.linkSelection.style("opacity", 0);
			}
			if (rendered && rendered.nodeSelection) {
				rendered.nodeSelection.classed("is-selected", false);
			}
			return;
		}

		// #1 sentence
		if (state.themesFinaleLeadEl) {
			state.themesFinaleLeadEl.style.opacity = String(clamp01((t - 1) / 34));
		}

		// #2 companies: per-company lit value keyed by finale reveal index.
		const order = getFinaleOrder();
		const n = order.length;
		const perFade = 8;
		const stagger = n > 1 ? (40 - perFade) / (n - 1) : 0;
		const startTFor = (index) => 10 + index * stagger;
		const litByIndex = new Array(n);
		const litCompanies = new Set();
		order.forEach((company, index) => {
			const lit = smoothstep(clamp01((t - startTFor(index)) / perFade));
			litByIndex[index] = lit;
			if (company.el) {
				company.el.classList.toggle("is-lit", lit > 0.45);
			}
			if (lit > 0.45) {
				litCompanies.add(company);
			}
		});

		model.forEach((theme) => {
			if (theme.columnEl) {
				const anyLit = theme.companies.some((company) => litCompanies.has(company));
				theme.columnEl.classList.toggle("is-active", anyLit);
			}
		});

		const chains = buildFinaleChains();

		// #3 nodes: every chain node lights to its brightest owning company; the
		// company main nodes also get the white selected border.
		if (rendered && rendered.nodeSelection) {
			rendered.nodeSelection
				.style("opacity", (d) => {
					const owners = chains.nodeOwners.get(d.id);
					let lit = 0;
					if (owners) {
						for (const oi of owners) {
							if (litByIndex[oi] > lit) lit = litByIndex[oi];
						}
					}
					return 0.05 + 0.95 * lit;
				})
				.classed("is-selected", (d) => {
					const mains = chains.mainNodeIndices.get(d.id);
					return mains ? mains.some((oi) => litByIndex[oi] > 0.45) : false;
				});
		}

		// #4 links spider-web out from each company's main node.
		if (rendered && rendered.linkSelection) {
			const RING_DELAY = 6;
			const gFade = 14;
			rendered.linkSelection.style("opacity", (d) => {
				const owners = chains.linkOwners.get(`${d.source.id}|${d.target.id}`);
				if (!owners) {
					return 0;
				}
				let startT = Infinity;
				for (const o of owners) {
					const s = startTFor(o.companyIndex) + RING_DELAY * o.ring;
					if (s < startT) startT = s;
				}
				const p = clamp01((t - startT) / gFade);
				const eased = 1 - (1 - p) * (1 - p);
				return 0.35 * eased;
			});
		}
	}

	// Reduced-motion / no-GSAP fallback: show every theme's copy and roster lit
	// and light all theme nodes, with no scroll dependency.
	function applyThemesReducedMotion() {
		const model = state.themesModel;
		if (!model) {
			return;
		}
		const lead = document.querySelector(".themes-lead");
		const finaleLead = document.querySelector(".themes-finale-lead");
		if (lead) {
			lead.style.opacity = "0";
		}
		if (finaleLead) {
			finaleLead.style.opacity = "1";
		}
		model.forEach((theme) => {
			if (theme.infoEl) {
				theme.infoEl.style.opacity = "0";
			}
			if (theme.columnEl) {
				theme.columnEl.classList.add("is-active");
			}
			theme.companies.forEach((company) => {
				if (company.el) {
					company.el.classList.add("is-lit");
				}
			});
		});
		const chains = buildFinaleChains();
		if (state.themesRendered && state.themesRendered.nodeSelection) {
			state.themesRendered.nodeSelection
				.style("opacity", (d) => (chains.nodeOwners.has(d.id) ? 1 : 0.05))
				.classed("is-selected", (d) => chains.mainNodeIndices.has(d.id));
		}
		if (state.themesRendered && state.themesRendered.linkSelection) {
			state.themesRendered.linkSelection.style("opacity", (d) =>
				chains.linkOwners.has(`${d.source.id}|${d.target.id}`) ? 0.4 : 0
			);
		}
	}

	function setupThemesScroll() {
		const section = document.getElementById("portfolio-themes");
		if (!section) {
			return;
		}

		// The walk/finale is scrubbed (driven by the user's own scroll), so it runs
		// under reduced-motion too; only fall back when GSAP itself is unavailable.
		if (!window.gsap || !window.ScrollTrigger) {
			applyThemesReducedMotion();
			return;
		}

		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawThemes(self.progress),
			onRefresh: (self) => drawThemes(self.progress)
		});
		drawThemes(0);
	}

	async function initThemesSection() {
		if (!themesChart) {
			return;
		}
		try {
			const data = await ensureThemesData();
			state.themesModel = buildThemesModel(data);
			renderThemesRoster(state.themesModel);
			renderThemesSankey();
			setupThemesScroll();
			// Warm the full-chain data so the finale can spider-web the complete
			// impact of each company, then re-apply the current state.
			ensureNodeDetails().then(() => {
				state.finaleChains = null;
				buildFinaleChains();
				if (!window.gsap || !window.ScrollTrigger) {
					applyThemesReducedMotion();
				} else {
					drawThemes(state.themesProgress || 0);
				}
			});
		} catch (error) {
			console.warn("Themes section init failed:", error);
		}
	}

	// --- Timeline intro (bg fade + two crossfading lines, locked #timeline-intro) --
	// Same sequential window shape as the portfolio/impacts intros (412vh scrub
	// range + 80vh pinned viewport): bg-in 96vh, line1-in 48vh, hold 40vh,
	// line1-out 40vh, line2-in 48vh, hold 60vh, line2+bg fade-out over the final 80vh.
	const TLI_TOTAL_VH = 412;
	const TLI_BG_IN = [0, 96 / TLI_TOTAL_VH];
	const TLI_LINE1_IN = [96 / TLI_TOTAL_VH, 144 / TLI_TOTAL_VH];
	const TLI_LINE1_OUT = [184 / TLI_TOTAL_VH, 224 / TLI_TOTAL_VH];
	const TLI_LINE2_IN = [224 / TLI_TOTAL_VH, 272 / TLI_TOTAL_VH];
	const TLI_ALL_OUT = [332 / TLI_TOTAL_VH, 1];

	function drawTimelineIntro(progress) {
		state.timelineIntroProgress = progress;
		const bgIn = windowProgress(progress, TLI_BG_IN);
		const allOut = windowProgress(progress, TLI_ALL_OUT);
		if (state.timelineIntroBgEl) {
			state.timelineIntroBgEl.style.opacity = String(bgIn * (1 - allOut));
		}
		if (state.timelineIntroLine1El) {
			const inAmt = windowProgress(progress, TLI_LINE1_IN);
			const outAmt = windowProgress(progress, TLI_LINE1_OUT);
			state.timelineIntroLine1El.style.opacity = String(inAmt * (1 - outAmt));
		}
		if (state.timelineIntroLine2El) {
			const inAmt = windowProgress(progress, TLI_LINE2_IN);
			state.timelineIntroLine2El.style.opacity = String(inAmt * (1 - allOut));
		}
	}

	function setupTimelineIntroScroll() {
		const section = document.getElementById("timeline-intro");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawTimelineIntro(1);
			return;
		}
		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawTimelineIntro(self.progress),
			onRefresh: (self) => drawTimelineIntro(self.progress)
		});
		drawTimelineIntro(0);
	}

	function initTimelineIntroSection() {
		const section = document.getElementById("timeline-intro");
		if (!section) {
			return;
		}
		state.timelineIntroBgEl = document.querySelector("#timeline-intro .timeline-intro__bg");
		state.timelineIntroLine1El = document.querySelector("#timeline-intro .timeline-intro__line--1");
		state.timelineIntroLine2El = document.querySelector("#timeline-intro .timeline-intro__line--2");
		setupTimelineIntroScroll();
	}

	// --- Portfolio intro (bg fade + two crossfading lines, locked #tif-tgif-portfolio) --
	// Sequential windows, fractions of a 412vh scroll range (+80vh pinned viewport):
	// bg fade-in 96vh, line-1 in 48vh, hold 40vh, line-1 out 40vh, line-2 in 48vh,
	// hold 60vh, then line-2 + bg fade out together over the final 80vh.
	const PI_TOTAL_VH = 412;
	const PI_BG_IN = [0, 96 / PI_TOTAL_VH];
	const PI_LINE1_IN = [96 / PI_TOTAL_VH, 144 / PI_TOTAL_VH];
	const PI_LINE1_OUT = [184 / PI_TOTAL_VH, 224 / PI_TOTAL_VH];
	const PI_LINE2_IN = [224 / PI_TOTAL_VH, 272 / PI_TOTAL_VH];
	const PI_ALL_OUT = [332 / PI_TOTAL_VH, 1];

	function drawPortfolioIntro(progress) {
		state.portfolioIntroProgress = progress;
		const bgIn = windowProgress(progress, PI_BG_IN);
		const allOut = windowProgress(progress, PI_ALL_OUT);
		if (state.portfolioIntroBgEl) {
			state.portfolioIntroBgEl.style.opacity = String(bgIn * (1 - allOut));
		}
		if (state.portfolioIntroLine1El) {
			const inAmt = windowProgress(progress, PI_LINE1_IN);
			const outAmt = windowProgress(progress, PI_LINE1_OUT);
			state.portfolioIntroLine1El.style.opacity = String(inAmt * (1 - outAmt));
		}
		if (state.portfolioIntroLine2El) {
			const inAmt = windowProgress(progress, PI_LINE2_IN);
			state.portfolioIntroLine2El.style.opacity = String(inAmt * (1 - allOut));
		}
	}

	function setupPortfolioIntroScroll() {
		const section = document.getElementById("tif-tgif-portfolio");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawPortfolioIntro(1);
			return;
		}
		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawPortfolioIntro(self.progress),
			onRefresh: (self) => drawPortfolioIntro(self.progress)
		});
		drawPortfolioIntro(0);
	}

	function initPortfolioIntroSection() {
		const section = document.getElementById("tif-tgif-portfolio");
		if (!section) {
			return;
		}
		state.portfolioIntroBgEl = document.querySelector("#tif-tgif-portfolio .portfolio-intro__bg");
		state.portfolioIntroLine1El = document.querySelector("#tif-tgif-portfolio .portfolio-intro__line--1");
		state.portfolioIntroLine2El = document.querySelector("#tif-tgif-portfolio .portfolio-intro__line--2");
		setupPortfolioIntroScroll();
	}

	// --- Timeline section (2025 -> 2040 scroll morph) -------------------------
	// The right-column Sankey morphs from the 2025 baseline to the 2040A scenario
	// while the left column slides a year strip 2025 -> 2040. We have no per-year
	// data, so both endpoints are laid out independently and every node/link is
	// linearly interpolated between them (easeInOut over the scroll range).
	const TIMELINE_TARGET_SCENARIO = "2040A";
	// Scroll windows as fractions of the #timeline scroll range (section ~384vh).
	// Fades .timeline-layout in over the first ~38vh, once it's already sticky-
	// locked at top:0 (the section-to-section slide happens before this
	// ScrollTrigger's progress 0), so #timeline appears via crossfade rather
	// than visibly sliding up into place.
	const TL_OPEN_IN = [0, 0.1];
	const TL_ANIM = [0.32, 0.9]; // sankey morph + year slide (~144vh of 256vh)
	const TL_CLOSE_IN = [0.8, 0.9];
	// Bottom-pinned growth: the 2025 chart fills TL_START_FRAC of the band height
	// and grows to TL_END_FRAC (full) by 2040, so the rising envelope reads as the
	// rising emissions total. Tunable; could instead be derived from GT totals.
	const TL_START_FRAC = 0.92;
	const TL_END_FRAC = 1;
	// Left y-axis: hardcoded copy-matching GT labels (not derived from data),
	// mirroring the scenarioTotalsGt precedent used by the scenario chart.
	const TIMELINE_START_GT = 54;
	const TIMELINE_END_GT = 57;
	const TIMELINE_AXIS_X = 18;

	function renderTimelineSankey() {
		if (!timelineChart || !state.initData || !state.baselinesData) {
			return;
		}

		const bounds = timelineChart.getBoundingClientRect();
		const width = Math.max(820, Math.floor(bounds.width));
		const height = Math.max(560, Math.floor(bounds.height));

		const layoutGraph = (scenarioKey) => {
			const built = buildGraph(state.initData, state.baselinesData, scenarioKey);
			const graph = {
				nodes: built.nodes.map((node) => ({ ...node })),
				links: built.links.map((link) => ({ ...link }))
			};
			d3
				.sankey()
				.nodeId((d) => d.id)
				.nodeWidth(20)
				.nodePadding(9)
				.nodeAlign(d3.sankeyJustify)
				.extent([
					[28, 44],
					[width - 28, height - 34]
				])
				.iterations(64)(graph);
			spreadStageHeights(graph, 44, height - 34);
			spreadNodesForLabels(timelineChart, graph, 44, height - 34);
			return graph;
		};

		const startGraph = layoutGraph(defaultScenario); // 2025

		// Capture the exact vertical order of nodes from 2025 per stage
		const startOrderMap = new Map();
		d3.group(startGraph.nodes, (d) => d.stage).forEach((stageNodes) => {
			stageNodes
				.slice()
				.sort((a, b) => a.y0 - b.y0)
				.forEach((node, idx) => {
					startOrderMap.set(node.id, idx);
				});
		});

		// Layout the 2040 target scenario locked to 2025 node ordering (iterations: 0)
		const layoutEndGraph = (scenarioKey) => {
			const built = buildGraph(state.initData, state.baselinesData, scenarioKey);
			const graph = {
				nodes: built.nodes.map((node) => ({ ...node })),
				links: built.links.map((link) => ({ ...link }))
			};
			d3
				.sankey()
				.nodeId((d) => d.id)
				.nodeWidth(20)
				.nodePadding(9)
				.nodeAlign(d3.sankeyJustify)
				.nodeSort((a, b) => {
					const orderA = startOrderMap.has(a.id) ? startOrderMap.get(a.id) : 999;
					const orderB = startOrderMap.has(b.id) ? startOrderMap.get(b.id) : 999;
					return orderA - orderB;
				})
				.extent([
					[28, 44],
					[width - 28, height - 34]
				])
				.iterations(0)(graph);
			spreadStageHeights(graph, 44, height - 34);
			spreadNodesForLabels(timelineChart, graph, 44, height - 34);
			return graph;
		};

		const endGraph = layoutEndGraph(TIMELINE_TARGET_SCENARIO); // 2040A

		// Scale every y about the band bottom so the chart is pinned to the bottom
		// and its height encodes the endpoint's fraction of full height.
		const bandBottom = height - 34;
		const scaleY = (y, frac) => bandBottom - (bandBottom - y) * frac;

		const linkKey = (link) => `${link.source.id}|${link.target.id}`;
		const nodeGeomMap = (graph, frac) => {
			const map = new Map();
			graph.nodes.forEach((node) => {
				map.set(node.id, {
					x0: node.x0,
					y0: scaleY(node.y0, frac),
					x1: node.x1,
					y1: scaleY(node.y1, frac),
					node
				});
			});
			return map;
		};
		const linkGeomMap = (graph, frac) => {
			const map = new Map();
			graph.links.forEach((link) => {
				map.set(linkKey(link), {
					sx: link.source.x1,
					tx: link.target.x0,
					y0: scaleY(link.y0, frac),
					y1: scaleY(link.y1, frac),
					width: link.width * frac,
					link
				});
			});
			return map;
		};

		const startNodes = nodeGeomMap(startGraph, TL_START_FRAC);
		const endNodes = nodeGeomMap(endGraph, TL_END_FRAC);
		const startLinks = linkGeomMap(startGraph, TL_START_FRAC);
		const endLinks = linkGeomMap(endGraph, TL_END_FRAC);

		// A node/link present in only one scenario is collapsed to zero height at
		// its own position on the missing side, so it grows in / shrinks out cleanly.
		const collapseNode = (geom) =>
			geom ? { x0: geom.x0, x1: geom.x1, y0: (geom.y0 + geom.y1) / 2, y1: (geom.y0 + geom.y1) / 2 } : null;
		const collapseLink = (geom) =>
			geom
				? { sx: geom.sx, tx: geom.tx, y0: (geom.y0 + geom.y1) / 2, y1: (geom.y0 + geom.y1) / 2, width: 0 }
				: null;

		const startNodeOf = (id) => startNodes.get(id) || collapseNode(endNodes.get(id));
		const endNodeOf = (id) => endNodes.get(id) || collapseNode(startNodes.get(id));
		const startLinkOf = (key) => startLinks.get(key) || collapseLink(endLinks.get(key));
		const endLinkOf = (key) => endLinks.get(key) || collapseLink(startLinks.get(key));

		const nodeIds = new Set([...startNodes.keys(), ...endNodes.keys()]);
		const nodeData = Array.from(nodeIds).map((id) => (endNodes.get(id) || startNodes.get(id)).node);

		const linkKeys = new Set([...startLinks.keys(), ...endLinks.keys()]);
		const linkData = Array.from(linkKeys).map((key) => {
			const ref = (endLinks.get(key) || startLinks.get(key)).link;
			return { id: key, key, source: ref.source, target: ref.target };
		});

		const svg = d3
			.select(timelineChart)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.style("pointer-events", "none");
		svg.selectAll("*").remove();

		const defs = svg.append("defs");
		const stageBounds = stageXBounds(endGraph);
		const stagePairs = Array.from(
			new Set(linkData.map((link) => `${link.source?.stage ?? "?"}-${link.target?.stage ?? "?"}`))
		);
		stagePairs.forEach((pair) => {
			const [sourceStage, targetStage] = pair.split("-").map((v) => Number.parseInt(v, 10));
			const sourceColorVar = stageColorVars[sourceStage];
			const targetColorVar = stageColorVars[targetStage];
			if (!sourceColorVar || !targetColorVar) {
				return;
			}
			const gradient = defs
				.append("linearGradient")
				.attr("id", `timeline-link-gradient-${sourceStage}-${targetStage}`)
				.attr("gradientUnits", "userSpaceOnUse")
				.attr("x1", stageBounds.get(sourceStage)?.x1 ?? 0)
				.attr("y1", 0)
				.attr("x2", stageBounds.get(targetStage)?.x0 ?? width)
				.attr("y2", 0);
			gradient.append("stop").attr("offset", "0%").style("stop-color", `var(${sourceColorVar})`);
			gradient.append("stop").attr("offset", "100%").style("stop-color", `var(${targetColorVar})`);
		});

		const linkStroke = (link) => {
			const sourceStage = Number.isFinite(link.source?.stage) ? link.source.stage : null;
			const targetStage = Number.isFinite(link.target?.stage) ? link.target.stage : null;
			if (sourceStage && targetStage && stageColorVars[sourceStage] && stageColorVars[targetStage]) {
				return `url(#timeline-link-gradient-${sourceStage}-${targetStage})`;
			}
			return "rgba(208, 222, 235, 0.38)";
		};

		const linkGen = d3.sankeyLinkHorizontal();
		const linkPathFromGeom = (geom) =>
			linkGen({ source: { x1: geom.sx }, target: { x0: geom.tx }, y0: geom.y0, y1: geom.y1 });

		const linksGroup = svg.append("g").attr("fill", "none").attr("class", "sankey-links");
		const linkSelection = linksGroup
			.selectAll("path")
			.data(linkData, (d) => d.id)
			.join("path")
			.attr("class", "sankey-link")
			.style("stroke", linkStroke)
			.attr("d", (d) => linkPathFromGeom(startLinkOf(d.key)))
			.attr("stroke-width", (d) => Math.max(0.5, startLinkOf(d.key).width));

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");
		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(nodeData, (d) => d.id)
			.join("g")
			.attr("class", (d) => `sankey-node stage-${d.stage}`)
			.attr("transform", (d) => {
				const geom = startNodeOf(d.id);
				return `translate(${geom.x0},${geom.y0})`;
			});

		nodeSelection
			.append("rect")
			.attr("width", (d) => {
				const geom = startNodeOf(d.id);
				return Math.max(1, geom.x1 - geom.x0);
			})
			.attr("height", (d) => {
				const geom = startNodeOf(d.id);
				return Math.max(3, geom.y1 - geom.y0);
			});

		nodeSelection
			.append("title")
			.text((d) => (d.description ? `${d.label}\n${d.description}` : `${d.label}`));

		nodeSelection
			.append("text")
			.attr("x", (d) => {
				const geom = startNodeOf(d.id);
				return d.stage !== 7 ? Math.max(1, geom.x1 - geom.x0) + 7 : -7;
			})
			.attr("y", (d) => {
				const geom = startNodeOf(d.id);
				return Math.max(3, geom.y1 - geom.y0) / 2;
			})
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.stage !== 7 ? "start" : "end"))
			.text((d) => d.label);

		wrapNodeLabels(nodeSelection.selectAll("text"), computeLabelMaxWidth(endGraph));

		// Left y-axis: a static "54 Gt" tick at the 2025 (start-state) envelope
		// top, plus a growing line + live counting label that tracks the chart's
		// rising top edge (same scaleY math as the node envelope) up to "57 Gt".
		const axisTopStart = scaleY(44, TL_START_FRAC);
		const axisTopEnd = scaleY(44, TL_END_FRAC);
		const axisGroup = svg.append("g").attr("class", "timeline-axis");

		axisGroup
			.append("line")
			.attr("class", "timeline-axis__tick-dash")
			.attr("x1", TIMELINE_AXIS_X)
			.attr("x2", TIMELINE_AXIS_X + 8)
			.attr("y1", axisTopStart)
			.attr("y2", axisTopStart);
		const tickLabel = axisGroup
			.append("text")
			.attr("class", "timeline-axis__tick-label")
			.attr("x", TIMELINE_AXIS_X - 12)
			.attr("y", axisTopStart)
			.attr("dy", "0.32em")
			.attr("text-anchor", "end")
			.text(`${TIMELINE_START_GT} Gt`);

		const axisLine = axisGroup
			.append("line")
			.attr("class", "timeline-axis__line")
			.attr("x1", TIMELINE_AXIS_X)
			.attr("x2", TIMELINE_AXIS_X)
			.attr("y1", bandBottom)
			.attr("y2", axisTopStart);
		const axisMarkerLabel = axisGroup
			.append("text")
			.attr("class", "timeline-axis__marker-label")
			.attr("x", TIMELINE_AXIS_X - 12)
			.attr("y", axisTopStart)
			.attr("dy", "0.32em")
			.attr("text-anchor", "end")
			.text(`${TIMELINE_START_GT} Gt`);

		const headersGroup = svg.append("g").attr("class", "sankey-stage-headers");
		renderStageHeaders(headersGroup, endGraph, 24);

		state.timelineRendered = {
			nodeSelection,
			linkSelection,
			startNodeOf,
			endNodeOf,
			startLinkOf,
			endLinkOf,
			linkPathFromGeom,
			axisLine,
			axisMarkerLabel,
			axisTopStart,
			axisTopEnd
		};

		drawTimeline(state.timelineProgress || 0);
	}

	// Drive the whole section from one scroll clock: crossfade the copy beats,
	// slide the year strip 2025 -> 2040 through the fixed box, and interpolate the
	// Sankey geometry between the 2025 and 2040A layouts (easeInOut).
	function drawTimeline(progress) {
		state.timelineProgress = progress;

		if (state.timelineLayoutEl) {
			state.timelineLayoutEl.style.opacity = String(windowProgress(progress, TL_OPEN_IN));
		}

		if (state.timelineCloseEl) {
			state.timelineCloseEl.style.opacity = String(windowProgress(progress, TL_CLOSE_IN));
		}

		const t = smoothstep(windowProgress(progress, TL_ANIM));

		const years = state.timelineYearEls;
		const yearsEl = state.timelineYearsEl;
		if (years && years.length && yearsEl && yearsEl.parentElement) {
			const center = yearsEl.parentElement.clientHeight / 2;
			const firstCenter = years[0].offsetTop + years[0].offsetHeight / 2;
			const lastCenter = years[years.length - 1].offsetTop + years[years.length - 1].offsetHeight / 2;
			const translateY = lerp(center - firstCenter, center - lastCenter, t);
			yearsEl.style.transform = `translateY(${translateY}px)`;
			const currentIdx = Math.round(t * (years.length - 1));
			years.forEach((el, index) => el.classList.toggle("is-current", index === currentIdx));
		}

		const r = state.timelineRendered;
		if (!r) {
			return;
		}

		r.nodeSelection.attr("transform", (d) => {
			const a = r.startNodeOf(d.id);
			const b = r.endNodeOf(d.id);
			return `translate(${lerp(a.x0, b.x0, t)},${lerp(a.y0, b.y0, t)})`;
		});
		r.nodeSelection
			.select("rect")
			.attr("width", (d) => {
				const a = r.startNodeOf(d.id);
				const b = r.endNodeOf(d.id);
				return lerp(Math.max(1, a.x1 - a.x0), Math.max(1, b.x1 - b.x0), t);
			})
			.attr("height", (d) => {
				const a = r.startNodeOf(d.id);
				const b = r.endNodeOf(d.id);
				return lerp(Math.max(3, a.y1 - a.y0), Math.max(3, b.y1 - b.y0), t);
			});
		r.nodeSelection.select("text").attr("y", (d) => {
			const a = r.startNodeOf(d.id);
			const b = r.endNodeOf(d.id);
			return lerp(Math.max(3, a.y1 - a.y0), Math.max(3, b.y1 - b.y0), t) / 2;
		});
		r.linkSelection
			.attr("d", (d) => {
				const a = r.startLinkOf(d.key);
				const b = r.endLinkOf(d.key);
				return r.linkPathFromGeom({
					sx: lerp(a.sx, b.sx, t),
					tx: lerp(a.tx, b.tx, t),
					y0: lerp(a.y0, b.y0, t),
					y1: lerp(a.y1, b.y1, t)
				});
			})
			.attr("stroke-width", (d) => {
				const a = r.startLinkOf(d.key);
				const b = r.endLinkOf(d.key);
				return Math.max(0.5, lerp(a.width, b.width, t));
			});

		if (r.axisLine && r.axisMarkerLabel) {
			const axisTopY = lerp(r.axisTopStart, r.axisTopEnd, t);
			const gtValue = Math.round(lerp(TIMELINE_START_GT, TIMELINE_END_GT, t) * 10) / 10;
			r.axisLine.attr("y2", axisTopY);
			r.axisMarkerLabel.attr("y", axisTopY).text(`${gtValue} Gt`);
		}
	}

	// Fades the pinned timeline content out (still pinned) over the final 40vh
	// before the section unpins, so #timeline is fully invisible before
	// .portfolio-intro's own crossfade begins.
	function drawTimelineFade(progress) {
		if (state.timelineLayoutEl) {
			state.timelineLayoutEl.style.opacity = String(1 - progress);
		}
	}

	function setupTimelineScroll() {
		const section = document.getElementById("timeline");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawTimeline(1);
			drawTimelineFade(1);
			return;
		}
		// GSAP's relative-offset shorthand ("bottom bottom+=92vh") doesn't
		// understand the vh unit — it parseFloat()s the number and treats it as
		// raw px, silently shrinking these to ~1/9th of the intended distance.
		// Compute the px offsets ourselves (as functions, so they stay correct
		// across invalidateOnRefresh/resize) instead.
		const vh = (fraction) => `${window.innerHeight * fraction}px`;

		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			// Finish the scrub 92vh before the section's actual (grown) bottom, so
			// the scrub timeline itself is unchanged and the extra 92vh becomes a
			// held final state (60vh static hold + 32vh fade-out below) before the
			// section unpins.
			end: () => `bottom bottom+=${vh(0.92)}`,
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawTimeline(self.progress),
			onRefresh: (self) => drawTimeline(self.progress)
		});
		drawTimeline(0);

		// After the 60vh static hold, scrub #timeline's own fade-out over the
		// final 32vh before the section unpins into the portfolio section.
		ScrollTrigger.create({
			trigger: section,
			start: () => `bottom bottom+=${vh(0.32)}`,
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawTimelineFade(self.progress),
			onRefresh: (self) => drawTimelineFade(self.progress)
		});
		drawTimelineFade(0);
	}

	function initTimelineSection() {
		if (!timelineChart) {
			return;
		}
		state.timelineCloseEl = document.querySelector("#timeline .timeline-closing");
		state.timelineLayoutEl = document.querySelector("#timeline .timeline-layout");

		const yearsEl = document.querySelector("#timeline .timeline-years");
		if (yearsEl && !yearsEl.childElementCount) {
			const fragment = document.createDocumentFragment();
			for (let year = 2025; year <= 2040; year += 1) {
				const el = document.createElement("div");
				el.className = "timeline-year";
				el.textContent = String(year);
				fragment.appendChild(el);
			}
			yearsEl.appendChild(fragment);
		}
		state.timelineYearsEl = yearsEl;
		state.timelineYearEls = yearsEl ? Array.from(yearsEl.children) : [];

		renderTimelineSankey();
		setupTimelineScroll();
	}

	function setupResize() {
		let frameId = null;
		const schedule = () => {
			if (frameId !== null) {
				cancelAnimationFrame(frameId);
			}
			frameId = requestAnimationFrame(() => {
				render();
				renderPortfolioSankey();
				renderScenarioSankey(window.currentScenarioId || "enacted-policies");
				// Once the visitor has taken over, the chart belongs to the normal
				// interactive renderer; before that it belongs to the walkthrough.
				if (state.impactsHandedOff) {
					renderImpactsSankey();
				} else {
					renderImpactsWalkChart();
				}
				measureImpactsWalkCopy();
				renderThemesSankey();
				renderTimelineSankey();
				measureNavProgressGeometry();
				frameId = null;
			});
		};

		if (window.ResizeObserver) {
			const ro = new ResizeObserver(schedule);
			ro.observe(chart);
		}
		window.addEventListener("resize", schedule);
	}

	function formatMass(valueMt) {
		if (valueMt >= 1000) {
			return `${fmtMt(valueMt / 1000)} Gt CO2e`;
		}
		return `${fmtMt(valueMt)} Mt CO2e`;
	}
})();
