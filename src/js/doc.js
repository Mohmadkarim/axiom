/* Axiom document model: layers, immutable items, snapshot history */
'use strict';
(() => {
  const G = A.G, B = A.B;
  const D = (A.D = {});

  D.papers = {
    white: '#ffffff', ivory: '#f8f5ec', mist: '#eef1f4', slate: '#2a2e36', night: '#15171c', blueprint: '#123a6b',
  };

  D.newLayer = (name) => ({ id: A.uid(), name: name || 'Layer', visible: true, locked: false, opacity: 1, items: [] });

  D.create = ({ name = 'Untitled', bg = D.papers.white, grid = 'dot' } = {}) => {
    const now = Date.now();
    const l = D.newLayer('Layer 1');
    return {
      id: A.uid(), name, created: now, updated: now, v: 1,
      layers: [l], activeLayerId: l.id, layerMode: 'manual', focusLayerId: null,
      view: { tx: 0, ty: 0, zoom: 1, rot: 0 },
      paper: { bg, grid: { type: grid, spacing: 24, divisions: 5, opacity: 1 } },
      precision: { grid: grid !== 'none', snap: false, snapMode: 'grid', connect: true, measure: false, units: 'mm', scale: 1, guide: false, guideType: 'line', recog: true },
      guides: {},
    };
  };

  /* normalise a loaded document (older/foreign files) */
  D.normalize = (doc) => {
    const base = D.create();
    doc.paper = Object.assign(base.paper, doc.paper || {});
    doc.paper.grid = Object.assign(base.paper.grid, (doc.paper && doc.paper.grid) || {});
    doc.precision = Object.assign(base.precision, doc.precision || {});
    doc.view = Object.assign(base.view, doc.view || {});
    doc.guides = doc.guides || {};
    doc.layerMode = doc.layerMode || 'manual';
    if (!Array.isArray(doc.layers) || !doc.layers.length) doc.layers = base.layers;
    for (const l of doc.layers) {
      l.items = (l.items || []).filter(Boolean).map((it) => {
        if (it.t === 'i' && !it.bb) it.bb = B.imageBB(it);
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
    if (it.t === 'i') {
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
  });
  const restore = (s) => {
    D.doc.layers = s.layers.map((l) => Object.assign({}, l, { items: l.items.slice() }));
    D.doc.activeLayerId = s.active;
  };
  D.resetHistory = () => { H.undo = []; H.redo = []; H.pending = null; A.emit('history'); };
  D.begin = () => { if (!H.pending) H.pending = snap(); };
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
