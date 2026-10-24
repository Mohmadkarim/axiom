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
