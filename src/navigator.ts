import { TFile, setIcon } from "obsidian";
import { makeDraggable, shieldPanel } from "./panels";
import { tr } from "./i18n";

/**
 * Board navigator: every whiteboard in the vault plus a search over Markdown
 * notes, to jump between them or drop a link card on the current board.
 */

export const BOARD_EXTENSIONS = ["notelens", "onenote"];

export interface NavigatorHost {
	currentPath: string | null;
	listBoards(): TFile[];
	listNotes(query: string): TFile[];
	openPath(path: string, newLeaf: boolean): void;
	createBoard(): void;
	linkPath(path: string): void;
}

export function isBoardFile(file: TFile): boolean {
	return BOARD_EXTENSIONS.includes(file.extension.toLowerCase());
}

export function createNavigatorPanel(host: NavigatorHost, container: HTMLElement): { toggle: () => void; isOpen: () => boolean } {
	const panel = container.createDiv({ cls: "notelens-navigator hidden" });
	shieldPanel(panel);

	const header = panel.createDiv({ cls: "notelens-navigator-header" });
	setIcon(header.createSpan({ cls: "notelens-calculator-icon" }), "folder-tree");
	header.createSpan({ cls: "notelens-calculator-title", text: tr("Pizarras y notas") });
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	makeDraggable(panel, header, container, "notelens-navigator-pos");

	const boardsHead = panel.createDiv({ cls: "notelens-navigator-section" });
	boardsHead.createSpan({ cls: "notelens-panel-label", text: tr("Pizarras") });
	const newBoard = boardsHead.createEl("button", { cls: "notelens-navigator-new" });
	setIcon(newBoard.createSpan(), "plus");
	newBoard.createSpan({ text: tr("Nueva") });
	newBoard.title = tr("Crear una pizarra nueva");
	newBoard.onclick = () => host.createBoard();
	const boards = panel.createDiv({ cls: "notelens-navigator-list" });

	const notesHead = panel.createDiv({ cls: "notelens-navigator-section" });
	notesHead.createSpan({ cls: "notelens-panel-label", text: tr("Notas") });
	const search = panel.createEl("input", { cls: "notelens-navigator-search" });
	search.type = "search";
	search.placeholder = tr("Buscar una nota por nombre…");
	const notes = panel.createDiv({ cls: "notelens-navigator-list" });
	panel.createDiv({ cls: "notelens-calculator-help", text: tr("Clic abre en esta pestaña, Ctrl+clic en una nueva. El botón de enlace deja una tarjeta en la pizarra.") });

	const row = (list: HTMLElement, file: TFile, kind: "board" | "note") => {
		const item = list.createDiv({ cls: `notelens-navigator-item notelens-navigator-${kind}` });
		if (host.currentPath === file.path) item.addClass("is-current");
		setIcon(item.createSpan({ cls: "notelens-navigator-icon" }), kind === "board" ? "presentation" : "file-text");
		const body = item.createDiv({ cls: "notelens-navigator-body" });
		body.createDiv({ cls: "notelens-navigator-title", text: file.basename });
		const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
		if (folder) body.createDiv({ cls: "notelens-navigator-folder", text: folder });
		const openBtn = item.createEl("button", { cls: "notelens-table-control notelens-navigator-open" });
		setIcon(openBtn, "external-link");
		openBtn.title = host.currentPath === file.path ? tr("Es la pizarra abierta") : "Abrir";
		openBtn.disabled = host.currentPath === file.path;
		openBtn.onclick = (e) => { e.stopPropagation(); host.openPath(file.path, e.ctrlKey || e.metaKey); };
		const linkBtn = item.createEl("button", { cls: "notelens-table-control notelens-navigator-link" });
		setIcon(linkBtn, "link");
		linkBtn.title = tr("Poner un enlace en la pizarra");
		linkBtn.onclick = (e) => { e.stopPropagation(); host.linkPath(file.path); };
		item.onclick = (e) => { if (host.currentPath !== file.path) host.openPath(file.path, e.ctrlKey || e.metaKey); };
	};

	const refresh = () => {
		boards.empty();
		const boardFiles = host.listBoards();
		if (boardFiles.length === 0) boards.createDiv({ cls: "notelens-bookmarks-empty", text: tr("No hay más pizarras en la bóveda.") });
		for (const file of boardFiles) row(boards, file, "board");
		notes.empty();
		const noteFiles = host.listNotes(search.value);
		if (noteFiles.length === 0) notes.createDiv({ cls: "notelens-bookmarks-empty", text: search.value ? tr("Ninguna nota coincide.") : tr("No hay notas Markdown en la bóveda.") });
		for (const file of noteFiles) row(notes, file, "note");
	};
	search.addEventListener("input", refresh);

	let open = false;
	const toggle = () => {
		open = !open;
		panel.toggleClass("hidden", !open);
		if (open) { refresh(); search.focus(); }
	};
	closeBtn.onclick = toggle;
	return { toggle, isOpen: () => open };
}
