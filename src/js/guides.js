/* Axiom shape guides (Line, Ellipse, Rectangle, Angle) and measurement formatting */
'use strict';
(() => {
  const D = A.D, R = A.R, G = A.G;
  const GU = (A.GU = {});
  const hyp = Math.hypot;

  /* ---------- units ---------- */
  A.UNITS = { px: 1, pt: 0.75, mm: 25.4 / 96, cm: 2.54 / 96, in: 1 / 96 };
  A.fmtLen = (worldLen, doc = D.doc) => {
    const u = doc.precision.units || 'mm';
    const v = worldLen * (A.UNITS[u] || 1) * (doc.precision.scale || 1);
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return v.toFixed(digits) + ' ' + u;
  };
  A.fmtArea = (worldArea, doc = D.doc) => {
    const u = doc.precision.units || 'mm';
    const k = (A.UNITS[u] || 1) * (doc.precision.scale || 1);
    const v = worldArea * k * k;
    return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + ' ' + u + '²';
  };

  GU.types = [
    { id: 'line', name: 'Line' },
    { id: 'ellipse', name: 'Ellipse' },
    { id: 'rect', name: 'Rectangle' },
    { id: 'angle', name: 'Angle' },
  ];

  GU.active = () => {
    const doc = D.doc;
    if (!doc || !doc.precision.guide) return null;
    const t = doc.precision.guideType;
    if (!doc.guides[t]) doc.guides[t] = GU.make(t);
    return Object.assign({ type: t }, { s: doc.guides[t] });
  };
  GU.make = (t) => {
    const [cx, cy] = R.toWorld(R.w / 2, R.h / 2);
    const z = D.doc.view.zoom, L = Math.min(R.w, R.h) * 0.28 / z;
    switch (t) {
      case 'line': return { p1: [cx - L, cy], p2: [cx + L, cy], limit: false };
      case 'ellipse': return { cx, cy, rx: L * 0.8, ry: L * 0.55, rot: 0 };
      case 'rect': return { cx, cy, w: L * 1.4, h: L * 0.9, rot: 0 };
      case 'angle': return { v: [cx - L * 0.6, cy + L * 0.4], a: [cx + L * 0.8, cy + L * 0.4], b: [cx + L * 0.2, cy - L * 0.6] };
    }
  };
  GU.reset = () => { const d = D.doc; delete d.guides[d.precision.guideType]; R.renderOverlay(); };

  /* ---------- geometry helpers ---------- */
  const rotP = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  const center = (g) => {
    const s = g.s;
    switch (g.type) {
      case 'line': return [(s.p1[0] + s.p2[0]) / 2, (s.p1[1] + s.p2[1]) / 2];
      case 'ellipse': case 'rect': return [s.cx, s.cy];
      case 'angle': return s.v;
    }
  };
  GU.handles = (g) => {
    const s = g.s, z = D.doc.view.zoom, off = 40 / z;
    const H = [];
    if (g.type === 'line') {
      H.push({ id: 'p1', p: s.p1 }, { id: 'p2', p: s.p2 }, { id: 'c', p: center(g), center: true });
    } else if (g.type === 'ellipse') {
      const [ax, ay] = rotP(s.rx, 0, s.rot), [bx, by] = rotP(0, s.ry, s.rot), [rx, ry] = rotP(s.rx + off, 0, s.rot);
      H.push({ id: 'rx', p: [s.cx + ax, s.cy + ay] }, { id: 'ry', p: [s.cx + bx, s.cy + by] },
        { id: 'rot', p: [s.cx + rx, s.cy + ry], rot: true }, { id: 'c', p: [s.cx, s.cy], center: true });
    } else if (g.type === 'rect') {
      const [kx, ky] = rotP(s.w / 2, s.h / 2, s.rot), [tx, ty] = rotP(0, -s.h / 2 - off, s.rot);
      H.push({ id: 'corner', p: [s.cx + kx, s.cy + ky] }, { id: 'rot', p: [s.cx + tx, s.cy + ty], rot: true }, { id: 'c', p: [s.cx, s.cy], center: true });
    } else if (g.type === 'angle') {
      H.push({ id: 'a', p: s.a }, { id: 'b', p: s.b }, { id: 'c', p: s.v, center: true });
    }
    return H;
  };
  GU.hitHandle = (g, sx, sy) => {
    let best = null, bd = 26;
    for (const h of GU.handles(g)) {
      const [hx, hy] = R.toScreen(h.p[0], h.p[1]);
      const d = hyp(hx - sx, hy - sy);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  };

  /* drag a handle; (wx, wy) world pos, (dx, dy) world delta since last move */
  GU.drag = (g, h, wx, wy, dx, dy) => {
    const s = g.s;
    const snapAng = (a) => { const st = Math.PI / 12, k = Math.round(a / st) * st; return Math.abs(a - k) < A.rad(3) ? k : a; };
    if (h.id === 'c') {
      if (g.type === 'line') { s.p1 = [s.p1[0] + dx, s.p1[1] + dy]; s.p2 = [s.p2[0] + dx, s.p2[1] + dy]; }
      else if (g.type === 'angle') { s.v = [s.v[0] + dx, s.v[1] + dy]; s.a = [s.a[0] + dx, s.a[1] + dy]; s.b = [s.b[0] + dx, s.b[1] + dy]; }
      else { s.cx += dx; s.cy += dy; }
      return;
    }
    if (g.type === 'line') {
      const other = h.id === 'p1' ? s.p2 : s.p1;
      let ang = snapAng(Math.atan2(wy - other[1], wx - other[0]));
      const L = hyp(wx - other[0], wy - other[1]);
      s[h.id] = [other[0] + Math.cos(ang) * L, other[1] + Math.sin(ang) * L];
    } else if (g.type === 'ellipse') {
      const [lx, ly] = rotP(wx - s.cx, wy - s.cy, -s.rot);
      if (h.id === 'rx') { s.rx = Math.max(2, Math.abs(lx)); if (s.circle) s.ry = s.rx; }
      if (h.id === 'ry') { s.ry = Math.max(2, Math.abs(ly)); if (s.circle) s.rx = s.ry; }
      if (h.id === 'rot') s.rot = snapAng(Math.atan2(wy - s.cy, wx - s.cx));
    } else if (g.type === 'rect') {
      const [lx, ly] = rotP(wx - s.cx, wy - s.cy, -s.rot);
      if (h.id === 'corner') {
        s.w = Math.max(4, Math.abs(lx) * 2); s.h = Math.max(4, Math.abs(ly) * 2);
        if (s.square) s.w = s.h = Math.max(s.w, s.h);
      }
      if (h.id === 'rot') s.rot = snapAng(Math.atan2(wy - s.cy, wx - s.cx) + Math.PI / 2);
    } else if (g.type === 'angle') {
      const ang = snapAng(Math.atan2(wy - s.v[1], wx - s.v[0]));
      const L = Math.max(10, hyp(wx - s.v[0], wy - s.v[1]));
      s[h.id] = [s.v[0] + Math.cos(ang) * L, s.v[1] + Math.sin(ang) * L];
    }
  };

  /* double-tap the center: special constraint */
  GU.special = (g) => {
    const s = g.s;
    if (g.type === 'line') { s.limit = !s.limit; A.toast(s.limit ? 'Line limited to handles' : 'Line extends infinitely'); }
    if (g.type === 'ellipse') { s.circle = !s.circle; if (s.circle) s.rx = s.ry = (s.rx + s.ry) / 2; A.toast(s.circle ? 'Perfect circle' : 'Free ellipse'); }
    if (g.type === 'rect') { s.square = !s.square; if (s.square) s.w = s.h = (s.w + s.h) / 2; A.toast(s.square ? 'Perfect square' : 'Free rectangle'); }
    if (g.type === 'angle') {
      const a0 = Math.atan2(s.a[1] - s.v[1], s.a[0] - s.v[0]);
      const L = hyp(s.b[0] - s.v[0], s.b[1] - s.v[1]);
      s.b = [s.v[0] + Math.cos(a0 - Math.PI / 2) * L, s.v[1] + Math.sin(a0 - Math.PI / 2) * L];
      A.toast('Right angle');
    }
  };

  /* ---------- projection for tracing ---------- */
  GU.begin = (g, x, y) => {
    const ctx = {};
    if (g.type === 'angle') {
      const s = g.s;
      const d1 = projRay(s.v, s.a, x, y), d2 = projRay(s.v, s.b, x, y);
      ctx.ray = hyp(d1[0] - x, d1[1] - y) <= hyp(d2[0] - x, d2[1] - y) ? 'a' : 'b';
    }
    return ctx;
  };
  const projRay = (v, p, x, y) => {
    const dx = p[0] - v[0], dy = p[1] - v[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, ((x - v[0]) * dx + (y - v[1]) * dy) / L2);
    return [v[0] + dx * t, v[1] + dy * t];
  };
  GU.project = (g, x, y, ctx = {}) => {
    const s = g.s;
    switch (g.type) {
      case 'line': {
        const dx = s.p2[0] - s.p1[0], dy = s.p2[1] - s.p1[1], L2 = dx * dx + dy * dy || 1;
        let t = ((x - s.p1[0]) * dx + (y - s.p1[1]) * dy) / L2;
        if (s.limit) t = A.clamp(t, 0, 1);
        return [s.p1[0] + dx * t, s.p1[1] + dy * t];
      }
      case 'ellipse': {
        const [lx, ly] = rotP(x - s.cx, y - s.cy, -s.rot);
        const t = Math.atan2(ly / s.ry, lx / s.rx);
        const [px, py] = rotP(s.rx * Math.cos(t), s.ry * Math.sin(t), s.rot);
        return [s.cx + px, s.cy + py];
      }
      case 'rect': {
        let [lx, ly] = rotP(x - s.cx, y - s.cy, -s.rot);
        const hw = s.w / 2, hh = s.h / 2;
        const cx = A.clamp(lx, -hw, hw), cy = A.clamp(ly, -hh, hh);
        // nearest edge
        const dl = Math.abs(cx + hw), dr = Math.abs(hw - cx), dt = Math.abs(cy + hh), db = Math.abs(hh - cy);
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) lx = -hw, ly = cy; else if (m === dr) lx = hw, ly = cy; else if (m === dt) ly = -hh, lx = cx; else ly = hh, lx = cx;
        const [px, py] = rotP(lx, ly, s.rot);
        return [s.cx + px, s.cy + py];
      }
      case 'angle': return projRay(s.v, ctx.ray === 'b' ? s.b : s.a, x, y);
    }
    return [x, y];
  };

  /* world outline of the guide as polyline(s) */
  GU.outline = (g) => {
    const s = g.s;
    switch (g.type) {
      case 'line': {
        if (s.limit) return [[s.p1, s.p2]];
        const dx = s.p2[0] - s.p1[0], dy = s.p2[1] - s.p1[1], L = hyp(dx, dy) || 1;
        const big = (Math.max(R.w, R.h) * 3) / D.doc.view.zoom;
        return [[[s.p1[0] - (dx / L) * big, s.p1[1] - (dy / L) * big], [s.p2[0] + (dx / L) * big, s.p2[1] + (dy / L) * big]]];
      }
      case 'ellipse': return [G.sampleEllipse(s.cx, s.cy, s.rx, s.ry, s.rot, 128)];
      case 'rect': {
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => {
          const [px, py] = rotP((a * s.w) / 2, (b * s.h) / 2, s.rot); return [s.cx + px, s.cy + py];
        });
        return [c];
      }
      case 'angle': {
        const ext = (p) => { const dx = p[0] - s.v[0], dy = p[1] - s.v[1], L = hyp(dx, dy) || 1, k = (L + 4000 / D.doc.view.zoom) / L; return [s.v[0] + dx * k, s.v[1] + dy * k]; };
        return [[s.v, ext(s.a)], [s.v, ext(s.b)]];
      }
    }
    return [];
  };

  /* ---------- overlay painter ---------- */
  GU.paint = (ctx) => {
    const g = GU.active();
    if (!g) return;
    const slot = A.B.slot();
    const z = D.doc.view.zoom;
    const band = Math.max(3, Math.min(60, (slot.size || 2) * z));
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f6fdb';
    const polys = GU.outline(g).map((poly) => poly.map(([x, y]) => R.toScreen(x, y)));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const poly of polys) {
      ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = 'rgba(120,130,150,0.22)'; ctx.lineWidth = band; ctx.stroke();
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.65; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // handles
    for (const h of GU.handles(g)) {
      const [x, y] = R.toScreen(h.p[0], h.p[1]);
      if (h.center) {
        ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, h.rot ? 6 : 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (h.rot) { ctx.beginPath(); ctx.arc(x, y, 11, -0.6, 1.6); ctx.stroke(); }
      }
    }
    // labels
    const s = g.s, meas = D.doc.precision.measure;
    const label = (txt, wx, wy, dy = -18) => {
      const [x, y] = R.toScreen(wx, wy);
      A.R.label(ctx, txt, x, y + dy, accent);
    };
    if (g.type === 'angle') {
      const a1 = Math.atan2(s.a[1] - s.v[1], s.a[0] - s.v[0]), a2 = Math.atan2(s.b[1] - s.v[1], s.b[0] - s.v[0]);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      const [vx, vy] = R.toScreen(s.v[0], s.v[1]);
      const sa1 = Math.atan2(...(() => { const [x, y] = R.toScreen(s.a[0], s.a[1]); return [y - vy, x - vx]; })());
      const sa2 = Math.atan2(...(() => { const [x, y] = R.toScreen(s.b[0], s.b[1]); return [y - vy, x - vx]; })());
      let start = sa1, end = sa2, diff = ((end - start + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(vx, vy, 34, start, start + diff, diff < 0); ctx.stroke();
      const mid = start + diff / 2;
      A.R.label(ctx, A.deg(d).toFixed(1) + '°', vx + Math.cos(mid) * 58, vy + Math.sin(mid) * 58, accent);
    }
    if (!meas) return;
    if (g.type === 'line') label(A.fmtLen(hyp(s.p2[0] - s.p1[0], s.p2[1] - s.p1[1])), (s.p1[0] + s.p2[0]) / 2, (s.p1[1] + s.p2[1]) / 2);
    if (g.type === 'ellipse') label(s.rx === s.ry ? 'r ' + A.fmtLen(s.rx) : `${A.fmtLen(s.rx * 2)} × ${A.fmtLen(s.ry * 2)}`, s.cx, s.cy, 24);
    if (g.type === 'rect') label(`${A.fmtLen(s.w)} × ${A.fmtLen(s.h)}`, s.cx, s.cy, 24);
  };

  /* shared pill label used by overlay painters */
  R.label = (ctx, txt, x, y, color) => {
    ctx.save();
    ctx.font = '600 12px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
    const w = ctx.measureText(txt).width + 14;
    ctx.fillStyle = color || '#2f6fdb';
    ctx.globalAlpha = 0.92;
    const r = 9, x0 = x - w / 2, y0 = y - 10;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + 20, r); ctx.arcTo(x0 + w, y0 + 20, x0, y0 + 20, r);
    ctx.arcTo(x0, y0 + 20, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x, y + 0.5);
    ctx.restore();
  };
})();
