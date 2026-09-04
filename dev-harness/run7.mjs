import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots7");
fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + ".png") }); console.log("shot", name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
	args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"],
	defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
console.log("boot:", await page.evaluate(() => window.__bootError || "ok"), "prism:", await page.evaluate(() => !!window.Prism));
const tool = async (id) => { await page.click(`.onenote-ribbon-dock [data-tool="${id}"]`); await sleep(60); };
const texts = () => page.evaluate(() => __view.data.texts.map(t => ({ text: t.text, variant: t.variant, language: t.language })));

// code block: typing with Tab / Enter auto-indent
await page.click(".notelens-insert-dock button[title='Insertar bloque de código']");
await sleep(150);
await page.select(".notelens-format-language", "python");
await sleep(80);
await page.keyboard.type("def suma(a, b):");
await page.keyboard.press("Enter");
await page.keyboard.type("return a + b  # comentario");
await page.keyboard.press("Enter");
await page.keyboard.press("Tab");
await page.keyboard.type("x = 42");
console.log("editor value:", JSON.stringify(await page.evaluate(() => document.querySelector(".notelens-text-editor").value)));
console.log("editor still open after Tab:", await page.evaluate(() => !!document.querySelector(".notelens-text-editor")));
await shot(page, "01-code-editing");
await page.mouse.click(1200, 820);
await sleep(200);
console.log("code block:", JSON.stringify(await texts()));
console.log("tokens:", await page.evaluate(() => document.querySelectorAll(".notelens-code-block .token").length),
	"gutter lines:", await page.evaluate(() => document.querySelectorAll(".notelens-code-gutter > div").length),
	"copy button:", await page.evaluate(() => !!document.querySelector(".notelens-code-copy")));
await shot(page, "02-code-rendered");

// fenced text pasted into a plain text box becomes a code block
await tool("text");
await page.mouse.click(300, 650);
await sleep(120);
await page.evaluate(() => {
	const ed = document.querySelector(".notelens-text-editor");
	ed.focus();
	document.execCommand("insertText", false, "```ts\nconst saludo: string = \"hola\";\nconsole.log(saludo);\n```");
});
await page.mouse.click(1200, 820);
await sleep(200);
console.log("fenced:", JSON.stringify(await texts()));
await shot(page, "03-fenced");

// re-edit keeps highlighting after commit and language change via bar
await tool("text");
await page.mouse.click(320, 680);
await sleep(120);
await page.select(".notelens-format-language", "javascript");
await sleep(60);
await page.mouse.click(1200, 820);
await sleep(200);
console.log("after language change:", JSON.stringify((await texts()).map(t => t.language)));

console.log("console issues:\n" + (errors.length ? errors.join("\n") : "(none)"));
await browser.close();
