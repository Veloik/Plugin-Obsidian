# 🔍 NoteLens — Infinite Canvas & Smart Notes for Obsidian

**NoteLens** es el plugin definitivo para **Obsidian** que combina la libertad de un lienzo infinito con la potencia de Microsoft OneNote:
tinta vectorial con presión de lápiz óptico, rechazo de palma real, deshacer/rehacer, etiquetas interactivas, PDFs renderizados en el lienzo, vídeos y cajas de texto.

---

## 🌟 La Suite Lens

* **⚡ LexiLens:** Tu lente de pantalla para traducción instantánea de subtítulos y diccionario.
* **📓 NoteLens:** Tu lienzo infinito inteligente para escribir, estudiar con PDFs y tomar apuntes con lápiz.

---

## 🚀 Características

### ✍️ Tinta profesional
* **Sensibilidad a presión** real del stylus (el grosor responde a la presión).
* **Suavizado de trazo** con curvas cuadráticas y eventos coalesced — escritura fluida sin dientes de sierra.
* **Rechazo de palma real:** los dedos solo desplazan el lienzo; la tinta viene exclusivamente del lápiz o el ratón.
* **Tinta nítida a cualquier zoom:** renderizado adaptado a `devicePixelRatio` (nada de borrosidad por escalado CSS).

### 🧰 Herramientas
* Lápiz, subrayador fluorescente, **borrador funcional** (borra trazos completos al pasar), cuadros de texto y selector/movedor.
* **Deshacer / Rehacer** ilimitado (hasta 100 pasos) con `Ctrl+Z` / `Ctrl+Shift+Z`.
* Colores rápidos, slider de grosor (1–24 px) y atajos de teclado: `V` seleccionar · `P` lápiz · `H` subrayador · `E` borrador · `T` texto.

### 🏷️ Sistema de etiquetas estilo OneNote (1 clic)
* ⭐️ **Importante** · ❓ **Duda** · 💡 **Idea Clave** · ✅ **Tarea** · 📌 **Nota flotante** (tooltip al pasar el cursor).
* **Arrastrables** con la herramienta de selección y gestión con clic derecho (editar explicación / eliminar).

### 📄 PDFs y 🎬 vídeos en el lienzo
* **PDFs de tu bóveda renderizados con pdf.js**, en dos modos a elegir al insertar:
  * **🗔 Visor flotante:** ventana compacta con navegación página a página (`‹ 3 / 240 ›`).
  * **📜 Documento completo:** todas las páginas apiladas en scroll, renderizadas de forma perezosa — ideal para rellenar ejercicios encima con el lápiz.
* **YouTube** (pega la URL) y **vídeos locales** (mp4, webm…) en marcos interactivos.
* Todos los marcos son **arrastrables y redimensionables**, y recuerdan posición, tamaño y página.

### 🗂️ Organización
* **Cajas de texto** editables con doble clic, arrastrables, persistidas en el archivo.
* **Panel de configuración** (abajo a la izquierda): fondo de puntos/rejilla/rayas/liso, color del papel (pizarra, grafito, papel, sepia, menta…) y restablecer vista.
* **Pinch-to-zoom** con dos dedos, zoom con rueda (15 %–400 %) y paneo infinito.
* Guardado automático con *debounce* (600 ms) y volcado seguro al cerrar — sin pérdidas ni corrupción.
* Archivos `.notelens` en JSON: tus apuntes son tuyos, versionables con Git y compatibles con los antiguos `.onenote` (migración automática).

---

## 🛠️ Compilación y Desarrollo

```bash
npm install
npm run build    # compila y despliega en la bóveda configurada
npm run dev      # modo watch
```

El build copia `main.js`, `manifest.json`, `styles.css` y `pdf.worker.min.js` a `.obsidian/plugins/notelens` de tu bóveda (configurable en `esbuild.config.mjs`).

## 🏗️ Arquitectura

```
src/
  main.ts         → entrada del plugin (vista, comandos, ribbon)
  types.ts        → modelo de documento v2 + migración desde v1
  view.ts         → OneNoteCanvasView: gestos, herramientas, capas
  renderer.ts     → canvas DPR-aware, tinta con presión y suavizado
  history.ts      → deshacer/rehacer por snapshots
  persistence.ts  → guardado con debounce + flush al cerrar
  tools.ts        → geometría: hit-test del borrador, utilidades
  embeds.ts       → marcos PDF (pdf.js) / YouTube / vídeo local
  ui.ts           → toolbar, barra de etiquetas
```
