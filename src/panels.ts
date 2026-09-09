import { App } from "obsidian";

/**
 * Shared behaviour for the floating panels (calculator, translator, …):
 * drag by a handle, stay inside the workspace, remember where they were left.
 */
export function makeDraggable(app: App, panel: HTMLElement, handle: HTMLElement, container: HTMLElement, storageKey: string): void {
	handle.addClass("notelens-draggable");
	// The narrow layouts draw a grip across the top of a panel to say "move me",
	// but it is a pseudo-element: a press on it reports the panel and reached
	// nothing. This strip sits exactly there and takes the gesture.
	const grip = panel.createDiv({ cls: "notelens-panel-grip notelens-draggable" });
	grip.setAttr("aria-hidden", "true");
	const applyPosition = (left: number, top: number) => {
		const maxLeft = Math.max(0, container.clientWidth - panel.offsetWidth);
		const maxTop = Math.max(0, container.clientHeight - panel.offsetHeight);
		// A panel the reader has placed is no longer the centred one the narrow
		// layouts draw: leaving the centring transform on would drop it half its
		// own width away from the finger that moved it.
		panel.setCssStyles({ right: "auto", bottom: "auto", transform: "none" });
		panel.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
		panel.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
	};
	try {
		const saved = app.loadLocalStorage(storageKey) as { x: number; y: number } | null;
		if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) window.requestAnimationFrame(() => applyPosition(saved.x, saved.y));
	} catch { /* storage may be unavailable */ }
	const startDrag = (e: PointerEvent) => {
		// A floating window is dragged from wherever you take hold of it, not only
		// by its title. Typing and selecting still belong to the field they happen
		// in, so those are left alone.
		const target = e.target as HTMLElement;
		if (target.closest("input, select, textarea, a, [contenteditable=\"true\"]")) return;
		// On a key, the press stays a key press until the pointer travels: only
		// then does it turn into a drag, and the click it would have made is
		// dropped. Anywhere else the drag starts at once.
		const onKey = !!target.closest("button");
		let dragging = !onKey;
		if (!onKey) e.preventDefault();
		const pointerId = e.pointerId;
		const startX = e.clientX;
		const startY = e.clientY;
		const rect = panel.getBoundingClientRect();
		const parent = container.getBoundingClientRect();
		const originLeft = rect.left - parent.left;
		const originTop = rect.top - parent.top;
		if (dragging) panel.addClass("is-dragging");
		const onMove = (ev: PointerEvent) => {
			// A second finger on the board is a different pointer.
			if (ev.pointerId !== pointerId) return;
			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			if (!dragging) {
				if (Math.abs(dx) + Math.abs(dy) < 6) return;
				dragging = true;
				panel.addClass("is-dragging");
			}
			applyPosition(originLeft + dx, originTop + dy);
		};
		const onUp = (ev: PointerEvent) => {
			if (ev.pointerId !== pointerId) return;
			// Capture phase on all three: the panels stop pointer events from
			// bubbling, and a cancelled touch must end the drag like a release.
			window.removeEventListener("pointermove", onMove, { capture: true });
			window.removeEventListener("pointerup", onUp, { capture: true });
			window.removeEventListener("pointercancel", onUp, { capture: true });
			if (!dragging) return;
			panel.removeClass("is-dragging");
			// The key the drag started on must not also be pressed.
			const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault(); };
			panel.addEventListener("click", swallow, { capture: true });
			window.setTimeout(() => panel.removeEventListener("click", swallow, { capture: true }), 0);
			try { app.saveLocalStorage(storageKey, { x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) }); } catch { /* ignore */ }
		};
		window.addEventListener("pointermove", onMove, { capture: true });
		window.addEventListener("pointerup", onUp, { capture: true });
		window.addEventListener("pointercancel", onUp, { capture: true });
	};
	handle.addEventListener("pointerdown", startDrag);
	grip.addEventListener("pointerdown", startDrag);
	panel.addEventListener("pointerdown", startDrag);
}

/** Keeps clicks, wheel and keys inside a floating panel from reaching the canvas. */
export function shieldPanel(panel: HTMLElement): void {
	for (const type of ["pointerdown", "pointerup", "dblclick"]) panel.addEventListener(type, (e) => e.stopPropagation());
	panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
	panel.addEventListener("keydown", (e) => e.stopPropagation());
}
