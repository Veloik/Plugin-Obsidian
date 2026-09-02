// Task badges: one step per click from the board, or every step at once.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots26"); fs.mkdirSync(shots, { recursive: true });
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
const steps = () => page.evaluate(() => {
	const b = __view.data.badges.find(x => x.tagId === "tag_todo");
	return { done: !!b.done, items: b.checklist.map(i => i.done) };
});

// A task badge with three steps, placed on the board.
await page.evaluate(() => {
	__view.data.badges.push({
		id: "task1", pageId: __view.data.activePageId, x: 320, y: 520, tagId: "tag_todo",
		label: "Tarea", title: "Práctica 3",
		checklist: [
			{ id: "s1", text: "Leer el enunciado", done: false },
			{ id: "s2", text: "Resolver los ejercicios", done: false },
			{ id: "s3", text: "Entregar en el aula virtual", done: false }
		]
	});
	__view.renderAll();
	__view.setTool("select");
});
await sleep(150);
const badge = await page.$('[data-id="task1"]');
const bb = await badge.boundingBox();
console.log("start:", JSON.stringify(await steps()));

// One click = one step.
for (let i = 1; i <= 3; i++) {
	await page.mouse.click(bb.x + 30, bb.y + bb.height / 2);
	await sleep(160); await clean();
	console.log(`after click ${i}:`, JSON.stringify(await steps()));
}
await shot(page, "01-all-steps-done", { x: 180, y: 420, width: 620, height: 220 });

// A fourth click reopens the last step, one at a time.
await page.mouse.click(bb.x + 30, bb.y + bb.height / 2); await sleep(160); await clean();
console.log("after click 4 (reopen last):", JSON.stringify(await steps()));

// Hover card: tick just one step by clicking its row.
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(400);
console.log("card rows:", (await page.$$(".onenote-top-tooltip-checklist-item")).length, "interactive:", await page.evaluate(() => document.querySelector(".onenote-top-tooltip")?.classList.contains("is-interactive")));
await shot(page, "02-hover-card-interactive", { x: 120, y: 300, width: 700, height: 320 });
const firstRow = await page.evaluate(() => {
	const row = document.querySelector(".onenote-top-tooltip-checklist-item");
	const r = row.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: row.textContent };
});
console.log("clicking row:", JSON.stringify(firstRow.text));
await page.mouse.click(firstRow.x, firstRow.y);
await sleep(200); await clean();
console.log("after clicking step 1 in the card:", JSON.stringify(await steps()));

// The bulk button marks every step at once.
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(400);
const bulkBox = await page.evaluate(() => {
	const b = document.querySelector(".onenote-top-tooltip-bulk");
	const r = b.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent };
});
console.log("bulk label:", JSON.stringify(bulkBox.text));
await page.mouse.click(bulkBox.x, bulkBox.y);
await sleep(220); await clean();
console.log("after bulk:", JSON.stringify(await steps()));
await shot(page, "03-after-bulk", { x: 120, y: 300, width: 700, height: 320 });

// Undo restores the previous state, one action at a time.
await page.mouse.move(1100, 820); await sleep(250);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(200);
console.log("after undo:", JSON.stringify(await steps()));

// A plain task with no steps still toggles as a whole.
await page.evaluate(() => {
	__view.data.badges.push({ id: "task2", pageId: __view.data.activePageId, x: 700, y: 520, tagId: "tag_todo", label: "Tarea", title: "Sin pasos" });
	__view.renderAll();
});
await sleep(150);
const plain = await (await page.$('[data-id="task2"]')).boundingBox();
await page.mouse.click(plain.x + 30, plain.y + plain.height / 2); await sleep(180); await clean();
console.log("plain task done:", await page.evaluate(() => !!__view.data.badges.find(b => b.id === "task2").done));
console.log("console issues:\n" + (errors.length ? errors.slice(0, 8).join("\n") : "(none)"));
await browser.close();
