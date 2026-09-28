import { DOC_VERSION, OneNoteDocument } from "./types";

/**
 * Reconciling a board with the copy another device wrote.
 *
 * Every collection in a document is a list of elements with a stable `id`,
 * so two versions can be merged element by element instead of one file
 * winning outright. When the last payload this device wrote (or read) is
 * known it acts as the common ancestor of a three-way merge: an element only
 * one side touched takes that side's version, an element one side deleted and
 * the other left alone goes away, and an edit beats a deletion. Without an
 * ancestor the merge is a union where the local version wins on a shared id.
 */

type Keyed = { id: string };

const COLLECTIONS = ["pages", "strokes", "shapes", "badges", "texts", "tables", "embeds", "bookmarks"] as const;

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function byId<T extends Keyed>(items: T[] | undefined): Map<string, T> {
	const map = new Map<string, T>();
	for (const item of items ?? []) if (item && typeof item.id === "string") map.set(item.id, item);
	return map;
}

/** Merges one collection, keeping the local order and slotting remote additions after their neighbours. */
export function mergeCollection<T extends Keyed>(base: T[] | undefined, local: T[], remote: T[]): T[] {
	const baseMap = byId(base);
	const localMap = byId(local);
	const remoteMap = byId(remote);
	const result: T[] = [];

	for (const item of local) {
		const theirs = remoteMap.get(item.id);
		const ancestor = baseMap.get(item.id);
		if (theirs) {
			if (same(item, theirs)) result.push(item);
			else if (ancestor && same(item, ancestor)) result.push(theirs);
			else result.push(item);
		} else if (!ancestor || !same(item, ancestor)) {
			result.push(item);
		}
	}

	// Remote additions go right after the last element both sides share, in
	// remote order; before any shared element they go on top, at the end.
	let anchor: number | null = null;
	for (const theirs of remote) {
		if (localMap.has(theirs.id)) {
			const index = result.findIndex(item => item.id === theirs.id);
			if (index >= 0) anchor = index;
			continue;
		}
		const ancestor = baseMap.get(theirs.id);
		if (ancestor && same(theirs, ancestor)) continue;
		anchor = anchor === null ? result.length : anchor + 1;
		result.splice(anchor, 0, theirs);
	}
	return result;
}

/** The local document with every collection reconciled against the remote one. */
export function mergeDocuments(base: OneNoteDocument | null, local: OneNoteDocument, remote: OneNoteDocument): OneNoteDocument {
	const merged: OneNoteDocument = { ...local, version: DOC_VERSION };
	for (const key of COLLECTIONS) {
		(merged as unknown as Record<string, Keyed[]>)[key] = mergeCollection(base?.[key] as Keyed[] | undefined, local[key] as Keyed[], remote[key] as Keyed[]);
	}
	if (merged.pages.length === 0) merged.pages = remote.pages.length ? [...remote.pages] : [...local.pages];
	if (!merged.pages.some(page => page.id === merged.activePageId)) merged.activePageId = merged.pages[0].id;
	return merged;
}

/**
 * Sync tools that cannot merge leave a second file next to the original.
 * These are the names they use; the original's path comes back for each.
 */
const CONFLICT_MARKS: RegExp[] = [
	/\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+$/i,          // Syncthing
	/ \([^()]*conflicted copy[^()]*\)$/i,               // Dropbox, Nextcloud, ownCloud
	/ \([^()]*copia en conflicto[^()]*\)$/i,            // Dropbox in Spanish
	/ \(conflicto[^()]*\)$/i                             // what NoteLens itself would write
];

/** The path of the board a conflict copy belongs to, or null for an ordinary file. */
export function conflictOriginal(path: string): string | null {
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	if (dot <= slash + 1) return null;
	const stem = path.slice(0, dot);
	const extension = path.slice(dot);
	for (const mark of CONFLICT_MARKS) {
		const match = mark.exec(stem);
		if (match && match.index > slash + 1) return stem.slice(0, match.index) + extension;
	}
	return null;
}
