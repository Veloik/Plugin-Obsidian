/* Minimal stand-in for the Obsidian runtime so the bundled plugin can run in a plain browser. */
(function () {
	// ---- DOM helpers Obsidian adds to every element ----
	function applyOpts(el, o) {
		if (!o) return el;
		if (typeof o === "string") { el.className = o; return el; }
		if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
		if (o.text != null) el.textContent = String(o.text);
		if (o.value != null) el.value = o.value;
		if (o.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
		if (o.title) el.title = o.title;
		if (o.href) el.href = o.href;
		if (o.type) el.type = o.type;
		if (o.placeholder) el.placeholder = o.placeholder;
		return el;
	}
	const P = Element.prototype;
	P.createEl = function (tag, o) { const el = document.createElement(tag); applyOpts(el, o); this.appendChild(el); return el; };
	P.createDiv = function (o) { return this.createEl("div", o); };
	P.createSpan = function (o) { return this.createEl("span", o); };
	P.setText = function (t) { this.textContent = t; return this; };
	P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
	P.addClass = function (...c) { this.classList.add(...c.flatMap(x => x.split(" ").filter(Boolean))); return this; };
	P.removeClass = function (...c) { this.classList.remove(...c.flatMap(x => x.split(" ").filter(Boolean))); return this; };
	P.toggleClass = function (c, v) { for (const x of (Array.isArray(c) ? c : [c])) this.classList.toggle(x, v); return this; };
	P.hasClass = function (c) { return this.classList.contains(c); };
	P.setAttr = function (k, v) { if (v == null) this.removeAttribute(k); else this.setAttribute(k, String(v)); return this; };
	P.getAttr = function (k) { return this.getAttribute(k); };
	P.detach = function () { this.remove(); };
	P.setCssStyles = function (styles) { for (const k in styles) this.style[k] = styles[k]; };
	P.createSvg = function (tag, o) { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); if (typeof o === "string") el.setAttribute("class", o); else if (o && o.cls) el.setAttribute("class", Array.isArray(o.cls) ? o.cls.join(" ") : o.cls); this.appendChild(el); return el; };
	Node.prototype.instanceOf = function (type) { return this instanceof type; };
	P.setCssProps = function (props) { for (const k in props) this.style.setProperty(k, props[k]); };
	P.appendText = function (t) { this.appendChild(document.createTextNode(t)); return this; };
	P.show = function () { this.style.display = ""; };
	P.hide = function () { this.style.display = "none"; };
	DocumentFragment.prototype.createEl = P.createEl;
	Array.prototype.remove = function (item) { const i = this.indexOf(item); if (i >= 0) this.splice(i, 1); };
	Array.prototype.contains = function (item) { return this.indexOf(item) >= 0; };
	window.createDiv = (o) => applyOpts(document.createElement("div"), o);
	window.createEl = (t, o) => applyOpts(document.createElement(t), o);
	window.createSpan = (o) => applyOpts(document.createElement("span"), o);
	window.createSvg = (tag, o) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); if (typeof o === "string") el.setAttribute("class", o); else if (o && o.cls) el.setAttribute("class", Array.isArray(o.cls) ? o.cls.join(" ") : o.cls); return el; };
	window.activeWindow = window;
	window.activeDocument = document;

	// ---- icons ----
	function setIcon(el, name) {
		el.innerHTML = "";
		const pascal = name.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
		const L = window.lucide;
		let svg = null;
		if (L && L.icons && L.icons[pascal]) svg = L.createElement(L.icons[pascal]);
		if (!svg) {
			svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.innerHTML = "<circle cx='12' cy='12' r='8' fill='none' stroke='currentColor' stroke-width='2'/>";
		}
		svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
		svg.classList.add("svg-icon", "lucide-" + name);
		el.appendChild(svg);
	}

	// ---- core classes ----
	class TFile { constructor(path) { this.path = path; const n = path.split("/").pop(); this.name = n; const i = n.lastIndexOf("."); this.basename = i > 0 ? n.slice(0, i) : n; this.extension = i > 0 ? n.slice(i + 1) : ""; this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 }; } }
	class TFolder { constructor(path = "/") { this.path = path; this.name = path.split("/").pop() || "/"; this.children = []; } isRoot() { return this.path === "/"; } }
	class Notice { constructor(msg, ms) { const n = document.body.createDiv({ cls: "notice", text: typeof msg === "string" ? msg : String(msg) }); this.noticeEl = n; window.__notices = (window.__notices || []); window.__notices.push(String(msg)); if (ms !== 0) setTimeout(() => n.remove(), ms || 4000); } hide() { this.noticeEl.remove(); } setMessage(m) { this.noticeEl.setText(m); return this; } }
	class Component { constructor() { this._ev = []; } registerDomEvent(el, type, fn, opts) { el.addEventListener(type, fn, opts); this._ev.push([el, type, fn, opts]); } register(fn) { this._ev.push([null, null, fn]); } registerEvent() {} registerInterval(i) { return i; } addChild(c) { return c; } load() {} unload() { for (const [el, t, fn, o] of this._ev) if (el) el.removeEventListener(t, fn, o); else fn(); } }
	class View extends Component { constructor(leaf) { super(); this.leaf = leaf; this.app = leaf.app; this.containerEl = document.createElement("div"); this.containerEl.className = "view-container"; this.containerEl.createDiv({ cls: "view-header" }); this.containerEl.createDiv({ cls: "view-content" }); } addAction() { return document.createElement("a"); } }
	class FileView extends View { constructor(leaf) { super(leaf); this.file = null; } async onLoadFile(file) { this.file = file; } async onUnloadFile() {} async onOpen() {} async onClose() {} }
	class Modal { constructor(app) { this.app = app; this.modalEl = document.createElement("div"); this.modalEl.className = "modal"; this.titleEl = this.modalEl.createDiv({ cls: "modal-title" }); this.contentEl = this.modalEl.createDiv({ cls: "modal-content" }); this.containerEl = document.createElement("div"); this.containerEl.className = "modal-container"; this.containerEl.appendChild(this.modalEl); } open() { document.body.appendChild(this.containerEl); this._esc = (e) => { if (e.key === "Escape") this.close(); }; window.addEventListener("keydown", this._esc, true); this.onOpen && this.onOpen(); } close() { window.removeEventListener("keydown", this._esc, true); this.onClose && this.onClose(); this.containerEl.remove(); } setTitle(t) { this.titleEl.setText(t); return this; } }
	class FuzzySuggestModal extends Modal { setPlaceholder() {} open() { const items = this.getItems ? this.getItems() : []; if (items.length && this.onChooseItem) this.onChooseItem(items[0]); } }
	class Setting { constructor(el) { this.settingEl = el.createDiv({ cls: "setting-item" }); this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" }); this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" }); this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" }); this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" }); } setName(n) { this.nameEl.setText(n); return this; } setDesc(d) { this.descEl.setText(d); return this; } setClass(c) { this.settingEl.addClass(c); return this; } setHeading() { return this; }
		addText(cb) { const i = this.controlEl.createEl("input", { type: "text" }); const api = { inputEl: i, setValue: (v) => { i.value = v; return api; }, getValue: () => i.value, setPlaceholder: (p) => { i.placeholder = p; return api; }, onChange: (f) => { i.addEventListener("input", () => f(i.value)); return api; } }; cb(api); return this; }
		addTextArea(cb) { const i = this.controlEl.createEl("textarea"); const api = { inputEl: i, setValue: (v) => { i.value = v; return api; }, getValue: () => i.value, setPlaceholder: (p) => { i.placeholder = p; return api; }, onChange: (f) => { i.addEventListener("input", () => f(i.value)); return api; } }; cb(api); return this; }
		addDropdown(cb) { const s = this.controlEl.createEl("select"); const api = { selectEl: s, addOption: (v, t) => { s.createEl("option", { value: v, text: t }); return api; }, addOptions: (o) => { for (const k in o) api.addOption(k, o[k]); return api; }, setValue: (v) => { s.value = v; return api; }, getValue: () => s.value, onChange: (f) => { s.addEventListener("change", () => f(s.value)); return api; } }; cb(api); return this; }
		addButton(cb) { const b = this.controlEl.createEl("button"); const api = { buttonEl: b, setButtonText: (t) => { b.setText(t); return api; }, setCta: () => { b.addClass("mod-cta"); return api; }, setWarning: () => api, setDisabled: (d) => { b.disabled = d; return api; }, setIcon: (n) => { setIcon(b, n); return api; }, onClick: (f) => { b.addEventListener("click", f); return api; } }; cb(api); return this; }
		addToggle(cb) { const i = this.controlEl.createEl("input", { type: "checkbox" }); const api = { toggleEl: i, setValue: (v) => { i.checked = v; return api; }, getValue: () => i.checked, setTooltip: () => api, onChange: (f) => { i.addEventListener("change", () => f(i.checked)); return api; } }; cb(api); return this; } }
	class MenuItem { constructor(menu) { this.el = menu.el.createDiv({ cls: "menu-item" }); this.iconEl = this.el.createSpan({ cls: "menu-item-icon" }); this.titleEl = this.el.createSpan({ cls: "menu-item-title" }); } setTitle(t) { this.titleEl.setText(t); return this; } setIcon(n) { setIcon(this.iconEl, n); return this; } setDisabled(d) { this.el.toggleClass("is-disabled", d); return this; } setChecked() { return this; } setSection() { return this; } onClick(f) { this.el.addEventListener("click", (e) => { f(e); this.el.closest(".menu")?.remove(); }); return this; } }
	class Menu { constructor() { this.el = document.createElement("div"); this.el.className = "menu"; this.items = []; } addItem(cb) { const it = new MenuItem(this); cb(it); this.items.push(it); return this; } addSeparator() { this.el.createDiv({ cls: "menu-separator" }); return this; } showAtMouseEvent(e) { return this.showAtPosition({ x: e.clientX, y: e.clientY }); } showAtPosition(p) { this.el.style.left = p.x + "px"; this.el.style.top = p.y + "px"; document.body.appendChild(this.el); window.__lastMenu = this; setTimeout(() => document.addEventListener("pointerdown", () => this.el.remove(), { once: true }), 0); return this; } hide() { this.el.remove(); } }
	class Plugin extends Component { constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; this.views = {}; this.commands = []; } registerView(type, factory) { this.views[type] = factory; } registerExtensions() {} addRibbonIcon() { return document.createElement("div"); } addCommand(c) { this.commands.push(c); } addSettingTab(tab) { window.__settingTab = tab; } loadData() { return Promise.resolve(window.__presetSettings || {}); } saveData() { return Promise.resolve(); } }

	// ---- MathJax bridge (Obsidian ships MathJax; the harness loads it from a CDN) ----
	function renderMath(source, display) {
		const MJ = window.MathJax;
		if (MJ && typeof MJ.tex2chtml === "function") {
			try { return MJ.tex2chtml(source, { display }); } catch (e) { /* fall through */ }
		}
		const span = document.createElement("span");
		span.className = "math-fallback";
		span.textContent = display ? "[" + source + "]" : source;
		return span;
	}
	async function finishRenderMath() { const MJ = window.MathJax; if (MJ && MJ.startup && MJ.startup.document) { MJ.startup.document.clear(); MJ.startup.document.updateDocument(); } }
	async function loadMathJax() {}
	async function loadPrism() { return window.Prism; }
	Node.prototype.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
	class SettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement("div"); } display() {} hide() {} }
	class PluginSettingTab extends SettingTab {}
	Setting.prototype.addColorPicker = function (cb) { const i = this.controlEl.createEl("input", { type: "color" }); const api = { setValue: (v) => { i.value = v; return api; }, getValue: () => i.value, onChange: (f) => { i.addEventListener("input", () => f(i.value)); return api; }, setDisabled: (d) => { i.disabled = d; return api; } }; cb(api); return this; };
	Setting.prototype.addSlider = function (cb) { const i = this.controlEl.createEl("input", { type: "range" }); const api = { setLimits: (a, b, st) => { i.min = a; i.max = b; i.step = st; return api; }, setValue: (v) => { i.value = v; return api; }, getValue: () => Number(i.value), setDynamicTooltip: () => api, onChange: (f) => { i.addEventListener("input", () => f(Number(i.value))); return api; } }; cb(api); return this; };

	window.__obsidian = {
		PluginSettingTab, SettingTab, renderMath, finishRenderMath, loadMathJax, loadPrism,
		Plugin, Component, View, FileView, ItemView: View, Modal, FuzzySuggestModal, Setting, Menu, MenuItem, Notice, TFile, TFolder, TAbstractFile: class {},
		WorkspaceLeaf: class {}, App: class {}, setIcon, normalizePath: (p) => p.replace(/\\/g, "/").replace(/\/+/g, "/"),
		requestUrl: async (opts) => { const o = typeof opts === "string" ? { url: opts } : opts; const r = await fetch(o.url, { method: o.method || "GET", headers: o.headers, body: o.body }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} if (r.status >= 400 && o.throw !== false) throw new Error("Request failed, status " + r.status); return { status: r.status, text, json, headers: {} }; }, Platform: window.__presetPlatform || { isMobile: false, isDesktop: true, isMacOS: false, isIosApp: false }, getLanguage: () => window.__presetLanguage || "es", debounce: (f) => f, moment: null
	};
	window.__TFile = TFile;
})();
