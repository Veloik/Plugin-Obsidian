# Changelog

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
