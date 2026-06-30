(function () {
	const csvPath = "exchange-matrix-2025-06172026.csv";
	const chart = document.getElementById("sankey-chart");
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

	const state = {
		nodes: [],
		links: [],
		selectedNodeId: null,
		rendered: null,
		layoutProgress: 0,
		sankeyInteractive: false
	};

	const fmtMt = d3.format(",.2f");
	const fmtPct = d3.format(".2f");
	const linkGradientId = (sourceStage, targetStage) => `link-gradient-${sourceStage}-${targetStage}`;
	const classSlug = (value) =>
		String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown";

	loadAndRender().catch((err) => {
		console.error(err);
		statusEl.textContent = "Could not load Sankey data";
	});

	async function loadAndRender() {
		const response = await fetch(csvPath);
		if (!response.ok) {
			throw new Error(`Failed to fetch ${csvPath}: ${response.status}`);
		}

		const csvText = await response.text();
		const rows = d3.csvParse(csvText);

		const graph = buildGraph(rows);
		state.nodes = graph.nodes;
		state.links = graph.links;

		if (!state.nodes.length || !state.links.length) {
			statusEl.textContent = "No positive flows found in CSV";
			return;
		}

		render();
		setupResize();
		statusEl.textContent = "Click a node to isolate direct flows";
	}

	function buildGraph(rows) {
		const nodeMap = new Map();
		const links = [];

		for (const row of rows) {
			const rawSource = (row.source || "").trim();
			const rawTarget = (row.target || "").trim();
			const value = Number.parseFloat(row.value || "0");
			if (!rawSource || !rawTarget || !Number.isFinite(value) || value <= 0) {
				continue;
			}

			const sourceMeta = parseNode(rawSource);
			const targetMeta = parseNode(rawTarget);

			if (!nodeMap.has(sourceMeta.id)) {
				nodeMap.set(sourceMeta.id, sourceMeta);
			}
			if (!nodeMap.has(targetMeta.id)) {
				nodeMap.set(targetMeta.id, targetMeta);
			}

			const energy = Number.parseFloat(row.Energy || "0") || 0;
			const process = Number.parseFloat(row.Process || "0") || 0;
			const afolu = Number.parseFloat(row.AFOLU || "0") || 0;

			links.push({
				id: `link-${links.length}`,
				source: sourceMeta.id,
				target: targetMeta.id,
				value,
				energy,
				process,
				afolu
			});
		}

		const nodes = Array.from(nodeMap.values()).sort((a, b) => {
			if (a.stage !== b.stage) {
				return a.stage - b.stage;
			}
			return a.label.localeCompare(b.label);
		});

		return { nodes, links };
	}

	function parseNode(rawId) {
		const firstUnderscore = rawId.indexOf("_");
		if (firstUnderscore === -1) {
			return { id: rawId, label: rawId, stage: 0 };
		}

		const stage = Number.parseInt(rawId.slice(0, firstUnderscore), 10);
		const label = rawId.slice(firstUnderscore + 1);
		return {
			id: rawId,
			label,
			stage: Number.isFinite(stage) ? stage : 0
		};
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

		const nodeStartMap = new Map(collapsedGraph.nodes.map((node) => [node.id, node]));
		const nodeEndMap = new Map(expandedGraph.nodes.map((node) => [node.id, node]));
		const linkStartMap = new Map(collapsedGraph.links.map((link) => [link.id, link]));
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
			.text((d) => `${d.label}`);

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

			nodeSelection.each(function (nodeDatum) {
				const startNode = nodeStartMap.get(nodeDatum.id);
				const endNode = nodeEndMap.get(nodeDatum.id);
				if (!startNode || !endNode) {
					return;
				}

				const x0 = lerp(startNode.x0, endNode.x0, clamped);
				const x1 = lerp(startNode.x1, endNode.x1, clamped);
				const y0 = lerp(startNode.y0, endNode.y0, clamped);
				const y1 = lerp(startNode.y1, endNode.y1, clamped);
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

			const linkOpacity = fadeIn(clamped, 0.06, 0.3);
			const labelOpacity = fadeIn(clamped, 0.16, 0.28);

			linkPaths.style("opacity", linkOpacity);
			nodeSelection.select("text").style("opacity", labelOpacity);

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
						x0: lerp(startSource.x0, endSource.x0, clamped),
						x1: lerp(startSource.x1, endSource.x1, clamped),
						y0: lerp(startSource.y0, endSource.y0, clamped),
						y1: lerp(startSource.y1, endSource.y1, clamped)
					},
					target: {
						x0: lerp(startTarget.x0, endTarget.x0, clamped),
						x1: lerp(startTarget.x1, endTarget.x1, clamped),
						y0: lerp(startTarget.y0, endTarget.y0, clamped),
						y1: lerp(startTarget.y1, endTarget.y1, clamped)
					},
					y0: lerp(startLink.y0, endLink.y0, clamped),
					y1: lerp(startLink.y1, endLink.y1, clamped)
				};

				d3.select(this)
					.attr("d", d3.sankeyLinkHorizontal()(pathDatum))
					.attr("stroke-width", Math.max(1, lerp(startLink.width, endLink.width, clamped)));
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
