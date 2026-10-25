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

  /* undo, redo, restores and page edits replace the whole scene: redraw right away */
  A.on('doc:changed', (k) => { if (k === 'all' && D.doc) { R.cacheValid = false; R.render(); } });
  A.on('history', () => { if (D.doc) R.renderOverlay(); });
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
    const changed = Math.abs((R.w || 0) - r.width) > 1 || Math.abs((R.h || 0) - r.height) > 1;
    R.w = Math.max(1, r.width); R.h = Math.max(1, r.height);
    if (changed) setTimeout(() => A.emit('stage:resize'), 0);
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
    if (R.pk && A.PK) { A.PK.setView(doc.view); A.emit('view'); R.renderOverlay(); return; }
    if (D.isNotebook(doc)) R.constrainNotebook();
    A.emit('view');
    R.render();
  };
  /* notebooks scroll like paper: no rotation, zoom between "whole page" and 6x, edges stay in view */
  R.fitPageZoom = () => {
    const [pw, ph] = D.pageSize();
    const horiz = D.doc.page.scroll === 'horizontal';
    const free = R.w - (R.nbInsetL || 0);
    return horiz ? Math.min((R.h - 130) / ph, (free - 170) / pw) : Math.min((free - (free > 900 ? 190 : 120)) / pw, 1.8);
  };
  R.constrainNotebook = () => {
    if (R.pk) return;
    const v = D.doc.view;
    const fit = R.fitPageZoom();
    if (v.rot) {
      // drop rotation but keep the screen centre fixed
      const [cx, cy] = R.toWorld(R.w / 2, R.h / 2);
      v.rot = 0; v.tx = R.w / 2 - cx * v.zoom; v.ty = R.h / 2 - cy * v.zoom;
    }
    const z = A.clamp(v.zoom, fit * 0.3, fit * 6);
    if (z !== v.zoom) { const [cx, cy] = R.toWorld(R.w / 2, R.h / 2); v.zoom = z; v.tx = R.w / 2 - cx * z; v.ty = R.h / 2 - cy * z; }
    const bb = D.pagesBB();
    const bw = (bb[2] - bb[0]) * v.zoom, bh = (bb[3] - bb[1]) * v.zoom;
    const top = R.notebookTop || 70, bot = 90;
    const L = R.nbInsetL || 0, Rr = 66;
    const horiz = D.doc.page.scroll === 'horizontal';
    // centred on the screen like Notability; only nudged when the page would run under the side chrome
    if (!horiz && bw <= R.w - L - Rr - 24) {
      let x = (R.w - bw) / 2;
      if (x < L + 12) x = L + 12;
      if (x + bw > R.w - Rr - 12) x = Math.max(L + 12, R.w - Rr - 12 - bw);
      v.tx = x - bb[0] * v.zoom;
    }
    else v.tx = A.clamp(v.tx, R.w - Rr - 16 - bb[2] * v.zoom, L + 16 - bb[0] * v.zoom);
    if (bh <= R.h - top - bot) v.ty = top - bb[1] * v.zoom;
    else v.ty = A.clamp(v.ty, R.h - bot - bb[3] * v.zoom, top - bb[1] * v.zoom);
  };
  R.showPage = (i, smooth = false) => {
    const rc = D.pageRect(D.doc, i);
    const v = D.doc.view;
    const horiz = D.doc.page.scroll === 'horizontal';
    const L = R.nbInsetL || 0;
    const target = horiz ? { tx: L + (R.w - L - (rc[2] - rc[0]) * v.zoom) / 2 - rc[0] * v.zoom } : { ty: (R.notebookTop || 70) - rc[1] * v.zoom };
    if (!smooth) return R.setView(target);
    const from = { tx: v.tx, ty: v.ty }, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 260), e = 1 - Math.pow(1 - k, 3);
      R.setView({ tx: target.tx != null ? from.tx + (target.tx - from.tx) * e : null, ty: target.ty != null ? from.ty + (target.ty - from.ty) * e : null });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  R.currentPage = () => {
    if (!D.isNotebook()) return 0;
    const [cx, cy] = R.toWorld(R.w / 2, R.h * 0.4);
    return D.pageAt(D.doc, cx, cy);
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
    if (D.isNotebook()) { const z = R.fitPageZoom(); D.doc.view.zoom = z; D.doc.view.rot = 0; return R.showPage(R.currentPage()); }
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

  /* ---------- paper templates (notebook pages) ---------- */
  const MM = 96 / 25.4;
  R.templates = [
    { id: 'blank', name: 'Blank' }, { id: 'lined', name: 'Lined' }, { id: 'narrow', name: 'Narrow ruled' }, { id: 'wide', name: 'Wide ruled' },
    { id: 'grid', name: 'Grid 5 mm' }, { id: 'smallgrid', name: 'Grid 4 mm' }, { id: 'graph', name: 'Graph (mm)' }, { id: 'dot', name: 'Dot grid' },
    { id: 'cornell', name: 'Cornell' }, { id: 'eng', name: 'Engineering' }, { id: 'iso', name: 'Isometric' }, { id: 'music', name: 'Music staff' },
    { id: 'polar', name: 'Polar' }, { id: 'todo', name: 'Checklist' },
  ];
  R.drawTemplate = (ctx, rect, tpl, bg, hair) => {
    const [x0, y0, x1, y1] = rect, W = x1 - x0, H = y1 - y0;
    const [r, g, b] = R.gridColor(bg);
    const dark = A.C.luminance(bg) < 0.45;
    const line = (a) => `rgba(${r},${g},${b},${a})`;
    const hl = (yy, a, w = 1) => { ctx.strokeStyle = line(a); ctx.lineWidth = hair * w; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); };
    const vl = (xx, a, w = 1, ya = y0, yb = y1) => { ctx.strokeStyle = line(a); ctx.lineWidth = hair * w; ctx.beginPath(); ctx.moveTo(xx, ya); ctx.lineTo(xx, yb); ctx.stroke(); };
    const ruled = (sp, top, margin) => {
      ctx.strokeStyle = dark ? 'rgba(120,170,255,0.22)' : 'rgba(70,120,200,0.30)'; ctx.lineWidth = hair;
      ctx.beginPath();
      for (let yy = y0 + top; yy < y1 - 6 * MM; yy += sp) { ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); }
      ctx.stroke();
      if (margin) { ctx.strokeStyle = dark ? 'rgba(255,120,120,0.35)' : 'rgba(220,70,70,0.45)'; ctx.lineWidth = hair; ctx.beginPath(); ctx.moveTo(x0 + margin, y0); ctx.lineTo(x0 + margin, y1); ctx.stroke(); }
    };
    const css = hair > 0 ? 1 / hair : 1; // device px per world unit (≈ screen scale)
    const lod = (sp) => { let st = sp; while (st * css < 7) st *= 2; return st; };
    const grid = (sp0, a, major = 0) => {
      const sp = lod(sp0);
      if (sp !== sp0) major = 0;
      ctx.lineWidth = hair; ctx.beginPath();
      const nx = Math.floor(W / sp), ny = Math.floor(H / sp);
      const ox = x0 + (W - nx * sp) / 2, oy = y0 + (H - ny * sp) / 2;
      ctx.strokeStyle = line(a);
      for (let i = 0; i <= nx; i++) if (!major || i % major) { ctx.moveTo(ox + i * sp, oy); ctx.lineTo(ox + i * sp, oy + ny * sp); }
      for (let j = 0; j <= ny; j++) if (!major || j % major) { ctx.moveTo(ox, oy + j * sp); ctx.lineTo(ox + nx * sp, oy + j * sp); }
      ctx.stroke();
      if (major) {
        ctx.strokeStyle = line(a * 2.4); ctx.beginPath();
        for (let i = 0; i <= nx; i += major) { ctx.moveTo(ox + i * sp, oy); ctx.lineTo(ox + i * sp, oy + ny * sp); }
        for (let j = 0; j <= ny; j += major) { ctx.moveTo(ox, oy + j * sp); ctx.lineTo(ox + nx * sp, oy + j * sp); }
        ctx.stroke();
      }
    };
    ctx.save();
    switch (tpl) {
      case 'lined': ruled(7.1 * MM, 22 * MM, 25 * MM); break;
      case 'narrow': ruled(6 * MM, 18 * MM, 20 * MM); break;
      case 'wide': ruled(8.7 * MM, 26 * MM, 30 * MM); break;
      case 'grid': grid(5 * MM, 0.16); break;
      case 'smallgrid': grid(4 * MM, 0.14); break;
      case 'graph': grid(1 * MM, 0.07, 10); break;
      case 'dot': {
        const sp = lod(5 * MM), rad = hair * 1.25;
        const nx = Math.floor(W / sp), ny = Math.floor(H / sp);
        const ox = x0 + (W - nx * sp) / 2, oy = y0 + (H - ny * sp) / 2;
        ctx.fillStyle = line(0.38); ctx.beginPath();
        for (let i = 1; i < nx; i++) for (let j = 1; j < ny; j++) ctx.rect(ox + i * sp - rad, oy + j * sp - rad, rad * 2, rad * 2);
        ctx.fill();
        break;
      }
      case 'cornell': {
        ruled(7.1 * MM, 32 * MM, 0);
        vl(x0 + 62 * MM, 0.45, 1.4, y0 + 24 * MM, y1 - 52 * MM);
        hl(y0 + 24 * MM, 0.45, 1.4); hl(y1 - 52 * MM, 0.45, 1.4);
        break;
      }
      case 'eng': {
        ctx.fillStyle = dark ? 'rgba(80,140,90,0.10)' : 'rgba(210,235,205,0.55)'; ctx.fillRect(x0, y0, W, H);
        grid(5 * MM, 0.13);
        hl(y0 + 20 * MM, 0.5, 1.4); vl(x0 + 20 * MM, 0.35, 1.2);
        break;
      }
      case 'iso': {
        const sp = lod(6 * MM), h3 = sp * S3, rad = hair * 1.25;
        ctx.fillStyle = line(0.38); ctx.beginPath();
        for (let j = 0, yy = y0 + 8 * MM; yy < y1 - 6 * MM; j++, yy += h3) for (let xx = x0 + 8 * MM + (j % 2 ? sp / 2 : 0); xx < x1 - 6 * MM; xx += sp) ctx.rect(xx - rad, yy - rad, rad * 2, rad * 2);
        ctx.fill();
        break;
      }
      case 'music': {
        const st = 2 * MM, block = 22 * MM;
        ctx.strokeStyle = line(0.4); ctx.lineWidth = hair; ctx.beginPath();
        for (let yy = y0 + 22 * MM; yy + 4 * st < y1 - 12 * MM; yy += block) for (let k = 0; k < 5; k++) { ctx.moveTo(x0 + 15 * MM, yy + k * st); ctx.lineTo(x1 - 15 * MM, yy + k * st); }
        ctx.stroke();
        break;
      }
      case 'polar': {
        const cx = x0 + W / 2, cy = y0 + H / 2, R0 = Math.min(W, H) * 0.42;
        ctx.strokeStyle = line(0.16); ctx.lineWidth = hair; ctx.beginPath();
        for (let k = 1; k <= 8; k++) { ctx.moveTo(cx + (R0 * k) / 8, cy); ctx.arc(cx, cy, (R0 * k) / 8, 0, Math.PI * 2); }
        for (let k = 0; k < 24; k++) { const a = (k * Math.PI) / 12; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0); }
        ctx.stroke();
        break;
      }
      case 'todo': {
        ruled(9 * MM, 24 * MM, 0);
        ctx.strokeStyle = line(0.4); ctx.lineWidth = hair * 1.2;
        for (let yy = y0 + 24 * MM; yy < y1 - 6 * MM; yy += 9 * MM) ctx.strokeRect(x0 + 14 * MM, yy - 6 * MM, 4.2 * MM, 4.2 * MM);
        break;
      }
      default: break;
    }
    ctx.restore();
  };
  R.deskColor = (dark) => (dark ? '#0d0f13' : '#e4e6eb');
  /* paper behind the items: notebook pages, or artboard frames on a canvas */
  const drawPaper = (ctx, o) => {
    const doc = o.doc;
    const vbb = R.worldBB(o.m, o.w, o.h);
    const k = Math.hypot(o.m[0], o.m[1]);
    const hair = (o.dpr || A.dpr) / k;
    if (D.isNotebook(doc)) {
      if (o.bg) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = o.desk || R.deskColor(R.isDarkTheme()); ctx.fillRect(0, 0, o.w, o.h); }
      ctx.setTransform(...o.m);
      const rects = D.pageRects(doc);
      rects.forEach((rc, i) => {
        if (!G.bbHit(rc, vbb)) return;
        let pc = D.pageColor(doc, i);
        if (o.dark && A.C.luminance(pc) > 0.5) pc = R.DARK_PAPER;
        if (o.bg) {
          ctx.save();
          ctx.shadowColor = o.dark ? 'rgba(0,0,0,0.5)' : 'rgba(20,30,50,0.16)';
          ctx.shadowBlur = 18 * (o.dpr || A.dpr); ctx.shadowOffsetY = 4 * (o.dpr || A.dpr);
          ctx.fillStyle = pc; ctx.fillRect(rc[0], rc[1], rc[2] - rc[0], rc[3] - rc[1]);
          ctx.restore();
        } else if (o.pageBg) { ctx.fillStyle = pc; ctx.fillRect(rc[0], rc[1], rc[2] - rc[0], rc[3] - rc[1]); }
        if (o.bg || o.pageBg) R.drawTemplate(ctx, rc, D.pageTemplate(doc, i), pc, hair);
        if (o.bg && A.C.luminance(pc) < 0.35) { ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = hair; ctx.strokeRect(rc[0], rc[1], rc[2] - rc[0], rc[3] - rc[1]); }
      });
      // everything else is clipped to the paper
      ctx.beginPath();
      for (const rc of rects) if (G.bbHit(rc, vbb)) ctx.rect(rc[0], rc[1], rc[2] - rc[0], rc[3] - rc[1]);
      ctx.clip();
      return;
    }
    if (doc.artboards && doc.artboards.length && o.bg && !o.noArtboards) {
      ctx.setTransform(...o.m);
      for (const a of doc.artboards) {
        const rc = [a.x, a.y, a.x + a.w, a.y + a.h];
        if (!G.bbHit(rc, vbb)) continue;
        ctx.save();
        ctx.shadowColor = o.dark ? 'rgba(0,0,0,0.55)' : 'rgba(20,30,50,0.18)';
        ctx.shadowBlur = 16 * (o.dpr || A.dpr); ctx.shadowOffsetY = 3 * (o.dpr || A.dpr);
        ctx.fillStyle = o.bg; ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.restore();
        ctx.strokeStyle = o.dark ? 'rgba(255,255,255,0.22)' : 'rgba(30,40,60,0.22)';
        ctx.lineWidth = hair; ctx.strokeRect(a.x, a.y, a.w, a.h);
      }
    }
  };

  /* ---------- scene ---------- */
  const layerHasMask = (l) => l.items.some((it) => it.t === 's' && B.catalog[it.b] && B.catalog[it.b].mask);

  /* opts: {m, w, h, doc, bg (null = transparent), grid, sel:Set, selPreview, fade, scratch, onImage, dpr, onlyIds:Set} */
  R.paperIsDark = (doc = D.doc) => !!doc && A.C.luminance(D.isNotebook(doc) ? doc.page.color : doc.paper.bg) < 0.35;
  R.drawScene = (ctx, o) => {
    const doc = o.doc;
    const prevDark = B.dark, prevLift = B.lift;
    B.dark = !!o.dark;
    B.lift = !o.dark && !!o.inkAdapt && R.paperIsDark(doc);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, o.w, o.h);
    const nbk = D.isNotebook(doc);
    if (o.bg && !nbk) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, o.w, o.h); }
    drawPaper(ctx, o);
    if (o.grid && !nbk) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); R.drawGrid(ctx, o.m, o.w, o.h, o.bg ? Object.assign({}, doc.paper, { bg: o.bg }) : doc.paper, { dpr: o.dpr, axes: false }); ctx.restore(); }
    const vbb = R.worldBB(o.m, o.w, o.h);
    const sel = o.sel && o.sel.size ? o.sel : null;
    const fade = sel && o.fade ? 0.5 : 1;
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
        if (o.hideId && it.id === o.hideId) continue;
        if (o.noStrokes && it.pk) continue; // PencilKit draws this ink itself
        if (sel && sel.has(it.id)) { selected.push(it); continue; }
        if (!G.bbHit(it.bb, vbb)) continue;
        const f = B.isBox(it) ? 1 : fade; // dim ink only; pages and images stay as they are
        const a = o.replay && it.rid === o.replay.rid && it.at > o.replay.t ? f * 0.12 : f;
        if (B.isBox(it)) B.renderImage(tctx, it, a, o.onImage);
        else B.render(tctx, it, a);
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
        if (B.isBox(it)) B.renderImage(ctx, it, 1, o.onImage);
        else B.render(ctx, it, 1);
      }
    }
    ctx.restore();
    B.dark = prevDark; B.lift = prevLift;
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
    if (R.pk) { R.mctx.setTransform(1, 0, 0, 1, 0, 0); R.mctx.clearRect(0, 0, R.main.width, R.main.height); R.renderOverlay(); return; }
    const t0 = performance.now();
    const m = R.dmatrix(D.doc.view);
    const W = R.main.width, H = R.main.height;
    // heavy scene during gestures: reuse the cached bitmap, re-render periodically
    if (!force && !R.replay && R.gesturing && R.lastMs > 14 && R.cacheValid && t0 - lastFull < 220) {
      const ctx = R.mctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = D.isNotebook() ? R.deskColor(R.isDarkTheme()) : R.displayBg();
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
      scratch: R.scratch, sctx: R.sctx, onImage: R.render, dpr: A.dpr, replay: R.replay, hideId: R.hideId, inkAdapt: true,
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
    if (D.isNotebook(doc)) { ctx.beginPath(); for (const rc of D.pageRects(doc)) ctx.rect(rc[0], rc[1], rc[2] - rc[0], rc[3] - rc[1]); ctx.clip(); }
    const prevDark = B.dark, prevLift = B.lift;
    B.dark = R.darkActive(); B.lift = !B.dark && R.paperIsDark(doc);
    if (B.isBox(item)) B.renderImage(ctx, item, 1, R.render); else B.render(ctx, item, 1);
    B.dark = prevDark; B.lift = prevLift;
    ctx.restore();
    R.cacheValid = false;
  };

  R.renderOverlayNow = () => { overlayQueued = true; paintOverlay(); };
  const paintOverlay = () => {
      overlayQueued = false;
      const ctx = R.octx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, R.overlay.width, R.overlay.height);
      if (!D.doc) return;
      const prevDark = B.dark, prevLift = B.lift;
      B.dark = R.darkActive(); B.lift = !B.dark && R.paperIsDark();
      for (const p of R.painters) {
        ctx.save();
        ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
        try { p(ctx); } catch (e) { console.error(e); }
        ctx.restore();
      }
      B.dark = prevDark; B.lift = prevLift;
  };
  R.renderOverlay = () => {
    if (overlayQueued) return;
    overlayQueued = true;
    requestAnimationFrame(() => { if (overlayQueued) paintOverlay(); });
  };

  /* ---------- offscreen rendering for export / thumbnails ---------- */
  R.renderRegion = (doc, bb, scale, { bg = true, grid = false, onlyIds = null, maxPx = 8192, noStrokes = false, display = false } = {}) => {
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
      m, w: W, h: H, doc, bg: bg && !D.isNotebook(doc) ? (display ? R.displayBg(doc) : doc.paper.bg) : null, pageBg: bg && D.isNotebook(doc), grid, scratch: sc, sctx: sc.getContext('2d'), dpr: Math.max(1, s), onlyIds, noArtboards: !display, noStrokes, hideId: noStrokes ? R.hideId : null,
      dark: display && R.darkActive(doc), inkAdapt: display,
    });
    return c;
  };
  R.thumbnail = (doc, W = 360, H = 270) => {
    if (D.isNotebook(doc)) { const r0 = D.pageRect(doc, 0); W = 270; H = Math.round((270 * (r0[3] - r0[1])) / (r0[2] - r0[0])); }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
    const bb = D.isNotebook(doc) ? D.pageRect(doc, 0) : D.allBB(doc);
    let m;
    if (D.isNotebook(doc)) {
      const s = W / (bb[2] - bb[0]);
      m = [s, 0, 0, s, W / 2 - ((bb[0] + bb[2]) / 2) * s, -bb[1] * s];
      R.drawScene(c.getContext('2d'), { m, w: W, h: H, doc, bg: doc.page.color, desk: doc.page.color, scratch: sc, sctx: sc.getContext('2d'), dpr: 1 });
      return c;
    }
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
