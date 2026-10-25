# Axiom web app: porting spec for a native Swift/SwiftUI rewrite

I read every file in `src/js/` (25 files, about 13k lines), the token blocks of `src/css/app.css`, and the Swift shell in `ios/Axiom/`. All paths below are relative to `/Users/muhammedkarimmagomedov/axiom/`. Script load order is in `build.mjs:4`: core, icons, store, subjects, geom, brushes, doc, render, guides, input, stamps, ui-tools, ui-color, ui-layers, ui-panels, study, ai, examprep, reader, textedit, notebook, pkink, crop, ui-gallery, app. There is also an existing 55-line plan at `docs/NATIVE_PLAN.md`.

Conventions used throughout:
- **Ids** come from `A.uid()` (`core.js:6`): 7 random base-36 characters plus the last 5 characters of `Date.now()` in base 36.
- **World units** are CSS px at 96 dpi, so 1 mm = 96/25.4 ≈ 3.7795 units (`doc.js:14`).
- **Matrices** are `[a,b,c,d,e,f]` in canvas convention (`core.js:23-42`).
- **Bounding boxes** (`bb`) are `[x0,y0,x1,y1]`.

---

## 1. Data formats on disk

### 1.1 Storage backends
**Web build** (`store.js`):
- IndexedDB database `axiom`, version 2, with three stores keyed by `id`: `docs`, `meta` and `files` (`store.js:4,21-26`).
- Files are stored as `{id, buf: ArrayBuffer, type}` because Safari cannot keep Blob objects (`store.js:90-91`).
- Settings live in localStorage under `axiom.settings.v1` (`store.js:128`).
- The stroke clipboard lives in localStorage under `axiom.clip` as `{items:[...]}` (`ui-panels.js:223,316`).

**Native shell** (`ios/Axiom/DrawingStore.swift`):
- `Application Support/Drawings/<id>.axiom` holds the document JSON, and `<id>.meta.json` holds its meta record (`:12,20-21`). `list` returns every meta file joined into one JSON array (`:24-29`).
- `Application Support/Files/<id>.bin` holds every binary or file-store entry (`:51-62`).
- `Application Support/settings.json` holds the settings object (`:13,78-87`). It is injected at page start as `window.AXIOM_SETTINGS`, together with `window.AXIOM_NATIVE = {pen, platform:'ios', audio, pencilkit, orientationLock}` (`CanvasViewController.swift:116,132`).
- Ids are sanitised to alphanumerics plus `-` and `_` (`DrawingStore.swift:17-19`).
- The orientation lock is kept in UserDefaults under `orientationLock` (`CanvasViewController.swift:29,174`).
- `AppSchemeHandler.swift` serves the app at `axiom://app/`. GET `axiom://app/_files/<id>` streams the raw bytes of `Files/<id>.bin`, and POST or PUT writes them (`:52-64`), so large PDFs never become base64.
- The JS-to-native bridge is `webkit.messageHandlers.axiom.postMessage({op,...})` with a reply (`CanvasViewController.swift:233-406`). The ops are:
  - storage: `list`, `load`, `save`, `saveMeta`, `delete`, `fileSave`, `fileLoad`, `fileDelete`, `settings`;
  - system: `share`, `shareItems`, `keepAwake`, `orientation`, `snapshot`, `pasteboard`;
  - audio: `audioStart`, `audioStop`, `audioPlay`, `audioPause`, `audioSeek`, `audioRate`, `audioDuration`, `audioDelete`;
  - PencilKit: the `pk*` family.

### 1.2 Document JSON (`doc.js:27-48`, `D.create`)
```
{ id, name, created, updated, v: 1, kind: 'canvas'|'notebook',
  layers: [Layer], activeLayerId, layerMode: 'manual'|'auto', focusLayerId: null|layerId,
  view: { tx, ty, zoom, rot },                       // rot in radians
  paper: { bg: hex, grid: { type, spacing: 24, divisions: 5, opacity: 1 } },
  precision: { grid: bool, snap: false, snapMode: 'grid'|'align', connect: true, measure: false,
               units: 'mm'|'px'|'pt'|'cm'|'in', scale: 1, guide: false,
               guideType: 'line'|'ellipse'|'rect'|'angle', recog: true },
  guides: { line?: {p1:[x,y], p2:[x,y], limit:bool},
            ellipse?: {cx,cy,rx,ry,rot,circle?},
            rect?: {cx,cy,w,h,rot,square?},
            angle?: {v:[x,y], a:[x,y], b:[x,y]} },    // guides.js:41-44, 103-131
  artboards: [ { id, name, fmt: 'a4'|'letter'|'a5'|'a3'|'legal'|'square'|'wide'|'card'|'screen',
                 orient, x, y, w, h } ]                // doc.js:155, ui-panels.js:122
}
```
- `paper.grid.type` is one of `none|dot|graph|lined|iso|tri|eng`.
- **Notebook-only fields** (`doc.js:39-46`): `page: { size: formatKey, orient: 'portrait'|'landscape', template: tplId, color: hex, scroll: 'vertical'|'horizontal' }` and `pages: [ { id, template?, color?, bm?: bool } ]`. `bm` is a bookmark. A notebook is created with `paper.bg = page.color`, `grid.type = 'none'`, `precision.grid = false` and `precision.recog = false`.
- **Fields added elsewhere:**
  - `subject` (course id or null) and `fav` (bool): `ui-gallery.js:131,470`.
  - `folder` (folder id): `ui-gallery.js:160`.
  - `recordings: [{id, name, created, dur}]`, where `dur` is in seconds: `notebook.js:474`.
  - Tutor state for canvases and notebooks: `chats: [Chat]`, `chatActive`, `scope: {src, books:[], web}` (`ai.js:161,206,222`).
  - Study panel: `studyOpen`, `studyTabs: [docId]`, `studyActive: 'ai'|'graph'|docId`, `lastDocTab`, `graphTab: bool` (`study.js:136,152-169,253`).
  - PencilKit: `pkInk: true` once legacy strokes have migrated into PencilKit (`pkink.js:38`), and `pkParked: { pageId: slotIndex }` for the ink of deleted pages, parked at x = -60000 (`pkink.js:131-133`).
- `D.normalize` (`doc.js:170-194`) merges defaults into older files, recomputes missing `bb`, and repairs `activeLayerId`.
- **Page formats in mm** (`doc.js:15-19`): a4 210×297, letter 215.9×279.4, a5 148×210, a3 297×420, legal 215.9×355.6, square 210×210, wide 338.7×190.5 ("16:9 Slide"), card 127×76.2 ("Index card").
- **Page layout:** `PAGE_GAP = 28` world units. Page i's rect is `[0, i*(h+28), w, ...]` when scrolling vertically, or stacked along x when horizontal (`doc.js:25,53-56`). Items belong to the page their bbox centre falls on (`doc.js:67`). Inserting, deleting or moving pages shifts items by whole page steps (`doc.js:70-129`).
- **Trailing page:** one blank page is always kept at the end. When the last page gets used, a new page is appended copying its template and colour (`doc.js:132-141`).

**Layer** (`doc.js:11`): `{ id, name, visible: true, locked: false, opacity: 1, items: [] }`. Optional fields:
- `auto: 'pencil'|'ink'|'marker'|'airbrush'|'fill'`, used in auto-layer mode, which gives each brush group its own layer (`doc.js:303-318`).
- `pdfLayer: true`, a locked background layer for imported pages and reference images (`ui-panels.js:534`, `notebook.js:300,716`).
- `pk: true`, the locked mirror of the PencilKit ink (`pkink.js:41`).

**Items**
- **Stroke `t:'s'`** (`doc.js:204-209`): `{ id, t:'s', b: brushId, c: hex, w: size (world units), o: opacity, pts: [x,y,m, x,y,m, ...], mm: max m, bb }`.
  - `m` is the width multiplier per point.
  - Optional fields: `sharp` (polyline, no spline), `closed`, `rid` and `at` (recording id and seconds, 0.1 precision; `notebook.js:482-487`), `rv` (tape currently revealed; `input.js:716`), `pk` and `pki` (PencilKit mirror and its stroke index; `pkink.js:167`).
  - Transient render-only flags: `live`, `raw`.
  - `bb` is padded by `w*mm/2+1`, plus `w` for soft brushes (`doc.js:196-202`).
- **Image `t:'i'`** (`brushes.js:199`, `ui-panels.js:500`): `{ id, t:'i', src: dataURL, iw, ih, m:[6], o, bb }`.
  - Optional: `crop: {x, y, w, h, iw0, ih0}` in the original picture's units. The full image is kept; `iw`/`ih` become the crop size and `m` is shifted (`crop.js:10-23`).
  - Optional: `pdfPage` (`ui-panels.js:553`) and `ref` (reference label; `notebook.js:711`).
- **Text `t:'x'`** (`brushes.js:243-248`): `{ id, t:'x', text, fs: 20, font: 'sans'|'serif'|'mono'|'round', c, o: 1, iw: 320, ih (computed), m, bb }`. Optional: `bg` (sticky-note colour), `bold`, `rid`/`at`.
  - `B.transformItem` multiplies `m` for boxes, and for strokes transforms the points and scales `w` by √|det| (except wire) (`doc.js:216-231`).

**Undo history:** in memory only, limit 200. Each snapshot is `{layers (shallow), active, pages, artboards}` (`doc.js:246-294`). Items are immutable, so every edit creates a new id.

### 1.3 Meta record (`store.js:65`, written by `saveDoc`)
`{ id, name, created, updated, thumb: jpegDataURL|null, paper: doc.paper.bg, subject|null, kind, pages: count|null, fav: bool, folder|null, rec: recordingsCount }`

The thumbnail is `R.thumbnail(doc)` encoded as JPEG at quality 0.78 (`app.js:13`). Canvases render at 360×270, fitted to `allBB`. Notebooks render page 1 at 270 px wide with the page's aspect (`render.js:569-589`). Autosave runs 1200 ms after a non-view change, 1500 ms after a view change, and flushes on hide or background (`app.js:17-21,97`).

### 1.4 Settings object (`store.js:129-161` defaults, plus keys added elsewhere)
**Defaults:**
- `theme`: 'system'|'light'|'dark'.
- `toolSetup`: 'bar'|'wheel'. `toolSide`: 'left'|'right'. `toolPos`: `{x?,y}`.
- `fingerAction`: 'auto'|'draw'|'pan'|'select'|'none'. 'auto' pans once a Pencil has been seen (`input.js:945-949`).
- Gesture toggles: `twoFingerUndo: true`, `threeFingerRedo: true`, `tapHoldSelect: false`, `holdTime: 500` (ms).
- `pressure: 1.0`: an exponent; below 1 is softer.
- `allowRotate: true`, `hoverCursor: true`, `highlightSelection: true`, `showPalette: true`.
- `activeSlot: 0`. `slots`: an array of 8 (canvas) or 9 (notebook) entries `{b, color, size, opacity, smoothing, font?}`.
- `recentColors: []` (max 14). `palettes: [{name, colors[≤8]}]`. `activePalette: 0`.
- `sort`: 'updated'|'created'|'name'. `seenWelcome`.
- `majors`: null until onboarding, then an array of major ids.
- `subjects: [{id, name, color}]` (the courses).
- `documents: [DocMeta]`. `visuals: [{id, name, subject, thumb, added}]`.
- `aiKey: ''`, `aiModel: 'claude-opus-5-5'`.
- `panelW` (study panel width, px). `galleryFilter: 'home'`. `darkCanvas: true`. `penSeen: false`.

**Keys added in other files:**
- Boot migrations: `calmDefaults`, `slimBar`, `homeSeen` (`app.js:181-187`).
- `toolsets: {canvas|notebook: {slots, active, prev}}` and `prevSlot` (`brushes.js:54-68`).
- `zoomLock`, `rotLock` (`ui-panels.js:74`).
- `pencilTap`: 'system'|'switchEraser'|'switchPrevious'|'showColorPalette'|'undo'|'toggleUI'. `pencilSqueeze`: 'brush'|'palette'|'undo'|'eraser' (`ui-panels.js:811-812`).
- `orientationLock`, `keepAwake`.
- Notebook preferences: `autoDeselectEraser`, `nbShapes`, `nbSide`, `nbSideFilter` ('all'|'bm'), `lastNotebook: {tpl, color, size, orient, scroll}`.
- Study timer: `studyFocus`, `studyBreak`, `studyRounds`.
- `aiMode`: 'app'|'key'|null (`ai.js:216,445`).
- `graphKind` (Desmos).
- Reader: `readerTheme` ('paper'|'sepia'|'night'), `readerFit` ('width'|'page'), `readerTutor`, `readerRail`, `readerTutorW`, `readerSmooth`, `epubFont` (0.7–2).
- `pencilKit`: setting it to false disables PencilKit.
- Library: `booksFilter` ('all'|'book'|'sheet'|'done'), `folders: [{id, section: 'notebooks'|'canvases'|'books', name, created}]`, `openFolder` (`ui-gallery.js:147-153`).
- `trash: [{id, name, kind, deleted, thumb}]`.
- Reading goal: `readStart`, `readLog: {'YYYY-MM-DD': minutes}` (pruned after 60 days), `readGoal` (default 15) (`app.js:27-35`).
- `session: {t: 'doc'|'read', id, at}` for low-memory recovery (`app.js:229-243`). `lowMem` (timestamp).
- `exams: [Exam]`.

**DocMeta** (books, PDFs, EPUBs and photos in `S.documents`; `study.js:69,89,97-100`, `reader.js:894,1119,1274-1276`):
`{ id, name, type: 'pdf'|'epub'|'image', kind: 'book'|'sheet'|undefined, mime, subject, size, added, lastPage: 1, cover: jpegDataURL(360w), pages, title?, author?, lastRead?, finished?: timestamp|null, folder?, progress? (epub 0..1), cfi? (epub) }`.
- `kind` is guessed from page count: 30 pages or more means 'book', otherwise 'sheet'.

**Exam** (`examprep.js:66`): `{ id, title, kind: 'exam'|'quiz'|'lab'|'other', course, date (ms), files: [{id, name, type, role: 'syllabus'|'past'|'problems'|'notes', size}], books: [{docId, from, to}], notebooks: [docId], notes, created, built?, notebookId? }`.

### 1.5 File-store ids (`A.store.saveFile`/`loadFile`)
| id | contents | source |
|---|---|---|
| `doc_<docId>` | raw imported PDF / EPUB / image bytes | `study.js:68` |
| `ann_<docId>` | reader annotations JSON (shape below) | `reader.js:11-19` |
| `idx_<docId>` | reader book index JSON | `reader.js:89-91,153` |
| `ver_<docId>` | version snapshots JSON array (max 15) | `notebook.js:652-668` |
| `trash_<docId>` | full document JSON while it is in Recently Deleted | `ui-gallery.js:642-667` |
| `vis_<visId>` | "My visuals": item array centred on the origin | `stamps.js:482-511` |
| `exprep_<examId>` | exam prep data JSON | `examprep.js:17-27` |
| `exf_<fileId>` | raw exam material file (25 MB maximum) | `examprep.js:125-128` |
| `rec_<recId>` | audio: native is AAC .m4a (32 kHz mono); web is a MediaRecorder blob | `AudioBridge.swift:4,32-39`, `notebook.js:467` |
| `ink_<docId>` | PencilKit `PKDrawing.dataRepresentation()` (native only, notebooks and canvases) | `NotebookInkView.swift:127,144,154` |
| `ink_rd_<bookId>` | PencilKit drawing for the reader's Write mode (pkOpen id `'rd_'+id`) | `reader.js:515` |
| `inkbak_<docId>` | JSON `[{b,c,w,o,pts}]` backup of legacy strokes moved into PencilKit | `pkink.js:37` |

- **`ann_` shape:** `{ highlights: [...], chats: [Chat], chatActive, ink: { "<page>": [Stroke] }, scope?: {src, books, web} }`.
  - PDF highlight: `{id, page, rect: [fx0,fy0,fx1,fy1], rects: [[...]]|null, color: 'yellow'|'green'|'blue'|'pink', text, created}`. Rects are page-relative fractions (`reader.js:772`).
  - EPUB highlight: `{id, cfi, color, text, created}` (`reader.js:1140`).
  - Reader ink stroke: `{id, c: hex, w: fraction of page width, o?, pts: [fx, fy, pressure0..1, ...]}` (`reader.js:647,554`).
- **`idx_` shape** (`IDX_V = 5`): `{v, id, pages, done, labels: [pageLabel]|null, body: median font size, raw: [], heads: [{page, level, title, norm, gist}], results: [{page, kind, num, name, text}], scans: [pageNo], tops: {n: firstLine}, running: [...]}` (`reader.js:90`).
- **`ver_` entry:** `{t, label: ''|'Opened'|'Before restore', pages, thumb: jpeg 180×240 q0.6, data: JSON.stringify({layers, pages, page, artboards, paper, recordings})}`. Identical consecutive snapshots are skipped. Snapshots over 25 MB are skipped (`notebook.js:656-668`).
- **`exprep_` shape:** `{summary, format, topics, questions, gaps, plan, builtAt, guides: {topicId: {blocks: [{md, deeper?: [{q, md, at}]}], at}}, answers: {qid: {hint?, solution?}}, practice: [{id, kind: 'set'|'mock', title, minutes, problems: [{text, topics, solution}], at}], done: {"YYYY-MM-DD:i": timestamp}}` (`examprep.js:21,274,407,446,488,560`).
- **Chat** (`ai.js:206,550`): `{id, title, created, msgs: [...]}`.
  - User message: `{role:'user', text, att: [{id, kind: 'image'|'text'|'pdf', label, url, page, rect, text, cfi}], ctx?, t}`. Image URLs are shrunk to 900 px after sending (`ai.js:620`).
  - Assistant message: `{role:'assistant', text, t, error?}`.
- **Project export `.axiom`:** the document JSON merged with `{format:'axiom', version:1}` (`ui-panels.js:704`, `ui-gallery.js:494`). Import accepts any JSON with a `layers` array, assigns a new id and normalises it (`ui-gallery.js:686-698`).

---

## 2. Features, screen by screen

### 2.1 Boot (`app.js`)
- **First launch** with no documents opens a sample canvas, "Welcome · unit circle and sine", on graph paper (40/5) with three layers (`app.js:101-149,211-218`).
- Otherwise the gallery opens and `resumeAfterRecovery` runs: `?recover=1` reopens the session if it is less than 12 h old (`app.js:233-243`).
- The trash is purged at boot (entries older than 30 days).
- **Paste:** pasting an image imports it; pasting with a stroke clip pastes strokes.
- **Drop:** dropping a `.axiom` file imports it; dropping a PDF or image imports it into the open document (`app.js:194-209`).

### 2.2 Home / library (`ui-gallery.js`)
- **Sidebar** (`:236-255`): wordmark "Axiom.", then Home, Books (count), Notebooks (count), Canvases (count), and Favorites (only if any exist).
  - A "Courses" header with a + button, then each course with a colour dot, a count, and a ••• menu: Rename, a row of 10 colours, Remove course (`:432-446`).
  - "Add your courses" when there are none; "Unfiled" (count); Settings; version string.
- **Home** (`:292-327`):
  - Hero: today's date, then a greeting by hour (<5 "Working late", <12 "Good morning", <18 "Good afternoon", otherwise "Good evening"), then "Pick up where you left off."
  - **New** menu (`:262-276`): Notebook "Pages to write on", Canvas "Infinite space to think", Book or PDF "Read with the tutor", Exam prep "A plan, topics and practice for a test", then Import Axiom file.
  - Sections in order: "Preparing for" (exam cards, `examprep.js:38-60`); Continue (last book, last notebook, last canvas); Notebooks (5 most recent, or an empty state); Canvases (4); Books shelf (8); Courses grid (tiles showing "N notebooks · N canvases · N books").
- **Books page** (`:329-361`):
  - Daily reading goal ring: minutes today versus `readGoal`; tap to edit.
  - Add button; search over name and author; segmented filter All / Books / Problem sets / Finished.
  - A "Reading" hero plus "Also reading" (up to 3 more); folder row; grid of book cards with a progress bar.
- **Notebooks / Canvases / Favorites / Unfiled / course pages** (`:363-414`):
  - Header with a course dot; New (or the New menu); search; Sort (Last edited / Date created / Name).
  - Folder tiles plus a breadcrumb with folder Rename and Delete (Delete moves the contents out) (`:176-201`).
  - Grid with a "New notebook / New canvas" card when the list is empty.
  - Course pages also show an exam section, separate Notebooks and Canvases sections, and "Books for <course>".
- **Card** (`:448-463`): paper-coloured thumbnail, favourite badge, "N pages" badge, mic badge, name, "Course · date".
  - Long-press (600 ms, cancelled by 8 px of movement or by scrolling; `:204-217`) or ••• opens the card menu: Open, Move to folder…, Add/Remove favourites, Course: X (picker), Rename (80-character maximum), Duplicate, Export project file, Delete. Delete moves the document to Recently Deleted for 30 days (`:465-502`).
- **Book menu** (`:547-560`): Read, Solve beside it…, Move to folder…, Course:, Mark as finished/unfinished, Show under Problem sets / Books, Rename, Delete. Delete removes `doc_` and `ann_` (`idx_` is left behind).
- **New canvas sheet** (`:26-67`):
  - Name ("Untitled canvas").
  - Course chips plus "+ Course".
  - Grid templates (`:9-16`): blank (none), dot 24, graph 40/5, lined 32/1, iso 32, eng (graph 50/10, bg `#eef5ec`).
  - Background: the 6 canvas papers.
  - Artboard: None / A4 / Letter / 16:9, with Portrait / Landscape.
- **New notebook sheet** (`:81-126`):
  - Name, Course, Page size (A4 / Letter / A5), orientation.
  - Paper: common templates (blank, lined, grid, dot, graph, cornell) plus "More papers" for all 14.
  - Paper colour: `#ffffff, #fbf8ef, #f4efe1, #eef3f8, #f0f4ec, #fdf1f1, #2a2e36, #15171c`.
  - The choice is remembered in `S.lastNotebook`.
- **Solve beside** (`:580-614`): a modal titled "Solve beside page N". It offers New notebook / New canvas plus up to 6 recent documents (same course first). It sets `ST.pendingDoc = {id, page}`, so the book docks in the study panel. An optional problem image is placed via `NB.placeReference` or `placeImage`.
- **Onboarding**, "What do you study?" (`subjects.js:39-73`), appears on the first gallery render while `majors == null`. It has major chips, your courses (removable), an add-course field, and suggestion chips. Majors and their suggested courses are at `subjects.js:8-16`. Course colours (10) are at `subjects.js:17`.

### 2.3 Notebook (`notebook.js`, plus the canvas machinery)
- **Top left** (`:73-77`): Back, then the title button (rename) with a subtitle "Course · A4".
- **Top right** (`:79-87`): Undo, Redo | Mic (record/stop), Learn (spark), Pages, More.
- **Tool rail** (`:133-158`): slots 0–6 with a colour dot. Laser or tape are added while active. A ruler button shows when the ruler is on. Then a separator and +.
  - Tapping the active tool opens its fly-out (`:167-197`).
  - Pen family fly-out: types Pen, Fountain, Pencil, Fine liner, Brush pen, Dotted. Switching type resets opacity and smoothing to the catalog values.
  - Per-family palettes (`:14-20`):
    - pen `#16181d #1f4fbf #c0392b #1e8449 #7d3cff #e67e22`
    - highlighter `#ffd84d #ff7eb6 #9cf26a #7ec8ff #5ef0e0 #ffb15c`
    - tape `#f7c6d0 #bfe6e0 #ffd9b8 #d9ccf5 #eef0f3`
    - laser `#ff3b30 #2f7bff #26c281 #ffcc00`
    - text: same as pen minus orange
    - Each palette ends with + (full colour picker).
  - Three sizes per family (`:21-23`): pen 1.4/2.5/4.2, highlighter 12/18/28, eraser 8/16/34, tape 14/22/34, laser 4/6/10, text 15/20/28.
  - Eraser: Partial (slice) / Whole stroke (eraser). Select: Freehand (lasso) / Tap items (picker). Tape: Cover all / Reveal all. Text: Sans / Serif / Mono / Round.
- **Notebook slot defaults** (`brushes.js:46-51`): pen `#16181d`, pen `#1f4fbf`, fountain `#c0392b`, highlighter `#ffd84d` size 18, eraser, text `#16181d`, select, laser `#ff3b30`, tape `#f7c6d0`.
- **+ Insert menu** (`:224-239`): Photo or image, Camera, Sticky note (220 wide, bg `#fff1a8`, fs 18), PDF pages, New page (copies the current template), Diagram (visual tools), Book page beside…, Desmos calculator | Laser pointer, Tape, Ruler / Put ruler away.
- **Learn menu** (`:240-254`), heading "Learn from this notebook":
  - "Chat with your notes" attaches all written pages without sending.
  - "Smart notes": *"Turn my handwritten notes into clean, well-structured smart notes: headings, key definitions, theorems and formulas in LaTeX, and worked examples. Point out anything that looks wrong or incomplete."*
  - "Practice questions" (mode quiz): *"Make 6 multiple-choice practice questions from my notes, from easier to harder, with explanations."*
  - "Flashcards": *"Make 12 flashcards from my notes (definitions, theorems, formulas, key facts)."*
  - "Check this page" (mode check, current page only): *"Check my work on this page. Point out mistakes precisely and say what is correct."*
  - Page images: up to 12 written pages, nearest to the current page first; each 1400 px maximum, JPEG 0.86 (`ai.js:184-196,139-143`).
- **More menu** (`:255-266`): Export, Paper and page size, Study session, Version history | Favourite / Unfavourite, Finger draws / Finger scrolls toggle, Settings.
- **Paper and page dialog** (`:317-361`): scope "All pages" / "Page N only"; template grid (14); paper colour (8); size A4 / Letter / A5 / A3; Portrait / Landscape; Scroll (vertical) / Pages (horizontal).
- **Page counter** (`:92-96,116-129`): up, "cur / N" (tap for a Go to page dialog), down.
- **Pages sidebar** (`:363-427`): All pages / Bookmarked segment; thumbnails 116 px wide, each with a bookmark ribbon and a ••• page menu; "Add page".
  - Page menu: Insert page before, Insert page after, Duplicate page, Move up, Move down, Bookmark, Change paper…, Export page as image | Clear page, Delete page.
  - When the sidebar is open and the screen is wider than 700, the page shifts right by 210.
- **View rules** (`render.js:78-130`):
  - Fit zoom (vertical scrolling) is `min((free − (free>900 ? 190 : 120)) / pw, 1.8)`. Horizontal is `min((h−130)/ph, (free−170)/pw)`.
  - Zoom is clamped to fit×0.3 … fit×6. There is no rotation.
  - The page is centred, with top chrome 70 and bottom 90.
  - A double finger tap refits (`notebook.js:55-60`). The page refits on resize (`:45-52`).
- **Audio** (`:430-598`):
  - Recording names are "Recording n". Strokes and text boxes written while recording or playing are stamped `{rid, at}`.
  - The bottom bar has play/pause, scrub, "t / dur", a rate chip (0.75, 1, 1.25, 1.5, 2), and a name button.
  - Recordings menu: a list (duration · date), "Replay ink: on/off", "Back 10 seconds", Rename this recording, Delete this recording, New recording.
  - Ink replay dims strokes with `at > t` to alpha 0.12 (`render.js:435`). During playback, tapping a stroke seeks to `at − 1.5 s`.
  - A red recording pill with a timer and Stop shows while recording.
- **Study session timer** (`:600-648`): focus 15/25/45/60/90 min, break 5/10/15, sessions 1–4 (defaults 25/5/2). A floating pill shows "Focus r/R" or "Break", mm:ss, pause, and end. Toasts announce each phase.
- **Version history** (`:650-699`): a snapshot 1.5 s after opening ("Opened") and one every 10 minutes while editing. The dialog grid shows thumbnail, date and "N pages · label". Restore first saves "Before restore" and is undoable.
- **placeReference** (`:703-723`) puts a book page or problem at the top of the next free page with a 14 mm margin (45% of page height, or full height), on the locked "Imported pages" layer.
- **Photo-as-page** (`photoPage`, `:286-305`) is defined but not wired to any menu.

### 2.4 Canvas (`ui-panels.js`, `ui-tools.js`, `ui-layers.js`, `guides.js`, `stamps.js`, `input.js`)
- **Status bar** (`ui-panels.js:9-50`):
  - Left: Back, name (rename) | Precision (P), Layers (L), Visual tools.
  - Centre readout: zoom %, rotation ° (if not 0), padlocks. It opens the Measurement popover (`:63-98`): zoom field plus lock, chips 10/100/350/1600%; rotation field plus lock, chips 0/90/180/270; Fit drawing to screen, Zoom to selection, "Show <artboard>", Add artboard…. In notebooks it shows "Fit page width".
  - Right: Study panel, Export, More (Import, Desmos calculator, Add artboard, Hide interface | Settings, Help and gestures).
- **Tool bar** (`ui-tools.js:199-237`):
  - Grip: drag to move; double-tap switches to the wheel. Snaps to a side.
  - 8 slots, each with a colour dot. Tap selects; tapping the active slot or long-pressing (450 ms) opens the brush menu.
  - Properties dot, sized by brush size, opens a popover with Size (log scale), Opacity and Smoothing.
  - Colour button, an optional 4-colour palette strip, Undo and Redo.
- **Tool wheel** (`:323-390`): 300 px. Ring of 8 slots (radius 68–122). Three property segments Size / Opac / Smth (radius 36–64); dragging them adjusts the value (size `v0*exp(d*0.018)`, others `v0 + d*0.005`, with `d = −dy + 0.4dx`). Centre is the colour, with undo/redo at the corners. Dropping it on an edge turns it into the bar.
- **Slider popover presets** (`:117-119`): size `[0.5, 1, 2, 4] × catalog size`, opacity 25/50/75/100%, smoothing 0/25/50/100%.
- **Brush menu** (`:138-195`): title "Slot N · Brushes", a preview canvas, and groups. Draw: pencil, pen, brushpen, fineliner, wire, dotted, marker, highlighter, airbrush, fill. Erase: slice, eraser, mask, softmask. Edit: select, nudge. Choosing a brush keeps the colour and resets size, opacity and smoothing.
- **Canvas default slots** (`brushes.js:35-44`): pencil `#3a3f4b`, pen `#16181d`, fineliner `#1f4fbf`, marker `#f2c94c`, brushpen `#c0392b`, fill `#7fb3d5`, slice, select. Notebooks and canvases keep separate tool sets (`brushes.js:57-69`).
- **Colour picker** (`ui-color.js`):
  - Header: old/new compare swatches, hex field, eyedropper.
  - Swatches: 12 hues (355, 14, 30, 45, 58, 88, 140, 172, 198, 218, 255, 300) × 6 (lightness, saturation) rows `[.9,.62] [.79,.68] [.66,.7] [.53,.68] [.41,.62] [.29,.55]`, then 12 greys, 12 cool greys (hue 215, sat .14) and 12 warm greys (hue 32).
  - HSB wheel and RGB/HSL sliders.
  - Recents (14). Palettes: defaults Ink / Lecture / Soft (`:20-26`), maximum 8 colours, long-press removes a colour, the active palette shows on the toolbar, "New palette".
- **Layers panel** (`ui-layers.js`):
  - Header: "Layers", auto-layers toggle, + new layer.
  - Rows, top-most first: 112×84 thumbnail, name, "N items · opacity%", unlock button (if locked), eye.
  - Tap activates; double-tap toggles focus (others fade to 0.22); tapping the active row opens options; long-press (380 ms) then drag reorders.
  - Options: Select all on layer, Rename, Opacity slider, Lock / Unlock, Focus / Exit focus, Duplicate, Merge down | Clear layer, Delete layer.
  - A grid row with a hide button sits at the bottom.
- **Precision panel** (`ui-panels.js:163-218`):
  - Grid: type Dot / Graph / Lined / Iso / Triangle; Spacing slider 6–120; Divisions −/+ 1–10 (graph and lined); Opacity 10–100.
  - Snap: "Snap to grid" or "Align to grid", plus a "Connect to stroke ends" toggle (14/zoom tolerance against the active layer's stroke ends; `input.js:280-292`).
  - Measure: units px/pt/mm/cm/in and a drawing scale field "1 : x". `A.fmtLen` multiplies by `UNITS[u]*scale`, giving 0, 1 or 2 decimals for ≥100, ≥10, otherwise (`guides.js:9-21`).
  - Shape guide: Line / Ellipse / Rectangle / Angle, plus Re-center. Double-tapping the centre handle toggles limit / circle / square / right angle (`guides.js:121-132`). Angles snap to 15° within 3°. Drawing projects onto the guide.
  - "Draw & hold for shapes".
- **Visual tools library** (`stamps.js`):
  - Popover "Visual tools": search, tabs "My visuals" plus areas ordered by the user's majors (`:396-406`), tile grid.
  - About 70 stamps across math, topo, optics, mech, circuits, waves, chem and cs (`:100-389`).
  - Inserted stamps become editable `fineliner` strokes (dashes 7/5) and `fill` strokes. Colour is the current slot's colour, otherwise `#1a1e26`. Scale is `min(w,h)·0.0016/zoom` (`:428-462`).
  - "Save as a visual" stores the selection as `vis_`. A tile long-press deletes it.
- **Artboards:**
  - Add menu: A4, US Letter, A3, A5, Square, 16:9 slide × Portrait/Landscape, plus "Screen size" (`ui-panels.js:114-124`).
  - The label above each frame reads "Artboard · name · w × h cm". Dragging the label moves the artboard; tapping it opens options: Rename, Swap orientation, size chips, Zoom to artboard, Export this artboard, Delete artboard (`input.js:727-763`, `ui-panels.js:99-113`).
  - Rendering: fill with the paper colour, shadow, 1-hairline border (`render.js:372-388`).
- **Camera:**
  - Zoom range 0.02–64 (`render.js:8`).
  - A two-finger twist unlocks rotation after 0.18 rad, and rotation snaps to multiples of 90° within 4° (`input.js:615-618`). Respects `zoomLock` and `rotLock`.
  - Momentum glide: decay 0.9945 per ms, maximum 4.5 px/ms (`input.js:787-818`). Wheel and trackpad supported.
- **Gestures** (`input.js:945-1102`):
  - Pencil draws.
  - One finger, depending on `fingerAction`: pan; hold 500 ms then move to lasso; hold and lift for a context menu; tap a tape strip to toggle it; with the select tool, a tap selects.
  - Two fingers: pinch, pan, rotate. Inside a selection they move, scale and rotate it.
  - Two-finger tap = undo, three-finger tap = redo (<320 ms, <14 px movement).
  - A Pencil touch within 14 px of the tool bar is ignored.
- **Keyboard** (`input.js:1234-1260`): ⌘Z / ⇧⌘Z / ⌘Y, ⌘A, ⌘C, ⌘X, ⌘D, ⌘E (export); Delete; Esc; Space+drag pans; 1–8 pick slots; [ and ] scale size by ×1.15; 0 resets view; F fits; G grid; H hide UI; L layers; P precision; + and − zoom (×1.25 / ×0.8).
- **Export / share:** see §2.8.

### 2.5 Shared editing
- **Lasso** (`input.js:440-502`):
  - "picker" mode, or a tap under 8 px, toggles the hit item.
  - A lasso selects images when all 4 corners are inside (any corner if "partial") and strokes when at least 85% of up to 40 sampled points are inside (any point if partial).
  - If everything found is already selected, it is deselected; otherwise it is added.
  - Options: "Select strokes the lasso only touches" (`selPartial`), "Active layer only" (`selLayerOnly`) (`ui-panels.js:240-248`).
- **Selection box:** corner handles (24 px hit); a rotation knob 30 px above (or below if under the toolbar), snapping to 15° within 2.5°.
  - Scale modes: `scale` (uniform about the opposite corner), `stretch` (non-uniform, stroke width kept), `off` (`input.js:513-578`).
- **Selection popup** (`ui-panels.js:268-295`): Duplicate, Copy, Delete, Ask the tutor about this, Crop picture (single unlocked image only), then More: Flip horizontally, Flip vertically, Apply current colour, Bring to front, Send to back, Move to layer… (canvas only) | "Resize: scale with strokes / stretch, keep stroke width / scaling locked" (cycles), Rotation handle on/off | Save as a visual, Select all.
- **Bottom selection menu** (select tool active, nothing selected): Lasso / Tap items, plus an options menu (`:228-248`).
- **Long-press menu** (`:409-435`):
  - Inside a selection: Copy, Cut, Duplicate, Paste here | Delete.
  - On an item: selects it.
  - Elsewhere: Paste, Paste image (system pasteboard), Select all, Select with the Pencil | Insert image here, Insert PDF.
- **Commands:** paste offsets by 24/zoom when the clip is on screen, otherwise centres it; duplicate offsets by 20/zoom (`:320-385`).
- **Crop** (`crop.js`): 8 handles, minimum 8 units, Cancel / Reset / Crop. Requires the picture to be at 0° rotation.
- **Text boxes** (`textedit.js`, `input.js:637-657`):
  - The text tool taps to create, taps an existing box to edit, and drags to set the width.
  - Default width is clamp(40% of view, 220–420). In notebooks the box is clamped to the page.
  - Format bar: font cycle (Sans/Serif/Mono/Round), −, size, + (×1.15, 8–160), B, colour dot (text colours `#16181d #1f4fbf #c0392b #1e8449 #7d3cff #e67e22`; sticky papers `#fff1a8 #ffd6e0 #cdeffd #d7f5d0 #e8dcff`), delete, Done.
  - Empty text deletes the box.
  - Layout (`brushes.js:212-268`): line height fs×1.36; pad = bg ? max(10, fs×0.6) : 2; baseline at pad + i·lh + fs×1.02; sticky background has radius 6 and shadow rgba(0,0,0,.18) blur 10 y 3; text on a sticky is `#2a2620`.
  - Fonts: `-apple-system/SF Pro Text`, `Iowan Old Style/New York/Georgia`, `ui-monospace/SF Mono`, `SF Pro Rounded`.
- **Eraser:** "slice" cuts strokes along the path; "eraser" removes whole strokes. The radius is max(1.2/zoom for slice or 3/zoom for eraser, size/2) (`input.js:338-398`).
- **Nudge:** radius = size in screen px, falloff (1 − d/R)² (`input.js:401-437`).
- **Laser:** a fading trail (1.4 s), only the last 1.5 s bright, glow lines 9 px at α 0.35 in the colour plus 3.2 px white. Nothing is saved (`input.js:659-697`).
- **Tape:** a butt-cap opaque band. A finger tap toggles `rv`; revealed tape draws at alpha ×0.16.
- **Undo:** document snapshots. With PencilKit, one interleaved order `PK.order` of `'ink'|'doc'` entries is kept (`pkink.js:210-224`).
- **Eyedropper** samples a stroke's colour, or the pixel under it, with a loupe (`input.js:921-942`).

### 2.6 Reader (`reader.js`)
- **Top bar** (`:1212-1221`): Back and the title (cleaned of z-lib/libgen suffixes, `:917-919`) with a subtitle (author or course).
  - Centre: a tool segment Read / Highlight / Write, plus the ink bar while writing. The ink bar has black `#1b1d22`, blue `#1f4fbf`, red `#c43c35`, green `#1e8449`; widths Fine 0.0018, Medium 0.0026, Bold 0.0042 (fractions of page width); Eraser; Undo; and a "Smooth strokes" option on the web.
  - Right: Search (PDF only), Rail toggle, Aa (appearance), Tutor.
- **Bottom bar:** page label ("Page n" or "p. <label>"), "n of N", scrub slider.
- **Interaction:**
  - A Pencil (or mouse) drag draws a box, or a lasso when the loop closes (`:706-716`).
  - Read mode shows the Ask bar. Highlight mode adds a highlight directly. Write mode draws ink: PencilKit on iPad (pages 1000 units wide, gap 24; `:486-559`), otherwise vector strokes with an eraser and undo.
  - A finger tap toggles the chrome. Scrolling down hides the chrome.
  - Pinch zooms 0.5–4. Keys: arrows / PageUp / PageDown / Esc.
- **Ask bar** (`:725-754`): "Ask about this selection" with Highlight / Copy text / Close icons, an "Ask about this…" field with send, and chips. Prompts (`:776-789`):
  - Explain: "Explain this passage rigorously, step by step." (mode explain)
  - Fill in steps: "Fill in the details of this argument: justify every step that the book skips." (explain)
  - Hint: "Give me a hint for this. Not the solution." (hint)
  - Solve beside: opens the solve-beside sheet with the region image.
  - The attachment is `{kind:'image', label:'<section> · p. <printed>', url (region JPEG 1500 px, with ink), page, rect, text}`.
- **Highlight menu** (`:408-418`): colours yellow / green / blue / pink, Ask the tutor about this, Copy text, Remove highlight. Overlay colours: yellow rgba(255,210,0,.36), green rgba(70,205,110,.30), blue rgba(70,150,255,.28), pink rgba(255,90,160,.26). Night theme values are at `reader.js:562`.
- **Rail tabs** (`:923-991`):
  - Pages: thumbnails 220 px.
  - Contents: the PDF outline, or "Chapters found by reading the book" from the index, plus the index status "Reading the book for the tutor… n of N pages" or "The tutor has read all N pages · K definitions and results".
  - Highlights: sorted by page.
  - EPUBs have only Contents and Highlights.
- **Search** (`:994-1025`): Enter runs it (2 characters minimum); up to 60+ hits with snippets; tapping a hit flashes the line.
- **Display menu** (`:1187-1204`): Zoom −/+ (×1.2, 0.5–3), or for EPUB Text size (±0.1, 0.7–2); Fit width / Fit page; Page colour Paper / Sepia / Night; "Solve in a notebook beside".
- **EPUB** (`:1049-1152`): epub.js, paginated with spread auto. Themes paper `#1b1d22` on `#ffffff`, sepia `#3b3021` on `#f4ecd8`, night `#d9dce2` on `#16171a`. Font Iowan Old Style, line height 1.6, size `epubFont×108%`. Swipe or arrows turn pages. Selection actions: Ask, Explain, Hint, Highlight, Copy. Progress comes from 1400-character locations.
- **Text model** (`:23-55`): pdf.js text items are grouped into lines `{id (1-based), text, fs, r: [fx0,fy0,fx1,fy1]}`. Citations `[[p12:L3-L5]]` highlight those lines (`:847-865`).
- **Book index** (`:58-152`): every page is scanned once for headings (font-size heuristics plus chapter/section regexes), results (Definition, Theorem, Lemma, …), prose definitions ("is called" and similar), named laws, and numbered equations. Running headers are removed. Results are cached in `idx_`.
- **Tutor context per message** (`readerCtx.contextText`, `:808-846`):
  - `[Book: "title" by author, N PDF pages. Location: trail. The student is on PDF page n (printed page p).]`
  - `RD.coveredSoFar` (22 000 characters; 9 000 in app mode): outline so far, earlier and current-chapter results, results referenced by number, terms, and the current section's text.
  - The end of the previous page when the selection starts in the top 30%.
  - `p. n (text lines):` with `L<id>: text` (7 000 characters or 140 lines maximum).
  - "The selected region on p. n covers lines La–Lb."
- **Reading time** is accumulated into `readLog` (`app.js:27-35`). `lastPage`, `lastRead`, `progress` and `cfi` are persisted.

### 2.7 Study panel (`study.js`)
- **Docked split panel**: width `panelW`, defaulting to 42% of the window, clamped to 300–70%, with a resize grip.
- **Tabs:** Tutor (always), Desmos (closable), one per document (closable), and + (Desmos calculator, Import PDF or photo…, up to 30 library documents, same course first).
- **Desmos:** an iframe at `https://www.desmos.com/<kind>`, kinds calculator "Graph", geometry, 3d, scientific.
  - "Ask the tutor about this graph" and "Insert" take a native `snapshot` of the iframe rect, auto-trim Desmos' title bar (`:195-213`), and place the image at half size (70% of page width in notebooks).
- **DocView** for PDFs and photos:
  - Page nav and count (with page labels), "Ask the tutor about this page" (1.6× render), pinch 0.5–4.
  - More: "Put this page in the notebook / on the canvas", "Import all pages to annotate", "Give the whole document to the tutor" (≤30 MB, sent as a PDF document block), Course:, Rename.
- **Import:** `ST.importFile` accepts PDF, EPUB or image and saves `doc_`. The cover is page 1 rendered 360 px wide, or the EPUB cover (`:61-111`).

### 2.8 Export (`ui-panels.js:588-732`)
- **Formats:** JPG, PNG, Vector (SVG), PDF, Project (.axiom).
- **Regions:**
  - Notebook: All pages, This page, Screenshot (view), Selection.
  - Canvas: Screenshot, Entire drawing (allBB ±24), each artboard, Selection.
- **Options:** Include background (off means a transparent PNG or SVG) and Include grid (canvas, not SVG). Pixels per inch 72 / 150 / 300 (default) / 600, with an "Image size: W × H px · w × h cm" readout.
- **PDF** is written by hand: one JPEG (q 0.9) per page, media box = world units × 0.75 pt. "All pages" skips an empty trailing page.
- **SVG:** per-layer `<g>`; masks become `<mask>`; soft brushes become a Gaussian blur with stdDev w×0.22; multiply blend; text uses `<tspan>`; crops use a nested `<svg viewBox>` (`brushes.js:301-332`).
- **Delivery:**
  - Native: op `share {name, mime, data: base64}` writes a temp file and opens `UIActivityViewController` (`CanvasViewController.swift:429-441`).
  - Web: `navigator.share`, then a download link, then a preview modal (`core.js:214-252`).
  - The page context menu has "Export page as image" (PNG, region page).

### 2.9 Settings (`ui-panels.js:742-854`)
Tabs: Workspace, Interaction, Notebooks, Tutor, Studies, Recently Deleted. The modal opens on Notebooks when a notebook is open, otherwise Workspace.
- **Workspace:**
  - Theme: System / Light / Dark.
  - "Dark paper in dark mode" (`darkCanvas`).
  - Tool setup (canvases): Interface (Tool Wheel / Tool Bar), Handedness (Left / Right), "Palette under the tools".
  - "This canvas" (canvas open only): Background (6 papers), Grid type (No grid / Dot / Graph / Lined / Isometric / Triangle), Artboards (list plus Add).
  - Measurements: Drawing scale (1:1, 1:2, 1:4, 1:5, 1:8, 1:10, 1:12) and Units.
- **Interaction:**
  - Finger action: Do nothing / Pan / Draw / Select / Auto.
  - Two fingers: canvas rotation. Two fingers: canvas zoom.
  - Tap and hold to select. Highlight selection.
  - Draw & hold activation time: 250–1200 ms.
  - Two-finger tap = Undo. Three-finger tap = Redo.
  - Apple Pencil double-tap: System setting / Eraser / Last tool / Colours / Undo / Hide UI.
  - Squeeze (Pencil Pro): Tool menu / Colours / Undo / Eraser.
  - Pressure response: 0.4–2. Hover brush preview.
  - iPad only: Lock screen rotation, Keep iPad awake.
- **Notebooks:**
  - New notebook defaults: Paper (Lined / Grid / Dot grid / Blank / Cornell), Page size, Default view (Seamless / Single pages).
  - "Back to the last tool after erasing". "Draw with finger". "Shape recognition in notebooks".
- **Tutor:** How the tutor answers (My AI app / API key), Anthropic API key (Remove key), Default model.
- **Studies:** Majors and courses (Edit), "Course of this notebook/canvas".
- **Recently Deleted:** each item shows "Notebook · deleted … · N days left" with Restore; "Delete all now".
- **Help** modal (`:856-892`): gestures, books and keyboard reference.

### 2.10 Subjects / courses (`subjects.js`)
- `SU.add` caps names at 48 characters, de-duplicates case-insensitively, and assigns colours in rotation.
- The compact course picker (`SU.pickMenu`) offers "No course", the courses, and "+ New course".

### 2.11 Exam prep (`examprep.js`)
- **Edit sheet** (`:64-118`):
  - Kind segment: Exam / Quiz / Lab / Other. "What is it" placeholder varies by kind.
  - Course select (with "New course…"), Date, and Time (default: 7 days ahead at 09:30).
  - Materials list plus "Add material" (`:119-139`): Syllabus ("Or the topic list"), Past exam, Problem set, Notes or slides (a PDF or image picker, 25 MB maximum), Chapters from a book (PDF books only; From / To page, at most 80 pages), One of your notebooks.
  - "Anything else" notes.
  - Buttons: Cancel / "Build my prep" (new) or "Save and rebuild" / Save.
- **Prep view** (`:281-585`): full-screen. The bar has back (pops the topic stack), title with "course · kind · date time", a days-left label ("Today", "Tomorrow", "In N days", "Done"), and More: Edit details and materials, Re-plan from today, Delete this prep. Delete removes `exf_` and `exprep_`.
  - Tabs: Plan, Topics, Past questions, Practice.
  - **Start / building screens:** a spinner with status lines such as "Writing your plan… Nk characters".
  - **Plan:** summary markdown, Format, progress bar, a "N sessions from earlier days not done" banner with "Re-plan from today". Each day is labelled "Today" or with the date and lists sessions: check (`done[key] = timestamp`), kind badge, minutes, task markdown, and topic chips that open the guide.
  - **Topics:** title, weight badge, "N past Q", "Guide", why, sources; then a gaps section "Never asked in past exams, still to know".
  - **Guide** (per topic): generated once. Blocks are split on headings and blank lines, ignoring `$$` and code blocks. Tapping a block opens "What is unclear about this part?", and the answer is stored under the block as "Deeper: q". "Past questions on this" follows.
  - **Question card:** source, difficulty, markdown, topic chips, then Hint, Solution, and "Solve in a notebook". The last renders the PDF page (or image) and inserts it into one practice notebook per exam, "<title> · practice" (`:498-530`).
  - **Past questions:** grouped by the source prefix (`:531-536`).
  - **Practice:** topic chips (top 3 high-weight preselected), "Five problems on these", "Mock exam". Sets show "N problems · M min · date", a "Start M-minute timer" for mocks, and Show/Hide solution.
- **Home and course pages** show "Preparing for" cards with a progress bar and "Today: <task>".

---

## 3. AI / Claude API calls
**Client setup** (`ai.js:9,568-569`): the browser loads `@anthropic-ai/sdk@0.133.0` from jsDelivr ESM and creates `new Anthropic({apiKey: S.aiKey, dangerouslyAllowBrowser: true})`. KaTeX 0.16.11 renders math. The API key must start with `sk-ant-` (`ai.js:445`).

**Models** (`ai.js:12-16`): `claude-opus-5-5` "Opus 5.5" (Most capable, the default), `claude-sonnet-5-5` "Sonnet 5.5", `claude-haiku-5-5` "Haiku 5.5".

**Modes and effort** (`ai.js:17-28`): explain/medium, hint/low, check/high, quiz/medium. The reader hides "check".

| Mode | System text (verbatim) |
|---|---|
| explain | "Mode: EXPLAIN. Explain clearly and rigorously. Give intuition, then the precise definitions and argument. End by checking understanding with one short question when it helps." |
| hint | "Mode: HINT (guided learning). Do not give the full solution or the final answer. Give the smallest useful next hint or a guiding question, and let the student do the work. Reveal more only when the student asks for it." |
| check | "Mode: CHECK MY WORK. Read the student's handwritten work in the attached images and check it step by step against the problem (and the official solution if one is attached). Say which steps are correct. For the first error, quote the line, explain exactly why it is wrong and how to fix it. Do not rewrite the whole solution unless asked." |
| quiz | "Mode: QUIZ. Ask one question at a time about the current material, wait for the student's answer, then give precise feedback and the next question. Increase difficulty gradually." |

### 3.1 Tutor chat (`ai.js:538-624`)
- **Call:** `client.beta.messages.stream({ model, max_tokens: 64000, system: [{type:'text', text: systemPrompt() + webNote}, {type:'text', text: scopeText}?], output_config: {effort}, cache_control: {type:'ephemeral'}, tools?: [{type:'web_search_20260209', name:'web_search', max_uses:5}], betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', messages }, {signal})`.
  - `betas` and `fallbacks` are omitted for Haiku.
  - The call loops up to 4 times while `stop_reason === 'pause_turn'`, appending the assistant content each time.
  - Streaming: `content_block_delta`/`text_delta` events append text. A `server_tool_use` block shows "Searching the web…".
  - End states: `refusal` appends "_The tutor declined to answer this request._"; `max_tokens` appends a cut-off note; an empty answer shows "_No answer was returned. Try again._".
  - Errors are mapped by SDK error class: Auth, PermissionDenied, RateLimit, BadRequest (size hint), InternalServer, Connection (`:607-618`).
- **systemPrompt** (`:488-505`) joins these lines with `\n`:
  1. "You are the tutor built into Axiom, a notebook and reading room for university STEM students. The student writes by hand with Apple Pencil and reads textbooks and problem sets inside the app."
  2. "The student studies: <majors>." / "Their courses: <list>." / "They are working in the course "<cur>" right now."
  3. `ctx.systemExtra()`:
     - notebook: "They are in a notebook called "<name>" with N pages of handwritten notes (page images are attached when relevant)."
     - reader PDF: a long description of the provided context (`reader.js:807`).
     - EPUB: "…quote it briefly in a > blockquote; line citations are not available in EPUBs."
  4. "Attached images are snapshots of their handwritten work, regions they selected in a book or problem set, photos, or whole pages. If handwriting or a scan is ambiguous, say what you read before relying on it."
  5. "When page text with line ids is provided (lines like "L12: …" under a page header "p. 34"), cite the exact places you refer to with markers like [[p34:L12-L14]] or [[p34:L7]] placed right after the claim. The app turns them into links that highlight those lines. Only cite line ids you were given."
  6. "Use precise mathematical language. Do not replace arguments with analogies or metaphors unless the student asks for intuition. Be direct about mistakes and concise; no filler or praise."
  7. "Format with Markdown. Write all mathematics in LaTeX: $...$ inline and $$...$$ for display equations."
  8. The quiz/flashcards block format: ` ```quiz [{"q","options":[],"answer":idx,"explain"}] ``` ` and ` ```flashcards [{"front","back"}] ``` `, with LaTeX backslashes escaped in the JSON strings. These render as interactive cards (`ai.js:109-136`).
  9. `MODE_TEXT[mode]`.
  - Web note when enabled: "You can search the web. Use it when the question needs sources, data, recent results or material beyond the student's books; link the sources you rely on in Markdown."
- **Messages** (`:506-536`):
  - User content blocks in order: images (base64 JPEG; only the last 6 images in the conversation are kept, older ones become `[Earlier image omitted: <label>]`); text passages as `Selected passage:\n"""\n…(6000)\n"""`; PDFs as `{type:'document', source:{base64, application/pdf}, title}`; `m.ctx` (the reader context) as text; and a final text `(Attached: labels)\n\n<text>`.
  - Consecutive messages with the same role are merged. Error messages are skipped.
  - Wider-scope note images are prepended to the last user message only.
- **Scope** (`:222-293`): `src` is one of here, book, notebook, folder, course, pick.
  - Book digests come from `idx_` with a budget of 90 000 characters (single book) or max(14 000, 140 000/n), for up to 12 books.
  - Note pages: up to 16 images, 760 px maximum.
  - The text goes in a second system block that starts "The student asked you to keep this wider context in mind (<label>)…".
- **Auto-attach:** check mode attaches the page or canvas shot if there is no image (`:177`).
- **Attach buttons:** notebook "This page", "Selection"; canvas "Canvas", "Selection", "Current page" (open study doc); reader "This page"; always "Photo" (1600 px).
- **"My Claude or ChatGPT app" handoff** (`:459-485`): no API call is made. The prompt is built from:
  - "I'm a university student[ in <majors>][, working on <course>]. Please answer with precise mathematical language (LaTeX for math), no analogies unless I ask."
  - The mode text.
  - "The attached image(s) is/are from my notes or textbook (labels)."
  - The selected passages (3000 characters).
  - "Context from the page:\n…" (16 000 characters, with L-ids stripped).
  - A blank line, then the question.
  - The prompt is copied to the clipboard and sent via native `shareItems {text, images: [base64]}` (share sheet, up to 10 images). The chat records a canned assistant note. Web search is not offered in app mode.

### 3.2 Exam prep calls (`examprep.js`)
Every call uses the non-beta `c.messages.stream` with the model from `S.aiModel`. They all share STYLE (`:179`): "The student is a university STEM student (mathematics and physics). Use precise mathematical language; give structural reasons (definitions, hypotheses of theorems, why a step is valid), not recipes; no analogies unless asked. Write all mathematics in LaTeX ($...$ inline, $$...$$ display). Markdown formatting."

1. **Build plan** (`:245-277`): `max_tokens: 48000`, `output_config: {effort:'medium', format: {type:'json_schema', schema: SCHEMA}}`.
   - The system prompt (`:257-263`) names the test, its date, today and the days left; adds STYLE; then gives numbered instructions: 1 topics t1, t2… weighted; 2 transcribe EVERY past question with file number and page; 3 gaps; 4 a daily plan from today to the day before, 1–4 sessions of 25–50 min, spaced review, a timed mock the day before, a lab variant, and the list of already completed sessions.
   - The user message contains, for each file, a text block `File i: "name" — Role` followed by a document or image block; then book text (`[p. n]` page texts, 90 000 characters); then notebook images (8 maximum, 900 px); then `Notes from the student: …\n\nBuild the preparation.`
   - The first text block is parsed as JSON.
   - **SCHEMA** (`:220-244`): `{summary, format, topics: [{id, title, weight: high|medium|low, why, sources, subtopics: []}], questions: [{id, source, file: int, page: int, text, topics: [], difficulty: easy|medium|hard}], gaps: [{topic, note}], plan: [{day: 'YYYY-MM-DD', sessions: [{minutes: int, kind: learn|practice|review|mock, topics: [], task}]}]}`. Every property is required and `additionalProperties` is false.
2. **Topic guide** (`:393-406`): `max_tokens 16000`, effort medium, streamed. The system prompt prescribes this format: "## Big picture" (4–7 numbered lines), then "## 1. <title>" parts (main idea, definitions with hypotheses, `$$` formula, bullets, a small example), then "## Quick reference" with a table. The user message gives the topic, what gets asked, subtopics, sources, and up to 8 past questions.
3. **Deeper follow-up** (`:440-443`): `max_tokens 8000`, effort medium. "You answer a follow-up question about one line of a study guide… assume ONLY what appears in the guide above the line… No heading." The user message includes the guide up to that line (last 14 000 characters), the line, and the question.
4. **Hint / Solution** (`:483-485`): `max_tokens 16000`, effort low for a hint and high for a solution.
   - Hint: "Give one hint that unlocks the next step. Do not solve it. Two to four sentences."
   - Solution: "Give a complete, rigorous solution: state what is used (with hypotheses checked), every step justified, and end with what the examiner looks for and common mistakes."
   - User message: `Question (<source>):\n<text>`.
5. **Practice set / mock** (`:556-559`): `max_tokens 24000`, effort medium, json_schema **SET_SCHEMA** `{title, minutes: int, problems: [{text, topics: [], solution}]}`, using `finalMessage()`. System: STYLE plus "You write new practice problems for "<title>". Match the style, length and difficulty of the past questions; never copy them. Every problem gets a complete rigorous solution." The user message asks for a mock with format and topic weights, or "Five problems, from easier to harder.", then lists topics and up to 14 past questions for style (12 000 characters).
- Exam prep requires `aiKey`. Without one, a dialog offers to open Settings (`:170-175`).

---

## 4. Rendering

### 4.1 Canvas grid, infinite canvas (`render.js:157-237`)
- **Colour:** `rgb(40,52,72)` on light paper (luminance ≥ 0.45), white on dark paper.
- **Level of detail:** `while unit·cssScale < 11: unit *= divisions>1 ? divisions : 4`.
- **dot:** squares of radius 1.15 hairline (×1.3 when a unit exceeds 40 px on screen), alpha 0.42·opacity.
- **graph / lined / eng:** minor lines at unit/divisions with alpha 0.09, drawn only when at least 7 px apart; major lines alpha 0.20. Lined draws horizontals only.
- **iso:** line families at 30°, 90° and 150°. **tri:** 0°, 60° and 120°. Spacing unit·√3/2, alpha 0.16.

### 4.2 Notebook page templates (`render.js:241-340`)
MM = 3.7795. Ruled lines are rgba(70,120,200,.30) on light pages and rgba(120,170,255,.22) on dark (luminance < 0.45). Margin lines are rgba(220,70,70,.45) / rgba(255,120,120,.35). Other lines use `gridColor` at the alpha shown. Ruled lines stop 6 mm above the bottom. Grids are centred on the page and double their spacing until at least 7 device px apart. Lines are 1 device px wide (hairline).

| id | name | spec |
|---|---|---|
| blank | Blank | – |
| lined | Lined | 7.1 mm spacing, first line at 22 mm, margin at 25 mm |
| narrow | Narrow ruled | 6 mm, first at 18 mm, margin 20 mm |
| wide | Wide ruled | 8.7 mm, first at 26 mm, margin 30 mm |
| grid | Grid 5 mm | 5 mm, α .16 |
| smallgrid | Grid 4 mm | 4 mm, α .14 |
| graph | Graph (mm) | 1 mm α .07, every 10th line α ×2.4 |
| dot | Dot grid | 5 mm dots, radius 1.25 hairline, α .38, edge rows omitted |
| cornell | Cornell | ruled 7.1 mm from 32 mm, no margin; vertical at 62 mm from y 24 mm to bottom−52 mm, horizontals at 24 mm and bottom−52 mm (α .45, ×1.4) |
| eng | Engineering | fill rgba(210,235,205,.55) (dark: rgba(80,140,90,.10)), 5 mm grid α .13, line at 20 mm from top (α .5) and 20 mm from left (α .35) |
| iso | Isometric | dots on 6 mm triangular lattice, 8 mm inset |
| music | Music staff | 5 lines at 2 mm, blocks every 22 mm from 22 mm, 15 mm side insets, α .4 |
| polar | Polar | 8 rings and 24 rays, radius 0.42·min(W,H), α .16 |
| todo | Checklist | ruled 9 mm from 24 mm, plus 4.2 mm boxes at x 14 mm |

### 4.3 Paper and desk
- **Desk:** `#e4e6eb` light, `#0d0f13` dark.
- **Page shadow:** rgba(20,30,50,.16), blur 18, y 4 (dark: rgba(0,0,0,.5)). Dark pages (luminance < 0.35) get a white 0.10 hairline border (`render.js:341-370`).
- **Dark canvas:** `R.DARK_PAPER = '#1c1f25'` replaces light paper when dark theme and `darkCanvas` are on. Ink adapts (`brushes.js:143-156`): HSL lightness becomes `inv + (sat − inv)·min(1, s·2.5)`, with `inv = 0.06 + (1−l)·0.88` and `sat = max(l, 1−l)·0.86 + 0.07`.
- **On dark paper** the user chose (not dark mode), dark inks are lifted: `l < 0.5 → s < .15 ? 0.86 − 0.3l : 0.66 + (0.5−l)·0.24`. Multiply-blend brushes switch to `screen`.
- **Canvas papers** (`doc.js:7-9`): white `#ffffff`, ivory `#f8f5ec`, mist `#eef1f4`, slate `#2a2e36`, night `#15171c`, blueprint `#123a6b`.

### 4.4 Brush catalog (`brushes.js:8-31`)
Kinds: `var` is a variable-width filled outline, `line` a stroked centreline, `fill` a filled polygon, `tool` non-drawing. Fountain, tape, text, laser and pan exist in the catalog but are not in the canvas brush menu.

| id | name | kind | size | opacity | smooth | min–max | extras |
|---|---|---|---|---|---|---|---|
| pencil | Pencil | var | 3 | .9 | .2 | .5–40 | grain texture, tilt shading |
| pen | Pen | var | 2.5 | 1 | .3 | .3–60 | |
| brushpen | Brush Pen | var | 7 | 1 | .35 | .5–120 | taper 5 |
| fineliner | Fine Liner | line | 2 | 1 | .3 | .2–40 | |
| wire | Wire | line | 1.25 | 1 | .2 | .5–8 | constant screen width |
| dotted | Dotted | line | 2.5 | 1 | .4 | .5–30 | dash [0.001, w·2.4] |
| marker | Marker | line | 14 | .55 | .3 | 2–200 | multiply |
| highlighter | Highlighter | line | 20 | .35 | .5 | 4–200 | multiply, butt cap |
| airbrush | Airbrush | var | 26 | .35 | .3 | 4–400 | soft (shadow blur w·k·.45) |
| fill | Fill | fill | 1 | .85 | .3 | 1–1 | |
| slice | Slice Eraser | tool | 10 | 1 | 0 | 0–200 | |
| eraser | Stroke Eraser | tool | 14 | 1 | 0 | 2–200 | |
| mask | Hard Mask | var | 16 | 1 | .3 | 1–400 | destination-out |
| softmask | Soft Mask | var | 36 | .6 | .3 | 4–400 | mask + soft |
| select | Selection | tool | 1 | | | | |
| nudge | Nudge | tool | 40 | | | 5–400 | |
| fountain | Fountain Pen | var | 3.5 | 1 | .35 | .3–60 | taper 2 |
| tape | Tape | line | 22 | 1 | .6 | 8–120 | butt cap; revealed α×.16 |
| text | Text | tool | 20 | | | 8–120 | |
| laser | Laser Pointer | tool | 6 | | | 2–30 | |
| pan | Pan | tool | 1 | | | | |

- **Pressure mapping** (`brushes.js:73-88`), with `pp = clamp(p, .02, 1)^settings.pressure`:
  - pencil: `(0.45 + 0.55pp)·(tilt > .45 ? 1 + (tilt−.45)·4.5 : 1)`
  - pen: `0.18 + 0.92pp`
  - brushpen: `0.06 + pp^1.25`
  - airbrush: `0.55 + 0.45pp`
  - masks: `0.5 + 0.5pp` with real pressure, otherwise 1
  - all others: 1
  - Without a Pencil, pressure is simulated from velocity: `clamp(1.1 − vel·0.42, .32, 1)`. The multiplier is smoothed with an EMA of 0.55 (pen) or 0.3 (`input.js:182-198`).
- **Point capture and final geometry:**
  - New points must be more than 0.6 screen px apart (`input.js:203-208`).
  - On lift: Taubin smoothing with `round(1 + smoothing·5)` passes (λ .5, μ −.53), endpoints fixed. Smoothing ≥ 0.97 produces a straight line. Smoothing above 0.12 adds one Chaikin pass, then simplify with tolerance 0.1/zoom and m-tolerance 0.025 (`input.js:244-294,767-784`).
  - `var` strokes are rendered as a spline (Catmull–Rom, step max(1.1, w·0.4)) of circles plus tangent quads. Taper length is min(size·taper, length·0.4) with factor √min(a,b)·.92 + .08 (`geom.js:135-177`).
  - `line` strokes use midpoint quadratics (`geom.js:180-193`).
  - Pencil grain: a 96 px noise pattern scaled 0.32, alpha .25 + .75·v^0.7.
- **Shape recognition** (draw and hold): the hold must last max(700, holdTime + 200) ms, the stroke must be at least 70 screen px long, and the bbox diagonal at least 45 px.
  - Kinds: line (chord/length > .94), circle or ellipse (moment fit, error < .16), triangle, rectangle or square, polygon (5–8 corners), arc (3-point circle).
  - Keep holding and move to rotate or scale about the pivot (`input.js:154-181`, `geom.js:317-439`).
- **PencilKit mapping** (native, `pkink.js:188-202`):
  - pen → `.pen`; fountain and brushpen → `.fountainPen`; pencil → `.pencil`; marker and highlighter → `.marker`.
  - Width is size×1.15 (marker and highlighter ×1). Highlighter alpha is min(.5, opacity).
  - eraser → vector eraser; slice → bitmap eraser with width max(4, size); select → the page's own lasso; text, laser and tape → none.
  - `finger: fingerAction === 'draw'`; `ruler: precision.guide && guideType === 'line'`.
  - The mirror stroke format sent back is `{b, c, o, w: maxWidth, pts: [x, y, widthRatio], i}` (`NotebookInkView.swift:760-780`). Canvases are offset by origin 25000 (`:33,118`).

---

## 5. Visual design tokens (`app.css:3-43, 1149-1157`)
| token | light | dark |
|---|---|---|
| --bg | #eef0f3 | #111317 |
| --paper | #ffffff | #1b1e24 |
| --panel | rgba(252,252,253,.86) | rgba(30,33,40,.86) |
| --panel-solid | #fbfbfc | #1f2229 |
| --panel-2 | #f1f3f6 | #272b33 |
| --fg | #1a1e26 | #e8eaee |
| --muted | #687082 | #9aa2b2 |
| --faint | #9aa1af | #6b7282 |
| --line | rgba(24,32,52,.10) | rgba(255,255,255,.09) |
| --line-strong | rgba(24,32,52,.18) | rgba(255,255,255,.16) |
| --accent | #2f6fdb | #6f9bff |
| --accent-soft | rgba(47,111,219,.12) | rgba(111,155,255,.16) |
| --accent-fg | #ffffff | #0d1222 |
| --danger | #d0453f | #ff6b63 |
| --ok | #2f9e6b | #4cc38a |
| --float-bg | rgba(250,250,252,.88) | rgba(30,32,38,.86) |
| --float-line | rgba(20,24,36,.08) | rgba(255,255,255,.08) |
| --label | rgba(26,30,38,.56) | rgba(232,234,238,.58) |

- **Shadows:** `--shadow` 0 1px 2px rgba(16,22,36,.06), 0 8px 28px rgba(16,22,36,.12). `--shadow-lg` 0 2px 6px …(.08), 0 24px 60px …(.2). `--float-shadow` 0 1px 2px (.06), 0 6px 22px (.12).
- **Radii:** `--r` 14, `--r-sm` 10, `--r-xs` 8, `--r-s` 10, `--r-m` 12, `--r-l` 20 (modals). Bars and pills are 16. The tool bar and notebook rail are 18. Toasts are 22. `--tap` is 44.
- **Fonts:** `--ff-ui` "Instrument Sans" (400–700), `--ff-mark` "Instrument Serif" (the wordmark), `--ff-num` "JetBrains Mono". The later pass switches numbers to the UI sans with tabular figures (`:1160`). Body text is 14px/1.4. Section labels are 11 px, weight 650, uppercase, letter-spacing .06em, colour `--label`.
- **Floating chrome:** float-bg with a 0.5 px border and `blur(20px) saturate(1.6)`. Under PencilKit, panels use a solid background instead (`:1548`).
- **Segmented control:** track rgba(120,128,145,.14), radius 10, padding 2. Segments are 30 px tall with radius 8. The selected segment uses panel-solid plus a small shadow (dark mode: rgba(255,255,255,.16)).
- **Modal scrim:** rgba(8,10,14,.42). The settings modal is min(640, 100vh−48) tall.
- **Reader backgrounds:** `--rd-bg` is #e9e6e0 (paper), #e5dccb (sepia), #0e0f12 (night), and #141518 / #17181b in dark mode. Sepia and night use CSS filters on PDF pages (`reader.js:279`; the iPad path reproduces them manually, `reader.js:575-576`).
- **Exam badges:** learn uses accent; practice #2f9e6b; mock and high weight #e5484d; medium weight #b7791f on #d99a22 at 18% (`app.css:1463-1479`).
- **Highlight swatches:** yellow #ffd60a, green #4bd27a, blue #4d9bff, pink #ff5fa8. Easing is cubic-bezier(.2,.8,.2,1).

---

## Notes for the port
- Tool slot 7 is laser and slot 8 is tape in the notebook toolset, but `UI.setSlot` clamps the index to 0–7 (`ui-tools.js:19`). Calling `setSlot(8)` from the + menu therefore selects laser instead of tape. The native app should fix this.
- Deleting a book removes `doc_` and `ann_` but leaves `idx_` and `ink_rd_` behind (`ui-gallery.js:558`).
- Version history exists only for notebooks (`VER.autoSnapshot` is called from `notebook.js:107`).
- `noteInfo` (`notebook.js:267`) and `photoPage` (`:286`) are defined but unused.
- The AI layer uses non-standard request fields that should be checked against the current Messages API before porting: top-level `cache_control`, `output_config.effort` and `.format`, the `server-side-fallback-2026-07-01` beta with `fallbacks:'default'`, and tool type `web_search_20260209`.