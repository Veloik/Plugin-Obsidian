// The eraser's mode cards ("Trazo entero" / "Solo lo que tocas") must stay inside
// their panel on every tablet width, in both languages.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
for (const [name, width, height, lang] of [["tablet vertical", 768, 1024, "es"], ["tablet horizontal", 1180, 820, "es"], ["tablet pequeña", 600, 960, "es"], ["tablet en inglés", 768, 1024, "en"], ["muy estrecha", 420, 900, "es"]]) {
	const page = await browser.newPage();
	page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
	await page.setViewport({ width, height, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
	await page.evaluateOnNewDocument((l) => {
		try { localStorage.clear(); } catch { /* a private window simply forgets */ }
		window.__presetSettings = { showAssistantPet: false, language: l };
	}, lang);
	await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
	await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
	// The harness has no Obsidian stylesheet; its button rule is what fixes a card's height and stops its text wrapping.
	await page.addStyleTag({ content: "button { height: 40px; white-space: nowrap; padding: 4px 12px; }" });
	await page.click(".onenote-dock-btn[data-tool=eraser]");
	await page.click(".onenote-dock-btn[data-tool=eraser]");
	await page.waitForSelector(".notelens-pen-panel:not(.hidden) .notelens-choice-card", { visible: true, timeout: 5000 }).catch(() => {});
	const r = await page.evaluate(() => {
		const panel = document.querySelector(".notelens-pen-panel:not(.hidden)");
		const cards = Array.from(panel?.querySelectorAll(".notelens-panel-eraser .notelens-choice-card") ?? []);
		const p = panel?.getBoundingClientRect();
		return {
			found: !!panel && cards.length === 2,
			panelW: p ? Math.round(p.width) : 0,
			outside: cards.filter(c => { const b = c.getBoundingClientRect(); return b.left < p.left - 0.5 || b.right > p.right + 0.5; }).length,
			scrolls: panel ? panel.scrollWidth > panel.clientWidth + 1 : true,
			spill: cards.filter(c => { const b = c.getBoundingClientRect(); return Array.from(c.querySelectorAll("*")).some(k => { const kb = k.getBoundingClientRect(); return kb.bottom > b.bottom + 0.5 || kb.right > b.right + 0.5; }); }).length,
			widths: cards.map(c => Math.round(c.getBoundingClientRect().width))
		};
	});
	ok(`${name} (${width}px): las dos tarjetas caben en el panel`, r.found && r.outside === 0 && r.spill === 0 && !r.scrolls, JSON.stringify(r));
	await page.screenshot({ path: path.join(here, `shots-eraser-${width}-${lang}.png`) });
	await page.close();
}
if (!process.exitCode) console.log("todo correcto");
await browser.close();
