// Another device rewrites the open board (Obsidian Sync, Syncthing, iCloud...):
// the view takes the new version in, merges what it had not saved, never
// overwrites what it did not write, and offers to fold in conflict copies.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"]
});
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };

const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1400, height: 950 });
await page.evaluateOnNewDocument(() => {
	window.__presetPlatform = { isMobile: false, isPhone: false, isTablet: false, isDesktop: true, isIosApp: false };
	window.__presetSettings = { showAssistantPet: false };
});
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

// The harness vault: what is on disk lives in window.__saved; read() serves it
// and a "modify" event announces a change, as Obsidian does for a synced file.
await page.evaluate(() => {
	const v = window.__view;
	v.app.vault.read = async () => window.__saved ?? "";
	window.__fire = (name, file) => (window.__vaultHandlers[name] || []).forEach(fn => fn(file));
	window.__stroke = (id, x) => ({ id, pageId: v.data.activePageId, type: "pen", color: "#ff0000", width: 3, points: [{ x, y: 100, pressure: 0.5 }, { x: x + 40, y: 140, pressure: 0.5 }] });
	window.__remoteWrite = (mutate) => {
		const doc = JSON.parse(window.__saved);
		mutate(doc);
		window.__saved = JSON.stringify(doc);
		window.__fire("modify", v.file);
	};
});

// 1. A local stroke lands on disk.
const first = await page.evaluate(async () => {
	const v = window.__view;
	v.history.push();
	v.data.strokes.push(window.__stroke("local-1", 100));
	v.save();
	await new Promise(r => setTimeout(r, 600));
	return { onDisk: JSON.parse(window.__saved).strokes.map(s => s.id) };
});
ok("un trazo local se guarda", first.onDisk.join() === "local-1", first.onDisk.join());

// 2. Another device adds a stroke while nothing is pending here: adopted, camera kept.
const adopted = await page.evaluate(async () => {
	const v = window.__view;
	v.data.viewTransform.x = 333;
	window.__remoteWrite(doc => doc.strokes.push(window.__stroke("remote-1", 300)));
	await new Promise(r => setTimeout(r, 300));
	return { ids: v.data.strokes.map(s => s.id), camera: v.data.viewTransform.x, notice: document.body.textContent.includes("otro dispositivo") };
});
ok("un trazo de otro dispositivo aparece sin tocar nada", adopted.ids.join() === "local-1,remote-1", adopted.ids.join());
ok("la cámara no salta", adopted.camera === 333, String(adopted.camera));
ok("y se avisa", adopted.notice);

// 3. Both sides change before the file is written: the save merges instead of overwriting.
const merged = await page.evaluate(async () => {
	const v = window.__view;
	v.data.strokes.push(window.__stroke("local-2", 500));
	v.save();                                                                 // pending, not written yet (350 ms debounce)
	const doc = JSON.parse(window.__saved);
	doc.strokes.push(window.__stroke("remote-2", 700));
	window.__saved = JSON.stringify(doc);                                     // sync lands first, no event yet
	await new Promise(r => setTimeout(r, 900));
	const onDisk = JSON.parse(window.__saved).strokes.map(s => s.id);
	return { onDisk, inView: v.data.strokes.map(s => s.id) };
});
ok("un guardado no pisa lo que llegó entre medias", merged.onDisk.includes("remote-2") && merged.onDisk.includes("local-2"), merged.onDisk.join());
ok("la vista muestra la fusión", merged.inView.includes("remote-2") && merged.inView.includes("local-2"), merged.inView.join());

// 4. A remote deletion of an untouched stroke goes through; a remote edit of one this side moved keeps this side's.
const threeWay = await page.evaluate(async () => {
	const v = window.__view;
	const mine = v.data.strokes.find(s => s.id === "local-1");
	mine.points[0].x = 999;                                                   // local edit, pending
	v.save();
	window.__remoteWrite(doc => {
		doc.strokes = doc.strokes.filter(s => s.id !== "remote-1");           // remote deletion
		doc.strokes.find(s => s.id === "local-1").color = "#00ff00";          // remote edit of the same stroke
	});
	await new Promise(r => setTimeout(r, 900));
	const local1 = v.data.strokes.find(s => s.id === "local-1");
	return { ids: v.data.strokes.map(s => s.id), x: local1.points[0].x, color: local1.color };
});
ok("un borrado remoto de un trazo intacto se aplica", !threeWay.ids.includes("remote-1"), threeWay.ids.join());
ok("si los dos tocaron el mismo trazo gana el de esta pantalla", threeWay.x === 999 && threeWay.color === "#ff0000", `${threeWay.x} ${threeWay.color}`);

// 5. A half-written file (sync mid-transfer) is not adopted; the next save restores this side.
const halfWritten = await page.evaluate(async () => {
	const v = window.__view;
	const before = v.data.strokes.length;
	window.__saved = "{\"version\":10,\"pag";
	window.__fire("modify", v.file);
	await new Promise(r => setTimeout(r, 900));
	let restored = false;
	try { restored = JSON.parse(window.__saved).strokes.length === before; } catch { restored = false; }
	return { kept: v.data.strokes.length === before, restored };
});
ok("un archivo a medias no sustituye la pizarra", halfWritten.kept);
ok("y el siguiente guardado lo repara", halfWritten.restored);

// 6. While the pen is down the swap waits for the release.
const midStroke = await page.evaluate(async () => {
	const v = window.__view;
	const el = document.querySelector(".onenote-workspace");
	el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, pointerType: "pen", clientX: 400, clientY: 400, pressure: 0.5, isPrimary: true, buttons: 1 }));
	window.__remoteWrite(doc => doc.strokes.push(window.__stroke("remote-3", 900)));
	await new Promise(r => setTimeout(r, 200));
	const during = v.data.strokes.some(s => s.id === "remote-3");
	window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, pointerType: "pen", clientX: 400, clientY: 400, isPrimary: true }));
	await new Promise(r => setTimeout(r, 1400));
	return { during, after: v.data.strokes.some(s => s.id === "remote-3") };
});
ok("con el lápiz apoyado no se cambia la pizarra", !midStroke.during);
ok("al levantarlo entra", midStroke.after);

// 7. A conflict copy next to the board: the banner offers to merge it and the copy goes to the trash.
const conflict = await page.evaluate(async () => {
	const v = window.__view;
	const copyDoc = JSON.parse(window.__saved);
	copyDoc.strokes = [window.__stroke("from-copy", 50)];
	const copy = new window.__TFile("Pizarra_prueba.sync-conflict-20260913-101010-ABCDEFG.notelens");
	const files = [v.file, copy];
	v.app.vault.getFiles = () => files.filter(f => !window.__trashed.includes(f.path));
	const realRead = v.app.vault.read;
	v.app.vault.read = async (f) => f === copy ? JSON.stringify(copyDoc) : realRead(f);
	window.__fire("create", copy);
	await new Promise(r => setTimeout(r, 100));
	const banner = document.querySelector(".notelens-sync-banner");
	const shown = !!banner && banner.textContent.includes("copia en conflicto");
	banner?.querySelector(".mod-cta")?.click();
	await new Promise(r => setTimeout(r, 900));
	return {
		shown,
		merged: v.data.strokes.some(s => s.id === "from-copy") && v.data.strokes.some(s => s.id === "local-1"),
		onDisk: JSON.parse(window.__saved).strokes.some(s => s.id === "from-copy"),
		trashed: window.__trashed.includes(copy.path),
		gone: !document.querySelector(".notelens-sync-banner")
	};
});
ok("una copia en conflicto se anuncia", conflict.shown);
ok("fusionar la trae a la pizarra y al disco", conflict.merged && conflict.onDisk);
ok("y la copia va a la papelera", conflict.trashed && conflict.gone);

if (!process.exitCode) console.log("todo correcto");
await browser.close();
