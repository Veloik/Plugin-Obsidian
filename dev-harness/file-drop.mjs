// Files dragged onto the board from a file explorer land on it.
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

const drop = await page.evaluate(async () => {
	const v = window.__view, el = document.querySelector(".onenote-workspace");
	const make = (name, type, bytes) => new File([new Uint8Array(bytes)], name, { type });
	const dt = new DataTransfer();
	dt.items.add(make("Foto.png", "image/png", [137, 80, 78, 71]));
	dt.items.add(make("Clase.mp4", "video/mp4", [0, 0, 0, 24]));
	dt.items.add(make("Tema 3.pdf", "application/pdf", [37, 80, 68, 70]));
	const box = el.getBoundingClientRect();
	const at = { x: box.left + 600, y: box.top + 400 };
	const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: at.x, clientY: at.y });
	el.dispatchEvent(over);
	const taken = over.defaultPrevented;
	const marked = el.classList.contains("is-drop-target");
	el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
	await new Promise(r => setTimeout(r, 600));
	const scene = v.getSceneCoords(at.x, at.y);
	const image = v.data.embeds.find(x => x.kind === "image");
	return {
		taken, marked,
		cleared: !el.classList.contains("is-drop-target"),
		kinds: v.data.embeds.map(x => x.kind),
		pdfAsks: !!document.querySelector(".modal-container"),
		nearPointer: image ? Math.abs(image.x - (scene.x - 160)) < 60 && Math.abs(image.y - (scene.y - 75)) < 60 : false
	};
});
ok("la pizarra acepta el arrastre", drop.taken, String(drop.taken));
ok("y lo dice mientras el archivo está encima", drop.marked && drop.cleared);
ok("un PNG y un MP4 se colocan", drop.kinds.includes("image") && drop.kinds.includes("video"), JSON.stringify(drop.kinds));
ok("caen donde los sueltas", drop.nearPointer);
ok("un PDF pregunta cómo colocarlo, como al insertarlo", drop.pdfAsks);

if (!process.exitCode) console.log("todo correcto");
await browser.close();
