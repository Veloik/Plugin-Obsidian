# Changelog

## 3.2.5

### Changed

- The straight-line button is a switch now, not a button to hold down. Press it and everything you draw comes out straight until you press it again — a tablet has no third hand to keep a button down with while the other two hold the stylus and the board. Shift still does the same thing on a computer.

## 3.2.4

Republished under a new number at the author's request; the code is the same as 3.2.3.

## 3.2.3

### Fixed

- The straight-line button on a tablet would not let go. The dock around it stops a release from travelling any further than itself, and the button was listening for that release on its way up — so the press never ended, and the next stroke came out straight on its own. It now listens on the way down, where nothing can stop it. The button also keeps its own touch instead of handing it to the dock's sideways scroll, which was taking the press away before the hold began.

## 3.2.2

Republished under a new number at the author's request; the code is the same as 3.2.0.

## 3.2.1

Republished under a new number at the author's request; the code is the same as 3.2.0.

## 3.2.0

### Added

- EPUBs can be read on the board. Putting a book on the canvas now asks the same kind of question a PDF does: a reader that opens the book right there — chapter by chapter, with a table of contents, its own pictures, and the place you left it remembered — or the small card that opens it in your usual reader. Either can become the other from a button, so the choice is never final. The book's markup is sanitised before it is shown: what survives is the text, its structure and its figures, never anything that could run.
- Code blocks read their own language. Code pasted without a fence is recognised from the source itself — Python, JavaScript, TypeScript, Java, C#, Go, Rust, SQL, Bash, JSON, YAML, CSS, HTML and a dozen more — and highlighted at once, with an `auto` badge saying it was a guess. Choosing a language by hand, or writing a fence, pins it for good.
- A code block is now drawn line by line, so its numbers can never drift out of step with its code. That buys two things: a button in its header folds long lines instead of scrolling them sideways, and pressing a line number marks that line — both remembered with the board.
- Every saved section is drawn on the board where it was saved: a quiet dashed marker with its number and name, which brightens under the pointer and takes you back to that view when tapped.

### Fixed

- A tag is the one thing on the page a painting tool may still touch. It was inert with the pen in hand, which is backwards: tags are how a notebook is organised. They now stay live — and above everything else the page carries — so the stylus ticks one off or opens it like a finger does.
- Nothing you operate can be painted on any more. Tags, section markers, videos, recordings, charts, tables, note cards, code blocks, books opened on the board, attachments and links to other notes and boards are drawn in a layer of their own above the ink: a line that crosses the page runs behind them, and a press that lands on one presses it instead of starting a stroke there. Selection boxes and handles were lifted up there too, so a selection is never buried under the strokes. Pages, pictures, prose and formulas stay under the ink, because writing on those is the whole point.
- Drawing across a tag no longer opens the tag summary. A press on a tag is read from the pointer itself rather than from the browser's click, and only one that stayed still and ended quickly counts; anything that travelled is the stroke it looks like. Holding on a tag no longer opens its menu over the drawing either.
- A code block carried two crosses: the one every box on the board has at its corner, and a second in its own header. The header keeps the folding and the copy; deleting stays where it is on everything else.

## 3.1.1

Republished under a new number at the author's request; the code is the same as 3.1.0.

## 3.1.0

### Added

- A straight-line button sits beside the ruler on tablets and phones. Held with one thumb while the other hand draws, it does what Shift does on a computer; let go and the stroke carries on free. It is not shown where there is a keyboard to hold Shift down with.
- The board says which note is on it, on a plaque beside the pages and bookmarks it is filed with. A board opened full screen on a tablet has no tab to read the name from, and a vault of boards that all look alike needs to say which one you are drawing on. With more than one page, the page is named there too.
- A stylus held near the glass shows the nib it would write with — the footprint it leaves, in its own colour and size, with the tool's badge beside it. The browser draws no cursor for a pen that has not touched down yet.

### Fixed

- The board menu belongs to the hand and the selection tools. Holding the stylus still while drawing used to open it over the work; Windows hands a press-and-hold over as a right-click with "mouse" written on it, so the tool now decides and not the pointer. A right-click on a machine with no touch screen still opens the menu with any tool.
- A floating note is no longer dismissed by a stray touch on the dimmed background: on a tablet the heel of a hand lands there far too easily, and the note holds written work. Guardar and Cancelar are the ways out.

## 3.0.1

### Fixed

- The finger drawing switch now lives between Hand and Pen, where it can be found while choosing how to work on a tablet. Its real touch target is covered by the tablet regression test.
- The calculator's tablet sheet uses a subtle slate grip instead of the dark bar that appeared as a black block against its pale body.
- Two fingers placed on the ruler rotate it around their shared centre; one finger still slides it. Lifting one finger continues the slide smoothly with the one that remains.

## 3.0.0

### Added

- A finger can draw. It moved the board and nothing else once a stylus had been used, which is right until you want to mark something with one: the dock now carries a switch for it, and two fingers pan and zoom either way. The choice is remembered.
- Files dragged onto the board from a file explorer land where they were dropped, and several at once are fanned out rather than stacked. A file the vault already holds is shown where it is instead of being copied again.

### Fixed

- The ruler follows a finger whatever the tool is, so it can be slid along while the other hand keeps drawing against its edge. Every gesture now follows only the pointer that began it: a pen resting on the board used to drag the ruler with it.
- Pasting a file that was not an image did nothing at all; a PDF or a document copied in a file explorer now lands on the board like an image does.
- A sticky note's folded corner was drawn as a filled dark square. It is a border triangle, and a border triangle needs content-box sizing, which Obsidian's own reset takes away.
- Floating panels are dragged from anywhere on them, not only by the thin strip of their title, and a press on a key becomes a drag once the pointer travels. On a narrow screen the grip drawn across their top was a pseudo-element no press could reach, and the transform that centres them dropped them half their width from the finger.
- The marker re-rendered the whole document on every pointer move; it now does so at most once a frame. The ruler no longer asks for a backdrop filter over a canvas that repaints on every stroke.

### Changed

- One voice for the panels: three of them borrowed the calculator's title, which is dressed for its white face, so each announced itself differently. Dropdowns, tick boxes and focus rings are drawn to match the board rather than the platform.
- The format bar reads in groups. Its size control was broken in three across a line wrap, with the translate button landing in the middle of them, and the dash list read as a rule across the bar rather than a list style.
- A selected object offers one way to delete it. Its own close is put away while the selection bar carries one, and the rotate handle has moved out from under that bar.
- The insert and document docks are grouped by where a thing comes from: what the vault or the device already holds, what you make here, and what acts on what is already there.
- Pages and bookmarks: a header of two matching buttons, a count that reads as a count, rows that light up as a whole, and no more "open page" written under every page.

## 2.9.9

### Fixed

- The ruler draws its scale instead of laying it out, so the ticks land on whole pixels and each number sits under its own mark. The protractor is kept half as tall as it is wide, so it is a real semicircle and the degrees it marks are the degrees you get; it used to be an ellipse.
- Ink snaps anywhere on the protractor's body, not only within a narrow band along its base line, and the rotate handle sits inside the tool instead of hanging over its edge, where the shape's rounding swallowed both half the control and the press.
- A line break in a text box is an element rather than a bare newline, so the caret can sit on the new line and what you type next lands after the break instead of in front of it.

### Changed

- Rich text boxes edit the runs they are made of instead of calling `document.execCommand`, which is deprecated and behaves differently between builds. Bold, italic, underline, strike-through, the marker, ink colour, clearing formatting, typing, tab, line breaks, deletion and list continuation are all changes to those runs. A box keeps its own undo while it is open, since the browser's cannot follow a repaint, and a command used with nothing selected arms the style for whatever is typed next.
- Settings are described as definitions, so NoteLens answers Obsidian's own settings search on 1.13 and later. The tab is drawn exactly as before, and `minAppVersion` is unchanged.
- The marker re-rendered the whole document on every pointer move; it now does so at most once a frame. The ruler no longer asks for a backdrop filter over a canvas that repaints on every stroke.
- Every warning from the community review is cleared: the deprecated `execCommand`, `queryCommandState`, `queryCommandValue`, `keyCode` and `display` calls, and in the stylesheet 36 `!important` declarations, `:has`, `clip-path`, `box-decoration-break`, the `text-decoration` longhands, the named system fonts and the `mjx-container` selector no linter can know.

## 2.9.7

Same code as 2.9.6, released under a new version number.

## 2.9.6

### Fixed

- `LICENSE` is the plain MIT text again, so GitHub recognizes it. The Open Database License notice covering `src/ink-prototypes-odbl.ts` moved to `NOTICE.md`, linked from the README; the attribution is unchanged.
- Loading a PDF that fails now stops cleanly instead of reaching for pages of a document that was never loaded: `loadPdf` returns a typed `PDFDocumentProxy`, and the null check survives into the render callbacks that had lost it.
- Pop-out windows: the mobile navbar is measured on the board's own document, and text-box type checks use Obsidian's cross-window `instanceOf`.

### Changed

- Follows Obsidian's plugin guidelines: `getFileByPath`/`getFolderByPath` in place of `getAbstractFileByPath`, `Vault.process` in place of `Vault.modify`, `createEl` helpers in place of `createElement`, no `any` casts over `getAvailablePathForAttachment`, and the "new board" command no longer repeats the plugin name Obsidian already prefixes.
- The pdf.js and model-probe call sites are typed instead of `any`, removing the bulk of the community review's lint warnings.

## Unreleased

### Fixed

- Expanded handwritten digit variants and width coverage: a screenshot reconstruction of two thirds minus five now recognizes all digits instead of three unknowns. Regression coverage includes scale, aspect ratio, reversed stroke direction and the equation dialog.

- Board-to-LaTeX uses the full equation parser for nested roots, sums, indices and multiple lines, preserving existing LaTeX and typed variable names.
- Region capture clips crossing ink segments correctly and caps its longest raster dimension at 1800 pixels, including large selections.
- Equation erasing works between sampled points. Undo and redo restore erased and cleared ink; keyboard shortcuts work outside text inputs.
- Recognition ignores interrupted pointer streams and stale results. Candidate corrections skip LaTeX command names and are invalidated after manual edits.
- Cancelled ruler, resize and object drag gestures release their move handlers.

### Tests

- Added parser, clipping, erasing and candidate-location regressions to the core suite.
- Added `node dev-harness/run87.mjs` for crossing ink, live equation recognition, erase/undo/redo/clear and gesture cancellation.

## 2.9.5

### Fixed

- Shift and drag draws the whole straight line, with the pen and with the marker. The pen inked it only as far as its halfway point, because the last segment of any stroke stopped short of its final point, and the marker kept the stub the line started as: its band was cached by how many points a stroke had, and a straight line always has two.
- Pressing Shift part way through a stroke drops the curve already inked instead of leaving it on the board until the pen is lifted.
- Reading a formula from the board no longer happens behind the equation dialog, whose backdrop swallowed the region selection. A reading that arrives after the strokes changed, or after the dialog closed, is discarded, and the dialog opens ready to type when it already has notation.
- On a phone, the formatting bar docks along the bottom of the board while a text box is being edited and the board's own controls stand down for it, so the words being edited are never buried. Fullscreen keeps the room the phone claims for its clock and its home bar.

### Tests

- Shift straight lines: pen and marker, mouse and stylus, Shift held from the start or joined mid-stroke, both while drawing and once released. The ink has to stay on the line and reach its far end.
- Phone checks for writing with the keyboard up, for zooming, and for fullscreen on a screen with a notch join `npm run test:mobile`.

## 2.9.4

### Fixed

- Settings and shortcuts fit within the mobile board in portrait and landscape. Their contents scroll, with sticky headers and accessible close buttons above the drawing controls.
- Increased spacing between phone navigation and the document dock, and moved the minimap to match.
- Added checks for panel bounds, scrolling, close controls and dock separation at 390x844, 844x390 and 320x568.
- Toolbar icons keep their full size on a phone: the rails scroll when they run out of room instead of squeezing their buttons, and the icons are drawn larger in portrait and landscape, where the icon is the only label a button has.
- Added a check that every toolbar icon stays square, keeps a legible size and fits inside its button at 390x844, 844x390 and 320x568.

## 2.9.3

### Fixed

- Mobile editing temporarily mounts the existing board directly under the document body so a keyboard-collapsed Obsidian pane cannot clip it. The board follows the visible viewport and returns to its original parent after editing.
- Map and fullscreen controls are visible in a separate navigation row on phones. Mobile fullscreen expands the board within the app without depending on the browser Fullscreen API.
- Added phone checks at 320px and 390px for clickable controls, fullscreen exit, clipped keyboard ancestors, visible editing and overlay cleanup.

## 2.9.2

### Fixed

- Mobile text editing now preserves the board when the native keyboard resizes the view during focus.

- Capture the mobile board and viewport dimensions before focusing text, code or formula editors. A native keyboard that resizes both viewports during focus previously left the recovery logic with an already collapsed baseline. Prevent automatic focus scrolling from displacing the board.

### Tests

- `dev-harness/run78.mjs` reproduces synchronous keyboard resize at 65% zoom for all three editors, checks visible typing and canvas coverage, and verifies layout cleanup.

## 2.9.1

### Fixed

- Writing on a phone left the board black. With the keyboard up, the app can take the keyboard's height off a view the system had already made smaller, and what was left was a strip of about ninety pixels: the toolbar cut in half, no board underneath and nothing to write on. The board now measures what each box was worth before the keyboard arrived and takes back the room that is really there, up to the top of the keyboard and never a pixel more, and gives it up again untouched when the keyboard goes.
- The board is raised over the keyboard by painting it higher, not by moving the canvas: before, the canvas slid up and uncovered a band of unpainted page at the bottom, and a touch landed as far from the finger as the board had moved. The ink, the boxes, the page background and the pointer maths now share the same offset, and the document never sees it.
- A view left as a strip — a keyboard over a small pane — keeps its board and its tools, and hides the secondary docks that would otherwise take the little room there is.

### Tests

- `dev-harness/run77.mjs` squeezes the view under a keyboard and checks the board comes back, that the canvas covers all of it, that a touch reads where the board shows it, and that the view is handed back its own height afterwards. Verified to fail without the fix.

## 2.9.0

Same plugin as 2.8.9, published again so the community catalogue check runs against a release made after its last attempt.

## 2.8.9

### Fixed

- A board that cannot be read no longer opens as a blank page over the file that failed. Editing and saving are held back, the view says so, and the original is left untouched until it can be opened again. A save that fails now says so too, stays pending instead of being forgotten, and no other document can take the board's place while it is unsaved; the undo snapshots are cleared when the file changes, so one board's history can never land in another.
- The board no longer resets when the view changes size. A resize to the same size, or to none at all, keeps the picture it already has, a screen with many pixels per point no longer asks for more canvas than it can hold, and ink is painted again when the browser gives the canvas back after taking it away.
- The lift that keeps writing above the keyboard is undone as soon as the box is committed or the board is closed, so a board left over from typing no longer sits pushed up. Keys pressed while the phone's own input method is composing a word are left to it.
- Video links shared from a phone are understood: a YouTube share with its `nocookie` host or a start time, a private Vimeo link with its hash, and the shortened TikTok and Instagram links, which open on their own site through a card rather than an empty frame. Every remote video keeps a link to the original for when the provider refuses to play inside Obsidian; a video from the vault still plays on the board.
- An imported package is read within limits — how much it holds packed, how much it becomes unpacked, and how many files it carries — so a large or malformed archive cannot exhaust a phone's memory.

### Tests

- Core regressions and a browser suite for the above: a screen with many pixels per point, the keyboard going up and coming back down, a word being composed, a phone turned on its side, the canvas being taken away and given back, video links that cannot be embedded, and a file that fails to read. The device profiles now use the pixel density each device really has.

## 2.8.8

### Changed

- A new board is called a Dashboard in English: `Dashboard_2026-09-04.notelens`, where a Spanish install still makes `Pizarra_2026-09-04.notelens`. Only the file's own name changed; the "Board" tab inside a tag's note keeps its word.

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
