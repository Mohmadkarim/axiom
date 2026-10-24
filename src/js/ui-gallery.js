/* Axiom gallery: courses sidebar, drawings grid, documents library, new drawing sheet, file import */
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

  UI.newDrawingSheet = (opts = {}) => new Promise((res) => {
    const st = { t: UI.templates[1], bg: D.papers.white, name: opts.name || 'Untitled', subject: opts.subject ?? (S.galleryFilter && S.galleryFilter !== 'all' && S.galleryFilter !== 'docs' && S.galleryFilter !== 'none' ? S.galleryFilter : null) };
    const back = h('div', { class: 'modal-back' });
    const close = (v) => { back.remove(); res(v); };
    const grid = h('div', { class: 'paper-grid' });
    const bgRow = h('div', { class: 'bg-row' });
    const subjRow = h('div', { class: 'chips' });
    const nameIn = h('input', { class: 'field', id: 'new-name', value: st.name, autocomplete: 'off' });
    const draw = () => {
      grid.innerHTML = ''; bgRow.innerHTML = ''; subjRow.innerHTML = '';
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
      subjRow.append(h('button', { class: 'chip' + (!st.subject ? ' on' : ''), onclick: () => { st.subject = null; draw(); } }, 'No course'));
      A.SU.list().forEach((s) => subjRow.append(h('button', { class: 'chip' + (st.subject === s.id ? ' on' : ''), onclick: () => { st.subject = s.id; draw(); } }, h('i', { class: 'dot', style: { background: s.color } }), s.name)));
      subjRow.append(h('button', { class: 'chip ghost', onclick: async () => { const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); const s = n && A.SU.add(n); if (s) { st.subject = s.id; draw(); } } }, '+ Course'));
    };
    draw();
    const create = () => close({ name: nameIn.value.trim() || 'Untitled', t: st.t, bg: st.t.bg || st.bg, subject: st.subject });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    back.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'New drawing' },
      h('h3', null, 'New drawing'),
      h('h5', null, 'Name'), nameIn,
      h('h5', null, 'Course'), subjRow,
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
    doc.subject = r.subject || null;
    return doc;
  };

  /* ---------- gallery ---------- */
  let onboarded = false;
  async function render() {
    if (S.majors == null && !onboarded) { onboarded = true; setTimeout(async () => { await A.SU.openSetup(true); render(); }, 300); }
    const metas = (await A.store.listMeta()).filter(Boolean);
    const docs = A.ST.docs();
    const filter = S.galleryFilter || 'all';
    host.innerHTML = '';
    const count = (fn) => metas.filter(fn).length;

    // sidebar
    const side = h('nav', { class: 'g-side', 'aria-label': 'Courses' });
    const item = (id, label, n, dotColor, icon) => {
      const b = h('button', { class: 'g-nav' + (filter === id ? ' on' : ''), onclick: () => { S.galleryFilter = id; A.saveSettings(); render(); } },
        dotColor ? h('i', { class: 'dot', style: { background: dotColor } }) : A.iconEl(icon || 'gallery'), h('span', { class: 'grow' }, label), h('span', { class: 'g-count num' }, String(n)));
      if (dotColor) b.addEventListener('contextmenu', (e) => { e.preventDefault(); subjectMenu(b, id); });
      return b;
    };
    side.append(item('all', 'All drawings', metas.length, null, 'gallery'), item('docs', 'Documents', docs.length, null, 'book'));
    const coursesHead = h('div', { class: 'g-side-h' }, h('span', null, 'Courses'), h('button', { class: 'ibtn', title: 'Add a course', 'aria-label': 'Add a course', html: A.icon('plus'), onclick: async () => { const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); if (n && A.SU.add(n)) render(); } }));
    side.append(coursesHead);
    A.SU.list().forEach((s) => {
      const b = item(s.id, s.name, count((m) => m.subject === s.id), s.color);
      const more = h('button', { class: 'g-more', 'aria-label': 'Options for ' + s.name, html: A.icon('more'), onclick: (e) => { e.stopPropagation(); subjectMenu(more, s.id); } });
      b.append(more);
      side.append(b);
    });
    if (!A.SU.list().length) side.append(h('button', { class: 'g-nav ghost', onclick: async () => { await A.SU.openSetup(); render(); } }, A.iconEl('plus'), 'Add your courses'));
    const none = count((m) => !m.subject);
    if (A.SU.list().length && none) side.append(item('none', 'No course', none, 'var(--line-strong)'));

    // main
    const main = h('main', { class: 'g-main' });
    const search = h('input', { type: 'search', id: 'g-search', placeholder: filter === 'docs' ? 'Search documents' : 'Search drawings', value: query, 'aria-label': 'Search' });
    const sort = h('select', { class: 'field', id: 'g-sort', style: { margin: 0, width: 'auto', height: '40px' }, 'aria-label': 'Sort' },
      ...[['updated', 'Last edited'], ['created', 'Date created'], ['name', 'Name']].map(([v, l]) => h('option', { value: v, selected: S.sort === v }, l)));
    sort.addEventListener('change', () => { S.sort = sort.value; A.saveSettings(); render(); });
    const isDocs = filter === 'docs';
    const importBtn = h('button', { class: 'btn', onclick: isDocs ? importDocs : importProject }, A.iconEl('import'), isDocs ? 'Add PDF or photo' : 'Import');
    const newBtn = h('button', { class: 'btn primary', id: 'g-new', onclick: newDrawing }, A.iconEl('plus'), 'New drawing');
    const title = filter === 'all' ? 'All drawings' : filter === 'docs' ? 'Documents' : filter === 'none' ? 'No course' : A.SU.name(filter);
    main.append(
      h('div', { class: 'g-top' },
        h('div', null, h('h1', { class: 'wordmark' }, 'Axiom', h('i', null, '.')), h('p', { class: 'g-sub' }, 'An infinite canvas for scientists and mathematicians')),
        h('div', { class: 'g-actions' }, h('div', { class: 'g-search' }, A.iconEl('search'), search), isDocs ? null : sort, importBtn, newBtn)),
      h('div', { class: 'g-bar' }, h('h2', null, title)),
      h('div', { class: 'g-grid', id: 'g-grid' }));
    host.append(h('div', { class: 'g-wrap g-layout' }, side, main));

    const sorters = { updated: (a, b) => b.updated - a.updated, created: (a, b) => b.created - a.created, name: (a, b) => a.name.localeCompare(b.name) };
    const renderGrid = () => {
      const q = query.trim().toLowerCase();
      const grid = A.$('#g-grid', host);
      grid.innerHTML = '';
      if (isDocs) {
        const list = docs.filter((d) => !q || d.name.toLowerCase().includes(q)).sort((a, b) => b.added - a.added);
        list.forEach((d) => grid.append(docCard(d)));
        if (!list.length) grid.append(h('div', { class: 'empty-note g-empty' }, h('p', null, q ? `No documents match “${query}”.` : 'Add problem sheets, solution sets, lecture notes and textbook chapters as PDFs or photos. Open them in the study panel beside your canvas, and the tutor can read them.'), q ? null : h('button', { class: 'btn primary', onclick: importDocs }, 'Add PDF or photo')));
        return;
      }
      let list = metas.filter((m) => filter === 'all' || (filter === 'none' ? !m.subject : m.subject === filter));
      list = list.filter((m) => !q || m.name.toLowerCase().includes(q)).sort(sorters[S.sort] || sorters.updated);
      if (!q) grid.append(h('button', { class: 'card new', onclick: newDrawing, 'aria-label': 'New drawing' }, h('span', { class: 'thumb', html: A.icon('plus') }), h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, 'New drawing'), h('div', { class: 'date' }, 'Choose a paper')))));
      list.forEach((m) => grid.append(card(m)));
      if (!list.length && q) grid.append(h('p', { class: 'empty-note' }, `No drawings match “${query}”.`));
    };
    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    renderGrid();
  }

  function subjectMenu(anchor, id) {
    const s = A.SU.get(id);
    if (!s) return;
    const box = h('div', { class: 'menu' });
    box.append(h('div', { class: 'sub' }, s.name));
    box.append(h('button', { onclick: async () => { A.closePopovers(); const n = await A.dialog({ title: 'Rename course', input: s.name, okText: 'Rename' }); if (n) { A.SU.rename(id, n); render(); } } }, A.iconEl('rename'), 'Rename'));
    const colors = h('div', { class: 'bg-row', style: { padding: '6px 10px' } });
    A.SU.colors.forEach((c) => colors.append(h('button', { class: c === s.color ? 'on' : '', style: { background: c, width: '28px', height: '28px' }, 'aria-label': 'Color', onclick: () => { s.color = c; A.saveSettings(); A.closePopovers(); render(); } })));
    box.append(colors, h('hr'), h('button', { class: 'danger', onclick: async () => {
      A.closePopovers();
      if (!(await A.dialog({ title: `Remove the course “${s.name}”?`, body: 'Its drawings and documents stay; they just won\'t belong to a course.', okText: 'Remove', danger: true }))) return;
      A.SU.remove(id); if (S.galleryFilter === id) S.galleryFilter = 'all'; render();
    } }, A.iconEl('trash'), 'Remove course'));
    A.popover(box, anchor, { side: 'down' });
  }

  function card(m) {
    const thumb = h('span', { class: 'thumb', style: { background: m.paper || '#fff' } });
    if (m.thumb) thumb.append(h('img', { src: m.thumb, alt: '' }));
    const open = h('button', { class: 'card-open', style: { display: 'contents' }, onclick: () => A.emit('open', m.id), 'aria-label': 'Open ' + m.name }, thumb);
    const more = h('button', { class: 'ibtn', 'aria-label': 'More for ' + m.name, html: A.icon('more') });
    more.addEventListener('click', (e) => { e.stopPropagation(); cardMenu(m, more); });
    const subj = m.subject && A.SU.get(m.subject);
    const el = h('div', { class: 'card' }, open, h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, m.name),
      h('div', { class: 'date' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, (subj ? subj.name + ' · ' : '') + A.fmtDate(m.updated))), more));
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
    it('folder', 'Course: ' + (A.SU.name(m.subject) || 'none'), () => A.SU.pickMenu(anchor, m.subject, async (sid) => {
      const doc = await A.store.loadDoc(m.id); if (!doc) return;
      doc.subject = sid; await A.store.saveDoc(doc, m.thumb); render();
    }));
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

  /* ---------- documents ---------- */
  const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
  function docCard(d) {
    const subj = d.subject && A.SU.get(d.subject);
    const thumb = h('span', { class: 'thumb doc-thumb' }, A.iconEl(d.type === 'pdf' ? 'pdf' : 'image'), h('span', { class: 'doc-kind' }, d.type === 'pdf' ? 'PDF' : 'Photo'));
    const open = h('button', { class: 'card-open', style: { display: 'contents' }, onclick: () => studyDoc(d), 'aria-label': 'Study ' + d.name }, thumb);
    const more = h('button', { class: 'ibtn', 'aria-label': 'More for ' + d.name, html: A.icon('more') });
    more.addEventListener('click', (e) => { e.stopPropagation(); docMenu(d, more); });
    return h('div', { class: 'card' }, open, h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, d.name),
      h('div', { class: 'date' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, (subj ? subj.name + ' · ' : '') + fmtSize(d.size || 0) + (d.lastPage > 1 ? ' · p. ' + d.lastPage : ''))), more));
  }
  function docMenu(d, anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('book', 'Study beside a drawing', () => studyDoc(d));
    it('folder', 'Course: ' + (A.SU.name(d.subject) || 'none'), () => A.SU.pickMenu(anchor, d.subject, (sid) => { A.ST.updateDoc(d.id, { subject: sid }); render(); }));
    it('rename', 'Rename', async () => { const n = await A.dialog({ title: 'Rename document', input: d.name, okText: 'Rename' }); if (n) { A.ST.updateDoc(d.id, { name: n.slice(0, 80) }); render(); } });
    box.append(h('hr'));
    it('trash', 'Delete', async () => { if (await A.dialog({ title: `Delete “${d.name}”?`, body: 'The file is removed from Axiom on this device.', okText: 'Delete', danger: true })) { await A.ST.deleteDoc(d.id); render(); } }, 'danger');
    A.popover(box, anchor, { side: 'down' });
  }
  /* open the document next to the most recent drawing of its course (or a new one) */
  async function studyDoc(d) {
    const metas = (await A.store.listMeta()).filter(Boolean);
    let target = metas.filter((m) => (d.subject ? m.subject === d.subject : true)).sort((a, b) => b.updated - a.updated)[0];
    if (!target || !d.subject) {
      const r = await UI.newDrawingSheet({ name: 'Notes · ' + d.name.slice(0, 40), subject: d.subject });
      if (!r) return;
      const doc = UI.createFromSheet(r);
      await A.store.saveDoc(doc, null);
      target = { id: doc.id };
    }
    A.ST.pendingDoc = d.id;
    A.emit('open', target.id);
  }
  async function importDocs() {
    const f = await A.ST.pickFile();
    if (!f) return;
    const sid = S.galleryFilter && !['all', 'docs', 'none'].includes(S.galleryFilter) ? S.galleryFilter : null;
    await A.ST.importFile(f, sid);
    render();
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

  UI.mountGallery = (el) => { host = el; A.on('subjects', () => { if (!host.hidden && !D.doc) render(); }); };
  UI.renderGallery = render;
})();
