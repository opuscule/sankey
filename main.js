(function () {
	const initPath = "init.json";
	const baselinesPath = "baselines.json";
	const defaultScenario = "2025";
	const chart = document.getElementById("sankey-chart");
	const portfolioChart = document.getElementById("portfolio-sankey-chart");
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
			phase: "origin-hold",
			start: 9,
			end: 15,
			copy: "Transitioning to a low-carbon economy requires understanding the origin of these emissions."
		},
		{
			id: "beat-3",
			phase: "seven-bars",
			start: 15,
			end: 21,
			copy: "The same total emissions can be viewed through seven different lenses."
		},
		{
			id: "beat-4",
			phase: "final-services",
			start: 21,
			end: 29,
			copy: 'These lenses include the <span class="kw kw-final-service">final services</span> provided to us, such as travel and food.'
		},
		{
			id: "beat-5",
			phase: "title-reveal",
			start: 29,
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
			copy: "Emissions can be <strong>traced between domains</strong> as they <strong>flow through the global economy</strong>."
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
	const NARRATIVE_SCROLL_DISTANCE = 11000;

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
			const globalPercent = progress * 100;
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
		"5_Waste": "5_(Waste)"
	};

	const state = {
		nodes: [],
		links: [],
		selectedNodeId: null,
		rendered: null,
		sankeyInteractive: false,
		portfolioRendered: null,
		portfolioBusinessNodeMap: new Map(),
		introAssets: null
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
		setupPortfolioBusinessSync();
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

		const defs = svg.append("defs");
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

			const gradient = defs
				.append("linearGradient")
				.attr("id", portfolioLinkGradientId(sourceStage, targetStage))
				.attr("x1", "0%")
				.attr("y1", "0%")
				.attr("x2", "100%")
				.attr("y2", "0%");

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
			.attr("x", (d) => (d.x0 < width / 2 ? Math.max(1, d.x1 - d.x0) + 7 : -7))
			.attr("y", (d) => Math.max(3, d.y1 - d.y0) / 2)
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.x0 < width / 2 ? "start" : "end"))
			.text((d) => d.label);

		state.portfolioRendered = {
			nodeSelection,
			linkSelection,
			graph
		};

		applyPortfolioBusinessHighlight(window.currentPortfolioBusinessId || "fervo");
	}

	function setupPortfolioBusinessSync() {
		document.addEventListener("portfolio-business-change", (event) => {
			applyPortfolioBusinessHighlight(event?.detail?.businessId);
		});
	}

	function applyPortfolioBusinessHighlight(rawBusinessId) {
		if (!state.portfolioRendered) {
			return;
		}

		const businessId = normalizeBusinessSlug(rawBusinessId);
		if (!supportedPortfolioBusinesses.has(businessId)) {
			return;
		}

		const nodeId = state.portfolioBusinessNodeMap.get(businessId);
		const { nodeSelection, linkSelection, graph } = state.portfolioRendered;

		if (!nodeId) {
			linkSelection
				.classed("portfolio-is-highlight", false)
				.classed("portfolio-is-muted", false);
			nodeSelection
				.classed("portfolio-is-highlight", false)
				.classed("portfolio-is-muted", false);
			return;
		}

		const connectedLinks = graph.links.filter(
			(link) => link.source.id === nodeId || link.target.id === nodeId
		);
		const connectedNodeIds = new Set([nodeId]);
		for (const link of connectedLinks) {
			connectedNodeIds.add(link.source.id);
			connectedNodeIds.add(link.target.id);
		}

		linkSelection
			.classed("portfolio-is-highlight", (link) =>
				link.source.id === nodeId || link.target.id === nodeId
			)
			.classed("portfolio-is-muted", (link) =>
				!(link.source.id === nodeId || link.target.id === nodeId)
			);

		nodeSelection
			.classed("portfolio-is-highlight", (node) => connectedNodeIds.has(node.id))
			.classed("portfolio-is-muted", (node) => !connectedNodeIds.has(node.id));
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

			const gradient = defs
				.append("linearGradient")
				.attr("id", linkGradientId(sourceStage, targetStage))
				.attr("x1", "0%")
				.attr("y1", "0%")
				.attr("x2", "100%")
				.attr("y2", "0%");

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

				introCards.push({ stage, mark, barRect, photo, clipRect, photoGeom, barScreen });
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
				const anchorStart = opts.forceStartAnchor || x0 < width / 2;

				const nodeGroup = d3.select(this);
				nodeGroup.attr("transform", `translate(${x0},${y0})`);
				nodeGroup.select("rect").attr("width", nodeWidth).attr("height", nodeHeight);
				nodeGroup
					.select("text")
					.attr("x", anchorStart ? nodeWidth + 7 : -7)
					.attr("y", nodeHeight / 2)
					.attr("text-anchor", anchorStart ? "start" : "end");
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
			const p = clamp01(progress);
			const B = SCENE_BOUNDS;
			const tSeven = sceneT(p, "seven-bars");
			const tReveal = sceneT(p, "title-reveal");
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

				introCards.forEach((card) => {
					const { stage, photoGeom, barScreen } = card;

					// Photo strip growth: emissions card in scene 1, the rest
					// staggered left-to-right in scene 3.
					let grow;
					if (stage === 7) {
						grow = smoothstep(sceneT(p, "one-bar"));
					} else {
						const startOffset = ((stage - 1) / 6) * 0.6;
						grow = smoothstep(clamp01((tSeven - startOffset) / 0.4));
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
							ease: "power2.inOut",
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
			layoutScrollTrigger
		};

		applySelection();
	}

	function applySelection() {
		if (!state.rendered) {
			return;
		}

		const { nodeSelection, linkSelection, graph } = state.rendered;

		if (!state.selectedNodeId) {
			linkSelection.classed("is-faded", false).classed("is-active", false);
			nodeSelection.classed("is-faded", false).classed("is-selected", false);
			statusEl.textContent = "Click a node to isolate direct flows";
			return;
		}

		const selectedId = state.selectedNodeId;
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

	function setupResize() {
		let frameId = null;
		const schedule = () => {
			if (frameId !== null) {
				cancelAnimationFrame(frameId);
			}
			frameId = requestAnimationFrame(() => {
				render();
				renderPortfolioSankey();
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
