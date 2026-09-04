// Pasting the path of a note: the board shows the card, not the address.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots71"); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });

// A vault with one note in a folder, living on disk where the user's does.
await page.evaluate(() => {
	const NOTE = "Matematicas/Nueva sección 1.md";
	const vault = __view.app.vault;
	vault.adapter.getBasePath = () => "C:\\Users\\jtiob\\Desktop\\Obsidian_Apuntes_Vault";
	vault.getAbstractFileByPath = (p) => (p === NOTE ? new __TFile(NOTE) : null);
	vault.cachedRead = async () => "# Nueva sección 1\n\nLímites, derivadas y el teorema del valor medio.";
	__view.app.metadataCache = {
		getFirstLinkpathDest: (link) => (link === "Matematicas/Nueva sección 1" || link === "Nueva sección 1" ? new __TFile(NOTE) : null)
	};
});

const paste = async (text) => {
	await page.evaluate((text) => {
		const data = new DataTransfer();
		data.setData("text/plain", text);
		window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
	}, text);
	await sleep(250);
	return page.evaluate(() => ({
		tarjetas: __view.data.embeds.map(e => `${e.kind}:${e.src}`),
		textos: __view.data.texts.map(t => t.text)
	}));
};

console.log("ruta completa: ", JSON.stringify(await paste("C:\\Users\\jtiob\\Desktop\\Obsidian_Apuntes_Vault\\Matematicas\\Nueva sección 1.md")));
console.log("wikilink:      ", JSON.stringify(await paste("[[Nueva sección 1]]")));
console.log("ruta relativa: ", JSON.stringify(await paste("Matematicas/Nueva sección 1.md")));
console.log("obsidian://:   ", JSON.stringify(await paste("obsidian://open?vault=Obsidian_Apuntes_Vault&file=Matematicas%2FNueva%20secci%C3%B3n%201")));
console.log("texto normal:  ", JSON.stringify(await paste("Matematicas")));
console.log("fuera bóveda:  ", JSON.stringify(await paste("C:\\Users\\jtiob\\Downloads\\otra cosa.md")));
await page.evaluate(() => document.querySelectorAll(".notice").forEach(n => n.remove()));
await sleep(200);
await page.screenshot({ path: path.join(shots, "01-cards.png"), clip: { x: 300, y: 150, width: 900, height: 620 } });
console.log("page errors:", errors.length ? errors.slice(0, 3) : "(none)");
await browser.close();
