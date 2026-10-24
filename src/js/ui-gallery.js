/* Axiom gallery: drawings grid, search/sort, new drawing sheet with paper templates, file import */
'use strict';
(() => {
  const D = A.D, R = A.R, h = A.h;
  const UI = (A.UI = A.UI || {});
  const S = A.settings;
  let host, query = '';

  UI.templates = [
    { id: 'blank', name: 'Blank', grid: 'none' },
    { id: 'dot', name: 'Dot grid', grid: 'dot', spacing: 24 },
    { id: 'graph', name: 'Graph', grid: 'graph', spacing: 40, divisions: 5 },
    { id: 'lined', name: 'Lined', grid: 'lined', spacing: 32, divisions: 1 },
    { id: 'iso', name: 'Isometric', grid: 'iso', spacing: 32 },
    { id: 'eng', name: 'Engineering', grid: 'graph', spacing: 50, divisions: 10, bg: '#eef5ec' },
  ];

  const drawTemplate = (cv, t, bg) => {
    const W = 200, H = 150; cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = t.bg || bg; ctx.fillRect(0, 0, W, H);
    const paper = { bg: t.bg || bg, grid: { type: t.grid, spacing: (t.spacing || 24) * 0.5, divisions: t.divisions || 5, opacity: 1 } };
    R.drawGrid(ctx, [1, 0, 0, 1, 0, 0], W, H, paper, { dpr: 1 });
  };

  UI.newDrawingSheet = () => new Promise((res) => {
    const st = { t: UI.templates[1], bg: D.papers.white, name: 'Untitled' };
    const back = h('div', { class: 'modal-back' });
    const close = (v) => { back.remove(); res(v); };
    const grid = h('div', { class: 'paper-grid' });
    const bgRow = h('div', { class: 'bg-row' });
    const nameIn = h('input', { class: 'field', id: 'new-name', value: st.name, autocomplete: 'off' });
    const draw = () => {
      grid.innerHTML = ''; bgRow.innerHTML = '';
      UI.templates.forEach((t) => {
        const cv = h('canvas');
        const b = h('button', { class: 'paper-opt' + (t.id === st.t.id ? ' on' : ''), onclick: () => { st.t = t; draw(); } }, cv, t.name);
        drawTemplate(cv, t, st.bg);
        grid.append(b);
      });
      Object.entries(D.papers).forEach(([k, c]) => bgRow.append(h('button', {
        class: c === st.bg && !st.t.bg ? 'on' : '', style: { background: c }, 'aria-label': k + ' paper', title: k,
        onclick: () => { st.bg = c; if (st.t.bg) st.t = UI.templates.find((x) => x.grid === st.t.grid && !x.bg) || UI.templates[2]; draw(); },
      })));
    };
    draw();
    const create = () => close({ name: nameIn.value.trim() || 'Untitled', t: st.t, bg: st.t.bg || st.bg });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    back.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'New drawing' },
      h('h3', null, 'New drawing'),
      h('h5', null, 'Name'), nameIn,
      h('h5', null, 'Paper'), grid,
      h('h5', null, 'Background'), bgRow,
      h('div', { class: 'row end gap', style: { marginTop: '22px' } }, h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: create }, 'Create'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.body.append(back);
  });

  UI.createFromSheet = (r) => {
    const doc = D.create({ name: r.name, bg: r.bg, grid: r.t.grid });
    doc.paper.grid.spacing = r.t.spacing || 24;
    doc.paper.grid.divisions = r.t.divisions || 5;
    if (r.t.grid === 'none') { doc.paper.grid.type = 'dot'; doc.precision.grid = false; }
    return doc;
  };

  async function render() {
    const metas = (await A.store.listMeta()).filter(Boolean);
    const sorters = {
      updated: (a, b) => b.updated - a.updated,
      created: (a, b) => b.created - a.created,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    metas.sort(sorters[S.sort] || sorters.updated);
    const q = query.trim().toLowerCase();
    const shown = q ? metas.filter((m) => m.name.toLowerCase().includes(q)) : metas;
    host.innerHTML = '';
    const search = h('input', { type: 'search', id: 'g-search', placeholder: 'Search drawings', value: query, 'aria-label': 'Search drawings' });
    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    const sort = h('select', { class: 'field', id: 'g-sort', style: { margin: 0, width: 'auto', height: '40px' }, 'aria-label': 'Sort' },
      ...[['updated', 'Last edited'], ['created', 'Date created'], ['name', 'Name']].map(([v, l]) => h('option', { value: v, selected: S.sort === v }, l)));
    sort.addEventListener('change', () => { S.sort = sort.value; A.saveSettings(); render(); });
    const importBtn = h('button', { class: 'btn', onclick: importProject }, A.iconEl('import'), 'Import');
    const newBtn = h('button', { class: 'btn primary', id: 'g-new', onclick: newDrawing }, A.iconEl('plus'), 'New drawing');
    const wrap = h('div', { class: 'g-wrap' },
      h('div', { class: 'g-top' },
        h('div', null, h('h1', { class: 'wordmark' }, 'Axiom', h('i', null, '.')), h('p', { class: 'g-sub' }, 'An infinite canvas for scientists and mathematicians')),
        h('div', { class: 'g-actions' }, h('div', { class: 'g-search' }, A.iconEl('search'), search), sort, importBtn, newBtn)),
      h('div', { class: 'g-bar' }, h('h2', null, `Drawings · ${metas.length}`)),
      h('div', { class: 'g-grid', id: 'g-grid' }));
    host.append(wrap);
    const renderGrid = () => {
      const qq = query.trim().toLowerCase();
      const list = qq ? metas.filter((m) => m.name.toLowerCase().includes(qq)) : metas;
      const grid = A.$('#g-grid', host);
      grid.innerHTML = '';
      const nc = h('button', { class: 'card new', onclick: newDrawing, 'aria-label': 'New drawing' }, h('span', { class: 'thumb', html: A.icon('plus') }), h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, 'New drawing'), h('div', { class: 'date' }, 'Choose a paper'))));
      if (!qq) grid.append(nc);
      list.forEach((m) => grid.append(card(m)));
      if (!list.length && qq) grid.append(h('p', { class: 'empty-note' }, `No drawings match “${query}”.`));
    };
    renderGrid();
    void shown;
  }

  function card(m) {
    const thumb = h('span', { class: 'thumb', style: { background: m.paper || '#fff' } });
    if (m.thumb) thumb.append(h('img', { src: m.thumb, alt: '' }));
    const open = h('button', { class: 'card-open', style: { display: 'contents' }, onclick: () => A.emit('open', m.id), 'aria-label': 'Open ' + m.name }, thumb);
    const more = h('button', { class: 'ibtn', 'aria-label': 'More for ' + m.name, html: A.icon('more') });
    more.addEventListener('click', (e) => { e.stopPropagation(); cardMenu(m, more); });
    const el = h('div', { class: 'card' }, open, h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, m.name), h('div', { class: 'date' }, A.fmtDate(m.updated))), more));
    let lp;
    thumb.addEventListener('pointerdown', () => { lp = setTimeout(() => { lp = 'fired'; cardMenu(m, thumb); }, 550); });
    thumb.addEventListener('pointerup', () => { if (lp !== 'fired') clearTimeout(lp); });
    thumb.addEventListener('pointerleave', () => { if (lp !== 'fired') clearTimeout(lp); });
    open.addEventListener('click', (e) => { if (lp === 'fired') { e.stopImmediatePropagation(); lp = null; } }, true);
    return el;
  }

  function cardMenu(m, anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('chev', 'Open', () => A.emit('open', m.id));
    it('rename', 'Rename', async () => {
      const n = await A.dialog({ title: 'Rename drawing', input: m.name, okText: 'Rename' });
      if (!n || !n.trim()) return;
      const doc = await A.store.loadDoc(m.id);
      if (!doc) return;
      doc.name = n.trim().slice(0, 80);
      await A.store.saveDoc(doc, m.thumb);
      render();
    });
    it('duplicate', 'Duplicate', async () => {
      const doc = await A.store.loadDoc(m.id);
      if (!doc) return;
      doc.id = A.uid(); doc.name = m.name + ' copy'; doc.created = doc.updated = Date.now();
      await A.store.saveDoc(doc, m.thumb);
      render();
    });
    it('export', 'Export project file', async () => {
      const doc = await A.store.loadDoc(m.id);
      if (!doc) return;
      A.deliverFile(new Blob([JSON.stringify(Object.assign({ format: 'axiom', version: 1 }, doc))], { type: 'application/json' }), m.name.replace(/[\\/:*?"<>|]+/g, '-') + '.axiom');
    });
    box.append(h('hr'));
    it('trash', 'Delete', async () => {
      const ok = await A.dialog({ title: `Delete “${m.name}”?`, body: 'This drawing is removed from this device. This cannot be undone.', okText: 'Delete', danger: true });
      if (ok) { await A.store.deleteDoc(m.id); render(); }
    }, 'danger');
    A.popover(box, anchor, { side: 'down' });
  }

  async function newDrawing() {
    const r = await UI.newDrawingSheet();
    if (!r) return;
    const doc = UI.createFromSheet(r);
    await A.store.saveDoc(doc, null);
    A.emit('open', doc.id);
  }
  async function importProject() {
    const inp = h('input', { type: 'file', accept: '.axiom,application/json,.json', style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      try { await UI.importProjectText(await f.text()); } catch (e) { A.toast('That file is not an Axiom project'); }
    });
    document.body.append(inp);
    inp.click();
  }
  UI.importProjectText = async (txt) => {
    const data = JSON.parse(txt);
    if (!data || !Array.isArray(data.layers)) throw new Error('bad file');
    delete data.format; delete data.version;
    data.id = A.uid();
    data.updated = Date.now();
    data.created = data.created || Date.now();
    data.name = data.name || 'Imported drawing';
    const doc = D.normalize(data);
    await A.store.saveDoc(doc, R.thumbnail(doc).toDataURL('image/jpeg', 0.8));
    A.toast('Imported “' + doc.name + '”');
    render();
  };

  UI.mountGallery = (el) => { host = el; };
  UI.renderGallery = render;
})();
