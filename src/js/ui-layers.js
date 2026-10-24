/* Axiom layers panel: thumbnails, visibility, lock, opacity, reorder, focus, auto/manual */
'use strict';
(() => {
  const D = A.D, R = A.R, G = A.G, h = A.h;
  const UI = (A.UI = A.UI || {});
  let host, list;

  const thumb = (layer, cv) => {
    const doc = D.doc;
    const W = 112, H = 84;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
    const bb = D.allBB(doc, false);
    let m;
    if (bb) {
      const bw = Math.max(bb[2] - bb[0], 40), bh = Math.max(bb[3] - bb[1], 30);
      const s = Math.min((W - 10) / bw, (H - 10) / bh, 2);
      m = [s, 0, 0, s, W / 2 - ((bb[0] + bb[2]) / 2) * s, H / 2 - ((bb[1] + bb[3]) / 2) * s];
    } else m = [1, 0, 0, 1, W / 2, H / 2];
    const fake = { paper: doc.paper, layers: [Object.assign({}, layer, { visible: true, opacity: 1 })], focusLayerId: null, precision: doc.precision };
    R.drawScene(ctx, { m, w: W, h: H, doc: fake, bg: doc.paper.bg, grid: false, scratch: sc, sctx: sc.getContext('2d'), dpr: 1 });
  };

  function render() {
    if (!host || host.hidden || !D.doc) return;
    const doc = D.doc;
    list.innerHTML = '';
    const L = doc.layers;
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i];
      const cv = h('canvas');
      const row = h('div', {
        class: 'layer' + (l.id === doc.activeLayerId ? ' on' : '') + (!l.visible ? ' hidden-layer' : '') + (doc.focusLayerId === l.id ? ' focus' : ''),
        dataset: { id: l.id, index: i }, role: 'button', tabindex: 0,
      },
      cv,
      h('div', { class: 'grow' }, h('div', { class: 'lname' }, l.name), h('div', { class: 'lmeta' }, `${l.items.length} item${l.items.length === 1 ? '' : 's'}${l.opacity < 1 ? ' · ' + Math.round(l.opacity * 100) + '%' : ''}`)),
      l.locked ? h('button', { class: 'ibtn', title: 'Unlock', 'aria-label': 'Unlock layer', html: A.icon('lock'), onclick: (e) => { e.stopPropagation(); D.setLayer(l.id, { locked: false }, false); } }) : null,
      h('button', { class: 'ibtn', title: l.visible ? 'Hide' : 'Show', 'aria-label': l.visible ? 'Hide layer' : 'Show layer', html: A.icon(l.visible ? 'eye' : 'eyeoff'), onclick: (e) => { e.stopPropagation(); D.setLayer(l.id, { visible: !l.visible }, false); R.render(); } }));
      bindRow(row, l, i);
      list.append(row);
      thumb(l, cv);
    }
    if (doc.precision.grid && doc.paper.grid.type !== 'none') {
      const names = { dot: 'Dot grid', graph: 'Graph paper', lined: 'Lined paper', iso: 'Isometric grid', tri: 'Triangle grid', eng: 'Engineering grid' };
      list.append(h('div', { class: 'layer-grid' }, A.iconEl('gallery'), h('span', { class: 'grow' }, names[doc.paper.grid.type] || 'Grid'),
        h('button', { class: 'ibtn', 'aria-label': 'Hide grid', html: A.icon('eye'), onclick: () => { doc.precision.grid = false; D.changed('precision'); R.render(); render(); A.emit('precision'); } })));
    }
    const auto = A.$('#layers-auto');
    if (auto) auto.classList.toggle('on', doc.layerMode === 'auto');
  }

  function bindRow(row, l, index) {
    let lp = null, dragging = false, startY = 0, lastTap = 0, tapId = 0;
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ibtn')) return;
      startY = e.clientY;
      lp = setTimeout(() => {
        lp = null; dragging = true;
        row.classList.add('dragging');
        try { row.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }, 380);
    });
    row.addEventListener('pointermove', (e) => {
      if (lp && Math.abs(e.clientY - startY) > 8) { clearTimeout(lp); lp = null; }
      if (!dragging) return;
      e.preventDefault();
      row.style.transform = `translateY(${e.clientY - startY}px)`;
    });
    const end = (e, cancelled) => {
      if (lp) { clearTimeout(lp); lp = null; if (!cancelled && Math.abs(e.clientY - startY) < 8) tap(); return; }
      if (!dragging) return;
      dragging = false;
      row.classList.remove('dragging');
      row.style.transform = '';
      const rows = [...list.querySelectorAll('.layer')];
      const rh = row.getBoundingClientRect().height + 4;
      const steps = Math.round((e.clientY - startY) / rh);
      const pos = rows.indexOf(row);
      const newPos = A.clamp(pos + steps, 0, rows.length - 1);
      const L = D.doc.layers.length;
      if (newPos !== pos) D.moveLayer(L - 1 - pos, L - 1 - newPos);
      else render();
    };
    const tap = () => {
      const now = performance.now();
      if (now - lastTap < 300) {
        D.doc.focusLayerId = D.doc.focusLayerId === l.id ? null : l.id;
        tapId++;
        D.changed('layers'); R.render(); render();
        lastTap = 0;
        return;
      }
      lastTap = now;
      if (D.doc.activeLayerId !== l.id) {
        D.doc.activeLayerId = l.id;
        D.doc.layerMode = 'manual';
        if (D.doc.focusLayerId) D.doc.focusLayerId = l.id;
        D.changed('layers'); R.render(); render();
      } else { const tok = ++tapId; setTimeout(() => { if (tok === tapId && row.isConnected) openOptions(row, l); }, 300); }
    };
    row.addEventListener('pointerup', (e) => end(e, false));
    row.addEventListener('pointercancel', (e) => end(e, true));
  }

  function openOptions(anchor, l) {
    const box = h('div', { class: 'menu' });
    const item = (icon, label, fn, cls) => {
      const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } });
      b.innerHTML = A.icon(icon); b.append(label);
      box.append(b);
    };
    box.append(h('div', { class: 'sub' }, l.name));
    item('selectall', 'Select all on layer', () => { A.emit('tool:select'); A.SEL.set(l.items.map((it) => it.id)); });
    item('rename', 'Rename', async () => { const n = await A.dialog({ title: 'Rename layer', input: l.name, okText: 'Rename' }); if (n) D.setLayer(l.id, { name: n.slice(0, 60) }); });
    const op = h('input', { type: 'range', min: 0, max: 100, value: Math.round(l.opacity * 100), id: 'layer-opacity' });
    const opv = h('b', { class: 'num' }, Math.round(l.opacity * 100) + '%');
    let began = false;
    op.addEventListener('input', () => { if (!began) { D.begin(); began = true; } D.setLayer(l.id, { opacity: +op.value / 100 }, false); opv.textContent = op.value + '%'; R.render(); });
    op.addEventListener('change', () => { if (began) { D.commit('layers'); began = false; } });
    box.append(h('div', { style: { padding: '6px 10px' } }, h('div', { class: 'row between small muted' }, h('span', null, 'Opacity'), opv), op));
    item(l.locked ? 'unlock' : 'lock', l.locked ? 'Unlock' : 'Lock', () => D.setLayer(l.id, { locked: !l.locked }));
    item('focus', D.doc.focusLayerId === l.id ? 'Exit focus' : 'Focus (fade others)', () => { D.doc.focusLayerId = D.doc.focusLayerId === l.id ? null : l.id; D.changed('layers'); R.render(); render(); });
    item('duplicate', 'Duplicate', () => D.duplicateLayer(l.id));
    item('merge', 'Merge down', () => D.mergeDown(l.id));
    box.append(h('hr'));
    item('clear', 'Clear layer', async () => { if (await A.dialog({ title: 'Clear this layer?', body: 'All strokes on it are removed. You can undo this.', okText: 'Clear', danger: true })) D.clearLayer(l.id); }, 'danger');
    item('trash', 'Delete layer', async () => { if (await A.dialog({ title: `Delete “${l.name}”?`, body: 'You can undo this.', okText: 'Delete', danger: true })) D.deleteLayer(l.id); }, 'danger');
    A.popover(box, anchor, { side: 'left' });
  }

  const debounced = A.debounce(render, 450);
  UI.mountLayers = (el) => {
    host = el;
    const auto = h('button', { class: 'ibtn', id: 'layers-auto', title: 'Automatic layers: each tool draws on its own layer', 'aria-label': 'Automatic layers', html: A.icon('auto') });
    auto.addEventListener('click', () => {
      D.doc.layerMode = D.doc.layerMode === 'auto' ? 'manual' : 'auto';
      A.toast(D.doc.layerMode === 'auto' ? 'Automatic layers: each tool gets its own layer' : 'Manual layers: you draw on the active layer');
      D.changed('layers'); render();
    });
    host.append(h('div', { class: 'layers-head' }, h('h4', null, 'Layers'), auto,
      h('button', { class: 'ibtn', title: 'New layer', 'aria-label': 'New layer', html: A.icon('plus'), onclick: () => D.addLayer() })));
    list = h('div', { class: 'layer-list' });
    host.append(list);
    A.on('layers', render);
    A.on('layers:thumbs', debounced);
    A.on('doc:changed', (k) => { if (k === 'all' || k === 'layers') render(); else debounced(); });
  };
  UI.renderLayers = render;
})();
