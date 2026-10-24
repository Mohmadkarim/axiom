/* Axiom visual tools: subject diagram library (editable vector strokes) + "My visuals" */
'use strict';
(() => {
  const G = A.G, D = A.D, R = A.R, B = A.B, M = A.M, h = A.h;
  const S = A.settings;
  const V = (A.V = {});
  const PI = Math.PI;

  /* ---------- tiny single-stroke font for labels (cap height 1, y down) ---------- */
  const ell = (cx, cy, rx, ry, a0 = 0, a1 = 2 * PI, n = 24) => { const o = []; for (let i = 0; i <= n; i++) { const t = a0 + ((a1 - a0) * i) / n; o.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return o; };
  const GLYPH = {
    F: [[[0, 1], [0, 0], [0.55, 0]], [[0, 0.48], [0.45, 0.48]]],
    '2': [[[0.05, 0.25], [0.15, 0.05], [0.35, 0], [0.5, 0.08], [0.55, 0.25], [0.45, 0.45], [0, 1], [0.6, 1]]],
    '1': [[[0.1, 0.15], [0.3, 0], [0.3, 1]]],
    '0': [ell(0.28, 0.5, 0.26, 0.5)],
    O: [ell(0.3, 0.5, 0.3, 0.5)],
    x: [[[0, 0.4], [0.5, 1]], [[0.5, 0.4], [0, 1]]],
    y: [[[0, 0.4], [0.27, 0.78]], [[0.55, 0.4], [0.12, 1.15]]],
    z: [[[0, 0.4], [0.5, 0.4], [0, 1], [0.5, 1]]],
    v: [[[0, 0.4], [0.25, 1], [0.5, 0.4]]],
    '+': [[[0.3, 0.3], [0.3, 0.9]], [[0, 0.6], [0.6, 0.6]]],
    '-': [[[0.05, 0.6], [0.5, 0.6]]],
    "'": [[[0.12, 0], [0.06, 0.28]]],
    U: [[[0, 0], [0, 0.7], [0.08, 0.92], [0.25, 1], [0.42, 0.92], [0.5, 0.7], [0.5, 0]]],
    V: [[[0, 0], [0.28, 1], [0.56, 0]]],
    M: [[[0, 1], [0, 0], [0.3, 0.6], [0.6, 0], [0.6, 1]]],
    R: [[[0, 1], [0, 0], [0.35, 0], [0.5, 0.1], [0.5, 0.35], [0.35, 0.45], [0, 0.45]], [[0.25, 0.45], [0.55, 1]]],
    C: [[[0.55, 0.15], [0.4, 0], [0.2, 0], [0.05, 0.2], [0, 0.5], [0.05, 0.8], [0.2, 1], [0.4, 1], [0.55, 0.85]]],
    A: [[[0, 1], [0.28, 0], [0.56, 1]], [[0.12, 0.6], [0.44, 0.6]]],
    B: [[[0, 0], [0, 1], [0.38, 1], [0.52, 0.88], [0.52, 0.66], [0.38, 0.5], [0, 0.5]], [[0, 0], [0.32, 0], [0.46, 0.12], [0.46, 0.36], [0.32, 0.5]]],
    P: [[[0, 1], [0, 0], [0.38, 0], [0.5, 0.12], [0.5, 0.33], [0.38, 0.45], [0, 0.45]]],
    N: [[[0, 1], [0, 0], [0.55, 1], [0.55, 0]]],
    T: [[[0, 0], [0.56, 0]], [[0.28, 0], [0.28, 1]]],
    m: [[[0, 1], [0, 0.45]], [[0, 0.55], [0.12, 0.42], [0.25, 0.45], [0.28, 1]], [[0.28, 0.55], [0.4, 0.42], [0.53, 0.45], [0.56, 1]]],
    g: [[[0.45, 0.45], [0.45, 1.1], [0.35, 1.25], [0.1, 1.22]], [[0.45, 0.55], [0.32, 0.42], [0.12, 0.45], [0.02, 0.65], [0.1, 0.85], [0.3, 0.88], [0.45, 0.75]]],
    k: [[[0, 0], [0, 1]], [[0.45, 0.4], [0, 0.75]], [[0.15, 0.65], [0.5, 1]]],
    θ: [ell(0.27, 0.5, 0.25, 0.5), [[0.05, 0.5], [0.5, 0.5]]],
    φ: [[[0.27, 0], [0.27, 1.15]], ell(0.27, 0.62, 0.25, 0.3)],
    λ: [[[0.05, 0], [0.15, 0], [0.55, 1]], [[0.3, 0.45], [0, 1]]],
    γ: [[[0, 0.4], [0.28, 0.85]], [[0.55, 0.4], [0.2, 1.2]]],
    p: [[[0, 0.4], [0, 1.25]], ell(0.25, 0.68, 0.25, 0.28)],
    q: [[[0.5, 0.4], [0.5, 1.25]], ell(0.25, 0.68, 0.25, 0.28)],
  };

  /* ---------- primitive builder (stamp space roughly -100..100, y down) ---------- */
  const mk = () => {
    const P = [];
    const b = {
      P,
      line: (pts, o = {}) => (P.push(Object.assign({ k: 'line', pts }, o)), b),
      poly: (pts, o = {}) => b.line(pts.concat([pts[0]]), o),
      curve: (fn, n = 48, o = {}) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n)); P.push(Object.assign({ k: 'line', pts, smooth: true }, o)); return b; },
      ellipse: (cx, cy, rx, ry, o = {}, a0 = 0, a1 = 2 * PI, rot = 0) => {
        const n = Math.max(16, Math.ceil(Math.abs(a1 - a0) * 12));
        const c = Math.cos(rot), s = Math.sin(rot);
        return b.curve((t) => { const a = a0 + (a1 - a0) * t, x = rx * Math.cos(a), y = ry * Math.sin(a); return [cx + x * c - y * s, cy + x * s + y * c]; }, n, o);
      },
      circle: (cx, cy, r, o = {}) => b.ellipse(cx, cy, r, r, o),
      arrow: (x1, y1, x2, y2, o = {}) => {
        b.line([[x1, y1], [x2, y2]], o);
        const a = Math.atan2(y2 - y1, x2 - x1), L = o.head || 9;
        b.line([[x2 - L * Math.cos(a - 0.42), y2 - L * Math.sin(a - 0.42)], [x2, y2], [x2 - L * Math.cos(a + 0.42), y2 - L * Math.sin(a + 0.42)]], o);
        return b;
      },
      dash: (pts, o = {}) => b.line(pts, Object.assign({ dash: true }, o)),
      fill: (pts, o = {}) => (P.push(Object.assign({ k: 'fill', pts }, o)), b),
      dot: (x, y, r = 2.6, o = {}) => b.fill(ell(x, y, r, r, 0, 2 * PI, 14), Object.assign({ op: 1 }, o)),
      hatch: (x1, y1, x2, y2, o = {}) => {
        b.line([[x1, y1], [x2, y2]], o);
        const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(L / 9));
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L, side = o.side || 1;
        const nx = -uy * side, ny = ux * side;
        for (let i = 0; i <= n; i++) {
          const px = x1 + ux * (L * i) / n, py = y1 + uy * (L * i) / n;
          b.line([[px, py], [px + (nx - ux) * 7, py + (ny - uy) * 7]], Object.assign({ w: 0.7 }, o));
        }
        return b;
      },
      text: (str, x, y, size = 12, o = {}) => {
        let cx = x;
        for (const ch of String(str)) {
          const gl = GLYPH[ch];
          if (gl) for (const s of gl) b.line(s.map(([gx, gy]) => [cx + gx * size, y - size + gy * size]), Object.assign({ w: 0.8 }, o));
          cx += (ch === "'" ? 0.3 : 0.8) * size;
        }
        return b;
      },
      wave: (x0, x1, y, amp, periods, o = {}, phase = 0) => b.curve((t) => [x0 + (x1 - x0) * t, y - amp * Math.sin(phase + t * periods * 2 * PI)], Math.ceil(periods * 40), o),
    };
    return b;
  };

  const RAY = '#d64545', VEC = '#2f6fdb', SOFT = '#7fb3d5';

  /* ---------- library ---------- */
  const L = [];
  const add = (area, id, name, fn) => L.push({ area, id, name, fn });

  /* Math */
  add('math', 'axes2d', 'xy axes', (b) => {
    b.arrow(-95, 0, 95, 0).arrow(0, 75, 0, -75);
    for (let i = -80; i <= 80; i += 20) if (i) { b.line([[i, -3], [i, 3]], { w: 0.7 }); if (Math.abs(i) <= 60) b.line([[-3, i], [3, i]], { w: 0.7 }); }
    b.text('x', 88, 18, 11).text('y', 9, -66, 11);
  });
  add('math', 'axes3d', 'xyz axes', (b) => {
    b.arrow(0, 10, 0, -80).arrow(0, 10, 85, 10).arrow(0, 10, -55, 60);
    b.text('z', 7, -70, 11).text('y', 82, 30, 11).text('x', -66, 66, 11);
  });
  add('math', 'unitcircle', 'Unit circle', (b) => {
    b.arrow(-85, 0, 85, 0, { w: 0.8 }).arrow(0, 80, 0, -80, { w: 0.8 });
    b.circle(0, 0, 62);
    const a = -0.75; const px = 62 * Math.cos(a), py = 62 * Math.sin(a);
    b.line([[0, 0], [px, py]], { c: RAY }).dot(px, py, 2.8, { c: RAY });
    b.dash([[px, py], [px, 0]]).dash([[px, py], [0, py]]);
    b.ellipse(0, 0, 16, 16, { w: 0.8 }, a, 0).text('θ', 18, -4, 9);
  });
  add('math', 'numberline', 'Number line', (b) => {
    b.arrow(-95, 0, 95, 0).arrow(95, 0, -95, 0);
    [-2, -1, 0, 1, 2].forEach((k) => { b.line([[k * 35, -5], [k * 35, 5]]); b.text(String(Math.abs(k)), k * 35 - (k < 0 ? 9 : 3), 22, 10); if (k < 0) b.text('-', k * 35 - 14, 22, 10); });
  });
  add('math', 'venn2', 'Venn diagram (2)', (b) => {
    b.poly([[-95, -65], [95, -65], [95, 65], [-95, 65]], { w: 0.8 });
    b.circle(-25, 0, 45).circle(25, 0, 45).text('A', -60, -30, 11).text('B', 52, -30, 11);
  });
  add('math', 'venn3', 'Venn diagram (3)', (b) => {
    b.circle(-24, -16, 42).circle(24, -16, 42).circle(0, 24, 42);
  });
  add('math', 'triangle', 'Right triangle', (b) => {
    b.poly([[-70, 45], [70, 45], [70, -45]]);
    b.line([[58, 45], [58, 33], [70, 33]], { w: 0.8 });
    b.ellipse(-70, 45, 26, 26, { w: 0.8 }, -0.57, 0).text('θ', -38, 38, 9);
  });
  add('math', 'vector', 'Vector components', (b) => {
    b.arrow(-60, 45, 60, -45, { c: VEC }).dash([[60, -45], [60, 45]]).dash([[-60, 45], [60, 45]]);
    b.text('v', -6, -12, 11, { c: VEC });
  });
  add('math', 'sine', 'Sine graph', (b) => {
    b.arrow(-95, 0, 95, 0, { w: 0.8 }).arrow(-85, 60, -85, -60, { w: 0.8 });
    b.wave(-85, 85, 0, 40, 1, { c: VEC });
  });
  add('math', 'parabola', 'Parabola', (b) => {
    b.arrow(-90, 50, 90, 50, { w: 0.8 }).arrow(0, 60, 0, -75, { w: 0.8 });
    b.curve((t) => { const x = -70 + 140 * t; return [x, 50 - (x * x) / 45]; }, 48, { c: VEC });
  });

  /* Topology & geometry */
  add('topo', 'torus', 'Torus', (b) => {
    b.ellipse(0, 0, 92, 46);
    b.ellipse(0, -8, 46, 18, {}, 0.12 * PI, 0.88 * PI);
    b.ellipse(0, 12, 33, 12, {}, 1.15 * PI, 1.85 * PI);
  });
  add('topo', 'sphere', 'Sphere', (b) => {
    b.circle(0, 0, 70).ellipse(0, 0, 70, 18, {}, 0, PI).ellipse(0, 0, 70, 18, { dash: true }, PI, 2 * PI);
  });
  add('topo', 'tangentplane', 'Tangent plane', (b) => {
    b.circle(0, 10, 62).ellipse(0, 10, 62, 16, {}, 0, PI).ellipse(0, 10, 62, 16, { dash: true }, PI, 2 * PI);
    const px = 30, py = -40;
    b.fill([[px - 55, py + 8], [px + 15, py - 22], [px + 75, py - 6], [px + 5, py + 24]], { c: SOFT, op: 0.35 });
    b.poly([[px - 55, py + 8], [px + 15, py - 22], [px + 75, py - 6], [px + 5, py + 24]], { w: 0.8 });
    b.dot(px + 10, py + 1).arrow(px + 10, py + 1, px + 32, py - 52, { c: VEC }).text('p', px + 2, py + 22, 9);
  });
  add('topo', 'mobius', 'Möbius strip', (b) => {
    const P = (u, v) => { const r = 1 + (v / 2) * Math.cos(u / 2), x = r * Math.cos(u), y = r * Math.sin(u), z = (v / 2) * Math.sin(u / 2); return [x * 62, y * 24 - z * 48]; };
    b.curve((t) => P(t * 4 * PI, 1), 160);
    for (let k = 0; k < 14; k++) { const u = (k / 14) * 2 * PI; b.line([P(u, -1), P(u, 1)], { w: 0.5, op: 0.6 }); }
  });
  add('topo', 'openset', 'Open set & ball', (b) => {
    const blob = (t) => { const a = t * 2 * PI, r = 70 + 12 * Math.sin(3 * a) + 7 * Math.cos(5 * a); return [r * Math.cos(a) * 1.15, r * Math.sin(a) * 0.8]; };
    b.curve(blob, 90, { dash: true });
    b.dot(10, 5).circle(10, 5, 20, { dash: true, c: VEC }).text('U', -78, -38, 12).text('p', 15, 0, 8);
  });
  add('topo', 'chart', 'Chart φ: U → ℝⁿ', (b) => {
    const blob = (cx, cy, s) => (t) => { const a = t * 2 * PI, r = s * (1 + 0.15 * Math.sin(3 * a)); return [cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.75]; };
    b.curve(blob(-55, 0, 42), 60).text('M', -92, -32, 11);
    const inner = []; for (let i = 0; i <= 40; i++) inner.push(blob(-50, 4, 18)(i / 40));
    b.fill(inner, { c: SOFT, op: 0.5 }).line(inner, { w: 0.7 }).text('U', -56, 10, 8);
    b.poly([[25, -35], [95, -35], [95, 35], [25, 35]], { w: 0.8 });
    const img = []; for (let i = 0; i <= 40; i++) img.push(blob(60, 0, 18)(i / 40));
    b.fill(img, { c: SOFT, op: 0.5 }).line(img, { w: 0.7 });
    b.curve((t) => [-30 + 75 * t, -18 - 22 * Math.sin(PI * t)], 24, { w: 0.8 });
    b.line([[38, -24], [45, -18], [36, -13]], { w: 0.8 }).text('φ', 2, -44, 9);
  });
  add('topo', 'patch', 'Surface patch', (b) => {
    const P = (u, v) => { const x = u, y = v, z = 0.35 * (u * u - v * v); return [(x - y) * 52, (x + y) * 22 - z * 55]; };
    for (let i = 0; i <= 6; i++) { const s = -1 + i / 3; b.curve((t) => P(-1 + 2 * t, s), 30, { w: 0.7 }); b.curve((t) => P(s, -1 + 2 * t), 30, { w: 0.7 }); }
  });
  add('topo', 'curvetangent', 'Curve & tangent', (b) => {
    b.curve((t) => [-85 + 170 * t, 20 - 45 * Math.sin(t * PI * 1.2) + 10 * Math.cos(t * 7)], 80);
    const t = 0.32, x = -85 + 170 * t, y = 20 - 45 * Math.sin(t * PI * 1.2) + 10 * Math.cos(t * 7);
    const dx = 170, dy = -45 * PI * 1.2 * Math.cos(t * PI * 1.2) - 70 * Math.sin(t * 7), L = Math.hypot(dx, dy);
    b.dot(x, y).arrow(x, y, x + (dx / L) * 55, y + (dy / L) * 55, { c: VEC }).text('γ', x - 6, y + 22, 9);
  });
  add('topo', 'disk', 'Closed disk', (b) => {
    const c = []; for (let i = 0; i <= 60; i++) { const a = (i / 60) * 2 * PI; c.push([60 * Math.cos(a), 60 * Math.sin(a)]); }
    b.fill(c, { c: SOFT, op: 0.35 }).line(c);
  });

  /* Optics */
  const axisF = (b) => {
    b.line([[-100, 0], [100, 0]], { w: 0.7 });
    [-45, 45].forEach((x) => { b.dot(x, 0, 2.2); b.text('F', x - 4, 18, 9); });
    [-90, 90].forEach((x) => { b.dot(x, 0, 2.2); b.text('2F', x - 8, 18, 9); });
  };
  add('optics', 'convexlens', 'Converging lens', (b) => {
    b.ellipse(0, 0, 12, 60, {}, 0.5 * PI, 1.5 * PI).ellipse(0, 0, 12, 60, {}, -0.5 * PI, 0.5 * PI); axisF(b);
  });
  add('optics', 'concavelens', 'Diverging lens', (b) => {
    b.line([[-16, -58], [16, -58]]).line([[-16, 58], [16, 58]]);
    b.curve((t) => { const y = -58 + 116 * t; return [-16 + 11 * Math.cos((y / 58) * (PI / 2)), y]; }, 30);
    b.curve((t) => { const y = -58 + 116 * t; return [16 - 11 * Math.cos((y / 58) * (PI / 2)), y]; }, 30);
    axisF(b);
  });
  add('optics', 'raydiagram', 'Lens ray diagram', (b) => {
    b.ellipse(0, 0, 9, 55, {}, 0.5 * PI, 1.5 * PI).ellipse(0, 0, 9, 55, {}, -0.5 * PI, 0.5 * PI);
    b.line([[-100, 0], [100, 0]], { w: 0.7 });
    [-35, 35].forEach((x) => { b.dot(x, 0, 2.2); b.text('F', x - 4, 16, 8); });
    b.arrow(-70, 0, -70, -30, { c: VEC }).arrow(70, 0, 70, 30, { c: VEC, dash: true });
    b.line([[-70, -30], [0, -30], [80, 34.3]], { c: RAY, w: 0.8 });
    b.line([[-70, -30], [80, 34.3]], { c: RAY, w: 0.8 });
    b.line([[-70, -30], [0, 30], [90, 30]], { c: RAY, w: 0.8 });
  });
  add('optics', 'concavemirror', 'Concave mirror', (b) => {
    b.ellipse(150, 0, 150, 150, {}, PI - 0.38, PI + 0.38);
    for (let k = -5; k <= 5; k++) { const a = PI + k * 0.07; const x = 150 + 150 * Math.cos(a), y = 150 * Math.sin(a); b.line([[x, y], [x - 8, y + 6]], { w: 0.6 }); }
    b.line([[-100, 0], [100, 0]], { w: 0.7 }); b.dot(75, 0, 2.2).text('F', 71, 18, 9);
  });
  add('optics', 'convexmirror', 'Convex mirror', (b) => {
    b.ellipse(-150, 0, 150, 150, {}, -0.38, 0.38);
    for (let k = -5; k <= 5; k++) { const a = k * 0.07; const x = -150 + 150 * Math.cos(a), y = 150 * Math.sin(a); b.line([[x, y], [x + 8, y + 6]], { w: 0.6 }); }
    b.line([[-100, 0], [100, 0]], { w: 0.7 }); b.dot(-75, 0, 2.2).text('F', -79, 18, 9);
  });
  add('optics', 'planemirror', 'Plane mirror reflection', (b) => {
    b.hatch(0, -65, 0, 65, { side: 1 });
    b.dash([[-80, 0], [0, 0]]);
    b.arrow(-75, -55, -2, -2, { c: RAY }).arrow(-2, 2, -75, 55, { c: RAY });
    b.ellipse(0, 0, 22, 22, { w: 0.7 }, PI + 0.2, PI + 0.62).ellipse(0, 0, 22, 22, { w: 0.7 }, PI - 0.62, PI - 0.2);
  });
  add('optics', 'prism', 'Prism dispersion', (b) => {
    b.poly([[-50, 50], [50, 50], [0, -45]]);
    b.line([[-100, 5], [-24, 0]], { w: 1.2 });
    b.line([[-24, 0], [24, 8]], { w: 0.8, op: 0.6 });
    [['#d64545', -6], ['#e8a33a', 2], ['#2f9e6b', 10], ['#3f63d6', 18], ['#8e5bd6', 26]].forEach(([c, d]) => b.line([[24, 8], [100, 18 + d * 1.6]], { c, w: 0.9 }));
  });
  add('optics', 'object', 'Object arrow', (b) => { b.arrow(0, 40, 0, -45, { c: VEC, head: 11 }); b.line([[-40, 40], [40, 40]], { w: 0.7 }); });
  add('optics', 'eye', 'Eye', (b) => {
    b.curve((t) => [-60 + 120 * t, -30 * Math.sin(PI * t)], 30).curve((t) => [-60 + 120 * t, 30 * Math.sin(PI * t)], 30);
    b.circle(0, 0, 22).dot(0, 0, 9);
  });

  /* Mechanics */
  add('mech', 'incline', 'Incline & block', (b) => {
    const a = Math.atan2(80, 170);
    b.poly([[-90, 45], [80, 45], [80, -35]]);
    const cx = -5, cy = 45 - 85 * Math.tan(a) - 1;
    const c = Math.cos(-a), s = Math.sin(-a);
    const blk = [[-18, 0], [18, 0], [18, -26], [-18, -26]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    b.poly(blk);
    b.ellipse(-90, 45, 30, 30, { w: 0.8 }, -a, 0).text('θ', -54, 40, 9);
  });
  add('mech', 'inclinefbd', 'Incline free-body', (b) => {
    const a = Math.atan2(80, 170);
    b.poly([[-90, 45], [80, 45], [80, -35]], { w: 0.8 });
    const cx = -5, cy = 45 - 85 * Math.tan(a) - 1, c = Math.cos(-a), s = Math.sin(-a);
    const T = ([x, y]) => [cx + x * c - y * s, cy + x * s + y * c];
    b.poly([[-18, 0], [18, 0], [18, -26], [-18, -26]].map(T));
    const [mx, my] = T([0, -13]);
    b.arrow(mx, my, mx, my + 55, { c: VEC }).text('mg', mx + 5, my + 58, 8, { c: VEC });
    const [nx, ny] = T([0, -60]); b.arrow(mx, my, nx, ny, { c: RAY }).text('N', nx - 12, ny, 9, { c: RAY });
    const [fx, fy] = T([-55, -13]); b.arrow(mx, my, fx, fy, { c: '#2f9e6b' });
  });
  add('mech', 'blockground', 'Block & force', (b) => {
    b.hatch(-90, 40, 90, 40, { side: -1 });
    b.poly([[-25, 40], [25, 40], [25, 0], [-25, 0]]);
    b.arrow(25, 20, 80, 20, { c: VEC }).text('F', 82, 12, 9, { c: VEC });
  });
  add('mech', 'spring', 'Spring & mass', (b) => {
    b.hatch(-85, -40, -85, 40, { side: -1 });
    const pts = [[-85, 0], [-70, 0]]; for (let i = 0; i < 9; i++) pts.push([-64 + i * 9, i % 2 ? 12 : -12]); pts.push([20, 0], [30, 0]);
    b.line(pts).poly([[30, -22], [75, -22], [75, 22], [30, 22]]).hatch(-90, 26, 90, 26, { side: -1 }).text('k', -30, -22, 9);
  });
  add('mech', 'pulley', 'Pulley (Atwood)', (b) => {
    b.hatch(-50, -80, 50, -80, { side: 1 });
    b.line([[0, -80], [0, -55]]).circle(0, -40, 15).dot(0, -40, 2);
    b.line([[-15, -40], [-15, 20]]).line([[15, -40], [15, 40]]);
    b.poly([[-30, 20], [0, 20], [0, 50], [-30, 50]].map(([x, y]) => [x + 0, y])).poly([[5, 40], [30, 40], [30, 60], [5, 60]]);
  });
  add('mech', 'pendulum', 'Pendulum', (b) => {
    b.hatch(-50, -70, 50, -70, { side: 1 });
    const a = 0.45, L = 105, x = L * Math.sin(a), y = -70 + L * Math.cos(a);
    b.dash([[0, -70], [0, 45]]).line([[0, -70], [x, y]]).circle(x, y, 10).dot(x, y, 4);
    b.ellipse(0, -70, 30, 30, { w: 0.8 }, PI / 2 - a, PI / 2).text('θ', 6, -28, 9);
  });
  add('mech', 'fbd', 'Free-body diagram', (b) => {
    b.poly([[-16, -16], [16, -16], [16, 16], [-16, 16]]);
    b.arrow(0, -16, 0, -70, { c: RAY }).arrow(0, 16, 0, 70, { c: VEC }).arrow(16, 0, 75, 0, { c: '#2f9e6b' }).arrow(-16, 0, -60, 0, { c: '#d99a22' });
    b.text('N', 6, -60, 9, { c: RAY }).text('mg', 6, 72, 8, { c: VEC }).text('F', 70, -8, 9, { c: '#2f9e6b' });
  });
  add('mech', 'cart', 'Cart', (b) => {
    b.poly([[-50, -10], [50, -10], [50, 20], [-50, 20]]).circle(-30, 30, 10).circle(30, 30, 10).line([[-95, 40], [95, 40]], { w: 0.8 });
  });
  add('mech', 'projectile', 'Projectile motion', (b) => {
    b.arrow(-90, 50, 95, 50, { w: 0.8 }).arrow(-80, 60, -80, -70, { w: 0.8 });
    b.curve((t) => [-80 + 160 * t, 50 - 380 * t * (1 - t) * 0.4], 40, { dash: true });
    b.arrow(-80, 50, -40, 10, { c: VEC }).ellipse(-80, 50, 22, 22, { w: 0.8 }, -PI / 4, 0).text('θ', -54, 44, 8);
  });
  add('mech', 'circular', 'Circular motion', (b) => {
    b.circle(0, 0, 55, { dash: true }).dot(0, 0, 2);
    const a = -PI / 4, x = 55 * Math.cos(a), y = 55 * Math.sin(a);
    b.dot(x, y, 6).arrow(x, y, x + 30, y + 30, { c: VEC }).arrow(x, y, x * 0.45, y * 0.45, { c: RAY });
  });

  /* Circuits */
  const leads = (b, a, c) => b.line([[-70, 0], [a, 0]]).line([[c, 0], [70, 0]]);
  add('circuits', 'resistor', 'Resistor', (b) => { leads(b, -30, 30); const p = [[-30, 0]]; for (let i = 0; i < 6; i++) p.push([-25 + i * 10, i % 2 ? 11 : -11]); p.push([30, 0]); b.line(p); });
  add('circuits', 'capacitor', 'Capacitor', (b) => { leads(b, -6, 6); b.line([[-6, -22], [-6, 22]], { w: 1.4 }).line([[6, -22], [6, 22]], { w: 1.4 }); });
  add('circuits', 'inductor', 'Inductor', (b) => { leads(b, -36, 36); for (let i = 0; i < 4; i++) b.ellipse(-27 + i * 18, 0, 9, 11, {}, PI, 2 * PI); });
  add('circuits', 'battery', 'Battery', (b) => { leads(b, -5, 5); b.line([[-5, -24], [-5, 24]]).line([[5, -12], [5, 12]], { w: 2 }); b.text('+', -20, -24, 10).text('-', 9, -24, 10); });
  add('circuits', 'ac', 'AC source', (b) => { leads(b, -22, 22); b.circle(0, 0, 22).wave(-12, 12, 0, 7, 1); });
  add('circuits', 'switch', 'Switch', (b) => { leads(b, -20, 20); b.dot(-20, 0, 2.6).dot(20, 0, 2.6).line([[-20, 0], [16, -18]]); });
  add('circuits', 'ground', 'Ground', (b) => { b.line([[0, -50], [0, 0]]).line([[-24, 0], [24, 0]]).line([[-15, 8], [15, 8]]).line([[-6, 16], [6, 16]]); });
  add('circuits', 'diode', 'Diode', (b) => { leads(b, -14, 14); b.poly([[-14, -16], [-14, 16], [14, 0]]).line([[14, -16], [14, 16]]); });
  add('circuits', 'lamp', 'Lamp', (b) => { leads(b, -20, 20); b.circle(0, 0, 20).line([[-14, -14], [14, 14]]).line([[-14, 14], [14, -14]]); });
  add('circuits', 'ammeter', 'Ammeter', (b) => { leads(b, -20, 20); b.circle(0, 0, 20).text('A', -5, 7, 13); });
  add('circuits', 'voltmeter', 'Voltmeter', (b) => { leads(b, -20, 20); b.circle(0, 0, 20).text('V', -5, 7, 13); });
  add('circuits', 'loop', 'Series circuit', (b) => {
    b.line([[-70, -10], [-70, -50], [-25, -50]]); const p = [[-25, -50]]; for (let i = 0; i < 6; i++) p.push([-20 + i * 9, i % 2 ? -40 : -60]); p.push([30, -50]); b.line(p);
    b.line([[30, -50], [70, -50], [70, 50], [-70, 50], [-70, 10]]);
    b.line([[-84, -10], [-56, -10]]).line([[-77, 10], [-63, 10]], { w: 2 });
  });

  /* Waves & thermo */
  add('waves', 'wave', 'Wave (λ, A)', (b) => {
    b.arrow(-95, 0, 95, 0, { w: 0.8 }); b.wave(-85, 85, 0, 35, 2, { c: VEC });
    b.arrow(-63, -48, 22, -48, { w: 0.7, head: 6 }).arrow(22, -48, -63, -48, { w: 0.7, head: 6 }).text('λ', -26, -54, 9);
    b.dash([[-63, -35], [90, -35]]).text('A', 82, -40, 8);
  });
  add('waves', 'standing', 'Standing wave', (b) => {
    b.line([[-85, 0], [85, 0]], { w: 0.6 }); b.dot(-85, 0).dot(85, 0);
    b.curve((t) => [-85 + 170 * t, -35 * Math.sin(t * 3 * PI)], 60, { c: VEC }).curve((t) => [-85 + 170 * t, 35 * Math.sin(t * 3 * PI)], 60, { c: VEC, dash: true });
  });
  add('waves', 'pv', 'P–V diagram', (b) => {
    b.arrow(-80, 60, 90, 60, { w: 0.8 }).arrow(-80, 70, -80, -75, { w: 0.8 }).text('V', 82, 78, 10).text('P', -96, -62, 10);
    b.curve((t) => { const v = 0.25 + t; return [-80 + v * 130, 60 - 30 / v]; }, 40, { c: VEC });
  });
  add('waves', 'carnot', 'Carnot cycle', (b) => {
    b.arrow(-85, 65, 90, 65, { w: 0.8 }).arrow(-85, 75, -85, -75, { w: 0.8 }).text('V', 82, 82, 10).text('P', -100, -62, 10);
    const iso = (k, v0, v1) => (t) => { const v = v0 + (v1 - v0) * t; return [-85 + v * 140, 65 - k / v]; };
    b.curve(iso(30, 0.35, 0.6), 20, { c: RAY }).curve(iso(14, 0.75, 1.1), 20, { c: VEC });
    b.curve((t) => { const a = iso(30, 0.6, 0.6)(0), c = iso(14, 1.1, 1.1)(0); return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * Math.pow(t, 0.7)]; }, 20);
    b.curve((t) => { const a = iso(30, 0.35, 0.35)(0), c = iso(14, 0.75, 0.75)(0); return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * Math.pow(t, 0.7)]; }, 20);
  });
  add('waves', 'piston', 'Gas in a piston', (b) => {
    b.line([[-50, -60], [-50, 60], [50, 60], [50, -60]]).poly([[-48, -20], [48, -20], [48, -32], [-48, -32]]).line([[0, -32], [0, -80]], { w: 1.4 });
    [[-30, 10], [10, 0], [25, 35], [-15, 40], [-35, 30], [30, 12], [0, 25]].forEach(([x, y]) => b.dot(x, y, 2.4));
  });

  /* Chemistry */
  const hex = (cx, cy, r, rot = PI / 6) => { const o = []; for (let i = 0; i < 6; i++) { const a = rot + (i * PI) / 3; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; };
  add('chem', 'benzene', 'Benzene', (b) => { b.poly(hex(0, 0, 50)).circle(0, 0, 30); });
  add('chem', 'naphthalene', 'Fused rings', (b) => { b.poly(hex(-36, 0, 42)).poly(hex(37, 0, 42)); });
  add('chem', 'tetrahedral', 'Tetrahedral (wedge/dash)', (b) => {
    b.dot(0, 0, 4).line([[0, 0], [0, -60]]).line([[0, 0], [-55, 30]]);
    b.fill([[0, 0], [58, 20], [52, 34]], { op: 1 });
    for (let i = 1; i <= 6; i++) { const t = i / 6, px = 14 * t, py = 58 * t, hw = 7 * t; b.line([[px - hw * 0.97, py + hw * 0.24], [px + hw * 0.97, py - hw * 0.24]], { w: 0.8 }); }
  });
  add('chem', 'porbital', 'p orbital', (b) => {
    b.curve((t) => { const a = -PI / 2 + t * PI; const r = 70 * Math.cos(a) ** 2; return [r * Math.sin(a) * 0.6, -r * Math.cos(a)]; }, 40);
    b.curve((t) => { const a = -PI / 2 + t * PI; const r = 70 * Math.cos(a) ** 2; return [r * Math.sin(a) * 0.6, r * Math.cos(a)]; }, 40);
    b.dash([[0, -85], [0, 85]]);
  });
  add('chem', 'atom', 'Atom (Bohr)', (b) => {
    b.dot(0, 0, 7).ellipse(0, 0, 75, 26, {}, 0, 2 * PI, 0.5).ellipse(0, 0, 75, 26, {}, 0, 2 * PI, -0.5).ellipse(0, 0, 75, 26, {}, 0, 2 * PI, PI / 2);
    b.dot(65, 37, 3.5, { c: VEC }).dot(-22, -71, 3.5, { c: VEC });
  });

  /* Computer science */
  add('cs', 'bintree', 'Binary tree', (b) => {
    const N = [[0, -60], [-50, -10], [50, -10], [-75, 45], [-25, 45], [25, 45], [75, 45]];
    [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]].forEach(([i, j]) => { const [x1, y1] = N[i], [x2, y2] = N[j], L = Math.hypot(x2 - x1, y2 - y1); b.line([[x1 + ((x2 - x1) / L) * 13, y1 + ((y2 - y1) / L) * 13], [x2 - ((x2 - x1) / L) * 13, y2 - ((y2 - y1) / L) * 13]]); });
    N.forEach(([x, y]) => b.circle(x, y, 13));
  });
  add('cs', 'graph', 'Directed graph', (b) => {
    const N = []; for (let i = 0; i < 5; i++) { const a = -PI / 2 + (i * 2 * PI) / 5; N.push([60 * Math.cos(a), 60 * Math.sin(a)]); }
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2], [1, 3]].forEach(([i, j]) => { const [x1, y1] = N[i], [x2, y2] = N[j], L = Math.hypot(x2 - x1, y2 - y1); b.arrow(x1 + ((x2 - x1) / L) * 12, y1 + ((y2 - y1) / L) * 12, x2 - ((x2 - x1) / L) * 13, y2 - ((y2 - y1) / L) * 13, { head: 7 }); });
    N.forEach(([x, y]) => b.circle(x, y, 11));
  });
  add('cs', 'array', 'Array', (b) => { for (let i = 0; i < 6; i++) { b.poly([[-90 + i * 30, -15], [-60 + i * 30, -15], [-60 + i * 30, 15], [-90 + i * 30, 15]]); b.text(String(i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2), -79 + i * 30, 34, 8); } });
  add('cs', 'linkedlist', 'Linked list', (b) => { for (let i = 0; i < 3; i++) { const x = -90 + i * 65; b.poly([[x, -15], [x + 40, -15], [x + 40, 15], [x, 15]]).line([[x + 26, -15], [x + 26, 15]]); b.arrow(x + 33, 0, x + 64, 0, { head: 7 }); } });
  add('cs', 'fsm', 'State machine', (b) => {
    b.circle(-60, 0, 20).circle(60, 0, 20).circle(60, 0, 15);
    b.curve((t) => [-42 + 84 * t, -12 - 26 * Math.sin(PI * t)], 24).line([[34, -18], [42, -12], [33, -6]]);
    b.curve((t) => [42 - 84 * t, 12 + 26 * Math.sin(PI * t)], 24).line([[-34, 18], [-42, 12], [-33, 6]]);
    b.arrow(-100, 0, -80, 0, { head: 6 });
  });

  V.areas = [
    { id: 'math', name: 'Math' }, { id: 'topo', name: 'Topology & geometry' }, { id: 'optics', name: 'Optics' },
    { id: 'mech', name: 'Mechanics' }, { id: 'circuits', name: 'Circuits' }, { id: 'waves', name: 'Waves & thermo' },
    { id: 'chem', name: 'Chemistry' }, { id: 'cs', name: 'Computer science' },
  ];
  const MAJOR_AREAS = { math: ['math', 'topo'], physics: ['mech', 'optics', 'waves', 'circuits', 'math'], ee: ['circuits', 'waves', 'math'], me: ['mech', 'waves', 'math'], chem: ['chem', 'math'], cs: ['cs', 'math'], bio: ['chem'] };
  V.orderedAreas = () => {
    const first = [];
    (S.majors || []).forEach((m) => (MAJOR_AREAS[m] || []).forEach((a) => { if (!first.includes(a)) first.push(a); }));
    return first.concat(V.areas.map((a) => a.id).filter((a) => !first.includes(a))).map((id) => V.areas.find((a) => a.id === id));
  };
  V.library = L;

  /* ---------- primitives → stroke items ---------- */
  const flat = (pts) => { const o = []; for (const [x, y] of pts) o.push(x, y, 1); return o; };
  const dashSplit = (pts, dl, gl) => {
    const out = []; let cur = [pts[0]], on = true, acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
      let seg = Math.hypot(bx - ax, by - ay);
      while (seg > 0) {
        const lim = on ? dl : gl, step = Math.min(seg, lim - acc);
        const t = step / seg, nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t;
        if (on) cur.push([nx, ny]);
        acc += step; seg -= step; ax = nx; ay = ny;
        if (acc >= lim - 1e-9) { if (on && cur.length > 1) out.push(cur); on = !on; acc = 0; cur = [[ax, ay]]; }
      }
    }
    if (on && cur.length > 1) out.push(cur);
    return out;
  };
  /* scale: world units per stamp unit; lw: base line width in world units */
  V.toItems = (prims, { cx = 0, cy = 0, scale = 1, lw = 2, color = '#1a1e26' } = {}) => {
    const items = [];
    const T = ([x, y]) => [cx + x * scale, cy + y * scale];
    for (const p of prims) {
      const col = p.c || color;
      if (p.k === 'fill') {
        items.push(D.makeStroke('fill', col, 1, p.op ?? 0.2, flat(p.pts.map(T)), { sharp: true }));
        continue;
      }
      const pts = p.pts.map(T);
      const w = lw * (p.w || 1);
      const parts = p.dash ? dashSplit(pts, 7 * scale, 5 * scale) : [pts];
      for (const part of parts) items.push(D.makeStroke('fineliner', col, w, p.op ?? 1, flat(part), p.smooth && !p.dash ? {} : { sharp: true }));
    }
    return items;
  };
  V.build = (stamp) => { const b = mk(); stamp.fn(b); return b.P; };

  /* ---------- insert ---------- */
  V.insertItems = (items) => {
    let l = D.active();
    if (l.locked || !l.visible) l = D.addLayer();
    D.begin(); D.addItems(items, l); D.commit();
    A.emit('tool:select');
    A.SEL.set(items.map((i) => i.id));
    A.emit('layers:thumbs');
  };
  V.insert = (stamp) => {
    const z = D.doc.view.zoom;
    const [cx, cy] = R.toWorld(R.w / 2, R.h / 2);
    const slot = B.slot();
    const color = B.isDrawing(slot.b) && slot.b !== 'highlighter' && slot.b !== 'marker' ? slot.color : '#1a1e26';
    const scale = Math.min(R.w, R.h) * 0.0016 / z;
    V.insertItems(V.toItems(V.build(stamp), { cx, cy, scale, lw: 2 / z, color }));
  };

  /* ---------- thumbnails ---------- */
  const thumbCache = new Map();
  const thumbFor = (key, items) => {
    if (thumbCache.has(key)) return thumbCache.get(key);
    let bb = null; items.forEach((it) => (bb = G.bbUnion(bb, it.bb)));
    if (!bb) return '';
    const pad = 8, size = Math.max(bb[2] - bb[0], bb[3] - bb[1]) + pad * 2;
    const cxx = (bb[0] + bb[2]) / 2, cyy = (bb[1] + bb[3]) / 2;
    const reg = [cxx - size / 2, cyy - size / 2, cxx + size / 2, cyy + size / 2];
    const fake = { paper: { bg: '#ffffff', grid: { type: 'none' } }, layers: [{ id: 'x', visible: true, opacity: 1, items }], precision: { grid: false } };
    const c = R.renderRegion(fake, reg, 150 / size, { bg: false });
    const url = c.toDataURL('image/png');
    thumbCache.set(key, url);
    return url;
  };
  V.stampThumb = (stamp) => thumbFor('s:' + stamp.id, V.toItems(V.build(stamp), { scale: 1, lw: 2.2 }));

  /* ---------- My visuals (saved from selections) ---------- */
  V.saveSelection = async () => {
    const items = A.SEL.items().map((x) => x.it);
    if (!items.length) return;
    const name = await A.dialog({ title: 'Save as visual', body: 'Reuse this drawing from the Visuals library, so you never redraw it.', input: 'My visual', okText: 'Save' });
    if (!name) return;
    let bb = null; items.forEach((it) => (bb = G.bbUnion(bb, it.bb)));
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const norm = items.map((it) => D.transformItem(it, M.translate(-cx, -cy), false));
    const id = A.uid();
    const thumb = thumbFor('v:' + id, norm);
    await A.store.saveFile('vis_' + id, new Blob([JSON.stringify(norm)], { type: 'application/json' }));
    S.visuals = (S.visuals || []).concat([{ id, name: name.slice(0, 40), subject: D.doc.subject || null, thumb, added: Date.now() }]);
    A.saveSettings();
    A.toast('Saved to My visuals');
  };
  V.insertSaved = async (meta) => {
    const blob = await A.store.loadFile('vis_' + meta.id, 'application/json');
    if (!blob) return A.toast('That visual could not be loaded');
    const items = JSON.parse(await blob.text());
    let bb = null; items.forEach((it) => (bb = G.bbUnion(bb, it.bb)));
    const [cx, cy] = R.toWorld(R.w / 2, R.h / 2);
    const z = D.doc.view.zoom, size = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * z;
    const k = size > Math.min(R.w, R.h) * 0.7 || size < 40 ? (Math.min(R.w, R.h) * 0.35) / size : 1;
    const T = M.mul(M.translate(cx, cy), M.scale(k));
    V.insertItems(items.map((it) => D.transformItem(Object.assign({}, it, { id: A.uid() }), T, true)));
  };
  V.deleteSaved = async (meta) => {
    S.visuals = (S.visuals || []).filter((v) => v.id !== meta.id); A.saveSettings();
    try { await A.store.deleteFile('vis_' + meta.id); } catch (e) { /* ignore */ }
  };

  /* ---------- library UI ---------- */
  let lastArea = null;
  V.open = (anchor) => {
    const box = h('div', { class: 'vis-lib' });
    const search = h('input', { type: 'search', class: 'field', id: 'vis-search', placeholder: 'Search visuals', style: { margin: '0 0 10px' } });
    const tabs = h('div', { class: 'vis-tabs' });
    const grid = h('div', { class: 'vis-grid' });
    const areas = V.orderedAreas();
    const subjName = D.doc && D.doc.subject ? A.SU.name(D.doc.subject) : '';
    if (!lastArea) lastArea = (S.visuals || []).length ? 'mine' : areas[0].id;
    const tile = (thumb, name, onclick, onhold) => {
      const t = h('button', { class: 'vis-tile', title: name }, h('img', { src: thumb, alt: '' }), h('span', null, name));
      let lp;
      t.addEventListener('pointerdown', () => { if (onhold) lp = setTimeout(() => { lp = 'fired'; onhold(); }, 600); });
      t.addEventListener('pointerup', () => { if (lp !== 'fired') clearTimeout(lp); });
      t.addEventListener('click', () => { if (lp === 'fired') { lp = null; return; } A.closePopovers(); onclick(); });
      return t;
    };
    const draw = () => {
      tabs.innerHTML = ''; grid.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const tab = (id, name) => tabs.append(h('button', { class: id === lastArea && !q ? 'on' : '', onclick: () => { lastArea = id; search.value = ''; draw(); } }, name));
      tab('mine', 'My visuals');
      areas.forEach((a) => tab(a.id, a.name));
      const mine = (S.visuals || []).filter((v) => !q || v.name.toLowerCase().includes(q));
      if (q || lastArea === 'mine') {
        const sorted = mine.slice().sort((a, b) => (b.subject === (D.doc && D.doc.subject)) - (a.subject === (D.doc && D.doc.subject)) || b.added - a.added);
        sorted.forEach((v) => grid.append(tile(v.thumb, v.name + (v.subject ? ' · ' + A.SU.name(v.subject) : ''), () => V.insertSaved(v), async () => {
          if (await A.dialog({ title: `Delete “${v.name}”?`, okText: 'Delete', danger: true })) { await V.deleteSaved(v); draw(); }
        })));
        if (!q && !sorted.length) grid.append(h('p', { class: 'muted small vis-empty' }, `Select something you drew, then tap the bookmark in the selection bar to save it here${subjName ? ' for ' + subjName : ''}. Lenses, apparatus, recurring diagrams: draw them once.`));
      }
      L.filter((s) => (q ? s.name.toLowerCase().includes(q) : s.area === lastArea)).forEach((s) => grid.append(tile(V.stampThumb(s), s.name, () => V.insert(s))));
    };
    search.addEventListener('input', draw);
    box.append(h('div', { class: 'row between' }, h('h4', null, 'Visual tools'), h('button', { class: 'btn small-btn', onclick: () => { A.closePopovers(); A.SU.openSetup(); } }, 'Majors')), search, tabs, grid);
    draw();
    A.popover(box, anchor, { side: 'down', cls: 'wide-pop' });
  };
})();
