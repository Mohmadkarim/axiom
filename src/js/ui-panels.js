/* Axiom panels: status bar, precision, selection menu/popup, import/export, settings, help */
'use strict';
(() => {
  const B = A.B, D = A.D, R = A.R, G = A.G, M = A.M, GU = A.GU, h = A.h;
  const UI = (A.UI = A.UI || {});
  const S = A.settings;

  /* ================= status bar ================= */
  UI.mountStatus = (el) => {
    const opt = (b) => (b.classList.add('sb-opt'), b);
    const btn = (icon, title, fn, id) => {
      const b = h('button', { class: 'ibtn', title, 'aria-label': title, id, html: A.icon(icon) });
      b.addEventListener('click', fn);
      return b;
    };
    const name = h('button', { class: 'sb-name', id: 'doc-name', title: 'Rename drawing' });
    name.addEventListener('click', async () => {
      const n = await A.dialog({ title: 'Rename drawing', input: D.doc.name, okText: 'Rename' });
      if (n && n.trim()) { D.doc.name = n.trim().slice(0, 80); D.changed('meta'); syncName(); }
    });
    const precBtn = btn('precision', 'Precision (P)', () => togglePrecision(), 'btn-precision');
    const layBtn = btn('layers', 'Layers (L)', () => toggleLayers(), 'btn-layers');
    const visBtn = btn('shapes', 'Visual tools', (e) => A.V.open(e.currentTarget), 'btn-visuals');
    const left = h('div', { class: 'sb-group panel' },
      btn('gallery', 'Gallery', () => A.emit('go:gallery')), name, h('div', { class: 'sb-sep' }), precBtn, layBtn, visBtn);
    const readout = h('button', { id: 'readout', class: 'panel', title: 'View options' });
    readout.addEventListener('click', () => viewMenu(readout));
    const right = h('div', { class: 'sb-group panel' },
      btn('book', 'Study panel: documents and tutor', () => A.ST.toggle(), 'btn-study'),
      h('div', { class: 'sb-sep' }),
      opt(btn('import', 'Import', (e) => importMenu(e.currentTarget))),
      opt(btn('export', 'Export', () => UI.openExport())),
      opt(btn('hide', 'Hide interface (H)', () => A.emit('cmd', 'toggleUI'))),
      btn('settings', 'Settings', () => UI.openSettings()),
      opt(btn('help', 'Help and gestures', () => UI.openHelp())),
      (() => { const b = btn('more', 'More', () => {
        const box = h('div', { class: 'menu' });
        const it = (icon, label, fn) => { const x = h('button', { onclick: () => { A.closePopovers(); fn(); } }); x.innerHTML = A.icon(icon); x.append(label); box.append(x); };
        it('import', 'Import', () => importMenu(b));
        it('export', 'Export', () => UI.openExport());
        it('hide', 'Hide interface', () => A.emit('cmd', 'toggleUI'));
        it('help', 'Help and gestures', () => UI.openHelp());
        A.popover(box, b, { side: 'down' });
      }); b.classList.add('sb-more'); return b; })());
    el.append(left, readout, right);
    const syncName = () => { name.textContent = D.doc ? D.doc.name : ''; };
    UI.syncName = syncName;
    A.on('view', syncReadout);
    A.on('selection', syncReadout);
    A.on('selection:preview', syncReadout);
    A.on('doc:open', () => { syncName(); syncReadout(); });
  };
  function syncReadout() {
    const el = A.$('#readout');
    if (!el || !D.doc) return;
    const v = D.doc.view;
    let rot = ((A.deg(v.rot) % 360) + 360) % 360;
    if (rot > 180) rot -= 360;
    const parts = [`<b>${v.zoom >= 1 ? Math.round(v.zoom * 100) : (v.zoom * 100).toFixed(v.zoom < 0.1 ? 1 : 0)}%</b>`, `<span class="hide-sm">${rot.toFixed(0)}°</span>`];
    if (R.sel.size && A.SEL.box) {
      const bb = A.SEL.box, T = R.selPreview;
      let w = bb[2] - bb[0], hh = bb[3] - bb[1];
      if (T) { const k = Math.sqrt(Math.abs(M.det(T))); w *= k; hh *= k; }
      parts.push(`<span>${R.sel.size} sel · ${A.fmtLen(w)} × ${A.fmtLen(hh)}</span>`);
    }
    el.innerHTML = parts.join('<span class="dot"></span>');
  }
  function viewMenu(anchor) {
    const box = h('div', { class: 'menu' });
    const it = (label, fn) => box.append(h('button', { onclick: () => { A.closePopovers(); fn(); } }, label));
    it('Zoom to 100%', () => R.zoomAt(R.w / 2, R.h / 2, 1 / D.doc.view.zoom));
    it('Reset rotation', () => R.zoomAt(R.w / 2, R.h / 2, 1, -D.doc.view.rot));
    it('Fit drawing to screen', () => R.fitBB(D.allBB()));
    if (R.sel.size && A.SEL.box) it('Zoom to selection', () => R.fitBB(A.SEL.box, 100));
    it('Go to origin', () => R.setView({ tx: R.w / 2, ty: R.h / 2, zoom: 1, rot: 0 }));
    A.popover(box, anchor, { side: 'down' });
  }

  /* ================= precision ================= */
  let precHost;
  function togglePrecision(force) {
    const show = force != null ? force : precHost.hidden;
    precHost.hidden = !show;
    A.$('#btn-precision').classList.toggle('on', show);
    if (show) { renderPrecision(); const b = A.$('#btn-precision').getBoundingClientRect(); precHost.style.left = Math.max(10, b.left - 10) + 'px'; }
  }
  function toggleLayers(force) {
    const host = A.$('#layers');
    const show = force != null ? force : host.hidden;
    host.hidden = !show;
    A.$('#btn-layers').classList.toggle('on', show);
    if (show) UI.renderLayers();
  }
  UI.togglePrecision = togglePrecision;
  UI.toggleLayers = toggleLayers;

  const check = (label, checked, on, id) => {
    const inp = h('input', { type: 'checkbox', id });
    inp.checked = !!checked;
    inp.addEventListener('change', () => on(inp.checked));
    const l = h('label', { class: 'check', for: id }, inp, h('span', { class: 'box', html: A.icon('check') }), label);
    return l;
  };
  const segc = (opts, val, on) => {
    const s = h('div', { class: 'seg' });
    opts.forEach(([v, l]) => s.append(h('button', { class: v === val ? 'on' : '', onclick: () => on(v) }, l)));
    return s;
  };
  const toggleSw = (checked, on, id) => {
    const inp = h('input', { type: 'checkbox', id, role: 'switch' });
    inp.checked = !!checked;
    inp.addEventListener('change', () => on(inp.checked));
    return h('label', { class: 'toggle' }, inp, h('span'));
  };

  function renderPrecision() {
    if (!precHost || precHost.hidden) return;
    const doc = D.doc, P = doc.precision, g = doc.paper.grid;
    const changed = () => { D.changed('precision'); R.render(); renderPrecision(); A.emit('precision'); UI.renderLayers(); };
    precHost.innerHTML = '';
    // grid
    const gridRow = h('div', { class: 'prec-row' }, check('Grid', P.grid, (v) => { P.grid = v; if (v && g.type === 'none') g.type = 'dot'; changed(); }, 'p-grid'));
    if (P.grid) {
      const unitsLen = A.fmtLen(g.spacing);
      const sp = h('input', { type: 'range', min: 6, max: 120, step: 1, value: g.spacing, id: 'p-spacing' });
      const spv = h('b', null, unitsLen);
      sp.addEventListener('input', () => { g.spacing = +sp.value; spv.textContent = A.fmtLen(g.spacing); R.render(); });
      sp.addEventListener('change', () => changed());
      const op = h('input', { type: 'range', min: 10, max: 100, value: Math.round((g.opacity ?? 1) * 100), id: 'p-gop' });
      op.addEventListener('input', () => { g.opacity = +op.value / 100; R.render(); });
      op.addEventListener('change', () => D.changed('precision'));
      const opts = h('div', { class: 'opts' },
        segc([['dot', 'Dot'], ['graph', 'Graph'], ['lined', 'Lined'], ['iso', 'Iso'], ['tri', 'Triangle']], g.type, (v) => { g.type = v; changed(); }),
        h('div', { class: 'lab' }, 'Spacing', spv), sp);
      if (g.type === 'graph' || g.type === 'lined') {
        const dv = h('b', null, String(g.divisions));
        const dn = h('div', { class: 'row gap' },
          h('button', { class: 'ibtn', 'aria-label': 'Fewer divisions', html: A.icon('minus'), onclick: () => { g.divisions = Math.max(1, g.divisions - 1); changed(); } }),
          dv,
          h('button', { class: 'ibtn', 'aria-label': 'More divisions', html: A.icon('plus'), onclick: () => { g.divisions = Math.min(10, g.divisions + 1); changed(); } }));
        opts.append(h('div', { class: 'lab' }, 'Divisions', h('span')), dn);
      }
      opts.append(h('div', { class: 'lab' }, 'Opacity', h('span')), op);
      gridRow.append(opts);
    }
    // snap
    const snapRow = h('div', { class: 'prec-row' }, check('Snap', P.snap, (v) => { P.snap = v; if (v && !P.grid) { P.grid = true; A.toast('Grid turned on for snapping'); } changed(); }, 'p-snap'));
    if (P.snap) snapRow.append(h('div', { class: 'opts' },
      segc([['grid', 'Snap to grid'], ['align', 'Align to grid']], P.snapMode, (v) => { P.snapMode = v; changed(); }),
      h('div', { class: 'row between' }, h('span', { class: 'small muted' }, 'Connect to stroke ends'), toggleSw(P.connect, (v) => { P.connect = v; D.changed('precision'); }, 'p-connect')),
      h('p', { class: 'small muted', style: { margin: 0 } }, P.snapMode === 'grid' ? 'Strokes become straight segments between grid points.' : 'Strokes become straight lines along the grid directions.')));
    // measure
    const measRow = h('div', { class: 'prec-row' }, check('Measure', P.measure, (v) => { P.measure = v; changed(); }, 'p-measure'));
    if (P.measure) {
      const sc = h('input', { class: 'field', type: 'number', min: 0.0001, step: 'any', value: P.scale, id: 'p-scale', style: { margin: 0, width: '110px' } });
      sc.addEventListener('change', () => { const v = +sc.value; if (v > 0) { P.scale = v; changed(); } });
      measRow.append(h('div', { class: 'opts' },
        segc([['px', 'px'], ['pt', 'pt'], ['mm', 'mm'], ['cm', 'cm'], ['in', 'in']], P.units, (v) => { P.units = v; changed(); }),
        h('div', { class: 'row gap' }, h('span', { class: 'small muted' }, 'Drawing scale  1 :'), sc)));
    }
    // guides
    const guideRow = h('div', { class: 'prec-row' }, check('Shape guide', P.guide, (v) => { P.guide = v; changed(); R.renderOverlay(); }, 'p-guide'));
    if (P.guide) guideRow.append(h('div', { class: 'opts' },
      segc(GU.types.map((t) => [t.id, t.name]), P.guideType, (v) => { P.guideType = v; changed(); R.renderOverlay(); }),
      h('div', { class: 'row between' }, h('span', { class: 'small muted' }, 'Double-tap the center for a perfect shape.'),
        h('button', { class: 'btn', onclick: () => { GU.reset(); R.renderOverlay(); } }, 'Re-center'))));
    // recognition
    const recRow = h('div', { class: 'prec-row' }, check('Draw & hold for shapes', P.recog, (v) => { P.recog = v; changed(); }, 'p-recog'),
      P.recog ? h('p', { class: 'small muted', style: { margin: '8px 0 0' } }, 'Hold at the end of a stroke to make a line, arc, circle, ellipse, triangle, rectangle or polygon. Keep holding and move to scale or rotate it.') : null);
    precHost.append(gridRow, snapRow, measRow, guideRow, recRow);
  }

  /* ================= selection menu + popup ================= */
  let selMenu, selPop;
  A.clip = null;
  try { const raw = localStorage.getItem('axiom.clip'); if (raw) A.clip = JSON.parse(raw); } catch (e) { /* ignore */ }

  const selectTool = () => B.slot().b === 'select';
  function renderSelMenu() {
    if (!selMenu) return;
    const has = R.sel.size > 0;
    const show = selectTool() || has;
    selMenu.hidden = !show;
    if (!show) return;
    selMenu.innerHTML = '';
    const ib = (icon, title, on, fn, id) => {
      const b = h('button', { class: 'ibtn' + (on ? ' on' : ''), title, 'aria-label': title, id, html: A.icon(icon) });
      b.addEventListener('click', fn);
      return b;
    };
    if (!has) {
      selMenu.append(
        segc([['lasso', 'Lasso'], ['picker', 'Picker']], A.IN.selMode, (v) => { A.IN.selMode = v; renderSelMenu(); }),
        ib('partial', 'Partial: select strokes the lasso only touches', A.IN.selPartial, () => { A.IN.selPartial = !A.IN.selPartial; A.toast(A.IN.selPartial ? 'Partial strokes are selected' : 'Only strokes fully inside are selected'); renderSelMenu(); }),
        ib('layerone', 'Select on the active layer only', A.IN.selLayerOnly, () => { A.IN.selLayerOnly = !A.IN.selLayerOnly; A.toast(A.IN.selLayerOnly ? 'Active layer only' : 'All layers'); renderSelMenu(); }),
        h('div', { class: 'sb-sep' }),
        ib('selectall', 'Select all', false, () => A.emit('cmd', 'selectAll')),
        ...(A.clip && A.clip.items && A.clip.items.length ? [ib('paste', 'Paste', false, () => A.emit('cmd', 'paste'))] : []));
    } else {
      const modes = { scale: ['scale', 'Scale with strokes'], stretch: ['stretch', 'Stretch (keep stroke width)'], off: ['lock', 'Scaling locked'] };
      const [icon, title] = modes[A.IN.scaleMode];
      selMenu.append(
        h('span', { class: 'sm-label num' }, `${R.sel.size} selected`),
        ib(icon, title, A.IN.scaleMode !== 'off', () => {
          A.IN.scaleMode = { scale: 'stretch', stretch: 'off', off: 'scale' }[A.IN.scaleMode];
          A.toast(modes[A.IN.scaleMode][1]); renderSelMenu(); R.renderOverlay();
        }),
        ib('rotate', A.IN.allowSelRotate ? 'Rotation on' : 'Rotation off', A.IN.allowSelRotate, () => { A.IN.allowSelRotate = !A.IN.allowSelRotate; renderSelMenu(); R.renderOverlay(); }),
        h('div', { class: 'sb-sep' }),
        ib('selectall', 'Select all', false, () => A.emit('cmd', 'selectAll')),
        ib('close', 'Deselect', false, () => A.SEL.clear()));
    }
  }
  function renderSelPopup() {
    if (!selPop) return;
    const c = R.sel.size && !R.selPreview ? A.SEL.screenCorners() : null;
    if (!c) { selPop.hidden = true; return; }
    selPop.hidden = false;
    if (!selPop.childElementCount) {
      const ib = (icon, title, cmd) => {
        const b = h('button', { class: 'ibtn', title, 'aria-label': title, html: A.icon(icon) });
        b.addEventListener('click', (e) => (cmd === 'moveto' ? moveToMenu(e.currentTarget) : A.emit('cmd', cmd)));
        return b;
      };
      selPop.append(ib('duplicate', 'Duplicate', 'duplicate'), ib('copy', 'Copy', 'copy'), ib('trash', 'Delete', 'delete'),
        h('div', { class: 'sb-sep' }), ib('fliph', 'Flip horizontal', 'flipH'), ib('flipv', 'Flip vertical', 'flipV'),
        ib('recolor', 'Apply current color', 'recolor'), ib('front', 'Bring to front', 'front'), ib('back', 'Send to back', 'back'),
        ib('moveto', 'Move to layer', 'moveto'), h('div', { class: 'sb-sep' }), ib('bookmark', 'Save as visual', 'saveVisual'), ib('spark', 'Ask the tutor about this', 'askTutor'));
    }
    const ys = c.map((p) => p[1]), xs = c.map((p) => p[0]);
    const r = selPop.getBoundingClientRect();
    let y = Math.min(...ys) - r.height - 46;
    if (y < 70) y = Math.max(...ys) + 16;
    const x = A.clamp((Math.min(...xs) + Math.max(...xs)) / 2 - r.width / 2, 8, innerWidth - r.width - 8);
    selPop.style.left = x + 'px';
    selPop.style.top = A.clamp(y, 64, innerHeight - r.height - 76) + 'px';
  }
  function moveToMenu(anchor) {
    const box = h('div', { class: 'menu' });
    box.append(h('div', { class: 'sub' }, 'Move selection to'));
    [...D.doc.layers].reverse().forEach((l) => box.append(h('button', { onclick: () => { A.closePopovers(); moveSelTo(l.id); } }, l.name)));
    box.append(h('hr'), h('button', { onclick: () => { A.closePopovers(); const l = D.addLayer(); moveSelTo(l.id); } }, 'New layer'));
    A.popover(box, anchor, { side: 'down' });
  }
  function moveSelTo(layerId) {
    D.begin();
    const items = A.SEL.items().map((x) => x.it);
    D.removeIds(R.sel);
    D.layer(layerId).items = D.layer(layerId).items.concat(items);
    D.commit('layers');
    A.emit('layers');
    A.SEL.set(items.map((i) => i.id));
  }

  /* ================= commands ================= */
  const selItems = () => A.SEL.items().map((x) => x.it);
  const writeClip = (items) => {
    A.clip = { items: JSON.parse(JSON.stringify(items)) };
    try { localStorage.setItem('axiom.clip', JSON.stringify(A.clip)); } catch (e) { /* too big or blocked */ }
    renderSelMenu();
  };
  const cmds = {
    selectAll() {
      const ids = [];
      for (const l of D.doc.layers) if (l.visible && !l.locked && (!A.IN.selLayerOnly || l.id === D.doc.activeLayerId)) for (const it of l.items) if (it.t === 'i' || !B.catalog[it.b].mask) ids.push(it.id);
      A.SEL.set(ids);
    },
    copy() { if (!R.sel.size) return; writeClip(selItems()); A.toast(`Copied ${R.sel.size}`); },
    cut() { if (!R.sel.size) return; writeClip(selItems()); cmds.delete(); },
    paste(at) {
      if (!A.clip || !A.clip.items || !A.clip.items.length) return A.toast('Nothing to paste');
      const items = A.clip.items.map((it) => Object.assign({}, it, { id: A.uid() }));
      let bb = null; items.forEach((it) => (bb = G.bbUnion(bb, it.bb)));
      const [cx, cy] = R.toWorld(R.w / 2, R.h / 2);
      const vis = R.visibleBB();
      const onScreen = G.bbHit(bb, vis);
      const T = Array.isArray(at) ? M.translate(at[0] - (bb[0] + bb[2]) / 2, at[1] - (bb[1] + bb[3]) / 2)
        : onScreen ? M.translate(24 / D.doc.view.zoom, 24 / D.doc.view.zoom) : M.translate(cx - (bb[0] + bb[2]) / 2, cy - (bb[1] + bb[3]) / 2);
      const moved = items.map((it) => D.transformItem(it, T, false));
      let l = D.active();
      if (l.locked) l = D.addLayer();
      D.begin(); D.addItems(moved, l); D.commit();
      A.SEL.set(moved.map((i) => i.id));
      A.emit('layers:thumbs');
    },
    duplicate() {
      if (!R.sel.size) return;
      const z = D.doc.view.zoom, T = M.translate(20 / z, 20 / z);
      D.begin();
      const ids = [];
      for (const l of D.doc.layers) {
        const add = [];
        for (const it of l.items) if (R.sel.has(it.id)) { const n = D.transformItem(it, T, false); add.push(n); ids.push(n.id); }
        if (add.length) l.items = l.items.concat(add);
      }
      D.commit();
      A.SEL.set(ids);
    },
    delete() {
      if (!R.sel.size) return;
      D.begin(); D.removeIds(R.sel); D.commit();
      A.emit('selection:clear'); R.render(); A.emit('layers:thumbs');
    },
    flipH() { flip(-1, 1); },
    flipV() { flip(1, -1); },
    recolor() {
      if (!R.sel.size) return;
      const col = B.slot().color;
      D.begin();
      const map = new Map(), ids = [];
      for (const it of selItems()) { if (it.t !== 's') { ids.push(it.id); continue; } const n = Object.assign({}, it, { id: A.uid(), c: col }); map.set(it.id, [n]); ids.push(n.id); }
      D.replace(map); D.commit(); A.SEL.set(ids);
    },
    front() { reorder(true); },
    back() { reorder(false); },
    export() { UI.openExport(); },
    resetView() { R.zoomAt(R.w / 2, R.h / 2, 1 / D.doc.view.zoom, -D.doc.view.rot); },
    fit() { R.fitBB(D.allBB()); },
    toggleGrid() { D.doc.precision.grid = !D.doc.precision.grid; D.changed('precision'); R.render(); renderPrecision(); UI.renderLayers(); },
    saveVisual() { A.V.saveSelection(); },
    askTutor() { const a = A.AI.shotSelection(); if (a) { A.AI.attach(a); A.ST.showTutor(); } },
    toggleUI() { A.$('#canvas-view').classList.toggle('ui-hidden'); A.closePopovers(); },
    toggleLayers() { toggleLayers(); },
    togglePrecision() { togglePrecision(); },
  };
  function flip(sx, sy) {
    if (!R.sel.size || !A.SEL.box) return;
    const bb = A.SEL.box, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const T = M.about(M.scale(sx, sy), cx, cy);
    D.begin();
    const map = new Map(), ids = [];
    for (const it of selItems()) { const n = D.transformItem(it, T, false); map.set(it.id, [n]); ids.push(n.id); }
    D.replace(map); D.commit(); A.SEL.set(ids);
  }
  function reorder(toFront) {
    D.begin();
    for (const l of D.doc.layers) {
      const sel = l.items.filter((it) => R.sel.has(it.id));
      if (!sel.length) continue;
      const rest = l.items.filter((it) => !R.sel.has(it.id));
      l.items = toFront ? rest.concat(sel) : sel.concat(rest);
    }
    D.commit(); R.render();
  }
  A.on('cmd', (c) => { if (cmds[c]) cmds[c](); });

  /* long-press menu (finger held still, then lifted) */
  A.on('canvas:menu', ({ x, y }) => {
    const w = R.toWorld(x, y);
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    const hasClip = A.clip && A.clip.items && A.clip.items.length;
    const c = R.sel.size ? A.SEL.screenCorners() : null;
    if (c && G.pointInPoly(x, y, c.flat())) {
      it('copy', 'Copy', () => cmds.copy());
      it('clear', 'Cut', () => cmds.cut());
      it('duplicate', 'Duplicate', () => cmds.duplicate());
      if (hasClip) it('paste', 'Paste here', () => cmds.paste(w));
      box.append(h('hr'));
      it('trash', 'Delete', () => cmds.delete(), 'danger');
    } else {
      const hit = A.IN.pickItem(w[0], w[1], 12 / D.doc.view.zoom);
      if (hit) { A.SEL.set([hit.id]); return; }
      if (hasClip) it('paste', `Paste here (${A.clip.items.length})`, () => cmds.paste(w));
      it('selectall', 'Select all', () => cmds.selectAll());
      it('lasso', 'Select with the Pencil', () => A.emit('tool:select'));
      box.append(h('hr'));
      it('image', 'Insert image here', async () => { const f = await pickFile('image/*'); if (f) UI.importImageFile(f, w); });
      it('pdf', 'Insert PDF', async () => { const f = await pickFile('application/pdf,.pdf'); if (f) UI.importPdf(f); });
    }
    A.popover(box, { x, y }, {});
  });
  A.on('tool:select', () => {
    const i = S.slots.findIndex((s) => s.b === 'select');
    if (i >= 0) A.UI.setSlot(i);
  });

  UI.mountSelection = (menuEl, popEl) => {
    selMenu = menuEl; selPop = popEl;
    A.on('selection', () => { renderSelMenu(); requestAnimationFrame(renderSelPopup); });
    A.on('selpopup:hide', () => { selPop.hidden = true; });
    A.on('slot', renderSelMenu);
    A.on('view', () => { if (R.sel.size) renderSelPopup(); });
    renderSelMenu();
  };
  UI.mountPrecision = (el) => { precHost = el; A.on('doc:open', renderPrecision); };

  /* ================= import ================= */
  const pickFile = (accept) => new Promise((res) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { res(inp.files && inp.files[0]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
  const readAs = (file, how) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
    how === 'text' ? fr.readAsText(file) : how === 'buffer' ? fr.readAsArrayBuffer(file) : fr.readAsDataURL(file);
  });
  const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

  function importMenu(anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn) => { const b = h('button', { onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('image', 'Image or photo', async () => { const f = await pickFile('image/*'); if (f) UI.importImageFile(f); });
    it('pdf', 'PDF (problem sheet, notes)', async () => { const f = await pickFile('application/pdf,.pdf'); if (f) UI.importPdf(f); });
    it('book', 'Open in study panel (PDF or photo)', async () => { const f = await A.ST.pickFile(); if (!f) return; const m = await A.ST.importFile(f); if (m) A.ST.openDoc(m.id); });
    it('paste', 'Paste strokes', () => cmds.paste());
    A.popover(box, anchor, { side: 'down' });
  }
  UI.importImageFile = async (file, at) => {
    try {
      let src = await readAs(file, 'url');
      const im = await loadImg(src);
      let w = im.naturalWidth, hh = im.naturalHeight;
      const MAX = 2400;
      if (Math.max(w, hh) > MAX) {
        const k = MAX / Math.max(w, hh);
        const c = h('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
        w = c.width; hh = c.height;
      }
      const img = placeImage(src, w, hh);
      if (Array.isArray(at)) {
        const bb = img.bb, T = M.translate(at[0] - (bb[0] + bb[2]) / 2, at[1] - (bb[1] + bb[3]) / 2);
        D.begin(); D.replace(new Map([[img.id, [D.transformItem(img, T)]]])); D.commit(); R.render();
      }
    } catch (e) { A.toast('That image could not be read'); }
  };
  function placeImage(src, w, hh, opts = {}) {
    const z = D.doc.view.zoom;
    const target = opts.width || Math.min(w, (R.w * 0.55) / z);
    const s = target / w;
    const [cx, cy] = opts.at || R.toWorld(R.w / 2, R.h / 2);
    const m = [s, 0, 0, s, opts.at ? cx : cx - (w * s) / 2, opts.at ? cy : cy - (hh * s) / 2];
    const it = { id: A.uid(), t: 'i', src, iw: w, ih: hh, m, o: 1 };
    it.bb = B.imageBB(it);
    let l = opts.layer || D.active();
    if (l.locked) l = D.addLayer();
    D.begin(); D.addItems([it], l); D.commit();
    R.render(); A.emit('layers:thumbs');
    return it;
  }
  UI.placeImage = placeImage;

  const loadScript = (src) => new Promise((res, rej) => { const s = h('script', { src }); s.onload = res; s.onerror = rej; document.head.append(s); });
  UI.importPdf = async (file) => {
    A.toast('Opening PDF…', 2500);
    try {
      if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const buf = await readAs(file, 'buffer');
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const n = Math.min(pdf.numPages, 60);
      D.begin();
      const doc = D.doc;
      const layer = D.newLayer('PDF · ' + file.name.replace(/\.pdf$/i, '').slice(0, 28));
      const idx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
      doc.layers.splice(Math.max(0, idx), 0, layer); // below the active layer, so you can write on top
      const [x0, y0] = R.toWorld(R.w * 0.2, R.h * 0.14);
      let y = y0;
      const items = [];
      for (let p = 1; p <= n; p++) {
        const page = await pdf.getPage(p);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 2 });
        const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const src = c.toDataURL('image/jpeg', 0.86);
        const wWorld = vp1.width * (96 / 72);
        const s = wWorld / c.width;
        const it = { id: A.uid(), t: 'i', src, iw: c.width, ih: c.height, m: [s, 0, 0, s, x0, y], o: 1 };
        it.bb = B.imageBB(it);
        items.push(it);
        y += c.height * s + 40;
        if (p % 3 === 0) A.toast(`Page ${p} of ${n}`, 900);
      }
      layer.items = items;
      layer.locked = true;
      D.commit('layers');
      A.emit('layers');
      R.fitBB(items.length ? G.bbUnion(items[0].bb, items[0].bb) : null, 40);
      A.toast(`Imported ${n} page${n === 1 ? '' : 's'} on a locked layer`);
    } catch (e) {
      console.error(e);
      D.cancel();
      A.toast('The PDF could not be opened. PDF import needs an internet connection the first time.', 3500);
    }
  };

  /* ================= export ================= */
  function makePdf(jpegBytes, pw, ph, iw, ih) {
    const enc = new TextEncoder();
    const chunks = []; let len = 0; const offs = [];
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
    obj(4, () => { push(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`); push(jpegBytes); push('\nendstream'); });
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    const xref = len;
    let x = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out = new Uint8Array(len); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  function makeSvg(doc, bb, withBg, onlyIds) {
    const defs = [];
    const w = bb[2] - bb[0], hh = bb[3] - bb[1];
    let body = '';
    if (withBg) body += `<rect x="${bb[0]}" y="${bb[1]}" width="${w}" height="${hh}" fill="${doc.paper.bg}"/>`;
    doc.layers.forEach((l, li) => {
      if (!l.visible) return;
      const items = l.items.filter((it) => !onlyIds || onlyIds.has(it.id));
      if (!items.length) return;
      const masks = items.filter((it) => it.t === 's' && B.catalog[it.b].mask);
      const normal = items.filter((it) => !(it.t === 's' && B.catalog[it.b].mask));
      let attrs = l.opacity < 1 ? ` opacity="${l.opacity}"` : '';
      if (masks.length) {
        const id = 'mask' + li;
        defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${bb[0]}" y="${bb[1]}" width="${w}" height="${hh}"><rect x="${bb[0]}" y="${bb[1]}" width="${w}" height="${hh}" fill="#fff"/>${masks.map((m) => B.itemSvg(m, defs)).join('')}</mask>`);
        attrs += ` mask="url(#${id})"`;
      }
      body += `<g id="${String(l.name).replace(/[^\w-]+/g, '_')}"${attrs}>${normal.map((it) => B.itemSvg(it, defs)).join('')}</g>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(hh)}" viewBox="${bb[0]} ${bb[1]} ${w} ${hh}"><defs>${defs.join('')}</defs>${body}</svg>`;
  }
  const safeName = (n) => (n || 'drawing').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);

  UI.openExport = () => {
    const doc = D.doc;
    const st = { fmt: 'png', area: R.sel.size ? 'selection' : 'all', scale: 2, bg: true, grid: false };
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Export' });
    const close = () => back.remove();
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const row = (label, el) => body.append(h('h5', null, label), el);
      row('Format', segc([['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG'], ['pdf', 'PDF'], ['axiom', 'Project file']], st.fmt, (v) => { st.fmt = v; draw(); }));
      if (st.fmt !== 'axiom') {
        const areas = [['all', 'Whole drawing'], ['view', 'Current view']];
        if (R.sel.size) areas.push(['selection', 'Selection']);
        row('Area', segc(areas, st.area, (v) => { st.area = v; draw(); }));
      }
      if (st.fmt === 'png' || st.fmt === 'jpg' || st.fmt === 'pdf') row('Resolution', segc([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], st.scale, (v) => { st.scale = v; draw(); }));
      if (st.fmt === 'png' || st.fmt === 'svg') body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 't' }, 'Paper background'), h('div', { class: 'd' }, 'Off gives a transparent background')), toggleSw(st.bg, (v) => (st.bg = v), 'ex-bg')));
      if (st.fmt !== 'svg' && st.fmt !== 'axiom') body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 't' }, 'Include grid')), toggleSw(st.grid, (v) => (st.grid = v), 'ex-grid')));
      if (st.fmt === 'axiom') body.append(h('p', { class: 'muted' }, 'A complete, editable copy of this drawing (layers, vector strokes, images). Import it from the gallery on any device.'));
    };
    draw();
    const go = h('button', { class: 'btn primary', onclick: async () => {
      go.disabled = true;
      try { await doExport(st); close(); } catch (e) { console.error(e); A.toast('Export failed: ' + (e.message || e)); go.disabled = false; }
    } }, 'Export');
    box.append(h('h3', null, 'Export'), h('p', { class: 'muted' }, doc.name), body, h('div', { class: 'row end gap', style: { marginTop: '20px' } }, h('button', { class: 'btn', onclick: close }, 'Cancel'), go));
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  };
  async function doExport(st) {
    const doc = D.doc;
    const name = safeName(doc.name);
    if (st.fmt === 'axiom') {
      const blob = new Blob([JSON.stringify(Object.assign({ format: 'axiom', version: 1 }, doc))], { type: 'application/json' });
      return A.deliverFile(blob, name + '.axiom');
    }
    let bb, onlyIds = null;
    if (st.area === 'selection' && R.sel.size) { bb = A.SEL.box; onlyIds = new Set(R.sel); }
    else if (st.area === 'view') bb = R.visibleBB();
    else bb = D.allBB();
    if (!bb) throw new Error('the drawing is empty');
    if (st.area !== 'view') { const pad = 24; bb = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad]; }
    if (st.fmt === 'svg') {
      const svg = makeSvg(doc, bb, st.bg, onlyIds);
      return A.deliverFile(new Blob([svg], { type: 'image/svg+xml' }), name + '.svg');
    }
    const canvas = R.renderRegion(doc, bb, st.scale, { bg: st.fmt !== 'png' || st.bg, grid: st.grid, onlyIds });
    if (st.fmt === 'png') {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      return A.deliverFile(blob, name + '.png', canvas.toDataURL('image/png'));
    }
    const jpg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (st.fmt === 'jpg') return A.deliverFile(jpg, name + '.jpg', canvas.toDataURL('image/jpeg', 0.92));
    const bytes = new Uint8Array(await jpg.arrayBuffer());
    const pw = Math.round((bb[2] - bb[0]) * 0.75), ph = Math.round((bb[3] - bb[1]) * 0.75);
    const pdf = makePdf(bytes, pw, ph, canvas.width, canvas.height);
    return A.deliverFile(new Blob([pdf], { type: 'application/pdf' }), name + '.pdf');
  }

  /* ================= settings ================= */
  UI.applyTheme = () => {
    const t = S.theme;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    if (A.R && A.R.themeChanged) A.R.themeChanged();
    A.emit('theme');
  };
  UI.openSettings = () => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Settings' });
    const close = () => back.remove();
    const set = (k, v) => { S[k] = v; A.saveSettings(); };
    const row = (t, d, ctl) => h('div', { class: 'set-row' }, h('div', null, h('div', { class: 't' }, t), d ? h('div', { class: 'd' }, d) : null), ctl);
    const sel = (k, opts, after) => segc(opts, S[k], (v) => { set(k, v); after && after(); rebuild(); });
    const content = h('div');
    const rebuild = () => {
      content.innerHTML = '';
      content.append(
        h('h5', null, 'Workspace'),
        row('Appearance', null, sel('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], UI.applyTheme)),
        row('Tool setup', 'Double-tap the toolbar grip to switch', sel('toolSetup', [['bar', 'Tool Bar'], ['wheel', 'Tool Wheel']], () => { S.toolPos = null; UI.renderTools(); })),
        row('Toolbar side', null, sel('toolSide', [['left', 'Left'], ['right', 'Right']], () => { S.toolPos = null; UI.renderTools(); })),
        row('Dark canvas in dark mode', 'Paper turns dark and ink adapts. Exports keep your real colors.', toggleSw(S.darkCanvas !== false, (v) => { set('darkCanvas', v); R.themeChanged(); }, 's-darkcanvas')),
        row('Palette on toolbar', 'Quick colors under the color button', toggleSw(S.showPalette, (v) => { set('showPalette', v); UI.renderTools(); }, 's-pal')),
        h('h5', null, 'Apple Pencil and touch'),
        row('Finger action', 'Pan: drag to move. Hold still, then move to lasso, or lift for a menu. Auto pans once a Pencil has been used.', sel('fingerAction', [['auto', 'Auto'], ['pan', 'Pan'], ['draw', 'Draw'], ['select', 'Select']])),
        row('Pressure response', 'Softer makes light strokes thicker', (() => {
          const r = h('input', { type: 'range', min: 40, max: 200, value: Math.round(S.pressure * 100), id: 's-pressure', style: { width: '160px' } });
          r.addEventListener('change', () => set('pressure', +r.value / 100));
          return h('div', { class: 'row gap small muted' }, 'Softer', r, 'Firmer');
        })()),
        row('Hover cursor', 'Shows the brush size while the Pencil hovers', toggleSw(S.hoverCursor, (v) => set('hoverCursor', v), 's-hover')),
        h('h5', null, 'Gestures'),
        row('Two-finger tap to undo', null, toggleSw(S.twoFingerUndo, (v) => set('twoFingerUndo', v), 's-2f')),
        row('Three-finger tap to redo', null, toggleSw(S.threeFingerRedo, (v) => set('threeFingerRedo', v), 's-3f')),
        row('Tap and hold to select', 'Hold the Pencil still to start a lasso', toggleSw(S.tapHoldSelect, (v) => set('tapHoldSelect', v), 's-th')),
        row('Hold time', 'For tap+hold and draw & hold', (() => {
          const r = h('input', { type: 'range', min: 250, max: 1200, step: 50, value: S.holdTime, id: 's-hold', style: { width: '160px' } });
          const v = h('span', { class: 'num small' }, (S.holdTime / 1000).toFixed(2) + ' s');
          r.addEventListener('input', () => { v.textContent = (+r.value / 1000).toFixed(2) + ' s'; });
          r.addEventListener('change', () => set('holdTime', +r.value));
          return h('div', { class: 'row gap' }, r, v);
        })()),
        row('Canvas rotation', 'Twist with two fingers to rotate', toggleSw(S.allowRotate, (v) => set('allowRotate', v), 's-rot')),
        row('Highlight selection', 'Fade everything that is not selected', toggleSw(S.highlightSelection, (v) => { set('highlightSelection', v); R.render(); }, 's-hl')),
        h('h5', null, 'Studies'),
        row('Majors and courses', A.SU.majorNames().join(', ') || 'Not set', h('button', { class: 'btn', onclick: async () => { close(); await A.SU.openSetup(); } }, 'Edit')),
        h('h5', null, 'Tutor'),
        row('Anthropic API key', S.aiKey ? 'Connected (stored only on this device)' : 'Not connected. Open the study panel to connect.', S.aiKey ? h('button', { class: 'btn', onclick: () => { S.aiKey = ''; A.saveSettings(); rebuild(); A.toast('API key removed'); } }, 'Remove key') : h('span')),
        row('Default model', null, sel('aiModel', A.AI.models.map((m) => [m.id, m.name]))),
        ...(D.doc ? [h('h5', null, 'This drawing'),
        row('Course', null, (() => { const b = h('button', { class: 'btn' }, A.SU.name(D.doc.subject) || 'None'); b.addEventListener('click', () => A.SU.pickMenu(b, D.doc.subject, (sid) => { D.doc.subject = sid; D.changed('meta'); rebuild(); })); return b; })()),
        row('Paper', null, (() => {
          const r = h('div', { class: 'bg-row' });
          Object.entries(D.papers).forEach(([k, c]) => r.append(h('button', { class: D.doc.paper.bg === c ? 'on' : '', style: { background: c }, 'aria-label': k, onclick: () => { D.doc.paper.bg = c; D.changed('paper'); R.render(); rebuild(); } })));
          return r;
        })())] : []),
        h('p', { class: 'small muted', style: { marginTop: '16px' } }, `Axiom ${A.VERSION}${A.store.usingMemory ? ' · storage unavailable, drawings last until you close the app' : ' · saved on this device'}`));
    };
    rebuild();
    box.append(h('div', { class: 'row between' }, h('h3', null, 'Settings'), h('button', { class: 'ibtn', 'aria-label': 'Close', html: A.icon('close'), onclick: close })), content);
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  };

  UI.openHelp = () => {
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    const k = (t) => h('span', { class: 'kbd' }, t);
    const g = (a, b) => [h('div', { class: 'kbd' }, a), h('div', null, b)];
    back.append(h('div', { class: 'modal wide', role: 'dialog', 'aria-label': 'Help' },
      h('div', { class: 'row between' }, h('h3', null, 'Gestures and shortcuts'), h('button', { class: 'ibtn', 'aria-label': 'Close', html: A.icon('close'), onclick: close })),
      h('h5', null, 'Touch'),
      h('div', { class: 'help-grid' },
        ...g('Pencil', 'Draws with the active tool. Pressure changes width, and tilting the Pencil shades with the Pencil brush.'),
        ...g('1 finger', 'Drag to pan. Hold still, then move to lasso-select, or lift for a menu (paste here, select all, insert).'),
        ...g('2 fingers', 'Pinch to zoom, drag to pan, twist to rotate (snaps to 0°, 90°…).'),
        ...g('2-finger tap', 'Undo'), ...g('3-finger tap', 'Redo'),
        ...g('Draw & hold', 'Turns your stroke into a clean line, arc, circle, ellipse, triangle, rectangle or polygon. Keep holding and move to adjust.'),
        ...g('Tap & hold', 'Hold the Pencil still to start a lasso selection.'),
        ...g('2 fingers on a selection', 'Move, scale and rotate the selection.'),
        ...g('Tool slot', 'Tap to choose. Tap the active slot or long-press for the brush menu.'),
        ...g('Size / Opac / Smth', 'Tap for a slider and presets, or drag up and down to adjust directly.'),
        ...g('Layer', 'Tap the active layer for options. Double-tap a layer to focus it. Long-press and drag to reorder.')),
      h('h5', null, 'Keyboard'),
      h('div', { class: 'help-grid' },
        ...g('⌘Z / ⇧⌘Z', 'Undo / redo'), ...g('1 – 8', 'Choose a tool slot'), ...g('[ and ]', 'Brush size'),
        ...g('⌘A ⌘C ⌘V ⌘D', 'Select all, copy, paste, duplicate'), ...g('Delete', 'Delete selection'),
        ...g('Space + drag', 'Pan (mouse)'), ...g('0 / F', 'Reset view / fit drawing'), ...g('G  P  L  H', 'Grid, precision, layers, hide interface')),
      h('p', { class: 'small muted num', style: { marginTop: '18px' } }, A.IN.inputStats ? `Pencil input on this device: ${A.IN.inputStats.rate} samples per second · high-frequency samples ${A.IN.inputStats.coalesced ? 'available' : 'not available'}` : 'Draw a stroke with the Pencil, then reopen Help to see your input rate.'),
      h('p', { class: 'small muted num', style: { marginTop: '6px' } }, `Version ${A.VERSION} · build ${window.AXIOM_BUILD || 'dev'} · screen ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight} · app ${Math.round(A.$('#app').getBoundingClientRect().height)}`),
      h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Axiom is in Stage 1: the infinite-canvas foundation. Next come PDF study sets, LaTeX, plots and an AI tutor that can read your work.')));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  };
})();
