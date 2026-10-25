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
      (() => { const b = btn('chev', 'Back to library', () => A.emit('go:gallery')); b.classList.add('flip'); return b; })(), name, h('div', { class: 'sb-sep' }), precBtn, layBtn, visBtn);
    const readout = h('button', { id: 'readout', class: 'panel', title: 'View options' });
    readout.addEventListener('click', () => viewMenu(readout));
    const right = h('div', { class: 'sb-group panel' },
      btn('book', 'Study panel: documents and tutor', () => A.ST.toggle(), 'btn-study'),
      btn('export', 'Export', () => UI.openExport()),
      (() => { const b = btn('more', 'More', () => {
        const box = h('div', { class: 'menu' });
        const it = (icon, label, fn) => { const x = h('button', { onclick: () => { A.closePopovers(); fn(); } }); x.innerHTML = A.icon(icon); x.append(label); box.append(x); };
        it('import', 'Import', () => importMenu(b));
        it('graph', 'Desmos calculator', () => A.ST.openGraph());
        it('artboard', 'Add artboard', () => UI.artboardMenu(b));
        it('hide', 'Hide interface', () => A.emit('cmd', 'toggleUI'));
        box.append(h('hr'));
        it('settings', 'Settings', () => UI.openSettings());
        it('help', 'Help and gestures', () => UI.openHelp());
        A.popover(box, b, { side: 'down' });
      }); return b; })());
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
    const lk = (on) => (on ? `<span class="ro-lock">${A.icon('lock')}</span>` : '');
    const parts = [`${lk(S.zoomLock)}<b>${v.zoom >= 1 ? Math.round(v.zoom * 100) : (v.zoom * 100).toFixed(v.zoom < 0.1 ? 1 : 0)}%</b>`];
    if (Math.round(rot) !== 0 || S.rotLock) parts.push(`<span class="hide-sm">${lk(S.rotLock)}${rot.toFixed(0)}°</span>`);
    el.innerHTML = parts.join('<span class="dot"></span>');
  }
  /* Measurement popover (as in Concepts): zoom and rotation with lock padlocks and presets, plus artboards */
  function viewMenu(anchor) {
    const box = h('div', { class: 'menu measure-pop' });
    const v = D.doc.view;
    const zoomTo = (z) => R.zoomAt(R.w / 2, R.h / 2, z / D.doc.view.zoom);
    const rotTo = (deg) => R.zoomAt(R.w / 2, R.h / 2, 1, A.rad(deg) - D.doc.view.rot);
    const draw = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'sub' }, 'Measurement'));
      const field = (icon, label, value, onSet, lockKey) => {
        const inp = h('input', { class: 'field mini num', value, inputmode: 'decimal', 'aria-label': label });
        inp.addEventListener('change', () => { const n = parseFloat(inp.value.replace(',', '.')); if (isFinite(n)) onSet(n); draw(); });
        const lock = h('button', { class: 'ibtn lockbtn' + (S[lockKey] ? ' on' : ''), title: (S[lockKey] ? 'Unlock ' : 'Lock ') + label.toLowerCase(), 'aria-pressed': String(!!S[lockKey]), html: A.icon(S[lockKey] ? 'lock' : 'unlock'), onclick: () => { S[lockKey] = !S[lockKey]; A.saveSettings(); A.emit('view'); draw(); } });
        return h('div', { class: 'mp-row' }, h('span', { class: 'mp-ic', html: A.icon(icon) }), h('span', { class: 'mp-l' }, label), inp, lock);
      };
      const chips = (list, cur, fn) => { const c = h('div', { class: 'mp-chips' }); list.forEach(([val, l]) => c.append(h('button', { class: 'chip' + (Math.abs(cur - val) < 1e-3 ? ' on' : ''), onclick: () => { fn(val); draw(); } }, l))); return c; };
      const z = Math.round(D.doc.view.zoom * 1000) / 10;
      box.append(field('zoom', 'Zoom', z + '%', (n) => zoomTo(n / 100), 'zoomLock'));
      box.append(chips([[0.1, '10%'], [1, '100%'], [3.5, '350%'], [16, '1600%']], D.doc.view.zoom, zoomTo));
      if (!D.isNotebook()) {
        let rot = ((A.deg(D.doc.view.rot) % 360) + 360) % 360;
        box.append(field('rotate', 'Rotation', Math.round(rot) + '°', (n) => rotTo(n), 'rotLock'));
        box.append(chips([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], Math.round(rot), rotTo));
      }
      box.append(h('hr'));
      const it = (icon, label, fn) => { const b = h('button', { onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
      if (D.isNotebook()) it('template', 'Fit page width', () => R.fitBB(null));
      else {
        it('canvas', 'Fit drawing to screen', () => R.fitBB(D.allBB()));
        if (R.sel.size && A.SEL.box) it('lasso', 'Zoom to selection', () => R.fitBB(A.SEL.box, 100));
        (D.doc.artboards || []).forEach((a) => it('artboard', 'Show ' + a.name, () => R.fitBB([a.x, a.y, a.x + a.w, a.y + a.h], 40)));
        it('plus', 'Add artboard…', () => UI.artboardMenu(anchor));
      }
    };
    draw();
    A.popover(box, anchor, { side: 'down' });
  }
  UI.artboardOptions = (a, at) => {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls = '') => { const b = h('button', { class: cls, onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    box.append(h('div', { class: 'sub' }, `${a.name} · ${(a.w / D.MM / 10).toFixed(1)} × ${(a.h / D.MM / 10).toFixed(1)} cm`));
    it('rename', 'Rename', async () => { const n = await A.dialog({ title: 'Rename artboard', input: a.name, okText: 'Rename' }); if (n) D.updateArtboard(a.id, { name: n.slice(0, 40) }); R.render(); });
    it('rotate', 'Swap orientation', () => { const cx = a.x + a.w / 2, cy = a.y + a.h / 2; D.updateArtboard(a.id, { w: a.h, h: a.w, x: cx - a.h / 2, y: cy - a.w / 2, orient: a.orient === 'landscape' ? 'portrait' : 'landscape' }); R.render(); });
    const sizes = h('div', { class: 'mp-chips', style: { paddingLeft: '12px' } });
    [['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3'], ['a5', 'A5'], ['square', 'Square'], ['wide', '16:9']].forEach(([f, l]) => sizes.append(h('button', { class: 'chip' + (a.fmt === f ? ' on' : ''), onclick: () => { A.closePopovers(); const [w, hh] = D.formatSize(f, a.orient || 'portrait'); D.updateArtboard(a.id, { fmt: f, w, h: hh }); R.render(); } }, l)));
    box.append(sizes);
    it('zoom', 'Zoom to artboard', () => R.fitBB([a.x, a.y, a.x + a.w, a.y + a.h], 40));
    it('export', 'Export this artboard', () => UI.openExport({ region: 'ab:' + a.id }));
    box.append(h('hr'));
    it('trash', 'Delete artboard', () => { D.deleteArtboard(a.id); R.render(); }, 'danger');
    A.popover(box, at, { side: 'down' });
  };
  UI.artboardMenu = (anchor) => {
    const box = h('div', { class: 'menu' });
    box.append(h('div', { class: 'sub' }, 'Add an artboard at the centre of the screen'));
    const at = R.toWorld(R.w / 2, R.h / 2);
    const add = (fmt, orient) => { A.closePopovers(); const ab = D.addArtboard(fmt, orient, at); R.render(); A.toast(ab.name + ' added. Long-press its label to rename, resize or delete it.', 2600); };
    [['a4', 'A4'], ['letter', 'US Letter'], ['a3', 'A3'], ['a5', 'A5'], ['square', 'Square'], ['wide', '16:9 slide']].forEach(([f, l]) => {
      box.append(h('div', { class: 'ab-row' }, h('span', { class: 'grow' }, l), h('button', { class: 'chip', onclick: () => add(f, 'portrait') }, 'Portrait'), h('button', { class: 'chip', onclick: () => add(f, 'landscape') }, 'Landscape')));
    });
    box.append(h('button', { onclick: () => { A.closePopovers(); const w = R.w / D.doc.view.zoom, hh = R.h / D.doc.view.zoom; D.begin(); const ab = { id: A.uid(), name: 'Screen ' + ((D.doc.artboards || []).length + 1), fmt: 'screen', x: at[0] - w / 2, y: at[1] - hh / 2, w, h: hh }; D.doc.artboards = (D.doc.artboards || []).concat([ab]); D.commit('all'); R.render(); } }, A.iconEl('image'), 'Screen size'));
    A.popover(box, anchor, { side: 'down' });
  };

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
  /* Selection: one compact bar next to the selection (primary actions + "…"); the bottom bar only shows
     lasso options while the selection tool is active and nothing is selected yet. */
  function renderSelMenu() {
    if (!selMenu) return;
    const has = R.sel.size > 0;
    const show = selectTool() && !has;
    selMenu.hidden = !show;
    if (!show) return;
    selMenu.innerHTML = '';
    selMenu.append(
      segc([['lasso', 'Lasso'], ['picker', 'Tap items']], A.IN.selMode, (v) => { A.IN.selMode = v; renderSelMenu(); }),
      h('div', { class: 'sb-sep' }),
      (() => { const b = h('button', { class: 'ibtn', title: 'Selection options', 'aria-label': 'Selection options', html: A.icon('more') }); b.addEventListener('click', () => selOptions(b)); return b; })());
  }
  function selOptions(anchor) {
    const box = h('div', { class: 'menu' });
    const tog = (label, on, fn) => box.append(h('button', { class: on ? 'on' : '', onclick: () => { fn(); A.closePopovers(); renderSelMenu(); R.renderOverlay(); } }, A.iconEl(on ? 'check' : 'minus'), label));
    tog('Select strokes the lasso only touches', A.IN.selPartial, () => { A.IN.selPartial = !A.IN.selPartial; });
    tog('Active layer only', A.IN.selLayerOnly, () => { A.IN.selLayerOnly = !A.IN.selLayerOnly; });
    box.append(h('hr'), h('button', { onclick: () => { A.closePopovers(); A.emit('cmd', 'selectAll'); } }, A.iconEl('selectall'), 'Select all'));
    if (A.clip && A.clip.items && A.clip.items.length) box.append(h('button', { onclick: () => { A.closePopovers(); A.emit('cmd', 'paste'); } }, A.iconEl('paste'), 'Paste'));
    A.popover(box, anchor, { side: 'up' });
  }
  function selMore(anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn) => box.append(h('button', { onclick: () => { A.closePopovers(); fn(); } }, A.iconEl(icon), label));
    const cmd = (c) => () => A.emit('cmd', c);
    it('fliph', 'Flip horizontally', cmd('flipH'));
    it('flipv', 'Flip vertically', cmd('flipV'));
    it('recolor', 'Apply current colour', cmd('recolor'));
    it('front', 'Bring to front', cmd('front'));
    it('back', 'Send to back', cmd('back'));
    if (!D.isNotebook()) it('moveto', 'Move to layer…', () => moveToMenu(anchor));
    box.append(h('hr'));
    const modes = { scale: 'Scale with strokes', stretch: 'Stretch, keep stroke width', off: 'Scaling locked' };
    it(A.IN.scaleMode === 'off' ? 'lock' : 'scale', 'Resize: ' + modes[A.IN.scaleMode].toLowerCase(), () => { A.IN.scaleMode = { scale: 'stretch', stretch: 'off', off: 'scale' }[A.IN.scaleMode]; A.toast(modes[A.IN.scaleMode], 1200); R.renderOverlay(); });
    it('rotate', A.IN.allowSelRotate ? 'Rotation handle: on' : 'Rotation handle: off', () => { A.IN.allowSelRotate = !A.IN.allowSelRotate; R.renderOverlay(); });
    box.append(h('hr'));
    it('bookmark', 'Save as a visual', cmd('saveVisual'));
    it('selectall', 'Select all', cmd('selectAll'));
    A.popover(box, anchor, { side: 'down' });
  }
  function renderSelPopup() {
    if (!selPop) return;
    const c = R.sel.size && !R.selPreview ? A.SEL.screenCorners() : null;
    if (!c) { selPop.hidden = true; return; }
    selPop.hidden = false;
    if (!selPop.childElementCount) {
      const ib = (icon, title, fn) => { const b = h('button', { class: 'ibtn', title, 'aria-label': title, html: A.icon(icon) }); b.addEventListener('click', (e) => fn(e.currentTarget)); return b; };
      selPop.append(
        ib('duplicate', 'Duplicate', () => A.emit('cmd', 'duplicate')),
        ib('copy', 'Copy', () => A.emit('cmd', 'copy')),
        ib('trash', 'Delete', () => A.emit('cmd', 'delete')),
        ib('spark', 'Ask the tutor about this', () => A.emit('cmd', 'askTutor')),
        h('div', { class: 'sb-sep' }),
        ib('more', 'More', (b) => selMore(b)));
    }
    const ys = c.map((p) => p[1]), xs = c.map((p) => p[0]);
    const r = selPop.getBoundingClientRect();
    const stage = A.$('#stage').getBoundingClientRect();
    // prefer above the selection (clear of the rotation handle), else below, never over the bottom bars
    let y = Math.min(...ys) - r.height - 48;
    if (y < stage.top + 66) y = Math.max(...ys) + 18;
    y = A.clamp(y, stage.top + 66, stage.bottom - r.height - 84);
    const x = A.clamp((Math.min(...xs) + Math.max(...xs)) / 2 - r.width / 2, stage.left + 76, stage.right - r.width - 76);
    selPop.style.left = x + 'px';
    selPop.style.top = y + 'px';
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
    undo() { D.undo(); },
    redo() { D.redo(); },
    selectAll() {
      const ids = [];
      for (const l of D.doc.layers) if (l.visible && !l.locked && (!A.IN.selLayerOnly || l.id === D.doc.activeLayerId)) for (const it of l.items) if (B.isBox(it) || !B.catalog[it.b].mask) ids.push(it.id);
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
      const lib = await A.ST.pdfLib();
      const buf = await readAs(file, 'buffer');
      const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      const doc = D.doc;
      const nb = D.isNotebook(doc);
      const n = Math.min(pdf.numPages, nb ? 400 : 60);
      const render = async (p) => {
        const page = await pdf.getPage(p);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2, 2400 / vp1.width) });
        const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        return { c, w1: vp1.width * (96 / 72), src: c.toDataURL('image/jpeg', 0.86) };
      };
      D.begin();
      let layer = doc.layers.find((l) => l.pdfLayer);
      if (!layer) {
        layer = D.newLayer(nb ? 'Imported pages' : 'PDF · ' + file.name.replace(/\.pdf$/i, '').slice(0, 28));
        layer.pdfLayer = true;
        const idx = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
        doc.layers.splice(Math.max(0, idx), 0, layer); // below the active layer, so you can write on top
        if (doc.activeLayerId === layer.id) doc.activeLayerId = doc.layers[doc.layers.length - 1].id;
      }
      const items = [];
      if (nb) {
        // each PDF page becomes a notebook page (inserted after the current page, blank template)
        let at = R.currentPage();
        const curEmpty = !doc.layers.some((l) => l.items.some((it) => D.pageAt(doc, (it.bb[0] + it.bb[2]) / 2, (it.bb[1] + it.bb[3]) / 2) === at));
        if (!curEmpty) at += 1;
        const [pw, ph] = D.pageSize(doc);
        D.commit('all');
        for (let p = 1; p <= n; p++) {
          const r = await render(p);
          if (!(p === 1 && curEmpty)) D.insertPage(at + p - 1, { template: 'blank' }); else D.setPage(at, { template: 'blank' });
          const rc = D.pageRect(doc, at + p - 1);
          const s = Math.min(pw / r.c.width, ph / r.c.height);
          const x = rc[0] + (pw - r.c.width * s) / 2, y = rc[1] + (ph - r.c.height * s) / 2;
          const it = { id: A.uid(), t: 'i', src: r.src, iw: r.c.width, ih: r.c.height, m: [s, 0, 0, s, x, y], o: 1, pdfPage: p };
          it.bb = B.imageBB(it);
          D.begin(); layer.items = layer.items.concat([it]); D.commit('all');
          if (p % 3 === 0) A.toast(`Page ${p} of ${n}`, 900);
        }
        layer.locked = true;
        A.emit('layers'); A.emit('pages');
        R.showPage(at, true);
        A.toast(`Added ${n} page${n === 1 ? '' : 's'}. Write on them with any pen.`);
        return;
      }
      const [x0, y0] = R.toWorld(R.w * 0.2, R.h * 0.14);
      let y = y0;
      for (let p = 1; p <= n; p++) {
        const r = await render(p);
        const s = r.w1 / r.c.width;
        const it = { id: A.uid(), t: 'i', src: r.src, iw: r.c.width, ih: r.c.height, m: [s, 0, 0, s, x0, y], o: 1 };
        it.bb = B.imageBB(it);
        items.push(it);
        y += r.c.height * s + 40;
        if (p % 3 === 0) A.toast(`Page ${p} of ${n}`, 900);
      }
      layer.items = layer.items.concat(items);
      layer.locked = true;
      D.commit('layers');
      A.emit('layers');
      R.fitBB(items.length ? items[0].bb : null, 40);
      A.toast(`Imported ${n} page${n === 1 ? '' : 's'} on a locked layer`);
    } catch (e) {
      console.error(e);
      D.cancel();
      A.toast('The PDF could not be opened.', 3500);
    }
  };

  /* ================= export ================= */
  /* pages: [{bytes (JPEG), pw, ph (points), iw, ih (pixels)}] */
  function makePdf(pages) {
    const enc = new TextEncoder();
    const chunks = []; let len = 0; const offs = [];
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const N = pages.length;
    const pageObj = (i) => 3 + i * 3;
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => pageObj(i) + ' 0 R').join(' ')}] /Count ${N} >>`));
    pages.forEach((pg, i) => {
      const po = pageObj(i);
      obj(po, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.pw} ${pg.ph}] /Resources << /XObject << /Im0 ${po + 1} 0 R >> >> /Contents ${po + 2} 0 R >>`));
      obj(po + 1, () => { push(`<< /Type /XObject /Subtype /Image /Width ${pg.iw} /Height ${pg.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`); push(pg.bytes); push('\nendstream'); });
      const content = `q ${pg.pw} 0 0 ${pg.ph} 0 0 cm /Im0 Do Q`;
      obj(po + 2, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    });
    const total = 3 + N * 3;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
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

  /* Export (Concepts-style): format, region, background / grid, pixels per inch with the resulting size */
  UI.openExport = (preset = {}) => {
    const doc = D.doc;
    const nb = D.isNotebook(doc);
    const regions = () => {
      const r = [];
      if (nb) { r.push(['pages', 'All pages', 'pages'], ['page', 'This page', 'template']); }
      r.push(['view', 'Screenshot', 'image']);
      if (!nb) r.push(['all', 'Entire drawing', 'canvas']);
      if (!nb) (doc.artboards || []).forEach((a) => r.push(['ab:' + a.id, a.name, 'artboard']));
      if (R.sel.size) r.push(['selection', 'Selection', 'lasso']);
      return r;
    };
    const st = Object.assign({ fmt: nb ? 'pdf' : 'png', region: nb ? 'pages' : R.sel.size ? 'selection' : (doc.artboards || []).length ? 'ab:' + doc.artboards[0].id : 'all', ppi: 300, bg: true, grid: !nb && doc.precision.grid }, preset);
    if (!regions().some((r) => r[0] === st.region)) st.region = regions()[0][0];
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Export' });
    const close = () => back.remove();
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const row = (label, el) => body.append(h('h5', null, label), el);
      row('Format', segc([['jpg', 'JPG'], ['png', 'PNG'], ['svg', 'Vector (SVG)'], ['pdf', 'PDF'], ['axiom', 'Project']], st.fmt, (v) => { st.fmt = v; draw(); }));
      if (st.fmt !== 'axiom') {
        const rg = h('div', { class: 'region-row' });
        regions().forEach(([v, l, icon]) => rg.append(h('button', { class: 'region' + (st.region === v ? ' on' : ''), onclick: () => { st.region = v; draw(); } }, h('span', { class: 'region-ic', html: A.icon(icon) }), h('span', null, l))));
        row('Region', rg);
        body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 't' }, 'Include background'), h('div', { class: 'd' }, st.fmt === 'png' || st.fmt === 'svg' ? 'Off gives a transparent background' : 'Paper colour and page templates')), toggleSw(st.bg, (v) => { st.bg = v; }, 'ex-bg')));
        if (!nb && st.fmt !== 'svg') body.append(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 't' }, 'Include grid')), toggleSw(st.grid, (v) => { st.grid = v; }, 'ex-grid')));
      }
      if (st.fmt === 'png' || st.fmt === 'jpg' || st.fmt === 'pdf') {
        row('Pixels per inch', segc([[72, '72'], [150, '150'], [300, '300'], [600, '600']], st.ppi, (v) => { st.ppi = v; draw(); }));
        const bb = regionBB(st);
        if (bb) {
          const s = st.ppi / 96;
          body.append(h('p', { class: 'muted small num', style: { marginTop: '8px' } }, `Image size: ${Math.round((bb[2] - bb[0]) * s)} × ${Math.round((bb[3] - bb[1]) * s)} px (@${st.ppi} ppi) · ${A.fmtLen ? '' : ''}${((bb[2] - bb[0]) / D.MM / 10).toFixed(1)} × ${((bb[3] - bb[1]) / D.MM / 10).toFixed(1)} cm`));
        }
      }
      if (st.fmt === 'axiom') body.append(h('p', { class: 'muted' }, 'A complete, editable copy (layers, vector strokes, images, pages). Import it from the library on any device.'));
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
  function regionBB(st) {
    const doc = D.doc;
    if (st.region === 'selection' && R.sel.size) return A.SEL.box;
    if (st.region === 'view') return R.visibleBB();
    if (st.region === 'page') return D.pageRect(doc, R.currentPage());
    if (st.region === 'pages') return D.pageRect(doc, 0);
    if (st.region.startsWith('ab:')) { const a = (doc.artboards || []).find((x) => 'ab:' + x.id === st.region); if (a) return [a.x, a.y, a.x + a.w, a.y + a.h]; }
    const bb = D.allBB();
    return bb ? [bb[0] - 24, bb[1] - 24, bb[2] + 24, bb[3] + 24] : null;
  }
  UI.quickExportPdf = () => doExport({ fmt: 'pdf', region: 'pages', ppi: 200, bg: true, grid: false });
  async function doExport(st) {
    const doc = D.doc;
    const name = safeName(doc.name);
    if (st.fmt === 'axiom') {
      const blob = new Blob([JSON.stringify(Object.assign({ format: 'axiom', version: 1 }, doc))], { type: 'application/json' });
      return A.deliverFile(blob, name + '.axiom');
    }
    const onlyIds = st.region === 'selection' && R.sel.size ? new Set(R.sel) : null;
    const scale = (st.ppi || 192) / 96;
    // a list of world rectangles: several for "All pages"
    const rects = st.region === 'pages' ? (D.isNotebook(doc) ? D.pageRects(doc).filter((rc, i) => i < doc.pages.length - 1 || doc.layers.some((l) => l.items.some((it) => G.bbHit(it.bb, rc)))) : []) : [regionBB(st)];
    if (!rects.length || !rects[0]) throw new Error('the drawing is empty');
    if (st.fmt === 'svg') {
      const svg = makeSvg(doc, rects[0], st.bg, onlyIds);
      return A.deliverFile(new Blob([svg], { type: 'image/svg+xml' }), name + '.svg');
    }
    const renderOne = (bb) => R.renderRegion(doc, bb, scale, { bg: st.fmt !== 'png' || st.bg, grid: st.grid, onlyIds, maxPx: 12000 });
    if (st.fmt === 'png' || st.fmt === 'jpg') {
      const canvas = renderOne(rects[0]);
      const type = st.fmt === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
      return A.deliverFile(blob, name + '.' + st.fmt, canvas.toDataURL(type, 0.92));
    }
    const pages = [];
    for (let i = 0; i < rects.length; i++) {
      const bb = rects[i];
      const canvas = renderOne(bb);
      const jpg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      pages.push({ bytes: new Uint8Array(await jpg.arrayBuffer()), pw: Math.round((bb[2] - bb[0]) * 0.75), ph: Math.round((bb[3] - bb[1]) * 0.75), iw: canvas.width, ih: canvas.height });
      if (rects.length > 4 && i % 4 === 3) A.toast(`Page ${i + 1} of ${rects.length}`, 700);
    }
    return A.deliverFile(new Blob([makePdf(pages)], { type: 'application/pdf' }), name + '.pdf');
  }

  /* ================= settings ================= */
  UI.applyTheme = () => {
    const t = S.theme;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    if (A.R && A.R.themeChanged) A.R.themeChanged();
    A.emit('theme');
  };
  UI.openSettings = (tab) => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal settings-modal', role: 'dialog', 'aria-label': 'Settings' });
    const close = () => back.remove();
    const set = (k, v) => { S[k] = v; A.saveSettings(); };
    const row = (t, d, ctl) => h('div', { class: 'set-row' }, h('div', null, h('div', { class: 't' }, t), d ? h('div', { class: 'd' }, d) : null), ctl);
    /* up to 3 options: segmented control; more: a menu picker showing the current value */
    const pickBtn = (opts, cur, onPick) => {
      const label = (opts.find(([v]) => v === cur) || opts[0])[1];
      const b = h('button', { class: 'pick-btn' }, h('span', null, label), A.iconEl('chevdown'));
      b.addEventListener('click', () => {
        const box = h('div', { class: 'menu' });
        opts.forEach(([v, l]) => box.append(h('button', { class: v === cur ? 'on' : '', onclick: () => { A.closePopovers(); onPick(v); } }, A.iconEl(v === cur ? 'check' : 'minus'), l)));
        A.popover(box, b, { side: 'down' });
      });
      return b;
    };
    const sel = (k, opts, after) => (opts.length > 3 ? pickBtn(opts, S[k], (v) => { set(k, v); after && after(); rebuild(); }) : segc(opts, S[k], (v) => { set(k, v); after && after(); rebuild(); }));
    const slider = (k, min, max, step, fmt, onSet) => {
      const r = h('input', { type: 'range', min, max, step, value: S[k], style: { width: '150px' } });
      const v = h('span', { class: 'num small' }, fmt(S[k]));
      r.addEventListener('input', () => { v.textContent = fmt(+r.value); });
      r.addEventListener('change', () => { set(k, +r.value); onSet && onSet(); });
      return h('div', { class: 'row gap' }, r, v);
    };
    const NATIVE = !!(window.AXIOM_NATIVE && A.native);
    const tabs = [['workspace', 'Workspace', 'canvas'], ['interaction', 'Interaction', 'hand'], ['notebooks', 'Notebooks', 'notebook'], ['tutor', 'Tutor', 'spark'], ['studies', 'Studies', 'book'], ['deleted', 'Recently Deleted', 'trash']];
    let cur = tab || (D.doc && D.isNotebook() ? 'notebooks' : 'workspace');
    const nav = h('nav', { class: 'set-nav' });
    const content = h('div', { class: 'set-body' });
    const rebuild = () => {
      nav.innerHTML = '';
      tabs.forEach(([id, l, icon]) => nav.append(h('button', { class: id === cur ? 'on' : '', onclick: () => { cur = id; rebuild(); } }, A.iconEl(icon), l)));
      nav.append(h('div', { class: 'grow' }), h('div', { class: 'small muted set-ver num' }, `Axiom ${A.VERSION} · ${window.AXIOM_BUILD || 'dev'}`));
      content.innerHTML = '';
      const add = (...x) => content.append(...x.filter(Boolean));
      if (cur === 'workspace') {
        add(h('h5', null, 'Appearance'),
          row('Theme', null, sel('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], UI.applyTheme)),
          row('Dark paper in dark mode', 'Paper turns dark and ink adapts. Exports keep your real colours.', toggleSw(S.darkCanvas !== false, (v) => { set('darkCanvas', v); R.themeChanged(); }, 's-darkcanvas')),
          h('h5', null, 'Tool setup (canvases)'),
          row('Interface', 'Choose your tool palette', sel('toolSetup', [['wheel', 'Tool Wheel'], ['bar', 'Tool Bar']], () => { S.toolPos = null; UI.renderTools(); })),
          row('Handedness', 'Puts the tools on the side that suits your hand', sel('toolSide', [['left', 'Left'], ['right', 'Right']], () => { S.toolPos = null; UI.renderTools(); })),
          row('Palette under the tools', 'Quick colours under the colour button', toggleSw(S.showPalette, (v) => { set('showPalette', v); UI.renderTools(); }, 's-pal')));
        if (D.doc && !D.isNotebook()) {
          const doc = D.doc, P = doc.precision;
          add(h('h5', null, 'This canvas'),
            row('Background', 'Paper colour of the infinite canvas', (() => {
              const r = h('div', { class: 'bg-row' });
              Object.entries(D.papers).forEach(([k, c]) => r.append(h('button', { class: doc.paper.bg === c ? 'on' : '', style: { background: c }, 'aria-label': k, onclick: () => { doc.paper.bg = c; D.changed('paper'); R.render(); rebuild(); } })));
              return r;
            })()),
            row('Grid type', 'Also in the Precision menu', pickBtn([['none', 'No grid'], ['dot', 'Dot'], ['graph', 'Graph'], ['lined', 'Lined'], ['iso', 'Isometric'], ['tri', 'Triangle']], P.grid ? doc.paper.grid.type : 'none', (v) => { if (v === 'none') P.grid = false; else { P.grid = true; doc.paper.grid.type = v; } D.changed('precision'); R.render(); rebuild(); })),
            row('Artboards', doc.artboards.length ? doc.artboards.map((a) => `${a.name} (${(a.w / D.MM / 10).toFixed(1)} × ${(a.h / D.MM / 10).toFixed(1)} cm)`).join(', ') : 'Reference frames for printing and export. None yet.', (() => { const b = h('button', { class: 'btn' }, A.iconEl('plus'), 'Add'); b.addEventListener('click', () => UI.artboardMenu(b)); return b; })()),
            h('h5', null, 'Measurements'),
            row('Drawing scale', 'How objects on screen compare to real life', pickBtn([[1, '1:1'], [2, '1:2'], [4, '1:4'], [5, '1:5'], [8, '1:8'], [10, '1:10'], [12, '1:12']], P.scale || 1, (v) => { P.scale = v; D.changed('precision'); rebuild(); })),
            row('Units', 'Used for measurements and selection sizes', pickBtn([['px', 'Pixels'], ['pt', 'Points'], ['mm', 'Millimetres'], ['cm', 'Centimetres'], ['in', 'Inches']], P.units, (v) => { P.units = v; D.changed('precision'); A.emit('view'); rebuild(); })));
        }
      } else if (cur === 'interaction') {
        add(h('h5', null, 'Touch input'),
          row('Apple Pencil calibration', S.penOffset ? `Correcting ${S.penOffset.x} pt across, ${S.penOffset.y} pt down` : 'Tap five targets so ink sits exactly under the tip', h('button', { class: 'btn', onclick: () => A.IN.calibratePen() }, S.penOffset ? 'Recalibrate' : 'Calibrate')),
          NATIVE ? row('Fast ink', 'Draw the stroke you are writing natively, right under the Pencil tip', toggleSw(S.nativeInk !== false, (v) => { set('nativeInk', v); A.IN.syncInk(); }, 's-ink')) : null,
          row('Finger action', 'What your finger does when you use an Apple Pencil', sel('fingerAction', [['none', 'Do nothing'], ['pan', 'Pan'], ['draw', 'Draw'], ['select', 'Select'], ['auto', 'Auto']])),
          row('Two fingers: canvas rotation', 'Twist to rotate canvases (notebooks never rotate)', toggleSw(S.allowRotate && !S.rotLock, (v) => { set('allowRotate', true); set('rotLock', !v); A.emit('view'); }, 's-rot')),
          row('Two fingers: canvas zoom', 'Turn off to lock the zoom level', toggleSw(!S.zoomLock, (v) => { set('zoomLock', !v); A.emit('view'); }, 's-zoom')),
          row('Tap and hold to select', 'Hold the Pencil still on a canvas to start a lasso', toggleSw(S.tapHoldSelect, (v) => set('tapHoldSelect', v), 's-th')),
          row('Highlight selection', 'Fade everything that is not selected', toggleSw(S.highlightSelection, (v) => { set('highlightSelection', v); R.render(); }, 's-hl')),
          row('Draw & hold: activation time', 'Hold at the end of a stroke to turn it into a clean shape', slider('holdTime', 250, 1200, 50, (v) => (v / 1000).toFixed(2) + ' s')),
          row('Two-finger tap', 'Undo', toggleSw(S.twoFingerUndo, (v) => set('twoFingerUndo', v), 's-2f')),
          row('Three-finger tap', 'Redo', toggleSw(S.threeFingerRedo, (v) => set('threeFingerRedo', v), 's-3f')),
          h('h5', null, 'Apple Pencil'),
          row('Double-tap', 'What a double-tap on the Pencil does', sel('pencilTap', [['system', 'System setting'], ['switchEraser', 'Eraser'], ['switchPrevious', 'Last tool'], ['showColorPalette', 'Colours'], ['undo', 'Undo'], ['toggleUI', 'Hide UI']])),
          row('Squeeze (Apple Pencil Pro)', 'What a squeeze on the Pencil does', sel('pencilSqueeze', [['brush', 'Tool menu'], ['palette', 'Colours'], ['undo', 'Undo'], ['eraser', 'Eraser']])),
          row('Pressure response', 'Softer makes light strokes thicker', slider('pressure', 0.4, 2, 0.05, (v) => (v < 0.95 ? 'softer' : v > 1.05 ? 'firmer' : 'normal'))),
          row('Hover brush preview', 'Shows the brush size while the Pencil hovers (M2 and later)', toggleSw(S.hoverCursor, (v) => set('hoverCursor', v), 's-hover')));
        if (NATIVE) {
          add(h('h5', null, 'iPad'),
            row('Lock screen rotation', 'Keep Axiom in its current orientation', toggleSw(!!S.orientationLock, async (v) => { set('orientationLock', v); try { await A.native.post({ op: 'orientation', lock: v }); } catch (e) { /* ignore */ } }, 's-orient')),
            row('Keep iPad awake', 'The screen stays on while Axiom is open', toggleSw(!!S.keepAwake, async (v) => { set('keepAwake', v); try { await A.native.post({ op: 'keepAwake', on: v }); } catch (e) { /* ignore */ } }, 's-awake')));
        }
      } else if (cur === 'notebooks') {
        const ln = S.lastNotebook || {};
        add(h('h5', null, 'New notebook defaults'),
          row('Paper', 'For new notebooks', pickBtn([['lined', 'Lined'], ['grid', 'Grid'], ['dot', 'Dot grid'], ['blank', 'Blank'], ['cornell', 'Cornell']], ln.tpl || 'lined', (v) => { S.lastNotebook = Object.assign({}, ln, { tpl: v }); A.saveSettings(); rebuild(); })),
          row('Page size', null, segc([['a4', 'A4'], ['letter', 'Letter'], ['a5', 'A5']], ln.size || 'a4', (v) => { S.lastNotebook = Object.assign({}, ln, { size: v }); A.saveSettings(); rebuild(); })),
          row('Default view', 'Seamless scrolls pages vertically; single pages turn sideways', segc([['vertical', 'Seamless'], ['horizontal', 'Single pages']], ln.scroll || 'vertical', (v) => { S.lastNotebook = Object.assign({}, ln, { scroll: v }); A.saveSettings(); rebuild(); })),
          h('h5', null, 'Handwriting and drawing'),
          row('Back to the last tool after erasing', 'Like Notability\'s auto-deselect eraser', toggleSw(!!S.autoDeselectEraser, (v) => set('autoDeselectEraser', v), 's-ade')),
          row('Draw with finger', 'Off: your finger scrolls and the Pencil writes', toggleSw(S.fingerAction === 'draw', (v) => set('fingerAction', v ? 'draw' : 'pan'), 's-fd')),
          row('Shape recognition in notebooks', 'Draw a shape and hold to clean it up', toggleSw(S.nbShapes !== false, (v) => { set('nbShapes', v); if (D.doc && D.isNotebook()) { D.doc.precision.recog = v; D.changed('precision'); } }, 's-nbs')));
      } else if (cur === 'tutor') {
        add(h('h5', null, 'Tutor'),
          row('How the tutor answers', S.aiMode === 'app' ? 'Your question and pages open in the Claude or ChatGPT app; the chat is saved in your account there.' : 'Answers appear inside Axiom using your API key.', segc([['app', 'My AI app'], ['key', 'API key']], S.aiMode === 'app' ? 'app' : 'key', (v) => { S.aiMode = v; A.saveSettings(); rebuild(); })),
          row('Anthropic API key', S.aiKey ? 'Connected (stored only on this device)' : 'Not connected. Open the tutor to connect.', S.aiKey ? h('button', { class: 'btn', onclick: () => { S.aiKey = ''; A.saveSettings(); rebuild(); A.toast('API key removed'); } }, 'Remove key') : h('span')),
          row('Default model', null, sel('aiModel', A.AI.models.map((m) => [m.id, m.name]))),
          h('p', { class: 'small muted' }, 'The tutor sees only what you attach or ask about: a page, a selection, your notebook pages or a passage from a book. Answers can include interactive practice questions and flashcards.'));
      } else if (cur === 'studies') {
        add(h('h5', null, 'Studies'),
          row('Majors and courses', A.SU.majorNames().join(', ') || 'Not set', h('button', { class: 'btn', onclick: async () => { close(); await A.SU.openSetup(); } }, 'Edit')),
          ...(D.doc ? [row('Course of this ' + (D.isNotebook() ? 'notebook' : 'canvas'), null, (() => { const b = h('button', { class: 'btn' }, A.SU.name(D.doc.subject) || 'None'); b.addEventListener('click', () => A.SU.pickMenu(b, D.doc.subject, (sid) => { D.doc.subject = sid; D.changed('meta'); rebuild(); })); return b; })())] : []));
      } else if (cur === 'deleted') {
        const list = (S.trash || []).slice().sort((a, b) => b.deleted - a.deleted);
        add(h('h5', null, 'Recently Deleted'), h('p', { class: 'muted small' }, 'Deleted notebooks and canvases stay here for 30 days, then they are removed for good.'));
        if (!list.length) add(h('p', { class: 'empty-note' }, 'Nothing deleted recently.'));
        list.forEach((t) => add(row(t.name, `${t.kind === 'notebook' ? 'Notebook' : 'Canvas'} · deleted ${A.fmtDate(t.deleted)} · ${Math.max(0, 30 - Math.floor((Date.now() - t.deleted) / 864e5))} days left`,
          h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: async () => { if (await UI.restoreDoc(t.id)) { A.toast('Restored “' + t.name + '”'); rebuild(); if (!D.doc) UI.renderGallery(); } } }, A.iconEl('restore'), 'Restore')))));
        if (list.length) add(h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { class: 'btn danger', onclick: async () => { if (await A.dialog({ title: 'Delete everything here now?', body: 'This cannot be undone.', okText: 'Delete', danger: true })) { await UI.purgeTrash(true); rebuild(); } } }, 'Delete all now')));
      }
    };
    rebuild();
    box.append(h('div', { class: 'row between set-head' }, h('h3', null, 'Settings'), h('button', { class: 'ibtn', 'aria-label': 'Close', html: A.icon('close'), onclick: close })), h('div', { class: 'set-wrap' }, nav, content));
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
      h('h5', null, 'Books'),
      h('div', { class: 'help-grid' },
        ...g('Ask (Pencil)', 'Draw a box or a loop around any passage, then tap Ask, Explain, Hint, Highlight or Copy text.'),
        ...g('Write', 'Handwrite on PDF pages with 4 pens, 3 widths, an eraser and undo. Your writing is included when you ask the tutor.'),
        ...g('Citations', 'Tap a “p. 34 · lines 3–5” chip in an answer to jump there and see those lines highlighted.'),
        ...g('EPUB', 'Swipe or tap the arrows to turn pages. Select text to ask about it. Aa changes the text size.'),
        ...g('Apple Books', 'Share › Save to Files in Books, then Books › Add book or PDF in Axiom.')),
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
