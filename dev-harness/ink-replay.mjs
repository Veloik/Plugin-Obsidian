// Ink replay: draws a few strokes, opens "Reproducir la tinta" from the board
// menu and checks that the ink comes back gradually, that the player pauses,
// jumps and changes speed, and that Escape or a touch on the board ends it
// with every stroke back in place. Screenshots in shots-ink/.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-ink");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 980 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await sleep(1200);
let failed = 0;
const check = (ok, label, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`); };
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };

await tool("pen");
for (let k = 0; k < 6; k++) {
	const y = 320 + k * 60;
	await page.mouse.move(360, y); await page.mouse.down();
	for (let i = 1; i <= 30; i++) await page.mouse.move(360 + i * 18, y + Math.sin(i / 3) * 14);
	await page.mouse.up();
}
// Ink pixels on the board canvas.
const inked = () => page.evaluate(() => {
	const canvas = document.querySelector(".onenote-canvas");
	const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
	let n = 0;
	for (let i = 3; i < data.length; i += 16) if (data[i] > 40) n++;
	return n;
});
// Antialiasing differs by a few percent between repaints of the same ink, so
// "all the ink" means within 5 %.
const full = await inked();

await tool("select");
await page.mouse.click(1000, 700, { button: "right" });
await sleep(150);
const item = await page.evaluateHandle(() => [...document.querySelectorAll(".menu-item")].find(i => i.textContent.includes("Reproducir la tinta")));
check(!!(await item.evaluate(i => !!i)), "el menú de la pizarra ofrece reproducir la tinta");
await item.evaluate(i => i.click());
await sleep(400);
const early = await inked();
check(await page.$(".notelens-replay-bar") !== null, "aparece el reproductor");
check(early < full * 0.6, "al principio sólo hay parte de la tinta", `${early} de ${full}`);
await page.screenshot({ path: path.join(shots, "replay-medio.png") });

// Pause holds the picture still.
await page.click(".notelens-replay-button.is-play");
const paused = await inked();
await sleep(500);
check(Math.abs((await inked()) - paused) < full * 0.02, "en pausa no avanza");
// Jump to the end with the slider.
await page.evaluate(() => {
	const s = document.querySelector(".notelens-replay-progress");
	s.value = s.max;
	s.dispatchEvent(new Event("input"));
});
await sleep(120);
check(Math.abs((await inked()) - full) < full * 0.05, "el deslizador lleva al final", `${await inked()} de ${full}`);
await page.click(".notelens-replay-button.is-speed");
check(await page.$eval(".notelens-replay-button.is-speed", b => b.textContent) === "2×", "la velocidad cambia a 2×");
// Restart, then Escape.
await page.click(".notelens-replay-button.is-restart");
await sleep(150);
check((await inked()) < full * 0.6, "desde el principio vuelve a empezar");
await page.keyboard.press("Escape");
await sleep(150);
check(await page.$(".notelens-replay-bar") === null && Math.abs((await inked()) - full) < full * 0.05, "Escape lo cierra y deja toda la tinta");

// A touch on the board ends it too, and draws nothing extra.
await page.evaluate(() => __view.startInkReplay());
await sleep(200);
const strokes = await page.evaluate(() => __view.data.strokes.length);
await page.mouse.click(1100, 250);
await sleep(150);
check(await page.$(".notelens-replay-bar") === null && (await page.evaluate(() => __view.data.strokes.length)) === strokes,
	"tocar la pizarra lo cierra sin tocar los trazos");
check(Math.abs((await inked()) - full) < full * 0.05, "y la tinta queda completa");

console.log("errores de página:", errors.length ? errors.slice(0, 3) : "(ninguno)");
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
console.log(failed ? `${failed} fallo(s)` : "todo correcto");
