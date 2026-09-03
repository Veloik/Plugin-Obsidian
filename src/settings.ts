import { requestUrl, Notice, App, PluginSettingTab, Setting } from "obsidian";
import type OneNotePlugin from "./main";
import { BackgroundPattern, CanvasFont, DEFAULT_BG_COLOR, DEFAULT_LINE_COLOR, GridSize, PenStyle } from "./types";
import { LocaleSetting, setLocale, tr } from "./i18n";
import { detectMemoryGb, rankModels, recommendedVisionModel } from "./assistant";

/** User preferences: defaults for new boards plus behaviour switches. */
export interface NoteLensSettings {
	defaultBackground: BackgroundPattern;
	defaultMargin: boolean;
	defaultPageColor: string;
	defaultLineColor: string;
	defaultGridSize: GridSize;
	penWidth: number;
	/** Nib used by the pen tool. */
	penStyle: PenStyle;
	/** Hex color, or "auto" to follow the page tone. */
	penColor: string;
	highlighterColor: string;
	highlighterWidth: number;
	highlighterOpacity: number;
	textSize: number;
	/** Plain wheel zooms instead of scrolling the page. */
	wheelZooms: boolean;
	/** Fingers draw with the active tool instead of panning. */
	fingerDraws: boolean;
	showQuickTags: boolean;
	showMinimap: boolean;
	compactUi: boolean;
	/** Interface language; "auto" follows Obsidian's own setting. */
	language: LocaleSetting;
	calculatorDegrees: boolean;
	/** Local model server for the assistant pet, e.g. http://localhost:11434 */
	aiBaseUrl: string;
	/** Model the assistant runs; empty picks the first one the server offers. */
	aiModel: string;
	/** Show the assistant pet on the board. */
	showAssistantPet: boolean;
	/** What the assistant pet is called. */
	assistantName: string;
	/** Where the pet sits, as a fraction of the board (0..1); null keeps the default corner. */
	petX: number | null;
	petY: number | null;
	/** How big the pet is drawn, 0.6 to 1.6. */
	petScale: number;
	/** Leen greets you with a speech bubble when you hover him. */
	petBubbles: boolean;
	/** Send the board's text to the model without ticking the box every time. */
	aiUseBoardContext: boolean;
	/** Default font for new text boxes. */
	defaultTextFont: CanvasFont;
	/** Colour a new sticky note starts with. */
	defaultStickyColor: string;
	/** Language the board reader expects when transcribing handwriting and images. */
	ocrLanguage: string;
	/** Never fall back to the web translator, so nothing depends on a quota. */
	translationLocalOnly: boolean;
	/** Languages the one-click translator uses on selected text. */
	translateFrom: string;
	translateTo: string;
}

export const DEFAULT_SETTINGS: NoteLensSettings = {
	defaultBackground: "dots",
	defaultMargin: false,
	defaultPageColor: DEFAULT_BG_COLOR,
	defaultLineColor: DEFAULT_LINE_COLOR,
	defaultGridSize: "medium",
	penWidth: 2.5,
	penStyle: "ballpoint",
	penColor: "auto",
	highlighterColor: "#facc15",
	highlighterWidth: 24,
	highlighterOpacity: 0.5,
	textSize: 20,
	wheelZooms: false,
	fingerDraws: false,
	showQuickTags: true,
	showMinimap: false,
	compactUi: false,
	language: "auto",
	calculatorDegrees: true,
	aiBaseUrl: "http://127.0.0.1:11434",
	aiModel: "",
	showAssistantPet: true,
	assistantName: "Leen",
	petX: null,
	petY: null,
	petScale: 1,
	petBubbles: true,
	aiUseBoardContext: false,
	defaultTextFont: "sans",
	defaultStickyColor: "#fff2a8",
	ocrLanguage: "es",
	translationLocalOnly: true,
	translateFrom: "es",
	translateTo: "en"
};

export function normalizeSettings(raw: unknown): NoteLensSettings {
	const s = { ...DEFAULT_SETTINGS, ...(typeof raw === "object" && raw ? raw as Partial<NoteLensSettings> : {}) };
	const hex = /^#[0-9a-f]{6}$/i;
	if (!hex.test(s.defaultPageColor)) s.defaultPageColor = DEFAULT_SETTINGS.defaultPageColor;
	if (!hex.test(s.defaultLineColor)) s.defaultLineColor = DEFAULT_SETTINGS.defaultLineColor;
	if (s.penColor !== "auto" && !hex.test(s.penColor)) s.penColor = "auto";
	if (!["auto", "es", "en"].includes(s.language)) s.language = "auto";
	if (!["ballpoint", "pencil", "fountain", "marker", "brush"].includes(s.penStyle)) s.penStyle = "ballpoint";
	if (typeof s.aiBaseUrl !== "string" || !/^https?:\/\//i.test(s.aiBaseUrl)) s.aiBaseUrl = DEFAULT_SETTINGS.aiBaseUrl;
	if (typeof s.aiModel !== "string") s.aiModel = "";
	s.showAssistantPet = s.showAssistantPet !== false;
	if (typeof s.assistantName !== "string" || !s.assistantName.trim()) s.assistantName = DEFAULT_SETTINGS.assistantName;
	// The pet was renamed; anyone still on the old default follows along.
	if (s.assistantName.trim() === "Canela") s.assistantName = DEFAULT_SETTINGS.assistantName;
	s.assistantName = s.assistantName.trim().slice(0, 24);
	const fraction = (value: unknown) => typeof value === "number" && isFinite(value) ? Math.min(Math.max(value, 0), 1) : null;
	s.petX = fraction(s.petX);
	s.petY = fraction(s.petY);
	s.petScale = typeof s.petScale === "number" && isFinite(s.petScale) ? Math.min(Math.max(s.petScale, 0.6), 1.6) : 1;
	s.petBubbles = s.petBubbles !== false;
	s.aiUseBoardContext = s.aiUseBoardContext === true;
	if (typeof s.ocrLanguage !== "string" || !s.ocrLanguage) s.ocrLanguage = DEFAULT_SETTINGS.ocrLanguage;
	s.translationLocalOnly = s.translationLocalOnly === true;
	if (!["sans", "serif", "rounded", "mono"].includes(s.defaultTextFont)) s.defaultTextFont = "sans";
	if (!hex.test(s.defaultStickyColor)) s.defaultStickyColor = DEFAULT_SETTINGS.defaultStickyColor;
	if (!hex.test(s.highlighterColor)) s.highlighterColor = DEFAULT_SETTINGS.highlighterColor;
	s.penWidth = Math.min(Math.max(Number(s.penWidth) || DEFAULT_SETTINGS.penWidth, 1), 18);
	s.highlighterWidth = Math.min(Math.max(Number(s.highlighterWidth) || DEFAULT_SETTINGS.highlighterWidth, 8), 48);
	s.highlighterOpacity = Math.min(Math.max(Number(s.highlighterOpacity) || DEFAULT_SETTINGS.highlighterOpacity, 0.1), 0.9);
	s.textSize = Math.min(Math.max(Number(s.textSize) || DEFAULT_SETTINGS.textSize, 10), 72);
	const legacyMargin = s.defaultBackground === "margin";
	if (legacyMargin) s.defaultBackground = "lines";
	else if (!["blank", "dots", "grid", "lines"].includes(s.defaultBackground)) s.defaultBackground = "dots";
	s.defaultMargin = legacyMargin || s.defaultMargin === true;
	if (!["small", "medium", "large"].includes(s.defaultGridSize)) s.defaultGridSize = "medium";
	return s;
}

/** Asks a local server for its models; null means nothing answered. */
async function probeLocalServer(base: string): Promise<string[] | null> {
	const alternatives = [base];
	if (base.includes("//localhost")) alternatives.push(base.replace("//localhost", "//127.0.0.1"));
	else if (base.includes("//127.0.0.1")) alternatives.push(base.replace("//127.0.0.1", "//localhost"));
	for (const candidate of alternatives) {
		const found = await probeOne(candidate);
		if (found) return found;
	}
	return null;
}

async function probeOne(base: string): Promise<string[] | null> {
	for (const [url, pick] of [
		[`${base}/api/tags`, (json: any) => json?.models?.map((m: { name?: string }) => m.name)],
		[`${base}/v1/models`, (json: any) => json?.data?.map((m: { id?: string }) => m.id)]
	] as [string, (json: unknown) => (string | undefined)[] | undefined][]) {
		try {
			const origin = /^https?:\/\/[^/]+/i.exec(url)?.[0] ?? "";
			const response = await requestUrl({ url, method: "GET", headers: { Origin: origin, Referer: `${origin}/` }, throw: false });
			const names = pick(response.json);
			if (response.status < 400 && Array.isArray(names)) return names.filter((name): name is string => !!name);
		} catch { /* try the next shape */ }
	}
	return null;
}

declare const __NOTELENS_BUILD__: string;
/** Release version injected by esbuild; "desconocida" when running from source. */
const NOTELENS_BUILD = typeof __NOTELENS_BUILD__ === "string" ? __NOTELENS_BUILD__ : "desconocida";

export class NoteLensSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: OneNotePlugin) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => void this.plugin.saveSettings();

		// If this line is older than your last build, Obsidian is still running
		// the previous copy: disable and re-enable the plugin to load the new one.
		const stamp = containerEl.createDiv({ cls: "setting-item-description notelens-build-stamp" });
		stamp.setText(tr("NoteLens · versión cargada: {p0}", { p0: NOTELENS_BUILD }));

		new Setting(containerEl)
			.setName(tr("Idioma"))
			.setDesc(tr("«Automático» sigue el idioma de Obsidian. Las pizarras abiertas se actualizan al cambiarlo."))
			.addDropdown(d => d
				.addOptions({ auto: tr("Automático"), es: "Español", en: "English" })
				.setValue(s.language)
				.onChange(v => {
					s.language = v as LocaleSetting;
					setLocale(s.language);
					save();
					// Redraw the tab itself so the change is visible at once.
					this.display();
				}));

		new Setting(containerEl).setName(tr("Pizarras nuevas")).setHeading();

		new Setting(containerEl)
			.setName(tr("Estilo de página"))
			.setDesc(tr("Patrón de fondo con el que se crean las pizarras nuevas."))
			.addDropdown(d => d
				.addOptions({ blank: "Liso", dots: "Puntos", grid: "Rejilla", lines: "Rayas" })
				.setValue(s.defaultBackground)
				.onChange(v => { s.defaultBackground = v as BackgroundPattern; save(); }));

		new Setting(containerEl)
			.setName(tr("Margen izquierdo"))
			.setDesc(tr("Guía independiente que puede combinarse con cualquier estilo de página."))
			.addToggle(toggle => toggle.setValue(s.defaultMargin).onChange(value => { s.defaultMargin = value; save(); }));

		new Setting(containerEl)
			.setName(tr("Tamaño de la cuadrícula"))
			.setDesc(tr("Separación entre puntos, líneas o celdas de la rejilla."))
			.addDropdown(d => d
				.addOptions({ small: tr("Pequeña"), medium: tr("Mediana"), large: tr("Grande") })
				.setValue(s.defaultGridSize)
				.onChange(v => { s.defaultGridSize = v as GridSize; save(); }));

		new Setting(containerEl)
			.setName(tr("Color de página"))
			.addColorPicker(c => c.setValue(s.defaultPageColor).onChange(v => { s.defaultPageColor = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Color de las líneas del fondo"))
			.addColorPicker(c => c.setValue(s.defaultLineColor).onChange(v => { s.defaultLineColor = v; save(); }));

		new Setting(containerEl).setName(tr("Herramientas")).setHeading();

		new Setting(containerEl)
			.setName(tr("Grosor del lápiz"))
			.setDesc(tr("Grosor inicial en píxeles."))
			.addSlider(sl => sl.setLimits(1, 18, 0.5).setValue(s.penWidth).setDynamicTooltip().onChange(v => { s.penWidth = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Color del lápiz"))
			.setDesc(tr("Con «Automático» la tinta es oscura en páginas claras y clara en páginas oscuras."))
			.addToggle(t => t.setTooltip(tr("Automático")).setValue(s.penColor === "auto").onChange(v => {
				s.penColor = v ? "auto" : "#1f2937";
				save();
				this.display();
			}))
			.addColorPicker(c => {
				c.setValue(s.penColor === "auto" ? "#1f2937" : s.penColor).onChange(v => { s.penColor = v; save(); });
				c.setDisabled(s.penColor === "auto");
			});

		new Setting(containerEl)
			.setName(tr("Subrayador"))
			.setDesc(tr("Color, grosor y opacidad iniciales."))
			.addColorPicker(c => c.setValue(s.highlighterColor).onChange(v => { s.highlighterColor = v; save(); }))
			.addSlider(sl => sl.setLimits(8, 48, 2).setValue(s.highlighterWidth).setDynamicTooltip().onChange(v => { s.highlighterWidth = v; save(); }))
			.addSlider(sl => sl.setLimits(0.1, 0.9, 0.05).setValue(s.highlighterOpacity).setDynamicTooltip().onChange(v => { s.highlighterOpacity = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Tamaño de texto"))
			.addSlider(sl => sl.setLimits(10, 72, 1).setValue(s.textSize).setDynamicTooltip().onChange(v => { s.textSize = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Punta del lápiz"))
			.setDesc(tr("Trazo con el que empieza la herramienta de lápiz."))
			.addDropdown(d => d
				.addOptions({ ballpoint: tr("Bolígrafo"), pencil: tr("Lápiz"), fountain: tr("Pluma"), marker: tr("Rotulador"), brush: tr("Pincel") })
				.setValue(s.penStyle)
				.onChange(v => { s.penStyle = v as PenStyle; save(); }));

		new Setting(containerEl)
			.setName(tr("Fuente del texto"))
			.setDesc(tr("Tipografía con la que se crean los cuadros de texto."))
			.addDropdown(d => d
				.addOptions({ sans: tr("Sin remates"), serif: tr("Con remates"), rounded: tr("Redondeada"), mono: tr("Monoespaciada") })
				.setValue(s.defaultTextFont)
				.onChange(v => { s.defaultTextFont = v as CanvasFont; save(); }));

		new Setting(containerEl)
			.setName(tr("Color de las notas adhesivas"))
			.setDesc(tr("Papel con el que nace cada posit nuevo."))
			.addDropdown(d => d
				.addOptions({ "#fff2a8": "Amarillo", "#ffd9a0": "Naranja", "#ffd7e5": "Rosa", "#d8f5c9": "Verde", "#cde8ff": "Azul", "#eadbff": "Lila", "#f4f1e8": "Blanco roto" })
				.setValue(s.defaultStickyColor)
				.onChange(v => { s.defaultStickyColor = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Calculadora en grados"))
			.setDesc(tr("Desactívalo para trabajar en radianes por defecto."))
			.addToggle(t => t.setValue(s.calculatorDegrees).onChange(v => { s.calculatorDegrees = v; save(); }));

		new Setting(containerEl).setName(tr("Comportamiento")).setHeading();

		new Setting(containerEl)
			.setName(tr("La rueda del ratón hace zoom"))
			.setDesc(tr("Desactivado: la rueda desplaza la página y Ctrl+rueda hace zoom, como OneNote."))
			.addToggle(t => t.setValue(s.wheelZooms).onChange(v => { s.wheelZooms = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Dibujar con el dedo"))
			.setDesc(tr("Activado: el dedo dibuja con la herramienta activa; dos dedos desplazan y hacen zoom. Desactivado: un dedo siempre desplaza."))
			.addToggle(t => t.setValue(s.fingerDraws).onChange(v => { s.fingerDraws = v; save(); }));

		new Setting(containerEl).setName(tr("Interfaz")).setHeading();

		new Setting(containerEl)
			.setName(tr("Mostrar etiquetas rápidas"))
			.setDesc(tr("La fila de etiquetas (Importante, Duda, Idea clave…) bajo la barra de dibujo."))
			.addToggle(t => t.setValue(s.showQuickTags).onChange(v => { s.showQuickTags = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Minimapa visible al abrir"))
			.addToggle(t => t.setValue(s.showMinimap).onChange(v => { s.showMinimap = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Interfaz compacta"))
			.setDesc(tr("Botones más pequeños y barras más estrechas."))
			.addToggle(t => t.setValue(s.compactUi).onChange(v => { s.compactUi = v; save(); }));

		new Setting(containerEl).setName(tr("Ayudante Leen")).setHeading();

		new Setting(containerEl)
			.setName(tr("Mostrar a Leen"))
			.setDesc(tr("Abre acciones rápidas para resumir, crear tareas, ordenar objetos y leer fórmulas. El chat local es opcional."))
			.addToggle(t => t.setValue(s.showAssistantPet).onChange(v => {
				s.showAssistantPet = v;
				save();
				this.display();
			}));

		if (s.showAssistantPet) {
			new Setting(containerEl)
				.setName(tr("Tamaño de Leen"))
				.setDesc(tr("Más pequeño estorba menos; más grande se toca mejor en una tableta."))
				.addSlider(sl => sl.setLimits(0.6, 1.6, 0.1).setValue(s.petScale).setDynamicTooltip().onChange(v => { s.petScale = v; save(); }));

			new Setting(containerEl)
				.setName(tr("Bocadillos de Leen"))
				.setDesc(tr("El aviso que aparece al pasar el ratón por encima."))
				.addToggle(t => t.setValue(s.petBubbles).onChange(v => { s.petBubbles = v; save(); }));

			new Setting(containerEl)
				.setName(tr("Devolver a Leen a su sitio"))
				.setDesc(tr("Vuelve a la esquina inferior derecha si lo has arrastrado fuera de la vista."))
				.addButton(b => b.setButtonText(tr("Restablecer posición")).onClick(() => {
					s.petX = null;
					s.petY = null;
					save();
					new Notice(tr("Leen volverá a su esquina al reabrir la pizarra"));
				}));

		}

		// The local model is not the pet's: the translator asks the same server,
		// so these settings stay visible whether or not Leen is on the board.
		new Setting(containerEl).setName(tr("Modelo local")).setHeading();

		const aiIntro = containerEl.createDiv({ cls: "setting-item-description notelens-settings-note" });
		aiIntro.createDiv({ text: tr("La pizarra entera funciona sin modelo: resumen, ideas clave, plan de repaso, esquema, tarjetas, limpieza de texto, pulido de tinta y Pizarra → LaTeX se calculan aquí mismo.") });
		aiIntro.createDiv({ text: tr("Un modelo local solo hace falta para dos cosas opcionales: el chat con Leen y la traducción sin cuotas. Nada sale de tu equipo en ninguno de los dos casos.") });

		const memory = detectMemoryGb();
		const suggestion = recommendedVisionModel(memory);
		const aiStatus = containerEl.createDiv({ cls: "notelens-settings-status" });
		const paintStatus = (text: string, kind: "info" | "ok" | "error" = "info") => {
			aiStatus.setText(text);
			aiStatus.toggleClass("is-ok", kind === "ok");
			aiStatus.toggleClass("is-error", kind === "error");
		};
		paintStatus(tr("Sin comprobar. Tu equipo declara {p0} GB de RAM; para chat con dibujos encaja «{p1}».", { p0: memory, p1: suggestion.model }));

		new Setting(containerEl)
			.setName(tr("Servidor"))
			.setDesc(tr("Ollama o LM Studio en tu propio equipo. Si «localhost» no responde, prueba con 127.0.0.1."))
			.addText(t => t
				.setPlaceholder(tr("http://127.0.0.1:11434"))
				.setValue(s.aiBaseUrl)
				.onChange(v => { s.aiBaseUrl = v.trim() || DEFAULT_SETTINGS.aiBaseUrl; save(); }))
			.addButton(b => b.setButtonText(tr("Probar")).onClick(async () => {
				const base = s.aiBaseUrl.replace(/\/+$/, "");
				b.setButtonText(tr("Probando…"));
				b.setDisabled(true);
				const models = await probeLocalServer(base);
				b.setButtonText(tr("Probar"));
				b.setDisabled(false);
				if (models === null) {
					paintStatus(tr("Sin respuesta en {p0}. Arranca el servidor (por ejemplo «ollama serve») y vuelve a probar.", { p0: base }), "error");
					return;
				}
				if (!models.length) {
					paintStatus(tr("Responde, pero no tiene ningún modelo. Descarga uno: {p0}", { p0: suggestion.pull }), "error");
					return;
				}
				// Ranking answers the question the raw list does not: which of
				// these actually suits this computer.
				const best = rankModels(models, memory)[0];
				paintStatus(tr("Conectado · {p0} modelo(s). Leen usaría «{p1}»: {p2}", { p0: models.length, p1: best?.model ?? models[0], p2: best?.reason ?? "" }), "ok");
			}));

		new Setting(containerEl)
			.setName(tr("Modelo preferido"))
			.setDesc(tr("Vacío = el mejor que quepa en tu memoria. Para leer lo que dibujas hace falta uno multimodal, como «{p0}» ({p1}).", { p0: suggestion.model, p1: suggestion.why }))
			.addText(t => t
				.setPlaceholder(tr("automático"))
				.setValue(s.aiModel)
				.onChange(v => { s.aiModel = v.trim(); save(); }));

		new Setting(containerEl)
			.setName(tr("Usar la pizarra como contexto"))
			.setDesc(tr("Marca la casilla del chat desde el principio, para preguntar siempre sobre tus apuntes."))
			.addToggle(t => t.setValue(s.aiUseBoardContext).onChange(v => { s.aiUseBoardContext = v; save(); }));

		new Setting(containerEl).setName(tr("Traductor")).setHeading();

		const languages: Record<string, string> = {
			es: "Español", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português", ca: "Català", eu: "Euskara",
			gl: "Galego", nl: "Nederlands", pl: "Polski", ru: "Русский", uk: "Українська", ar: "العربية", "zh-CN": "中文（简体）", ja: "日本語", ko: "한국어"
		};
		new Setting(containerEl)
			.setName(tr("Traducir solo con el modelo local"))
			.setDesc(tr("Activado por defecto: el texto no sale de tu ordenador y no hay cuotas. Necesitas un modelo local descargado."))
			.addToggle(t => t.setValue(s.translationLocalOnly).onChange(v => { s.translationLocalOnly = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Idioma de la transcripción"))
			.setDesc(tr("Idioma que espera el lector de la pizarra al reconocer texto escrito a mano o dentro de imágenes."))
			.addDropdown(d => d.addOptions(languages).setValue(s.ocrLanguage).onChange(v => { s.ocrLanguage = v; save(); }));

		new Setting(containerEl)
			.setName(tr("Traducir de … a …"))
			.setDesc(tr("Idiomas que usa el botón Traducir sobre el texto seleccionado (servicio gratuito MyMemory, sin clave)."))
			.addDropdown(d => d.addOptions(languages).setValue(s.translateFrom).onChange(v => { s.translateFrom = v; save(); }))
			.addDropdown(d => d.addOptions(languages).setValue(s.translateTo).onChange(v => { s.translateTo = v; save(); }));

		containerEl.createEl("p", { cls: "setting-item-description", text: tr("Las herramientas, la interfaz y Leen cambian al momento en las pizarras abiertas. Lo que hay bajo «Pizarras nuevas» solo afecta a las que crees a partir de ahora.") });
	}
}
