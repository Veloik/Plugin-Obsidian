import { App, TFile, normalizePath } from "obsidian";
import { Zippable, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { OneNoteDocument, migrateDocument } from "./types";
import { tr } from "./i18n";

const PACKAGE_FORMAT = "notelens-share";
const PACKAGE_VERSION = 1;

interface PackageAsset {
	/** Original vault-relative source path, used to relink the imported document. */
	source: string;
	/** Private ZIP entry name. This never becomes a path in the recipient's vault. */
	entry: string;
}

interface SharePackage {
	format: typeof PACKAGE_FORMAT;
	packageVersion: number;
	title: string;
	exportedAt: string;
	document: OneNoteDocument;
	assets: PackageAsset[];
}

export interface ShareBuildResult {
	bytes: ArrayBuffer;
	assetCount: number;
	skippedAssets: string[];
}

export interface ShareImportResult {
	file: TFile;
	assetCount: number;
	missingAssets: string[];
}

/** fflate returns views into one shared buffer; the vault API needs a buffer of its own. */
function ownBuffer(view: Uint8Array): ArrayBuffer {
	return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function safeFileName(value: string, fallback: string): string {
	const clean = value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/^\.+/, "").trim();
	return clean || fallback;
}

function fileNameFromPath(path: string, fallback: string): string {
	return safeFileName(path.split("/").pop() || "", fallback);
}

function isRemoteSource(path: string): boolean {
	return /^(https?:)?\/\//i.test(path) || /^data:/i.test(path);
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const parent = path.split("/").slice(0, -1).join("/");
	if (parent && !app.vault.getAbstractFileByPath(parent)) {
		await app.vault.createFolder(parent).catch(() => { /* already created by another import */ });
	}
}

async function uniquePath(app: App, rawPath: string): Promise<string> {
	const path = normalizePath(rawPath);
	const slash = path.lastIndexOf("/");
	const folder = slash >= 0 ? path.slice(0, slash + 1) : "";
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	let candidate = `${folder}${name}`;
	let suffix = 2;
	while (app.vault.getAbstractFileByPath(candidate)) candidate = `${folder}${stem} ${suffix++}${extension}`;
	return candidate;
}

/** Creates a portable, editable NoteLens package with every locally available attachment. */
export async function buildSharePackage(app: App, document: OneNoteDocument, title: string): Promise<ShareBuildResult> {
	const files: Zippable = {};
	const assets: PackageAsset[] = [];
	const added = new Set<string>();
	const skippedAssets: string[] = [];

	const addAsset = async (source?: string): Promise<void> => {
		if (!source || isRemoteSource(source) || added.has(source)) return;
		added.add(source);
		const file = app.vault.getAbstractFileByPath(source);
		if (!(file instanceof TFile)) {
			skippedAssets.push(source);
			return;
		}
		const entry = `assets/${String(assets.length + 1).padStart(3, "0")}-${fileNameFromPath(file.path, "adjunto")}`;
		files[entry] = new Uint8Array(await app.vault.readBinary(file));
		assets.push({ source, entry });
	};

	for (const embed of document.embeds) {
		await addAsset(embed.src);
		await addAsset(embed.captionSrc);
	}

	const manifest: SharePackage = {
		format: PACKAGE_FORMAT,
		packageVersion: PACKAGE_VERSION,
		title: safeFileName(title, tr("Pizarra NoteLens")),
		exportedAt: new Date().toISOString(),
		document,
		assets
	};
	files["notelens.json"] = strToU8(JSON.stringify(manifest));
	return {
		bytes: ownBuffer(zipSync(files, { level: 6 })),
		assetCount: assets.length,
		skippedAssets
	};
}

function parsePackage(raw: unknown): SharePackage {
	const value = raw as Partial<SharePackage>;
	if (!value || value.format !== PACKAGE_FORMAT || value.packageVersion !== PACKAGE_VERSION || !value.document) {
		throw new Error("El archivo no es un paquete compatible de NoteLens.");
	}
	return {
		format: PACKAGE_FORMAT,
		packageVersion: PACKAGE_VERSION,
		title: typeof value.title === "string" ? value.title : tr("Pizarra importada"),
		exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
		document: migrateDocument(value.document),
		assets: Array.isArray(value.assets)
			? value.assets.filter((asset): asset is PackageAsset => typeof asset?.source === "string" && typeof asset?.entry === "string")
			: []
	};
}

async function attachmentPathFor(app: App, name: string, boardPath: string, fallbackFolder: string): Promise<string> {
	try {
		const available = await (app.fileManager as any).getAvailablePathForAttachment(name, boardPath);
		return normalizePath(available);
	} catch {
		return uniquePath(app, `${fallbackFolder}/Adjuntos NoteLens/${name}`);
	}
}

/** Imports a package as a new editable canvas, keeping its bundled files in the recipient's vault. */
export async function importSharePackage(app: App, source: File, destinationFolder = ""): Promise<ShareImportResult> {
	const entries = unzipSync(new Uint8Array(await source.arrayBuffer()));
	const manifestEntry = entries["notelens.json"];
	if (!manifestEntry) throw new Error("No se encontró el documento de NoteLens dentro del paquete.");
	const manifest = parsePackage(JSON.parse(strFromU8(manifestEntry)));
	const folder = destinationFolder.replace(/^\/+|\/+$/g, "");
	const boardName = safeFileName(manifest.title, "Pizarra importada").replace(/\.(notelens|onenote)$/i, "");
	const boardPath = await uniquePath(app, `${folder ? `${folder}/` : ""}${boardName}.notelens`);
	await ensureParentFolder(app, boardPath);
	const board = await app.vault.create(boardPath, JSON.stringify(manifest.document, null, 2));

	const remapped = new Map<string, string>();
	const missingAssets: string[] = [];
	for (const asset of manifest.assets) {
		const entry = entries[asset.entry];
		if (!entry) {
			missingAssets.push(asset.source);
			continue;
		}
		const name = fileNameFromPath(asset.source, "adjunto");
		let path = await attachmentPathFor(app, name, board.path, folder);
		path = await uniquePath(app, path);
		try {
			await ensureParentFolder(app, path);
			const imported = await app.vault.createBinary(path, ownBuffer(entry));
			remapped.set(asset.source, imported.path);
		} catch (error) {
			console.error("NoteLens: could not import shared attachment", asset.source, error);
			missingAssets.push(asset.source);
		}
	}

	for (const embed of manifest.document.embeds) {
		embed.src = remapped.get(embed.src) ?? embed.src;
		if (embed.captionSrc) embed.captionSrc = remapped.get(embed.captionSrc) ?? embed.captionSrc;
	}
	await app.vault.modify(board, JSON.stringify(manifest.document, null, 2));
	return { file: board, assetCount: remapped.size, missingAssets };
}
