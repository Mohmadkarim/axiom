# Axiom: an infinite canvas for scientists and mathematicians

Working name: **Axiom**. You can rename it later; the name lives in one place (`src/index.html` and `manifest.webmanifest`).

---

## 1. Vision

General note-taking apps (Notability, GoodNotes) and sketching apps (Concepts) serve everyone, so none of them is built around how STEM people actually work. That work means deriving, sketching diagrams, checking problem sheets and answer keys, plotting, measuring and iterating.

Axiom gets there in three stages:

1. **Stage 1 (this build):** a faithful Concepts-class infinite vector canvas for iPad with Apple Pencil. Getting this foundation right matters more than anything else.
2. **Stage 2:** Notability-class study features, aimed at STEM. This means PDFs, problem sheets, LaTeX, graphs, units and audio-synced notes.
3. **Stage 3:** AI tutoring built into the canvas, like an IDE copilot (Claude or GPT). The tutor can see your strokes as structured data without screenshots, pull up your problem sheets and answer sheets, and give guided hints instead of answers.

---

## 2. Research summary: what Concepts is

Sources: the official Concepts manual (Workspace, Brushes and Tools, Precision Tools, Selection, Layers, Colors, Gallery).

| Area | What Concepts does |
|---|---|
| Canvas | Infinite vector canvas. Two-finger pan, pinch zoom, twist rotation. The status bar shows zoom and rotation. |
| Status bar | Gallery, drawing name, Precision toggle, Layers toggle, Objects, zoom and measurement readout, Import, Export, Settings and Help. |
| Tool Wheel / Tool Bar | Up to 8 tool slots on the outer ring, with undo and redo beside the wheel. The inner ring holds Size, Opacity and Smoothing, each with presets. You can tap+hold+slide to adjust them, or tap one to open its slider. The center shows the current color: tap it for the color wheel, hold it for the palettes. Drag the wheel to a screen edge to turn it into a tool bar. Each slot keeps its own brush, color, size, opacity and smoothing. Tapping the active slot opens the Brush menu. |
| Brushes | Pen (velocity), Fountain, Dynamic (pressure), Fixed Width, Wire (zoom-independent width), Soft and Hard Pencil (tilt shading), Marker (chisel, transparency), Airbrush (soft), Watercolor, Fill (fills the drawn shape), Dotted. |
| Tools | Nudge (push and pull strokes like string), Slice eraser (cuts vector paths), Hard and Soft Mask (non-destructive erasing), Selection (Lasso and Item Picker), Pan, Zoom, Rotate. |
| Smoothing | 0% is raw input, 50% removes bumps, and 100% draws a straight line between the endpoints. |
| Precision | Grids: dot, graph, lined, isometric, triangle, and 1/2/3-point perspective. Snap to Grid and Align to Grid (straight strokes along the grid directions), plus Auto-complete (endpoint joining). Measure: units, drawing scale and live length labels. Shape guides: line, arc, angle, ellipse and rectangle, with handles. Double-tap the center for a perfect circle or square. Draw & Hold shape recognition covers lines, arcs, triangles, rectangles, circles and ellipses. |
| Selection | Lasso is the default; there is also Item Picker. Partial or complete selection, and active layer only or all layers. The selection popup offers Copy, Duplicate, Group, Lock, Delete and Flip H/V. You can transform with move, scale or stretch, and rotate. Highlight Selection fades everything that isn't selected. |
| Layers | Thumbnails, visibility, lock, opacity, rename, duplicate, merge down, delete, select all, drag to reorder. Automatic (per-tool) or Manual sorting. Focus mode fades the other layers. |
| Colors | COPIC, HSL and RGB wheels. Palettes of 8 colors, recent colors, an eyedropper and hex input. |
| Gestures | Two-finger tap undoes and three-finger tap redoes. Tap+hold opens selection. Finger action is configurable (draw, pan or select) when using a stylus. |
| Gallery | Thumbnail grid, sorting, rename, duplicate, delete, share, and creating a new drawing. |
| Export | PNG, JPG, PDF, SVG, DXF and PSD. |

## 3. Stage 1 scope (built now)

**Platform decision:** Axiom is an installable web app (a PWA) in plain HTML, CSS and JavaScript with no dependencies. Safari on iPadOS supports Pointer Events with Apple Pencil pressure, tilt and hover, so it can be added to the Home Screen and run full screen and offline. Later we can wrap the same code in a native shell (WKWebView or Capacitor) for the App Store, or port the renderer to Metal if we ever need lower latency.

### Built
- **Gallery:** a thumbnail grid with search and sorting. A new-drawing sheet offers paper templates (Blank, Dot, Graph, Lined, Isometric, Engineering) and backgrounds. Each drawing can be renamed, duplicated, deleted (with confirmation), exported as a project file, or imported. Drawings autosave to IndexedDB.
- **Canvas:** an infinite vector canvas with world-space strokes. You can pan, zoom from 2% to 6400%, and rotate (snaps to 0°). The status bar readout resets the view when tapped. Off-screen strokes are culled, and during heavy scenes the renderer falls back to a bitmap cache.
- **Input:** Apple Pencil pressure, tilt shading, hover cursor and coalesced events. Palm rejection works because touches are ignored while the pencil is drawing. Finger action can be set to Auto, Draw, Pan or Select. Two-finger tap undoes and three-finger tap redoes. On a keyboard, ⌘Z and ⇧⌘Z undo and redo, plus tool shortcuts. Mouse and trackpad are supported for desktop testing.
- **Brushes:** Pencil (grain texture, tilt), Pen (pressure), Brush Pen (taper), Fine Liner (fixed width), Wire (screen-constant width), Marker (multiply), Highlighter, Airbrush (soft), Dotted, Fill.
- **Tools:** Slice eraser (cuts vector paths), Stroke eraser, Hard Mask and Soft Mask (non-destructive), Selection (Lasso and Item Picker, partial or complete, active layer or all layers), Nudge, Eyedropper.
- **Tool Wheel and Tool Bar:** both are available, with 8 configurable slots and per-slot brush, color, size, opacity and smoothing. Size, Opacity and Smoothing have presets, and you can drag them to adjust. The Brush menu includes a live preview. Undo and redo sit on the wheel or bar. You can drag the wheel or bar to move it, and double-tap the grip to switch between wheel and bar.
- **Color:** a palette grid of studio marker colors, an HSB wheel, RGB and HSL sliders, hex input, recent colors, custom palettes of 8 colors, and a quick palette strip.
- **Layers:** thumbnails, show and hide, lock, opacity, rename, duplicate, merge down, clear, delete, select all, long-press drag to reorder, focus mode (double-tap a layer), and Manual or Automatic (per-tool) sorting.
- **Precision:** grids (dot, graph, lined, isometric, triangle) with spacing, divisions and opacity, adapting to zoom. Snap to Grid (straight segments between lattice points), Align (straight strokes along the grid directions), and Connect Endpoints. Measure offers units (px, pt, mm, cm, in) and a drawing scale, with live length labels and the selection's W×H. Guides: Line, Ellipse, Rectangle and Angle, each with handles. Double-tap the center for a perfect circle or square, or to limit the line to a segment. The Angle guide shows degrees. Draw & Hold shape recognition covers lines, arcs, triangles, rectangles and squares, polygons, circles and ellipses.
- **Selection actions:** Duplicate, Copy, Paste, Delete, Flip H/V, Recolor, Bring to Front or Send to Back, and Move to Layer. Transforms cover moving, scaling (or stretching), rotating, and pinching to transform the selection.
- **Import:** images (file picker or paste) and PDFs (each page becomes an image on a locked layer). This is the start of loading problem sheets.
- **Export:** PNG (whole drawing, current view or selection, at 1×–4×, transparent or with paper), SVG (true vector), PDF, and the project file. It uses the share sheet where available and otherwise falls back to a preview you can long-press to save.
- **Settings:** theme (system, light or dark), tool setup (wheel or bar), toolbar side, finger action, gestures, pressure sensitivity, hold time, rotation, hover cursor and highlight selection.
- **Hidden UI mode** for presenting or full-screen drawing.

### Deferred in Stage 1 (known gaps compared with Concepts)
Perspective grids, the watercolor blend, custom brush creation, groups, the Object Library, DXF and PSD export, drawing sync, folders, artboards, and Apple Pencil Pro squeeze and barrel roll (the web doesn't expose them). The web also doesn't expose the Pencil double-tap gesture.

## 4. Architecture

```
axiom/
  PLAN.md                 this file
  build.mjs               inlines src into dist/index.html (PWA) and dist/artifact.html
  src/index.html          shell markup
  src/css/app.css         design tokens (light and dark) and components
  src/js/core.js          namespace, utilities, colors, events, DOM helper
  src/js/icons.js         SVG icon set (UI and brushes)
  src/js/store.js         IndexedDB persistence, settings in localStorage
  src/js/geom.js          smoothing, RDP, variable-width outlines, hit tests, shape recognition, lattice
  src/js/brushes.js       brush catalog, per-point width mapping, stroke render, SVG serialisation
  src/js/doc.js           document model, layers, snapshot history (immutable items)
  src/js/render.js        camera, scene renderer, grid, overlay, export renderer
  src/js/guides.js        shape guides (projection, handles, drawing)
  src/js/input.js         pointer router, gestures, tool actions
  src/js/ui-*.js          status bar, tool wheel and bar, color, layers, precision, selection, settings, gallery, export
  src/js/app.js           boot
```

**Data model:** a drawing holds layers, and each layer holds items. A stroke is `{t:'s', b:brush, c:color, w:size, o:opacity, pts:[x,y,m,…], bb}`, where `m` is the per-point width multiplier computed at input from pressure, tilt or velocity. An image is `{t:'i', src, iw, ih, m:[affine]}`. Items are immutable: any edit creates new items, so undo snapshots are cheap (shallow array copies) and the Path2D caches (WeakMap) stay valid.

**Rendering:** the main canvas holds committed strokes in world space under the view matrix, with per-layer offscreen compositing only when a layer needs it (opacity, masks or focus). The overlay canvas holds the live stroke, guides, selection, lasso, cursor and labels. Variable-width strokes are a nonzero union of circles and tangent quads, which gives correct round joins with no holes. New strokes are drawn incrementally when possible.

## 4b. Research from the user's own workflow (screen recording, Oct 24 2026)

- **Concepts:** course folders (Abstract Algebra, Topology, Calculus, Category Theory, Number Theory, Physics…); compact tool wheel with a palette strip; a measurement/rotation popup with presets; settings for handedness, Pencil pressure/tilt/hover, double-tap and squeeze actions, and finger action; export by region (screen, A4 artboard, selection) with DPI.
- **Notability:** subject-colored folders; PDFs as vertically scrolling pages with handwriting on them; a page-thumbnail rail; a vertical tool rail; "Chat with your notes" (ask anything, practice questions, smart notes); study sessions; version history.
- **Apple Books:** textbooks as PDFs (Munkres *Topology*, Spivak, Pinter *Abstract Algebra*, Giancoli *Physics*).
- **Gemini:** very long topology conversations with LaTeX; the student pushes for rigor ("you are doing the poetry again"); generated reference PDFs and study plans.
- **Pain point:** material, handwritten work and AI live in separate apps. Before exams the student cycles between problem PDFs, solution PDFs and AI chats about their own solution. Course-specific visuals (lenses in optics…) get redrawn over and over.

## 4c. Stage 2, first slice (built)
- **Studies:** a majors and courses onboarding sheet; a gallery sidebar of colored courses; every drawing and document belongs to a course.
- **Documents library:** PDFs and problem photos (camera, Photos or Files), saved on the device.
- **Study panel:** a docked, resizable side panel with tabs. It opens any number of PDFs or photos beside the canvas, renders pages lazily, and supports zoom and pinch. A page can be put on the canvas, all pages can be imported to annotate, and each drawing remembers its open tabs and last page.
- **Tutor (Claude, official Anthropic SDK in the browser, the user's own API key):**
  - modes: Explain, Hint (guided), Check my work, Quiz me
  - context in one tap: canvas view, a selection, the current PDF page, a photo, or a whole PDF
  - Markdown and KaTeX rendering, streaming, conversations saved per drawing
  - the system prompt knows the student's majors, courses and current course, and asks for precise language over analogies
- **Visual tools:** about 60 editable vector diagrams across Math, Topology & geometry, Optics, Mechanics, Circuits, Waves & thermo, Chemistry and CS, ordered by the student's majors.
- **My visuals:** save any selection to a course's visual library and reuse it.

## 4d. Reading room (built)
- **Library:** Home (greeting, Continue reading/drawing, recent drawings, library shelf, course tiles), Library (Continue reading, Books, Problem sets & notes) with page-1 covers and progress, and course pages that combine drawings and books.
- **Reader:**
  - continuous pages that render on demand, with zoom and pinch, fit width or fit page
  - Paper, Sepia and Night themes, a page scrubber
  - a rail with page thumbnails, the PDF's contents and highlights
  - search across the whole book's text
- **Ask with the Pencil:** drawing a box or a loop selects a passage, then Ask, Explain, Hint, Highlight or Copy text. The tutor gets a high-resolution crop, the selected lines' text and the page's text as numbered lines.
- **Citations:** the tutor cites lines as [[pN:La-Lb]], rendered as tappable chips that scroll the reader and highlight those lines. Cited lines are also marked when an answer arrives.
- **Per book:** highlights (4 colors) and tutor conversations are saved for each book. "Work on this page on the canvas" opens the document beside a drawing.
- **EPUB books (built):** paginated like Apple Books, with swipe and arrow page turns, contents, Paper/Sepia/Night themes, text size, and progress by percentage and chapter. Select text to Ask, Explain, Hint, Highlight (saved by CFI) or Copy. The tutor receives the chapter text and the selected passage.
- **Handwriting on PDF pages (built):** a Write tool with 4 pens, 3 widths, a stroke eraser and undo, stored as page-relative vector strokes. Handwriting is included in the region images sent to the tutor.
- **Gallery:** the section is now named **Books**, with a Books button on Home and the version and build shown in the sidebar.

## 4e. Three sections: Books, Notebooks, Canvases (built Oct 24 2026)
Source: a frame-by-frame review of the user's screen recording (169 frames), plus the official Concepts manual and the Notability help centre.

**Notebooks (Notability model)**
- Pages: A4, Letter, A5 or A3 sizes in portrait or landscape, with seamless vertical scroll or single pages side by side.
  - 14 paper templates: blank, lined, narrow, wide, grid 5 mm, grid 4 mm, graph, dot, Cornell, engineering, isometric, music, polar, checklist.
  - Paper colours; a template can be set for one page or all pages.
  - A blank page is always kept at the end; pages auto-append.
- Tool rail (writing tools only): 3 pen presets, highlighter, eraser, text, lasso.
  - The flyout holds pen type, colours, 3 sizes, eraser mode, selection mode and fonts.
  - "+" holds photo, camera, sticky note, PDF pages, new page and diagrams, plus the laser pointer, tape and ruler.
- Top bar: undo, redo, record, Learn, pages and "…".
  - "…" menu: export, paper and page, study session, version history, favourite, finger drawing, settings.
- Page counter (current/total with up and down). Page sidebar: thumbnails, bookmarks, filter for all or bookmarked pages, and per-page actions (insert, duplicate, move, paper, export, clear, delete).
- Lecture recording (native AVAudioRecorder, or MediaRecorder on the web):
  - strokes and text are time-stamped to the recording
  - replay dims ink that hasn't been written yet
  - tap a stroke to jump the audio to it
  - playback speed and multiple recordings
- Tape for active recall: tap with a finger to reveal; cover or reveal all.
- Laser pointer: a fading trail; nothing is saved.
- Text boxes and sticky notes, with font, size, bold and colour.
- Study timer: focus/break rounds.
- Version history: 15 local snapshots that can be restored.
- Learn: chat with your notes (page images attached), smart notes, interactive multiple-choice practice (```quiz JSON), flip flashcards (```flashcards JSON), check this page.
- PDF import adds real pages; a photo or scan becomes a page.

**Canvases (Concepts model)**
- Measurement popover: zoom and rotation fields, each with a lock padlock. Presets are 10/100/350/1600% and 0/90/180/270°. The readout shows the locks.
- Artboards (A4, Letter, A3, A5, square, 16:9, screen) on the infinite canvas:
  - a label shows the name and size in cm
  - drag the label to move the artboard; tap it to rename, swap orientation, resize, export or delete
- Export panel: format, Region (screenshot, entire drawing, each artboard, selection, all pages, this page), background and grid toggles, and 72/150/300/600 ppi with the resulting pixel size. Multi-page PDF.
- Settings in sections:
  - Workspace: theme, tool palette, handedness, background, grid, artboards, drawing scale, units.
  - Interaction: finger action, rotation and zoom on two fingers, tap+hold, draw & hold time, 2- and 3-finger taps, Pencil double-tap and squeeze actions, pressure, hover.
  - iPad: lock screen rotation, keep the iPad awake.
  - Notebooks, Tutor, Studies, Recently Deleted (30 days).

**Books (Apple Books touches):** mark as finished, a Finished shelf, and a daily reading goal ring with a tracked reading time.

**Library:** Home, Books, Notebooks, Canvases, Favorites and courses. One "New" button opens Notebook, Canvas, Book or PDF, or Import.

**Native shell:**
- The app is served from axiom://app/ by a WKURLSchemeHandler, so large PDFs stream as raw bytes. This fixed "This PDF could not be opened" for textbooks.
- Audio bridge, orientation lock and idle-timer bridge.

**Design rule (from user feedback):** show only the primary actions; everything secondary goes behind one "+" or "…". No rows of text chips where a segmented control or a menu will do.

## 4f. Polish pass from the user's second recording (Oct 24 2026, 23:14)
Three reviewers went frame by frame through the recording. Their findings, merged into one checklist (P0 = broken, P1 = unpolished, P2 = refinement).

**System (applies everywhere)**
- [x] Tokens: radii 8/12/20 plus capsule; 4pt spacing base (12 chrome margin, 16 gutter, 24–32 sections); one accent; one floating-surface style (material blur, 0.5px hairline, shared shadow).
- [x] Type: serif only for the wordmark and page titles; sans with tabular figures for every number (no monospace in the UI).
- [x] Motion: one easing curve; views fade/scale in; sheets slide up over an opaque scrim; popovers scale in; momentum on finger pans; no layout jumps.
- [x] Toasts: a single capsule centred in the active pane above the bottom chrome, short copy, never stacked.
- [x] Gestures: Pencil draws, one finger pans, two fingers zoom or pan the canvas. A selection transforms only with its handles or with two fingers that both start inside it. Tap-and-hold needs a still single touch and never fires during or right after a pinch.

**Library**
- [x] One header component: title and primary button on one row; search with a right-aligned sort below it; the same on every section.
- [x] One adaptive grid; consistent card radius; thumbnails with a hairline and a shadow; titles clamped to 2 lines (the ••• button no longer steals the width); relative dates.
- [x] Continue cards: a fixed thumbnail slot and an aligned text column; no orphan cells.
- [x] Sidebar: house icon for Home; distinct Canvases icon; "Unfiled" instead of "No course"; readable counts; build string only in Settings.
- [x] Empty states: centred, with explicit New notebook / New canvas / Add textbook buttons; no search or sort while empty.
- [x] Folders in Notebooks, Canvases and Books.
- [x] Long-press that never fires while scrolling.
- [x] Books page: hero card, filter, folders, grid.

**Books reader**
- [x] Pages never blank: keep the old bitmap while re-rendering; low-res preview first; quiet loading lines instead of a page number.
- [x] One full-width material top bar with content inset. Chrome auto-hides when reading (scroll down / tap) and returns on scroll up or tap. The scrubber is docked in a bottom bar.
- [x] Modes Read / Highlight / Write, centred on the reading column. Right side: search, pages, Aa, tutor.
- [x] Title from PDF metadata with the current chapter underneath; printed page labels in the scrubber.
- [x] Aa popover: zoom stepper with value, fit width/page, theme swatches with a check.
- [x] Ask card: one card (header, field with inline send, chips) that never covers the selection.
- [x] Tutor panel: header with a title and close; content top-aligned; the toggle state bound to the panel.
- [x] Highlights snapped to text lines; a night-mode palette that keeps text readable.

**Canvas and split view**
- [x] One selection bar (4 actions + …), clamped clear of the rail, the top pills and the bottom bar.
- [x] Selection bar hidden during transforms and back right after; rotation handle moves to the bottom near the top edge.
- [ ] Mid-edge handles for one-axis scaling; auto-pan when the selection runs under the chrome; no stray dimension labels.
- [x] "Highlight selection" dims ink only, gently; off by default.
- [x] Inserted pages sized to the view; a short toast centred in the pane.
- [x] Zoom readout: fixed width, centred on the pane, rotation shown only when it isn't 0.
- [x] Rail: fixed layout (colour slot always present); readable disabled states.
- [x] Highlighter on dark paper uses a glowing blend. Visible lasso. Ignore stray Pencil dabs by the tool bar.
- [ ] Canvas dot grid: crossfading level of detail (notebook templates done).
- [x] Split-view book pane: one-row toolbar, printed page labels, never blank.

**Notebooks**
- [x] Book pages and problems added to a notebook become locked page backgrounds (never picked up by a tap).
- [x] Pencil with a drawing tool never selects or opens a menu; finger hold selects only when the finger isn't drawing, with a visible progress ring.
- [x] Page counter "2 / 3" on one line; next-page disabled on the last page.
- [x] With the side panel open, the page is inset so the rail never covers it; one smooth refit.
- [x] Dark pages: a lighter page fill and a hairline edge. Ink stays visible on dark paper (adaptive colours).
- [x] Dot and grid templates: constant-size dots in screen pixels and level of detail when zoomed out.
- [x] One title chip shared by the notebook, canvas and reader (back chevron, title, small subtitle).

**Settings**
- [x] Visible selected state for every segmented control; menus for choices with more than 3 options; one control column; readable subtitles; consistent copy.

**Context understanding**
- [x] Prose definitions ("is called", "we say"), named laws, numbered equations (resolving "Eq. (3.12)"), and section openings, so it works for books that never label results.

## 5. Stage 2 roadmap: STEM study features (Notability and beyond)
1. **PDF workspace:** a page view with a thumbnail rail and annotation directly on top. The split view beside your work is done; see 4c.
2. **Math typesetting:** LaTeX blocks (KaTeX) and handwriting-to-LaTeX conversion.
3. **Text boxes, sticky notes and links between canvases.**
4. **Graph and plot objects:** live function plots (y=f(x), parametric, polar) and data tables to scatter plots.
5. **Scientific stamps and object library:** circuit symbols, free-body diagram parts, chemistry (benzene, bonds), optics, logic gates and coordinate axes.
6. **Geometry construction tools:** compass, protractor, perpendicular and parallel, intersection points, dimensioned constraints.
7. **Units-aware calculator and inline evaluation** of handwritten expressions.
8. **Audio recording synced to strokes** (Notability's signature feature), plus page templates (Cornell, lab notebook, engineering pad).
9. **Folders, tags, search** (including handwriting OCR) and iCloud or account sync.
10. **Perspective grids, groups, artboards, and DXF and PSD export** to close the remaining Concepts gaps.

## 6. Stage 3 roadmap: AI tutor in the canvas
- **A side panel chat, like VS Code's,** that streams from Claude (default `claude-opus-5-5`, or a cheaper model for hints) or GPT.
- **The tutor reads your work as structured data.** It receives vector strokes, recognised math (LaTeX), shapes, measurements and layout regions, not screenshots. It can still request a rendered crop when it needs to see something.
- **Material awareness:** the user attaches problem sheets, study material and answer keys to a drawing, and the tutor can open the relevant page beside the canvas.
- **Guided mode:** Socratic hints, step checking ("line 3: sign error when distributing"), on-canvas ghost annotations on their own AI layer, and no full solutions unless asked.
- **Monitoring:** optional live watch that notices when you're stuck (long idle, repeated erasing) and offers a nudge.
- **Specialisations:** profiles for maths (proof checking, notation), physics (units and dimensional analysis), chemistry and engineering.
- **Privacy:** local by default, with explicit per-drawing sharing.

---

## 7. Master build prompt (reusable)

> You are building **Axiom**, an iPad-first infinite-canvas vector drawing app for scientists and mathematicians, as a dependency-free PWA in HTML, CSS and JavaScript.
>
> Stage 1 is a faithful recreation of the Concepts app's core experience, with a calm, precise visual identity of its own:
> - **Gallery:** IndexedDB autosave, thumbnails, paper templates.
> - **Canvas:** infinite vector canvas with pan, pinch zoom and rotation.
> - **Input:** Apple Pencil pressure, tilt, hover, palm rejection and coalesced events. Finger action can be set to Auto, Draw, Pan or Select. Two-finger tap undoes and three-finger tap redoes.
> - **Tool Wheel and Tool Bar:** 8 slots, each with its own brush, color, size, opacity and smoothing. Size, Opacity and Smoothing have presets plus tap+hold+slide. The center color opens the picker, and tapping the active slot opens the Brush menu with a preview. Undo and redo sit beside them.
> - **Brushes:** Pencil (grain, tilt), Pen, Brush Pen, Fine Liner, Wire, Marker, Highlighter, Airbrush, Dotted, Fill.
> - **Tools:** Slice eraser, Stroke eraser, Hard and Soft Mask, Lasso and Item Picker selection, Nudge, Eyedropper.
> - **Color:** palette grid, HSB wheel, RGB and HSL sliders, hex, recents, custom 8-color palettes.
> - **Layers:** thumbnails, visibility, lock, opacity, rename, duplicate, merge, clear, delete, reorder, focus, auto or manual.
> - **Precision:** dot, graph, lined, isometric and triangle grids. Snap to Grid, Align and Connect Endpoints. Measure with units and scale. Line, Ellipse, Rectangle and Angle guides with handles and constrain-on-double-tap. Draw & Hold shape recognition.
> - **Selection:** transform, duplicate, copy, paste, delete, flip, recolor, reorder, and move to layer.
> - **Import and export:** images and PDF in; PNG, SVG, PDF and project file out.
> - **Settings and hidden-UI mode.**
>
> **Engineering rules:**
> - Items are immutable and history uses snapshots.
> - Strokes are stored in world coordinates with per-point width multipliers.
> - Variable-width strokes render as a circle-and-quad union.
> - Composite per layer offscreen only when needed, and draw the live stroke on an overlay canvas.
> - Use the theme tokens for both light and dark.
> - Use 44pt touch targets and no browser gestures (touch-action none, gesture events prevented).
> - Everything works offline after the first load.
>
> Stage 2 adds the STEM study features in section 5, and Stage 3 adds the in-canvas AI tutor in section 6.
