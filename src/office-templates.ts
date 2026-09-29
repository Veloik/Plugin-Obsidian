import { tr } from "./i18n";

/**
 * What a new Word document or presentation starts as: a set of XML parts, by
 * their path in the package. The caller zips them.
 */

export type DocTemplateId = "blank" | "notes" | "cornell" | "report";
export type DeckThemeId = "classic" | "dark" | "nature" | "coral";

export interface TemplateChoice { id: string; icon: string; name: string; hint: string }

export function docTemplates(): TemplateChoice[] {
	return [
		{ id: "notes", icon: "notebook-pen", name: tr("Apuntes de clase"), hint: tr("Asignatura, fecha, ideas clave, desarrollo, dudas y resumen") },
		{ id: "cornell", icon: "columns-2", name: tr("Método Cornell"), hint: tr("Pistas a la izquierda, apuntes a la derecha y resumen abajo") },
		{ id: "report", icon: "file-text", name: tr("Informe o trabajo"), hint: tr("Portada de datos, introducción, desarrollo, conclusiones y bibliografía") },
		{ id: "blank", icon: "file", name: tr("En blanco"), hint: tr("Una hoja vacía con título") }
	];
}

export function deckThemes(): TemplateChoice[] {
	return [
		{ id: "classic", icon: "presentation", name: tr("Clásico azul"), hint: tr("Fondo blanco y barra azul lateral") },
		{ id: "dark", icon: "moon", name: tr("Oscuro"), hint: tr("Fondo oscuro con texto claro, cómodo para proyectar") },
		{ id: "nature", icon: "leaf", name: tr("Naturaleza"), hint: tr("Verdes suaves y una franja superior") },
		{ id: "coral", icon: "sparkles", name: tr("Coral creativo"), hint: tr("Cálido y vivo, con una banda a la derecha") }
	];
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";
const NS_DECL = `xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"`;

export function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function relationships(items: [string, string, string][]): string {
	return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
}

function contentTypes(extra: string): string {
	return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${extra}</Types>`;
}
const override = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

const text = (s: string) => `<w:t xml:space="preserve">${escapeXml(s)}</w:t>`;
const run = (s: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${text(s)}</w:r>`;
const para = (inner = "", pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const styled = (style: string, s: string) => para(run(s), `<w:pStyle w:val="${style}"/>`);
const bullet = (numId: number, s = "") => para(s ? run(s) : "", `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);
const label = (name: string) => para(run(`${name} `, "<w:b/>") + run(""), '<w:spacing w:after="60"/>');
const hint = (s: string) => para(run(s, '<w:i/><w:color w:val="7F7F7F"/>'));

const cell = (width: number, inner: string, opts: { fill?: string; span?: number } = {}) =>
	`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${opts.span ? `<w:gridSpan w:val="${opts.span}"/>` : ""}${opts.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fill}"/>` : ""}</w:tcPr>${inner}</w:tc>`;
const row = (cells: string, height?: number) => `<w:tr>${height ? `<w:trPr><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>` : ""}${cells}</w:tr>`;
const table = (widths: number[], rows: string) => {
	const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(n => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join("");
	return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`;
};
const cellPara = (s = "", bold = false) => para(s ? run(s, bold ? "<w:b/>" : "") : "", '<w:spacing w:before="40" w:after="40"/>');

function docBody(template: DocTemplateId, title: string): string {
	const heading = title || tr("Documento sin título");
	if (template === "notes") {
		return styled("Title", heading)
			+ label(tr("Asignatura:")) + label(tr("Fecha:")) + label(tr("Tema:"))
			+ styled("Heading2", tr("Ideas clave")) + bullet(1) + bullet(1) + bullet(1)
			+ styled("Heading2", tr("Desarrollo")) + para()
			+ styled("Heading2", tr("Ejemplos y fórmulas")) + para()
			+ styled("Heading2", tr("Dudas para preguntar")) + bullet(1) + bullet(1)
			+ styled("Heading2", tr("Resumen")) + para();
	}
	if (template === "cornell") {
		const widths = [2900, 6100];
		return styled("Title", heading)
			+ para(run(tr("Asignatura:"), "<w:b/>") + run("   ") + run(tr("Fecha:"), "<w:b/>") + run("   ") + run(tr("Tema:"), "<w:b/>"))
			+ table(widths,
				row(cell(2900, cellPara(tr("Pistas y preguntas"), true), { fill: "E8EEF5" }) + cell(6100, cellPara(tr("Apuntes"), true), { fill: "E8EEF5" }))
				+ row(cell(2900, cellPara()) + cell(6100, cellPara()), 7600)
				+ row(cell(9000, cellPara(tr("Resumen"), true), { fill: "E8EEF5", span: 2 }))
				+ row(cell(9000, cellPara(), { span: 2 }), 1800))
			+ para();
	}
	if (template === "report") {
		return styled("Title", heading)
			+ label(tr("Autor/a:")) + label(tr("Curso:")) + label(tr("Fecha:"))
			+ styled("Heading1", tr("Introducción")) + hint(tr("Presenta el tema, por qué importa y qué vas a explicar."))
			+ styled("Heading1", tr("Desarrollo"))
			+ styled("Heading2", tr("Apartado 1")) + para()
			+ styled("Heading2", tr("Apartado 2")) + para()
			+ styled("Heading1", tr("Conclusiones")) + hint(tr("Resume lo aprendido y responde a la pregunta de partida."))
			+ styled("Heading1", tr("Bibliografía")) + bullet(2) + bullet(2);
	}
	return styled("Title", heading) + para();
}

export function buildDocx(title: string, template: DocTemplateId): Record<string, string> {
	const W = `xmlns:w="${W_NS}"`;
	const style = (id: string, name: string, extra: string, next = "Normal") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="${next}"/><w:qFormat/>${extra}</w:style>`;
	const level = (fmt: string, glyph: string) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${glyph}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
	return {
		"[Content_Types].xml": contentTypes(override("/word/document.xml", `${CT}.wordprocessingml.document.main+xml`)
			+ override("/word/styles.xml", `${CT}.wordprocessingml.styles+xml`) + override("/word/numbering.xml", `${CT}.wordprocessingml.numbering+xml`)),
		"_rels/.rels": relationships([["rId1", "officeDocument", "word/document.xml"]]),
		"word/_rels/document.xml.rels": relationships([["rId1", "styles", "styles.xml"], ["rId2", "numbering", "numbering.xml"]]),
		"word/document.xml": `${XML_HEAD}<w:document ${W}><w:body>${docBody(template, title)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
		"word/styles.xml": `${XML_HEAD}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
			+ `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
			+ style("Title", "Title", '<w:pPr><w:spacing w:before="0" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="52"/></w:rPr>')
			+ style("Heading1", "heading 1", '<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="36"/></w:rPr>')
			+ style("Heading2", "heading 2", '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E7D6B"/><w:sz w:val="30"/></w:rPr>')
			+ style("Heading3", "heading 3", '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="404040"/><w:sz w:val="26"/></w:rPr>')
			+ style("Quote", "Quote", '<w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr>')
			+ `</w:styles>`,
		"word/numbering.xml": `${XML_HEAD}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${level("bullet", "•")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${level("decimal", "%1.")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
	};
}

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

interface Palette {
	dk1: string; lt1: string; dk2: string; lt2: string;
	accents: [string, string, string, string, string, string];
	dark: boolean;
	/** A flat colour for the master's background, or the theme's own. */
	background?: string;
	major: string; minor: string;
	/** What the master draws on every slide, as [x, y, cx, cy, accent]. */
	bands: [number, number, number, number, string][];
	titleColor: string;
}

const PALETTES: Record<DeckThemeId, Palette> = {
	classic: { dk1: "1F2328", lt1: "FFFFFF", dk2: "1F3A5F", lt2: "EEF2F7", accents: ["2F6FB5", "2E7D6B", "ED7D31", "FFC000", "7030A0", "C00000"], dark: false, major: "Calibri", minor: "Calibri", bands: [[0, 0, 220000, 6858000, "accent1"]], titleColor: "tx2" },
	dark: { dk1: "12161C", lt1: "F2F4F7", dk2: "1B2330", lt2: "9FB3C8", accents: ["4EA1FF", "34D399", "FBBF24", "F472B6", "A78BFA", "F87171"], dark: true, major: "Segoe UI", minor: "Segoe UI", bands: [[0, 6700000, 12192000, 158000, "accent1"]], titleColor: "tx1" },
	nature: { dk1: "23301F", lt1: "FFFFFF", dk2: "1E5B45", lt2: "EAF3EC", accents: ["3F9A6B", "8DBB4A", "E0A93B", "5AA5A0", "8B6B4A", "C0563B"], dark: false, background: "F6FAF6", major: "Georgia", minor: "Calibri", bands: [[0, 0, 12192000, 260000, "accent1"]], titleColor: "tx2" },
	coral: { dk1: "2A2226", lt1: "FFFFFF", dk2: "8A2E3B", lt2: "FCEFEA", accents: ["F26B5B", "F2A65A", "4C9F9A", "7B5EA7", "3A6EA5", "D94A6A"], dark: false, background: "FFFAF7", major: "Trebuchet MS", minor: "Calibri", bands: [[11700000, 0, 492000, 6858000, "accent1"]], titleColor: "tx2" }
};

export function buildDeck(title: string, themeId: DeckThemeId): Record<string, string> {
	const palette = PALETTES[themeId] ?? PALETTES.classic;
	const parts: Record<string, string> = {};
	const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
	const frame = (x: number, y: number, cx: number, cy: number) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
	const holder = (id: number, name: string, ph: string, geometry: string, body: string, props = "", lst = "") =>
		`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr>${geometry}</p:spPr><p:txBody><a:bodyPr${props}/>${lst ? `<a:lstStyle>${lst}</a:lstStyle>` : "<a:lstStyle/>"}${body}</p:txBody></p:sp>`;
	const prompt = (s: string) => `<a:p><a:r><a:rPr lang="es-ES"/><a:t>${escapeXml(s)}</a:t></a:r></a:p>`;
	const titleText = tr("Haz clic para editar el título");
	const bodyText = tr("Haz clic para editar el texto");
	const layoutXml = (name: string, type: string, shapes: string) =>
		`${XML_HEAD}<p:sldLayout ${NS_DECL} type="${type}" preserve="1"><p:cSld name="${escapeXml(name)}"><p:spTree>${grp}${shapes}</p:spTree></p:cSld></p:sldLayout>`;

	const layouts: [string, string, string][] = [
		[tr("Diapositiva de título"), "title",
			holder(2, "Título", 'type="ctrTitle"', frame(1524000, 1122363, 9144000, 2387600), prompt(titleText), ' anchor="b"', '<a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr>')
			+ holder(3, "Subtítulo", 'type="subTitle" idx="1"', frame(1524000, 3602038, 9144000, 1655762), prompt(tr("Haz clic para editar el subtítulo")), "", '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr>')],
		[tr("Título y contenido"), "obj",
			holder(2, "Título", 'type="title"', "", prompt(titleText)) + holder(3, "Contenido", 'idx="1"', "", prompt(bodyText))],
		[tr("Encabezado de sección"), "secHead",
			holder(2, "Título", 'type="title"', frame(838200, 1709738, 10515600, 2852737), prompt(titleText), ' anchor="b"', '<a:lvl1pPr><a:defRPr sz="5400" b="1"/></a:lvl1pPr>')
			+ holder(3, "Texto", 'type="body" idx="1"', frame(838200, 4589463, 10515600, 1500187), prompt(bodyText), "", '<a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr>')],
		[tr("Dos contenidos"), "twoObj",
			holder(2, "Título", 'type="title"', "", prompt(titleText))
			+ holder(3, "Contenido izquierdo", 'idx="1"', frame(838200, 1825625, 5181600, 4351338), prompt(bodyText), "", '<a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr>')
			+ holder(4, "Contenido derecho", 'idx="2"', frame(6172200, 1825625, 5181600, 4351338), prompt(bodyText), "", '<a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr>')],
		[tr("Solo el título"), "titleOnly", holder(2, "Título", 'type="title"', "", prompt(titleText))],
		[tr("En blanco"), "blank", ""]
	];

	const bandXml = palette.bands.map(([x, y, cx, cy, accent], i) =>
		`<p:sp><p:nvSpPr><p:cNvPr id="${10 + i}" name="Banda ${i + 1}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr>${frame(x, y, cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="${accent}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></p:txBody></p:sp>`).join("");
	const level = (n: number, size: number, bulleted: boolean) => `<a:lvl${n}pPr marL="${bulleted ? 228600 + (n - 1) * 457200 : 0}" indent="${bulleted ? -228600 : 0}" algn="l" defTabSz="914400"><a:spcBef><a:spcPts val="${bulleted ? 1000 : 0}"/></a:spcBef>${bulleted ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : "<a:buNone/>"}<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl${n}pPr>`;
	const background = palette.background
		? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${palette.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
		: '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>';
	const clrMap = palette.dark
		? 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"'
		: 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"';

	const layoutParts = layouts.map((_, i) => `/ppt/slideLayouts/slideLayout${i + 1}.xml`);
	parts["[Content_Types].xml"] = contentTypes(override("/ppt/presentation.xml", `${CT}.presentationml.presentation.main+xml`)
		+ override("/ppt/slideMasters/slideMaster1.xml", `${CT}.presentationml.slideMaster+xml`)
		+ layoutParts.map(p => override(p, `${CT}.presentationml.slideLayout+xml`)).join("")
		+ override("/ppt/slides/slide1.xml", `${CT}.presentationml.slide+xml`) + override("/ppt/theme/theme1.xml", `${CT}.theme+xml`));
	parts["_rels/.rels"] = relationships([["rId1", "officeDocument", "ppt/presentation.xml"]]);
	parts["ppt/presentation.xml"] = `${XML_HEAD}<p:presentation ${NS_DECL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
	parts["ppt/_rels/presentation.xml.rels"] = relationships([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "slide", "slides/slide1.xml"], ["rId3", "theme", "theme/theme1.xml"]]);
	parts["ppt/slideMasters/slideMaster1.xml"] = `${XML_HEAD}<p:sldMaster ${NS_DECL}><p:cSld>${background}<p:spTree>${grp}${bandXml}`
		+ holder(2, "Título", 'type="title"', frame(838200, 365125, 10515600, 1325563), prompt(titleText), ' anchor="ctr"')
		+ holder(3, "Texto", 'type="body" idx="1"', frame(838200, 1825625, 10515600, 4351338), prompt(bodyText))
		+ `</p:spTree></p:cSld><p:clrMap ${clrMap} accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${layouts.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldLayoutIdLst>`
		+ `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:defRPr sz="4400" b="1" kern="1200"><a:solidFill><a:schemeClr val="${palette.titleColor}"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>`
		+ `<p:bodyStyle>${level(1, 2800, true)}${level(2, 2400, true)}${level(3, 2000, true)}</p:bodyStyle><p:otherStyle>${level(1, 1800, false)}</p:otherStyle></p:txStyles></p:sldMaster>`;
	parts["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = relationships([...layouts.map((_, i): [string, string, string] => [`rId${i + 1}`, "slideLayout", `../slideLayouts/slideLayout${i + 1}.xml`]), [`rId${layouts.length + 1}`, "theme", "../theme/theme1.xml"]]);
	layouts.forEach(([name, type, shapes], i) => {
		parts[`ppt/slideLayouts/slideLayout${i + 1}.xml`] = layoutXml(name, type, shapes);
		parts[`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`] = relationships([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]);
	});
	parts["ppt/slides/slide1.xml"] = `${XML_HEAD}<p:sld ${NS_DECL}><p:cSld><p:spTree>${grp}`
		+ holder(2, "Título", 'type="ctrTitle"', "", `<a:p><a:r><a:rPr lang="es-ES"/><a:t>${escapeXml(title)}</a:t></a:r></a:p>`)
		+ holder(3, "Subtítulo", 'type="subTitle" idx="1"', "", '<a:p><a:endParaRPr lang="es-ES"/></a:p>')
		+ `</p:spTree></p:cSld></p:sld>`;
	parts["ppt/slides/_rels/slide1.xml.rels"] = relationships([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]);
	const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
	const lines = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
	const c = (name: string, hex: string) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
	parts["ppt/theme/theme1.xml"] = `${XML_HEAD}<a:theme xmlns:a="${A_NS}" name="NoteLens"><a:themeElements><a:clrScheme name="NoteLens">${c("dk1", palette.dk1)}${c("lt1", palette.lt1)}${c("dk2", palette.dk2)}${c("lt2", palette.lt2)}${palette.accents.map((hex, i) => c(`accent${i + 1}`, hex)).join("")}${c("hlink", "0563C1")}${c("folHlink", "954F72")}</a:clrScheme>`
		+ `<a:fontScheme name="NoteLens"><a:majorFont><a:latin typeface="${palette.major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${palette.minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
		+ `<a:fmtScheme name="NoteLens"><a:fillStyleLst>${fills}${fills}${fills}</a:fillStyleLst><a:lnStyleLst>${lines}${lines}${lines}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fills}${fills}${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
	return parts;
}
