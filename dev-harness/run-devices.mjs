// Boots the board on every shape a NoteLens user has — phone, tablet and PC,
// portrait and landscape — and reports what does not fit: a control off the
// screen, two docks on top of each other, or anything the phone's own
// navigation bar covers. Screenshots land in dev-harness/shots-devices.
//
//   node dev-harness/run-devices.mjs            all profiles
//   node dev-harness/run-devices.mjs phone      only the ones whose name matches
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-devices");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const only = process.argv[2];

/**
 * Obsidian on a phone keeps a header above the view and floats its navigation
 * bar over the bottom of it; a tablet gets the header only, a desktop neither.
 */
const PROFILES = [
	{ name: "phone-portrait", width: 390, height: 844, dpr: 3, mobile: true, chrome: { header: 92, navbar: 56, navbarGap: 12 } },
	{ name: "phone-landscape", width: 844, height: 390, dpr: 3, mobile: true, chrome: { header: 64, navbar: 46, navbarGap: 8 } },
	{ name: "phone-small", width: 360, height: 740, dpr: 3, mobile: true, chrome: { header: 88, navbar: 54, navbarGap: 10 } },
	{ name: "tablet-portrait", width: 820, height: 1180, dpr: 2, mobile: true, chrome: { header: 76, navbar: 0, navbarGap: 0 } },
	{ name: "tablet-landscape", width: 1180, height: 820, dpr: 2, mobile: true, chrome: { header: 76, navbar: 0, navbarGap: 0 } },
	{ name: "laptop", width: 1366, height: 768, dpr: 1, mobile: false, chrome: null },
	{ name: "desktop", width: 1680, height: 1050, dpr: 1, mobile: false, chrome: null }
];

/** Every floating control the board puts over the canvas, by role. */
const DOCKS = [
	[".onenote-ribbon-dock", "tools"],
	[".notelens-insert-dock", "insert"],
	[".notelens-document-dock", "document"],
	[".onenote-quick-tags", "tags"],
	[".notelens-navigation-controls", "navigation"],
	[".notelens-settings-btn", "paper"],
	[".notelens-focus-toggle", "focus"],
	[".notelens-bookmarks-dock", "bookmarks"],
	[".notelens-pages-dock", "pages"]
];

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});

const report = [];
for (const profile of PROFILES) {
	if (only && !profile.name.includes(only)) continue;
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: 1, isMobile: profile.mobile, hasTouch: profile.mobile });
	await page.evaluateOnNewDocument((p) => {
		window.__mobileChrome = p.chrome;
		window.__presetPlatform = { isMobile: p.mobile, isPhone: p.name.startsWith("phone"), isTablet: p.name.startsWith("tablet"), isDesktop: !p.mobile, isMacOS: false, isIosApp: false };
		window.__presetSettings = { showAssistantPet: false };
	}, profile);
	await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	await sleep(450);

	const findings = await page.evaluate((docks) => {
		const problems = [];
		const workspace = document.querySelector(".onenote-workspace");
		const view = workspace.getBoundingClientRect();
		const navbar = document.querySelector("#obsidian-navbar");
		const nav = navbar && navbar.offsetHeight ? navbar.getBoundingClientRect() : null;
		const boxes = [];
		for (const [selector, role] of docks) {
			const el = document.querySelector(selector);
			if (!el || !el.offsetWidth || !el.offsetHeight) continue;
			const r = el.getBoundingClientRect();
			boxes.push({ role, selector, r: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height } });
			// Off the edges of the board itself.
			const out = [];
			if (r.left < view.left - 1) out.push(`${Math.round(view.left - r.left)}px por la izquierda`);
			if (r.right > view.right + 1) out.push(`${Math.round(r.right - view.right)}px por la derecha`);
			if (r.top < view.top - 1) out.push(`${Math.round(view.top - r.top)}px por arriba`);
			if (r.bottom > view.bottom + 1) out.push(`${Math.round(r.bottom - view.bottom)}px por abajo`);
			if (out.length) problems.push(`${role} (${selector}) se sale: ${out.join(", ")}`);
			// Under the phone's own navigation bar.
			if (nav && r.bottom > nav.top && r.top < nav.bottom && r.right > nav.left && r.left < nav.right) {
				problems.push(`${role} (${selector}) queda debajo de la barra de Obsidian`);
			}
			// Content wider than the box it sits in, with no way to scroll to it.
			if (el.scrollWidth > el.clientWidth + 8 && getComputedStyle(el).overflowX === "visible") {
				problems.push(`${role} (${selector}) desborda ${el.scrollWidth - el.clientWidth}px sin poder desplazarse`);
			}
		}
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i].r;
				const b = boxes[j].r;
				const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (overlapX > 2 && overlapY > 2) {
					problems.push(`${boxes[i].role} y ${boxes[j].role} se solapan ${Math.round(overlapX)}x${Math.round(overlapY)}px`);
				}
			}
		}
		// No tool button may be empty: every one shows an icon or a drawing, and
		// an image that failed or collapsed leaves a blank square behind.
		for (const btn of document.querySelectorAll(".onenote-ribbon-dock .onenote-dock-btn, .notelens-insert-dock button, .notelens-document-dock button")) {
			if (!btn.offsetWidth || !btn.offsetHeight) continue;
			const svg = btn.querySelector("svg");
			const img = btn.querySelector("img");
			const paintedSvg = !!svg && svg.getBoundingClientRect().height > 2;
			const paintedImg = !!img && img.naturalWidth > 0 && img.getBoundingClientRect().height > 2;
			const swatch = btn.querySelector(".onenote-color-dot, .onenote-current-color");
			if (!paintedSvg && !paintedImg && !swatch && !btn.textContent.trim()) {
				problems.push(`el botón ${btn.getAttribute("data-tool") || btn.title || "(sin nombre)"} sale vacío`);
			}
		}
		// The canvas must never make the page itself scroll.
		if (document.documentElement.scrollWidth > window.innerWidth + 1) {
			problems.push(`la página se desplaza ${document.documentElement.scrollWidth - window.innerWidth}px en horizontal`);
		}
		// Room left to actually draw. Only what sits over the middle of the board
		// counts: a dock standing against a side leaves the writing area alone.
		const midLeft = view.left + view.width * 0.35;
		const midRight = view.right - view.width * 0.35;
		const overMiddle = boxes.filter(b => b.r.right > midLeft && b.r.left < midRight);
		const half = view.top + view.height / 2;
		const tops = overMiddle.filter(b => b.r.top < half).map(b => b.r.bottom);
		const bottoms = overMiddle.filter(b => b.r.top >= half).map(b => b.r.top);
		const free = (bottoms.length ? Math.min(...bottoms) : view.bottom) - (tops.length ? Math.max(...tops) : view.top);
		return { problems, free: Math.round(free), viewHeight: Math.round(view.height), boot: window.__bootError || "ok" };
	}, DOCKS);

	await page.screenshot({ path: path.join(shots, `${profile.name}.png`) });
	// A second shot with the tag summary open: the widest panel there is.
	await page.evaluate(() => document.querySelector(".onenote-tag-summary-btn, .onenote-tag-summary")?.click());
	await page.evaluate(() => window.__view?.toggleTagSummary?.());
	await sleep(300);
	await page.screenshot({ path: path.join(shots, `${profile.name}-summary.png`) });

	report.push({ profile, ...findings, errors });
	await page.close();
}

let failed = 0;
for (const entry of report) {
	const { profile } = entry;
	const head = `${profile.name} ${profile.width}x${profile.height}`;
	if (entry.boot !== "ok") { console.log(`\n✗ ${head}: no arranca — ${entry.boot}`); failed++; continue; }
	const share = Math.round(entry.free / entry.viewHeight * 100);
	// A board with no room to write on is as broken as one with docks on top of
	// each other, so it counts as a problem too.
	if (entry.free < 110) entry.problems.push(`solo quedan ${entry.free}px de lienzo entre las barras`);
	if (entry.problems.length) {
		failed++;
		console.log(`\n✗ ${head} — ${entry.problems.length} problema(s) · lienzo libre ${entry.free}px (${share}%)`);
		for (const p of entry.problems) console.log("   ", p);
	} else {
		console.log(`\n✓ ${head} — sin solapes ni desbordes · lienzo libre ${entry.free}px (${share}%)`);
	}
	if (entry.errors.length) console.log("    errores de página:", entry.errors.slice(0, 2));
}
console.log(`\n=== ${report.length - failed}/${report.length} perfiles correctos · capturas en dev-harness/shots-devices ===`);
await browser.close();
process.exitCode = failed ? 1 : 0;
