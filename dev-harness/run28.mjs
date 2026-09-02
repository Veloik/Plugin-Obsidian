// Page filters in the tag summary and the bookmarks panel.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots28"); fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name, clip) => { await page.screenshot({ path: path.join(shots, name + ".png"), clip }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));
const clean = () => page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));

// Two pages, each with its own tags and bookmarks.
const state = await page.evaluate(() => {
	__view.addDocumentPage();
	const pages = __view.data.pages.map(p => ({ id: p.id, title: p.title }));
	const [p1, p2] = pages;
	__view.data.badges.push(
		{ id: "b1", pageId: p1.id, x: 300, y: 300, tagId: "tag_todo", label: "Tarea", title: "Tarea de la página 1" },
		{ id: "b2", pageId: p1.id, x: 500, y: 300, tagId: "tag_star", label: "Importante", title: "Clave de la página 1" },
		{ id: "b3", pageId: p2.id, x: 300, y: 400, tagId: "tag_question", label: "Duda", title: "Duda de la página 2" }
	);
	__view.data.bookmarks.push(
		{ id: "m1", pageId: p1.id, label: "Inicio p1", x: 0, y: 0, scale: 1 },
		{ id: "m2", pageId: p2.id, label: "Inicio p2", x: 0, y: 0, scale: 1 },
		{ id: "m3", pageId: p2.id, label: "Final p2", x: 400, y: 400, scale: 1 }
	);
	__view.renderAll();
	__view.workspaceEl.__refreshBookmarks?.();
	__view.setTool("select");
	return { pages, active: __view.data.activePageId };
});
console.log("pages:", JSON.stringify(state.pages.map(p => p.title)));

// ---- tag summary filter
await clean();
await page.evaluate(() => __view.toggleTagSummary());
await sleep(250);
const summarySel = ".notelens-tag-summary .notelens-panel-page-select";
console.log("summary filter present:", await page.evaluate(s => !!document.querySelector(s), summarySel));
console.log("summary options:", await page.evaluate(s => [...document.querySelector(s).options].map(o => o.text), summarySel));
console.log("rows with all pages:", await page.evaluate(() => document.querySelectorAll(".notelens-tag-summary-item").length));
await shot(page, "01-summary-all-pages");
// pick page 1
await page.select(summarySel, state.pages[0].id); await sleep(250);
console.log("rows on page 1:", await page.evaluate(() => document.querySelectorAll(".notelens-tag-summary-item").length));
console.log("chip counts on page 1:", await page.evaluate(() => [...document.querySelectorAll(".notelens-tag-summary-filters .onenote-tag-chip")].map(c => c.textContent.trim())));
await shot(page, "02-summary-page-1");
// pick page 2
await page.select(summarySel, state.pages[1].id); await sleep(250);
console.log("rows on page 2:", await page.evaluate(() => document.querySelectorAll(".notelens-tag-summary-item").length));
console.log("titles on page 2:", await page.evaluate(() => [...document.querySelectorAll(".notelens-tag-summary-item")].map(r => r.textContent.slice(0, 40))));
await shot(page, "03-summary-page-2");
await page.evaluate(() => __view.toggleTagSummary()); await sleep(150);

// ---- bookmarks filter
await clean();
await page.click(".notelens-bookmarks-toggle"); await sleep(250);
const bmSel = ".notelens-bookmarks-panel .notelens-panel-page-select";
console.log("bookmark filter present:", await page.evaluate(s => !!document.querySelector(s), bmSel));
console.log("bookmark options:", await page.evaluate(s => [...document.querySelector(s).options].map(o => o.text), bmSel));
console.log("bookmarks with all pages:", await page.evaluate(() => document.querySelectorAll(".notelens-bookmark-item").length));
await shot(page, "04-bookmarks-all");
await page.select(bmSel, state.pages[1].id); await sleep(250);
console.log("bookmarks on page 2:", await page.evaluate(() => [...document.querySelectorAll(".notelens-bookmark-label")].map(l => l.textContent)));
await shot(page, "05-bookmarks-page-2");
await page.select(bmSel, state.pages[0].id); await sleep(250);
console.log("bookmarks on page 1:", await page.evaluate(() => [...document.querySelectorAll(".notelens-bookmark-label")].map(l => l.textContent)));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
