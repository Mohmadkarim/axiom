/* Notebooks on Apple's PencilKit (iPad app): the ink, the Pencil and finger scrolling live in a native view under this
   page; the page renders the paper (templates, pictures, text) as page images, keeps a copy of the ink for pictures,
   the tutor and export, and draws only its interface and overlays on top. */
'use strict';
(() => {
  const D = A.D, R = A.R, B = A.B, S = A.settings;
  const PK = (A.PK = {});
  const NATIVE = !!(window.AXIOM_NATIVE && window.AXIOM_NATIVE.pencilkit && A.native);
  PK.available = NATIVE;
  PK.active = false;
  const post = (m) => (A.native ? A.native.post(m).catch(() => {}) : Promise.resolve());
  PK.wanted = (doc) => NATIVE && S.pencilKit !== false && !!doc;
  const isCanvas = () => !D.isNotebook(D.doc);

  // layout position (not getBoundingClientRect: the view's open animation scales it for a moment)
  const stageFrame = () => { const el = A.$('#stage'); let x = 0, y = 0; for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return [x, y, el.offsetWidth, el.offsetHeight]; };
  const insets = () => [R.notebookTop || 70, 16, 90, 66];
  const look = () => (isCanvas() ? { dark: R.darkActive() || R.paperIsDark(), desk: R.displayBg() } : { dark: R.paperIsDark(), desk: R.deskColor(R.isDarkTheme()) });

  /* ---------- open / close ---------- */
  let layout = new Map(); // page id -> rect last sent to the native view
  const snapLayout = () => (isCanvas() ? new Map() : new Map(D.doc.pages.map((p, i) => [p.id, D.pageRect(D.doc, i)])));
  function enter() {
    const doc = D.doc;
    // strokes written before PencilKit move into the PencilKit drawing once (a backup copy is kept in the file store)
    const legacy = [];
    if (!doc.pkInk) {
      doc.layers.forEach((l) => {
        if (l.pk || l.pdfLayer) return;
        l.items = l.items.filter((it) => {
          const c = it.t === 's' && B.catalog[it.b];
          if (!c || c.mask || it.b === 'tape') return true;
          legacy.push({ b: it.b, c: it.c, w: it.w, o: it.o == null ? 1 : it.o, pts: it.m ? movePts(it.pts, it.m) : it.pts });
          return false;
        });
      });
      if (legacy.length) A.store.saveFile('inkbak_' + doc.id, new Blob([JSON.stringify(legacy)], { type: 'application/json' })).catch(() => {});
      doc.pkInk = true;
      D.changed('meta');
    }
    if (!doc.layers.some((l) => l.pk)) { const l = D.newLayer('Ink'); l.pk = true; l.locked = true; doc.layers.push(l); }
    PK.active = true; R.pk = true;
    A.$('#canvas-view').classList.add('pk'); document.documentElement.classList.add('pk-on');
    layout = snapLayout();
    const v = doc.view;
    post(Object.assign({ op: 'pkOpen', id: doc.id, canvas: isCanvas(), pages: isCanvas() ? [] : D.pageRects(doc), frame: stageFrame(), insets: insets(), zoom: v.zoom, tx: v.tx, ty: v.ty, rot: isCanvas() ? v.rot || 0 : 0, legacy }, look()))
      .then((cur) => { if (Array.isArray(cur) && D.doc === doc) views.view({ zoom: cur[0], tx: cur[1], ty: cur[2], rot: cur[3] || 0 }); });
    syncTool();
    chromeSoon();
  }
  const movePts = (pts, m) => { const out = pts.slice(); for (let i = 0; i < out.length; i += 3) { const [x, y] = A.M.apply(m, out[i], out[i + 1]); out[i] = x; out[i + 1] = y; } return out; };
  function leave() {
    if (!PK.active) return;
    PK.active = false; R.pk = false;
    A.$('#canvas-view').classList.remove('pk'); document.documentElement.classList.remove('pk-on');
    post({ op: 'pkClose' });
    PK.order = []; PK.redoOrder = [];
  }
  A.on('doc:open', () => { leave(); if (D.doc && PK.wanted(D.doc)) setTimeout(enter, 0); });
  A.on('doc:close', leave);
  A.on('go:gallery', leave);

  /* ---------- view: the native scroll view leads; overlays follow ---------- */
  const views = {
    view: (v) => {
      if (!PK.active || !D.doc) return;
      Object.assign(D.doc.view, { zoom: v.zoom, tx: v.tx, ty: v.ty, rot: v.rot || 0 });
      A.emit('view');
      R.renderOverlay();
    },
    recognize: (d) => {
      if (!PK.active || !D.doc.precision.recog) return;
      const pts = d.pts, bb = A.G.bbox(pts), z = d.zoom || D.doc.view.zoom;
      if (A.G.length(pts) * z < 70 || Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) * z < 45) return; // handwriting-sized: leave it
      const r = A.G.recognize(pts);
      if (r) post({ op: 'pkReplaceLast', pts: r.pts, sharp: !!r.sharp });
    },
    needPage: (r) => queuePage(r.i, r.scale),
    needTiles: (list) => { tileQ = Array.isArray(list) ? list : []; if (!tileBusy) renderTile(); },
    strokes: (list) => mirror(list),
    changed: () => { if (PK.undoing) { PK.undoing = false; return; } (PK.order = PK.order || []).push('ink'); PK.redoOrder = []; A.emit('history'); },
  };
  /* a tap or a stroke on the native page: what a tap outside would do on the web (menus close, the selection
     clears, a text box being typed in is finished) */
  function touched() {
    A.closePopovers();
    if (A.TE && A.TE.active && A.TE.active()) A.TE.commit();
    if (PK.active && R.sel && R.sel.size && !(A.CROP && A.CROP.active())) { A.emit('selection:clear'); R.render(); }
    A.emit('pk:touch');
  }
  window.__axiomPK = (kind, data) => { if (kind === 'touch') return touched(data); if (PK.alt) return PK.alt(kind, data); const f = views[kind]; if (f) f(data); };
  PK.post = post;
  PK.setView = (v) => post({ op: 'pkView', zoom: v.zoom, tx: v.tx, ty: v.ty, rot: v.rot || 0 });

  /* ---------- page images (paper, templates, pictures, text; never ink) ---------- */
  const queue = new Map();
  let pumping = false;
  function queuePage(i, scale) { queue.set(i, scale); if (!pumping) pump(); }
  function pump() {
    if (!PK.active || !queue.size) { pumping = false; return; }
    pumping = true;
    const [i, scale] = queue.entries().next().value;
    queue.delete(i);
    if (i < D.doc.pages.length) {
      const rc = D.pageRect(D.doc, i);
      const c = R.renderRegion(D.doc, rc, scale, { bg: true, noStrokes: true, onImage: imageLoaded });
      post({ op: 'pkPage', i, scale, data: c.toDataURL('image/jpeg', 0.9).split(',')[1] });
    }
    setTimeout(pump, 0);
  }
  // a picture finished loading after its page was drawn: draw again (once per burst)
  let imgT = 0;
  const imageLoaded = () => { clearTimeout(imgT); imgT = setTimeout(() => { if (PK.active) post({ op: 'pkDirty', all: true }); }, 50); };
  /* canvases: the background (paper, grid, artboards, pictures, text, special strokes) in tiles the native view asks
     for, nearest first; a newer list replaces the older one */
  let tileQ = [], tileBusy = false;
  function renderTile() {
    if (!PK.active || !tileQ.length) { tileBusy = false; return; }
    tileBusy = true;
    const t = tileQ.shift();
    const c = R.renderRegion(D.doc, [t.x, t.y, t.x + t.w, t.y + t.h], t.s, { bg: true, grid: true, noStrokes: true, display: true, maxPx: 1100, onImage: imageLoaded });
    post({ op: 'pkTile', k: t.k, l: t.l, rect: [t.x, t.y, t.w, t.h], data: c.toDataURL('image/jpeg', 0.88).split(',')[1] }).then(() => setTimeout(renderTile, 0));
  }
  A.on('doc:changed', (k) => {
    if (!PK.active || k === 'ink' || k === 'meta') return;
    post({ op: 'pkDirty', all: true });
  });
  A.on('theme', () => { if (PK.active) { post(Object.assign({ op: 'pkFrame', frame: stageFrame() }, look())); post({ op: 'pkDirty', all: true }); } });

  /* pages added, removed, moved or duplicated: the ink on each page moves with it */
  const PARK_X = -60000;
  const parked = () => (D.doc.pkParked = D.doc.pkParked || {});
  const parkRect = (id, rc) => { const P = parked(); if (P[id] == null) P[id] = Object.keys(P).length; const h = rc[3] - rc[1]; return [PARK_X, P[id] * (h + 200), PARK_X + rc[2] - rc[0], P[id] * (h + 200) + h]; };
  function relayout() {
    if (!PK.active) return;
    const next = snapLayout(), moves = [];
    for (const [id, rc] of layout) {
      const to = next.get(id) || parkRect(id, rc);
      if (to[0] !== rc[0] || to[1] !== rc[1]) moves.push({ from: rc, to: [to[0], to[1]] });
    }
    for (const [id, rc] of next) {
      if (layout.has(id)) continue;
      if (parked()[id] != null) { const from = parkRect(id, rc); moves.push({ from, to: [rc[0], rc[1]] }); delete parked()[id]; }
    }
    layout = next;
    if (moves.length) post({ op: 'pkMove', moves });
    post({ op: 'pkPages', pages: D.pageRects(D.doc) });
  }
  A.on('pages', () => setTimeout(relayout, 0));
  const dup = D.duplicatePage;
  D.duplicatePage = (i) => {
    dup(i);
    if (!PK.active) return;
    setTimeout(() => { const from = D.pageRect(D.doc, i), to = D.pageRect(D.doc, i + 1); post({ op: 'pkCopy', from, to: [to[0], to[1]] }); }, 10);
  };

  /* ---------- the copy of the ink kept by the page (pictures, the tutor, export, thumbnails) ---------- */
  function mirror(list) {
    if (!PK.active || !D.doc) return;
    const l = D.doc.layers.find((x) => x.pk);
    if (!l) return;
    l.items = (list || []).map((s) => D.makeStroke(s.b, s.c, s.w, s.o, s.pts, { pk: true }));
    D.changed('ink');
    A.emit('layers:thumbs');
  }

  /* ---------- lecture replay ---------- */
  let lastReplay = '';
  PK.syncReplay = () => {
    const rp = R.replay, rec = rp && (D.doc.recordings || []).find((r) => r.id === rp.rid);
    const msg = rec ? { op: 'pkReplay', on: true, start: rec.created, end: rec.created + (rec.dur || 36000) * 1000 + 1500, t: rp.t >= 1e9 ? 1e7 : Math.round(rp.t * 10) / 10 } : { op: 'pkReplay', on: false };
    const key = JSON.stringify(msg);
    if (key === lastReplay) return;
    lastReplay = key;
    post(msg);
  };

  /* ---------- tools ---------- */
  const INK = { pen: 'pen', fountain: 'fountain', brushpen: 'fountain', pencil: 'pencil', marker: 'marker', highlighter: 'marker', ballpoint: 'monoline', monoline: 'monoline' };
  function syncTool() {
    if (!PK.active) return;
    const slot = B.slot(), c = (slot && B.catalog[slot.b]) || {};
    let t;
    if (slot.b === 'eraser') t = { tool: 'eraser', mode: 'vector' };
    else if (slot.b === 'slice') t = { tool: 'eraser', mode: 'bitmap', width: Math.max(4, slot.size) };
    else if (slot.b === 'select') t = { tool: 'lasso' };
    else if ((c.kind === 'var' || c.kind === 'line') && !c.mask && slot.b !== 'tape') t = { tool: 'ink', ink: INK[slot.b] || 'pen', color: slot.color, alpha: slot.b === 'highlighter' ? Math.min(0.5, slot.opacity == null ? c.opacity : slot.opacity) : (slot.opacity == null ? 1 : slot.opacity), width: slot.size * (slot.b === 'highlighter' || slot.b === 'marker' ? 1 : 1.15) };
    else t = { tool: 'none' }; // text, laser, tape: the page handles the Pencil
    t.finger = S.fingerAction === 'draw';
    post({ op: 'pkShapes', on: !!(D.doc && D.doc.precision && D.doc.precision.recog), rotate: !!D.doc && isCanvas() && S.allowRotate !== false && !S.rotLock });
    t.ruler = !!(D.doc && D.doc.precision && D.doc.precision.guide && (D.doc.precision.guideType || 'line') === 'line');
    post(Object.assign({ op: 'pkTool' }, t));
  }
  PK.syncTool = syncTool;
  ['slot', 'slot:live', 'slot:size', 'slot:select', 'tool:select', 'precision', 'settings', 'view:lock'].forEach((ev) => A.on(ev, () => setTimeout(syncTool, 0)));
  /* the page ignores the Pencil while PencilKit draws, erases or lassos */
  PK.ownsPen = () => PK.active && !!B.slot() && ['ink', 'eraser', 'lasso'].includes(kindOf(B.slot()));
  const kindOf = (slot) => { const c = B.catalog[slot.b] || {}; if (slot.b === 'eraser' || slot.b === 'slice') return 'eraser'; if (slot.b === 'select') return 'lasso'; if ((c.kind === 'var' || c.kind === 'line') && !c.mask && slot.b !== 'tape') return 'ink'; return 'none'; };

  /* ---------- undo: one order across ink (PencilKit) and page edits (the page) ---------- */
  PK.order = []; PK.redoOrder = [];
  const commit = D.commit;
  D.commit = (kind) => { const pending = D.hasPending ? D.hasPending() : true; commit(kind); if (PK.active && pending) { PK.order.push('doc'); PK.redoOrder = []; } };
  PK.undo = () => {
    const last = PK.order.pop();
    if (last === 'ink') { PK.undoing = true; post({ op: 'pkUndo' }); PK.redoOrder.push('ink'); A.emit('history'); return true; }
    if (last === 'doc') { D.undo(); PK.redoOrder.push('doc'); A.emit('history'); return true; }
    return false;
  };
  PK.redo = () => {
    const last = PK.redoOrder.pop();
    if (last === 'ink') { PK.undoing = true; post({ op: 'pkRedo' }); PK.order.push('ink'); A.emit('history'); return true; }
    if (last === 'doc') { D.redo(); PK.order.push('doc'); A.emit('history'); return true; }
    return false;
  };

  /* ---------- where the interface is: touches there stay with the page, everywhere else goes to PencilKit ---------- */
  let chromeKey = '', chromeT = 0;
  function chrome() {
    chromeT = 0;
    if (!PK.active && !PK.alt) return;
    const out = [];
    const add = (el) => {
      for (const r of el.getClientRects()) if (r.width > 1 && r.height > 1) out.push([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
    };
    const cv = PK.alt ? A.$('#reader-view') : A.$('#canvas-view');
    cv.querySelectorAll('.panel, button, input, select, textarea, [role="toolbar"], #studypanel:not([hidden]), .te-area, .te-bar, .rd-bar, aside:not([hidden])').forEach((el) => {
      if (el.closest('#stage, .rd-pages') && !el.closest('.te-area, .te-bar')) return;
      if (el.hidden || el.closest('[hidden]') || getComputedStyle(el).pointerEvents === 'none' || getComputedStyle(el).visibility === 'hidden') return;
      add(el);
    });
    document.querySelectorAll('.popover, .modal-back, .ex-view, .crop-ui, #toasts > *').forEach(add);
    PK.webTargets = PK.alt ? [] : webTargets();
    PK.webTargets.forEach((r) => out.push(r));
    const key = JSON.stringify(out);
    if (key === chromeKey) return;
    chromeKey = key;
    post({ op: 'pkChrome', rects: out });
  }
  /* with the lasso, pictures, text boxes and the current selection belong to the page (select, move, resize, crop) */
  function webTargets() {
    if (!PK.active || !D.doc || !B.slot() || B.slot().b !== 'select') return [];
    const out = [], o = A.$('#stage').getBoundingClientRect();
    const scr = (bb, pad = 0) => {
      const cs = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => R.toScreen(x, y));
      const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
      return [Math.round(o.left + Math.min(...xs) - pad), Math.round(o.top + Math.min(...ys) - pad), Math.round(Math.max(...xs) - Math.min(...xs) + pad * 2), Math.round(Math.max(...ys) - Math.min(...ys) + pad * 2)];
    };
    for (const l of D.doc.layers) {
      if (l.pk || l.locked || !l.visible) continue;
      for (const it of l.items) if (B.isBox(it)) out.push(scr(it.bb));
    }
    if (R.sel.size && A.SEL.box) out.push(scr(A.SEL.box, 34));
    return out.filter((r) => r[2] > 0 && r[3] > 0 && r[0] < innerWidth && r[1] < innerHeight && r[0] + r[2] > 0 && r[1] + r[3] > 0);
  }
  PK.onWebTarget = (x, y) => (PK.webTargets || []).some((r) => x >= r[0] && y >= r[1] && x <= r[0] + r[2] && y <= r[1] + r[3]);
  ['view', 'selection', 'selection:clear', 'slot', 'slot:select', 'tool:select'].forEach((ev) => A.on(ev, () => { if (PK.active) chromeSoon(); }));
  const chromeSoon = () => { if (!chromeT) chromeT = setTimeout(chrome, 60); };
  PK.chrome = chromeSoon;
  new MutationObserver(() => { if (PK.active || PK.alt) chromeSoon(); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  addEventListener('resize', () => { if (!PK.active) return; chromeSoon(); post({ op: 'pkFrame', frame: stageFrame(), insets: insets() }); });
  A.on('stage:resize', () => { if (PK.active) post({ op: 'pkFrame', frame: stageFrame(), insets: insets() }); });
  setInterval(() => { if (PK.active || PK.alt) chrome(); }, 1000);
})();
/* the rotation lock can change from the readout and settings: keep the native view's twist-to-rotate in step */
(() => {
  let last = null;
  setInterval(() => {
    const PK = A.PK, S = A.settings;
    if (!PK || !PK.active || !A.D.doc) return;
    const f = !A.D.isNotebook() && S.allowRotate !== false && !S.rotLock;
    if (f !== last) { last = f; PK.syncTool(); }
  }, 800);
})();
