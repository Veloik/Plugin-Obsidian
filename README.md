# NoteLens

An infinite canvas for Obsidian, built for taking notes with a stylus.
Lienzo infinito para Obsidian, pensado para tomar apuntes con lápiz.

**[English](#english) · [Español](#español)**

---

## English

NoteLens turns a note into an infinite whiteboard: vector ink that follows the pressure of
your stylus, palm rejection, tags you can drop on the page, PDFs rendered on the canvas to
write on top of, videos, tables and formulas. It is modelled on OneNote, which is what most
people who study with a tablet are used to, and it keeps everything inside your vault.

### Ink

Pressure changes the thickness, strokes are smoothed with quadratic curves and coalesced
pointer events, and the canvas renders at `devicePixelRatio` so ink stays sharp at any zoom.
Fingers pan by default and the stylus draws; touch drawing can be turned on for people
without a pen. The back of the stylus erases, whatever tool is selected.

Five nibs behave differently — ballpoint, pencil, fountain pen, marker and brush — plus a
highlighter, shapes, text and a lasso. The eraser works either way: whole stroke, or cutting
only the part you pass over, splitting what is left into pieces. Undo and redo keep 100
steps. Shortcuts: `V` select · `P` pen · `H` highlighter · `E` eraser · `T` text · `S` shapes.

### Formulas

The formula button opens one dialog with two ways in. Write the equation by hand and it is
read from the vector strokes — fractions, roots, sums, integrals, superscripts and
subscripts, with the shape of the layout taken into account rather than the pixels. Or
switch to the keyboard tab and type it, with a palette of about eighty symbols grouped by
subject. Both write into the same notation field and the same live preview, so you can start
with the pen and finish typing.

The notation is the one you would use on a calculator: `x^2/2 + sqrt(x)`, `sum_(i=1)^n i`,
`int_0^1 x^2 dx`, `[[a,b],[c,d]]`, `((n),(k))`, `{(x, x>=0), (-x, x<0):}`. Symbols from a
maths keyboard (π √ ∫ ≤ ∞ α, x², a₁, x̄) are understood as well, and plain LaTeX passes
through untouched. `$x^2$` inside any text box is typeset in place.

Exporting to PDF draws each formula as it appears on the board, not as its source, and
lightens nothing: white ink on a dark board comes out dark on the white page.

### Local model

Nothing on the board needs one. A local model is optional and used only for translating
without quotas, talking to Ollama or LM Studio on your own machine; the settings say which
model suits the memory you have and report what they found when you test the connection.

Leen, the study assistant, is written but not in this release: the pet, the chat and his
local actions sit behind a flag in `src/features.ts`.

### Tags

Important, Question, Key idea, Task and Floating note, one click each. Every tag carries its
own title and a small board where you can write, draw, paste or upload images and move them
around. A Task keeps a checklist whose steps can themselves be handwritten, with individual
state and visible progress. There is a summary of every tag on the notebook, with filters,
what is still pending, and a jump to the page each one lives on.

### PDFs and video

PDFs from your vault are rendered with pdf.js in two shapes you choose when inserting: a
compact viewer with page-by-page navigation, or the whole document stacked in a scroll and
rendered lazily, which is the one for filling in exercises with the stylus on top.

Videos from YouTube, TikTok, Instagram, X, Vimeo, Dailymotion, Streamable, Loom and Facebook
embed as frames, as do local files. Every frame can be dragged and resized, and remembers
where it was and on which page.

### The notebook

One file holds many pages: create, rename, reorder and delete them, each with its own camera
and paper. Bookmarks store the page as well, so opening one switches page and restores the
exact area and zoom. The background can be dotted, gridded, ruled or plain, with paper
colours from blackboard to sepia.

Zoom runs from 15 % to 400 % with the wheel or two fingers, and panning is unbounded. Saving
is debounced at 350 ms through a write queue, with a flush on close so a fast exit cannot
lose the last stroke. Files are `.notelens` JSON: readable, diffable, versionable with Git,
and the older `.onenote` files are migrated automatically.

### Installing by hand

Download `main.js`, `manifest.json` and `styles.css` from a release whose version matches the
manifest, put them in `<your-vault>/.obsidian/plugins/notelens/`, reload Obsidian and enable
NoteLens under Community plugins. The PDF reader is bundled inside `main.js`; there is
nothing else to copy.

### Languages

The interface ships in English and Spanish and follows Obsidian's own language setting;
Settings › NoteLens › Language forces one of the two, and open boards update immediately.

Translations live in `src/locales/`, keyed by the Spanish source string, so a missing entry
falls back to Spanish rather than showing a raw key. Adding a language is one file there and
one line in `src/i18n.ts`.

### Handwriting data

Maths symbols are recognised by comparing your strokes with shapes people
actually drew: 64 examples of each, taken from the
[Hand-TeX](https://github.com/VoxelCubes/Hand-TeX) database, which extends the
[Detexify](https://github.com/kirel/detexify-data) training data. Both are
published under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/),
and so is `src/ink-prototypes-odbl.ts`, the file generated from them. The rest
of NoteLens stays MIT; no Hand-TeX code is used, only its published data.

Regenerate that file with `python dev-harness/build-prototypes.py handtex.db`.
Digits and Latin letters are not in it — Detexify collected drawings of LaTeX
commands, so nobody drew a "2" — and their shapes are still written by hand in
`src/ink-shapes.ts`.

### Privacy

The study actions, formula recognition and everything drawn on the canvas run locally. Chat
and local translation talk only to the server you configure, normally Ollama or LM Studio on
`127.0.0.1`. The web translation fallback is off on new installs and is used only if you turn
local-only mode off yourself. Embedded videos do load from whichever provider you embedded.

### Building

```bash
npm ci
npm run release:check  # types, tests, build, artifacts and dependencies
npm run build          # generates main.js
npm run dev            # watch mode
```

`npm run build` writes nothing outside the repository. To deploy into a development vault,
copy `notelens.dev.example.json` to `notelens.dev.json`, set `pluginDir` and run
`npm run deploy`, or set `NOTELENS_PLUGIN_DIR`.

Releases are tag-driven: bump with `npm version patch|minor|major`, which keeps
`package.json`, `manifest.json` and `versions.json` in step, then push a tag with the exact
number and no prefix (`2.4.0`). The workflow publishes the three standard files and signs
them with a build attestation.

### Layout

```
src/
  main.ts               plugin entry point: view, commands, ribbon
  types.ts              multi-page model + automatic migration
  view.ts               the canvas view: gestures, tools, layers
  renderer.ts           DPR-aware canvas, pressure ink, smoothing
  history.ts            snapshot undo/redo
  persistence.ts        debounced saving, flush on close
  tools.ts              geometry: hit-testing, eraser cuts
  embeds.ts             PDF, video, audio, images, files
  hover-note.ts         tag editor: checklist, title, drawing, images
  ink-math.ts           geometric recognition of handwritten formulas
  ink-equation.ts       the equation dialog, by hand or typed
  math-palette.ts       the symbol palette both editors share
  asciimath.ts          calculator notation to LaTeX
  ink-shapes.ts         stroke matching, and the hand-written shapes
  ink-prototypes-odbl.ts  symbol shapes from real handwriting (ODbL)
  features.ts           what is written but not shipped yet
  dom-raster.ts         typeset formulas to PNG, for the PDF export
  local-intelligence.ts summaries, tasks, outlines, flashcards, no models
  assistant.ts          local actions and the optional local chat
  ui.ts                 bars, pages, bookmarks, context menus
  i18n.ts               translation, Spanish source as the key
  locales/              catalogues, one file per language
```

### License

MIT — see [LICENSE](LICENSE).

---

## Español

NoteLens convierte una nota en una pizarra infinita: tinta vectorial que responde a la
presión del lápiz, rechazo de palma, etiquetas que sueltas en la página, PDFs renderizados
en el lienzo para escribir encima, vídeos, tablas y fórmulas. Está hecho a imagen de
OneNote, que es a lo que está acostumbrada la gente que estudia con tableta, y todo se queda
dentro de tu bóveda.

### Tinta

La presión cambia el grosor, los trazos se suavizan con curvas cuadráticas y eventos
coalesced, y el lienzo se dibuja a `devicePixelRatio`, así que la tinta no se emborrona a
ningún zoom. Los dedos desplazan y el lápiz dibuja; se puede activar el dibujo táctil para
quien no tenga lápiz. La punta trasera del lápiz borra, esté seleccionada la herramienta que
esté.

Cinco puntas con comportamiento propio —bolígrafo, lápiz, pluma, rotulador y pincel—, además
de subrayador, formas, texto y lazo. La goma funciona de las dos maneras: el trazo entero, o
cortando solo por donde pasas y dejando los trozos que quedan. Deshacer y rehacer guardan 100
pasos. Atajos: `V` seleccionar · `P` lápiz · `H` subrayador · `E` goma · `T` texto · `S` formas.

### Fórmulas

El botón de fórmula abre un único diálogo con dos entradas. Escribes la ecuación a mano y se
lee desde los trazos vectoriales —fracciones, raíces, sumatorios, integrales, superíndices y
subíndices—, mirando la forma del conjunto y no los píxeles. O cambias a la pestaña de
teclado y la tecleas, con una paleta de unos ochenta símbolos agrupados por tema. Las dos
escriben en la misma notación y la misma vista previa, así que puedes empezar con el lápiz y
terminar tecleando.

La notación es la de una calculadora: `x^2/2 + sqrt(x)`, `sum_(i=1)^n i`, `int_0^1 x^2 dx`,
`[[a,b],[c,d]]`, `((n),(k))`, `{(x, x>=0), (-x, x<0):}`. También entiende los símbolos de un
teclado matemático (π √ ∫ ≤ ∞ α, x², a₁, x̄), y el LaTeX pasa tal cual. Un `$x^2$` dentro de
cualquier cuadro de texto se compone en el sitio.

Al exportar a PDF cada fórmula se dibuja como se ve en la pizarra, no como su código fuente,
y nada se pierde por el color: la tinta blanca de una pizarra oscura sale oscura sobre el
papel.

### Modelo local

Nada de la pizarra lo necesita. El modelo local es opcional y solo se usa para traducir sin
cuotas, hablando con Ollama o LM Studio en tu propio equipo; los ajustes te dicen qué modelo
encaja con tu memoria y te cuentan qué encontraron al probar la conexión.

Leen, el ayudante de estudio, está escrito pero no va en esta versión: el gato, el chat y sus
acciones locales quedan tras una bandera en `src/features.ts`.

### Etiquetas

Importante, Duda, Idea clave, Tarea y Nota flotante, a un clic cada una. Cada etiqueta lleva
su propio título y una pizarrita donde escribir, dibujar, pegar o subir imágenes y moverlas.
Tarea guarda una checklist cuyos pasos pueden estar escritos a mano, con estado individual y
progreso a la vista. Hay un resumen de todas las etiquetas de la libreta, con filtros, lo que
queda pendiente y un salto a la página donde vive cada una.

### PDFs y vídeo

Los PDFs de tu bóveda se renderizan con pdf.js en dos formatos que eliges al insertarlos: un
visor compacto con navegación página a página, o el documento entero apilado en scroll y
renderizado de forma perezosa, que es el que sirve para rellenar ejercicios encima con el
lápiz.

Los vídeos de YouTube, TikTok, Instagram, X, Vimeo, Dailymotion, Streamable, Loom y Facebook
se incrustan como marcos, igual que los archivos locales. Todos se arrastran y redimensionan,
y recuerdan dónde estaban y en qué página.

### La libreta

Un archivo guarda muchas páginas: crearlas, renombrarlas, reordenarlas y borrarlas, cada una
con su cámara y su papel. Los marcadores guardan también la página, así que abrir uno cambia
de página y recupera la zona y el zoom exactos. El fondo puede ser de puntos, rejilla, rayas
o liso, con colores de papel de pizarra a sepia.

El zoom va del 15 % al 400 % con la rueda o dos dedos, y el paneo no tiene límite. El
guardado se agrupa cada 350 ms en una cola de escrituras, con un volcado al cerrar para que
salir deprisa no se lleve el último trazo. Los archivos son `.notelens` en JSON: legibles,
comparables, versionables con Git, y los antiguos `.onenote` se migran solos.

### Instalación manual

Descarga `main.js`, `manifest.json` y `styles.css` de una release cuya versión coincida con
la del manifiesto, ponlos en `<tu-bóveda>/.obsidian/plugins/notelens/`, recarga Obsidian y
activa NoteLens en Plugins de la comunidad. El lector de PDF va dentro de `main.js`; no hay
nada más que copiar.

### Idiomas

La interfaz está en español e inglés y sigue el idioma de Obsidian; en Ajustes › NoteLens ›
Idioma puedes forzar uno de los dos, y las pizarras abiertas se actualizan al momento.

Las traducciones viven en `src/locales/`, indexadas por el texto original en español, así que
lo que falte cae de vuelta al español en lugar de mostrar una clave suelta. Añadir un idioma
es un archivo ahí y una línea en `src/i18n.ts`.

### Datos de escritura a mano

Los símbolos matemáticos se reconocen comparando tus trazos con formas que
dibujó gente de verdad: 64 ejemplos de cada uno, tomados de la base de datos
[Hand-TeX](https://github.com/VoxelCubes/Hand-TeX), que amplía los datos de
entrenamiento de [Detexify](https://github.com/kirel/detexify-data). Las dos se
publican bajo la [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/),
y también el archivo que se genera a partir de ellas,
`src/ink-prototypes-odbl.ts`. El resto de NoteLens sigue siendo MIT; no se usa
nada del código de Hand-TeX, solo sus datos publicados.

Ese archivo se regenera con `python dev-harness/build-prototypes.py handtex.db`.
Los dígitos y las letras latinas no están ahí —Detexify recogía dibujos de
comandos LaTeX, así que nadie dibujó un «2»— y sus formas siguen escritas a mano
en `src/ink-shapes.ts`.

### Privacidad

Las acciones de estudio, el reconocimiento de fórmulas y todo lo que se dibuja en el lienzo
se ejecutan en local. El chat y la traducción local hablan únicamente con el servidor que tú
configures, normalmente Ollama o LM Studio en `127.0.0.1`. La traducción web de respaldo está
desactivada en instalaciones nuevas y solo se usa si desactivas tú el modo local. Los vídeos
incrustados sí cargan del proveedor que hayas incrustado.

### Compilación

```bash
npm ci
npm run release:check  # tipos, pruebas, build, artefactos y dependencias
npm run build          # genera main.js
npm run dev            # modo watch
```

`npm run build` no escribe fuera del repositorio. Para desplegar en una bóveda de desarrollo,
copia `notelens.dev.example.json` como `notelens.dev.json`, configura `pluginDir` y ejecuta
`npm run deploy`, o define `NOTELENS_PLUGIN_DIR`.

Las releases van por etiqueta: sube la versión con `npm version patch|minor|major`, que
mantiene en línea `package.json`, `manifest.json` y `versions.json`, y luego empuja una
etiqueta con el número exacto y sin prefijo (`2.4.0`). El flujo publica los tres archivos
estándar y los firma con una atestación de compilación.

### Licencia

MIT — consulta [LICENSE](LICENSE).
