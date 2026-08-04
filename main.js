(function () {
	const initPath = "init.json";
	const baselinesPath = "baselines.json";
	const nodeDetailsPath = "node_details.json";
	const avoidedPath = "avoided.json";
	const themesDataPath = "init-demo.json";
	const defaultScenario = "2025";
	const chart = document.getElementById("sankey-chart");
	const portfolioChart = document.getElementById("portfolio-sankey-chart");
	const scenarioChart = document.getElementById("scenario-sankey-chart");
	const impactsChart = document.getElementById("impacts-sankey-chart");
	const impactsExampleChart = document.getElementById("impacts-example-chart");
	const themesChart = document.getElementById("themes-sankey-chart");
	const timelineChart = document.getElementById("timeline-sankey-chart");
	const statusEl = document.getElementById("sankey-status");

	// --- Shared math helpers --------------------------------------------------
	const lerp = (start, end, progress) => start + (end - start) * progress;
	const clamp01 = (value) => Math.max(0, Math.min(1, value));
	const smoothstep = (value) => {
		const t = clamp01(value);
		return t * t * (3 - 2 * t);
	};

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
			copy: '<span class="headline-accent">Global emissions in 2025:</span><br /><span class="headline-plain">54 gigatons CO2e</span>'
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
			copy: "The same total emissions can be viewed through seven different lenses."
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
			copy: 'Flows between neighboring nodes show how <strong>emissions are connected across lenses</strong>, with the width of the flow reflecting the magnitude of such connections. For example, of the 6 Gt CO2e due to <span class="kw kw-sector">Passenger Transport</span>, 4.4 Gt are due to <span class="kw kw-equipment">cars</span>.'
		},
		{
			id: "beat-11",
			phase: "explore",
			start: 96,
			end: 100,
			copy: "Select any node for yourself to see how it connects to others."
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
	const NARRATIVE_SCROLL_DISTANCE = 13000;

	// The final HOLD_TAIL fraction of the section is a pinned hold on the
	// finished interactive chart — the user keeps scrolling but nothing moves,
	// emphasizing that the Sankey is now theirs to explore before the page
	// releases to the next section. Scene windows map onto the first
	// (1 - HOLD_TAIL) of the scroll.
	const HOLD_TAIL = 0.15;
	const ANIM_SPAN = 1 - HOLD_TAIL;

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
		const narrativeSection = document.getElementById("sankey-narrative");
		const copyContainer = narrativeSection
			? narrativeSection.querySelector(".sankey-copy")
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

	const supportedPortfolioBusinesses = new Set([
		"fervo",
		"propel-aero",
		"electric-hydrogen",
		"redwood-materials"
	]);

	const impactsLogoByBusiness = {
		"fervo": "logos/fervo-logo.png",
		"propel-aero": "logos/propel-aero-logo.png",
		"electric-hydrogen": "logos/electric-hydrogen-logo.png",
		"redwood-materials": "logos/redwood-materials-logo.png"
	};

	const impactsLogoFallback = "https://placehold.co/240x60?text=logo";

	const impactsNodeLabelByBusiness = {
		"fervo": "Electricty and heat",
		"propel-aero": "Plane"
	};

	const scenarioKeyById = {
		"enacted-policies": "2040A",
		"stated-commitments": "2040B",
		"high-ai-electricity-demand": "2040C"
	};
	const warnedMissingScenarioKeys = new Set();

	// Total 2040 emissions (GT) per scenario, matching the on-page copy. Drives
	// the scenario Sankey's vertical scale: the tallest scenario (60 GT) fills the
	// full chart height and lower-total scenarios shrink proportionally, so column
	// height reads as an absolute GT quantity instead of always filling the frame.
	// `null` = not yet defined (renders at full height as a neutral fallback).
	const scenarioTotalsGt = {
		"enacted-policies": 60,
		"stated-commitments": 46,
		"high-ai-electricity-demand": null
	};
	const SCENARIO_MAX_GT = 60;

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
	const IMPACTS_EXAMPLE_BUSINESS_ID = "fervo";

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
	// Each {slug}.svg bundles one 20-unit-wide bar subpath ("M{x} {y}h20v{h}h-20z")
	// with the wordmark letterforms, all in a single fill. We split the bar out at
	// parse time so the bar rect can morph independently of the wordmark, and
	// recolor everything with the official palette CSS vars (the shipped asset
	// fills are slightly off-palette).
	async function loadIntroAssets() {
		const parser = new DOMParser();
		const barPattern = /M([\d.]+)[ ,]([\d.]+)h20v([\d.]+)h-20z/;

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

					let bar = null;
					const markPaths = [];
					doc.querySelectorAll("path").forEach((path) => {
						let d = path.getAttribute("d") || "";
						if (!bar) {
							const match = d.match(barPattern);
							if (match) {
								bar = {
									x: Number.parseFloat(match[1]),
									y: Number.parseFloat(match[2]),
									width: 20,
									height: Number.parseFloat(match[3])
								};
								d = d.replace(match[0], "").trim();
							}
						}
						if (d) {
							markPaths.push(d);
						}
					});

					if (!bar) {
						throw new Error("bar subpath not found");
					}

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
		renderImpactsSankey();
		renderImpactsExampleSankey();
		setupPortfolioBusinessSync();
		setupScenarioSync();
		setupLeadFades();
		setupScenarioLeadFades();
		setupImpactsScroll();
		initThemesSection();
		initTimelineSection();
		setupResize();
		statusEl.textContent = "Click a node to isolate direct flows";
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
		for (const businessId of supportedPortfolioBusinesses) {
			map.set(businessId, null);
		}

		const companies = initData?.intervention?.companies;
		if (!Array.isArray(companies)) {
			return map;
		}

		for (const company of companies) {
			const candidates = [company?.company, company?.company_label];
			let businessId = "";
			for (const candidate of candidates) {
				const normalized = normalizeBusinessSlug(candidate);
				if (supportedPortfolioBusinesses.has(normalized)) {
					businessId = normalized;
					break;
				}
			}

			if (!businessId) {
				continue;
			}

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

		const tickData = Object.values(scenarioTotalsGt).filter((gt) => Number.isFinite(gt));
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

		applyScenarioHighlight(scenarioRequest.scenarioId);
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

	function pairValueMap(links) {
		const map = new Map();
		for (const link of links) {
			const key = `${link.source.id}|${link.target.id}`;
			map.set(key, Number(link.value) || 0);
		}
		return map;
	}

	function applyScenarioHighlight(rawScenarioId) {
		if (!state.scenarioRendered) {
			return;
		}

		const scenarioId = Object.prototype.hasOwnProperty.call(scenarioKeyById, rawScenarioId)
			? rawScenarioId
			: state.scenarioRendered.scenarioId;
		const { nodeSelection, linkSelection, graph, baselineGraph } = state.scenarioRendered;

		if (scenarioId === "enacted-policies") {
			clearScenarioHighlight(linkSelection, nodeSelection);
			return;
		}

		const baselinePairs = pairValueMap(baselineGraph.links);
		const selectedPairs = pairValueMap(graph.links);

		const relevantPairs = new Set();
		for (const [pair, selectedValue] of selectedPairs.entries()) {
			const baselineValue = baselinePairs.get(pair) || 0;
			const delta = selectedValue - baselineValue;
			if (scenarioId === "stated-commitments" && delta < -0.05) {
				relevantPairs.add(pair);
			}
			if (scenarioId === "high-ai-electricity-demand" && delta > 0.05) {
				relevantPairs.add(pair);
			}
		}

		if (!relevantPairs.size) {
			clearScenarioHighlight(linkSelection, nodeSelection);
			return;
		}

		const relevantNodes = new Set();
		for (const pair of relevantPairs) {
			const [sourceId, targetId] = pair.split("|");
			relevantNodes.add(sourceId);
			relevantNodes.add(targetId);
		}

		const isRelevant = (link) => relevantPairs.has(`${link.source.id}|${link.target.id}`);
		linkSelection
			.classed("scenario-is-highlight", isRelevant)
			.classed("scenario-is-muted", (link) => !isRelevant(link));
		nodeSelection
			.classed("scenario-is-highlight", (node) => relevantNodes.has(node.id))
			.classed("scenario-is-muted", (node) => !relevantNodes.has(node.id));
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

	function renderImpactsExampleSankey() {
		return renderImpactsChart(impactsExampleChart, {
			businessId: IMPACTS_EXAMPLE_BUSINESS_ID,
			scenarioId: IMPACTS_SCENARIO_ID,
			storeInState: false,
			waitForAvoidedData: true
		});
	}

	function findNodeLabelById(nodeId) {
		if (!nodeId || !Array.isArray(state.initData?.nodes)) {
			return "";
		}
		const node = state.initData.nodes.find((entry) => String(entry?.id || "").trim() === nodeId);
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

	function avoidedTotalForCompany(companyKey, scenarioKey) {
		const company = state.avoidedData?.[companyKey];
		const rawLinks = Array.isArray(company?.links) ? company.links : [];
		return rawLinks.reduce((sum, link) => {
			const value = toFiniteNumber(link?.[scenarioKey]?.value, 0);
			return value > 0 ? sum + value : sum;
		}, 0);
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
		const technologyLabel =
			String(selection.technologyLabel || "").trim() ||
			String(selection.themeLabel || "").trim() ||
			"This technology";

		if (selection.businessId && !state.avoidedData) {
			card.logo.src = logoSrc;
			card.logo.alt = `${selection.label} logo`;
			card.sentence.innerHTML =
				`When deployed at a transformative scale, ${technologyLabel} has the potential to reduce global emissions by ` +
				`<strong class="impacts-company-card__sentence-accent">loading...</strong> in 2040.`;
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
			card.sentence.innerHTML =
				`When deployed at a transformative scale, ${technologyLabel} has the potential to reduce global emissions by ` +
				`<strong class="impacts-company-card__sentence-accent">${sentenceAmountText}</strong> in 2040.`;
			if (card.nodeSavings) {
				card.nodeSavings.textContent = nodeSavingsText;
			}
		} else {
			card.sentence.innerHTML =
				`When deployed at a transformative scale, ${technologyLabel} has the potential to reduce global emissions by ` +
				`<strong class="impacts-company-card__sentence-accent">data pending</strong> in 2040.`;
			if (card.nodeSavings) {
				card.nodeSavings.textContent = nodeSavingsText;
			}
		}

		card.prompt.hidden = true;
		card.content.hidden = false;
		card.root.classList.add("is-active");
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
		renderImpactsSankey();
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
				nodePercentage: cardRoot.querySelector("[data-impacts-card-node-percentage]")
			};

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

	// Keep the full Climate Impacts two-column layout pinned for one extra
	// viewport of scroll once it reaches the top of the screen.
	function setupImpactsScroll() {
		const layoutEl = document.querySelector(".impacts-layout");
		if (!layoutEl) {
			return;
		}

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
			return;
		}

		ScrollTrigger.matchMedia({
			"(min-width: 901px)": () => {
				const pinST = ScrollTrigger.create({
					trigger: layoutEl,
					pin: layoutEl,
					start: "top top",
					end: "+=100%",
					pinSpacing: true,
					invalidateOnRefresh: true
				});

				return () => {
					pinST.kill();
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
								start: "top 85%",
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
								start: "top 82%",
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

			for (let stage = 1; stage <= 7; stage += 1) {
				const meta = STAGE_META[stage];
				const asset = state.introAssets?.get(stage) || null;
				const cx = groupLeft + (stage - 1) * slotGap;
				const scale = extentH / (asset ? asset.viewBox.height : 412);
				const barW = 20 * scale;

				const card = introGroup.append("g").attr("class", `intro-card intro-card-stage-${stage}`);

				let mark = null;
				let barScreen;
				if (asset) {
					barScreen = {
						x: cx - barW / 2,
						y: cardTop + asset.bar.y * scale,
						w: barW,
						h: asset.bar.height * scale
					};
					if (asset.markPaths.length) {
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
				} else {
					barScreen = {
						x: cx - barW / 2,
						y: cardTop + extentH * 0.45,
						w: barW,
						h: extentH * 0.55
					};
				}

				const barRect = card
					.append("rect")
					.attr("class", "intro-card-bar")
					.attr("fill", `var(${stageColorVars[stage]})`)
					.attr("x", barScreen.x)
					.attr("y", barScreen.y)
					.attr("width", barScreen.w)
					.attr("height", barScreen.h)
					.style("opacity", 0);

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

		const setSankeyInteraction = (enabled) => {
			if (state.sankeyInteractive === enabled) {
				return;
			}

			state.sankeyInteractive = enabled;
			chart.style.pointerEvents = enabled ? "auto" : "none";
			chart.classList.toggle("is-interactive", enabled);

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
	// A scroll-driven walk through the four portfolio themes. On entry the roster
	// is dimmed and the themes Sankey is dark; each theme's scroll window lights
	// its companies and their nodes, then resets before the next theme.
	const THEME_ORDER = [
		"IndustrialProcessesAndMaterials",
		"Electrification",
		"CleanEnergyGeneration",
		"EnergyEfficiency"
	];

	// Scroll budget (vh) that composes #portfolio-themes min-height (1280vh in CSS).
	// After the 4-theme walk the section keeps the layout pinned for a finale:
	// fade the lead copy out, re-light every company/node, sweep the links in,
	// then a plain hold before the sticky layout releases.
	const THEMES_TRAVEL_VH = 780; // four-theme walk
	const FINALE_LEAD_FADE_VH = 60; // "Consider four themes" fade-out
	const FINALE_ANIM_VH = 240; // 0-100 finale timeline
	const FINALE_HOLD_VH = 100; // pinned hold before unpin
	const THEMES_SCROLL_VH =
		THEMES_TRAVEL_VH + FINALE_LEAD_FADE_VH + FINALE_ANIM_VH + FINALE_HOLD_VH;
	const P_THEMES_END = THEMES_TRAVEL_VH / THEMES_SCROLL_VH;
	const P_LEAD_END = (THEMES_TRAVEL_VH + FINALE_LEAD_FADE_VH) / THEMES_SCROLL_VH;
	const P_FINALE_END =
		(THEMES_TRAVEL_VH + FINALE_LEAD_FADE_VH + FINALE_ANIM_VH) / THEMES_SCROLL_VH;

	const THEME_BLURBS = {
		IndustrialProcessesAndMaterials:
			"Companies focused on industrial processes and materials tend to be concentrated within the industrial sectors of the global economy and are working to lower the emissions of producing essential materials like cement and steel.",
		Electrification:
			"Companies focused on electrification are concentrated within the transportation and building energy use parts of the global economy and are working to transition key equipment like planes, trucks, and residential heating and cooling systems to electric versions.",
		CleanEnergyGeneration:
			"Companies focused on clean energy generation are all concentrated within electricity and heat generation and are working to generate low emissions electricity and heat that flows through the global economy.",
		EnergyEfficiency:
			"Companies focused on energy efficiency tend to be concentrated within the digital parts of the global economy and are working to reduce the energy requirements of equipment like electronics, computing infrastructure, and the grid."
	};

	// init-demo.json is the demo roster (24 companies tagged by theme). It is only
	// used by this section, so fetch it lazily and cache the parsed result.
	function ensureThemesData() {
		if (state.themesData) {
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

	// Group the demo companies by theme, preserving THEME_ORDER, and strip the
	// leading "_" that marks fake companies from their display labels.
	function buildThemesModel(data) {
		const companies = data?.intervention?.companies;
		if (!Array.isArray(companies)) {
			return [];
		}
		const byTheme = new Map();
		companies.forEach((company) => {
			const slug = String(company?.theme || "").trim();
			if (!slug) {
				return;
			}
			if (!byTheme.has(slug)) {
				byTheme.set(slug, {
					slug,
					label: String(company?.theme_label || slug).trim(),
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
			theme.companies.push({
				label,
				nodeId,
				technologyLabel,
				businessId: normalizeBusinessSlug(company?.company || company?.company_label)
			});
			if (nodeId) {
				theme.nodeIds.add(nodeId);
			}
		});
		const ordered = THEME_ORDER.filter((slug) => byTheme.has(slug)).concat(
			Array.from(byTheme.keys()).filter((slug) => !THEME_ORDER.includes(slug))
		);
		return ordered.map((slug) => {
			const theme = byTheme.get(slug);
			theme.blurb = THEME_BLURBS[slug] || "";
			return theme;
		});
	}

	// Build the left-column info blocks and the four persistent roster columns,
	// caching element references on the model for the scroll handler to toggle.
	function renderThemesRoster(model) {
		const infoWrap = document.querySelector(".themes-info");
		const rosterWrap = document.querySelector(".themes-roster");
		if (!infoWrap || !rosterWrap) {
			return;
		}
		infoWrap.innerHTML = "";
		rosterWrap.innerHTML = "";
		model.forEach((theme) => {
			const info = document.createElement("div");
			info.className = "themes-info__block";
			info.dataset.theme = theme.slug;
			info.style.opacity = "0";
			const infoTitle = document.createElement("h3");
			infoTitle.className = "themes-info__title";
			infoTitle.textContent = theme.label;
			const infoBody = document.createElement("p");
			infoBody.className = "themes-info__body";
			infoBody.textContent = theme.blurb;
			info.append(infoTitle, infoBody);
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

	// Split scroll progress into four equal theme windows. Within the active
	// window: fade the theme copy in/out, brighten its roster column, and reveal
	// its companies (and their nodes) in a staggered rapid-fire sequence. Non-
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
		const revealSpan = 0.52;
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
		const total = active.companies.length;
		const stagger = total > 1 ? revealSpan / total : 0;
		const nodeLit = new Map();
		active.companies.forEach((company, index) => {
			const startT = revealStart + index * stagger;
			const lit = smoothstep(clamp01((local - startT) / perCompanyFade)) * presence;
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

	// --- Timeline section (2025 -> 2040 scroll morph) -------------------------
	// The right-column Sankey morphs from the 2025 baseline to the 2040A scenario
	// while the left column slides a year strip 2025 -> 2040. We have no per-year
	// data, so both endpoints are laid out independently and every node/link is
	// linearly interpolated between them (easeInOut over the scroll range).
	const TIMELINE_TARGET_SCENARIO = "2040A";
	// Scroll windows as fractions of the #timeline scroll range (section ~320vh).
	const TL_HEAD_IN = [0.0, 0.06];
	const TL_HEAD_OUT = [0.22, 0.3];
	const TL_PANEL_IN = [0.24, 0.32];
	const TL_ANIM = [0.32, 0.9]; // sankey morph + year slide (~180vh of 320vh)
	const TL_CLOSE_IN = [0.8, 0.9];
	// Bottom-pinned growth: the 2025 chart fills TL_START_FRAC of the band height
	// and grows to TL_END_FRAC (full) by 2040, so the rising envelope reads as the
	// rising emissions total. Tunable; could instead be derived from GT totals.
	const TL_START_FRAC = 0.84;
	const TL_END_FRAC = 1;

	const windowProgress = (value, [start, end]) => clamp01((value - start) / (end - start || 1));

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
			return graph;
		};

		const startGraph = layoutGraph(defaultScenario); // 2025
		const endGraph = layoutGraph(TIMELINE_TARGET_SCENARIO); // 2040A

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

		const headersGroup = svg.append("g").attr("class", "sankey-stage-headers");
		renderStageHeaders(headersGroup, endGraph, 24);

		state.timelineRendered = {
			nodeSelection,
			linkSelection,
			startNodeOf,
			endNodeOf,
			startLinkOf,
			endLinkOf,
			linkPathFromGeom
		};

		drawTimeline(state.timelineProgress || 0);
	}

	// Drive the whole section from one scroll clock: crossfade the copy beats,
	// slide the year strip 2025 -> 2040 through the fixed box, and interpolate the
	// Sankey geometry between the 2025 and 2040A layouts (easeInOut).
	function drawTimeline(progress) {
		state.timelineProgress = progress;

		if (state.timelineHeadEl) {
			const headIn = windowProgress(progress, TL_HEAD_IN);
			const headOut = windowProgress(progress, TL_HEAD_OUT);
			state.timelineHeadEl.style.opacity = String(headIn * (1 - headOut));
		}
		if (state.timelinePanelEl) {
			state.timelinePanelEl.style.opacity = String(windowProgress(progress, TL_PANEL_IN));
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
	}

	function setupTimelineScroll() {
		const section = document.getElementById("timeline");
		if (!section) {
			return;
		}
		if (!window.gsap || !window.ScrollTrigger) {
			drawTimeline(1);
			return;
		}
		ScrollTrigger.create({
			trigger: section,
			start: "top top",
			end: "bottom bottom",
			scrub: 0.5,
			invalidateOnRefresh: true,
			onUpdate: (self) => drawTimeline(self.progress),
			onRefresh: (self) => drawTimeline(self.progress)
		});
		drawTimeline(0);
	}

	function initTimelineSection() {
		if (!timelineChart) {
			return;
		}
		state.timelineHeadEl = document.querySelector("#timeline .timeline-headline");
		state.timelinePanelEl = document.querySelector("#timeline .timeline-panel");
		state.timelineCloseEl = document.querySelector("#timeline .timeline-closing");

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
				renderImpactsSankey();
				renderImpactsExampleSankey();
				renderThemesSankey();
				renderTimelineSankey();
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
