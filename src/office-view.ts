import { App, FileView, Modal, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from "obsidian";
import { tr } from "./i18n";
import { ImagePickModal } from "./embeds";
import { OfficeEditor, mountOfficeEditor } from "./office-editor";
import { newOfficeFile } from "./office";
import type { OfficeKind } from "./office";
import { TemplateChoice, deckThemes, docTemplates } from "./office-templates";

export const VIEW_TYPE_OFFICE = "notelens-office-view";

/** A Word document or a presentation opened in a tab of its own, like a note. */
export class OfficeFileView extends FileView {
	private editor: OfficeEditor | null = null;
	private cleanups: (() => void)[] = [];

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	override getViewType(): string { return VIEW_TYPE_OFFICE; }
	override getDisplayText(): string { return this.file?.basename ?? "NoteLens"; }
	override getIcon(): string { return this.file?.extension === "pptx" ? "presentation" : "file-text"; }
	override canAcceptExtension(extension: string): boolean { return extension === "docx" || extension === "pptx"; }

	override async onOpen(): Promise<void> {
		await super.onOpen();
		// A change from Obsidian Sync or another program is loaded when nothing here is waiting to be saved.
		this.registerEvent(this.app.vault.on("modify", (changed) => {
			if (!this.file || changed.path !== this.file.path) return;
			window.setTimeout(() => { if (this.file && this.editor?.externalChange()) void this.mountFile(this.file); }, 400);
		}));
	}

	override async onLoadFile(file: TFile): Promise<void> {
		await super.onLoadFile(file);
		await this.mountFile(file);
	}

	private async mountFile(file: TFile): Promise<void> {
		for (const fn of this.cleanups) fn();
		this.cleanups = [];
		this.contentEl.empty();
		this.contentEl.addClass("notelens-office-view");
		const root = this.contentEl.createDiv({ cls: "notelens-office-view-root" });
		const app = this.app as App & { openWithDefaultApp?: (path: string) => Promise<void> };
		this.editor = await mountOfficeEditor(root, {
			app: this.app,
			registerCleanup: (fn) => this.cleanups.push(fn),
			openExternal: (path) => { void app.openWithDefaultApp?.(path); },
			pickImage: (done) => new ImagePickModal(this.app, done).open()
		}, file);
	}

	override async onUnloadFile(file: TFile): Promise<void> {
		await this.editor?.save();
		for (const fn of this.cleanups) fn();
		this.cleanups = [];
		this.editor = null;
		this.contentEl.empty();
		await super.onUnloadFile(file);
	}
}

/** What the new file starts as: a note-taking layout for a document, a look for a presentation. */
export class OfficeTemplateModal extends Modal {
	constructor(app: App, private kind: OfficeKind, private onPick: (variant: string) => void) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.kind === "docx" ? tr("¿Cómo quieres empezar el documento?") : tr("¿Qué aspecto quieres para la presentación?") });
		const choices: TemplateChoice[] = this.kind === "docx" ? docTemplates() : deckThemes();
		for (const choice of choices) {
			const option = contentEl.createDiv({ cls: "notelens-mode-choice" });
			const head = option.createDiv({ cls: "notelens-mode-title" });
			setIcon(head.createSpan({ cls: "notelens-mode-icon" }), choice.icon);
			head.createSpan({ text: ` ${choice.name}` });
			option.createDiv({ cls: "notelens-mode-desc", text: choice.hint });
			option.onclick = () => {
				this.close();
				this.onPick(choice.id);
			};
		}
	}
}

/** The name a new file gets: the template's own for a document, a plain one for a deck. */
export function officeTitle(kind: OfficeKind, variant: string): string {
	if (kind === "pptx") return tr("Presentación sin título");
	if (variant === "blank") return tr("Documento sin título");
	return docTemplates().find(t => t.id === variant)?.name ?? tr("Documento sin título");
}

/** Makes a new document or presentation in a folder of the vault and opens it in a tab. */
export async function createOfficeFile(app: App, kind: OfficeKind, variant: string, folder?: TFolder | null): Promise<TFile | null> {
	try {
		const title = officeTitle(kind, variant);
		const dir = folder && !folder.isRoot() ? `${folder.path}/` : "";
		let path = `${dir}${title}.${kind}`;
		let n = 1;
		while (app.vault.getAbstractFileByPath(path)) path = `${dir}${title} ${n++}.${kind}`;
		const bytes = newOfficeFile(kind, title, variant);
		const file = await app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
		await app.workspace.getLeaf(true).openFile(file);
		return file;
	} catch (error) {
		console.error("NoteLens: could not create the document", error);
		new Notice(tr("No se pudo crear el documento."));
		return null;
	}
}
