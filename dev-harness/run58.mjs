// The local-model settings: the section stands on its own (the translator uses
// the same server, so hiding Leen must not hide it), and the probe reports what
// it found instead of firing a Notice that disappears.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots58");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 900, height: 1100, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// A fake local server, so the three states can be checked without Ollama.
let serverState = "down";
await page.setRequestInterception(true);
page.on("request", (req) => {
	const url = req.url();
	if (!/11434|api\/tags|v1\/models/.test(url)) return req.continue();
	if (serverState === "down") return req.abort();
	const models = serverState === "empty" ? [] : [{ name: "llava:7b" }, { name: "nomic-embed-text" }, { name: "qwen2.5-coder:7b" }];
	req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ models }) });
});

await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"));

const openSettings = () => page.evaluate(() => {
	document.getElementById("settings-host")?.remove();
	const host = document.createElement("div");
	host.id = "settings-host";
	host.style.cssText = "padding:16px;max-width:820px";
	document.body.appendChild(host);
	const tab = window.__settingTab;
	tab.containerEl = host;
	tab.display();
});

await openSettings();
await sleep(250);
const section = () => page.evaluate(() => {
	const names = [...document.querySelectorAll("#settings-host .setting-item-name")].map(n => n.textContent);
	return {
		hasLocalModelHeading: names.includes("Modelo local"),
		server: names.includes("Servidor"),
		model: names.includes("Modelo preferido"),
		context: names.includes("Usar la pizarra como contexto"),
		status: document.querySelector("#settings-host .notelens-settings-status")?.textContent ?? null
	};
});
console.log("con Leen visible:", JSON.stringify(await section(), null, 0));
await page.screenshot({ path: path.join(shots, "01-settings-local-model.png"), fullPage: true });

// Turning the pet off must not take the local-model settings with it
await page.evaluate(() => {
	const toggles = [...document.querySelectorAll("#settings-host .checkbox-container")];
	toggles[0]?.click();
});
await sleep(250);
console.log("con Leen oculto:  ", JSON.stringify(await section(), null, 0));

// the probe's three states
const probe = async (state) => {
	serverState = state;
	await openSettings();
	await sleep(200);
	await page.evaluate(() => {
		const b = [...document.querySelectorAll("#settings-host button")].find(x => x.textContent.trim() === "Probar");
		b?.click();
	});
	await sleep(900);
	return page.evaluate(() => {
		const el = document.querySelector("#settings-host .notelens-settings-status");
		return { text: el?.textContent?.slice(0, 120), cls: el?.className };
	});
};
for (const state of ["down", "empty", "models"]) {
	console.log(`servidor ${state.padEnd(7)}`, JSON.stringify(await probe(state)));
}
await page.screenshot({ path: path.join(shots, "02-probe-connected.png"), fullPage: true });
console.log("page errors:", errors.length ? errors.slice(0, 2) : "(none)");
await browser.close();
