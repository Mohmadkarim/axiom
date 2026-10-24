/* Axiom brushes: catalog, input mapping, rendering and SVG serialisation */
'use strict';
(() => {
  const G = A.G;
  const B = (A.B = {});

  /* kind: var = variable-width filled outline, line = stroked centerline, fill = filled region, tool = non-drawing */
  B.catalog = {
    pencil:      { name: 'Pencil',       icon: 'b-pencil',      kind: 'var',  size: 3,   opacity: 0.9,  smoothing: 0.2, min: 0.5, max: 40,  grain: true, tilt: true, group: 'pencil' },
    pen:         { name: 'Pen',          icon: 'b-pen',         kind: 'var',  size: 2.5, opacity: 1,    smoothing: 0.3, min: 0.3, max: 60, group: 'ink' },
    brushpen:    { name: 'Brush Pen',    icon: 'b-brushpen',    kind: 'var',  size: 7,   opacity: 1,    smoothing: 0.35, min: 0.5, max: 120, taper: 5, group: 'ink' },
    fineliner:   { name: 'Fine Liner',   icon: 'b-fineliner',   kind: 'line', size: 2,   opacity: 1,    smoothing: 0.3, min: 0.2, max: 40, group: 'ink' },
    wire:        { name: 'Wire',         icon: 'b-wire',        kind: 'line', size: 1.25, opacity: 1,   smoothing: 0.2, min: 0.5, max: 8, wire: true, group: 'ink' },
    dotted:      { name: 'Dotted',       icon: 'b-dotted',      kind: 'line', size: 2.5, opacity: 1,    smoothing: 0.4, min: 0.5, max: 30, dotted: true, group: 'ink' },
    marker:      { name: 'Marker',       icon: 'b-marker',      kind: 'line', size: 14,  opacity: 0.55, smoothing: 0.3, min: 2, max: 200, blend: 'multiply', group: 'marker' },
    highlighter: { name: 'Highlighter',  icon: 'b-highlighter', kind: 'line', size: 20,  opacity: 0.35, smoothing: 0.5, min: 4, max: 200, blend: 'multiply', cap: 'butt', group: 'marker' },
    airbrush:    { name: 'Airbrush',     icon: 'b-airbrush',    kind: 'var',  size: 26,  opacity: 0.35, smoothing: 0.3, min: 4, max: 400, soft: true, group: 'airbrush' },
    fill:        { name: 'Fill',         icon: 'b-fill',        kind: 'fill', size: 1,   opacity: 0.85, smoothing: 0.3, min: 1, max: 1, group: 'fill' },
    slice:       { name: 'Slice Eraser', icon: 'b-slice',       kind: 'tool', size: 10,  opacity: 1,    smoothing: 0, min: 0, max: 200 },
    eraser:      { name: 'Stroke Eraser',icon: 'b-eraser',      kind: 'tool', size: 14,  opacity: 1,    smoothing: 0, min: 2, max: 200 },
    mask:        { name: 'Hard Mask',    icon: 'b-mask',        kind: 'var',  size: 16,  opacity: 1,    smoothing: 0.3, min: 1, max: 400, mask: true },
    softmask:    { name: 'Soft Mask',    icon: 'b-softmask',    kind: 'var',  size: 36,  opacity: 0.6,  smoothing: 0.3, min: 4, max: 400, mask: true, soft: true },
    select:      { name: 'Selection',    icon: 'b-select',      kind: 'tool', size: 1,   opacity: 1,    smoothing: 0, min: 1, max: 1 },
    nudge:       { name: 'Nudge',        icon: 'b-nudge',       kind: 'tool', size: 40,  opacity: 1,    smoothing: 0, min: 5, max: 400 },
    fountain:    { name: 'Fountain Pen', icon: 'b-brushpen',    kind: 'var',  size: 3.5, opacity: 1,    smoothing: 0.35, min: 0.3, max: 60, taper: 2, group: 'ink' },
    tape:        { name: 'Tape',         icon: 'b-marker',      kind: 'line', size: 22,  opacity: 1,    smoothing: 0.6, min: 8, max: 120, cap: 'butt', tape: true, group: 'marker' },
    text:        { name: 'Text',         icon: 'text',          kind: 'tool', size: 20,  opacity: 1,    smoothing: 0, min: 8, max: 120 },
    laser:       { name: 'Laser Pointer',icon: 'laser',         kind: 'tool', size: 6,   opacity: 1,    smoothing: 0, min: 2, max: 30 },
    pan:         { name: 'Pan',          icon: 'hand',          kind: 'tool', size: 1,   opacity: 1,    smoothing: 0, min: 1, max: 1 },
  };
  B.order = ['pencil', 'pen', 'fountain', 'brushpen', 'fineliner', 'wire', 'dotted', 'marker', 'highlighter', 'tape', 'airbrush', 'fill', 'slice', 'eraser', 'mask', 'softmask', 'select', 'nudge', 'text', 'laser', 'pan'];
  B.isDrawing = (id) => { const k = B.catalog[id].kind; return k === 'var' || k === 'line' || k === 'fill'; };

  const mkSlot = (b, color) => { const c = B.catalog[b]; return { b, color, size: c.size, opacity: c.opacity, smoothing: c.smoothing }; };
  B.defaultSlots = () => [
    mkSlot('pencil', '#3a3f4b'),
    mkSlot('pen', '#16181d'),
    mkSlot('fineliner', '#1f4fbf'),
    mkSlot('marker', '#f2c94c'),
    mkSlot('brushpen', '#c0392b'),
    mkSlot('fill', '#7fb3d5'),
    mkSlot('slice', '#000000'),
    mkSlot('select', '#000000'),
  ];
  /* notebooks keep their own tool set (Notability-style rail); canvases keep the 8-slot wheel */
  B.notebookSlots = () => [
    mkSlot('pen', '#16181d'), mkSlot('pen', '#1f4fbf'), mkSlot('fountain', '#c0392b'),
    Object.assign(mkSlot('highlighter', '#ffd84d'), { size: 18 }), mkSlot('eraser', '#000000'),
    mkSlot('text', '#16181d'), mkSlot('select', '#000000'), Object.assign(mkSlot('laser', '#ff3b30')),
    Object.assign(mkSlot('tape', '#f7c6d0')),
  ];
  const validSlots = (list, n) => Array.isArray(list) && list.length === n && list.every((s) => s && B.catalog[s.b]);
  if (!validSlots(A.settings.slots, 8) && !validSlots(A.settings.slots, 9)) A.settings.slots = B.defaultSlots();
  A.settings.toolsets = A.settings.toolsets || {};
  B.toolset = A.settings.slots.length === 9 ? 'notebook' : 'canvas';
  /* swap the active tool set when moving between canvases and notebooks */
  B.useToolset = (kind) => {
    const S = A.settings;
    if (B.toolset === kind) return;
    S.toolsets[B.toolset] = { slots: S.slots, active: S.activeSlot, prev: S.prevSlot };
    const ts = S.toolsets[kind];
    const n = kind === 'notebook' ? 9 : 8;
    S.slots = ts && validSlots(ts.slots, n) ? ts.slots : kind === 'notebook' ? B.notebookSlots() : B.defaultSlots();
    S.activeSlot = ts ? Math.min(ts.active || 0, n - 1) : 0;
    S.prevSlot = ts ? ts.prev : null;
    B.toolset = kind;
    A.saveSettings();
    A.emit('slot');
  };
  B.slot = () => A.settings.slots[A.settings.activeSlot] || A.settings.slots[0];

  /* ---------- input → width multiplier ---------- */
  B.widthMul = (b, p, tilt, hasPressure) => {
    const c = B.catalog[b];
    const g = A.settings.pressure || 1;
    const pp = Math.pow(A.clamp(p, 0.02, 1), g);
    switch (b) {
      case 'pencil': {
        const shade = tilt > 0.45 ? 1 + (tilt - 0.45) * 4.5 : 1; // tilt the Pencil to shade
        return (0.45 + 0.55 * pp) * shade;
      }
      case 'pen': return 0.18 + 0.92 * pp;
      case 'brushpen': return 0.06 + 1.0 * Math.pow(pp, 1.25);
      case 'airbrush': return 0.55 + 0.45 * pp;
      case 'mask': case 'softmask': return hasPressure ? 0.5 + 0.5 * pp : 1;
      default: return c.kind === 'line' ? 1 : 1;
    }
  };

  /* ---------- textures ---------- */
  const grainCache = new Map();
  B.grain = (ctx, color) => {
    let pat = grainCache.get(color);
    if (pat) return pat;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    const img = g.createImageData(96, 96);
    const rgb = A.C.hexToRgb(color) || [0, 0, 0];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 96 * 96; i++) {
      const v = rnd();
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = Math.round(255 * (0.25 + 0.75 * Math.pow(v, 0.7)));
    }
    g.putImageData(img, 0, 0);
    pat = ctx.createPattern(c, 'repeat');
    try { pat.setTransform(new DOMMatrix().scale(0.32)); } catch (e) { /* older engines */ }
    grainCache.set(color, pat);
    return pat;
  };

  /* ---------- geometry cache ---------- */
  const geo = new WeakMap();
  B.path = (item) => {
    let p = geo.get(item);
    if (p) return p;
    const c = B.catalog[item.b] || B.catalog.pen;
    p = new Path2D();
    if (c.kind === 'var') G.buildVar(p, item.sharp ? item.pts : G.spline(item.pts, item.live ? Math.max(2, item.w * 0.6) : Math.max(1.1, item.w * 0.4), item.live ? 700 : 1400), item.w, c.taper || 0);
    else if (c.kind === 'fill') (item.sharp ? G.buildPoly : G.buildLine)(p, item.pts, true);
    else (item.sharp ? G.buildPoly : G.buildLine)(p, item.pts, !!item.closed);
    geo.set(item, p);
    return p;
  };

  /* ---------- dark display: adapt ink to a dark canvas (display only; exports keep true colors) ---------- */
  B.dark = false;
  const dcache = new Map();
  /* on paper the student chose to be dark: brighten only dark inks so they stay visible */
  const lcache = new Map();
  const liftDark = (c) => {
    let v = lcache.get(c);
    if (v) return v;
    const rgb = A.C.hexToRgb(c);
    if (!rgb) return c;
    const [hh, s, l] = A.C.rgbToHsl(...rgb);
    v = l >= 0.5 ? c : A.C.rgbToHex(...A.C.hslToRgb(hh, s, s < 0.15 ? 0.86 - l * 0.3 : 0.66 + (0.5 - l) * 0.24));
    lcache.set(c, v);
    return v;
  };
  B.col = (c) => {
    if (!B.dark) return B.lift ? liftDark(c) : c;
    let v = dcache.get(c);
    if (v) return v;
    const rgb = A.C.hexToRgb(c);
    if (!rgb) return c;
    const [hh, s, l] = A.C.rgbToHsl(...rgb);
    const w = Math.min(1, s * 2.5);                       // grays invert fully, saturated colors keep their hue
    const inv = 0.06 + (1 - l) * 0.88;
    const sat = Math.max(l, 1 - l) * 0.86 + 0.07;
    v = A.C.rgbToHex(...A.C.hslToRgb(hh, s, inv + (sat - inv) * w));
    dcache.set(c, v);
    return v;
  };

  /* ---------- render one stroke (ctx already holds the world transform) ---------- */
  B.render = (ctx, item, alphaMul = 1) => {
    if (item.b === 'tape' && item.rv) alphaMul *= 0.16;
    const c = B.catalog[item.b] || B.catalog.pen;
    const path = B.path(item);
    const a = item.o * alphaMul;
    const col = item.raw ? item.c : B.col(item.c);
    ctx.save();
    ctx.globalAlpha = a;
    if (c.blend) ctx.globalCompositeOperation = B.dark || B.lift ? 'screen' : c.blend;
    if (c.mask) ctx.globalCompositeOperation = 'destination-out';
    if (c.soft) {
      const t = ctx.getTransform();
      const k = Math.hypot(t.a, t.b);
      const OFF = 30000;
      ctx.setTransform(t.a, t.b, t.c, t.d, t.e - OFF, t.f);
      ctx.shadowOffsetX = OFF;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = Math.max(1, item.w * k * 0.45);
      ctx.shadowColor = c.mask ? 'rgba(0,0,0,1)' : col;
      ctx.fillStyle = '#000';
      ctx.fill(path);
    } else if (c.kind === 'var') {
      ctx.fillStyle = c.grain ? B.grain(ctx, col) : (c.mask ? '#000' : col);
      ctx.fill(path);
    } else if (c.kind === 'fill') {
      ctx.fillStyle = col;
      ctx.fill(path);
    } else {
      const t = ctx.getTransform();
      const k = Math.hypot(t.a, t.b) || 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = c.wire ? (item.w * (A.dpr || 1)) / k : item.w;
      ctx.lineCap = c.cap || 'round';
      ctx.lineJoin = 'round';
      if (c.dotted) ctx.setLineDash([0.001, item.w * 2.4]);
      ctx.stroke(path);
    }
    ctx.restore();
  };

  /* image items: {t:'i', src, iw, ih, m:[a,b,c,d,e,f]} */
  const imgCache = new Map();
  B.image = (src, onload) => {
    let im = imgCache.get(src);
    if (!im) {
      im = new Image();
      im.onload = () => onload && onload();
      im.src = src;
      imgCache.set(src, im);
    }
    return im;
  };
  /* text boxes and sticky notes: {t:'x', text, fs, font, c, bg?, bold?, iw, ih, m} in local box units */
  B.FONTS = {
    sans: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    serif: '"Iowan Old Style", "New York", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
    round: '"SF Pro Rounded", ui-rounded, -apple-system, system-ui, sans-serif',
  };
  const mctx = document.createElement('canvas').getContext('2d');
  B.textFont = (it) => `${it.bold ? 700 : 400} ${it.fs}px ${B.FONTS[it.font] || B.FONTS.sans}`;
  B.textPad = (it) => (it.bg ? Math.max(10, it.fs * 0.6) : 2);
  B.layoutText = (it) => {
    mctx.font = B.textFont(it);
    const pad = B.textPad(it), maxW = Math.max(20, it.iw - pad * 2);
    const lines = [];
    for (const para of String(it.text || '').split('\n')) {
      const words = para.split(/(\s+)/);
      let cur = '';
      for (const w of words) {
        const next = cur + w;
        if (cur && mctx.measureText(next.trimEnd()).width > maxW) { lines.push(cur.trimEnd()); cur = w.trimStart(); }
        else cur = next;
        while (mctx.measureText(cur).width > maxW && cur.length > 1) { // break very long words
          let k = cur.length - 1;
          while (k > 1 && mctx.measureText(cur.slice(0, k)).width > maxW) k--;
          lines.push(cur.slice(0, k)); cur = cur.slice(k);
        }
      }
      lines.push(cur);
    }
    const lh = it.fs * 1.36;
    return { lines, lh, pad, h: Math.max(lh, lines.length * lh) + pad * 2 };
  };
  B.makeText = (props) => {
    const it = Object.assign({ id: A.uid(), t: 'x', text: '', fs: 20, font: 'sans', c: '#1b1d22', o: 1, iw: 320, ih: 30, m: [1, 0, 0, 1, 0, 0] }, props);
    it.ih = B.layoutText(it).h;
    it.bb = B.imageBB(it);
    return it;
  };
  B.renderText = (ctx, item, alphaMul = 1) => {
    const L = B.layoutText(item);
    ctx.save();
    ctx.globalAlpha = (item.o ?? 1) * alphaMul;
    ctx.transform(...item.m);
    if (item.bg) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = item.bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, item.iw, item.ih, 6); else ctx.rect(0, 0, item.iw, item.ih);
      ctx.fill();
      ctx.restore();
    }
    ctx.font = B.textFont(item);
    ctx.fillStyle = item.bg ? '#2a2620' : B.col(item.c);
    ctx.textBaseline = 'alphabetic';
    L.lines.forEach((ln, i) => ctx.fillText(ln, L.pad, L.pad + i * L.lh + item.fs * 1.02));
    ctx.restore();
  };
  B.renderImage = (ctx, item, alphaMul = 1, onload) => {
    if (item.t === 'x') return B.renderText(ctx, item, alphaMul);
    const im = B.image(item.src, onload);
    if (!im.complete || !im.naturalWidth) return;
    ctx.save();
    ctx.globalAlpha = (item.o ?? 1) * alphaMul;
    ctx.transform(...item.m);
    ctx.drawImage(im, 0, 0, item.iw, item.ih);
    ctx.restore();
  };
  B.imageCorners = (item) => {
    const M = item.m;
    return [[0, 0], [item.iw, 0], [item.iw, item.ih], [0, item.ih]].map(([x, y]) => A.M.apply(M, x, y));
  };
  B.imageBB = (item) => {
    const cs = B.imageCorners(item);
    const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  B.isBox = (it) => it.t === 'i' || it.t === 'x';
  B.imageHit = (item, x, y) => {
    const inv = A.M.inv(item.m);
    const [u, v] = A.M.apply(inv, x, y);
    return u >= 0 && v >= 0 && u <= item.iw && v <= item.ih;
  };

  /* ---------- SVG ---------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  B.itemSvg = (item, defs) => {
    if (item.t === 'x') {
      const L = B.layoutText(item);
      const rect = item.bg ? `<rect width="${item.iw}" height="${item.ih}" rx="6" fill="${item.bg}"/>` : '';
      const fam = esc(B.FONTS[item.font] || B.FONTS.sans);
      const spans = L.lines.map((ln, i) => `<tspan x="${L.pad}" y="${(L.pad + i * L.lh + item.fs * 1.02).toFixed(2)}">${esc(ln) || ' '}</tspan>`).join('');
      return `<g transform="matrix(${item.m.map((v) => +v.toFixed(4)).join(' ')})" opacity="${item.o ?? 1}">${rect}<text font-family="${fam}" font-size="${item.fs}" font-weight="${item.bold ? 700 : 400}" fill="${item.bg ? '#2a2620' : item.c}" xml:space="preserve">${spans}</text></g>`;
    }
    if (item.t === 'i') {
      return `<image href="${esc(item.src)}" width="${item.iw}" height="${item.ih}" transform="matrix(${item.m.map((v) => +v.toFixed(4)).join(' ')})" opacity="${item.o ?? 1}"/>`;
    }
    const c = B.catalog[item.b] || B.catalog.pen;
    const sink = G.svgSink();
    if (c.kind === 'var') G.buildVar(sink, item.sharp ? item.pts : G.spline(item.pts, Math.max(1.1, item.w * 0.4), 1400), item.w, c.taper || 0);
    else if (c.kind === 'fill') (item.sharp ? G.buildPoly : G.buildLine)(sink, item.pts, true);
    else (item.sharp ? G.buildPoly : G.buildLine)(sink, item.pts, !!item.closed);
    const d = sink.toString();
    const fill = c.mask ? '#000' : item.c;
    let filt = '';
    if (c.soft) {
      const id = 'f' + item.id;
      defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(item.w * 0.22).toFixed(2)}"/></filter>`);
      filt = ` filter="url(#${id})"`;
    }
    const blend = c.blend ? ' style="mix-blend-mode:multiply"' : '';
    if (c.kind === 'var' || c.kind === 'fill') return `<path d="${d}" fill="${fill}" fill-opacity="${item.o}"${filt}${blend}/>`;
    const dash = c.dotted ? ` stroke-dasharray="0.001 ${(item.w * 2.4).toFixed(2)}"` : '';
    return `<path d="${d}" fill="none" stroke="${item.c}" stroke-opacity="${item.o}" stroke-width="${item.w}" stroke-linecap="${c.cap || 'round'}" stroke-linejoin="round"${dash}${blend}/>`;
  };

  /* small preview stroke used in the brush menu */
  B.previewItem = (slot, w, h) => {
    const pts = [];
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = 16 + t * (w - 32), y = h / 2 + Math.sin(t * Math.PI * 2) * (h * 0.24);
      const p = Math.sin(t * Math.PI) * 0.85 + 0.15;
      pts.push(x, y, B.widthMul(slot.b, p, 0, true));
    }
    const c = B.catalog[slot.b];
    let size = A.clamp(slot.size, 0.5, h * 0.4);
    if (c.kind === 'fill') {
      const f = [];
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; f.push(w / 2 + Math.cos(a) * w * 0.32, h / 2 + Math.sin(a) * h * 0.32, 1); }
      return { t: 's', b: slot.b, c: slot.color, w: 1, o: slot.opacity, pts: f, bb: G.bbox(f) };
    }
    return { t: 's', b: slot.b, c: slot.color, w: size, o: c.mask ? 0.9 : slot.opacity, pts, bb: G.bbox(pts) };
  };
})();
