import { Plugin, TFile } from "obsidian";
import { OneNoteCanvasView, VIEW_TYPE_ONENOTE } from "./view";
import { DocumentDefaults, createEmptyDocument } from "./types";
import { DEFAULT_SETTINGS, NoteLensSettingTab, NoteLensSettings, normalizeSettings } from "./settings";

export default class OneNotePlugin extends Plugin {
	settings: NoteLensSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.addSettingTab(new NoteLensSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_ONENOTE,
			(leaf) => new OneNoteCanvasView(leaf, this)
		);

		this.registerExtensions(["notelens", "onenote"], VIEW_TYPE_ONENOTE);

		this.addRibbonIcon("pencil", "Nueva pizarra NoteLens", () => {
			void this.createNewOneNoteFile();
		});

		this.addCommand({
			id: "create-notelens-canvas",
			name: "Crear nueva pizarra NoteLens",
			callback: () => void this.createNewOneNoteFile()
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** What a brand-new board looks like, taken from the settings tab. */
	documentDefaults(): DocumentDefaults {
		const s = this.settings;
		return { background: s.defaultBackground, backgroundColor: s.defaultPageColor, lineColor: s.defaultLineColor, gridSize: s.defaultGridSize };
	}

	async createNewOneNoteFile(): Promise<void> {
		const dateStr = new Date().toISOString().slice(0, 10);
		let fileName = `Pizarra_${dateStr}.notelens`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(fileName)) {
			fileName = `Pizarra_${dateStr}_${n++}.notelens`;
		}

		const file = await this.app.vault.create(fileName, JSON.stringify(createEmptyDocument(this.documentDefaults()), null, 2));
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	}
}
