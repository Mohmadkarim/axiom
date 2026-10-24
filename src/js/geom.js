/* Axiom geometry: stroke processing, outlines, hit testing, shape recognition, lattices.
   Stroke points are flat arrays [x, y, m, x, y, m, ...] where m is a width multiplier. */
'use strict';
(() => {
  const G = (A.G = {});
  const hyp = Math.hypot;

  G.count = (p) => (p.length / 3) | 0;

  G.bbox = (pts, pad = 0) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x0 === Infinity) return [0, 0, 0, 0];
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  };
  G.bbUnion = (a, b) => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice());
  G.bbHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  G.maxM = (pts) => { let m = 0; for (let i = 2; i < pts.length; i += 3) if (pts[i] > m) m = pts[i]; return m || 1; };

  G.length = (pts) => {
    let L = 0;
    for (let i = 3; i < pts.length; i += 3) L += hyp(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2]);
    return L;
  };

  G.distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return hyp(px - (ax + t * dx), py - (ay + t * dy));
  };

  G.pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  /* Resample to roughly uniform spacing (keeps first/last points) */
  G.resample = (pts, step) => {
    const n = G.count(pts);
    if (n < 2 || step <= 0) return pts.slice();
    const out = [pts[0], pts[1], pts[2]];
    let carry = 0;
    for (let i = 1; i < n; i++) {
      const ax = pts[(i - 1) * 3], ay = pts[(i - 1) * 3 + 1], am = pts[(i - 1) * 3 + 2];
      const bx = pts[i * 3], by = pts[i * 3 + 1], bm = pts[i * 3 + 2];
      const seg = hyp(bx - ax, by - ay);
      let d = step - carry;
      while (d <= seg) {
        const t = d / seg;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t, am + (bm - am) * t);
        d += step;
      }
      carry = seg - (d - step);
    }
    const L = out.length;
    const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
    if (hyp(out[L - 3] - lx, out[L - 2] - ly) > step * 0.2) out.push(lx, ly, pts[pts.length - 1]);
    else { out[L - 3] = lx; out[L - 2] = ly; out[L - 1] = pts[pts.length - 1]; }
    return out;
  };

  /* Chaikin corner cutting, keeps endpoints */
  G.chaikin = (pts, iters = 1, closed = false) => {
    let p = pts;
    for (let k = 0; k < iters; k++) {
      const n = G.count(p);
      if (n < 3) return p;
      const o = closed ? [] : [p[0], p[1], p[2]];
      const lim = closed ? n : n - 1;
      for (let i = 0; i < lim; i++) {
        const a = i * 3, b = ((i + 1) % n) * 3;
        o.push(0.75 * p[a] + 0.25 * p[b], 0.75 * p[a + 1] + 0.25 * p[b + 1], 0.75 * p[a + 2] + 0.25 * p[b + 2]);
        o.push(0.25 * p[a] + 0.75 * p[b], 0.25 * p[a + 1] + 0.75 * p[b + 1], 0.25 * p[a + 2] + 0.75 * p[b + 2]);
      }
      if (!closed) o.push(p[p.length - 3], p[p.length - 2], p[p.length - 1]);
      p = o;
    }
    return p;
  };

  /* Ramer-Douglas-Peucker that also preserves width changes */
  G.simplify = (pts, tol, mtol = 0.06) => {
    const n = G.count(pts);
    if (n < 3) return pts.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const ax = pts[s * 3], ay = pts[s * 3 + 1], am = pts[s * 3 + 2];
      const bx = pts[e * 3], by = pts[e * 3 + 1], bm = pts[e * 3 + 2];
      let worst = 0, wi = -1;
      for (let i = s + 1; i < e; i++) {
        const x = pts[i * 3], y = pts[i * 3 + 1], m = pts[i * 3 + 2];
        const t = (i - s) / (e - s);
        const err = Math.max(G.distToSeg(x, y, ax, ay, bx, by) / tol, Math.abs(m - (am + (bm - am) * t)) / mtol);
        if (err > worst) { worst = err; wi = i; }
      }
      if (worst > 1 && wi > 0) { keep[wi] = 1; stack.push([s, wi], [wi, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    return out;
  };

  /* ---------- outline builders (sink = Path2D or SVG builder) ---------- */
  G.svgSink = () => {
    const parts = [];
    const f = (v) => Math.round(v * 100) / 100;
    return {
      moveTo: (x, y) => parts.push(`M${f(x)} ${f(y)}`),
      lineTo: (x, y) => parts.push(`L${f(x)} ${f(y)}`),
      quadraticCurveTo: (cx, cy, x, y) => parts.push(`Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`),
      circle: (x, y, r) => parts.push(`M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`),
      closePath: () => parts.push('Z'),
      toString: () => parts.join(''),
    };
  };
  const circle = (sink, x, y, r) => {
    if (sink.circle) return sink.circle(x, y, r);
    sink.moveTo(x + r, y);
    sink.arc(x, y, r, 0, Math.PI * 2);
    sink.closePath();
  };

  /* Variable-width stroke as a nonzero union of circles and (consistently wound) tangent quads */
  G.buildVar = (sink, pts, size, taper = 0) => {
    const n = G.count(pts);
    if (!n) return;
    const r = new Float32Array(n);
    let total = 0;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) { total += hyp(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]); cum[i] = total; }
    const tl = taper ? Math.min(size * taper, total * 0.4) : 0;
    for (let i = 0; i < n; i++) {
      let k = pts[i * 3 + 2];
      if (tl > 0) {
        const a = Math.min(1, cum[i] / tl), b = Math.min(1, (total - cum[i]) / tl);
        k *= Math.sqrt(Math.min(a, b)) * 0.92 + 0.08;
      }
      r[i] = Math.max(0.12, (size * k) / 2);
    }
    if (n === 1) { circle(sink, pts[0], pts[1], r[0]); return; }
    for (let i = 0; i < n; i++) circle(sink, pts[i * 3], pts[i * 3 + 1], r[i]);
    for (let i = 0; i < n - 1; i++) {
      const x1 = pts[i * 3], y1 = pts[i * 3 + 1], x2 = pts[i * 3 + 3], y2 = pts[i * 3 + 4];
      const dx = x2 - x1, dy = y2 - y1, L = hyp(dx, dy);
      if (L < 1e-6) continue;
      const nx = -dy / L, ny = dx / L, r1 = r[i], r2 = r[i + 1];
      const ax = x1 + nx * r1, ay = y1 + ny * r1, bx = x2 + nx * r2, by = y2 + ny * r2;
      const cx = x2 - nx * r2, cy = y2 - ny * r2, ex = x1 - nx * r1, ey = y1 - ny * r1;
      // signed area of A,B,C,D: keep positive (same winding as the arcs)
      const area = (ax * by - bx * ay) + (bx * cy - cx * by) + (cx * ey - ex * cy) + (ex * ay - ax * ey);
      if (area >= 0) { sink.moveTo(ax, ay); sink.lineTo(bx, by); sink.lineTo(cx, cy); sink.lineTo(ex, ey); }
      else { sink.moveTo(ax, ay); sink.lineTo(ex, ey); sink.lineTo(cx, cy); sink.lineTo(bx, by); }
      sink.closePath();
    }
  };

  /* Smooth centerline through points using midpoint quadratics */
  G.buildLine = (sink, pts, closed = false) => {
    const n = G.count(pts);
    if (!n) return;
    if (n === 1) { sink.moveTo(pts[0], pts[1]); sink.lineTo(pts[0] + 0.01, pts[1]); return; }
    if (n === 2) { sink.moveTo(pts[0], pts[1]); sink.lineTo(pts[3], pts[4]); if (closed) sink.closePath(); return; }
    sink.moveTo(pts[0], pts[1]);
    for (let i = 1; i < n - 1; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1];
      const mx = (x + pts[i * 3 + 3]) / 2, my = (y + pts[i * 3 + 4]) / 2;
      sink.quadraticCurveTo(x, y, mx, my);
    }
    sink.lineTo(pts[pts.length - 3], pts[pts.length - 2]);
    if (closed) sink.closePath();
  };

  /* Centripetal Catmull-Rom through the points, sampled every ~step (width interpolated linearly).
     Turns sparse simplified points back into a smooth curve. */
  G.spline = (pts, step, maxPts = 2400) => {
    const n = G.count(pts);
    if (n < 3) return pts;
    const L = G.length(pts);
    step = Math.max(step, L / maxPts);
    const P = (i) => { i = i < 0 ? 0 : i >= n ? n - 1 : i; return [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]; };
    const out = [pts[0], pts[1], pts[2]];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const seg = hyp(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(1, Math.ceil(seg / step));
      const d = (a, b) => Math.max(1e-4, Math.sqrt(hyp(b[0] - a[0], b[1] - a[1])));
      const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      for (let j = 1; j <= k; j++) {
        const u = j / k;
        if (k === 1 || seg < 1e-6) { out.push(p2[0], p2[1], p2[2]); break; }
        const t = t1 + (t2 - t1) * u;
        const lerp = (a, b, ta, tb) => { const w = (t - ta) / (tb - ta || 1e-6); return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]; };
        const A1 = lerp(p0, p1, 0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
        const B1 = lerp(A1, A2, 0, t2), B2 = lerp(A2, A3, t1, t3);
        const C = lerp(B1, B2, t1, t2);
        out.push(C[0], C[1], p1[2] + (p2[2] - p1[2]) * u);
      }
    }
    return out;
  };

  /* polyline (sharp corners), for recognized shapes */
  G.buildPoly = (sink, pts, closed = false) => {
    const n = G.count(pts);
    if (!n) return;
    sink.moveTo(pts[0], pts[1]);
    for (let i = 1; i < n; i++) sink.lineTo(pts[i * 3], pts[i * 3 + 1]);
    if (closed) sink.closePath();
  };

  /* ---------- hit testing ---------- */
  G.strokeHitCircle = (item, x, y, r) => {
    const bb = item.bb;
    if (x < bb[0] - r || x > bb[2] + r || y < bb[1] - r || y > bb[3] + r) return false;
    const p = item.pts, n = G.count(p);
    const half = (item.w * (item.mm || 1)) / 2;
    if (item.b === 'fill' && n > 2) {
      const poly = []; for (let i = 0; i < p.length; i += 3) poly.push(p[i], p[i + 1]);
      if (G.pointInPoly(x, y, poly)) return true;
    }
    if (n === 1) return hyp(p[0] - x, p[1] - y) <= r + half;
    for (let i = 0; i < n - 1; i++) {
      if (G.distToSeg(x, y, p[i * 3], p[i * 3 + 1], p[i * 3 + 3], p[i * 3 + 4]) <= r + half) return true;
    }
    return false;
  };
  G.strokeHitSeg = (item, x1, y1, x2, y2, r) => {
    const d = hyp(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(d / Math.max(r * 0.7, 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (G.strokeHitCircle(item, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r)) return true;
    }
    return false;
  };

  /* Cut a stroke with an eraser circle path. Returns array of point arrays (pieces) or null if untouched. */
  G.slice = (pts, cx, cy, r, step) => {
    const rs = G.resample(pts, step);
    const n = G.count(rs);
    let touched = false;
    const pieces = [];
    let cur = [];
    for (let i = 0; i < n; i++) {
      const x = rs[i * 3], y = rs[i * 3 + 1];
      if (hyp(x - cx, y - cy) <= r) { touched = true; if (cur.length) { pieces.push(cur); cur = []; } }
      else cur.push(x, y, rs[i * 3 + 2]);
    }
    if (cur.length) pieces.push(cur);
    return touched ? pieces.filter((p) => p.length >= 6) : null;
  };

  /* ---------- shape recognition (draw & hold) ---------- */
  const xy = (pts) => { const o = []; for (let i = 0; i < pts.length; i += 3) o.push([pts[i], pts[i + 1]]); return o; };
  const avgM = (pts) => { let s = 0, c = 0; for (let i = 2; i < pts.length; i += 3) { s += pts[i]; c++; } return c ? s / c : 1; };
  const toPts = (arr, m) => { const o = []; for (const [x, y] of arr) o.push(x, y, m); return o; };
  const rdpXY = (P, eps) => {
    if (P.length < 3) return P.slice();
    let dmax = 0, idx = 0;
    const [a, b] = [P[0], P[P.length - 1]];
    for (let i = 1; i < P.length - 1; i++) {
      const d = G.distToSeg(P[i][0], P[i][1], a[0], a[1], b[0], b[1]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) return rdpXY(P.slice(0, idx + 1), eps).slice(0, -1).concat(rdpXY(P.slice(idx), eps));
    return [a, b];
  };
  const sampleEllipse = (cx, cy, rx, ry, rot, n = 96) => {
    const o = [], c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2, x = rx * Math.cos(t), y = ry * Math.sin(t);
      o.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return o;
  };
  G.sampleEllipse = sampleEllipse;
  const densify = (P, step) => {
    const o = [P[0]];
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i];
      const d = hyp(bx - ax, by - ay), k = Math.max(1, Math.ceil(d / step));
      for (let j = 1; j <= k; j++) o.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]);
    }
    return o;
  };
  const circleFrom3 = (a, b, c) => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
    const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return [ux, uy, hyp(a[0] - ux, a[1] - uy)];
  };

  G.recognize = (pts) => {
    const P = xy(pts);
    if (P.length < 4) return null;
    const m = avgM(pts);
    const L = G.length(pts);
    const [x0, y0, x1, y1] = G.bbox(pts);
    const diag = hyp(x1 - x0, y1 - y0);
    if (diag < 4) return null;
    const first = P[0], last = P[P.length - 1];
    const chord = hyp(last[0] - first[0], last[1] - first[1]);
    const step = Math.max(diag / 80, 0.5);

    // straight line
    if (chord / L > 0.94) return { kind: 'line', pts: toPts(densify([first, last], step), m), closed: false };

    const closed = chord < Math.max(0.18 * L, diag * 0.22);
    if (closed) {
      // ellipse fit by moments (on resampled points for uniform weighting)
      const R = xy(G.resample(pts, L / 120));
      let cx = 0, cy = 0;
      for (const p of R) { cx += p[0]; cy += p[1]; }
      cx /= R.length; cy /= R.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const [x, y] of R) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
      sxx /= R.length; syy /= R.length; sxy /= R.length;
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      let rx = Math.sqrt(2 * l1), ry = Math.sqrt(2 * Math.max(l2, 0));
      // residual: normalized radial error
      const c = Math.cos(-rot), s = Math.sin(-rot);
      let err = 0;
      for (const [x, y] of R) {
        const lx = (x - cx) * c - (y - cy) * s, ly = (x - cx) * s + (y - cy) * c;
        err += Math.abs(Math.hypot(lx / (rx || 1), ly / (ry || 1)) - 1);
      }
      err /= R.length;

      // polygon corners
      const loop = P.concat([P[0]]);
      let simp = rdpXY(loop, diag * 0.085);
      if (simp.length > 2 && hyp(simp[0][0] - simp[simp.length - 1][0], simp[0][1] - simp[simp.length - 1][1]) < diag * 0.1) simp = simp.slice(0, -1);
      // merge nearly collinear vertices
      const corners = [];
      for (let i = 0; i < simp.length; i++) {
        const a = simp[(i - 1 + simp.length) % simp.length], b = simp[i], cc = simp[(i + 1) % simp.length];
        const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [cc[0] - b[0], cc[1] - b[1]];
        const ang = Math.acos(A.clamp((v1[0] * v2[0] + v1[1] * v2[1]) / ((hyp(...v1) * hyp(...v2)) || 1), -1, 1));
        if (ang < A.rad(160)) corners.push(b);
      }
      const k = corners.length;
      if ((k === 3 || k === 4) && err > 0.075) {
        if (k === 4) {
          // rectangle if all angles ~90°
          let rectish = true;
          for (let i = 0; i < 4; i++) {
            const a = corners[(i + 3) % 4], b = corners[i], cc = corners[(i + 1) % 4];
            const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [cc[0] - b[0], cc[1] - b[1]];
            const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((hyp(...v1) * hyp(...v2)) || 1);
            if (Math.abs(cos) > 0.3) rectish = false;
          }
          if (rectish) {
            // orientation from the longest edge, snapped to axis if close
            let best = 0, ang = 0;
            for (let i = 0; i < 4; i++) {
              const a = corners[i], b = corners[(i + 1) % 4], d = hyp(b[0] - a[0], b[1] - a[1]);
              if (d > best) { best = d; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
            }
            const snapA = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
            if (Math.abs(ang - snapA) < A.rad(8)) ang = snapA;
            const ca = Math.cos(-ang), sa = Math.sin(-ang);
            let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
            let ccx = 0, ccy = 0; corners.forEach((p) => { ccx += p[0] / 4; ccy += p[1] / 4; });
            for (const p of corners) {
              const lx = (p[0] - ccx) * ca - (p[1] - ccy) * sa, ly = (p[0] - ccx) * sa + (p[1] - ccy) * ca;
              mx0 = Math.min(mx0, lx); mx1 = Math.max(mx1, lx); my0 = Math.min(my0, ly); my1 = Math.max(my1, ly);
            }
            let w = (mx1 - mx0), h = (my1 - my0);
            if (Math.abs(w - h) / Math.max(w, h) < 0.1) w = h = (w + h) / 2; // square
            const c2 = Math.cos(ang), s2 = Math.sin(ang);
            const loc = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
            const world = loc.map(([x, y]) => [ccx + x * c2 - y * s2, ccy + x * s2 + y * c2]);
            return { kind: w === h ? 'square' : 'rectangle', pts: toPts(densify(world, step), m), closed: true, sharp: true };
          }
        }
        const poly = corners.concat([corners[0]]);
        return { kind: k === 3 ? 'triangle' : 'polygon', pts: toPts(densify(poly, step), m), closed: true, sharp: true };
      }
      if (k >= 5 && k <= 8 && err > 0.11) {
        const poly = corners.concat([corners[0]]);
        return { kind: 'polygon', pts: toPts(densify(poly, step), m), closed: true, sharp: true };
      }
      if (err < 0.16) {
        if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) { const rr = (rx + ry) / 2; rx = ry = rr; }
        return { kind: rx === ry ? 'circle' : 'ellipse', pts: toPts(sampleEllipse(cx, cy, rx, ry, rot, 120), m), closed: true };
      }
      return null;
    }

    // open: try arc through first, middle, last
    const mid = P[Math.floor(P.length / 2)];
    const circ = circleFrom3(first, mid, last);
    if (circ) {
      const [ux, uy, rr] = circ;
      let err = 0;
      for (const [x, y] of P) err += Math.abs(hyp(x - ux, y - uy) - rr);
      err /= P.length * rr;
      if (err < 0.06 && rr < diag * 6) {
        let a0 = Math.atan2(first[1] - uy, first[0] - ux);
        const am = Math.atan2(mid[1] - uy, mid[0] - ux);
        let a1 = Math.atan2(last[1] - uy, last[0] - ux);
        // choose direction that passes through mid
        const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ccw = norm(am - a0) < norm(a1 - a0);
        let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
        const N = Math.max(12, Math.ceil((Math.abs(sweep) * rr) / step));
        const arc = [];
        for (let i = 0; i <= N; i++) { const t = a0 + (sweep * i) / N; arc.push([ux + rr * Math.cos(t), uy + rr * Math.sin(t)]); }
        return { kind: 'arc', pts: toPts(arc, m), closed: false };
      }
    }
    return null;
  };

  /* ---------- grid lattices ---------- */
  const S3 = Math.sqrt(3) / 2;
  G.lattice = (type, s) => {
    // returns basis vectors e1, e2 for snapping; and directions for align
    switch (type) {
      case 'iso': return { e1: [s * S3, s / 2], e2: [0, s], dirs: [Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6] };
      case 'tri': return { e1: [s, 0], e2: [s / 2, s * S3], dirs: [0, Math.PI / 3, (2 * Math.PI) / 3] };
      case 'lined': return { e1: [s, 0], e2: [0, s], dirs: [0, Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4] };
      default: return { e1: [s, 0], e2: [0, s], dirs: [0, Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4] };
    }
  };
  G.snapLattice = (type, s, x, y) => {
    const { e1, e2 } = G.lattice(type, s);
    const det = e1[0] * e2[1] - e1[1] * e2[0];
    const u = (x * e2[1] - y * e2[0]) / det, v = (-x * e1[1] + y * e1[0]) / det;
    let best = null, bd = Infinity;
    for (const du of [Math.floor(u), Math.ceil(u)]) for (const dv of [Math.floor(v), Math.ceil(v)]) {
      const px = du * e1[0] + dv * e2[0], py = du * e1[1] + dv * e2[1];
      const d = hyp(px - x, py - y);
      if (d < bd) { bd = d; best = [px, py]; }
    }
    return best;
  };
  G.alignDir = (type, ang) => {
    const { dirs } = G.lattice(type, 1);
    let best = ang, bd = Infinity;
    for (const d0 of dirs) for (const d of [d0, d0 + Math.PI, d0 - Math.PI]) {
      const diff = Math.abs(((ang - d + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff < bd) { bd = diff; best = d; }
    }
    return best;
  };
})();
