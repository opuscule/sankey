// Fills every [data-copy] slot from window.SITE_COPY (copy.js) and exposes
// siteCopy(key, vars) for main.js to use where it injects rather than
// hydrates.
//
// Load order matters: this runs after the body markup but BEFORE the hero
// GSAP block and main.js, because the hero timeline and every ScrollTrigger
// measure element heights -- copy that landed after measurement would leave
// the pins sized for empty paragraphs.
(function () {
	const SITE_COPY = window.SITE_COPY || {};

	// A missing key renders visibly rather than silently blanking a paragraph.
	function siteCopy(key, vars) {
		const value = SITE_COPY[key];
		if (typeof value !== "string") {
			console.error(`[copy] missing key: ${key}`);
			return `‹missing: ${key}›`;
		}
		if (!vars) {
			return value;
		}
		return value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
	}

	function hydrateCopy(root = document) {
		root.querySelectorAll("[data-copy]:not([data-copy-done])").forEach((el) => {
			el.innerHTML = siteCopy(el.dataset.copy);
			el.setAttribute("data-copy-done", "");
		});
	}

	window.siteCopy = siteCopy;
	window.hydrateCopy = hydrateCopy;

	hydrateCopy();
	// Slots that sit after this <script> (the .tech_impacts_tooltip, below
	// main.js) aren't parsed yet; sweep once more when the document is done.
	document.addEventListener("DOMContentLoaded", () => hydrateCopy());
})();
