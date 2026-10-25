/* Axiom tool UI: Tool Bar and Tool Wheel (8 slots, size/opacity/smoothing, color, undo/redo), brush menu */
'use strict';
(() => {
  const B = A.B, D = A.D, R = A.R, h = A.h;
  const UI = (A.UI = A.UI || {});
  const S = A.settings;
  let host;

  const slot = () => B.slot();
  const fmtSize = (v) => (v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
  const propVal = (k, s = slot()) => (k === 'size' ? fmtSize(s.size) : Math.round(s[k] * 100) + '%');
  const PROPS = [
    { k: 'size', l: 'Size' },
    { k: 'opacity', l: 'Opac' },
    { k: 'smoothing', l: 'Smth' },
  ];

  UI.setSlot = (i) => {
    i = A.clamp(i, 0, 7);
    if (i !== S.activeSlot) S.prevSlot = S.activeSlot;
    S.activeSlot = i;
    A.saveSettings();
    A.emit('slot');
  };
  UI.updateSlot = (patch) => {
    Object.assign(slot(), patch);
    A.saveSettings();
    A.emit('slot');
  };
  A.on('slot:select', (i) => UI.setSlot(i));

  /* Apple Pencil double-tap (native app) follows the system setting in Settings › Apple Pencil */
  const isEraser = (b) => b === 'slice' || b === 'eraser' || b === 'mask' || b === 'softmask';
  A.on('pencil:tap', (action) => {
    if (!D.doc) { if (A.RD && A.RD.pencilTap) A.RD.pencilTap(); return; }
    if (action && action.forced) action = action.forced;
    else if (S.pencilTap && S.pencilTap !== 'system') action = S.pencilTap;
    if (action === 'undo') { A.emit('cmd', 'undo'); return; }
    if (action === 'toggleUI') { A.emit('cmd', 'toggleUI'); return; }
    const cur = S.activeSlot;
    if (action === 'switchEraser') {
      if (isEraser(S.slots[cur].b)) UI.setSlot(S.prevSlot != null && !isEraser(S.slots[S.prevSlot].b) ? S.prevSlot : 0);
      else {
        const e = S.slots.findIndex((s) => isEraser(s.b));
        if (e >= 0) UI.setSlot(e); else A.toast('Put an eraser in a tool slot to use double-tap');
      }
      A.toast(B.catalog[slot().b].name, 900);
    } else if (action === 'switchPrevious') {
      if (S.prevSlot != null) { UI.setSlot(S.prevSlot); A.toast(B.catalog[slot().b].name, 900); }
    } else if (action === 'showColorPalette') {
      const c = host && host.querySelector('.colorbtn, .wcenter');
      if (c) UI.openColor(c);
    } else if (action === 'showInkAttributes') {
      UI.openBrushMenu(slotEl(S.activeSlot), S.activeSlot);
    }
  });
  /* Apple Pencil Pro squeeze: brush menu where the Pencil is hovering */
  A.on('pencil:squeeze', (pt) => {
    if (!D.doc) return;
    if (S.pencilSqueeze === 'undo') { A.emit('cmd', 'undo'); return; }
    if (S.pencilSqueeze === 'eraser') { A.emit('pencil:tap', { forced: 'switchEraser' }); return; }
    if (S.pencilSqueeze === 'palette') { const c = host && host.querySelector('.colorbtn, .wcenter'); if (c) UI.openColor(c); return; }
    UI.openBrushMenu(pt ? { x: pt.x, y: pt.y } : slotEl(S.activeSlot), S.activeSlot);
  });
  A.on('slot:size', (f) => {
    const s = slot(), c = B.catalog[s.b];
    UI.updateSlot({ size: A.clamp(s.size * f, c.min || 0.2, c.max || 200) });
  });
  A.on('color:pick', (c) => { UI.updateSlot({ color: c }); UI.pushRecent && UI.pushRecent(c); });

  /* ---------- value adjusting (tap → slider, drag → live adjust) ---------- */
  const clampProp = (k, v) => {
    const c = B.catalog[slot().b];
    if (k === 'size') return A.clamp(v, Math.max(0.1, c.min), c.max);
    return A.clamp(v, k === 'opacity' ? 0.02 : 0, 1);
  };
  const bindProp = (el, k, onLive) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const y0 = e.clientY, x0 = e.clientX, v0 = slot()[k];
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const dy = ev.clientY - y0, dx = ev.clientX - x0;
        if (!moved && Math.hypot(dx, dy) > 7) { moved = true; el.classList.add('adjusting'); }
        if (!moved) return;
        const d = -dy + dx * 0.4;
        const v = k === 'size' ? v0 * Math.exp(d * 0.018) : v0 + d * 0.005;
        slot()[k] = clampProp(k, v);
        onLive && onLive();
        R.renderOverlay();
      };
      const up = () => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('adjusting');
        if (moved) { A.saveSettings(); A.emit('slot'); }
        else UI.openSlider(k, el);
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };

  UI.openSlider = (k, anchor) => {
    const s = slot(), c = B.catalog[s.b];
    const box = h('div', { class: 'slider-pop' });
    const big = h('div', { class: 'big' });
    const isSize = k === 'size';
    const lo = isSize ? Math.log(Math.max(0.1, c.min)) : 0, hi = isSize ? Math.log(c.max) : 1;
    const range = h('input', { type: 'range', min: 0, max: 1000, id: 'slider-' + k });
    const toR = (v) => (isSize ? ((Math.log(v) - lo) / (hi - lo)) * 1000 : v * 1000);
    const fromR = (r) => (isSize ? Math.exp(lo + (r / 1000) * (hi - lo)) : r / 1000);
    let presets;
    if (isSize) { const b = c.size; presets = [b * 0.5, b, b * 2, b * 4].map((v) => clampProp('size', +v.toPrecision(2))); }
    else if (k === 'opacity') presets = [0.25, 0.5, 0.75, 1];
    else presets = [0, 0.25, 0.5, 1];
    const pbox = h('div', { class: 'presets' });
    const sync = () => {
      big.textContent = propVal(k);
      range.value = toR(slot()[k]);
      [...pbox.children].forEach((b, i) => b.classList.toggle('on', Math.abs(presets[i] - slot()[k]) < 1e-3));
    };
    presets.forEach((v) => pbox.append(h('button', { onclick: () => { slot()[k] = v; A.saveSettings(); A.emit('slot'); sync(); } },
      isSize ? fmtSize(v) : Math.round(v * 100) + '%')));
    range.addEventListener('input', () => { slot()[k] = clampProp(k, fromR(+range.value)); big.textContent = propVal(k); A.emit('slot:live'); });
    range.addEventListener('change', () => { A.saveSettings(); A.emit('slot'); sync(); });
    const titles = { size: 'Size', opacity: 'Opacity', smoothing: 'Smoothing' };
    const hint = k === 'smoothing' ? h('p', { class: 'muted small' }, '0% follows your hand exactly. 50% removes bumps. 100% draws a straight line between the start and end points.') : null;
    box.append(h('h4', null, titles[k] + ' · ' + c.name), big, range, pbox, hint);
    sync();
    A.popover(box, anchor, { side: S.toolSide === 'right' ? 'left' : 'right' });
  };

  /* ---------- brush menu ---------- */
  UI.openBrushMenu = (anchor, slotIndex = S.activeSlot) => {
    const s = S.slots[slotIndex];
    const box = h('div', { class: 'brush-menu' });
    const cv = h('canvas', { class: 'brush-preview' });
    const drawPreview = () => {
      const r = cv.getBoundingClientRect();
      const W = Math.max(280, r.width || 316), H = 86, dpr = A.dpr || 2;
      cv.width = W * dpr; cv.height = H * dpr;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = D.doc ? D.doc.paper.bg : '#fff';
      ctx.fillRect(0, 0, W, H);
      const c = B.catalog[s.b];
      if (c.kind === 'tool' && !c.mask) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
        ctx.font = '600 13px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tips = { slice: 'Cuts through vector strokes', eraser: 'Removes whole strokes it touches', select: 'Lasso or tap to select strokes', nudge: 'Push and pull strokes like string' };
        ctx.fillText(tips[s.b] || c.name, W / 2, H / 2);
        return;
      }
      if (c.mask) {
        const base = B.previewItem({ b: 'marker', color: '#7d8799', size: 26, opacity: 1 }, W, H);
        base.pts = [20, H / 2, 1, W - 20, H / 2, 1]; base.bb = A.G.bbox(base.pts, 20);
        const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
        const o = off.getContext('2d'); o.setTransform(dpr, 0, 0, dpr, 0, 0);
        B.render(o, base, 1);
        B.render(o, B.previewItem(s, W, H), 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0);
        return;
      }
      B.render(ctx, B.previewItem(s, W, H), 1);
    };
    const grid = h('div', { class: 'brush-grid' });
    const groups = [['Draw', ['pencil', 'pen', 'brushpen', 'fineliner', 'wire', 'dotted', 'marker', 'highlighter', 'airbrush', 'fill']],
      ['Erase', ['slice', 'eraser', 'mask', 'softmask']], ['Edit', ['select', 'nudge']]];
    const rebuild = () => {
      grid.innerHTML = '';
      for (const [gl, ids] of groups) {
        grid.append(h('div', { class: 'gl' }, gl));
        for (const id of ids) {
          const c = B.catalog[id];
          const b = h('button', { class: s.b === id ? 'on' : '', onclick: () => {
            const keepColor = s.color;
            Object.assign(s, { b: id, size: c.size, opacity: c.opacity, smoothing: c.smoothing, color: keepColor });
            A.saveSettings(); A.emit('slot'); rebuild(); drawPreview();
          } });
          b.innerHTML = A.icon(c.icon);
          b.append(c.name);
          grid.append(b);
        }
      }
    };
    rebuild();
    box.append(h('h4', null, `Slot ${slotIndex + 1} · Brushes`), cv, grid);
    const pop = A.popover(box, anchor, { side: S.toolSide === 'right' ? 'left' : 'right' });
    requestAnimationFrame(() => { drawPreview(); pop._place(); });
  };

  /* ---------- Tool Bar ---------- */
  /* slim tool bar: tools with a colour dot, one properties dot, the current colour, undo/redo */
  function renderBar() {
    const bar = h('div', { class: 'toolbar slim panel', role: 'toolbar', 'aria-label': 'Tools' });
    const grip = h('div', { class: 'tb-grip', title: 'Drag to move · double-tap for the Tool Wheel', html: A.icon('grip') });
    bar.append(grip);
    bindMove(grip, true);
    S.slots.forEach((s, i) => {
      const c = B.catalog[s.b];
      const b = h('button', { class: 'slot' + (i === S.activeSlot ? ' on' : ''), title: `${c.name} (${i + 1})`, 'aria-label': c.name, html: A.icon(c.icon) });
      if (B.isDrawing(s.b)) b.append(h('i', { class: 'slot-dot', style: { background: s.color } }));
      bindSlot(b, i);
      bar.append(b);
    });
    bar.append(h('div', { class: 'tb-div' }));
    const s = slot(), c = B.catalog[s.b];
    // properties: a dot whose size follows the brush size
    const d = A.clamp(4 + Math.log2(1 + s.size) * 3.2, 4, 22);
    const props = h('button', { class: 'tb-props', title: 'Size, opacity and smoothing', 'aria-label': 'Size, opacity and smoothing' },
      h('i', { style: { width: d + 'px', height: d + 'px', background: B.isDrawing(s.b) ? A.C.rgba(s.color, Math.max(0.25, s.opacity)) : 'var(--fg)' } }),
      h('span', { class: 'num' }, fmtSize(s.size)));
    props.addEventListener('click', () => UI.openProps(props));
    bar.append(props);
    const cb = h('button', { class: 'colorbtn slim', 'aria-label': 'Colour', title: 'Colour', style: { background: s.color } });
    cb.addEventListener('click', () => UI.openColor(cb));
    if (!(B.isDrawing(s.b) || s.b === 'text')) { cb.disabled = true; cb.style.background = 'transparent'; cb.title = 'This tool has no colour'; }
    bar.append(cb); // always present, so the rail never shifts when tools change
    if (S.showPalette && UI.activePaletteColors) {
      const strip = h('div', { class: 'palette-strip slim' });
      UI.activePaletteColors().slice(0, 4).forEach((col) => strip.append(h('button', {
        class: col.toLowerCase() === s.color.toLowerCase() ? 'on' : '', style: { background: col }, 'aria-label': col,
        onclick: () => { UI.updateSlot({ color: col }); UI.pushRecent(col); },
      })));
      bar.append(strip);
    }
    bar.append(h('div', { class: 'tb-div' }));
    const ub = h('button', { class: 'ibtn', id: 'btn-undo', title: 'Undo (two-finger tap)', 'aria-label': 'Undo', html: A.icon('undo'), onclick: () => A.emit('cmd', 'undo') });
    const rb = h('button', { class: 'ibtn', id: 'btn-redo', title: 'Redo (three-finger tap)', 'aria-label': 'Redo', html: A.icon('redo'), onclick: () => A.emit('cmd', 'redo') });
    bar.append(ub, rb);
    return bar;
  }
  /* one popover for size, opacity and smoothing */
  UI.openProps = (anchor) => {
    const box = h('div', { class: 'props-pop' });
    const draw = () => {
      box.innerHTML = '';
      const s = slot(), c = B.catalog[s.b];
      box.append(h('div', { class: 'pp-h' }, c.name));
      const row = (k, label) => {
        const isSize = k === 'size';
        const lo = isSize ? Math.log(Math.max(0.1, c.min)) : 0, hi = isSize ? Math.log(c.max) : 1;
        const toR = (v) => (isSize ? ((Math.log(v) - lo) / (hi - lo)) * 1000 : v * 1000);
        const fromR = (r) => (isSize ? Math.exp(lo + (r / 1000) * (hi - lo)) : r / 1000);
        const val = h('span', { class: 'pp-v num' }, propVal(k));
        const range = h('input', { type: 'range', min: 0, max: 1000, value: toR(s[k]), 'aria-label': label });
        range.addEventListener('input', () => { slot()[k] = clampProp(k, fromR(+range.value)); val.textContent = propVal(k); A.emit('slot:live'); });
        range.addEventListener('change', () => { A.saveSettings(); A.emit('slot'); });
        return h('div', { class: 'pp-row' }, h('div', { class: 'pp-top' }, h('span', null, label), val), range);
      };
      box.append(row('size', 'Size'));
      if (c.kind !== 'tool') box.append(row('opacity', 'Opacity'), row('smoothing', 'Smoothing'));
    };
    draw();
    A.popover(box, anchor, { side: S.toolSide === 'right' ? 'left' : 'right' });
  };

  function bindSlot(el, i) {
    let lp;
    el.addEventListener('pointerdown', () => { lp = setTimeout(() => { lp = null; UI.setSlot(i); UI.openBrushMenu(slotEl(i), i); }, 450); });
    const clear = () => { if (lp) clearTimeout(lp); };
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('click', () => {
      if (lp === null) return; // long press handled
      if (S.activeSlot === i) UI.openBrushMenu(el, i);
      else UI.setSlot(i);
    });
  }
  const slotEl = (i) => host.querySelectorAll('.slot, .seg-slot')[i] || host;

  /* drag the bar/wheel around; snaps to the nearest side */
  function bindMove(el, isBar) {
    let lastTap = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const now = performance.now();
      if (now - lastTap < 320) { S.toolSetup = isBar ? 'wheel' : 'bar'; A.saveSettings(); render(); lastTap = 0; return; }
      lastTap = now;
      const r = host.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      el.setPointerCapture(e.pointerId);
      let moved = false;
      const mv = (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        moved = true;
        host.style.left = ev.clientX - ox + 'px';
        host.style.top = ev.clientY - oy + 'px';
        host.style.right = 'auto';
      };
      const up = (ev) => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        if (!moved) return;
        const rr = host.getBoundingClientRect();
        const cx = rr.left + rr.width / 2;
        S.toolSide = cx < innerWidth / 2 ? 'left' : 'right';
        if (!isBar) {
          // dropping the wheel against an edge turns it into the bar (as in Concepts)
          if (rr.left < 24 || rr.right > innerWidth - 24) S.toolSetup = 'bar';
          S.toolPos = { x: rr.left, y: rr.top };
        } else S.toolPos = { y: rr.top };
        A.saveSettings();
        render();
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
    });
  }

  /* ---------- Tool Wheel ---------- */
  const arc = (r0, r1, a0, a1) => {
    const p = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
  };
  function renderWheel() {
    const wrap = h('div', { class: 'wheel', style: { width: '300px', height: '300px' } });
    const s = slot();
    const NS = 'http://www.w3.org/2000/svg';
    let svg = `<svg viewBox="-150 -150 300 300" xmlns="${NS}"><g class="ring-shadow">`;
    const gap = 0.012;
    S.slots.forEach((sl, i) => {
      const a0 = -Math.PI / 2 + (i * Math.PI) / 4 - Math.PI / 8 + gap, a1 = a0 + Math.PI / 4 - gap * 2;
      svg += `<path class="seg-slot${i === S.activeSlot ? ' on' : ''}" data-i="${i}" d="${arc(68, 122, a0, a1)}"/>`;
    });
    PROPS.forEach((p, i) => {
      const a0 = -Math.PI / 2 - Math.PI / 3 + (i * 2 * Math.PI) / 3 + gap, a1 = a0 + (2 * Math.PI) / 3 - gap * 2;
      svg += `<path class="seg-prop" data-k="${p.k}" d="${arc(36, 64, a0, a1)}"/>`;
    });
    svg += `</g>`;
    S.slots.forEach((sl, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 4, c = B.catalog[sl.b];
      const x = Math.cos(a) * 92, y = Math.sin(a) * 92;
      svg += `<g class="wicon${i === S.activeSlot ? ' on' : ''}">${A.iconAt(c.icon, x - 12, y - 14, 24)}</g>`;
      if (B.isDrawing(sl.b)) svg += `<circle cx="${Math.cos(a) * 113}" cy="${Math.sin(a) * 113}" r="4" fill="${sl.color}" stroke="rgba(0,0,0,.2)"/>`;
    });
    PROPS.forEach((p, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      const x = Math.cos(a) * 50, y = Math.sin(a) * 50;
      svg += `<text x="${x}" y="${y - 1}" text-anchor="middle" data-v="${p.k}">${propVal(p.k)}</text><text class="lbl" x="${x}" y="${y + 10}" text-anchor="middle">${p.l.toUpperCase()}</text>`;
    });
    svg += `<circle class="wcenter" r="32" fill="${A.C.rgba(s.color, Math.max(0.15, s.opacity))}" stroke="#fff" stroke-width="3"/>`;
    svg += `<g class="ur" data-u="undo"><circle class="ur" cx="-118" cy="118" r="20"/>${A.iconAt('undo', -129, 107, 22)}</g>`;
    svg += `<g class="ur" data-u="redo"><circle class="ur" cx="118" cy="118" r="20"/>${A.iconAt('redo', 107, 107, 22)}</g>`;
    svg += `</svg>`;
    wrap.innerHTML = svg;
    // slots: tap selects, drag moves the wheel
    wrap.querySelectorAll('.seg-slot').forEach((el) => {
      const i = +el.dataset.i;
      el.addEventListener('click', () => { if (wrap._moved) return; if (S.activeSlot === i) UI.openBrushMenu(el, i); else UI.setSlot(i); });
    });
    wrap.querySelectorAll('.seg-prop').forEach((el) => bindProp(el, el.dataset.k, () => {
      const t = wrap.querySelector(`text[data-v="${el.dataset.k}"]`); if (t) t.textContent = propVal(el.dataset.k);
    }));
    const center = wrap.querySelector('.wcenter');
    center.addEventListener('click', () => { if (!wrap._moved) UI.openColor(center); });
    wrap.querySelectorAll('g.ur').forEach((g) => g.addEventListener('click', () => A.emit('cmd', g.dataset.u === 'undo' ? 'undo' : 'redo')));
    // move by dragging slot ring / center
    wrap.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (t.classList.contains('seg-prop') || t.closest('g.ur')) return;
      wrap._moved = false;
      const r = host.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => {
        if (!wrap._moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 10) return;
        wrap._moved = true;
        host.style.left = ev.clientX - ox + 'px'; host.style.top = ev.clientY - oy + 'px'; host.style.right = 'auto';
      };
      const up = () => {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        if (!wrap._moved) return;
        const rr = host.getBoundingClientRect();
        S.toolSide = rr.left + rr.width / 2 < innerWidth / 2 ? 'left' : 'right';
        if (rr.left < 4 || rr.right > innerWidth - 4) { S.toolSetup = 'bar'; S.toolPos = { y: rr.top }; }
        else S.toolPos = { x: rr.left, y: rr.top };
        A.saveSettings(); render();
        setTimeout(() => (wrap._moved = false), 50);
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    return wrap;
  }

  function place() {
    const isBar = S.toolSetup !== 'wheel';
    const pos = S.toolPos || {};
    host.style.right = 'auto';
    const r = host.getBoundingClientRect();
    const W = r.width || (isBar ? 64 : 300), H = r.height || 600;
    let x, y;
    const sb = A.$('#statusbar');
    const safeL = 10, top = sb ? Math.round(sb.getBoundingClientRect().bottom + 10) : 64;
    if (isBar || pos.x == null) x = S.toolSide === 'right' ? innerWidth - W - safeL : safeL;
    else x = pos.x;
    y = pos.y != null ? pos.y : Math.max(top, (innerHeight - H) / 2);
    x = A.clamp(x, -W * 0.4, innerWidth - W * 0.6);
    y = A.clamp(y, top, Math.max(top, innerHeight - H - 8));
    host.style.left = x + 'px';
    host.style.top = y + 'px';
  }

  function render() {
    if (!host) return;
    host.innerHTML = '';
    host.append(S.toolSetup === 'wheel' ? renderWheel() : renderBar());
    place();
    syncHistory();
  }
  function syncHistory() {
    const u = A.$('#btn-undo'), r = A.$('#btn-redo');
    if (A.PK && A.PK.active) { if (u) u.disabled = !A.PK.order.length; if (r) r.disabled = !A.PK.redoOrder.length; return; }
    if (u) u.disabled = !D.history.undo.length && !D.history.pending;
    if (r) r.disabled = !D.history.redo.length;
  }
  UI.renderTools = render;
  UI.mountTools = (el) => {
    host = el;
    render();
    A.on('slot', render);
    A.on('history', syncHistory);
    A.on('palette', render);
    addEventListener('resize', place);
  };
})();
