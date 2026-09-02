# 🔍 NoteLens — Infinite Canvas & Smart Notes for Obsidian

**NoteLens** es una pizarra infinita para **Obsidian** inspirada en la libertad de Microsoft OneNote:
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
* **Rechazo de palma configurable:** por defecto los dedos desplazan el lienzo; también se puede activar el dibujo táctil.
* **Tinta nítida a cualquier zoom:** renderizado adaptado a `devicePixelRatio` (nada de borrosidad por escalado CSS).

### 🧰 Herramientas
* Cinco puntas con comportamiento propio: **bolígrafo, lápiz, pluma, rotulador y pincel**, además de subrayador, goma parcial o por trazo, formas, texto y lazo.
* **Deshacer / Rehacer** con un historial de hasta 100 pasos mediante `Ctrl+Z` / `Ctrl+Shift+Z`.
* Colores rápidos, slider de grosor (1–24 px) y atajos de teclado: `V` seleccionar · `P` lápiz · `H` subrayador · `E` borrador · `T` texto.

### 🧠 Acciones locales de estudio
* Leen abre primero un panel de acciones inmediatas: **resumen, ideas clave, plan de repaso, esquema, tarjetas y limpieza de apuntes**.
* Las acciones prefieren la selección actual y, si no hay texto seleccionado, usan la página completa. No necesitan API, cuenta ni modelo.
* **Ordenar selección** distribuye objetos en una cuadrícula y **Pulir tinta** suaviza trazos conservando la presión y enderezando las líneas intencionadas.
* El chat con Ollama o LM Studio sigue disponible como pestaña opcional, pero ninguna acción de pizarra depende de él.

### ∑ Pizarra a LaTeX local
* Reconocimiento geométrico de los trazos vectoriales para operadores, agrupaciones, superíndices, subíndices y fracciones apiladas.
* Una fórmula ya insertada se recupera desde su fuente exacta, sin degradarla mediante una captura y OCR.
* Fotos y páginas PDF usan OCR matemático local con normalización automática de tinta clara sobre fondos oscuros y análisis específico de fracciones.
* El editor muestra nivel de confianza, alternativas para símbolos dudosos y accesos rápidos a fracción, potencia, raíz, integral, sumatorio y π.

### 🏷️ Sistema de etiquetas estilo OneNote (1 clic)
* ⭐️ **Importante** · ❓ **Duda** · 💡 **Idea Clave** · ✅ **Tarea** · 📌 **Nota flotante**, escrita, dibujada o combinada.
* Cada etiqueta tiene **título propio** y una pizarra donde dibujar, pegar o subir imágenes, moverlas y redimensionarlas.
* **Tarea** incluye una checklist propia con pasos editables, estado individual y progreso visible (`1/3`, `2/3`…).
* **Arrastrables** con la herramienta de selección y gestión con clic derecho (editar explicación / eliminar).
* Resumen global con filtros, pendientes y navegación directa a la página donde está cada etiqueta.

### 📄 PDFs y 🎬 vídeos en el lienzo
* **PDFs de tu bóveda renderizados con pdf.js**, en dos modos a elegir al insertar:
  * **🗔 Visor flotante:** ventana compacta con navegación página a página (`‹ 3 / 240 ›`).
  * **📜 Documento completo:** todas las páginas apiladas en scroll, renderizadas de forma perezosa — ideal para rellenar ejercicios encima con el lápiz.
* Vídeos de **YouTube/Shorts, TikTok, Instagram, X, Vimeo, Dailymotion, Streamable, Loom y Facebook**, además de archivos locales.
* Todos los marcos son **arrastrables y redimensionables**, y recuerdan posición, tamaño y página.

### 🗂️ Organización
* **Libreta multipágina dentro de un mismo archivo**: crear, renombrar, cambiar y eliminar páginas, cada una con su cámara y papel propios.
* Los marcadores guardan también la página; al pulsarlos NoteLens cambia de página y recupera la zona y el zoom exactos.
* **Cajas de texto** editables con doble clic, arrastrables, persistidas en el archivo.
* **Panel de configuración** (abajo a la izquierda): fondo de puntos/rejilla/rayas/liso, color del papel (pizarra, grafito, papel, sepia, menta…) y restablecer vista.
* **Pinch-to-zoom** con dos dedos, zoom con rueda (15 %–400 %) y paneo infinito.
* Guardado automático con *debounce* (350 ms), cola de escrituras y volcado seguro al cerrar — sin pérdidas por escrituras fuera de orden.
* Archivos `.notelens` en JSON: tus apuntes son tuyos, versionables con Git y compatibles con los antiguos `.onenote` (migración automática).

---

## Instalación manual

1. Descarga `main.js`, `manifest.json` y `styles.css` desde una release con la misma versión que indica el manifiesto.
2. Crea la carpeta `<tu-bóveda>/.obsidian/plugins/notelens/`.
3. Coloca los tres archivos dentro, recarga Obsidian y activa **NoteLens** en **Plugins de la comunidad**.

El lector de PDF está incluido en `main.js`; no requiere copiar workers ni archivos adicionales.

## Privacidad

Las acciones de estudio, el reconocimiento vectorial de fórmulas y el procesamiento de la pizarra se ejecutan en local. El chat y la traducción local se conectan únicamente al servidor configurado por el usuario, normalmente Ollama o LM Studio en `127.0.0.1`. La traducción web de respaldo está desactivada en instalaciones nuevas y solo se usa al desactivar expresamente el modo local. Los vídeos incrustados sí cargan contenido del proveedor elegido.

## 🛠️ Compilación y desarrollo

```bash
npm ci
npm run release:check  # tipos, pruebas, build, artefactos y dependencias
npm run build          # genera main.js
npm run dev            # modo watch
```

`npm run build` no escribe fuera del repositorio. Para desplegar en una bóveda de desarrollo, copia `notelens.dev.example.json` como `notelens.dev.json`, configura `pluginDir` y ejecuta `npm run deploy`. También puedes definir la variable `NOTELENS_PLUGIN_DIR`.

## Publicación

La versión se actualiza con `npm version patch`, `npm version minor` o `npm version major`. El script sincroniza `package.json`, `manifest.json` y `versions.json`. Tras subir el commit, crea y sube una etiqueta con el número exacto y sin prefijo, por ejemplo `2.1.0`; el flujo de GitHub publica automáticamente los tres archivos estándar de Obsidian.

## 🏗️ Arquitectura

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
