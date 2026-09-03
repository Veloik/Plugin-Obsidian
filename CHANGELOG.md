# Changelog

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
