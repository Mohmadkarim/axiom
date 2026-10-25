/* Cropping pictures on the page (photos, PDF pages, Desmos graphs): the full picture is kept, the crop is a
   rectangle in the picture's own units that can be changed or removed later. */
'use strict';
(() => {
  const D = A.D, R = A.R, B = A.B, M = A.M, h = A.h;
  const CR = (A.CROP = {});
  const MIN = 8; // smallest crop, in picture units

  /* the uncropped picture: its size and placement */
  const original = (it) => {
    const c = it.crop;
    if (!c) return { iw: it.iw, ih: it.ih, m: it.m.slice(), rect: [0, 0, it.iw, it.ih] };
    return { iw: c.iw0, ih: c.ih0, m: M.mul(it.m, [1, 0, 0, 1, -c.x, -c.y]), rect: [c.x, c.y, c.x + c.w, c.y + c.h] };
  };
  /* apply a crop rectangle [x0, y0, x1, y1] (picture units of the original); a full rectangle removes the crop */
  const apply = (it, o, r) => {
    const full = r[0] <= 0.5 && r[1] <= 0.5 && r[2] >= o.iw - 0.5 && r[3] >= o.ih - 0.5;
    const next = Object.assign({}, it, { iw: r[2] - r[0], ih: r[3] - r[1], m: M.mul(o.m, [1, 0, 0, 1, r[0], r[1]]) });
    if (full) { delete next.crop; next.iw = o.iw; next.ih = o.ih; next.m = o.m; }
    else next.crop = { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1], iw0: o.iw, ih0: o.ih };
    next.bb = B.imageBB(next);
    return next;
  };
  CR.canCrop = () => {
    if (R.sel.size !== 1 || !D.doc) return null;
    const id = [...R.sel][0];
    for (const l of D.doc.layers) for (const it of l.items) if (it.id === id && it.t === 'i' && !l.locked) return it;
    return null;
  };

  let ui = null;
  CR.start = (item = CR.canCrop()) => {
    if (!item || ui) return;
    const o = original(item);
    const T = M.mul(R.matrix(), o.m); // picture units -> stage pixels
    if (Math.abs(T[1]) > 1e-3 * Math.abs(T[0]) || Math.abs(T[2]) > 1e-3 * Math.abs(T[3])) { A.toast('Straighten the picture (rotation 0°) to crop it.'); return; }
    const stage = A.$('#stage').getBoundingClientRect();
    const sx = T[0], sy = T[3], ox = T[4] + stage.left, oy = T[5] + stage.top;
    const toScr = (x, y) => [ox + x * sx, oy + y * sy];
    const r = o.rect.slice();
    A.emit('selection:clear');
    R.hideId = item.id; R.render();
    const back = h('div', { class: 'crop-ui' });
    const img = h('img', { class: 'crop-img', src: item.src, alt: '' });
    const shade = h('div', { class: 'crop-shade' });
    const box = h('div', { class: 'crop-box' });
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((k) => { const d = h('div', { class: 'crop-h h-' + k, dataset: { k } }); box.append(d); return d; });
    const bar = h('div', { class: 'crop-bar panel' },
      h('button', { class: 'btn ghost-btn', onclick: () => finish(false) }, 'Cancel'),
      h('button', { class: 'btn ghost-btn', onclick: () => { r[0] = 0; r[1] = 0; r[2] = o.iw; r[3] = o.ih; draw(); } }, 'Reset'),
      h('button', { class: 'btn primary', onclick: () => finish(true) }, 'Crop'));
    back.append(img, shade, box, bar);
    document.body.append(back);
    ui = back;
    const [ax, ay] = toScr(0, 0), [bx, by] = toScr(o.iw, o.ih);
    Object.assign(img.style, { left: Math.min(ax, bx) + 'px', top: Math.min(ay, by) + 'px', width: Math.abs(bx - ax) + 'px', height: Math.abs(by - ay) + 'px', transform: `scale(${Math.sign(sx)}, ${Math.sign(sy)})` });
    function draw() {
      const [x0, y0] = toScr(r[0], r[1]), [x1, y1] = toScr(r[2], r[3]);
      const L = Math.min(x0, x1), Tp = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
      Object.assign(box.style, { left: L + 'px', top: Tp + 'px', width: W + 'px', height: H + 'px' });
      shade.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${L}px ${Tp}px, ${L}px ${Tp + H}px, ${L + W}px ${Tp + H}px, ${L + W}px ${Tp}px, ${L}px ${Tp}px)`;
      const bw = bar.offsetWidth || 260;
      bar.style.left = A.clamp(L + W / 2 - bw / 2, 12, innerWidth - bw - 12) + 'px';
      bar.style.top = (Tp + H + 64 < innerHeight ? Tp + H + 14 : Math.max(12, Tp - 58)) + 'px';
    }
    draw();
    // drag a handle, or the box itself to move the crop
    let drag = null;
    const toPic = (px, py) => [(px - ox) / sx, (py - oy) / sy];
    back.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.crop-bar')) return;
      e.preventDefault();
      const k = e.target.dataset.k || (e.target === box ? 'move' : null);
      if (!k) return;
      drag = { k, id: e.pointerId, start: toPic(e.clientX, e.clientY), r0: r.slice() };
      back.setPointerCapture(e.pointerId);
    });
    back.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [px, py] = toPic(e.clientX, e.clientY), dx = px - drag.start[0], dy = py - drag.start[1], q = drag.r0;
      const k = drag.k;
      if (k === 'move') {
        const w = q[2] - q[0], hh = q[3] - q[1];
        r[0] = A.clamp(q[0] + dx, 0, o.iw - w); r[1] = A.clamp(q[1] + dy, 0, o.ih - hh); r[2] = r[0] + w; r[3] = r[1] + hh;
      } else {
        if (k.includes('w')) r[0] = A.clamp(q[0] + dx, 0, r[2] - MIN);
        if (k.includes('e')) r[2] = A.clamp(q[2] + dx, r[0] + MIN, o.iw);
        if (k.includes('n')) r[1] = A.clamp(q[1] + dy, 0, r[3] - MIN);
        if (k.includes('s')) r[3] = A.clamp(q[3] + dy, r[1] + MIN, o.ih);
      }
      draw();
    });
    const up = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    back.addEventListener('pointerup', up); back.addEventListener('pointercancel', up);
    function finish(ok) {
      back.remove(); ui = null; R.hideId = null;
      if (ok) {
        const next = apply(item, o, r);
        D.begin(); D.replace(new Map([[item.id, [next]]])); D.commit();
        A.SEL.set(new Set([next.id]));
      } else A.SEL.set(new Set([item.id]));
      R.render(); A.emit('layers:thumbs');
    }
  };
  CR.active = () => !!ui;
})();
