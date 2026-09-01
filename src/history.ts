import { OneNoteDocument } from "./types";

const MAX_UNDO = 100;

/**
 * Snapshot-based undo/redo. Each mutation calls push() with the state
 * captured BEFORE the change; undo/redo swap serialized snapshots.
 */
export class HistoryManager {
	private undoStack: string[] = [];
	private redoStack: string[] = [];

	constructor(
		private getDoc: () => OneNoteDocument,
		private restore: (doc: OneNoteDocument) => void,
		/** Optional ready-made snapshot of the current state (e.g. the last saved payload). */
		private cachedSnapshot: () => string | null = () => null
	) {}

	private serialize(): string {
		return this.cachedSnapshot() ?? JSON.stringify(this.getDoc());
	}

	/** Record the current state before a mutation begins. */
	push(): void {
		this.undoStack.push(this.serialize());
		if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
		this.redoStack = [];
	}

	undo(): boolean {
		if (this.undoStack.length === 0) return false;
		this.redoStack.push(this.serialize());
		const snap = this.undoStack.pop()!;
		this.restore(JSON.parse(snap));
		return true;
	}

	redo(): boolean {
		if (this.redoStack.length === 0) return false;
		this.undoStack.push(this.serialize());
		const snap = this.redoStack.pop()!;
		this.restore(JSON.parse(snap));
		return true;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}

	get canUndo(): boolean { return this.undoStack.length > 0; }
	get canRedo(): boolean { return this.redoStack.length > 0; }
}
