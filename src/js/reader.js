/* Axiom reader: a quiet reading room for books and problem sets, with the tutor beside the page.
   Pencil drag = focus box / lasso around any passage → Ask, Explain, Hint, Highlight, Copy text.
   The tutor receives the page text with line ids and cites lines back ([[p34:L3-L5]]), which highlight here. */
'use strict';
(() => {
  const h = A.h;
  const S = A.settings;
  const RD = (A.RD = {});
  let host, st = null;

  const ann0 = () => ({ highlights: [], chats: [], chatActive: null, ink: {} });
  const saveAnn = A.debounce(() => {
    if (!st) return;
    A.store.saveFile('ann_' + st.meta.id, new Blob([JSON.stringify(st.ann)], { type: 'application/json' })).catch(() => {});
  }, 600);
  const loadAnn = async (id) => {
    try { const b = await A.store.loadFile('ann_' + id, 'application/json'); if (b) return Object.assign(ann0(), JSON.parse(await b.text())); } catch (e) { /* none yet */ }
    return ann0();
  };

  /* ---------- text lines (for selection text, search and citations) ---------- */
  const lineCache = new Map();
  RD.lines = async (n) => {
    const key = st.meta.id + ':' + n;
    if (lineCache.has(key)) return lineCache.get(key);
    let lines = [];
    try {
      const lib = window.pdfjsLib;
      const page = await st.pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
        const t = lib.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(t[2], t[3]) || 10;
        return { x: t[4], y: t[5] - fh, w: Math.abs(it.width * (vp.scale || 1)), h: fh, s: it.str };
      }).sort((a, b) => a.y - b.y || a.x - b.x);
      const rows = [];
      for (const it of items) {
        const r = rows.find((row) => Math.abs(row.cy - (it.y + it.h / 2)) < Math.max(row.h, it.h) * 0.55);
        if (r) { r.items.push(it); r.h = Math.max(r.h, it.h); } else rows.push({ cy: it.y + it.h / 2, h: it.h, items: [it] });
      }
      rows.sort((a, b) => a.cy - b.cy);
      lines = rows.map((r, i) => {
        r.items.sort((a, b) => a.x - b.x);
        let text = '', last = null;
        for (const it of r.items) { if (last && it.x - (last.x + last.w) > it.h * 0.25 && !/\s$/.test(text)) text += ' '; text += it.s; last = it; }
        const x0 = Math.min(...r.items.map((t) => t.x)), x1 = Math.max(...r.items.map((t) => t.x + t.w));
        const y0 = Math.min(...r.items.map((t) => t.y)), y1 = Math.max(...r.items.map((t) => t.y + t.h));
        return { id: i + 1, text: text.replace(/\s+/g, ' ').trim(), r: [x0 / vp.width, y0 / vp.height, x1 / vp.width, y1 / vp.height] };
      }).filter((l) => l.text);
      lines.forEach((l, i) => (l.id = i + 1));
    } catch (e) { lines = []; }
    lineCache.set(key, lines);
    return lines;
  };
  const linesIn = (lines, r) => lines.filter((l) => { const cx = (l.r[0] + l.r[2]) / 2, cy = (l.r[1] + l.r[3]) / 2; return cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]; });

  /* ---------- rendering ---------- */
  const themeFilter = { paper: '', sepia: 'sepia(.38) saturate(1.1) brightness(.97)', night: 'invert(.92) hue-rotate(180deg) contrast(.92)' };
  function layout(keep = true) {
    if (st && st.rendition) { host.classList.toggle('rd-narrow', st.main.clientWidth < 760); clearTimeout(st._rz); st._rz = setTimeout(() => { try { st.rendition.resize(); } catch (e) { /* ignore */ } }, 60); return; }
    if (!st || !st.pages.length) return;
    const main = st.main;
    host.classList.toggle('rd-narrow', main.clientWidth < 760);
    const frac = keep ? main.scrollTop / Math.max(1, main.scrollHeight) : null;
    const availW = Math.max(240, main.clientWidth - 64), availH = Math.max(240, main.clientHeight - 48);
    st.pages.forEach((p) => {
      let w = st.fit === 'page' ? Math.min(availW, availH / p.aspect) : Math.min(availW, 980);
      w *= st.zoom;
      p.el.style.width = Math.round(w) + 'px';
      p.el.style.height = Math.round(w * p.aspect) + 'px';
      if (p.canvas && Math.abs(p.w - w) > 2) { p.canvas.remove(); p.canvas = null; if (p.visible) renderPage(p); }
      if (p.ink) drawInkPage(p);
    });
    if (frac != null) main.scrollTop = frac * main.scrollHeight;
  }
  async function renderPage(p) {
    if (!st || p.busy) return;
    const w = parseFloat(p.el.style.width);
    if (p.canvas && Math.abs(p.w - w) < 2) return;
    p.busy = true;
    const token = st.token;
    try {
      const page = await st.pdf.getPage(p.n);
      const vp1 = page.getViewport({ scale: 1 });
      if (Math.abs(vp1.height / vp1.width - p.aspect) > 0.01) { p.aspect = vp1.height / vp1.width; p.el.style.height = Math.round(w * p.aspect) + 'px'; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (w / vp1.width) * dpr });
      const c = h('canvas', { class: 'rd-canvas' });
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!st || token !== st.token) return;
      if (p.canvas) p.canvas.remove();
      p.canvas = c; p.w = w;
      p.el.insertBefore(c, p.ink || p.ov);
      drawInkPage(p);
      st.pages.forEach((q) => { if (q.canvas && Math.abs(q.n - st.page) > 5) { q.canvas.remove(); q.canvas = null; } });
    } catch (e) { /* keep placeholder */ }
    p.busy = false;
  }
  const regionImage = async (n, r, maxPx = 1500) => {
    const page = await st.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const rw = (r[2] - r[0]) * vp1.width, rh = (r[3] - r[1]) * vp1.height;
    const scale = Math.min(4, maxPx / Math.max(rw, rh, 1));
    const vp = page.getViewport({ scale });
    const full = h('canvas'); full.width = Math.round(vp.width); full.height = Math.round(vp.height);
    const fctx = full.getContext('2d'); fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, full.width, full.height);
    await page.render({ canvasContext: fctx, viewport: vp }).promise;
    const c = h('canvas'); c.width = Math.max(1, Math.round(rw * scale)); c.height = Math.max(1, Math.round(rh * scale));
    const cctx = c.getContext('2d');
    cctx.drawImage(full, -r[0] * full.width, -r[1] * full.height);
    const ink = (st.ann.ink && st.ann.ink[n]) || [];
    if (ink.length) drawStrokes(cctx, ink, full.width, full.height, -r[0] * full.width, -r[1] * full.height);
    return c.toDataURL('image/jpeg', 0.9);
  };
  RD.pageImage = async (n) => regionImage(n, [0, 0, 1, 1], 1600);

  /* ---------- overlays: highlights, focus box, citations ---------- */
  const box = (r, cls, extra = {}) => h('div', Object.assign({ class: cls, style: { left: r[0] * 100 + '%', top: r[1] * 100 + '%', width: (r[2] - r[0]) * 100 + '%', height: (r[3] - r[1]) * 100 + '%' } }, extra));
  function drawOverlays(n) {
    const p = st.pages[n - 1];
    if (!p) return;
    p.ov.innerHTML = '';
    st.ann.highlights.filter((hl) => hl.page === n).forEach((hl) => {
      const el = box(hl.rect, 'rd-hl ' + (hl.color || 'yellow'), { title: 'Highlight · tap for options' });
      el.addEventListener('click', (e) => { e.stopPropagation(); highlightMenu(el, hl); });
      p.ov.append(el);
    });
    (st.cites || []).filter((c) => c.page === n).forEach((c) => c.rects.forEach((r) => p.ov.append(box(r, 'rd-cite' + (c.flash ? ' flash' : '')))));
    if (st.focus && st.focus.page === n) {
      if (st.focus.path) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'rd-lasso'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M' + st.focus.path.map(([x, y]) => `${x * 100} ${y * 100}`).join('L') + 'Z');
        svg.append(path); p.ov.append(svg);
      } else p.ov.append(box(st.focus.rect, 'rd-focus'));
    }
  }
  const redrawAll = () => st && st.pages.forEach((p) => drawOverlays(p.n));
  function highlightMenu(anchor, hl) {
    const m = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); m.append(b); };
    const colors = h('div', { class: 'rd-colors' });
    ['yellow', 'green', 'blue', 'pink'].forEach((c) => colors.append(h('button', { class: 'rd-sw ' + c + (hl.color === c ? ' on' : ''), 'aria-label': c, onclick: () => { hl.color = c; saveAnn(); drawOverlays(hl.page); A.closePopovers(); } })));
    m.append(colors);
    it('spark', 'Ask the tutor about this', () => ask('ask', hl.page, hl.rect));
    if (hl.text) it('copy', 'Copy text', () => copyText(hl.text));
    it('trash', 'Remove highlight', () => { st.ann.highlights = st.ann.highlights.filter((x) => x !== hl); saveAnn(); drawOverlays(hl.page); renderRail(); }, 'danger');
    A.popover(m, anchor, { side: 'down' });
  }

  /* ---------- selecting with the Pencil (box or lasso) ---------- */
  const pageAt = (x, y) => { for (const p of st.pages) { const r = p.el.getBoundingClientRect(); if (y >= r.top && y <= r.bottom && x >= r.left - 20 && x <= r.right + 20) return { p, r }; } return null; };
  /* ---------- handwriting on pages (stored as page-relative vector strokes) ---------- */
  const INK = { black: '#1b1d22', blue: '#1f4fbf', red: '#c43c35', green: '#1e8449' };
  const inkOf = (n) => ((st.ann.ink = st.ann.ink || {})[n] = st.ann.ink[n] || []);
  const strokePath = (s, W, H, ox = 0, oy = 0) => {
    const pts = [];
    for (let i = 0; i < s.pts.length; i += 3) pts.push(s.pts[i] * W + ox, s.pts[i + 1] * H + oy, 0.35 + 0.65 * s.pts[i + 2]);
    const path = new Path2D();
    A.G.buildVar(path, pts.length > 6 ? A.G.spline(pts, 1.2) : pts, Math.max(0.6, s.w * W), 0);
    return path;
  };
  const drawStrokes = (ctx, strokes, W, H, ox = 0, oy = 0) => {
    for (const s of strokes) { ctx.fillStyle = s.c; ctx.globalAlpha = s.o || 1; ctx.fill(strokePath(s, W, H, ox, oy)); }
    ctx.globalAlpha = 1;
  };
  function drawInkPage(p, live) {
    const strokes = (st.ann.ink && st.ann.ink[p.n]) || [];
    if (!strokes.length && !live && !p.ink) return;
    if (!p.ink) { p.ink = h('canvas', { class: 'rd-ink' }); p.el.insertBefore(p.ink, p.ov); }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = p.el.clientWidth, H = p.el.clientHeight;
    if (p.ink.width !== Math.round(W * dpr) || p.ink.height !== Math.round(H * dpr)) { p.ink.width = Math.round(W * dpr); p.ink.height = Math.round(H * dpr); }
    const ctx = p.ink.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.ink.width, p.ink.height);
    drawStrokes(ctx, live ? strokes.concat([live]) : strokes, p.ink.width, p.ink.height);
  }
  RD.inkUndo = () => {
    const last = st.inkHist.pop();
    if (!last) return A.toast('Nothing to undo');
    const arr = inkOf(last.page);
    if (last.type === 'add') arr.splice(arr.indexOf(last.stroke), 1); else arr.push(...last.strokes);
    saveAnn(); drawInkPage(st.pages[last.page - 1]);
  };
  const eraseAt = (p, fx, fy) => {
    const arr = inkOf(p.n), rr = 0.012, gone = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      for (let k = 0; k < s.pts.length; k += 3) if (Math.hypot(s.pts[k] - fx, (s.pts[k + 1] - fy) * p.aspect) < rr + s.w) { gone.push(arr.splice(i, 1)[0]); break; }
    }
    if (gone.length) { st.inkHist.push({ type: 'erase', page: p.n, strokes: gone }); drawInkPage(p); saveAnn(); }
  };

  function bindSelect(main) {
    let cur = null;
    const fingerSelects = () => st.tool !== 'read' && !S.penSeen;
    main.addEventListener('touchstart', (e) => {
      const stylus = [...e.changedTouches].some((t) => t.touchType === 'stylus');
      if (stylus || fingerSelects()) e.preventDefault(); // keep the Pencil from scrolling
    }, { passive: false });
    main.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.rd-hl') && st.tool !== 'write') return;
      const selecting = e.pointerType === 'pen' || e.pointerType === 'mouse' || fingerSelects();
      if (!selecting || e.button > 0) return;
      if (e.pointerType === 'pen' && !S.penSeen) { S.penSeen = true; A.saveSettings(); }
      const hit = pageAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      clearActions();
      const fx = (e.clientX - hit.r.left) / hit.r.width, fy = (e.clientY - hit.r.top) / hit.r.height;
      cur = { p: hit.p, r: hit.r, pts: [[fx, fy]], id: e.pointerId };
      if (st.tool === 'write') {
        if (st.inkTool === 'eraser') { cur.erase = true; eraseAt(hit.p, fx, fy); }
        else cur.stroke = { id: A.uid(), c: INK[st.inkColor] || INK.black, w: st.inkWidth, pts: [fx, fy, e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.6] };
      }
      try { main.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    main.addEventListener('pointermove', (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      e.preventDefault();
      const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
      if (cur.erase) { for (const ev of list) eraseAt(cur.p, (ev.clientX - cur.r.left) / cur.r.width, (ev.clientY - cur.r.top) / cur.r.height); return; }
      if (cur.stroke) {
        for (const ev of list) cur.stroke.pts.push((ev.clientX - cur.r.left) / cur.r.width, (ev.clientY - cur.r.top) / cur.r.height, ev.pointerType === 'pen' ? Math.max(0.05, ev.pressure) : 0.6);
        if (!cur.raf) cur.raf = requestAnimationFrame(() => { if (cur) { cur.raf = 0; drawInkPage(cur.p, cur.stroke); } });
        return;
      }
      for (const ev of list) cur.pts.push([A.clamp((ev.clientX - cur.r.left) / cur.r.width, 0, 1), A.clamp((ev.clientY - cur.r.top) / cur.r.height, 0, 1)]);
      const sh = shapeOf(cur.pts);
      st.focus = Object.assign({ page: cur.p.n }, sh);
      drawOverlays(cur.p.n);
    });
    const up = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      if (cur.erase) { cur = null; return; }
      if (cur.stroke) {
        const s = cur.stroke, p = cur.p;
        cur = null;
        s.pts = A.G.simplify(s.pts, 0.0006, 0.04);
        inkOf(p.n).push(s);
        st.inkHist.push({ type: 'add', page: p.n, stroke: s });
        drawInkPage(p); saveAnn();
        return;
      }
      const sh = shapeOf(cur.pts);
      const n = cur.p.n;
      cur = null;
      const wpx = (sh.rect[2] - sh.rect[0]) * st.pages[n - 1].el.clientWidth, hpx = (sh.rect[3] - sh.rect[1]) * st.pages[n - 1].el.clientHeight;
      if (wpx < 14 || hpx < 10) { st.focus = null; drawOverlays(n); return; }
      st.focus = Object.assign({ page: n }, sh);
      drawOverlays(n);
      if (st.tool === 'highlight') { addHighlight(n, sh.rect); st.focus = null; drawOverlays(n); return; }
      showActions(n, sh.rect);
    };
    main.addEventListener('pointerup', up);
    main.addEventListener('pointercancel', up);
  }
  /* a closed loop is a lasso; otherwise the drag's corners define a box */
  function shapeOf(pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const w = bb[2] - bb[0], hh = bb[3] - bb[1], big = Math.max(w, hh) || 1;
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    // a loop ends near where it started and travels around its box (works for wide, flat loops around text lines)
    const closed = pts.length > 10 && Math.hypot(ex - sx, ey - sy) < big * 0.35 && L > (w + hh) * 1.2;
    if (closed) return { rect: bb, path: pts.filter((_, i) => i % 2 === 0) };
    return { rect: [Math.min(sx, ex), Math.min(sy, ey), Math.max(sx, ex), Math.max(sy, ey)] };
  }

  /* ---------- selection actions ---------- */
  function clearActions() { const a = host && host.querySelector('.rd-actions'); if (a) a.remove(); }
  function showActions(n, r) {
    clearActions();
    const p = st.pages[n - 1], pr = p.el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const bar = h('div', { class: 'rd-actions', role: 'toolbar', 'aria-label': 'Selection' });
    const b = (icon, label, fn, primary) => { const x = h('button', { class: primary ? 'primary' : '', onclick: fn }); x.innerHTML = A.icon(icon); x.append(label); bar.append(x); };
    b('spark', 'Ask', () => ask('ask', n, r), true);
    b('book', 'Explain', () => ask('explain', n, r));
    b('help', 'Hint', () => ask('hint', n, r));
    b('rename', 'Highlight', () => { addHighlight(n, r); st.focus = null; drawOverlays(n); clearActions(); });
    b('copy', 'Copy text', async () => { const t = linesIn(await RD.lines(n), r).map((l) => l.text).join('\n'); copyText(t); });
    bar.append(h('button', { class: 'x', 'aria-label': 'Clear selection', html: A.icon('close'), onclick: () => { st.focus = null; drawOverlays(n); clearActions(); } }));
    host.append(bar);
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = pr.left + ((r[0] + r[2]) / 2) * pr.width - bw / 2 - hr.left;
    let y = pr.top + r[1] * pr.height - bh - 12 - hr.top;
    if (y < 70) y = pr.top + r[3] * pr.height + 12 - hr.top;
    bar.style.left = A.clamp(x, 8, hr.width - bw - 8) + 'px';
    bar.style.top = A.clamp(y, 64, hr.height - bh - 60) + 'px';
  }
  const copyText = (t) => {
    if (!t) return A.toast('No text found here. This page may be a scan.');
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => A.toast('Text copied'), () => A.toast('Copy is not allowed here'));
  };
  async function addHighlight(n, r) {
    const text = linesIn(await RD.lines(n), r).map((l) => l.text).join(' ');
    st.ann.highlights.push({ id: A.uid(), page: n, rect: r, color: 'yellow', text, created: Date.now() });
    saveAnn(); drawOverlays(n); renderRail();
    A.toast('Highlighted');
  }
  async function ask(kind, n, r) {
    clearActions();
    toggleTutor(true);
    const url = await regionImage(n, r);
    const text = linesIn(await RD.lines(n), r).map((l) => l.text).join('\n');
    const att = { kind: 'image', label: `p. ${n} · selection`, url, page: n, rect: r, text };
    if (kind === 'explain') A.AI.ask('Explain this passage rigorously.', { mode: 'explain', attachments: [att] });
    else if (kind === 'hint') A.AI.ask('Give me a hint for this. Not the solution.', { mode: 'hint', attachments: [att] });
    else A.AI.ask('', { send: false, attachments: [att] });
  }

  /* ---------- tutor context for the reader ---------- */
  const readerCtx = {
    kind: 'reader',
    store: () => st.ann,
    chats: () => st.ann.chats,
    save: () => saveAnn(),
    subject: () => st.meta.subject,
    emptyTitle: () => 'Ask about this ' + (st.meta.kind === 'sheet' ? 'problem set' : 'book'),
    get emptyText() { return st && st.kind === 'epub' ? 'Select any passage, then tap Ask. The tutor reads the chapter with you.' : 'Draw a box or a loop around any passage with the Apple Pencil, then tap Ask. The tutor reads the page with you and highlights the lines it refers to.'; },
    tips: ['Explain the main idea of this page', 'What do I need to know before reading this section?', 'Give me a hint for the problem on this page', 'Quiz me on this chapter so far'],
    placeholder: () => 'Ask about this page or your selection…',
    attachButtons: () => (st.kind === 'epub' ? [] : [{ icon: 'pdf', label: 'This page', fn: async () => A.AI.attach({ kind: 'image', label: `p. ${st.page}`, url: await RD.pageImage(st.page), page: st.page }) }]),
    onRemoveAtt: (a) => { if (st.focus && a.page === st.focus.page) { st.focus = null; drawOverlays(a.page); } },
    systemExtra: () => (st.kind === 'epub'
      ? `The student is reading the EPUB book "${st.meta.name}" in Axiom's reader. The text of the chapter on screen is provided. When you refer to a passage, quote it briefly in a > blockquote; line citations are not available in EPUBs.`
      : `The student is reading "${st.meta.name}" (${st.pdf ? st.pdf.numPages + ' pages' : ''}) in Axiom's reader. Regions they select are attached as images together with the text of the selected lines. Their own handwriting on the page may appear in those images.`),
    contextText: async (atts) => {
      if (st.kind === 'epub') {
        const chap = epubChapterText();
        const where = st.loc && st.toc ? (st.toc.find((t) => st.loc.start.href && st.loc.start.href.split('#')[0].endsWith(t.href.split('#')[0])) || {}).label : '';
        return `[Reader context: "${st.meta.name}"${where ? ', chapter: ' + where.trim() : ''}.]\n\nChapter text (may be truncated):\n${chap.slice(0, 9000)}`;
      }
      const pages = new Set([st.page]);
      atts.forEach((a) => a.page && pages.add(a.page));
      const parts = [`[Reader context: "${st.meta.name}", the student is on page ${st.page} of ${st.pdf.numPages}.]`];
      for (const n of pages) {
        const lines = await RD.lines(n);
        if (!lines.length) { parts.push(`p. ${n}: (no extractable text; this page is probably a scan)`); continue; }
        let body = '', count = 0;
        for (const l of lines) { const row = `L${l.id}: ${l.text}\n`; if (body.length + row.length > 7000 || count > 140) { body += '…\n'; break; } body += row; count++; }
        parts.push(`p. ${n} (text lines):\n${body}`);
      }
      for (const a of atts) if (a.page && a.rect) {
        const sel = linesIn(await RD.lines(a.page), a.rect);
        if (sel.length) parts.push(`The selected region on p. ${a.page} covers lines L${sel[0].id}–L${sel[sel.length - 1].id}.`);
      }
      return parts.join('\n\n');
    },
    onCite: async (p, a, b) => {
      if (st.kind === 'epub') return;
      const lines = await RD.lines(p);
      const sel = lines.filter((l) => l.id >= a && l.id <= b);
      st.cites = [{ page: p, rects: sel.length ? sel.map((l) => [l.r[0] - 0.004, l.r[1] - 0.003, l.r[2] + 0.004, l.r[3] + 0.003]) : [], flash: true }];
      goto(p, sel.length ? sel[0].r[1] : 0);
      drawOverlays(p);
      setTimeout(() => { if (st && st.cites[0]) { st.cites[0].flash = false; drawOverlays(p); } }, 1600);
      if (!sel.length) A.toast('Couldn\'t find those lines on this page');
    },
    onAttClick: (a) => { if (!a.page) return; st.focus = a.rect ? { page: a.page, rect: a.rect } : null; goto(a.page, a.rect ? a.rect[1] : 0); drawOverlays(a.page); },
    onAnswer: async (text) => {
      if (st.kind === 'epub') return;
      const re = /\[\[p(\d+):L(\d+)(?:\s*[-–]\s*L?(\d+))?\]\]/g; let m; const by = new Map();
      while ((m = re.exec(text))) { const p = +m[1]; if (!by.has(p)) by.set(p, []); by.get(p).push([+m[2], +(m[3] || m[2])]); }
      const cites = [];
      for (const [p, ranges] of by) { const lines = await RD.lines(p); const rects = []; ranges.forEach(([a, b]) => lines.filter((l) => l.id >= a && l.id <= b).forEach((l) => rects.push([l.r[0] - 0.004, l.r[1] - 0.003, l.r[2] + 0.004, l.r[3] + 0.003]))); cites.push({ page: p, rects }); }
      if (cites.length) { st.cites = cites; redrawAll(); }
    },
  };
  RD.ctx = readerCtx;

  /* ---------- navigation ---------- */
  function goto(n, frac = 0, smooth = true) {
    if (!st) return;
    n = A.clamp(n, 1, st.pages.length);
    const p = st.pages[n - 1];
    st.main.scrollTo({ top: p.el.offsetTop + frac * p.el.offsetHeight - 80, behavior: smooth ? 'smooth' : 'auto' });
  }
  RD.goto = goto;
  function onScroll() {
    const mid = st.main.scrollTop + st.main.clientHeight * 0.4;
    let n = 1;
    for (const p of st.pages) { if (p.el.offsetTop <= mid) n = p.n; else break; }
    if (n !== st.page) {
      st.page = n;
      st.pageLbl.textContent = `${n}`;
      st.scrub.value = n;
      clearTimeout(st._sv);
      st._sv = setTimeout(() => { const d = A.ST.doc(st.meta.id); if (d) { d.lastPage = n; d.lastRead = Date.now(); A.saveSettings(); } }, 600);
      const th = st.rail && st.rail.querySelector(`.rd-th[data-n="${n}"]`);
      st.rail && st.rail.querySelectorAll('.rd-th.on').forEach((x) => x.classList.remove('on'));
      if (th) th.classList.add('on');
    }
  }

  /* ---------- side rail: pages, contents, highlights ---------- */
  function renderRail() {
    if (!st || !st.rail || st.rail.hidden) return;
    const rail = st.rail;
    rail.innerHTML = '';
    const tabs = h('div', { class: 'seg rd-rail-tabs' });
    (st.kind === 'epub' ? [['toc', 'Contents'], ['hl', 'Highlights']] : [['pages', 'Pages'], ['toc', 'Contents'], ['hl', 'Highlights']]).forEach(([id, l]) => tabs.append(h('button', { class: st.railTab === id ? 'on' : '', onclick: () => { st.railTab = id; renderRail(); } }, l)));
    const body = h('div', { class: 'rd-rail-body' });
    rail.append(tabs, body);
    if (st.railTab === 'pages') {
      const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
        if (!en.isIntersecting || en.target.dataset.done) return;
        en.target.dataset.done = '1';
        try {
          const page = await st.pdf.getPage(+en.target.dataset.n);
          const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 220 / vp1.width });
          const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          en.target.querySelector('.rd-th-img').append(c);
        } catch (e) { /* ignore */ }
      }), { root: body, rootMargin: '400px 0px' });
      st.pages.forEach((p) => {
        const t = h('button', { class: 'rd-th' + (p.n === st.page ? ' on' : ''), dataset: { n: p.n }, onclick: () => goto(p.n, 0, false) }, h('span', { class: 'rd-th-img', style: { aspectRatio: String(1 / p.aspect) } }), h('span', { class: 'rd-th-n num' }, String(p.n)));
        body.append(t); io.observe(t);
      });
      requestAnimationFrame(() => { const on = body.querySelector('.rd-th.on'); if (on) on.scrollIntoView({ block: 'center' }); });
    } else if (st.railTab === 'toc' && st.kind === 'epub') {
      if (!st.toc) { body.append(h('p', { class: 'muted small rd-pad' }, 'Loading contents…')); return; }
      if (!st.toc.length) body.append(h('p', { class: 'muted small rd-pad' }, 'This book has no table of contents.'));
      st.toc.forEach((t) => body.append(h('button', { class: 'rd-toc', style: { paddingLeft: 10 + t.depth * 14 + 'px' }, onclick: () => st.rendition.display(t.href) }, t.label.trim())));
    } else if (st.railTab === 'toc') {
      if (!st.outline) {
        body.append(h('p', { class: 'muted small rd-pad' }, 'Loading contents…'));
        st.pdf.getOutline().then(async (ol) => { st.outline = ol || []; renderRail(); }).catch(() => { st.outline = []; renderRail(); });
        return;
      }
      if (!st.outline.length) { body.append(h('p', { class: 'muted small rd-pad' }, 'This PDF has no table of contents. Use Pages or search instead.')); return; }
      const walk = (items, depth) => items.forEach((it) => {
        const b = h('button', { class: 'rd-toc', style: { paddingLeft: 10 + depth * 14 + 'px' } }, it.title);
        b.addEventListener('click', async () => {
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await st.pdf.getDestination(dest);
            if (dest) goto((await st.pdf.getPageIndex(dest[0])) + 1, 0, false);
          } catch (e) { A.toast('That entry has no page'); }
        });
        body.append(b);
        if (it.items && it.items.length && depth < 3) walk(it.items, depth + 1);
      });
      walk(st.outline, 0);
    } else {
      const hls = st.ann.highlights.slice().sort((a, b) => (a.page || 0) - (b.page || 0) || a.created - b.created);
      if (!hls.length) body.append(h('p', { class: 'muted small rd-pad' }, 'Switch to the highlighter in the top bar, or draw a box and tap Highlight. Your highlights collect here.'));
      hls.forEach((hl) => body.append(h('button', { class: 'rd-hl-item', onclick: () => { if (hl.cfi) st.rendition.display(hl.cfi); else goto(hl.page, hl.rect[1]); } }, h('i', { class: 'rd-sw ' + (hl.color || 'yellow') }), h('span', { class: 'grow' }, hl.text || 'Highlighted region'), hl.page ? h('span', { class: 'num muted small' }, 'p. ' + hl.page) : null)));
    }
  }

  /* ---------- search ---------- */
  function openSearch(anchor) {
    const boxEl = h('div', { class: 'rd-search' });
    const inp = h('input', { class: 'field', type: 'search', id: 'rd-search-in', placeholder: 'Search in this book', style: { margin: 0 } });
    const res = h('div', { class: 'rd-search-res' });
    let token = 0;
    const run = async () => {
      const q = inp.value.trim().toLowerCase();
      const my = ++token;
      res.innerHTML = '';
      if (q.length < 2) return;
      const status = h('p', { class: 'muted small' }, 'Searching…'); res.append(status);
      let found = 0;
      for (let n = 1; n <= st.pages.length && my === token; n++) {
        const lines = await RD.lines(n);
        for (const l of lines) {
          const i = l.text.toLowerCase().indexOf(q);
          if (i < 0) continue;
          found++;
          const snip = l.text.slice(Math.max(0, i - 40), i + q.length + 60);
          res.append(h('button', { class: 'rd-hit', onclick: () => { A.closePopovers(); st.cites = [{ page: n, rects: [[l.r[0] - 0.004, l.r[1] - 0.003, l.r[2] + 0.004, l.r[3] + 0.003]], flash: true }]; goto(n, l.r[1]); drawOverlays(n); } }, h('span', { class: 'num muted small' }, 'p. ' + n), h('span', null, snip)));
          if (found > 60) break;
        }
        if (found > 60) break;
        if (n % 20 === 0) status.textContent = `Searching… page ${n} of ${st.pages.length}`;
      }
      if (my === token) status.textContent = found ? `${found}${found > 60 ? '+' : ''} matches` : 'No matches. Scanned pages have no searchable text.';
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    boxEl.append(inp, res);
    A.popover(boxEl, anchor, { side: 'down' });
    setTimeout(() => inp.focus(), 50);
  }

  /* ---------- tutor panel ---------- */
  function toggleTutor(open = host.querySelector('.rd-tutor').hidden) {
    const t = host.querySelector('.rd-tutor');
    t.hidden = !open;
    host.classList.toggle('with-tutor', open);
    host.querySelector('#rd-btn-tutor').classList.toggle('on', open);
    S.readerTutor = open; A.saveSettings();
    if (open && !t.querySelector('.tutor')) { t.querySelector('.rd-tutor-body').innerHTML = ''; A.AI.mount(t.querySelector('.rd-tutor-body'), readerCtx); }
    requestAnimationFrame(() => layout());
  }
  function toggleRail(open = st.rail.hidden) {
    st.rail.hidden = !open;
    host.classList.toggle('with-rail', open);
    host.querySelector('#rd-btn-rail').classList.toggle('on', open);
    S.readerRail = open; A.saveSettings();
    renderRail();
    requestAnimationFrame(() => layout());
  }
  const applyWidth = () => host.style.setProperty('--rdw', Math.round(A.clamp(S.readerTutorW || innerWidth * 0.36, Math.min(320, innerWidth * 0.45), innerWidth * (innerWidth < 1000 ? 0.5 : 0.6))) + 'px');

  /* ---------- EPUB (reflowable books, paginated like Apple Books) ---------- */
  const EPUB_THEMES = {
    paper: { body: { color: '#1b1d22', background: '#ffffff' } },
    sepia: { body: { color: '#3b3021', background: '#f4ecd8' } },
    night: { body: { color: '#d9dce2', background: '#16171a' } },
  };
  function applyEpubTheme() {
    if (!st || !st.rendition) return;
    st.rendition.themes.select(S.readerTheme || 'paper');
    st.rendition.themes.fontSize(Math.round((S.epubFont || 1) * 108) + '%');
  }
  RD.applyEpubTheme = applyEpubTheme;
  async function openEpub(meta, token, main, bottomParts) {
    const ePub = await A.ST.epubLib();
    const blob = await A.store.loadFile('doc_' + meta.id, 'application/epub+zip');
    if (!blob) throw new Error('missing');
    const book = ePub(await blob.arrayBuffer());
    if (!st || st.token !== token) return;
    st.book = book;
    main.classList.add('rd-epub-main');
    const stage = h('div', { class: 'rd-epub-stage' });
    const view = h('div', { class: 'rd-epub' });
    const prev = h('button', { class: 'rd-turn prev', 'aria-label': 'Previous page', html: A.icon('chev') });
    const next = h('button', { class: 'rd-turn next', 'aria-label': 'Next page', html: A.icon('chev') });
    stage.append(prev, view, next);
    main.append(stage);
    const rendition = book.renderTo(view, { width: '100%', height: '100%', flow: 'paginated', spread: 'auto', allowScriptedContent: false });
    st.rendition = rendition;
    Object.entries(EPUB_THEMES).forEach(([k, v]) => rendition.themes.register(k, Object.assign({}, v, {
      'p, li, blockquote': { 'line-height': '1.6' }, body: Object.assign({}, v.body, { 'font-family': '"Iowan Old Style", "Palatino", Georgia, serif', padding: '0 8px !important' }),
      '::selection': { background: 'rgba(80,140,255,.35)' },
    })));
    applyEpubTheme();
    prev.addEventListener('click', () => rendition.prev());
    next.addEventListener('click', () => rendition.next());
    // swipe and tap zones inside the book's frames
    rendition.hooks.content.register((contents) => {
      const doc = contents.document;
      let sx = 0, sy = 0, t0 = 0;
      doc.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now(); }, { passive: true });
      doc.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (Date.now() - t0 < 600 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !doc.getSelection().toString()) (dx < 0 ? rendition.next() : rendition.prev());
      }, { passive: true });
      doc.addEventListener('keyup', (e) => { if (e.key === 'ArrowRight') rendition.next(); if (e.key === 'ArrowLeft') rendition.prev(); });
    });
    // highlights saved by CFI
    const paintHl = (hl) => { try { rendition.annotations.highlight(hl.cfi, { id: hl.id }, () => {}, 'rd-epub-hl', { fill: { yellow: '#ffd60a', green: '#4bd27a', blue: '#4d9bff', pink: '#ff5fa8' }[hl.color || 'yellow'], 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' }); } catch (e) { /* stale cfi */ } };
    st.paintHl = paintHl;
    // selection → actions
    rendition.on('selected', async (cfi, contents) => {
      let text = '';
      try { text = (await book.getRange(cfi)).toString(); } catch (e) { text = contents.window.getSelection().toString(); }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      let rect = null;
      try { const rr = contents.window.getSelection().getRangeAt(0).getBoundingClientRect(); const fr = contents.document.defaultView.frameElement.getBoundingClientRect(); rect = { left: fr.left + rr.left, top: fr.top + rr.top, right: fr.left + rr.right, bottom: fr.top + rr.bottom }; } catch (e) { /* position fallback */ }
      showEpubActions(cfi, text, rect, contents);
    });
    const [lbl, total, scrub] = bottomParts;
    scrub.min = 0; scrub.max = 1000; scrub.value = 0;
    scrub.addEventListener('change', () => { if (st.locReady) rendition.display(book.locations.cfiFromPercentage(+scrub.value / 1000)); });
    rendition.on('relocated', (loc) => {
      if (!st) return;
      st.loc = loc;
      const pct = st.locReady ? book.locations.percentageFromCfi(loc.start.cfi) : (loc.start.percentage || 0);
      lbl.textContent = Math.round(pct * 100) + '%';
      if (st.locReady) scrub.value = Math.round(pct * 1000);
      const item = st.toc && st.toc.find((t) => loc.start.href && loc.start.href.split('#')[0].endsWith(t.href.split('#')[0]));
      total.textContent = item ? item.label.trim() : '';
      clearTimeout(st._sv);
      st._sv = setTimeout(() => { const d = A.ST.doc(meta.id); if (d) { d.cfi = loc.start.cfi; d.progress = pct; d.lastRead = Date.now(); A.saveSettings(); } }, 500);
      clearActions();
    });
    book.loaded.navigation.then((nav) => { if (st) { st.toc = flattenToc(nav.toc || []); renderRail(); } }).catch(() => {});
    book.loaded.metadata.then((md) => { if (md && md.title && st) host.querySelector('.rd-title-main').textContent = md.title; }).catch(() => {});
    await rendition.display(meta.cfi || undefined);
    (st.ann.highlights || []).filter((x) => x.cfi).forEach(paintHl);
    book.ready.then(() => book.locations.generate(1400)).then(() => { if (!st) return; st.locReady = true; if (st.loc) rendition.reportLocation ? rendition.reportLocation() : null; }).catch(() => {});
    const d = A.ST.doc(meta.id); if (d) { d.lastRead = Date.now(); A.saveSettings(); }
  }
  const flattenToc = (items, depth = 0, out = []) => { items.forEach((it) => { out.push({ label: it.label, href: it.href, depth }); if (it.subitems && it.subitems.length) flattenToc(it.subitems, depth + 1, out); }); return out; };
  function showEpubActions(cfi, text, rect, contents) {
    clearActions();
    const hr = host.getBoundingClientRect();
    const bar = h('div', { class: 'rd-actions', role: 'toolbar', 'aria-label': 'Selection' });
    const b = (icon, label, fn, primary) => { const x = h('button', { class: primary ? 'primary' : '', onclick: fn }); x.innerHTML = A.icon(icon); x.append(label); bar.append(x); };
    const att = { kind: 'text', label: '“' + text.slice(0, 32) + (text.length > 32 ? '…”' : '”'), text, cfi };
    const done = () => { clearActions(); try { contents.window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } };
    b('spark', 'Ask', () => { done(); toggleTutor(true); A.AI.ask('', { send: false, attachments: [att] }); }, true);
    b('book', 'Explain', () => { done(); toggleTutor(true); A.AI.ask('Explain this passage rigorously.', { mode: 'explain', attachments: [att] }); });
    b('help', 'Hint', () => { done(); toggleTutor(true); A.AI.ask('Give me a hint for this. Not the solution.', { mode: 'hint', attachments: [att] }); });
    b('rename', 'Highlight', () => { const hl = { id: A.uid(), cfi, color: 'yellow', text, created: Date.now() }; st.ann.highlights.push(hl); st.paintHl(hl); saveAnn(); renderRail(); done(); A.toast('Highlighted'); });
    b('copy', 'Copy', () => { copyText(text); done(); });
    host.append(bar);
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const x = rect ? (rect.left + rect.right) / 2 - bw / 2 - hr.left : hr.width / 2 - bw / 2;
    let y = rect ? rect.top - bh - 12 - hr.top : 80;
    if (y < 70 && rect) y = rect.bottom + 12 - hr.top;
    bar.style.left = A.clamp(x, 8, hr.width - bw - 8) + 'px';
    bar.style.top = A.clamp(y, 64, hr.height - bh - 60) + 'px';
  }
  const epubChapterText = () => {
    try { const c = st.rendition.getContents()[0]; return (c && c.document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim(); } catch (e) { return ''; }
  };

  /* ---------- open / close ---------- */
  RD.open = async (meta) => {
    if (st) RD.close(true);
    host.innerHTML = '';
    const token = Math.random();
    const isEpub = meta.type === 'epub';
    st = { meta, kind: isEpub ? 'epub' : 'pdf', pages: [], zoom: 1, fit: S.readerFit || 'width', tool: 'read', page: meta.lastPage || 1, ann: ann0(), cites: [], focus: null, railTab: isEpub ? 'toc' : 'pages', token, inkTool: 'pen', inkColor: 'black', inkWidth: 0.0026, inkHist: [] };
    const ib = (icon, title, fn, id) => { const b = h('button', { class: 'ibtn', title, 'aria-label': title, id, html: A.icon(icon) }); b.addEventListener('click', fn); return b; };
    const subj = meta.subject && A.SU.get(meta.subject);
    const toolSeg = h('div', { class: 'seg rd-tools' });
    const inkBar = h('div', { class: 'rd-group panel rd-inkbar', hidden: true });
    const setTool = (t) => { st.tool = t; [...toolSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.t === t)); host.dataset.tool = t; inkBar.hidden = t !== 'write'; clearActions(); };
    [['read', 'Ask', 'b-select', 'Pencil draws a box or loop to ask about'], ['highlight', 'Highlight', 'rename', 'Pencil highlights passages'], ['write', 'Write', 'b-pen', 'Write on the page with the Pencil']].forEach(([t, l, ic, tip]) => { const b = h('button', { dataset: { t }, title: tip }); b.innerHTML = A.icon(ic); b.append(l); b.addEventListener('click', () => setTool(t)); toolSeg.append(b); });
    const drawInkBar = () => {
      inkBar.innerHTML = '';
      Object.entries(INK).forEach(([k, c]) => inkBar.append(h('button', { class: 'rd-ink-c' + (st.inkTool === 'pen' && st.inkColor === k ? ' on' : ''), style: { background: c }, 'aria-label': k + ' pen', onclick: () => { st.inkTool = 'pen'; st.inkColor = k; drawInkBar(); } })));
      inkBar.append(h('div', { class: 'sb-sep' }));
      [[0.0018, 'Fine'], [0.0026, 'Medium'], [0.0042, 'Bold']].forEach(([w, l]) => inkBar.append(h('button', { class: 'rd-ink-w' + (Math.abs(st.inkWidth - w) < 1e-6 ? ' on' : ''), title: l, 'aria-label': l + ' line', onclick: () => { st.inkWidth = w; st.inkTool = 'pen'; drawInkBar(); } }, h('i', { style: { height: Math.round(w * 900) + 'px' } }))));
      inkBar.append(h('div', { class: 'sb-sep' }));
      const er = ib('b-eraser', 'Eraser', () => { st.inkTool = st.inkTool === 'eraser' ? 'pen' : 'eraser'; drawInkBar(); }); er.classList.toggle('on', st.inkTool === 'eraser'); inkBar.append(er);
      inkBar.append(ib('undo', 'Undo', () => RD.inkUndo()));
    };
    drawInkBar();
    const themeBtn = ib('eye', 'Reading theme', (e) => {
      const m = h('div', { class: 'menu' });
      [['paper', 'Paper'], ['sepia', 'Sepia'], ['night', 'Night']].forEach(([id, l]) => m.append(h('button', { class: (S.readerTheme || 'paper') === id ? 'on' : '', onclick: () => { S.readerTheme = id; A.saveSettings(); host.dataset.theme = id; applyEpubTheme(); A.closePopovers(); } }, h('i', { class: 'rd-theme-dot ' + id }), l)));
      if (!isEpub) m.append(h('hr'), h('button', { onclick: () => { st.fit = st.fit === 'width' ? 'page' : 'width'; S.readerFit = st.fit; A.saveSettings(); st.zoom = 1; layout(); A.closePopovers(); } }, A.iconEl('scale'), st.fit === 'width' ? 'Fit whole page' : 'Fit page width'));
      A.popover(m, e.currentTarget, { side: 'down' });
    });
    const pageLbl = h('span', { class: 'num rd-page-n' }, String(st.page));
    const scrub = h('input', { type: 'range', class: 'rd-scrub', id: 'rd-scrub', min: 1, max: 1, value: st.page, 'aria-label': 'Page' });
    scrub.addEventListener('input', () => { pageLbl.textContent = scrub.value; });
    scrub.addEventListener('change', () => goto(+scrub.value, 0, false));
    const total = h('span', { class: 'num muted' }, '');
    const top = h('header', { class: 'rd-top' },
      h('div', { class: 'rd-group panel' },
        ib('chev', 'Back to library', () => { RD.close(); A.emit('go:gallery'); }, 'rd-back'),
        h('div', { class: 'rd-title' }, h('div', { class: 'rd-title-main' }, meta.name), h('div', { class: 'rd-title-sub' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, subj ? subj.name : (meta.kind === 'sheet' ? 'Problem set' : 'Book'))),
        h('div', { class: 'sb-sep' }), ib('gallery', isEpub ? 'Contents and highlights' : 'Pages, contents and highlights', () => toggleRail(), 'rd-btn-rail'), isEpub ? null : ib('search', 'Search', (e) => openSearch(e.currentTarget))),
      isEpub ? null : h('div', { class: 'rd-group-wrap' }, h('div', { class: 'rd-group panel' }, toolSeg), inkBar),
      h('div', { class: 'rd-group panel' },
        (() => { const b = isEpub ? h('button', { class: 'ibtn rd-aa', title: 'Smaller text', 'aria-label': 'Smaller text', onclick: () => { S.epubFont = A.clamp((S.epubFont || 1) - 0.1, 0.7, 2); A.saveSettings(); applyEpubTheme(); } }, 'A') : ib('minus', 'Zoom out', () => { st.zoom = A.clamp(st.zoom / 1.2, 0.5, 3); layout(); }); b.classList.add('rd-zoom'); return b; })(),
        (() => { const b = isEpub ? h('button', { class: 'ibtn rd-aa big', title: 'Larger text', 'aria-label': 'Larger text', onclick: () => { S.epubFont = A.clamp((S.epubFont || 1) + 0.1, 0.7, 2); A.saveSettings(); applyEpubTheme(); } }, 'A') : ib('plus', 'Zoom in', () => { st.zoom = A.clamp(st.zoom * 1.2, 0.5, 3); layout(); }); b.classList.add('rd-zoom'); return b; })(),
        themeBtn,
        isEpub ? null : ib('rename', 'Work on this page on the canvas', () => { const m = A.ST.doc(meta.id); RD.close(); A.UI.studyDoc(m); }),
        h('div', { class: 'sb-sep' }),
        ib('spark', 'Tutor', () => toggleTutor(), 'rd-btn-tutor')));
    const main = h('main', { class: 'rd-main', tabindex: 0 });
    const pagesWrap = h('div', { class: 'rd-pages' });
    main.append(pagesWrap);
    const rail = h('aside', { class: 'rd-rail', hidden: true });
    const tutor = h('aside', { class: 'rd-tutor', hidden: true }, h('div', { class: 'rd-grip', title: 'Drag to resize' }), h('div', { class: 'rd-tutor-body' }));
    const bottom = h('footer', { class: 'rd-bottom panel' }, h('span', { class: 'muted small' }, isEpub ? '' : 'Page'), pageLbl, total, scrub);
    host.append(top, rail, main, tutor, bottom);
    host.dataset.theme = S.readerTheme || 'paper';
    host.style.setProperty('--rd-filter', '');
    Object.assign(st, { main, rail, pageLbl, scrub });
    setTool('read');
    applyWidth();
    // resize tutor
    const grip = tutor.querySelector('.rd-grip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const mv = (ev) => { S.readerTutorW = Math.round(innerWidth - ev.clientX); applyWidth(); };
      const upg = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', upg); A.saveSettings(); layout(); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', upg);
    });
    host.hidden = false;
    // content
    st.ann = await loadAnn(meta.id);
    if (isEpub) {
      try { await openEpub(meta, token, main, [pageLbl, total, scrub]); }
      catch (e) { console.error(e); main.append(h('p', { class: 'muted rd-pad' }, 'This EPUB could not be opened. It may be protected by DRM (books bought in Apple Books usually are).')); }
      if (st && S.readerRail) toggleRail(true);
      if (st && S.readerTutor) toggleTutor(true);
      return;
    }
    if (meta.type === 'image') {
      pagesWrap.append(h('p', { class: 'muted rd-pad' }, 'Photos open on the canvas. Use “Work on this page on the canvas”.'));
      return;
    }
    try {
      await A.ST.pdfLib();
      st.pdf = await A.ST.loadPdf(meta);
    } catch (e) {
      pagesWrap.append(h('p', { class: 'muted rd-pad' }, 'This PDF could not be opened.'));
      return;
    }
    if (!st || st.token !== token) return;
    const n = st.pdf.numPages;
    total.textContent = '/ ' + n;
    scrub.max = n;
    const p1 = await st.pdf.getPage(1), vp = p1.getViewport({ scale: 1 });
    for (let i = 1; i <= n; i++) {
      const ov = h('div', { class: 'rd-ov' });
      const el = h('div', { class: 'rd-page', dataset: { n: i } }, h('span', { class: 'rd-pg-ph num' }, String(i)), ov);
      pagesWrap.append(el);
      st.pages.push({ n: i, el, ov, aspect: vp.height / vp.width, canvas: null, w: 0 });
    }
    st.io = new IntersectionObserver((ents) => ents.forEach((en) => { const p = st.pages[+en.target.dataset.n - 1]; if (!p) return; p.visible = en.isIntersecting; if (en.isIntersecting) { renderPage(p); drawOverlays(p.n); } }), { root: main, rootMargin: '1200px 0px' });
    st.pages.forEach((p) => st.io.observe(p.el));
    main.addEventListener('scroll', onScroll, { passive: true });
    bindSelect(main);
    bindPinch(main, pagesWrap);
    layout(false);
    if (S.readerRail) toggleRail(true);
    if (S.readerTutor) toggleTutor(true);
    requestAnimationFrame(() => goto(st.page, 0, false));
    // record reading
    const d = A.ST.doc(meta.id); if (d) { d.lastRead = Date.now(); d.pages = n; A.saveSettings(); }
  };
  function bindPinch(main, inner) {
    const pts = new Map(); let d0 = 0, z0 = 1, pz = 0;
    main.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = st.zoom; } });
    main.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && d0) { const [a, b] = [...pts.values()]; pz = A.clamp(z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / d0, 0.5, 3); inner.style.transformOrigin = 'top center'; inner.style.transform = `scale(${pz / st.zoom})`; }
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2 && pz) { inner.style.transform = ''; st.zoom = pz; pz = 0; d0 = 0; layout(); } };
    main.addEventListener('pointerup', end); main.addEventListener('pointercancel', end);
  }
  RD.close = (silent) => {
    if (!st) return;
    try { st.io && st.io.disconnect(); } catch (e) { /* ignore */ }
    try { if (st.rendition) st.rendition.destroy(); } catch (e) { /* ignore */ }
    if (st.book) { const bk = st.book; Promise.resolve(bk.ready).catch(() => {}).then(() => { try { bk.destroy(); } catch (e) { /* ignore */ } }); }
    saveAnn.flush && saveAnn.flush();
    const d = A.ST.doc(st.meta.id); if (d) { d.lastPage = st.page; d.lastRead = Date.now(); A.saveSettings(); }
    st = null;
    host.hidden = true;
    host.innerHTML = '';
    void silent;
  };
  RD.isOpen = () => !!st;
  RD.mount = (el) => {
    host = el;
    addEventListener('resize', () => { if (st) { applyWidth(); layout(); } });
    addEventListener('keydown', (e) => {
      if (!st || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { goto(st.page + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { goto(st.page - 1); e.preventDefault(); }
      if (e.key === 'Escape') { st.focus = null; clearActions(); redrawAll(); }
    });
  };
})();
