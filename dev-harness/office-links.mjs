// A hyperlink in a Word paragraph survives editing the words around it, and opens with Ctrl+click.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const docx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"word/_rels/document.xml.rels": strToU8(head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/apuntes" TargetMode="External"/></Relationships>'),
	"word/document.xml": strToU8(head + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t xml:space="preserve">Fuente: </w:t></w:r><w:hyperlink r:id="rId9" w:history="1"><w:r><w:rPr><w:b/></w:rPr><w:t>los apuntes</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> de clase.</w:t></w:r></w:p></w:body></w:document>')
});

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
page.on("pageerror", e => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
await page.setViewport({ width: 1400, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(async (bytes) => {
	const file = new window.__TFile("enlace.docx"); file.stat = { mtime: 1 };
	window.__written = {};
	const v = window.__view;
	v.app.vault.readBinary = async () => new Uint8Array(bytes).buffer;
	v.app.vault.modifyBinary = async (f, buf) => { window.__written[f.path] = Array.from(new Uint8Array(buf)); f.stat.mtime += 1; };
	const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
	view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000"; view.contentEl.style.cssText = "position:absolute;inset:0";
	document.body.appendChild(view.containerEl); await view.onOpen?.(); await view.onLoadFile(file);
	await new Promise(r => setTimeout(r, 500));
}, Array.from(docx));

const link = await page.evaluate(() => { const l = document.querySelector("[data-link]"); return { text: l?.textContent, link: l?.dataset.link, bold: !!l?.querySelector("b") }; });
ok("el enlace se dibuja como enlace y conserva su negrita", link.text === "los apuntes" && link.link === "r:rId9" && link.bold, JSON.stringify(link));

await page.evaluate(() => { const ed = document.querySelector("p.notelens-office-para"); ed.focus(); ed.dispatchEvent(new InputEvent("beforeinput", { bubbles: true })); ed.lastChild.textContent += " Revisado el lunes."; ed.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForFunction(() => window.__written["enlace.docx"], { timeout: 9000 });
await new Promise(r => setTimeout(r, 2300));
const files = unzipSync(Uint8Array.from(await page.evaluate(() => window.__written["enlace.docx"])));
const xml = new TextDecoder().decode(files["word/document.xml"]);
ok("tras editar el texto de al lado, el enlace sigue siendo un enlace", /<w:hyperlink [^>]*r:id="rId9"[^>]*><w:r>(?:<w:rPr><w:b\/><\/w:rPr>)?<w:t[^>]*>los apuntes<\/w:t>/.test(xml), xml.slice(xml.indexOf("<w:p>"), xml.indexOf("<w:p>") + 420));
ok("y el texto nuevo quedó fuera del enlace", xml.includes("Revisado el lunes.") && !/<w:hyperlink[^>]*>(?:(?!<\/w:hyperlink>).)*Revisado/.test(xml));
ok("la relación del enlace no se toca", new TextDecoder().decode(files["word/_rels/document.xml.rels"]).includes("https://example.org/apuntes"));

await page.evaluate(() => { document.querySelector("[data-link]").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const plain = await page.evaluate(() => window.__opened.length);
await page.evaluate(() => { document.querySelector("[data-link]").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })); });
const withCtrl = await page.evaluate(() => window.__opened.slice());
ok("un clic normal no abre el enlace, con Ctrl sí", plain === 0 && withCtrl.length === 1 && withCtrl[0] === "https://example.org/apuntes", JSON.stringify(withCtrl));
if (!process.exitCode) console.log("todo correcto");
await browser.close();
