# Axiom native: the plan

**Why.** The iPad app was a web page drawn over a native PencilKit view. Most of the reported problems came from the
seam between the two:

- **Touches:** two touch systems decided who owned each touch, which caused the stuck scrolling and the long-press that stole the scroll.
- **Drawing:** two renderers had to stay aligned, which caused the offset ink and selections drawn a few points off.
- **Menus:** two menu systems competed, which caused flashing popups and the stray "Paste".
- **Memory:** the web page's memory ran out on large books, which caused the "thrown out" reloads.

The native app removes the seam. It is built only from Apple frameworks: SwiftUI, UIKit, PencilKit and PDFKit.

## Architecture

| Layer | Native implementation |
|---|---|
| App, navigation, library, settings | SwiftUI (`NavigationSplitView`, `@Observable` models) |
| Notebook / canvas editor | UIKit: `PKCanvasView` (ink, scrolling, zoom) + a paper view behind it (templates, pictures, text) + a selection overlay above it, all driven by one `UndoManager` |
| Book reader | PDFKit `PDFView` + `PDFPageOverlayViewProvider` (a PencilKit canvas per page), PDF highlight annotations, native search, thumbnails |
| AI tutor, smart notes, flashcards, exam prep | `URLSession` streaming to the Claude Messages API, SwiftUI chat |
| Desmos | a plain `WKWebView` tab: an embedded website, never an overlay |
| Lecture audio | `AVAudioRecorder` / `AVAudioPlayer` (the existing audio code) |
| Storage | The same files in Application Support (`Drawings/*.axiom`, `*.meta.json`, `Files/*.bin`, `settings.json`). The native app reads the existing data directly, so nothing is lost |

### One rule per interaction (from the GoodNotes / Notability / Apple Notes research)

**Pencil:**
- Draws with the current tool.
- Lasso is a tool you pick.
- Double-tap follows the system setting (eraser, previous tool, colours).

**Finger:**
- Drag scrolls; pinch zooms.
- Two-finger tap undoes; three-finger tap redoes.
- Double-tap zooms in, or back to the fitted page.
- Press-and-hold on ink or a picture selects it (the word you wrote), and the same finger can drag it.
- Press-and-hold on empty paper opens the page menu on lift (Paste only when there is something to paste).

**Menus:** one menu at a time, all Axiom's. PencilKit's own menus are disabled at the source.

## Phases

1. **Core:** app shell, design system, data model and migration of existing data, library (home, books,
   notebooks, canvases, courses, search, create and import), notebook editor (paper templates and sizes, pages and the pages
   sidebar, pens, highlighter, eraser, ruler, hold-to-shape, pictures with crop, text boxes, lasso and press-and-hold
   selection, unified undo, insert menu), canvas editor (infinite paper, grids, rotation).
2. **Reader:** PDF reading with Read / Highlight / Write modes, lasso-to-ask, highlights, search, contents, thumbnails, page
   colour (paper, sepia, night), zoom and fit, "solve beside" (notebook and book side by side).
3. **AI:** tutor chat with scopes (page, notebook, book, course) and citations, smart notes, practice questions,
   flashcards, check page, exam prep (plan, topics, past questions, practice and mock).
4. **Rest:** lecture recording and replay, Desmos tab with insert, export and share (PDF, PNG), versions, settings, visual
   tools library, artboards, layers.

The device keeps the current app until the native app covers phases 1 to 3. The web version on GitHub Pages is frozen at
the last hybrid release (git tag `hybrid-final`).
