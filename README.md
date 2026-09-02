# 🔍 NoteLens

Infinite canvas and smart notes for Obsidian · Lienzo infinito y notas inteligentes para Obsidian

**[English](#english) · [Español](#español)**

---

## English

**NoteLens** is an infinite whiteboard for **Obsidian**, inspired by the freedom of Microsoft OneNote:
vector ink with stylus pressure, real palm rejection, undo/redo, interactive tags, PDFs rendered on the canvas, videos and text boxes.

### 🌟 The Lens Suite

* **⚡ LexiLens:** your on-screen lens for instant subtitle translation and dictionary lookup.
* **📓 NoteLens:** your smart infinite canvas for writing, studying with PDFs and taking notes with a stylus.

### 🚀 Features

#### ✍️ Professional ink

* Real **stylus pressure sensitivity** (thickness responds to pressure).
* **Stroke smoothing** with quadratic curves and coalesced events — fluid writing with no jagged edges.
* **Configurable palm rejection:** fingers pan the canvas by default; touch drawing can also be enabled.
* **Crisp ink at any zoom:** rendering adapted to `devicePixelRatio` (no blur from CSS scaling).

#### 🧰 Tools

* Five nibs, each with its own behaviour: **ballpoint, pencil, fountain pen, marker and brush**, plus highlighter, partial or whole-stroke eraser, shapes, text and lasso.
* **Undo / Redo** with up to 100 steps of history via `Ctrl+Z` / `Ctrl+Shift+Z`.
* Quick colours, a thickness slider (1–24 px) and keyboard shortcuts: `V` select · `P` pencil · `H` highlighter · `E` eraser · `T` text.

#### 🧠 Local study actions

* Leen opens a panel of immediate actions first: **summary, key ideas, review plan, outline, flashcards and note cleanup**.
* Actions prefer the current selection and fall back to the whole page when no text is selected. They need no API, no account and no model.
* **Sort selection** lays objects out on a grid, and **Polish ink** smooths strokes while preserving pressure and straightening the lines you meant to be straight.
* Chat with Ollama or LM Studio remains available as an optional tab, but no canvas action depends on it.

#### ∑ Local board-to-LaTeX

* Geometric recognition of vector strokes for operators, groupings, superscripts, subscripts and stacked fractions.
* A formula that is already placed is recovered from its exact source, rather than being degraded through a screenshot and OCR.
* Photos and PDF pages use local maths OCR, with automatic normalization of light ink on dark backgrounds and specific handling of fractions.
* The editor shows a confidence level, alternatives for ambiguous symbols, and shortcuts for fraction, power, root, integral, sum and π.

#### 🏷️ OneNote-style tag system (1 click)

* ⭐️ **Important** · ❓ **Question** · 💡 **Key idea** · ✅ **Task** · 📌 **Floating note**, written, drawn or both.
* Every tag has its **own title** and a board to draw on, paste or upload images, move them and resize them.
* **Task** carries its own checklist with editable steps, individual state and visible progress (`1/3`, `2/3`…).
* **Draggable** with the selection tool and managed by right click (edit explanation / delete).
* A global summary with filters, pending items and direct navigation to the page each tag lives on.

#### 📄 PDFs and 🎬 videos on the canvas

* **PDFs from your vault rendered with pdf.js**, in two modes you choose when inserting:
  * **🗔 Floating viewer:** a compact window with page-by-page navigation (`‹ 3 / 240 ›`).
  * **📜 Full document:** every page stacked in a scroll and rendered lazily — ideal for filling in exercises on top with the stylus.
* Videos from **YouTube/Shorts, TikTok, Instagram, X, Vimeo, Dailymotion, Streamable, Loom and Facebook**, plus local files.
* Every frame is **draggable and resizable**, and remembers its position, size and page.

#### 🗂️ Organization

* **A multi-page notebook inside a single file**: create, rename, switch and delete pages, each with its own camera and paper.
* Bookmarks store the page too; pressing one makes NoteLens switch pages and restore the exact area and zoom.
* **Text boxes** editable on double click, draggable, persisted in the file.
* A **settings panel** (bottom left): dotted/grid/ruled/plain background, paper colour (blackboard, graphite, paper, sepia, mint…) and reset view.
* **Pinch-to-zoom** with two fingers, wheel zoom (15 %–400 %) and infinite panning.
* Automatic saving with a 350 ms *debounce*, a write queue and a safe flush on close — no losses from out-of-order writes.
* `.notelens` files in JSON: your notes are yours, versionable with Git and compatible with the older `.onenote` ones (automatic migration).

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from a release whose version matches the manifest.
2. Create the folder `<your-vault>/.obsidian/plugins/notelens/`.
3. Put the three files inside, reload Obsidian and enable **NoteLens** under **Community plugins**.

The PDF reader is bundled inside `main.js`; there are no workers or extra files to copy.

### Privacy

Study actions, vector formula recognition and canvas processing all run locally. Chat and local translation connect only to the server the user configures, normally Ollama or LM Studio on `127.0.0.1`. The web translation fallback is disabled on new installations and is used only when local-only mode is expressly turned off. Embedded videos do load content from the chosen provider.

### 🛠️ Building and development

```bash
npm ci
npm run release:check  # types, tests, build, artifacts and dependencies
npm run build          # generates main.js
npm run dev            # watch mode
```

`npm run build` writes nothing outside the repository. To deploy into a development vault, copy `notelens.dev.example.json` to `notelens.dev.json`, set `pluginDir` and run `npm run deploy`. You can also define the `NOTELENS_PLUGIN_DIR` variable.

### Releasing

The version is bumped with `npm version patch`, `npm version minor` or `npm version major`. The script keeps `package.json`, `manifest.json` and `versions.json` in sync. After pushing the commit, create and push a tag with the exact number and no prefix, for example `2.1.0`; the GitHub workflow then publishes the three standard Obsidian files automatically.

### 🏗️ Architecture

```
src/
  main.ts         → plugin entry point (view, commands, ribbon)
  types.ts        → multi-page model v10 + automatic migration
  view.ts         → OneNoteCanvasView: gestures, tools, layers
  renderer.ts     → DPR-aware canvas, pressure ink and smoothing
  history.ts      → snapshot-based undo/redo
  persistence.ts  → debounced saving + flush on close
  tools.ts        → geometry: eraser hit-testing, utilities
  embeds.ts       → PDF (pdf.js), web/local video, audio, images and files
  hover-note.ts   → tag editor with checklist, title, drawing and images
  ink-math.ts     → geometric and structural recognition of handwritten formulas
  ink-equation.ts → ink equation editor with assisted correction
  local-intelligence.ts → summaries, tasks, outlines and flashcards without models
  assistant.ts    → local actions and optional local chat
  ui.ts           → bars, pages, bookmarks and context options
```

### License

MIT — see [LICENSE](LICENSE).

---

## Español

**NoteLens** es una pizarra infinita para **Obsidian** inspirada en la libertad de Microsoft OneNote:
tinta vectorial con presión de lápiz óptico, rechazo de palma real, deshacer/rehacer, etiquetas interactivas, PDFs renderizados en el lienzo, vídeos y cajas de texto.

### 🌟 La Suite Lens

* **⚡ LexiLens:** Tu lente de pantalla para traducción instantánea de subtítulos y diccionario.
* **📓 NoteLens:** Tu lienzo infinito inteligente para escribir, estudiar con PDFs y tomar apuntes con lápiz.

### 🚀 Características

#### ✍️ Tinta profesional

* **Sensibilidad a presión** real del stylus (el grosor responde a la presión).
* **Suavizado de trazo** con curvas cuadráticas y eventos coalesced — escritura fluida sin dientes de sierra.
* **Rechazo de palma configurable:** por defecto los dedos desplazan el lienzo; también se puede activar el dibujo táctil.
* **Tinta nítida a cualquier zoom:** renderizado adaptado a `devicePixelRatio` (nada de borrosidad por escalado CSS).

#### 🧰 Herramientas

* Cinco puntas con comportamiento propio: **bolígrafo, lápiz, pluma, rotulador y pincel**, además de subrayador, goma parcial o por trazo, formas, texto y lazo.
* **Deshacer / Rehacer** con un historial de hasta 100 pasos mediante `Ctrl+Z` / `Ctrl+Shift+Z`.
* Colores rápidos, slider de grosor (1–24 px) y atajos de teclado: `V` seleccionar · `P` lápiz · `H` subrayador · `E` borrador · `T` texto.

#### 🧠 Acciones locales de estudio

* Leen abre primero un panel de acciones inmediatas: **resumen, ideas clave, plan de repaso, esquema, tarjetas y limpieza de apuntes**.
* Las acciones prefieren la selección actual y, si no hay texto seleccionado, usan la página completa. No necesitan API, cuenta ni modelo.
* **Ordenar selección** distribuye objetos en una cuadrícula y **Pulir tinta** suaviza trazos conservando la presión y enderezando las líneas intencionadas.
* El chat con Ollama o LM Studio sigue disponible como pestaña opcional, pero ninguna acción de pizarra depende de él.

#### ∑ Pizarra a LaTeX local

* Reconocimiento geométrico de los trazos vectoriales para operadores, agrupaciones, superíndices, subíndices y fracciones apiladas.
* Una fórmula ya insertada se recupera desde su fuente exacta, sin degradarla mediante una captura y OCR.
* Fotos y páginas PDF usan OCR matemático local con normalización automática de tinta clara sobre fondos oscuros y análisis específico de fracciones.
* El editor muestra nivel de confianza, alternativas para símbolos dudosos y accesos rápidos a fracción, potencia, raíz, integral, sumatorio y π.

#### 🏷️ Sistema de etiquetas estilo OneNote (1 clic)

* ⭐️ **Importante** · ❓ **Duda** · 💡 **Idea Clave** · ✅ **Tarea** · 📌 **Nota flotante**, escrita, dibujada o combinada.
* Cada etiqueta tiene **título propio** y una pizarra donde dibujar, pegar o subir imágenes, moverlas y redimensionarlas.
* **Tarea** incluye una checklist propia con pasos editables, estado individual y progreso visible (`1/3`, `2/3`…).
* **Arrastrables** con la herramienta de selección y gestión con clic derecho (editar explicación / eliminar).
* Resumen global con filtros, pendientes y navegación directa a la página donde está cada etiqueta.

#### 📄 PDFs y 🎬 vídeos en el lienzo

* **PDFs de tu bóveda renderizados con pdf.js**, en dos modos a elegir al insertar:
  * **🗔 Visor flotante:** ventana compacta con navegación página a página (`‹ 3 / 240 ›`).
  * **📜 Documento completo:** todas las páginas apiladas en scroll, renderizadas de forma perezosa — ideal para rellenar ejercicios encima con el lápiz.
* Vídeos de **YouTube/Shorts, TikTok, Instagram, X, Vimeo, Dailymotion, Streamable, Loom y Facebook**, además de archivos locales.
* Todos los marcos son **arrastrables y redimensionables**, y recuerdan posición, tamaño y página.

#### 🗂️ Organización

* **Libreta multipágina dentro de un mismo archivo**: crear, renombrar, cambiar y eliminar páginas, cada una con su cámara y papel propios.
* Los marcadores guardan también la página; al pulsarlos NoteLens cambia de página y recupera la zona y el zoom exactos.
* **Cajas de texto** editables con doble clic, arrastrables, persistidas en el archivo.
* **Panel de configuración** (abajo a la izquierda): fondo de puntos/rejilla/rayas/liso, color del papel (pizarra, grafito, papel, sepia, menta…) y restablecer vista.
* **Pinch-to-zoom** con dos dedos, zoom con rueda (15 %–400 %) y paneo infinito.
* Guardado automático con *debounce* (350 ms), cola de escrituras y volcado seguro al cerrar — sin pérdidas por escrituras fuera de orden.
* Archivos `.notelens` en JSON: tus apuntes son tuyos, versionables con Git y compatibles con los antiguos `.onenote` (migración automática).

### Instalación manual

1. Descarga `main.js`, `manifest.json` y `styles.css` desde una release con la misma versión que indica el manifiesto.
2. Crea la carpeta `<tu-bóveda>/.obsidian/plugins/notelens/`.
3. Coloca los tres archivos dentro, recarga Obsidian y activa **NoteLens** en **Plugins de la comunidad**.

El lector de PDF está incluido en `main.js`; no requiere copiar workers ni archivos adicionales.

### Privacidad

Las acciones de estudio, el reconocimiento vectorial de fórmulas y el procesamiento de la pizarra se ejecutan en local. El chat y la traducción local se conectan únicamente al servidor configurado por el usuario, normalmente Ollama o LM Studio en `127.0.0.1`. La traducción web de respaldo está desactivada en instalaciones nuevas y solo se usa al desactivar expresamente el modo local. Los vídeos incrustados sí cargan contenido del proveedor elegido.

### 🛠️ Compilación y desarrollo

```bash
npm ci
npm run release:check  # tipos, pruebas, build, artefactos y dependencias
npm run build          # genera main.js
npm run dev            # modo watch
```

`npm run build` no escribe fuera del repositorio. Para desplegar en una bóveda de desarrollo, copia `notelens.dev.example.json` como `notelens.dev.json`, configura `pluginDir` y ejecuta `npm run deploy`. También puedes definir la variable `NOTELENS_PLUGIN_DIR`.

### Publicación

La versión se actualiza con `npm version patch`, `npm version minor` o `npm version major`. El script sincroniza `package.json`, `manifest.json` y `versions.json`. Tras subir el commit, crea y sube una etiqueta con el número exacto y sin prefijo, por ejemplo `2.1.0`; el flujo de GitHub publica automáticamente los tres archivos estándar de Obsidian.

### 🏗️ Arquitectura

```
src/
  main.ts         → entrada del plugin (vista, comandos, ribbon)
  types.ts        → modelo multipágina v10 + migración automática
  view.ts         → OneNoteCanvasView: gestos, herramientas, capas
  renderer.ts     → canvas DPR-aware, tinta con presión y suavizado
  history.ts      → deshacer/rehacer por snapshots
  persistence.ts  → guardado con debounce + flush al cerrar
  tools.ts        → geometría: hit-test del borrador, utilidades
  embeds.ts       → PDF (pdf.js), vídeo web/local, audio, imágenes y archivos
  hover-note.ts   → editor de etiquetas con checklist, título, dibujo e imágenes
  ink-math.ts     → reconocimiento geométrico y estructural de fórmulas manuscritas
  ink-equation.ts → editor de ecuaciones con tinta y corrección asistida
  local-intelligence.ts → resumen, tareas, esquemas y tarjetas sin modelos
  assistant.ts    → acciones locales y chat local opcional
  ui.ts           → barras, páginas, marcadores y opciones contextuales
```

### Licencia

MIT — consulta [LICENSE](LICENSE).

---

> **Nota sobre el idioma de la interfaz:** los textos del plugin están actualmente en español.
> **A note on the interface language:** the plugin's own strings are currently in Spanish.
