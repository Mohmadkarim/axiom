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
    let filter = S.galleryFilter || 'home';
    if (filter === 'docs') filter = 'library';
    if (!['home', 'all', 'library', 'none'].includes(filter) && !A.SU.get(filter)) filter = 'home';
    host.innerHTML = '';
    const count = (fn) => metas.filter(fn).length;
    const go = (id) => { S.galleryFilter = id; A.saveSettings(); query = ''; render(); };

    // sidebar
    const side = h('nav', { class: 'g-side', 'aria-label': 'Sections' });
    side.append(h('div', { class: 'g-brand' }, h('span', { class: 'wordmark' }, 'Axiom', h('i', null, '.'))));
    const item = (id, label, n, dotColor, icon) => {
      const b = h('button', { class: 'g-nav' + (filter === id ? ' on' : ''), onclick: () => go(id) },
        dotColor ? h('i', { class: 'dot', style: { background: dotColor } }) : A.iconEl(icon || 'gallery'), h('span', { class: 'grow' }, label), n != null ? h('span', { class: 'g-count num' }, String(n)) : null);
      return b;
    };
    side.append(item('home', 'Home', null, null, 'spark'), item('all', 'Drawings', metas.length, null, 'gallery'), item('library', 'Books', docs.length, null, 'book'));
    side.append(h('div', { class: 'g-side-h' }, h('span', null, 'Courses'), h('button', { class: 'ibtn', title: 'Add a course', 'aria-label': 'Add a course', html: A.icon('plus'), onclick: async () => { const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); if (n && A.SU.add(n)) render(); } })));
    A.SU.list().forEach((s) => {
      const b = item(s.id, s.name, count((m) => m.subject === s.id) + docs.filter((d) => d.subject === s.id).length, s.color);
      const more = h('button', { class: 'g-more', 'aria-label': 'Options for ' + s.name, html: A.icon('more'), onclick: (e) => { e.stopPropagation(); subjectMenu(more, s.id); } });
      b.append(more);
      side.append(b);
    });
    if (!A.SU.list().length) side.append(h('button', { class: 'g-nav ghost', onclick: async () => { await A.SU.openSetup(); render(); } }, A.iconEl('plus'), 'Add your courses'));
    const none = count((m) => !m.subject);
    if (A.SU.list().length && none) side.append(item('none', 'No course', none, 'var(--line-strong)'));
    side.append(h('div', { class: 'grow' }), h('button', { class: 'g-nav ghost', onclick: () => A.UI.openSettings() }, A.iconEl('settings'), 'Settings'), h('div', { class: 'g-ver num' }, `Axiom ${A.VERSION} · build ${window.AXIOM_BUILD || 'dev'}`));

    const main = h('main', { class: 'g-main' });
    host.append(h('div', { class: 'g-wrap g-layout' }, side, main));
    const newBtn = () => h('button', { class: 'btn primary', onclick: newDrawing }, A.iconEl('plus'), 'New drawing');
    const addDocBtn = () => h('button', { class: 'btn', onclick: importDocs }, A.iconEl('import'), 'Add book or PDF');
    const sorters = { updated: (a, b) => b.updated - a.updated, created: (a, b) => b.created - a.created, name: (a, b) => a.name.localeCompare(b.name) };
    const section = (title, actions, content) => h('section', { class: 'g-sec' }, h('div', { class: 'g-sec-h' }, h('h2', null, title), actions || null), content);
    docs.filter((d) => !d.cover).slice(0, 6).forEach((d) => A.ST.makeCover(d));

    if (filter === 'home') {
      const hr = new Date().getHours();
      const greet = hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
      main.append(h('header', { class: 'home-hero' },
        h('div', null, h('p', { class: 'home-date' }, new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })),
          h('h1', { class: 'home-greet' }, greet + '.'),
          h('p', { class: 'home-sub' }, metas.length || docs.length ? 'Pick up where you left off.' : 'Start a drawing, or add a book or problem set to your library.')),
        h('div', { class: 'g-actions' }, h('button', { class: 'btn', onclick: () => go('library') }, A.iconEl('book'), 'Books'), addDocBtn(), newBtn())));
      const lastDraw = metas.slice().sort(sorters.updated)[0];
      const lastBook = docs.filter((d) => d.lastRead).sort((a, b) => b.lastRead - a.lastRead)[0];
      if (lastDraw || lastBook) {
        const row = h('div', { class: 'cont-row' });
        if (lastBook) row.append(continueBook(lastBook));
        if (lastDraw) row.append(continueDrawing(lastDraw));
        main.append(section('Continue', null, row));
      }
      const recent = metas.slice().sort(sorters.updated).slice(0, 4);
      if (recent.length) { const g = h('div', { class: 'g-grid' }); recent.forEach((m) => g.append(card(m))); main.append(section('Recent drawings', h('button', { class: 'link-btn', onclick: () => go('all') }, 'See all'), g)); }
      const shelfDocs = docs.slice().sort((a, b) => (b.lastRead || b.added) - (a.lastRead || a.added)).slice(0, 8);
      main.append(section('Books', h('button', { class: 'link-btn', onclick: () => go('library') }, shelfDocs.length ? 'Open Books' : ''), shelfDocs.length ? shelf(shelfDocs) : emptyLibrary()));
      if (A.SU.list().length) {
        const cg = h('div', { class: 'course-grid' });
        A.SU.list().forEach((s) => cg.append(h('button', { class: 'course-tile', style: { '--c': s.color }, onclick: () => go(s.id) },
          h('span', { class: 'ct-band', style: { background: s.color } }), h('span', { class: 'ct-name' }, s.name),
          h('span', { class: 'ct-meta num' }, `${count((m) => m.subject === s.id)} drawings · ${docs.filter((d) => d.subject === s.id).length} documents`))));
        main.append(section('Courses', null, cg));
      }
      return;
    }

    if (filter === 'library') {
      main.append(h('header', { class: 'page-hero' }, h('div', null, h('h1', { class: 'page-title' }, 'Books'), h('p', { class: 'home-sub' }, 'Textbooks, problem sets and notes (PDF or EPUB). Open one to read with the tutor beside you.')), h('div', { class: 'g-actions' }, addDocBtn())));
      if (!docs.length) { main.append(emptyLibrary()); return; }
      const reading = docs.filter((d) => d.lastRead && ((d.lastPage || 1) > 1 || d.progress > 0.01)).sort((a, b) => b.lastRead - a.lastRead);
      if (reading.length) main.append(section('Continue reading', null, shelf(reading.slice(0, 8))));
      const books = docs.filter((d) => (d.kind || 'book') === 'book').sort((a, b) => a.name.localeCompare(b.name));
      const sheets = docs.filter((d) => d.kind === 'sheet').sort((a, b) => b.added - a.added);
      if (books.length) main.append(section('Books', null, shelf(books, true)));
      if (sheets.length) main.append(section('Problem sets & notes', null, shelf(sheets, true)));
      return;
    }

    // drawings (all / course / none)
    const subj = A.SU.get(filter);
    const title = filter === 'all' ? 'Drawings' : filter === 'none' ? 'No course' : subj.name;
    const search = h('input', { type: 'search', id: 'g-search', placeholder: 'Search drawings', value: query, 'aria-label': 'Search' });
    const sort = h('select', { class: 'field', id: 'g-sort', style: { margin: 0, width: 'auto', height: '40px' }, 'aria-label': 'Sort' },
      ...[['updated', 'Last edited'], ['created', 'Date created'], ['name', 'Name']].map(([v, l]) => h('option', { value: v, selected: S.sort === v }, l)));
    sort.addEventListener('change', () => { S.sort = sort.value; A.saveSettings(); render(); });
    main.append(h('header', { class: 'page-hero' },
      h('div', null, h('h1', { class: 'page-title' }, subj ? h('i', { class: 'dot big', style: { background: subj.color } }) : null, title)),
      h('div', { class: 'g-actions' }, h('div', { class: 'g-search' }, A.iconEl('search'), search), sort, h('button', { class: 'btn', onclick: importProject }, A.iconEl('import'), 'Import'), newBtn())));
    const grid = h('div', { class: 'g-grid', id: 'g-grid' });
    main.append(grid);
    const renderGrid = () => {
      const q = query.trim().toLowerCase();
      grid.innerHTML = '';
      let list = metas.filter((m) => filter === 'all' || (filter === 'none' ? !m.subject : m.subject === filter));
      list = list.filter((m) => !q || m.name.toLowerCase().includes(q)).sort(sorters[S.sort] || sorters.updated);
      if (!q) grid.append(h('button', { class: 'card new', onclick: newDrawing, 'aria-label': 'New drawing' }, h('span', { class: 'thumb', html: A.icon('plus') }), h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, 'New drawing'), h('div', { class: 'date' }, 'Choose a paper')))));
      list.forEach((m) => grid.append(card(m)));
      if (!list.length && q) grid.append(h('p', { class: 'empty-note' }, `No drawings match “${query}”.`));
    };
    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    renderGrid();
    if (subj) {
      const cd = docs.filter((d) => d.subject === subj.id);
      main.append(section('Library for ' + subj.name, addDocBtn(), cd.length ? shelf(cd) : h('p', { class: 'muted small' }, 'No books or problem sets in this course yet.')));
    }
  }
  const emptyLibrary = () => h('div', { class: 'lib-empty' },
    h('div', { class: 'lib-empty-art', html: A.icon('book') }),
    h('h3', null, 'Your reading room'),
    h('p', null, 'Add textbooks (PDF or EPUB), problem sets, solutions and lecture notes. Read them full screen, circle any passage with the Pencil, and ask the tutor about exactly that part. From Apple Books: Share › Save to Files, then add it here.'),
    h('button', { class: 'btn primary', onclick: importDocs }, A.iconEl('import'), 'Add book or PDF'));

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

  /* ---------- library: covers, shelves ---------- */
  const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
  const progressOf = (d) => (d.type === 'epub' ? d.progress || 0 : d.pages > 1 ? Math.min(1, (d.lastPage || 1) / d.pages) : 0);
  function cover(d) {
    const subj = d.subject && A.SU.get(d.subject);
    const c = h('span', { class: 'cover' + (d.kind === 'sheet' ? ' sheet' : ''), style: { '--c': subj ? subj.color : '#5b6b86' } });
    if (d.cover) c.append(h('img', { src: d.cover, alt: '' }));
    else c.append(h('span', { class: 'cover-ph' }, h('span', { class: 'cover-ph-t' }, d.name)));
    return c;
  }
  function bookCard(d) {
    const subj = d.subject && A.SU.get(d.subject);
    const p = progressOf(d);
    const more = h('button', { class: 'ibtn', 'aria-label': 'More for ' + d.name, html: A.icon('more') });
    more.addEventListener('click', (e) => { e.stopPropagation(); docMenu(d, more); });
    const el = h('div', { class: 'book', dataset: { id: d.id } },
      h('button', { class: 'book-open', onclick: () => A.emit('read', d.id), 'aria-label': 'Read ' + d.name }, cover(d)),
      h('div', { class: 'book-meta' },
        h('div', { class: 'grow' }, h('div', { class: 'book-title' }, d.name),
          h('div', { class: 'book-sub' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, d.type === 'epub' ? (d.progress ? `${Math.round(d.progress * 100)}% read` : (d.author || 'EPUB')) : d.pages ? (d.lastRead && (d.lastPage || 1) > 1 ? `Page ${d.lastPage} of ${d.pages}` : `${d.pages} page${d.pages === 1 ? '' : 's'}`) : fmtSize(d.size || 0))),
        more),
      p > 0 && d.lastRead ? h('div', { class: 'book-progress' }, h('span', { style: { width: Math.round(p * 100) + '%' } })) : null);
    return el;
  }
  const shelf = (list, wrap) => { const s = h('div', { class: 'shelf' + (wrap ? ' wrap' : '') }); list.forEach((d) => s.append(bookCard(d))); return s; };
  function continueBook(d) {
    const p = progressOf(d);
    return h('button', { class: 'cont-card cont-book', onclick: () => A.emit('read', d.id) }, cover(d),
      h('div', { class: 'cont-info' }, h('span', { class: 'cont-kicker' }, 'Reading'), h('span', { class: 'cont-title' }, d.name),
        h('span', { class: 'cont-sub num' }, d.type === 'epub' ? `${Math.round(p * 100)}% read` : d.pages ? `Page ${d.lastPage || 1} of ${d.pages} · ${Math.round(p * 100)}%` : ''),
        h('span', { class: 'book-progress wide' }, h('span', { style: { width: Math.round(p * 100) + '%' } })),
        h('span', { class: 'cont-cta' }, 'Continue reading', A.iconEl('chev'))));
  }
  function continueDrawing(m) {
    const thumb = h('span', { class: 'cont-thumb', style: { background: m.paper || '#fff' } });
    if (m.thumb) thumb.append(h('img', { src: m.thumb, alt: '' }));
    return h('button', { class: 'cont-card cont-draw', onclick: () => A.emit('open', m.id) }, thumb,
      h('div', { class: 'cont-info' }, h('span', { class: 'cont-kicker' }, 'Drawing'), h('span', { class: 'cont-title' }, m.name),
        h('span', { class: 'cont-sub' }, (A.SU.name(m.subject) ? A.SU.name(m.subject) + ' · ' : '') + 'edited ' + A.fmtDate(m.updated)),
        h('span', { class: 'cont-cta' }, 'Open', A.iconEl('chev'))));
  }
  function docMenu(d, anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('book', 'Read', () => A.emit('read', d.id));
    it('rename', 'Work on it beside a drawing', () => studyDoc(d));
    it('folder', 'Course: ' + (A.SU.name(d.subject) || 'none'), () => A.SU.pickMenu(anchor, d.subject, (sid) => { A.ST.updateDoc(d.id, { subject: sid }); render(); }));
    it('layers', d.kind === 'sheet' ? 'Show under Books' : 'Show under Problem sets', () => { A.ST.updateDoc(d.id, { kind: d.kind === 'sheet' ? 'book' : 'sheet' }); render(); });
    it('rename', 'Rename', async () => { const n = await A.dialog({ title: 'Rename', input: d.name, okText: 'Rename' }); if (n) { A.ST.updateDoc(d.id, { name: n.slice(0, 80) }); render(); } });
    box.append(h('hr'));
    it('trash', 'Delete', async () => { if (await A.dialog({ title: `Delete “${d.name}”?`, body: 'The file, its highlights and tutor conversations are removed from Axiom on this device.', okText: 'Delete', danger: true })) { await A.ST.deleteDoc(d.id); try { await A.store.deleteFile('ann_' + d.id); } catch (e) { /* none */ } render(); } }, 'danger');
    A.popover(box, anchor, { side: 'down' });
  }
  /* open the document next to the most recent drawing of its course (or a new one) */
  async function studyDoc(d) {
    if (!d) return;
    const metas = (await A.store.listMeta()).filter(Boolean);
    let target = d.subject ? metas.filter((m) => m.subject === d.subject).sort((a, b) => b.updated - a.updated)[0] : null;
    if (!target) {
      const r = await UI.newDrawingSheet({ name: 'Notes · ' + d.name.slice(0, 40), subject: d.subject });
      if (!r) { if (!A.D.doc && !A.RD.isOpen()) render(); return; }
      const doc = UI.createFromSheet(r);
      await A.store.saveDoc(doc, null);
      target = { id: doc.id };
    }
    A.ST.pendingDoc = d.id;
    A.emit('open', target.id);
  }
  UI.studyDoc = studyDoc;
  async function importDocs() {
    const f = await A.ST.pickFile();
    if (!f) return;
    const sid = A.SU.get(S.galleryFilter) ? S.galleryFilter : null;
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

  UI.mountGallery = (el) => {
    host = el;
    const rr = () => { if (!host.hidden && !D.doc) render(); };
    A.on('subjects', rr); A.on('documents', A.debounce(rr, 200));
    A.on('cover', (id) => { if (host.hidden) return; const d = A.ST.doc(id); host.querySelectorAll(`.book[data-id="${id}"] .cover, .cont-book .cover`).forEach((c) => { if (d && d.cover && !c.querySelector('img')) { c.innerHTML = ''; c.append(h('img', { src: d.cover, alt: '' })); } }); });
  };
  UI.renderGallery = render;
})();
