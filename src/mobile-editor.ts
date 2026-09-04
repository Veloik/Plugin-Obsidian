/** Keep the active editor above a software keyboard without changing document coordinates. */
export function trackMobileEditor(editor: HTMLElement, move: (lift: number) => void): () => void {
	const win = editor.ownerDocument.defaultView!;
	const viewport = win.visualViewport;
	let stopped = false;
	let lifted = 0;
	let frame = 0;
	const initialHeight = win.innerHeight;
	const settle = () => {
		frame = 0;
		if (stopped || !editor.isConnected || !viewport) return;
		// Android can resize the layout viewport as well as the visual viewport.
		const keyboard = Math.max(initialHeight, win.innerHeight) - viewport.height > 120;
		const box = editor.getBoundingClientRect();
		const room = viewport.offsetTop + viewport.height - 12;
		const top = box.top + lifted;
		const bottom = box.bottom + lifted;
		const wanted = keyboard ? Math.max(0, Math.min(bottom - room, top - viewport.offsetTop - 64)) : 0;
		if (Math.abs(wanted - lifted) < 0.5) return;
		lifted = wanted;
		move(lifted);
	};
	const schedule = () => {
		if (!stopped && !frame) frame = win.requestAnimationFrame(settle);
	};
	const focusTimer = win.setTimeout(() => {
		if (!stopped && editor.isConnected && editor.ownerDocument.activeElement !== editor) editor.focus({ preventScroll: true });
	}, 0);
	const settleTimer = win.setTimeout(schedule, 250);
	viewport?.addEventListener("resize", schedule);
	viewport?.addEventListener("scroll", schedule);
	win.addEventListener("resize", schedule);
	editor.addEventListener("input", schedule);
	editor.addEventListener("focus", schedule);
	return () => {
		if (stopped) return;
		stopped = true;
		win.clearTimeout(focusTimer);
		win.clearTimeout(settleTimer);
		win.cancelAnimationFrame(frame);
		viewport?.removeEventListener("resize", schedule);
		viewport?.removeEventListener("scroll", schedule);
		win.removeEventListener("resize", schedule);
		editor.removeEventListener("input", schedule);
		editor.removeEventListener("focus", schedule);
		move(0);
	};
}
