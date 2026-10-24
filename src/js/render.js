/* Axiom renderer: camera, scene compositing, grid, overlay painters, export rendering */
'use strict';
(() => {
  const G = A.G, B = A.B, D = A.D, M = A.M;
  const R = (A.R = {});
  const S3 = Math.sqrt(3) / 2;

  R.ZMIN = 0.02; R.ZMAX = 64;
  R.accent = () => R._acc || (R._acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6fdb');
  R.themeChanged = () => { R._acc = null; R.cacheValid = false; R.render(); };
  R.painters = [];
  R.sel = new Set();            // selected item ids
  R.selPreview = null;          // world matrix applied to selected items while transforming
  R.fadeOthers = false;

  R.init = (main, overlay) => {
    R.main = main; R.overlay = overlay;
    R.mctx = main.getContext('2d');
    R.octx = overlay.getContext('2d');
    R.scratch = document.createElement('canvas');
    R.sctx = R.scratch.getContext('2d');
    R.cache = document.createElement('canvas');
    R.cctx = R.cache.getContext('2d');
    R.resize();
    addEventListener('resize', () => { R.resize(); R.render(); });
  };
  R.resize = () => {
    A.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = R.main.parentElement.getBoundingClientRect();
    R.w = Math.max(1, r.width); R.h = Math.max(1, r.height);
    for (const c of [R.main, R.overlay, R.scratch, R.cache]) {
      c.width = Math.round(R.w * A.dpr); c.height = Math.round(R.h * A.dpr);
    }
    R.cacheValid = false;
    const cvv = document.getElementById('canvas-view');
    if (cvv) cvv.classList.toggle('narrow', R.w < 720);
  };

  /* ---------- dark canvas (display only) ---------- */
  R.DARK_PAPER = '#1c1f25';
  R.isDarkTheme = () => {
    const t = A.settings.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  };
  R.darkActive = (doc = D.doc) => !!doc && A.settings.darkCanvas !== false && R.isDarkTheme() && A.C.luminance(doc.paper.bg) > 0.5;
  R.displayBg = (doc = D.doc) => (R.darkActive(doc) ? R.DARK_PAPER : doc.paper.bg);

  /* ---------- camera ---------- */
  R.view = () => D.doc.view;
  R.matrix = (v = R.view()) => {
    const c = Math.cos(v.rot) * v.zoom, s = Math.sin(v.rot) * v.zoom;
    return [c, s, -s, c, v.tx, v.ty];
  };
  R.dmatrix = (v) => M.mul(M.scale(A.dpr), R.matrix(v));
  R.toWorld = (sx, sy) => M.apply(M.inv(R.matrix()), sx, sy);
  R.toScreen = (wx, wy) => M.apply(R.matrix(), wx, wy);
  R.setView = (v) => {
    const doc = D.doc;
    doc.view.zoom = A.clamp(v.zoom ?? doc.view.zoom, R.ZMIN, R.ZMAX);
    if (v.rot != null) doc.view.rot = v.rot;
    if (v.tx != null) doc.view.tx = v.tx;
    if (v.ty != null) doc.view.ty = v.ty;
    A.emit('view');
    R.render();
  };
  /* zoom/rotate around a screen point */
  R.zoomAt = (sx, sy, factor, drot = 0) => {
    const v = R.view();
    const [wx, wy] = R.toWorld(sx, sy);
    const zoom = A.clamp(v.zoom * factor, R.ZMIN, R.ZMAX);
    const rot = v.rot + drot;
    const c = Math.cos(rot) * zoom, s = Math.sin(rot) * zoom;
    R.setView({ zoom, rot, tx: sx - (c * wx - s * wy), ty: sy - (s * wx + c * wy) });
  };
  R.fitBB = (bb, pad = 60, keepRot = false) => {
    if (!bb) return R.setView({ zoom: 1, rot: 0, tx: R.w / 2, ty: R.h / 2 });
    const bw = Math.max(bb[2] - bb[0], 1), bh = Math.max(bb[3] - bb[1], 1);
    const zoom = A.clamp(Math.min((R.w - pad * 2) / bw, (R.h - pad * 2 - 60) / bh), R.ZMIN, 4);
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    R.setView({ zoom, rot: keepRot ? R.view().rot : 0, tx: R.w / 2 - cx * zoom, ty: R.h / 2 + 20 - cy * zoom });
  };
  R.worldBB = (m, w, h) => {
    const inv = M.inv(m);
    const cs = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => M.apply(inv, x, y));
    const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  R.visibleBB = () => R.worldBB(R.matrix(), R.w, R.h);

  /* ---------- grid ---------- */
  R.gridColor = (bg) => (A.C.luminance(bg) < 0.45 ? [255, 255, 255] : [40, 52, 72]);
  const drawFamily = (ctx, ang, sp, bb, maxLines = 1500) => {
    const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const cs = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
    let k0 = Infinity, k1 = -Infinity;
    for (const [x, y] of cs) { const k = x * nx + y * ny; k0 = Math.min(k0, k); k1 = Math.max(k1, k); }
    const a = Math.ceil(k0 / sp), b = Math.floor(k1 / sp);
    if (b - a > maxLines) return;
    const big = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) + 10;
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const t0 = cx * dx + cy * dy;
    for (let k = a; k <= b; k++) {
      const o = k * sp;
      const px = nx * o + dx * t0, py = ny * o + dy * t0;
      ctx.moveTo(px - dx * big, py - dy * big);
      ctx.lineTo(px + dx * big, py + dy * big);
    }
  };
  R.drawGrid = (ctx, m, w, h, paper, opts = {}) => {
    const g = paper.grid;
    if (!g || g.type === 'none') return;
    const k = Math.hypot(m[0], m[1]); // world → bitmap scale
    const dpr = opts.dpr || A.dpr;
    const bb = R.worldBB(m, w, h);
    const [r, gg, b] = R.gridColor(paper.bg);
    const op = g.opacity ?? 1;
    const div = Math.max(1, g.divisions | 0);
    let unit = g.spacing;
    const cssK = k / dpr;
    while (unit * cssK < 11) unit *= div > 1 ? div : 4;
    ctx.save();
    ctx.setTransform(...m);
    const hair = dpr / k;
    if (g.type === 'dot') {
      const rad = 1.15 * hair * (unit * cssK > 40 ? 1.3 : 1);
      ctx.fillStyle = `rgba(${r},${gg},${b},${0.42 * op})`;
      const x0 = Math.floor(bb[0] / unit), x1 = Math.ceil(bb[2] / unit);
      const y0 = Math.floor(bb[1] / unit), y1 = Math.ceil(bb[3] / unit);
      if ((x1 - x0) * (y1 - y0) < 60000) {
        ctx.beginPath();
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
          const x = i * unit, y = j * unit;
          ctx.rect(x - rad, y - rad, rad * 2, rad * 2);
        }
        ctx.fill();
      }
    } else if (g.type === 'graph' || g.type === 'lined' || g.type === 'eng') {
      const horizOnly = g.type === 'lined';
      const minor = unit / div;
      ctx.lineWidth = hair;
      if (div > 1 && minor * cssK >= 7) {
        ctx.strokeStyle = `rgba(${r},${gg},${b},${0.09 * op})`;
        ctx.beginPath();
        drawFamily(ctx, 0, minor, bb, 3000);
        if (!horizOnly) drawFamily(ctx, Math.PI / 2, minor, bb, 3000);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${r},${gg},${b},${0.2 * op})`;
      ctx.beginPath();
      drawFamily(ctx, 0, unit, bb);
      if (!horizOnly) drawFamily(ctx, Math.PI / 2, unit, bb);
      ctx.stroke();
    } else if (g.type === 'iso' || g.type === 'tri') {
      const sp = unit * S3;
      const angs = g.type === 'iso' ? [Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6] : [0, Math.PI / 3, (2 * Math.PI) / 3];
      ctx.lineWidth = hair;
      ctx.strokeStyle = `rgba(${r},${gg},${b},${0.16 * op})`;
      ctx.beginPath();
      for (const a of angs) drawFamily(ctx, a, sp, bb);
      ctx.stroke();
    }
    // origin axes hint for graph paper (useful for plotting)
    if (g.type === 'graph' && opts.axes) {
      ctx.strokeStyle = `rgba(${r},${gg},${b},${0.35 * op})`;
      ctx.lineWidth = hair * 1.2;
      ctx.beginPath();
      ctx.moveTo(bb[0], 0); ctx.lineTo(bb[2], 0); ctx.moveTo(0, bb[1]); ctx.lineTo(0, bb[3]);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------- scene ---------- */
  const layerHasMask = (l) => l.items.some((it) => it.t === 's' && B.catalog[it.b] && B.catalog[it.b].mask);

  /* opts: {m, w, h, doc, bg (null = transparent), grid, sel:Set, selPreview, fade, scratch, onImage, dpr, onlyIds:Set} */
  R.drawScene = (ctx, o) => {
    const doc = o.doc;
    const prevDark = B.dark;
    B.dark = !!o.dark;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, o.w, o.h);
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, o.w, o.h); }
    if (o.grid) R.drawGrid(ctx, o.m, o.w, o.h, o.bg ? Object.assign({}, doc.paper, { bg: o.bg }) : doc.paper, { dpr: o.dpr, axes: false });
    const vbb = R.worldBB(o.m, o.w, o.h);
    const sel = o.sel && o.sel.size ? o.sel : null;
    const fade = sel && o.fade ? 0.28 : 1;
    const focus = doc.focusLayerId;
    const selected = [];
    for (const l of doc.layers) {
      if (!l.visible) continue;
      let alpha = l.opacity ?? 1;
      if (focus && focus !== l.id) alpha *= 0.22;
      const needsOff = alpha < 0.999 || layerHasMask(l);
      let tctx = ctx;
      if (needsOff) {
        tctx = o.sctx;
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = 'source-over';
        tctx.clearRect(0, 0, o.w, o.h);
      }
      tctx.setTransform(...o.m);
      for (const it of l.items) {
        if (o.onlyIds && !o.onlyIds.has(it.id)) continue;
        if (sel && sel.has(it.id)) { selected.push(it); continue; }
        if (!G.bbHit(it.bb, vbb)) continue;
        if (it.t === 'i') B.renderImage(tctx, it, fade, o.onImage);
        else B.render(tctx, it, fade);
      }
      if (needsOff) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.drawImage(o.scratch, 0, 0);
        ctx.restore();
      }
    }
    if (selected.length) {
      ctx.setTransform(...(o.selPreview ? M.mul(o.m, o.selPreview) : o.m));
      for (const it of selected) {
        if (it.t === 'i') B.renderImage(ctx, it, 1, o.onImage);
        else B.render(ctx, it, 1);
      }
    }
    ctx.restore();
    B.dark = prevDark;
  };

  let mainQueued = false, overlayQueued = false;
  R.lastMs = 0;
  R.gesturing = false;
  let lastFull = 0;
  R.render = () => {
    if (mainQueued) return;
    mainQueued = true;
    requestAnimationFrame(() => { mainQueued = false; R.renderNow(); });
  };
  R.renderNow = (force = false) => {
    if (!D.doc || !R.main) return;
    const t0 = performance.now();
    const m = R.dmatrix(D.doc.view);
    const W = R.main.width, H = R.main.height;
    // heavy scene during gestures: reuse the cached bitmap, re-render periodically
    if (!force && R.gesturing && R.lastMs > 14 && R.cacheValid && t0 - lastFull < 220) {
      const ctx = R.mctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = R.displayBg();
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(...M.mul(m, M.inv(R.cacheM)));
      ctx.drawImage(R.cache, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      R.renderOverlay();
      return;
    }
    R.drawScene(R.mctx, {
      m, w: W, h: H, doc: D.doc, bg: R.displayBg(), dark: R.darkActive(), grid: D.doc.precision.grid,
      sel: R.sel, selPreview: R.selPreview, fade: R.fadeOthers && A.settings.highlightSelection,
      scratch: R.scratch, sctx: R.sctx, onImage: R.render, dpr: A.dpr,
    });
    lastFull = performance.now();
    R.lastMs = lastFull - t0;
    if (R.lastMs > 10) {
      R.cctx.setTransform(1, 0, 0, 1, 0, 0);
      R.cctx.clearRect(0, 0, W, H);
      R.cctx.drawImage(R.main, 0, 0);
      R.cacheM = m; R.cacheValid = true;
    } else R.cacheValid = false;
    R.renderOverlay();
  };

  /* draw a freshly committed stroke without a full re-render when it is safe */
  R.appendItem = (item, layer) => {
    const doc = D.doc;
    const L = doc.layers;
    const idx = L.indexOf(layer);
    const above = L.slice(idx + 1).some((l) => l.visible && l.items.length);
    const c = B.catalog[item.b] || {};
    if (above || !layer.visible || (layer.opacity ?? 1) < 0.999 || layerHasMask(layer) || c.mask || R.sel.size || doc.focusLayerId || mainQueued) {
      return R.render();
    }
    const ctx = R.mctx;
    ctx.save();
    ctx.setTransform(...R.dmatrix(doc.view));
    const prevDark = B.dark;
    B.dark = R.darkActive();
    if (item.t === 'i') B.renderImage(ctx, item, 1, R.render); else B.render(ctx, item, 1);
    B.dark = prevDark;
    ctx.restore();
    R.cacheValid = false;
  };

  R.renderOverlay = () => {
    if (overlayQueued) return;
    overlayQueued = true;
    requestAnimationFrame(() => {
      overlayQueued = false;
      const ctx = R.octx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, R.overlay.width, R.overlay.height);
      if (!D.doc) return;
      const prevDark = B.dark;
      B.dark = R.darkActive();
      for (const p of R.painters) {
        ctx.save();
        ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
        try { p(ctx); } catch (e) { console.error(e); }
        ctx.restore();
      }
      B.dark = prevDark;
    });
  };

  /* ---------- offscreen rendering for export / thumbnails ---------- */
  R.renderRegion = (doc, bb, scale, { bg = true, grid = false, onlyIds = null, maxPx = 8192 } = {}) => {
    const bw = Math.max(1, bb[2] - bb[0]), bh = Math.max(1, bb[3] - bb[1]);
    let s = scale;
    const lim = Math.min(maxPx, 16384);
    if (bw * s > lim) s = lim / bw;
    if (bh * s > lim) s = lim / bh;
    if (bw * s * bh * s > 16.7e6) s = Math.sqrt(16.7e6 / (bw * bh));
    const W = Math.max(1, Math.round(bw * s)), H = Math.max(1, Math.round(bh * s));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
    const m = [s, 0, 0, s, -bb[0] * s, -bb[1] * s];
    R.drawScene(c.getContext('2d'), {
      m, w: W, h: H, doc, bg: bg ? doc.paper.bg : null, grid, scratch: sc, sctx: sc.getContext('2d'), dpr: Math.max(1, s), onlyIds,
    });
    return c;
  };
  R.thumbnail = (doc, W = 360, H = 270) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
    const bb = D.allBB(doc);
    let m;
    if (bb) {
      const pad = 18, bw = Math.max(bb[2] - bb[0], 40), bh = Math.max(bb[3] - bb[1], 30);
      const s = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh, 2);
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
      m = [s, 0, 0, s, W / 2 - cx * s, H / 2 - cy * s];
    } else m = [0.6, 0, 0, 0.6, W / 2, H / 2];
    R.drawScene(c.getContext('2d'), { m, w: W, h: H, doc, bg: doc.paper.bg, grid: doc.precision.grid, scratch: sc, sctx: sc.getContext('2d'), dpr: 1 });
    return c;
  };
})();
