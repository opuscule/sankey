(function () {
	const initPath = "init.json";
	const baselinesPath = "baselines.json";
	const defaultScenario = "2025";
	const chart = document.getElementById("sankey-chart");
	const portfolioChart = document.getElementById("portfolio-sankey-chart");
	const statusEl = document.getElementById("sankey-status");

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
		layoutProgress: 0,
		sankeyInteractive: false,
		portfolioRendered: null,
		portfolioBusinessNodeMap: new Map()
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

	loadAndRender().catch((err) => {
		console.error(err);
		statusEl.textContent = "Could not load Sankey data";
	});

	async function loadAndRender() {
		const [initResponse, baselinesResponse] = await Promise.all([
			fetch(initPath),
			fetch(baselinesPath)
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

		const sankeyExtentTop = 44;
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

		const expandedGraph = computeLayout(9);
		const collapsedGraph = derivePackedLayout(expandedGraph);

		const buildColumnStackedLayouts = (baseLayout, targetLayout) => {
			const columnKey = (node) => {
				if (Number.isFinite(node.depth)) {
					return `depth-${node.depth}`;
				}
				if (Number.isFinite(node.stage)) {
					return `stage-${node.stage}`;
				}
				return "col-unknown";
			};

			const targetColumns = d3.rollup(
				targetLayout.nodes,
				(nodes) => ({
					x0: d3.min(nodes, (node) => node.x0) ?? sankeyExtentLeft,
					x1: d3.max(nodes, (node) => node.x1) ?? sankeyExtentLeft + 20
				}),
				(node) => columnKey(node)
			);

			const orderedColumns = Array.from(targetColumns.entries())
				.sort((a, b) => a[1].x0 - b[1].x0)
				.map(([column]) => column);

			const anchorX0 = d3.min(targetLayout.nodes, (node) => node.x0) ?? sankeyExtentLeft;
			const typicalColumnWidth =
				d3.median(Array.from(targetColumns.values()), (column) => Math.max(1, column.x1 - column.x0)) ??
				20;
			const anchorX1 = anchorX0 + typicalColumnWidth;
			const sharedY0 = d3.min(baseLayout.nodes, (node) => node.y0) ?? sankeyExtentTop;
			const sharedY1 = d3.max(baseLayout.nodes, (node) => node.y1) ?? sankeyExtentBottom;

			const remapLayout = (mode) => {
				const remappedNodes = baseLayout.nodes.map((node) => {
					const column = columnKey(node);
					const targetColumn = targetColumns.get(column) || { x0: anchorX0, x1: anchorX1 };

					if (mode === "start") {
						return {
							...node,
							x0: anchorX0,
							x1: anchorX1,
							y0: sharedY0,
							y1: sharedY1
						};
					}

					return {
						...node,
						x0: targetColumn.x0,
						x1: targetColumn.x1,
						y0: sharedY0,
						y1: sharedY1
					};
				});

				const remappedNodeById = new Map(remappedNodes.map((node) => [node.id, node]));
				const remappedLinks = baseLayout.links.map((link) => {
					const source = remappedNodeById.get(link.source.id);
					const target = remappedNodeById.get(link.target.id);
					if (!source || !target) {
						return {
							...link
						};
					}
					const sourceOffset = link.y0 - link.source.y0;
					const targetOffset = link.y1 - link.target.y0;

					return {
						...link,
						source,
						target,
						y0: source.y0 + sourceOffset,
						y1: target.y0 + targetOffset
					};
				});

				return {
					nodes: remappedNodes,
					links: remappedLinks
				};
			};

			return {
				stacked: remapLayout("start"),
				horizontal: remapLayout("end"),
				columnOrder: orderedColumns
			};
		};

		const introLayouts = buildColumnStackedLayouts(collapsedGraph, expandedGraph);

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

		const nodeIntroStartMap = new Map(introLayouts.stacked.nodes.map((node) => [node.id, node]));
		const nodeIntroEndMap = new Map(introLayouts.horizontal.nodes.map((node) => [node.id, node]));
		const nodeEndMap = new Map(expandedGraph.nodes.map((node) => [node.id, node]));
		const linkIntroStartMap = new Map(introLayouts.stacked.links.map((link) => [link.id, link]));
		const linkIntroEndMap = new Map(introLayouts.horizontal.links.map((link) => [link.id, link]));
		const linkEndMap = new Map(expandedGraph.links.map((link) => [link.id, link]));

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

		const lerp = (start, end, progress) => start + (end - start) * progress;
		const fadeIn = (progress, start = 0.08, span = 0.32) =>
			Math.max(0, Math.min(1, (progress - start) / span));

		const setSankeyInteraction = (enabled) => {
			if (state.sankeyInteractive === enabled) {
				return;
			}

			state.sankeyInteractive = enabled;
			chart.style.pointerEvents = enabled ? "auto" : "none";

			if (!state.selectedNodeId) {
				statusEl.textContent = enabled
					? "Click a node to isolate direct flows"
					: "Scroll to expand Sankey";
			}
		};

		const drawLayout = (progress) => {
			const clamped = Math.max(0, Math.min(1, progress));
			state.layoutProgress = clamped;
			setSankeyInteraction(clamped >= 0.999);

			const introPhase = clamped < 0.5;
			const introRawProgress = clamped / 0.5;
			const introEasedProgress = Math.max(0, Math.min(1, Math.pow(introRawProgress, 3)));
			const phaseProgress = introPhase ? introEasedProgress : (clamped - 0.5) / 0.5;
			const activeNodeStartMap = introPhase ? nodeIntroStartMap : nodeIntroEndMap;
			const activeNodeEndMap = introPhase ? nodeIntroEndMap : nodeEndMap;
			const activeLinkStartMap = introPhase ? linkIntroStartMap : linkIntroEndMap;
			const activeLinkEndMap = introPhase ? linkIntroEndMap : linkEndMap;

			nodeSelection.each(function (nodeDatum) {
				const startNode = activeNodeStartMap.get(nodeDatum.id);
				const endNode = activeNodeEndMap.get(nodeDatum.id);
				if (!startNode || !endNode) {
					return;
				}

				const x0 = lerp(startNode.x0, endNode.x0, phaseProgress);
				const x1 = lerp(startNode.x1, endNode.x1, phaseProgress);
				const y0 = introPhase ? startNode.y0 : lerp(startNode.y0, endNode.y0, phaseProgress);
				const y1 = introPhase ? startNode.y1 : lerp(startNode.y1, endNode.y1, phaseProgress);
				const nodeWidth = Math.max(1, x1 - x0);
				const nodeHeight = Math.max(3, y1 - y0);

				const nodeGroup = d3.select(this);
				nodeGroup.attr("transform", `translate(${x0},${y0})`);
				nodeGroup.select("rect").attr("width", nodeWidth).attr("height", nodeHeight);
				nodeGroup
					.select("text")
					.attr("x", x0 < width / 2 ? nodeWidth + 7 : -7)
					.attr("y", nodeHeight / 2)
					.attr("text-anchor", x0 < width / 2 ? "start" : "end");
			});

			const linkOpacity = introPhase ? 0 : fadeIn(phaseProgress, 0.06, 0.3);
			const labelOpacity = introPhase ? 0 : fadeIn(phaseProgress, 0.16, 0.28);

			linkPaths.style("opacity", linkOpacity);
			nodeSelection.select("text").style("opacity", labelOpacity);

			linkPaths.each(function (linkDatum) {
				const startLink = activeLinkStartMap.get(linkDatum.id);
				const endLink = activeLinkEndMap.get(linkDatum.id);
				if (!startLink || !endLink) {
					return;
				}

				const startSource = activeNodeStartMap.get(startLink.source.id);
				const endSource = activeNodeEndMap.get(endLink.source.id);
				const startTarget = activeNodeStartMap.get(startLink.target.id);
				const endTarget = activeNodeEndMap.get(endLink.target.id);
				if (!startSource || !endSource || !startTarget || !endTarget) {
					return;
				}

				const pathDatum = {
					source: {
						x0: lerp(startSource.x0, endSource.x0, phaseProgress),
						x1: lerp(startSource.x1, endSource.x1, phaseProgress),
						y0: lerp(startSource.y0, endSource.y0, phaseProgress),
						y1: lerp(startSource.y1, endSource.y1, phaseProgress)
					},
					target: {
							x0: lerp(startTarget.x0, endTarget.x0, phaseProgress),
							x1: lerp(startTarget.x1, endTarget.x1, phaseProgress),
							y0: lerp(startTarget.y0, endTarget.y0, phaseProgress),
							y1: lerp(startTarget.y1, endTarget.y1, phaseProgress)
					},
					y0: lerp(startLink.y0, endLink.y0, phaseProgress),
					y1: lerp(startLink.y1, endLink.y1, phaseProgress)
				};

				d3.select(this)
					.attr("d", d3.sankeyLinkHorizontal()(pathDatum))
					.attr("stroke-width", Math.max(1, lerp(startLink.width, endLink.width, phaseProgress)));
			});
		};

		drawLayout(prefersReducedMotion ? 1 : 0);
		if (prefersReducedMotion) {
			setSankeyInteraction(true);
		}

		let layoutScrollTrigger = null;
		if (!prefersReducedMotion && window.gsap && window.ScrollTrigger) {
			ScrollTrigger.matchMedia({
				"(max-width: 900px)": () => {
					drawLayout(1);
					setSankeyInteraction(true);
				},
				"(min-width: 901px)": () => {
					drawLayout(0);
					setSankeyInteraction(false);

					const motionState = { progress: 0 };
					const tween = gsap.to(motionState, {
						progress: 1,
						ease: "none",
						paused: true,
						onUpdate: () => drawLayout(motionState.progress)
					});

					layoutScrollTrigger = ScrollTrigger.create({
						trigger: "#sankey-narrative",
						start: "top top",
						end: "bottom bottom",
						scrub: true,
						invalidateOnRefresh: true,
						onUpdate: (self) => {
							tween.progress(self.progress);
						}
					});

					return () => {
						tween.kill();
						if (layoutScrollTrigger) {
							layoutScrollTrigger.kill();
							layoutScrollTrigger = null;
						}
					};
				}
			});
		} else if (!prefersReducedMotion) {
			drawLayout(1);
			setSankeyInteraction(true);
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
