/**
 * Keep the active editor above a software keyboard without changing document
 * coordinates, and keep the board itself on screen while the keyboard is up.
 */
export function mountMobileBoard(board: HTMLElement, fullscreen = false): () => void {
	// A fixed child of the leaf is still clipped by Obsidian's resized ancestors.
	// Move the existing board (not a copy) into a body-level viewport while in use.
	if (board.parentElement?.classList.contains("notelens-mobile-viewport")) return () => {};
	const doc = board.ownerDocument;
	const win = doc.defaultView!;
	const rect = board.getBoundingClientRect();
	const marker = doc.createComment("notelens-board-position");
	board.before(marker);
	// Fullscreen reaches the edges of the screen itself, so it is the one that has
	// to keep the room the phone claims for its clock and its home bar.
	const host = doc.body.createDiv({
		cls: `onenote-workspace-host notelens-mobile-viewport${fullscreen ? " is-fullscreen-board" : ""}`
	});
	const viewport = win.visualViewport;
	const layout = () => {
		const top = fullscreen ? (viewport?.offsetTop ?? 0) : Math.max(rect.top, viewport?.offsetTop ?? 0);
		const bottom = Math.min(win.innerHeight, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight));
		host.style.top = `${top}px`;
		host.style.left = fullscreen ? "0px" : `${rect.left}px`;
		host.style.width = fullscreen ? "100%" : `${Math.min(rect.width, win.innerWidth)}px`;
		host.style.height = `${Math.max(1, (fullscreen ? bottom : Math.min(rect.bottom, bottom)) - top)}px`;
	};
	layout();
	host.appendChild(board);
	viewport?.addEventListener("resize", layout);
	viewport?.addEventListener("scroll", layout);
	win.addEventListener("resize", layout);
	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		viewport?.removeEventListener("resize", layout);
		viewport?.removeEventListener("scroll", layout);
		win.removeEventListener("resize", layout);
		if (marker.parentNode) marker.replaceWith(board);
		host.remove();
	};
}

export function trackMobileEditor(editor: HTMLElement, move: (lift: number) => void, board?: HTMLElement, reserve: () => number = () => 0): () => void {
	const win = editor.ownerDocument.defaultView!;
	const viewport = win.visualViewport;
	let stopped = false;
	let lifted = 0;
	let frame = 0;
	const initialHeight = win.innerHeight;
	const restoreBoard = board ? mountMobileBoard(board) : () => {};
	// The app can take the keyboard off a viewport the system has already made
	// smaller, which leaves the view a strip a few pixels tall — a board with no
	// board on it. Remember what each box measured before the keyboard arrived,
	// so the room that is really there can be given back and then handed over
	// again untouched.
	const chain: { el: HTMLElement; resting: number; previous: string }[] = [];
	for (let el = board ?? null; el && el !== editor.ownerDocument.body; el = el.parentElement) {
		chain.unshift({ el, resting: el.getBoundingClientRect().height, previous: el.style.minHeight });
	}
	let holding = false;
	const releaseHeights = () => {
		if (!holding) return;
		holding = false;
		for (const box of chain) box.el.style.minHeight = box.previous;
	};
	const holdHeights = (bottom: number) => {
		// Outermost first: a box that grows takes its children with it.
		for (const box of chain) {
			const rect = box.el.getBoundingClientRect();
			// Never past what it had before the keyboard, nor under the keyboard itself.
			const room = Math.min(box.resting, bottom - rect.top);
			if (room > 80 && rect.height < room - 8) {
				box.el.style.minHeight = `${Math.round(room)}px`;
				holding = true;
			}
		}
	};
	const settle = () => {
		frame = 0;
		if (stopped || !editor.isConnected || !viewport) return;
		// Android can resize the layout viewport as well as the visual viewport.
		const keyboard = Math.max(initialHeight, win.innerHeight) - viewport.height > 120;
		const visibleBottom = viewport.offsetTop + viewport.height;
		if (keyboard) holdHeights(visibleBottom); else releaseHeights();
		const box = editor.getBoundingClientRect();
		// Whatever is docked over the bottom of the board covers the box as surely
		// as the keyboard does, so the room the box gets is what is left above it.
		const room = visibleBottom - 12 - Math.max(0, reserve());
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
	// The app can collapse the view a moment after the keyboard reports itself,
	// so watch the board's own box as well as the viewport.
	const observer = board ? new win.ResizeObserver(() => schedule()) : null;
	if (board) observer?.observe(board);
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
		observer?.disconnect();
		viewport?.removeEventListener("resize", schedule);
		viewport?.removeEventListener("scroll", schedule);
		win.removeEventListener("resize", schedule);
		editor.removeEventListener("input", schedule);
		editor.removeEventListener("focus", schedule);
		releaseHeights();
		move(0);
		restoreBoard();
	};
}

/**
 * On a tablet the keyboard shrinks the window and Obsidian can leave this tab a
 * strip with nothing painted in it: the screen goes black. While something in
 * the board or document is being typed into, it lives in a box the size of
 * what is visible above the keyboard, and goes back to its tab afterwards.
 */
export function keepAboveKeyboard(root: HTMLElement): () => void {
	const isField = (el: Element | null): el is HTMLElement =>
		!!el && root.contains(el) && el.matches("input:not([type=range],[type=checkbox],[type=radio],[type=color],[type=button],[type=file],[type=submit]), textarea, [contenteditable='true']");
	let restore: (() => void) | null = null;
	let timer = 0;
	const lift = (field: HTMLElement) => {
		if (restore) return;
		const sel = root.ownerDocument.getSelection();
		const saved = sel && sel.anchorNode && field.contains(sel.anchorNode)
			? { a: sel.anchorNode, ao: sel.anchorOffset, f: sel.focusNode, fo: sel.focusOffset } : null;
		const input = field as HTMLInputElement;
		const caret = "selectionStart" in field ? [input.selectionStart, input.selectionEnd] as const : null;
		restore = mountMobileBoard(root);
		// Moving the box takes the focus with it; hand it back so the keyboard stays.
		field.focus({ preventScroll: true });
		if (caret && caret[0] !== null && caret[1] !== null) input.setSelectionRange(caret[0], caret[1]);
		else if (saved?.a && saved.a.isConnected) sel?.setBaseAndExtent(saved.a, saved.ao, saved.f ?? saved.a, saved.f ? saved.fo : saved.ao);
	};
	const drop = () => {
		if (!restore) return;
		if (isField(root.ownerDocument.activeElement)) return;
		restore();
		restore = null;
	};
	const onIn = (e: FocusEvent) => {
		window.clearTimeout(timer);
		if (isField(e.target as Element)) lift(e.target as HTMLElement);
	};
	const onOut = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(drop, 350);
	};
	root.addEventListener("focusin", onIn);
	root.addEventListener("focusout", onOut);
	return () => {
		window.clearTimeout(timer);
		root.removeEventListener("focusin", onIn);
		root.removeEventListener("focusout", onOut);
		restore?.();
		restore = null;
	};
}
