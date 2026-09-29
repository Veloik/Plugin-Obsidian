// Charts and SmartArt on a slide: drawn from the values and shapes a deck stores with them.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ok = (label, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const rels = (items) => head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith("http") ? type : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/" + type}" Target="${target}"/>`).join("")}</Relationships>`;

const strCache = (values) => `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:strCache>`;
const numCache = (values) => `<c:numCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache>`;
const ser = (i, name, cats, vals, color) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>x</c:f>${strCache([name])}</c:strRef></c:tx>${color ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>` : ""}<c:cat><c:strRef><c:f>x</c:f>${strCache(cats)}</c:strRef></c:cat><c:val><c:numRef><c:f>x</c:f>${numCache(vals)}</c:numRef></c:val></c:ser>`;
const chartXml = (plot, title) => head + `<c:chartSpace ${C} ${A}><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea>${plot}</c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;
const cats = ["Q1", "Q2", "Q3", "Q4"];
const bar = chartXml(`<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${ser(0, "Ventas", cats, [12, 19, 8, 24], "2F6FB5")}${ser(1, "Costes", cats, [7, 11, 6, 10], "ED7D31")}</c:barChart>`, "Ventas y costes");
const line = chartXml(`<c:lineChart><c:grouping val="standard"/>${ser(0, "Usuarios", cats, [100, 240, 310, 520])}</c:lineChart>`, "Usuarios por trimestre");
const pie = chartXml(`<c:pieChart>${ser(0, "Cuota", ["Móvil", "Web", "Tienda"], [55, 30, 15])}</c:pieChart>`, "Canales");

const frame = (id, rid) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Gráfico"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="800000"/><a:ext cx="7300000" cy="3900000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart ${C} ${R} r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
const slide = (inner) => head + `<p:sld ${P} ${A} ${R}><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;
const smartFrame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Diagrama"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="6000000" cy="2500000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" ${R} r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/></a:graphicData></a:graphic></p:graphicFrame>`;
const box = (id, x, text, fill) => `<dsp:sp modelId="{${id}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${x}" y="500000"/><a:ext cx="1700000" cy="1200000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="es-ES" sz="2000"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`;
const smartDrawing = head + `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" ${A}><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${box("1", 0, "Idea", "2F6FB5")}${box("2", 2100000, "Plan", "2E7D6B")}${box("3", 4200000, "Acción", "C0504D")}</dsp:spTree></dsp:drawing>`;

const pptx = zipSync({
	"[Content_Types].xml": strToU8(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	"ppt/presentation.xml": strToU8(head + `<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/><p:sldId id="259" r:id="rId4"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
	"ppt/_rels/presentation.xml.rels": strToU8(rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slide", "slides/slide3.xml"], ["rId4", "slide", "slides/slide4.xml"]])),
	"ppt/slides/slide1.xml": strToU8(slide(frame(2, "rId1"))),
	"ppt/slides/slide2.xml": strToU8(slide(frame(2, "rId1"))),
	"ppt/slides/slide3.xml": strToU8(slide(frame(2, "rId1"))),
	"ppt/slides/slide4.xml": strToU8(slide(smartFrame)),
	"ppt/slides/_rels/slide1.xml.rels": strToU8(rels([["rId1", "chart", "../charts/chart1.xml"]])),
	"ppt/slides/_rels/slide2.xml.rels": strToU8(rels([["rId1", "chart", "../charts/chart2.xml"]])),
	"ppt/slides/_rels/slide3.xml.rels": strToU8(rels([["rId1", "chart", "../charts/chart3.xml"]])),
	"ppt/slides/_rels/slide4.xml.rels": strToU8(rels([["rId6", "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing", "../diagrams/drawing1.xml"]])),
	"ppt/charts/chart1.xml": strToU8(bar), "ppt/charts/chart2.xml": strToU8(line), "ppt/charts/chart3.xml": strToU8(pie),
	"ppt/diagrams/drawing1.xml": strToU8(smartDrawing)
});

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files", "--disable-web-security", "--hide-scrollbars"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => { errors.push(e.message); console.log("PAGEERROR", e.message); });
await page.setViewport({ width: 1500, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nothing to forget */ } window.__presetSettings = { showAssistantPet: false }; });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready || window.__bootError, { timeout: 20000 });
await page.evaluate(async (data) => {
	const file = new window.__TFile("Deck/graficos.pptx"); file.stat = { mtime: 1 };
	window.__view.app.vault.readBinary = async () => new Uint8Array(data).buffer;
	const view = window.__plugin.views["notelens-office-view"]({ app: window.__app, view: null });
	view.containerEl.style.cssText = "position:fixed;inset:0;z-index:5000"; view.contentEl.style.cssText = "position:absolute;inset:0";
	document.body.appendChild(view.containerEl); await view.onOpen?.(); await view.onLoadFile(file);
	await new Promise(r => setTimeout(r, 600));
}, Array.from(pptx));

const look = async (index) => {
	await page.evaluate((i) => document.querySelectorAll(".notelens-thumb")[i].click(), index);
	await new Promise(r => setTimeout(r, 400));
	return page.evaluate(() => {
		const svg = document.querySelector(".notelens-office-page .notelens-slide-chart-svg");
		return {
			rects: svg?.querySelectorAll("rect").length ?? 0, paths: svg?.querySelectorAll("path").length ?? 0, polylines: svg?.querySelectorAll("polyline").length ?? 0,
			circles: svg?.querySelectorAll("circle").length ?? 0, texts: [...(svg?.querySelectorAll("text") ?? [])].map(t => t.textContent),
			shapes: document.querySelectorAll(".notelens-office-page .notelens-slide-shape").length,
			smart: [...document.querySelectorAll(".notelens-office-page .notelens-slide-para")].map(p => p.textContent)
		};
	});
};
const bars = await look(0);
await page.screenshot({ path: path.join(here, "shots-chart-bar.png") });
ok("un gráfico de columnas dibuja una barra por dato y serie", bars.rects >= 8 + 2, `${bars.rects} rectángulos`);
ok("con su título, sus etiquetas de eje y su leyenda", bars.texts.includes("Ventas y costes") && bars.texts.includes("Q3") && bars.texts.includes("Costes"), bars.texts.join("|"));
const lines = await look(1);
await page.screenshot({ path: path.join(here, "shots-chart-line.png") });
ok("un gráfico de líneas dibuja su línea y un punto por dato", lines.polylines === 1 && lines.circles >= 4, JSON.stringify({ p: lines.polylines, c: lines.circles }));
const pieLook = await look(2);
await page.screenshot({ path: path.join(here, "shots-chart-pie.png") });
ok("un gráfico circular dibuja un sector por dato con su porcentaje", pieLook.paths === 3 && pieLook.texts.includes("55%") && pieLook.texts.includes("Móvil"), pieLook.texts.join("|"));
const smart = await look(3);
await page.screenshot({ path: path.join(here, "shots-smartart.png") });
ok("el SmartArt pinta las formas que guarda su dibujo", ["Idea", "Plan", "Acción"].every(t => smart.smart.includes(t)), smart.smart.join("|"));
ok("sin errores de página", errors.length === 0);
if (!process.exitCode) console.log("todo correcto");
await browser.close();
