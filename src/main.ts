import { VISION_CATALOGUE, parseAssistantActions, rankModels, recommendedVisionModel, visionOptionsFor } from "./assistant";
import { Menu, Plugin, TFolder } from "obsidian";
import { OfficeFileView, OfficeTemplateModal, VIEW_TYPE_OFFICE, createOfficeFile } from "./office-view";
import type { OfficeKind } from "./office";
import { OneNoteCanvasView, VIEW_TYPE_ONENOTE, tidyFormulaText } from "./view";
import { disposePdfWorker } from "./embeds";
import { recognizeFormula } from "./ocr";
import { formulaCandidateScore, recognizeInkFormula } from "./ink-math";
import { runLocalStudyTool } from "./local-intelligence";
import { DocumentDefaults, createEmptyDocument } from "./types";
import { DEFAULT_SETTINGS, NoteLensSettingTab, NoteLensSettings, normalizeSettings } from "./settings";
import { getLocale, setLocale, tr } from "./i18n";
import { loadInkMemory } from "./ink-memory";

export default class OneNotePlugin extends Plugin {
	override settings: NoteLensSettings = { ...DEFAULT_SETTINGS };

	override async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		setLocale(this.settings.language);
		loadInkMemory(this.settings.inkMemory, (packed) => {
			this.settings.inkMemory = packed;
			void this.saveSettings();
		});
		this.addSettingTab(new NoteLensSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_ONENOTE,
			(leaf) => new OneNoteCanvasView(leaf, this)
		);

		this.registerExtensions(["notelens", "onenote"], VIEW_TYPE_ONENOTE);

		// Word documents and presentations open in a tab of their own, like a note.
		this.registerView(VIEW_TYPE_OFFICE, (leaf) => new OfficeFileView(leaf));
		this.registerExtensions(["docx", "pptx"], VIEW_TYPE_OFFICE);

		this.addRibbonIcon("pencil", tr("Nueva pizarra NoteLens"), () => {
			void this.createNewOneNoteFile();
		});

		this.addRibbonIcon("file-plus-2", tr("Documento nuevo"), (event) => {
			const menu = new Menu();
			menu.addItem(item => item.setTitle(tr("Documento de Word")).setIcon("file-text").onClick(() => this.newOffice("docx")));
			menu.addItem(item => item.setTitle(tr("Presentación de PowerPoint")).setIcon("presentation").onClick(() => this.newOffice("pptx")));
			menu.showAtMouseEvent(event);
		});
		this.addCommand({
			id: "create-word-document",
			name: tr("Nuevo documento de Word"),
			callback: () => this.newOffice("docx")
		});
		this.addCommand({
			id: "create-presentation",
			name: tr("Nueva presentación"),
			callback: () => this.newOffice("pptx")
		});

		this.addCommand({
			id: "create-canvas",
			// Obsidian already prefixes commands with the plugin name.
			name: tr("Crear nueva pizarra"),
			callback: () => void this.createNewOneNoteFile()
		});

		// Right-clicking a folder — or holding it down on a phone or tablet — is
		// where Obsidian offers "New note" and "New folder"; a board belongs in
		// the same place, and it is the only way to make one without a ribbon.
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFolder)) return;
			menu.addItem(item => item
				.setTitle(tr("Nueva pizarra NoteLens"))
				.setIcon("pencil")
				.onClick(() => void this.createNewOneNoteFile(file)));
			menu.addItem(item => item
				.setTitle(tr("Nuevo documento de Word"))
				.setIcon("file-text")
				.onClick(() => this.newOffice("docx", file)));
			menu.addItem(item => item
				.setTitle(tr("Nueva presentación"))
				.setIcon("presentation")
				.onClick(() => this.newOffice("pptx", file)));
		}));
	}

	override onunload(): void {
		disposePdfWorker();
	}

	/** Boards currently on screen, kept by the views themselves. */
	readonly openBoards = new Set<OneNoteCanvasView>();

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		setLocale(this.settings.language);
		// Apply them to the boards that are already open, instead of waiting for
		// the user to close and reopen every one of them. Never let a workspace
		// quirk stop the settings from being saved.
		// Every open board registers itself, so this never depends on leaf types
		// or on instanceof surviving a plugin reload.
		for (const board of [...this.openBoards]) {
			try {
				board.refreshFromSettings();
			} catch (error) {
				console.warn("NoteLens: no he podido refrescar una pizarra", error);
			}
		}
	}

	/** What a brand-new board looks like, taken from the settings tab. */
	documentDefaults(): DocumentDefaults {
		const s = this.settings;
		return { background: s.defaultBackground, marginEnabled: s.defaultMargin, backgroundColor: s.defaultPageColor, lineColor: s.defaultLineColor, gridSize: s.defaultGridSize };
	}

	/** Creates a board inside `folder`, or at the root of the vault without one. */
	/** Asks how the new document or presentation should start, makes it and opens it. */
	newOffice(kind: OfficeKind, folder?: TFolder): void {
		new OfficeTemplateModal(this.app, kind, (variant) => void createOfficeFile(this.app, kind, variant, folder)).open();
	}

	async createNewOneNoteFile(folder?: TFolder): Promise<void> {
		const dateStr = new Date().toISOString().slice(0, 10);
		const dir = folder && !folder.isRoot() ? `${folder.path}/` : "";
		// The name of the file itself, which is not the same word as the "Board"
		// tab inside a tag: a board is called a Dashboard in the English build.
		const base = `${getLocale() === "es" ? "Pizarra" : "Dashboard"}_${dateStr}`;
		let fileName = `${dir}${base}.notelens`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(fileName)) {
			fileName = `${dir}${base}_${n++}.notelens`;
		}

		const file = await this.app.vault.create(fileName, JSON.stringify(createEmptyDocument(this.documentDefaults()), null, 2));
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	}
}

// Exposed for the dev harness so the ranking helpers can be tested directly.
export const __assistantTest = {
	rankModels, recommendedVisionModel, parseAssistantActions, visionOptionsFor, VISION_CATALOGUE,
	tidyFormulaText, recognizeFormula, recognizeInkFormula, formulaCandidateScore, runLocalStudyTool
};
