/**
 * Shared behaviour for the floating panels (calculator, translator, …):
 * drag by a handle, stay inside the workspace, remember where they were left.
 */
export function makeDraggable(panel: HTMLElement, handle: HTMLElement, container: HTMLElement, storageKey: string): void {
	handle.addClass("notelens-draggable");
	const applyPosition = (left: number, top: number) => {
		const maxLeft = Math.max(0, container.clientWidth - panel.offsetWidth);
		const maxTop = Math.max(0, container.clientHeight - panel.offsetHeight);
		panel.style.right = "auto";
		panel.style.bottom = "auto";
		panel.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
		panel.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
	};
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { x: number; y: number } | null;
		if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) requestAnimationFrame(() => applyPosition(saved.x, saved.y));
	} catch { /* storage may be unavailable */ }
	handle.addEventListener("pointerdown", (e) => {
		if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const rect = panel.getBoundingClientRect();
		const parent = container.getBoundingClientRect();
		const originLeft = rect.left - parent.left;
		const originTop = rect.top - parent.top;
		panel.addClass("is-dragging");
		const onMove = (ev: PointerEvent) => applyPosition(originLeft + ev.clientX - startX, originTop + ev.clientY - startY);
		const onUp = () => {
			// Capture phase on both: the panels stop pointer events from bubbling.
			window.removeEventListener("pointermove", onMove, { capture: true });
			window.removeEventListener("pointerup", onUp, { capture: true });
			panel.removeClass("is-dragging");
			try { localStorage.setItem(storageKey, JSON.stringify({ x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) })); } catch { /* ignore */ }
		};
		window.addEventListener("pointermove", onMove, { capture: true });
		window.addEventListener("pointerup", onUp, { capture: true });
	});
}

/** Keeps clicks, wheel and keys inside a floating panel from reaching the canvas. */
export function shieldPanel(panel: HTMLElement): void {
	for (const type of ["pointerdown", "pointerup", "dblclick"]) panel.addEventListener(type, (e) => e.stopPropagation());
	panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
	panel.addEventListener("keydown", (e) => e.stopPropagation());
}
