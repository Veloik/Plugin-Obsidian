import { App, TFile } from "obsidian";
import { OneNoteDocument } from "./types";

const SAVE_DEBOUNCE_MS = 350;

/**
 * Debounced writer: coalesces bursts of mutations into a single vault write
 * and supports flush() on view close so nothing is ever lost.
 */
export class PersistenceManager {
	private timer: number | null = null;
	private dirty = false;
	private revision = 0;
	private writeQueue: Promise<void> = Promise.resolve();
	private lastPayload: string | null = null;

	constructor(
		private app: App,
		private getFile: () => TFile | null,
		private onError: (error: unknown) => void = () => {},
		/** The file held something this manager never wrote: another device or a sync tool got there first. */
		private onExternal: (content: string) => void = () => {}
	) {}

	/**
	 * What the file holds right now, as far as this manager knows. Set on load
	 * and whenever an external version is accepted, so a write can tell that
	 * someone else changed the file in the meantime.
	 */
	prime(payload: string | null): void {
		this.lastPayload = payload;
	}

	lastWritten(): string | null {
		return this.lastPayload;
	}

	hasPendingChanges(): boolean {
		return this.dirty;
	}

	/** A cached snapshot belongs to one file only. Call after flushing the old file. */
	reset(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.dirty = false;
		this.lastPayload = null;
		this.revision++;
	}

	scheduleSave(doc: OneNoteDocument): void {
		this.dirty = true;
		this.revision++;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.writeNow(doc);
		}, SAVE_DEBOUNCE_MS);
	}

	/**
	 * The last written payload when it still matches the document, so undo
	 * snapshots can reuse it instead of serializing everything again on each
	 * pen-down. Every mutation calls scheduleSave, which marks it stale.
	 */
	currentPayload(): string | null {
		return this.dirty ? null : this.lastPayload;
	}

	async flush(doc: OneNoteDocument): Promise<boolean> {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.dirty) await this.writeNow(doc);
		else await this.writeQueue;
		return !this.dirty;
	}

	private async writeNow(doc: OneNoteDocument): Promise<void> {
		const file = this.getFile();
		if (!file) return;
		const revision = this.revision;
		const payload = JSON.stringify(doc);
		const job = async () => {
			try {
				// vault.process hands over the current bytes: anything that is neither
				// what we last wrote nor what we are about to write came from outside,
				// and overwriting it would throw away another device's work. The file
				// is left as it is and the owner decides how to reconcile.
				const clash = { content: null as string | null };
				await this.app.vault.process(file, current => {
					if (this.lastPayload !== null && current !== this.lastPayload && current !== payload && current.trim()) {
						clash.content = current;
						return current;
					}
					return payload;
				});
				if (clash.content !== null) {
					this.onExternal(clash.content);
					return;
				}
				// The file now holds this payload whatever happened meanwhile; only
				// the dirty flag depends on nothing having changed since.
				this.lastPayload = payload;
				if (revision === this.revision) this.dirty = false;
			} catch (e) {
				console.error("NoteLens: error saving file", e);
				this.onError(e);
			}
		};
		this.writeQueue = this.writeQueue.then(job, job);
		await this.writeQueue;
	}
}
