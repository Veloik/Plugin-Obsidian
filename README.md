# NoteLens

An infinite canvas for Obsidian, built for taking notes with a stylus.
Lienzo infinito para Obsidian, pensado para tomar apuntes con lápiz.

**[English](#english) · [Español](#español)**

[![NoteLens in 87 seconds / NoteLens en 87 segundos](assets/notelens-promo.jpg)](assets/notelens-promo.mp4)

*Recorded from the plugin itself: handwriting to text and to LaTeX, draw-and-hold shapes, tables,
revision cards, handwriting search and ink replay. Grabado con el propio plugin.*

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

The highlighter lays down the print of a flat felt tip: one even band, the same width
whichever way you swipe, slanted at both ends the way a real marker leaves them, and
deepening where two strokes cross instead of washing out.

Handwriting can become typed text, as in OneNote: select it and press the **T** in the
selection bar. The words are read on the device, line by line, with their spaces and capitals;
a word you already use in the vault — a note's name, a heading — wins over a look-alike that
is not a word. Ctrl+Z brings the ink back. Right-click the board and choose **Replay the ink**
to watch the page being written again stroke by stroke, with pause, a progress bar and 1×, 2×
or 4× speed. Ctrl+F searches handwriting as well as typed text, forgiving accents and a
misread letter. Draw a circle, rectangle, triangle, diamond, line or arrow and hold the pen
still for a moment before lifting it, and it becomes the clean shape. Select an answer or a
formula and press the eye to cover it for revision: it stays frosted under "Tap to see" until
you tap it, like a flashcard among your notes.

Tables take one of six colours, shade alternate rows, grow with what is written in them, and
Tab moves through the cells, adding a row at the end.

Text boxes are edited as they will look, and take eleven typefaces. Select a word and make it
bold, italic, underlined, struck through, highlighted or code, give it its own colour or its
own highlight tint, from the floating bar or with Ctrl+B, Ctrl+I and Ctrl+U — and see it as
you type. The words are also kept as plain Markdown (`**así**`, `==así==`), so the note still
reads as text everywhere else.

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

Paste the path of a note, a board or a PDF from this vault and the board shows its card
rather than the address: the full path from the file explorer, a path relative to the vault,
a `[[wikilink]]` and `obsidian://` links all work.

Zoom runs from 15 % to 400 % with the wheel or two fingers, and panning is unbounded. Saving
is debounced at 350 ms through a write queue, with a flush on close so a fast exit cannot
lose the last stroke. Files are `.notelens` JSON: readable, diffable, versionable with Git,
and the older `.onenote` files are migrated automatically.

### Between devices

A board is a file in your vault, so whatever syncs the vault syncs the boards: Obsidian
Sync, Syncthing, iCloud Drive, Remotely Save, Self-hosted LiveSync or a git pull. NoteLens
keeps an open board safe while that happens. When the file changes under it, the view takes
the new version in and keeps your camera where it was; if you had unsaved strokes, they are
merged element by element with what arrived, so neither side overwrites the other. A save
never replaces a version of the file this device did not write. Sync tools that cannot merge
leave a second file next to the board (Syncthing's `.sync-conflict-…`, Dropbox's
`(conflicted copy)` and their Spanish equivalents); NoteLens notices them, offers to fold
them into the board with one button and moves the copy to the trash afterwards.

With Obsidian Sync, turn on **Sync all other types** under Vault configuration, otherwise
`.notelens` files stay on the device that made them. Syncthing, iCloud and Remotely Save
carry them as they are.

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

Handwritten maths is read by a small neural network that ships inside the
plugin (`src/ink-model.ts`, weights only, about 450 KB) and runs offline in a
few milliseconds. It was trained on handwriting from these public datasets:

- [UJI Pen Characters v2](https://archive.ics.uci.edu/dataset/177) and
  [Pen-Based Recognition of Handwritten Digits](https://archive.ics.uci.edu/dataset/81),
  UCI Machine Learning Repository, CC BY 4.0.
- [Hand-TeX](https://github.com/VoxelCubes/Hand-TeX), which extends the
  [Detexify](https://github.com/kirel/detexify-data) data, and the
  [HWRT database](https://doi.org/10.5281/zenodo.50022) by Martin Thoma, all
  under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

No sample is distributed, only the fitted numbers, and no code from those
projects is used. It is measured on [MathWriting](https://github.com/google-research/google-research/tree/master/mathwriting)
(CC BY-NC-SA), which is never trained on. `dev-harness/train-ink/` rebuilds the
model and `dev-harness/formula-bench.mjs` scores whole formulas.

### Privacy

Formula recognition and everything drawn on the canvas runs locally. Translation is the one
thing that goes out by default: the text you translate is sent to free public endpoints that
need no key and impose no quota (Google's `translate_a` services, with MyMemory as a last
resort), which is what makes it answer in well under a second. Turning on "translate only on
your computer" sends nothing anywhere — a local model does the work instead, more slowly, and
it talks only to the server you configure, normally Ollama or LM Studio on `127.0.0.1`.
Embedded videos do load from whichever provider you embedded.

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
  ink-math.ts           handwritten formula to LaTeX: segmentation and layout
  ink-classifier.ts     the symbol network; ink-features.ts, what it sees
  ink-model.ts          its weights (generated)
  features.ts           what is written but not shipped yet
  dom-raster.ts         typeset formulas to PNG, for the PDF export
  local-intelligence.ts summaries, tasks, outlines, flashcards, no models
  assistant.ts          local actions and the optional local chat
  ui.ts                 bars, pages, bookmarks, context menus
  i18n.ts               translation, Spanish source as the key
  locales/              catalogues, one file per language
```

### License

MIT — see [LICENSE](LICENSE). Third-party data notices: [NOTICE.md](NOTICE.md).

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

El subrayador deja la huella de una punta plana de fieltro: una banda uniforme, del mismo
grosor pases por donde pases, sesgada en los dos extremos como la deja un rotulador de
verdad, y que se oscurece donde se cruzan dos trazos en lugar de lavarse.

La escritura a mano se puede pasar a texto, como en OneNote: la seleccionas y pulsas la **T**
de la barra de selección. Se lee en el propio equipo, renglón a renglón, con sus espacios y
mayúsculas, y una palabra que ya usas en la bóveda —el nombre de una nota, un encabezado—
gana a otra que sólo se le parece. Ctrl+Z devuelve la tinta. Con el botón derecho sobre la
pizarra, **Reproducir la tinta** vuelve a escribir la página trazo a trazo, con pausa, barra de
progreso y velocidad 1×, 2× o 4×. Ctrl+F busca también en lo escrito a mano, sin tener en
cuenta tildes y perdonando una letra mal leída. Dibuja un círculo, un rectángulo, un
triángulo, un rombo, una línea o una flecha y deja el lápiz quieto un momento antes de
levantarlo: se convierte en la forma limpia. Selecciona una respuesta o una fórmula y pulsa el
ojo para taparla y repasar: queda esmerilada bajo «Toca para ver» hasta que la tocas, como una
tarjeta de memoria entre tus apuntes.

Las tablas tienen seis colores, sombrean filas alternas, crecen con lo que escribes y el
tabulador recorre las celdas, añadiendo una fila al final.

Los cuadros de texto se editan tal y como van a quedar, y traen once tipografías.
Seleccionas una palabra y la pones en negrita, cursiva, subrayada, tachada, resaltada o como
código, le das su propio color o su propio tinte de resaltado, desde la barra flotante o con
Ctrl+B, Ctrl+I y Ctrl+U, y lo ves mientras escribes. Las palabras se guardan además como
Markdown normal —`**así**`, `==así==`—, así que la nota se sigue leyendo como texto en
cualquier otro sitio.

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

Pega la ruta de una nota, una pizarra o un PDF de esta bóveda y la pizarra muestra su
tarjeta en vez de la dirección: vale la ruta completa del explorador de archivos, la ruta
relativa a la bóveda, un `[[enlace]]` y las direcciones `obsidian://`.

El zoom va del 15 % al 400 % con la rueda o dos dedos, y el paneo no tiene límite. El
guardado se agrupa cada 350 ms en una cola de escrituras, con un volcado al cerrar para que
salir deprisa no se lleve el último trazo. Los archivos son `.notelens` en JSON: legibles,
comparables, versionables con Git, y los antiguos `.onenote` se migran solos.

### Entre dispositivos

Una pizarra es un archivo de la bóveda, así que lo que sincronice la bóveda sincroniza las
pizarras: Obsidian Sync, Syncthing, iCloud Drive, Remotely Save, Self-hosted LiveSync o un
`git pull`. NoteLens protege la pizarra abierta mientras eso ocurre. Si el archivo cambia por
debajo, la vista adopta la versión nueva y deja la cámara donde estaba; si tenías trazos sin
guardar, se fusionan elemento a elemento con lo que llegó, de modo que ningún lado pisa al
otro. Un guardado nunca sustituye una versión del archivo que este dispositivo no escribió.
Las herramientas que no saben fusionar dejan un segundo archivo junto a la pizarra (el
`.sync-conflict-…` de Syncthing, la «copia en conflicto» de Dropbox); NoteLens lo detecta,
ofrece incorporarlo a la pizarra con un botón y después manda la copia a la papelera.

Con Obsidian Sync activa **Sync all other types** en la configuración de la bóveda; si no,
los `.notelens` se quedan en el dispositivo que los creó. Syncthing, iCloud y Remotely Save
los llevan tal cual.

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

Las fórmulas escritas a mano las lee una pequeña red neuronal que va dentro
del plugin (`src/ink-model.ts`, solo los pesos, unos 450 KB) y funciona sin
conexión en pocos milisegundos. Se entrenó con escritura de estas bases de
datos públicas:

- [UJI Pen Characters v2](https://archive.ics.uci.edu/dataset/177) y
  [Pen-Based Recognition of Handwritten Digits](https://archive.ics.uci.edu/dataset/81),
  UCI Machine Learning Repository, CC BY 4.0.
- [Hand-TeX](https://github.com/VoxelCubes/Hand-TeX), que amplía los datos de
  [Detexify](https://github.com/kirel/detexify-data), y la
  [base HWRT](https://doi.org/10.5281/zenodo.50022) de Martin Thoma, todas bajo
  la [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

No se distribuye ninguna muestra, solo los números ajustados, y no se usa
código de esos proyectos. Se mide con [MathWriting](https://github.com/google-research/google-research/tree/master/mathwriting)
(CC BY-NC-SA), con la que nunca se entrena. `dev-harness/train-ink/` reconstruye
el modelo y `dev-harness/formula-bench.mjs` puntúa fórmulas completas.

### Privacidad

El reconocimiento de fórmulas y todo lo que se dibuja en el lienzo se ejecutan en local. La
traducción local habla únicamente con el servidor que tú configures, normalmente Ollama o LM
Studio en `127.0.0.1`. La traducción web de respaldo está desactivada en instalaciones nuevas
y solo se usa si desactivas tú el modo local. Los vídeos incrustados sí cargan del proveedor
que hayas incrustado.

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

MIT — consulta [LICENSE](LICENSE). Avisos de terceros: [NOTICE.md](NOTICE.md).

### Mobile reliability (2.8.9)

Keyboard movement is temporary and does not change saved page coordinates. Video cards keep an original link when a provider refuses embedded playback; shortened share URLs open in their original app/browser. This does not bypass provider restrictions.

A board that cannot be read is protected against accidental overwriting. Import packages are limited to 64 MiB compressed, 128 MiB expanded and 5,000 entries to bound memory use on phones. Split larger packages before importing.
