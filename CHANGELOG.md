# Changelog

## 2.4.0

### Added

- The easy notation understands what students actually type: `e^-x` and `10^-3` keep the sign in the exponent, `d/dx` and `dy/dx` are the fractions they mean, `((n),(k))` is a binomial, `{(x, x>=0), (-x, x<0):}` is a piecewise function, `[0, 1)` keeps its round end, `|x| + |y|` pairs its bars, `f'(x)` and `n!` sit on their operand, and `x_1, x_2, ..., x_n` no longer loses everything after the first comma. Symbols from a maths keyboard (π √ ∫ ∑ ≤ ≠ → ∞ ± × · ÷ ∂ ∈ ∀ ∃ ℝ α…ω, x², a₁, x̄, x̂) are read as their spelled-out forms.
- A formula box grows with its content instead of cutting a wide formula at 320 px, and the live preview appears the moment editing starts, not after the first keystroke.
- PDF export draws every formula as the picture the board shows, in ink colour, instead of writing its source. Text and ink that are near white on a dark board come out dark on the white page, where they used to vanish.
- The back of a stylus erases (button 5) whatever tool is selected, with the eraser pointer shown while it does.
- The equation dialog offers limits, absolute value, binomials, matrices, cases and vectors as one-tap structures.

### Fixed

- The partial eraser cuts a stroke exactly where the circle crosses it instead of dropping the touched points, so a straight line drawn with Shift (two points) loses a gap instead of disappearing. Shapes touched in partial mode are removed, as in OneNote.

## 2.3.5

### Fixed

- Panel positions and the minimap toggle are remembered per vault, through `App#saveLocalStorage`, instead of in one browser-wide key that every vault shared.
- The interface language follows Obsidian's own `getLanguage()` rather than reading the `language` key out of localStorage.
- Timers and animation frames go through `window`, and text areas are recognised with `instanceOf`, so the board behaves in a popped-out window.
- An image pasted as a `data:` URL is decoded directly instead of being fetched, and the assistant's second probe of a local model uses `requestUrl` like the first.

### Changed

- `minAppVersion` is 1.8.7, the release that added `getLanguage` and the per-vault storage helpers. Anyone older keeps 2.3.4 through versions.json.
- Elements come from Obsidian's `createEl` and `createSvg` helpers, and the build reads the Node built-ins from `node:module` instead of a dependency.

## 2.3.4

### Changed

- The published bundle can no longer create a `<script>` element. jsPDF's `pdfobjectnewwindow` output mode opens a window and loads PDFObject from a CDN; NoteLens draws its PDFs with the vector API and never asks for that mode, so the build removes the branch and the release validator fails if any dependency brings a script injection back.

## 2.3.3

### Changed

- `minAppVersion` is now 1.4.0, the release that introduced the newest API the plugin calls (`Vault.createFolder` returning the folder). It was declared as 1.0.0, which promised more compatibility than the code delivers.
- Dynamic styles go through `setCssStyles` instead of assigning `element.style` directly, at the 27 sites the community review pointed at.
- Sentences are split by scanning forward for the boundary rather than by a regular expression with a lookbehind, which iOS before 16.4 cannot even parse: the whole file failed to load there.
- The macOS check uses Obsidian's `Platform` instead of reading `navigator.platform`.
- Share packages are zipped with fflate instead of JSZip, and jsPDF's optional `html()` dependencies (canvg, html2canvas, dompurify) are no longer bundled. NoteLens never calls that path, and dragging it in cost 880 KB of dead code and six legacy `<script>` polyfills that made the review flag the bundle.

## 2.3.2

### Changed

- The release workflow attests the provenance of `main.js` and `styles.css`, so anyone installing them can verify cryptographically that they were built from this source.

## 2.3.1

### Changed

- Syntax highlighting in code blocks paints Prism's tokens as elements instead of assigning its markup, and the translator decodes the entities it gets back by hand, so no text coming from a code block or from the translation service is ever parsed as HTML.
- The manifest description is in English and no longer repeats the plugin name, as the community catalogue requires.

## 2.3.0

### Added

- Board-to-LaTeX now reads dominant symbols the way OneNote's ink recognizer does: a radical owns what is written under its vinculum, and a sum or an integral owns the limits above and below the sign. Each region is parsed again on its own, so a root can hold a fraction and a limit can hold a sum.
- Radicals and integrals are recognized from their geometry instead of from template matching, which read a hand-drawn root as "m" and an integral as "j".

### Fixed

- Two collinear marks are no longer merged into one glyph. Every cross product of collinear segments is zero, so the classic sign test called them crossing however far apart they were, and the limits above and below an integral became a single symbol.
- A dominant symbol written on its own stays a plain symbol instead of producing an empty root or empty limits.

## 2.2.1

### Fixed

- Changing the language now reaches the board that is already open. The controls are built once when a board opens, so switching to English only relabelled the settings tab and left the toolbar, the tag chips and the panels in Spanish until the board was reopened. They are rebuilt in place instead, keeping the drawing untouched.

## 2.2.0

### Added

- English interface alongside Spanish, following Obsidian's own language setting, with a Language control in the settings to force either one.
- Catalogues in `src/locales/`, keyed by the Spanish source string, so a new language is one file and a missing message falls back to Spanish instead of showing a key.
- A test that fails when a translation drops a placeholder such as `{p0}`, which would otherwise print a message with a hole in it.
- Bilingual README, English first.

### Fixed

- A unicode escape that was rendered literally in the "open the original post" button.

## 2.1.0

### Added

- Local study actions for summaries, key ideas, review plans, outlines, flashcards and note cleanup.
- Geometry-aware board-to-LaTeX recognition with OCR fallback for images and PDFs.
- Multi-page boards, searchable pages, bookmarks and tag summaries.
- Editable task checklists and tag boards with titles, handwriting and images.
- Tables, charts, code blocks, sticky notes, smart ruler, A4 guides and paginated PDF export.
- Portable NoteLens packages with bundled local attachments.
- Device uploads and embeds for documents, images, audio, video, EPUB and supported web-video providers.

### Changed

- Reworked the toolbar, object selection, rotation, resizing, text placement, cursors and responsive layout.
- Made new installations private by default for translation; the optional web fallback must be enabled.
- Updated PDF import/export dependencies and embedded the PDF worker in the standard plugin bundle.
- Made builds reproducible and removed machine-specific deployment paths.

### Fixed

- Preserved shape and ink transparency while rendering.
- Kept margins aligned with page zoom and separated them from the background pattern.
- Ensured pending edits flush when a board, tab or Obsidian closes.
