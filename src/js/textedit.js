/* Axiom text boxes and sticky notes: an editor laid over the canvas, with a small format bar */
'use strict';
(() => {
  const D = A.D, R = A.R, B = A.B, h = A.h;
  const S = A.settings;
  const TE = (A.TE = {});
  let stage = null, ed = null;
  const COLORS = ['#16181d', '#1f4fbf', '#c0392b', '#1e8449', '#7d3cff', '#e67e22'];
  const STICKY = [null, '#fff1a8', '#ffd6e0', '#cdeffd', '#d7f5d0', '#e8dcff'];

  TE.mount = (el) => {
    stage = el;
    A.on('canvas:down', () => { if (ed) TE.commit(); });
    document.addEventListener('pointerdown', (e) => { if (ed && !e.target.closest('.te-area, .te-bar, .popover, #overlay')) TE.commit(); }, true);
    A.on('view', () => { if (ed) place(); });
    A.on('doc:close', () => { if (ed) TE.commit(); });
  };
  TE.active = () => !!ed;

  const textSlot = () => { const s = B.slot(); return s && s.b === 'text' ? s : (S.slots.find((x) => x.b === 'text') || { color: '#16181d', size: 20, font: 'sans' }); };

  TE.create = (x, y, width, opts = {}) => {
    const sl = textSlot();
    const zoom = D.doc.view.zoom;
    let iw = width && width > 40 ? width : Math.min(420, Math.max(220, (R.w * 0.4) / zoom));
    if (D.isNotebook()) {
      // keep the box on the page
      const i = D.pageAt(D.doc, x, y), rc = D.pageRect(D.doc, i);
      x = A.clamp(x, rc[0] + 8, rc[2] - 60);
      iw = Math.min(iw, rc[2] - 12 - x);
    }
    const item = B.makeText(Object.assign({ text: '', fs: opts.fs || sl.size || 20, font: sl.font || 'sans', c: sl.color || '#16181d', iw, m: [1, 0, 0, 1, x, y - (opts.fs || sl.size || 20) * 0.6] }, opts));
    open(item, true);
  };
  TE.edit = (item) => open(item, false);

  function open(item, isNew) {
    if (ed) TE.commit();
    const ta = h('textarea', { class: 'te-area', spellcheck: 'true', 'aria-label': 'Text box' });
    ta.value = item.text || '';
    const bar = h('div', { class: 'te-bar panel' });
    ed = { item: Object.assign({}, item), isNew, ta, bar };
    R.hideId = isNew ? null : item.id;
    R.render();
    ta.addEventListener('input', () => { ed.item.text = ta.value; place(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); TE.commit(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); TE.commit(); }
      e.stopPropagation();
    });
    stage.append(ta);
    stage.parentElement.append(bar);
    drawBar();
    place();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
  }

  /* one quiet bar: font, size, bold, colour (with sticky-note papers inside), done */
  const FONT_NAMES = { sans: 'Sans', serif: 'Serif', mono: 'Mono', round: 'Round' };
  function drawBar() {
    const it = ed.item, bar = ed.bar;
    bar.innerHTML = '';
    const upd = (patch) => { Object.assign(ed.item, patch); drawBar(); place(); ed.ta.focus(); };
    const keys = Object.keys(B.FONTS);
    const font = h('button', { class: 'te-font', style: { fontFamily: B.FONTS[it.font] }, title: 'Font', onclick: () => upd({ font: keys[(keys.indexOf(it.font) + 1) % keys.length] }) }, FONT_NAMES[it.font] || 'Sans');
    const dot = h('button', { class: 'te-sw', style: { background: it.bg || B.col(it.c) }, 'aria-label': 'Colour and paper' });
    dot.addEventListener('click', () => {
      const box = h('div', { class: 'menu te-colors' });
      const row1 = h('div', { class: 'nb-sw' }), row2 = h('div', { class: 'nb-sw' });
      COLORS.forEach((c) => row1.append(h('button', { class: 'nb-swatch' + (!it.bg && it.c === c ? ' on' : ''), style: { background: c }, 'aria-label': 'Text ' + c, onclick: () => { A.closePopovers(); upd({ c, bg: undefined }); } })));
      STICKY.filter(Boolean).forEach((c) => row2.append(h('button', { class: 'nb-swatch sq' + (it.bg === c ? ' on' : ''), style: { background: c }, 'aria-label': 'Sticky note ' + c, onclick: () => { A.closePopovers(); upd({ bg: c }); } })));
      box.append(h('div', { class: 'sub' }, 'Text'), row1, h('div', { class: 'sub' }, 'Sticky note'), row2);
      A.popover(box, dot, { side: 'down' });
    });
    bar.append(font,
      h('button', { class: 'ibtn', 'aria-label': 'Smaller', onclick: () => upd({ fs: Math.max(8, Math.round(it.fs / 1.15)) }) }, '−'),
      h('span', { class: 'te-fs num' }, String(Math.round(it.fs))),
      h('button', { class: 'ibtn', 'aria-label': 'Larger', onclick: () => upd({ fs: Math.min(160, Math.round(it.fs * 1.15)) }) }, '+'),
      h('button', { class: 'ibtn' + (it.bold ? ' on' : ''), 'aria-label': 'Bold', style: { fontWeight: 800 }, onclick: () => upd({ bold: !it.bold }) }, 'B'),
      dot,
      h('button', { class: 'ibtn', 'aria-label': 'Delete text box', html: A.icon('trash'), onclick: () => { ed.item.text = ''; TE.commit(); } }),
      h('button', { class: 'te-done', onclick: () => TE.commit() }, 'Done'));
  }

  function place() {
    if (!ed) return;
    const it = ed.item;
    const zoom = D.doc.view.zoom;
    const k = Math.sqrt(Math.abs(A.M.det(it.m))) * zoom;
    const [sx, sy] = R.toScreen(it.m[4], it.m[5]);
    const pad = B.textPad(it);
    const L = B.layoutText(Object.assign({}, it, { text: it.text || ' ' }));
    const ta = ed.ta;
    Object.assign(ta.style, {
      left: sx + 'px', top: sy + 'px', width: it.iw * k + 'px', height: Math.max(L.h, it.fs * 1.6) * k + 'px',
      font: `${it.bold ? 700 : 400} ${it.fs * k}px/${1.36} ${B.FONTS[it.font] || B.FONTS.sans}`,
      padding: `${pad * k + it.fs * k * 0.02}px ${pad * k}px`, color: it.bg ? '#2a2620' : B.col(it.c),
      background: it.bg || 'transparent', borderRadius: it.bg ? 6 * k + 'px' : '4px',
    });
    const bar = ed.bar, br = stage.getBoundingClientRect();
    bar.style.left = A.clamp(sx, 10, br.width - 520) + 'px';
    bar.style.top = Math.max(64, sy - 54) + 'px';
  }

  TE.commit = () => {
    if (!ed) return;
    const { item, isNew, ta, bar } = ed;
    ed = null;
    ta.remove(); bar.remove();
    R.hideId = null;
    const text = String(item.text || '').replace(/\s+$/, '');
    if (!text) {
      if (!isNew) { D.begin(); D.removeIds([item.id]); D.commit(); }
      R.render();
      return;
    }
    const next = B.makeText(Object.assign({}, item, { id: isNew ? item.id : A.uid(), text }));
    const stamp = A.IN.stamp && A.IN.stamp();
    if (stamp && isNew) Object.assign(next, stamp);
    D.begin();
    if (isNew) {
      let l = D.active();
      if (l.locked || !l.visible) l = D.doc.layers.slice().reverse().find((x) => !x.locked && x.visible) || D.addLayer();
      D.addItems([next], l);
    } else D.replace(new Map([[item.id, [next]]]));
    D.commit();
    R.render();
    A.emit('layers:thumbs');
  };
})();
