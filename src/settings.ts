import { App, PluginSettingTab, Setting } from "obsidian";
import type OneNotePlugin from "./main";
import { BackgroundPattern, DEFAULT_BG_COLOR, DEFAULT_LINE_COLOR, GridSize } from "./types";

/** User preferences: defaults for new boards plus behaviour switches. */
export interface NoteLensSettings {
	defaultBackground: BackgroundPattern;
	defaultPageColor: string;
	defaultLineColor: string;
	defaultGridSize: GridSize;
	penWidth: number;
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
	calculatorDegrees: boolean;
	/** Languages the one-click translator uses on selected text. */
	translateFrom: string;
	translateTo: string;
}

export const DEFAULT_SETTINGS: NoteLensSettings = {
	defaultBackground: "dots",
	defaultPageColor: DEFAULT_BG_COLOR,
	defaultLineColor: DEFAULT_LINE_COLOR,
	defaultGridSize: "medium",
	penWidth: 2.5,
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
	calculatorDegrees: true,
	translateFrom: "es",
	translateTo: "en"
};

export function normalizeSettings(raw: unknown): NoteLensSettings {
	const s = { ...DEFAULT_SETTINGS, ...(typeof raw === "object" && raw ? raw as Partial<NoteLensSettings> : {}) };
	const hex = /^#[0-9a-f]{6}$/i;
	if (!hex.test(s.defaultPageColor)) s.defaultPageColor = DEFAULT_SETTINGS.defaultPageColor;
	if (!hex.test(s.defaultLineColor)) s.defaultLineColor = DEFAULT_SETTINGS.defaultLineColor;
	if (s.penColor !== "auto" && !hex.test(s.penColor)) s.penColor = "auto";
	if (!hex.test(s.highlighterColor)) s.highlighterColor = DEFAULT_SETTINGS.highlighterColor;
	s.penWidth = Math.min(Math.max(Number(s.penWidth) || DEFAULT_SETTINGS.penWidth, 1), 18);
	s.highlighterWidth = Math.min(Math.max(Number(s.highlighterWidth) || DEFAULT_SETTINGS.highlighterWidth, 8), 48);
	s.highlighterOpacity = Math.min(Math.max(Number(s.highlighterOpacity) || DEFAULT_SETTINGS.highlighterOpacity, 0.1), 0.9);
	s.textSize = Math.min(Math.max(Number(s.textSize) || DEFAULT_SETTINGS.textSize, 10), 72);
	if (!["blank", "dots", "grid", "lines", "margin"].includes(s.defaultBackground)) s.defaultBackground = "dots";
	if (!["small", "medium", "large"].includes(s.defaultGridSize)) s.defaultGridSize = "medium";
	return s;
}

export class NoteLensSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: OneNotePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => void this.plugin.saveSettings();

		new Setting(containerEl).setName("Pizarras nuevas").setHeading();

		new Setting(containerEl)
			.setName("Estilo de página")
			.setDesc("Patrón de fondo con el que se crean las pizarras nuevas.")
			.addDropdown(d => d
				.addOptions({ blank: "Liso", dots: "Puntos", grid: "Rejilla", lines: "Rayas", margin: "Con margen" })
				.setValue(s.defaultBackground)
				.onChange(v => { s.defaultBackground = v as BackgroundPattern; save(); }));

		new Setting(containerEl)
			.setName("Tamaño de la cuadrícula")
			.setDesc("Separación entre puntos, líneas o celdas de la rejilla.")
			.addDropdown(d => d
				.addOptions({ small: "Pequeña", medium: "Mediana", large: "Grande" })
				.setValue(s.defaultGridSize)
				.onChange(v => { s.defaultGridSize = v as GridSize; save(); }));

		new Setting(containerEl)
			.setName("Color de página")
			.addColorPicker(c => c.setValue(s.defaultPageColor).onChange(v => { s.defaultPageColor = v; save(); }));

		new Setting(containerEl)
			.setName("Color de las líneas del fondo")
			.addColorPicker(c => c.setValue(s.defaultLineColor).onChange(v => { s.defaultLineColor = v; save(); }));

		new Setting(containerEl).setName("Herramientas").setHeading();

		new Setting(containerEl)
			.setName("Grosor del lápiz")
			.setDesc("Grosor inicial en píxeles.")
			.addSlider(sl => sl.setLimits(1, 18, 0.5).setValue(s.penWidth).setDynamicTooltip().onChange(v => { s.penWidth = v; save(); }));

		new Setting(containerEl)
			.setName("Color del lápiz")
			.setDesc("Con «Automático» la tinta es oscura en páginas claras y clara en páginas oscuras.")
			.addToggle(t => t.setTooltip("Automático").setValue(s.penColor === "auto").onChange(v => {
				s.penColor = v ? "auto" : "#1f2937";
				save();
				this.display();
			}))
			.addColorPicker(c => {
				c.setValue(s.penColor === "auto" ? "#1f2937" : s.penColor).onChange(v => { s.penColor = v; save(); });
				c.setDisabled(s.penColor === "auto");
			});

		new Setting(containerEl)
			.setName("Subrayador")
			.setDesc("Color, grosor y opacidad iniciales.")
			.addColorPicker(c => c.setValue(s.highlighterColor).onChange(v => { s.highlighterColor = v; save(); }))
			.addSlider(sl => sl.setLimits(8, 48, 2).setValue(s.highlighterWidth).setDynamicTooltip().onChange(v => { s.highlighterWidth = v; save(); }))
			.addSlider(sl => sl.setLimits(0.1, 0.9, 0.05).setValue(s.highlighterOpacity).setDynamicTooltip().onChange(v => { s.highlighterOpacity = v; save(); }));

		new Setting(containerEl)
			.setName("Tamaño de texto")
			.addSlider(sl => sl.setLimits(10, 72, 1).setValue(s.textSize).setDynamicTooltip().onChange(v => { s.textSize = v; save(); }));

		new Setting(containerEl)
			.setName("Calculadora en grados")
			.setDesc("Desactívalo para trabajar en radianes por defecto.")
			.addToggle(t => t.setValue(s.calculatorDegrees).onChange(v => { s.calculatorDegrees = v; save(); }));

		new Setting(containerEl).setName("Comportamiento").setHeading();

		new Setting(containerEl)
			.setName("La rueda del ratón hace zoom")
			.setDesc("Desactivado: la rueda desplaza la página y Ctrl+rueda hace zoom, como OneNote.")
			.addToggle(t => t.setValue(s.wheelZooms).onChange(v => { s.wheelZooms = v; save(); }));

		new Setting(containerEl)
			.setName("Dibujar con el dedo")
			.setDesc("Activado: el dedo dibuja con la herramienta activa; dos dedos desplazan y hacen zoom. Desactivado: un dedo siempre desplaza.")
			.addToggle(t => t.setValue(s.fingerDraws).onChange(v => { s.fingerDraws = v; save(); }));

		new Setting(containerEl).setName("Interfaz").setHeading();

		new Setting(containerEl)
			.setName("Mostrar etiquetas rápidas")
			.setDesc("La fila de etiquetas (Importante, Duda, Idea clave…) bajo la barra de dibujo.")
			.addToggle(t => t.setValue(s.showQuickTags).onChange(v => { s.showQuickTags = v; save(); }));

		new Setting(containerEl)
			.setName("Minimapa visible al abrir")
			.addToggle(t => t.setValue(s.showMinimap).onChange(v => { s.showMinimap = v; save(); }));

		new Setting(containerEl)
			.setName("Interfaz compacta")
			.setDesc("Botones más pequeños y barras más estrechas.")
			.addToggle(t => t.setValue(s.compactUi).onChange(v => { s.compactUi = v; save(); }));

		new Setting(containerEl).setName("Traductor").setHeading();

		const languages: Record<string, string> = {
			es: "Español", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português", ca: "Català", eu: "Euskara",
			gl: "Galego", nl: "Nederlands", pl: "Polski", ru: "Русский", uk: "Українська", ar: "العربية", "zh-CN": "中文（简体）", ja: "日本語", ko: "한국어"
		};
		new Setting(containerEl)
			.setName("Traducir de … a …")
			.setDesc("Idiomas que usa el botón Traducir sobre el texto seleccionado (servicio gratuito MyMemory, sin clave).")
			.addDropdown(d => d.addOptions(languages).setValue(s.translateFrom).onChange(v => { s.translateFrom = v; save(); }))
			.addDropdown(d => d.addOptions(languages).setValue(s.translateTo).onChange(v => { s.translateTo = v; save(); }));

		containerEl.createEl("p", { cls: "setting-item-description", text: "Los cambios se aplican a las pizarras que abras a partir de ahora." });
	}
}
