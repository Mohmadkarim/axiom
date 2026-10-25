/* Axiom document model: layers, immutable items, snapshot history */
'use strict';
(() => {
  const G = A.G, B = A.B;
  const D = (A.D = {});

  D.papers = {
    white: '#ffffff', ivory: '#f8f5ec', mist: '#eef1f4', slate: '#2a2e36', night: '#15171c', blueprint: '#123a6b',
  };

  D.newLayer = (name) => ({ id: A.uid(), name: name || 'Layer', visible: true, locked: false, opacity: 1, items: [] });

  /* page formats (world units are CSS px at 96 dpi, so 1 mm = 3.7795 units) */
  D.MM = 96 / 25.4;
  D.formats = {
    a4: { name: 'A4', w: 210, h: 297 }, letter: { name: 'US Letter', w: 215.9, h: 279.4 }, a5: { name: 'A5', w: 148, h: 210 },
    a3: { name: 'A3', w: 297, h: 420 }, legal: { name: 'US Legal', w: 215.9, h: 355.6 }, square: { name: 'Square', w: 210, h: 210 },
    wide: { name: '16:9 Slide', w: 338.7, h: 190.5 }, card: { name: 'Index card', w: 127, h: 76.2 },
  };
  D.formatSize = (fmt, orient = 'portrait') => {
    const f = D.formats[fmt] || D.formats.a4;
    const w = f.w * D.MM, h = f.h * D.MM;
    return orient === 'landscape' ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
  };
  D.PAGE_GAP = 28;

  D.create = ({ name = 'Untitled', bg = D.papers.white, grid = 'dot', kind = 'canvas', page = null } = {}) => {
    const now = Date.now();
    const l = D.newLayer('Layer 1');
    const doc = {
      id: A.uid(), name, created: now, updated: now, v: 1, kind,
      layers: [l], activeLayerId: l.id, layerMode: 'manual', focusLayerId: null,
      view: { tx: 0, ty: 0, zoom: 1, rot: 0 },
      paper: { bg, grid: { type: grid, spacing: 24, divisions: 5, opacity: 1 } },
      precision: { grid: grid !== 'none', snap: false, snapMode: 'grid', connect: true, measure: false, units: 'mm', scale: 1, guide: false, guideType: 'line', recog: true },
      guides: {},
      artboards: [],
    };
    if (kind === 'notebook') {
      doc.page = Object.assign({ size: 'a4', orient: 'portrait', template: 'lined', color: bg, scroll: 'vertical' }, page || {});
      doc.paper.bg = doc.page.color;
      doc.paper.grid.type = 'none';
      doc.precision.grid = false;
      doc.precision.recog = false;
      doc.pages = [{ id: A.uid() }];
    }
    return doc;
  };

  /* ---------- notebook pages ---------- */
  D.isNotebook = (doc = D.doc) => !!doc && doc.kind === 'notebook';
  D.pageSize = (doc = D.doc) => D.formatSize(doc.page.size, doc.page.orient);
  D.pageRect = (doc, i) => {
    const [w, h] = D.pageSize(doc);
    return doc.page.scroll === 'horizontal' ? [i * (w + D.PAGE_GAP), 0, i * (w + D.PAGE_GAP) + w, h] : [0, i * (h + D.PAGE_GAP), w, i * (h + D.PAGE_GAP) + h];
  };
  D.pageRects = (doc = D.doc) => doc.pages.map((p, i) => D.pageRect(doc, i));
  D.pagesBB = (doc = D.doc) => { const r = D.pageRects(doc); return [r[0][0], r[0][1], r[r.length - 1][2], r[r.length - 1][3]]; };
  D.pageAt = (doc, x, y) => {
    const [w, h] = D.pageSize(doc);
    const horiz = doc.page.scroll === 'horizontal';
    const i = Math.floor((horiz ? x : y) / ((horiz ? w : h) + D.PAGE_GAP));
    return A.clamp(i, 0, doc.pages.length - 1);
  };
  D.pageTemplate = (doc, i) => (doc.pages[i] && doc.pages[i].template) || doc.page.template;
  D.pageColor = (doc, i) => (doc.pages[i] && doc.pages[i].color) || doc.page.color;
  const itemPage = (doc, it) => D.pageAt(doc, (it.bb[0] + it.bb[2]) / 2, (it.bb[1] + it.bb[3]) / 2);
  const shiftItem = (it, dx, dy) => D.transformItem(it, A.M.translate(dx, dy), false);
  /* move every item on page `from` by whole page steps; used by insert, delete and reorder */
  const remapPages = (doc, fn) => {
    const [w, h] = D.pageSize(doc);
    const horiz = doc.page.scroll === 'horizontal';
    const step = (horiz ? w : h) + D.PAGE_GAP;
    for (const l of doc.layers) {
      const out = [];
      for (const it of l.items) {
        const p = itemPage(doc, it), q = fn(p);
        if (q == null) continue;
        out.push(q === p ? it : shiftItem(it, horiz ? (q - p) * step : 0, horiz ? 0 : (q - p) * step));
      }
      l.items = out;
    }
  };
  D.insertPage = (at, props = {}) => {
    const doc = D.doc;
    D.begin();
    remapPages(doc, (p) => (p >= at ? p + 1 : p));
    doc.pages.splice(at, 0, Object.assign({ id: A.uid() }, props));
    D.commit('all');
    A.emit('pages');
  };
  D.deletePage = (i) => {
    const doc = D.doc;
    D.begin();
    if (doc.pages.length === 1) { for (const l of doc.layers) l.items = []; }
    else { remapPages(doc, (p) => (p === i ? null : p > i ? p - 1 : p)); doc.pages.splice(i, 1); }
    D.commit('all');
    A.emit('pages');
  };
  D.duplicatePage = (i) => {
    const doc = D.doc;
    D.begin();
    remapPages(doc, (p) => (p > i ? p + 1 : p));
    const [w, h] = D.pageSize(doc);
    const horiz = doc.page.scroll === 'horizontal';
    const step = (horiz ? w : h) + D.PAGE_GAP;
    for (const l of doc.layers) {
      const copies = l.items.filter((it) => itemPage(doc, it) === i).map((it) => shiftItem(it, horiz ? step : 0, horiz ? 0 : step));
      l.items = l.items.concat(copies);
    }
    doc.pages.splice(i + 1, 0, Object.assign({}, doc.pages[i], { id: A.uid() }));
    D.commit('all');
    A.emit('pages');
  };
  D.movePage = (from, to) => {
    const doc = D.doc;
    if (from === to) return;
    D.begin();
    remapPages(doc, (p) => {
      if (p === from) return to;
      if (from < to && p > from && p <= to) return p - 1;
      if (from > to && p >= to && p < from) return p + 1;
      return p;
    });
    const [pg] = doc.pages.splice(from, 1);
    doc.pages.splice(to, 0, pg);
    D.commit('all');
    A.emit('pages');
  };
  D.setPage = (i, props) => { D.begin(); Object.assign(D.doc.pages[i], props); D.commit('all'); A.emit('pages'); };
  /* keep one blank page at the end so writing never runs out of paper */
  D.ensureTrailingPage = () => {
    const doc = D.doc;
    if (!D.isNotebook(doc)) return;
    const last = doc.pages.length - 1;
    const used = doc.layers.some((l) => l.items.some((it) => itemPage(doc, it) === last));
    if (used) {
      doc.pages.push({ id: A.uid(), template: doc.pages[last].template, color: doc.pages[last].color });
      A.emit('pages');
    }
  };

  /* ---------- artboards (fixed-size frames on an infinite canvas) ---------- */
  D.addArtboard = (fmt = 'a4', orient = 'portrait', at = null) => {
    const doc = D.doc;
    const [w, h] = D.formatSize(fmt, orient);
    let x, y;
    if (at) { x = at[0] - w / 2; y = at[1] - h / 2; }
    else {
      const bbs = (doc.artboards || []).map((a) => [a.x, a.y, a.x + a.w, a.y + a.h]);
      const last = bbs[bbs.length - 1];
      x = last ? last[2] + 60 : -w / 2; y = last ? last[1] : -h / 2;
    }
    D.begin();
    const ab = { id: A.uid(), name: (D.formats[fmt] || {}).name + ' ' + ((doc.artboards || []).length + 1), fmt, orient, x, y, w, h };
    doc.artboards = (doc.artboards || []).concat([ab]);
    D.commit('all');
    A.emit('artboards');
    return ab;
  };
  D.updateArtboard = (id, props, record = true) => {
    if (record) D.begin();
    D.doc.artboards = D.doc.artboards.map((a) => (a.id === id ? Object.assign({}, a, props) : a));
    if (record) D.commit('all'); else D.changed('all');
    A.emit('artboards');
  };
  D.deleteArtboard = (id) => { D.begin(); D.doc.artboards = D.doc.artboards.filter((a) => a.id !== id); D.commit('all'); A.emit('artboards'); };

  /* normalise a loaded document (older/foreign files) */
  D.normalize = (doc) => {
    const base = D.create();
    doc.paper = Object.assign(base.paper, doc.paper || {});
    doc.paper.grid = Object.assign(base.paper.grid, (doc.paper && doc.paper.grid) || {});
    doc.precision = Object.assign(base.precision, doc.precision || {});
    doc.view = Object.assign(base.view, doc.view || {});
    doc.guides = doc.guides || {};
    doc.layerMode = doc.layerMode || 'manual';
    doc.kind = doc.kind === 'notebook' ? 'notebook' : 'canvas';
    doc.artboards = Array.isArray(doc.artboards) ? doc.artboards : [];
    if (doc.kind === 'notebook') {
      doc.page = Object.assign({ size: 'a4', orient: 'portrait', template: 'lined', color: doc.paper.bg, scroll: 'vertical' }, doc.page || {});
      if (!Array.isArray(doc.pages) || !doc.pages.length) doc.pages = [{ id: A.uid() }];
    }
    if (!Array.isArray(doc.layers) || !doc.layers.length) doc.layers = base.layers;
    for (const l of doc.layers) {
      l.items = (l.items || []).filter(Boolean).map((it) => {
        if ((it.t === 'i' || it.t === 'x') && !it.bb) it.bb = B.imageBB(it);
        if (it.t === 's' && !it.bb) it.bb = D.strokeBB(it);
        return it;
      });
    }
    if (!doc.layers.find((l) => l.id === doc.activeLayerId)) doc.activeLayerId = doc.layers[doc.layers.length - 1].id;
    return doc;
  };

  D.strokeBB = (it) => {
    const c = B.catalog[it.b] || B.catalog.pen;
    const mm = G.maxM(it.pts);
    let pad = c.wire ? 4 : (it.w * mm) / 2 + 1;
    if (c.soft) pad += it.w;
    return G.bbox(it.pts, pad);
  };

  D.makeStroke = (b, color, size, opacity, pts, extra = {}) => {
    const it = Object.assign({ id: A.uid(), t: 's', b, c: color, w: size, o: opacity, pts }, extra);
    it.mm = G.maxM(pts);
    it.bb = D.strokeBB(it);
    return it;
  };
  D.withPts = (it, pts, extra = {}) => {
    const n = Object.assign({}, it, { id: A.uid(), pts }, extra);
    n.mm = G.maxM(pts);
    n.bb = D.strokeBB(n);
    return n;
  };
  D.transformItem = (it, M, scaleWidth = true) => {
    if (it.t === 'i' || it.t === 'x') {
      const n = Object.assign({}, it, { id: A.uid(), m: A.M.mul(M, it.m) });
      n.bb = B.imageBB(n);
      return n;
    }
    const p = it.pts, out = new Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const [x, y] = A.M.apply(M, p[i], p[i + 1]);
      out[i] = x; out[i + 1] = y; out[i + 2] = p[i + 2];
    }
    const k = Math.sqrt(Math.abs(A.M.det(M)));
    const c = B.catalog[it.b] || {};
    const w = scaleWidth && !c.wire ? Math.max(0.05, it.w * k) : it.w;
    return D.withPts(it, out, { w });
  };

  /* ---------- access ---------- */
  D.doc = null;
  D.layer = (id) => D.doc.layers.find((l) => l.id === id);
  D.active = () => D.layer(D.doc.activeLayerId) || D.doc.layers[D.doc.layers.length - 1];
  D.find = (id) => {
    for (const l of D.doc.layers) {
      const i = l.items.findIndex((it) => it.id === id);
      if (i >= 0) return { layer: l, index: i, item: l.items[i] };
    }
    return null;
  };

  /* ---------- history ---------- */
  const H = { undo: [], redo: [], pending: null, limit: 200 };
  D.history = H;
  const snap = () => ({
    layers: D.doc.layers.map((l) => Object.assign({}, l, { items: l.items.slice() })),
    active: D.doc.activeLayerId,
    pages: D.doc.pages ? D.doc.pages.map((p) => Object.assign({}, p)) : null,
    artboards: (D.doc.artboards || []).slice(),
  });
  const restore = (s) => {
    const ink = D.doc.layers.find((l) => l.pk); // the PencilKit ink copy follows PencilKit's own undo, not the page's
    D.doc.layers = s.layers.map((l) => (l.pk && ink ? ink : Object.assign({}, l, { items: l.items.slice() })));
    D.doc.activeLayerId = s.active;
    if (s.pages) { D.doc.pages = s.pages.map((p) => Object.assign({}, p)); A.emit('pages'); }
    if (s.artboards) { D.doc.artboards = s.artboards.slice(); A.emit('artboards'); }
  };
  D.resetHistory = () => { H.undo = []; H.redo = []; H.pending = null; A.emit('history'); };
  D.begin = () => { if (!H.pending) H.pending = snap(); };
  D.hasPending = () => !!H.pending;
  D.commit = (kind = 'items') => {
    if (!H.pending) return;
    H.undo.push(H.pending);
    if (H.undo.length > H.limit) H.undo.shift();
    H.pending = null;
    H.redo = [];
    D.changed(kind);
    A.emit('history');
  };
  D.cancel = () => { if (H.pending) { restore(H.pending); H.pending = null; D.changed('all'); } };
  D.undo = () => {
    if (H.pending) D.commit();
    const s = H.undo.pop();
    if (!s) return false;
    H.redo.push(snap());
    restore(s);
    A.emit('selection:clear');
    D.changed('all');
    A.emit('history');
    return true;
  };
  D.redo = () => {
    const s = H.redo.pop();
    if (!s) return false;
    H.undo.push(snap());
    restore(s);
    A.emit('selection:clear');
    D.changed('all');
    A.emit('history');
    return true;
  };

  D.changed = (kind = 'items') => {
    if (!D.doc) return;
    D.doc.updated = Date.now();
    A.emit('doc:changed', kind);
  };

  /* ---------- item ops (call inside begin/commit) ---------- */
  D.targetLayerFor = (brush) => {
    const doc = D.doc;
    if (doc.layerMode !== 'auto' || !brush) return D.active();
    const c = B.catalog[brush];
    const group = c.group || brush;
    const name = { pencil: 'Pencil', ink: 'Ink', marker: 'Marker', airbrush: 'Airbrush', fill: 'Fill' }[group] || c.name;
    let l = doc.layers.find((x) => x.auto === group);
    if (!l) {
      l = D.newLayer(name);
      l.auto = group;
      doc.layers.push(l);
      A.emit('layers');
    }
    doc.activeLayerId = l.id;
    return l;
  };
  D.addItems = (items, layer) => {
    layer = layer || D.active();
    layer.items = layer.items.concat(items);
    return layer;
  };
  D.removeIds = (ids) => {
    const set = ids instanceof Set ? ids : new Set(ids);
    for (const l of D.doc.layers) if (l.items.some((it) => set.has(it.id))) l.items = l.items.filter((it) => !set.has(it.id));
  };
  /* replace each id with zero or more items, preserving z-order */
  D.replace = (map) => {
    for (const l of D.doc.layers) {
      if (!l.items.some((it) => map.has(it.id))) continue;
      const out = [];
      for (const it of l.items) { if (map.has(it.id)) out.push(...map.get(it.id)); else out.push(it); }
      l.items = out;
    }
  };

  /* ---------- layer ops ---------- */
  D.addLayer = (above = true) => {
    D.begin();
    const doc = D.doc, idx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
    const l = D.newLayer('Layer ' + (doc.layers.length + 1));
    doc.layers.splice(above ? idx + 1 : idx, 0, l);
    doc.activeLayerId = l.id;
    doc.layerMode = 'manual';
    D.commit('layers');
    A.emit('layers');
    return l;
  };
  D.deleteLayer = (id) => {
    D.begin();
    const doc = D.doc;
    const i = doc.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    doc.layers.splice(i, 1);
    if (!doc.layers.length) doc.layers.push(D.newLayer('Layer 1'));
    if (doc.activeLayerId === id) doc.activeLayerId = doc.layers[Math.max(0, i - 1)].id;
    if (doc.focusLayerId === id) doc.focusLayerId = null;
    D.commit('layers');
    A.emit('layers');
  };
  D.duplicateLayer = (id) => {
    D.begin();
    const doc = D.doc, i = doc.layers.findIndex((l) => l.id === id), src = doc.layers[i];
    const l = Object.assign({}, src, { id: A.uid(), name: src.name + ' copy', auto: undefined, items: src.items.map((it) => Object.assign({}, it, { id: A.uid() })) });
    doc.layers.splice(i + 1, 0, l);
    doc.activeLayerId = l.id;
    D.commit('layers');
    A.emit('layers');
  };
  D.mergeDown = (id) => {
    const doc = D.doc, i = doc.layers.findIndex((l) => l.id === id);
    if (i <= 0) return A.toast('No layer below to merge into');
    D.begin();
    const top = doc.layers[i], below = doc.layers[i - 1];
    // bake layer opacity into items
    const items = top.items.map((it) => (top.opacity < 1 ? Object.assign({}, it, { o: (it.o ?? 1) * top.opacity }) : it));
    below.items = below.items.concat(items);
    doc.layers.splice(i, 1);
    doc.activeLayerId = below.id;
    D.commit('layers');
    A.emit('layers');
  };
  D.moveLayer = (from, to) => {
    if (from === to) return;
    D.begin();
    const L = D.doc.layers;
    const [l] = L.splice(from, 1);
    L.splice(to, 0, l);
    D.doc.layerMode = 'manual';
    D.commit('layers');
    A.emit('layers');
  };
  D.setLayer = (id, props, record = true) => {
    if (record) D.begin();
    const l = D.layer(id);
    Object.assign(l, props);
    if (record) D.commit('layers'); else D.changed('layers');
    A.emit('layers');
  };
  D.clearLayer = (id) => { D.begin(); D.layer(id).items = []; D.commit('layers'); A.emit('layers'); };

  D.allBB = (doc = D.doc, onlyVisible = true) => {
    let bb = null;
    for (const l of doc.layers) {
      if (onlyVisible && !l.visible) continue;
      for (const it of l.items) { if (B.catalog[it.b] && B.catalog[it.b].mask) continue; bb = G.bbUnion(bb, it.bb); }
    }
    return bb;
  };
})();
