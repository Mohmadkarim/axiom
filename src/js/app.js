/* Axiom boot: views, autosave, sample drawing, file drops, service worker */
'use strict';
(() => {
  const D = A.D, R = A.R, B = A.B, G = A.G, UI = A.UI;
  const S = A.settings;

  /* ---------- autosave ---------- */
  let saving = Promise.resolve();
  const save = async () => {
    const doc = D.doc;
    if (!doc) return;
    let thumb = null;
    try { thumb = R.thumbnail(doc).toDataURL('image/jpeg', 0.78); } catch (e) { /* tainted or unavailable */ }
    saving = saving.then(() => A.store.saveDoc(doc, thumb)).catch((e) => { console.error(e); A.toast('Could not save: storage may be full'); });
    return saving;
  };
  const autosave = A.debounce(save, 1200);
  A.on('doc:changed', (k) => { if (k !== 'view') autosave(); });
  A.on('view', A.debounce(() => { if (D.doc) autosave(); }, 1500));
  document.addEventListener('visibilitychange', () => { if (document.hidden && D.doc) autosave.flush(); });
  addEventListener('pagehide', () => { if (D.doc) autosave.flush(); });

  /* ---------- views ---------- */
  const gallery = () => A.$('#gallery-view'), canvasView = () => A.$('#canvas-view');
  async function showGallery() {
    A.closePopovers();
    if (D.doc) { autosave.cancel(); await save(); }
    A.IN.cancelAll();
    D.doc = null;
    canvasView().hidden = true;
    gallery().hidden = false;
    await UI.renderGallery();
  }
  async function openDoc(id) {
    const raw = await A.store.loadDoc(id);
    if (!raw) { A.toast('That drawing could not be found'); return showGallery(); }
    const doc = D.normalize(raw);
    D.doc = doc;
    D.resetHistory();
    A.emit('selection:clear');
    gallery().hidden = true;
    canvasView().hidden = false;
    canvasView().classList.remove('ui-hidden');
    R.resize();
    const v = doc.view;
    if (!v.tx && !v.ty) {
      const bb = D.allBB();
      if (bb) R.fitBB(bb); else { v.tx = R.w / 2; v.ty = R.h / 2; }
    }
    A.emit('doc:open');
    A.emit('view');
    UI.renderTools();
    UI.renderLayers();
    R.renderNow(true);
  }
  A.on('go:gallery', showGallery);
  A.on('open', openDoc);

  /* ---------- sample drawing (first launch) ---------- */
  function sampleDoc() {
    const doc = D.create({ name: 'Welcome · unit circle and sine', bg: D.papers.white, grid: 'graph' });
    doc.paper.grid.spacing = 40; doc.paper.grid.divisions = 5;
    const L = doc.layers[0]; L.name = 'Sketch';
    const ink = D.newLayer('Ink'); const hl = D.newLayer('Highlights');
    doc.layers = [hl, L, ink]; doc.activeLayerId = ink.id;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const stroke = (b, color, size, op, fn, n, opts = {}) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n; const [x, y] = fn(t);
        const p = opts.flat ? 1 : 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15));
        pts.push(x + rnd() * (opts.j ?? 0.6), y + rnd() * (opts.j ?? 0.6), B.widthMul(b, p, opts.tilt || 0, true));
      }
      return D.makeStroke(b, color, size, op, G.simplify(pts, 0.15, 0.03), opts.extra || {});
    };
    const U = 120; // one unit = 120 px
    // axes
    ink.items.push(stroke('fineliner', '#1a1e26', 1.8, 1, (t) => [-200 + t * 1180, 0], 60, { flat: true, j: 0.4 }));
    ink.items.push(stroke('fineliner', '#1a1e26', 1.8, 1, (t) => [0, 200 - t * 400], 30, { flat: true, j: 0.4 }));
    ink.items.push(stroke('fineliner', '#1a1e26', 1.8, 1, (t) => [968 + t * 12, -8 + t * 8], 4, { flat: true, j: 0 }));
    ink.items.push(stroke('fineliner', '#1a1e26', 1.8, 1, (t) => [968 + t * 12, 8 - t * 8], 4, { flat: true, j: 0 }));
    ink.items.push(stroke('fineliner', '#1a1e26', 1.8, 1, (t) => [-8 + t * 8, -188 - t * 12 + 0], 4, { flat: true, j: 0 }));
    ink.items.push(stroke('fineliner', '#1a1e26', 1.8, 1, (t) => [8 - t * 8, -188 - t * 12], 4, { flat: true, j: 0 }));
    // ticks at pi/2 multiples
    for (let k = 1; k <= 4; k++) { const x = (k * Math.PI / 2) * U; ink.items.push(stroke('fineliner', '#1a1e26', 1.5, 1, (t) => [x, -7 + t * 14], 3, { flat: true, j: 0 })); }
    // unit circle (pencil) centred on the origin
    L.items.push(stroke('pencil', '#4a5060', 2.4, 0.9, (t) => [Math.cos(t * Math.PI * 2) * U, Math.sin(t * Math.PI * 2) * U], 140, { j: 0.8 }));
    // radius at 60°
    const a = -Math.PI / 3;
    ink.items.push(stroke('pen', '#c0392b', 2.6, 1, (t) => [Math.cos(a) * U * t, Math.sin(a) * U * t], 30));
    ink.items.push(stroke('dotted', '#c0392b', 2.4, 1, (t) => [Math.cos(a) * U, Math.sin(a) * U * (1 - t)], 20, { flat: true, j: 0 }));
    ink.items.push(stroke('dotted', '#1f4fbf', 2.4, 1, (t) => [Math.cos(a) * U + t * ((Math.PI / 3) * U - Math.cos(a) * U), Math.sin(a) * U], 30, { flat: true, j: 0 }));
    // angle arc
    ink.items.push(stroke('pen', '#c0392b', 1.8, 1, (t) => [Math.cos(-t * Math.PI / 3) * 34, Math.sin(-t * Math.PI / 3) * 34], 20));
    // sine curve
    ink.items.push(stroke('pen', '#1f4fbf', 3, 1, (t) => [t * 2 * Math.PI * U, -Math.sin(t * 2 * Math.PI) * U], 220, { j: 0.5 }));
    // shaded area under the first hump (fill)
    const fillPts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60; fillPts.push(t * Math.PI * U, -Math.sin(t * Math.PI) * U, 1); }
    fillPts.push(Math.PI * U, 0, 1, 0, 0, 1);
    L.items.unshift(D.makeStroke('fill', '#9cc3f0', 1, 0.45, fillPts));
    // highlighter on the point (pi/3, sin)
    hl.items.push(stroke('highlighter', '#f2c94c', 22, 0.45, (t) => [(Math.PI / 3) * U - 30 + t * 60, Math.sin(a) * U], 10, { flat: true, j: 0.3 }));
    // brush-pen flourish under everything: "area = 2"
    ink.items.push(stroke('brushpen', '#1e8449', 6, 1, (t) => [200 + t * 150, 90 + Math.sin(t * Math.PI) * -8], 60));
    doc.view = { tx: 0, ty: 0, zoom: 1, rot: 0 };
    return doc;
  }

  /* ---------- boot ---------- */
  async function boot() {
    UI.applyTheme();
    if (matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => UI.applyTheme());
    R.init(A.$('#main'), A.$('#overlay'));
    A.IN.init(A.$('#overlay'));
    UI.mountStatus(A.$('#statusbar'));
    UI.mountTools(A.$('#tools'));
    UI.mountLayers(A.$('#layers'));
    UI.mountPrecision(A.$('#precision'));
    UI.mountSelection(A.$('#selmenu'), A.$('#selpopup'));
    UI.mountGallery(A.$('#gallery-view'));
    A.$('#restore-ui').innerHTML = A.icon('eye');
    A.$('#restore-ui').addEventListener('click', () => A.emit('cmd', 'toggleUI'));
    A.on('selmenu:show', () => {});
    A.on('eyedrop:end', () => {});

    // paste images / strokes
    document.addEventListener('paste', (e) => {
      if (!D.doc || canvasView().hidden) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); UI.importImageFile(f); return; } }
      if (A.clip) { e.preventDefault(); A.emit('cmd', 'paste'); }
    });
    // drag & drop files
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (/\.axiom$|json/i.test(f.name + f.type)) { try { await UI.importProjectText(await f.text()); } catch (er) { A.toast('That file is not an Axiom project'); } return; }
      if (!D.doc) return A.toast('Open a drawing first, then drop the file');
      if (f.type === 'application/pdf') UI.importPdf(f); else if (f.type.startsWith('image/')) UI.importImageFile(f);
    });

    const metas = await A.store.listMeta();
    if (!metas.length && !S.seenWelcome) {
      const doc = sampleDoc();
      await A.store.saveDoc(doc, null);
      S.seenWelcome = true; A.saveSettings();
      await openDoc(doc.id);
      await save();
      setTimeout(() => A.toast('Welcome to Axiom. Draw with Apple Pencil, and pinch with two fingers to move around.', 4200), 600);
    } else {
      await showGallery();
    }

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && window.top === window && !window.AXIOM_NO_SW) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
