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
  PK.wanted = (doc) => NATIVE && S.pencilKit !== false && D.isNotebook(doc);

  const stageFrame = () => { const r = A.$('#stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const insets = () => [R.notebookTop || 70, 16, 90, 66];
  const look = () => ({ dark: R.paperIsDark(), desk: R.deskColor(R.isDarkTheme()) });

  /* ---------- open / close ---------- */
  let layout = new Map(); // page id -> rect last sent to the native view
  const snapLayout = () => new Map(D.doc.pages.map((p, i) => [p.id, D.pageRect(D.doc, i)]));
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
    post(Object.assign({ op: 'pkOpen', id: doc.id, pages: D.pageRects(doc), frame: stageFrame(), insets: insets(), zoom: v.zoom, tx: v.tx, ty: v.ty, legacy }, look()))
      .then((cur) => { if (Array.isArray(cur) && D.doc === doc) views.view({ zoom: cur[0], tx: cur[1], ty: cur[2] }); });
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
      Object.assign(D.doc.view, { zoom: v.zoom, tx: v.tx, ty: v.ty, rot: 0 });
      A.emit('view');
      R.renderOverlay();
    },
    needPage: (r) => queuePage(r.i, r.scale),
    strokes: (list) => mirror(list),
    changed: () => { if (PK.undoing) { PK.undoing = false; return; } (PK.order = PK.order || []).push('ink'); PK.redoOrder = []; A.emit('history'); },
  };
  window.__axiomPK = (kind, data) => { const f = views[kind]; if (f) f(data); };
  PK.setView = (v) => post({ op: 'pkView', zoom: v.zoom, tx: v.tx, ty: v.ty });

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
      const c = R.renderRegion(D.doc, rc, scale, { bg: true, noStrokes: true });
      post({ op: 'pkPage', i, scale, data: c.toDataURL('image/jpeg', 0.9).split(',')[1] });
    }
    setTimeout(pump, 0);
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
    t.ruler = !!(D.doc && D.doc.precision && D.doc.precision.guide);
    post(Object.assign({ op: 'pkTool' }, t));
  }
  PK.syncTool = syncTool;
  ['slot', 'slot:live', 'slot:size', 'slot:select', 'tool:select', 'precision'].forEach((ev) => A.on(ev, () => setTimeout(syncTool, 0)));
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
    if (!PK.active) return;
    const out = [];
    const add = (el) => {
      for (const r of el.getClientRects()) if (r.width > 1 && r.height > 1) out.push([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
    };
    const cv = A.$('#canvas-view');
    cv.querySelectorAll('.panel, button, input, select, textarea, [role="toolbar"], #studypanel:not([hidden]), .te-area, .te-bar').forEach((el) => {
      if (el.closest('#stage') && !el.closest('.te-area, .te-bar')) return;
      if (el.hidden || el.closest('[hidden]') || getComputedStyle(el).pointerEvents === 'none' || getComputedStyle(el).visibility === 'hidden') return;
      add(el);
    });
    document.querySelectorAll('.popover, .modal-back, .ex-view, .pc-back, .pl-week, #toasts > *').forEach(add);
    const key = JSON.stringify(out);
    if (key === chromeKey) return;
    chromeKey = key;
    post({ op: 'pkChrome', rects: out });
  }
  const chromeSoon = () => { if (!chromeT) chromeT = setTimeout(chrome, 60); };
  PK.chrome = chromeSoon;
  new MutationObserver(() => { if (PK.active) chromeSoon(); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  addEventListener('resize', () => { if (!PK.active) return; chromeSoon(); post({ op: 'pkFrame', frame: stageFrame(), insets: insets() }); });
  A.on('stage:resize', () => { if (PK.active) post({ op: 'pkFrame', frame: stageFrame(), insets: insets() }); });
  setInterval(() => { if (PK.active) chrome(); }, 1000);
})();
