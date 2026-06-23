(function () {
	const csvPath = "exchange-matrix-2025-06172026.csv";
	const chart = document.getElementById("sankey-chart");
	const statusEl = document.getElementById("sankey-status");

	if (!chart || !statusEl || !window.d3 || !d3.sankey) {
		return;
	}

	const stageLabels = {
		1: "Final Service",
		2: "Sector",
		3: "Equipment",
		4: "Device",
		5: "Final Energy",
		6: "Fuel",
		7: "Emissions"
	};

	const state = {
		nodes: [],
		links: [],
		selectedNodeId: null,
		rendered: null
	};

	const fmtMt = d3.format(",.2f");
	const fmtPct = d3.format(".2f");
	const stageLabelFor = (stage) => stageLabels[stage] || `Stage ${stage}`;

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

		const sankeyLayout = d3
			.sankey()
			.nodeId((d) => d.id)
			.nodeWidth(20)
			.nodePadding(9)
			.nodeAlign(d3.sankeyJustify)
			.extent([
				[28, 44],
				[width - 28, height - 34]
			])
			.iterations(64);

		sankeyLayout(graph);

		renderStageHeaders(svg, graph.nodes, width);

		const linksGroup = svg
			.append("g")
			.attr("fill", "none")
			.attr("stroke-opacity", 1)
			.attr("class", "sankey-links");

		const linkSelection = linksGroup
			.selectAll("path")
			.data(graph.links)
			.join("path")
			.attr("class", "sankey-link")
			.attr("d", d3.sankeyLinkHorizontal())
			.attr("stroke-width", (d) => Math.max(1, d.width))
			.append("title")
			.text((d) => {
				const source = d.source.label;
				const target = d.target.label;
				return `${source} -> ${target}\n${fmtMt(d.value)} Mt CO2e\nEnergy ${fmtMt(d.energy)} | Process ${fmtMt(d.process)} | AFOLU ${fmtMt(d.afolu)}`;
			});

		const nodesGroup = svg.append("g").attr("class", "sankey-nodes");

		const nodeSelection = nodesGroup
			.selectAll("g")
			.data(graph.nodes)
			.join("g")
			.attr("class", (d) => `sankey-node stage-${d.stage}`)
			.attr("transform", (d) => `translate(${d.x0},${d.y0})`)
			.style("cursor", "pointer")
			.on("click", function (event, d) {
				event.stopPropagation();
				state.selectedNodeId = state.selectedNodeId === d.id ? null : d.id;
				applySelection();
			});

		nodeSelection
			.append("rect")
			.attr("height", (d) => Math.max(3, d.y1 - d.y0))
			.attr("width", (d) => d.x1 - d.x0);

		nodeSelection
			.append("title")
			.text((d) => `${stageLabelFor(d.stage)}\n${d.label}`);

		nodeSelection
			.append("text")
			.attr("x", (d) => (d.x0 < width / 2 ? d.x1 - d.x0 + 7 : -7))
			.attr("y", (d) => (d.y1 - d.y0) / 2)
			.attr("dy", "0.35em")
			.attr("text-anchor", (d) => (d.x0 < width / 2 ? "start" : "end"))
			.text((d) => d.label);

		svg.on("click", () => {
			if (!state.selectedNodeId) {
				return;
			}
			state.selectedNodeId = null;
			applySelection();
		});

		state.rendered = {
			nodeSelection,
			linkSelection: linksGroup.selectAll("path"),
			graph
		};

		applySelection();
	}

	function renderStageHeaders(svg, nodes, width) {
		const stageCenters = d3
			.rollups(
				nodes,
				(values) => d3.mean(values, (node) => (node.x0 + node.x1) / 2),
				(node) => node.stage
			)
			.sort((a, b) => a[0] - b[0]);

		svg
			.append("g")
			.selectAll("text")
			.data(stageCenters)
			.join("text")
			.attr("class", "sankey-stage-label")
			.attr("x", (d) => Math.min(width - 40, Math.max(40, d[1])))
			.attr("y", 20)
			.attr("text-anchor", "middle")
			.text((d) => stageLabelFor(d[0]));
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
