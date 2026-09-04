# Changelog

## 2.8.7

Same plugin as 2.8.6, published again so the community catalogue check runs against a release made after its last attempt.

## 2.8.6

### Fixed

- A gesture that starts on the board belongs to the board. Obsidian reads swipes across the app to open its sidebars and its own panels, so a stroke drawn from one side, or a hand moving across the page, could be interrupted by the app sliding something over it. Touches that land on the canvas stop there now, on a phone and on a tablet alike; a touch inside a text box still reaches the app, which is what places the caret and raises the keyboard.
- Writing on a phone. Tapping with the text tool cancelled its own press, which is what stops a phone from raising the keyboard for the box that just appeared, and the box was left focused only until the tap finished. A finger's press is left alone now and the focus is held through the rest of the gesture.
- The keyboard covered what was being written: a box tapped low on the page sat behind it with no way to see the words. The board slides up by exactly what is needed — never past the top bars — and slides back when the keyboard closes.

### Tooling

- `dev-harness/run76.mjs` runs the phone and the tablet through it: a gesture on the canvas reaching the app, a gesture inside a text box not reaching it, the tap that makes a box keeping its focus, what is typed being kept, and a raised keyboard moving the board up and letting it back down.

## 2.8.5

Same plugin as 2.8.4, published again so the community catalogue check runs against a release made after its last attempt.

## 2.8.4

### Fixed

- Nothing could be drawn on a phone. A finger only ever moved the board — palm rejection written for a tablet held with a stylus, applied to a device that has no stylus — so the pen, the highlighter, the shapes and the eraser all did nothing at all. A finger now writes with the tool that is selected, and starts moving the board only once a stylus has actually been used in this vault (remembered from then on). Two fingers still pan and zoom, and "Draw with your finger" in the settings forces writing either way.
- The eraser button was an empty square on a phone. The drawing on it was sized as a percentage of the button, and Obsidian's mobile styles leave a button's width to its content — so the sprite measured itself against itself and came out at nothing. It is sized in pixels now, and if the drawing cannot be painted at all a plain line icon takes its place instead of leaving a blank.
- The rubber was invisible on a touch screen. It was only ever drawn while a mouse hovered, which never happens on a phone: it now appears where the finger lands, follows it, and leaves when it does. It also stays visible if the pointer crosses a toolbar mid-erase.
- A hand resting on the screen while the stylus wrote turned the stroke into a gesture: the board moved and the writing stopped. Touches are ignored while the pen is on the glass.
- A second finger arriving mid-stroke left a dot — or a stray shape — where the first one had touched. The started stroke goes with the gesture now.
- A stroke could come out as a single point on a browser that reports no coalesced events for a move; the move itself is used when that happens.

### Tooling

- `dev-harness/run75.mjs` covers what no other run did: a finger drawing and erasing on a phone, two fingers panning, a stylus taking over palm rejection, a palm landing mid-stroke, the stylus being remembered across sessions, and the eraser button surviving both the app's mobile button styles and a sprite that will not load. `run-devices.mjs` fails on any tool button that comes out blank.

## 2.8.3

Same plugin as 2.8.2, published again so the community catalogue check reads a release that matches `manifest.json`; its first attempt ran while the 2.8.2 release was still being published.

## 2.8.2

### Added

- A board can be made where every other thing in the vault is made: right-click a folder in the file explorer — or hold it down on a phone or tablet — and "New NoteLens board" sits next to "New note" and "New folder", in the language Obsidian is running in. The board lands inside that folder, and its name follows the language too (`Board_2026-09-04` in English, `Pizarra_2026-09-04` in Spanish). Until now the only ways in were the ribbon icon and the command palette, neither of which is where anyone looks on a tablet.
- A hand tool (M) in the toolbar, so a stylus moves the board without putting a finger down: drag anywhere, over a note or a PDF included. The barrel button of a pen does the same without leaving the tool you are drawing with, and does not open the canvas menu while it pans. Alt+drag, which the shortcuts sheet has always promised, now pans from any tool instead of only the selection one.

### Fixed

- The board did not fit a phone. Obsidian floats its navigation bar over the bottom of the view, and the paper, bookmarks, pages, zoom and document rows all sat underneath it, out of reach; on a narrow phone the zoom pill also landed on top of the pages button. Everything anchored to the bottom now clears the bar — measured from the app when it is there, allowed for when it is not — and the bottom row is one line that fits a 360px screen. Held sideways, the insert and document tools stand up as columns against the sides instead of stealing three of the six rows a landscape phone has.
- Tags spoke Spanish in an English Obsidian. Placing Important, Question, Key idea, Task or Floating note showed Spanish in the hover card heading, the badge tooltips, the step wording of a task ("paso a mano", "hecho", "pendiente"), the image errors of the note dialog, the search box and the empty states of the tag summary, and the text a tag prints on an exported PDF. Every one of them goes through the catalogue now, and `dev-harness/run73.mjs` places all five tags in English and reports anything that is still Spanish.
- The shortcuts sheet was written in Spanish whatever the language — every key and every explanation in it. `dev-harness/run57.mjs` now opens it too, so it is audited with the rest of the interface.
- The first page of a new board was called "Página 1" whatever the language, while every page added after it was named in the interface language; a board created in English now starts on "Page 1", which is also the name the tag summary shows next to each tag.

### Tooling

- `dev-harness/run-devices.mjs` boots the board on seven shapes — phone portrait, landscape and small, tablet both ways, laptop and desktop — with Obsidian's own mobile header and navigation bar reproduced around it, and fails on a control that leaves the view, two that overlap, a row that cannot be scrolled to, or a board with less than 110px left to write on. `npm run devices` runs it and leaves a screenshot of every shape in `dev-harness/shots-devices`.

## 2.8.1

### Fixed

- The unit keys of the scientific calculator ran past the edge of its panel.

## 2.8.0

### Added

- The eraser on the board is the one drawn for it — the tool button, the pointer that follows the pen and the header of its panel all show the same drawing, keyed onto transparency and embedded in the plugin (`src/eraser-sprite.ts`, rebuilt by `dev-harness/make-eraser-sprite.py`).
- Pasting the path of something in the vault drops its card on the board, the same card the notes and boards panel shows, instead of the address as text. It understands the full path copied from the file explorer, a path relative to the vault, a `[[wikilink]]`, a `file://` URL and Obsidian's own `obsidian://open` address; a file outside the vault still pastes as text and says why.
- Text boxes are edited as they will look. A box used to be a textarea, so formatting was typed as marks and only turned into formatting once you left the box, and a colour could only ever belong to the whole box. Prose now edits in place: select a word and make it bold, italic, underlined, struck through, highlighted or code, give it its own ink colour or its own highlight tint, and see it while you type. Ctrl+B, Ctrl+I and Ctrl+U work as everywhere else, and with nothing selected a command arms the style for what you type next.
- Every fragment can carry its own highlight tint, picked from the seven felt colours in the bar, and its own colour from the ink row next to them. Each row opens with a crossed-out dot that takes it back off — the ink of the box again, or no highlight at all — and a button next to the style ones clears every bit of formatting from the selection at once.
- An empty text box says what it is for instead of showing a bare caret.
- Seven more typefaces for text boxes — handwritten, marker, elegant, slab, condensed, typewriter and display — next to the four that were already there. Every family lives in one table now (`src/fonts.ts`), which the ribbon panel, the format bar, the canvas and the PDF export all read.

### Changed

- The preview on a note card reads like the note. It used to print the first five lines whatever they were, so a note that opens with a code block showed its JavaScript on the board; fenced code, HTML, embedded images and the punctuation of links and emphasis are now dropped, and what is left is the prose.
- Translating answers straight away. It used to go to a model on this computer first, which meant tens of seconds for a paragraph and nothing at all on a machine with no model; it now asks two free public endpoints that need no key, no account and have no daily cap, and comes back in about half a second (MyMemory stays behind them as the last door). A model on this computer is still used when the web is unreachable, and the "translate only on your computer" setting — off by default now — keeps everything local for anyone who prefers that.
- The drawing pad of a note is as big as the window allows. The dialog opens out to about twice the width when you switch to the board tab and comes back in for writing, the pad grows with it (996 x 569 on a 1400 x 900 window, against the old fixed 560 x 320), and it is drawn at twice the pixels so a note shown large stays sharp. The card that appears on hover shows the drawing at 522 x 299 rather than 320 x 183. Drawings made before this still line up with the images pinned around them.
- The highlighter lays down one even band. It used to be a plain translucent line; it is now the print of a flat felt tip, slanted at both ends the way a real marker leaves them, the same width whichever way you swipe, and multiplied where two strokes cross so they deepen instead of washing each other out. The band of a stroke is built once and kept, so panning and zooming a board covered in markers costs about two milliseconds a frame.
- A box keeps its words in `text` as plain Markdown (`**negrita**`, `==resaltado==`) next to the runs the editor writes, so search, the summary tools, the shared boards and the Markdown exports go on reading a box as text. Colours are the one thing marks cannot say: they live only in the runs. Boxes written before this release open with their marks already turned into real formatting.

### Fixed

- Bulleting a whole box left the caret on its first line, so the next thing typed went in the wrong place; it now waits at the end, ready for the next item.
- The floating format bar folded into three rows on a normal window. Its buttons and swatches are a size smaller and it fits in two.

## 2.7.0

### Added

- Maths symbols are recognised from handwriting people actually produced. The shapes used to be drawn by one person guessing what a sigma looks like; they now come from the Hand-TeX database (221,263 samples, extending Detexify's), 64 examples of each symbol. Measured on 1,282 real samples the builder never saw, recognition of maths symbols went from **5 %** to **44 %**.
- Fifty-three symbols backed by that data: ∫ ∑ ∏ ∂ ∇ ∞ ≈ ≠ ± ∓ × ÷ ≤ ≥ ∈ ∉ ⊂ ⊆ ∪ ∩ ∅ ∀ ∃ ⇒ ⇔ ≡ ∝ ⊥ ∥ ∠ → · √ ℝ ℕ ℤ ℚ and the Greek alphabet.

### Fixed

- Several strokes that make one symbol are no longer cut apart. A ≡ was read as a fraction of two dashes, a ± as a fraction, a ⊥ as "-1" and a ∥ as "11": when the parser has had to cut ink up and is unsure, and the whole thing matches a symbol far better than the pieces did, the symbol wins.
- Symbols with many examples no longer beat symbols with few on numbers alone. Averaging the three closest examples of each symbol, rather than taking its single luckiest one, stopped a "0" reading as ∂ and a heart as ∇.

### Changed

- A signature (how the strokes spread over a 4×4 grid, plus the aspect ratio) sieves the shape library before the real comparison runs. That is what makes a library twenty times larger affordable: 46 ms per symbol rather than 500.
- `src/ink-prototypes-odbl.ts` carries the Open Database License and its attribution; the rest of NoteLens stays MIT. No Hand-TeX code (GPL-3.0) is used, only its published data.

## 2.6.1

### Fixed

- The formula reader no longer invents a symbol it does not know. Every match had a winner however badly it fitted, so anything outside the library came out as whichever letter was least unlike it. The line between knowing and guessing is measured, not assumed: ten shapes the library does not contain (a spiral, a heart, a house, a star, a scribble) match at 1.62 and worse, while every symbol it knows matches at 1.26 or better. Past that line the glyph is reported as unknown, written as `?` in the notation, and its nearest guesses are offered for you to pick.
- The image reader was inventing too: asked about a symbol the stroke reader had refused to name, it read a spiral as "9" and replaced the `?` without a word. Its answer is now offered as one more candidate instead of taken as the truth.
- A weak geometric guess no longer rescues an unknown shape. A heart is a closed loop, and the closed-loop rule was claiming it as a zero.
- The review dropdown showed empty for an unknown symbol, because the `?` it held was not among its own options.

### Added

- Thirteen symbols the honesty test found people writing and the library did not have: ≈ ≠ ± ÷ × ∂ Δ ∇ ∈ ≤ ≥ μ, and the two marks of ≈ are now read as one symbol rather than two dashes.

## 2.6.0

### Fixed

- Handwritten formulas are read properly. The recogniser used to draw the ink into a bitmap and compare it with the same characters rendered in a printed font, which is not what handwriting looks like: on a bench of 38 ordinary symbols and expressions it scored **42 %**, reading every round shape as "b" and a "t" as "+" with 0.96 confidence. It now matches the trajectory of the strokes against a library of how each symbol is actually written ($P point-cloud matching), and scores **100 %** on that bench and **97 %** on the same corpus written smaller, larger, shakier and slanted — variations the work was not tuned against.
- A "6" and a "9" were read as integrals, an opening bracket as a "2", a "7" as "-" followed by "/", a flagged "1" as "x", and a "t" as "+". An integral descends the whole way and a "2" lands on a base; strokes that meet at a corner are one symbol, and a cross through the top of a stem is a "t", not a "+".
- The dot of an "i" is part of the letter and no longer becomes a superscript, and the bowl of a "b" no longer splits from its stem when the rest of the line holds smaller symbols.

### Changed

- Leen, the assistant, is held back for a later release: no pet on the board, no chat and no assistant settings. The code stays behind a flag in `src/features.ts`, so it comes back with one boolean. His local study actions (summary, key ideas, revision plan, outline, flashcards, tidy text, arrange selection, polish ink) go with him for now.
- The local model settings stay, because the translator talks to the same server, and they no longer mention a chat this release does not ship.

## 2.5.0

### Fixed

- The English interface is actually in English. Around 200 strings reached the screen through helpers and data tables — tool panel headings, grid sizes, table controls, the whole symbol palette, the format bar, tag hints and cards, page and bookmark names, the calculator's memory keys and keypad tabs, and every one of Leen's local actions — so they never passed through the translator. A new audit boots the board in English, opens every panel and dialog and reports what is still Spanish; it now reports nothing.
- The eraser's mode cards and the selection tool's shared one CSS class, so restyling one silently restyled the other. They share a named card style now.

### Added

- The equation dialog has two ways in, side by side: write it by hand, or type it with the full palette of about eighty symbols grouped by subject. Both feed the same notation and the same live preview, so a formula can be started with the pen and finished on the keyboard. The palette lives in one file that the formula box's format bar reads too; it used to be a second copy of the same table.
- The eraser panel shows what it is about to do: a stroke with the eraser sitting on it, whole in one mode and cut in the other, and sizes drawn as the discs they really are instead of four identical pictures of an eraser. Each mode says in a line what it does.
- The local model has its own settings section that says plainly what needs it (chat and quota-free translation) and what does not (every board action). Testing the server reports what it found and which model it would pick for the memory this machine has, and keeps it on screen instead of firing a Notice that disappears.

### Changed

- The local model settings no longer hide when Leen is turned off: the translator asks the same server and was losing its configuration with him.
- The README reads like a person wrote it.

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
