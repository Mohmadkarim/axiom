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
    const st = { artboard: 'none', abOrient: 'portrait', t: UI.templates[1], bg: D.papers.white, name: opts.name || 'Untitled canvas', subject: opts.subject ?? (S.galleryFilter && S.galleryFilter !== 'all' && S.galleryFilter !== 'docs' && S.galleryFilter !== 'none' ? S.galleryFilter : null) };
    const back = h('div', { class: 'modal-back' });
    const close = (v) => { back.remove(); res(v); };
    const grid = h('div', { class: 'paper-grid' });
    const bgRow = h('div', { class: 'bg-row' });
    const subjRow = h('div', { class: 'chips' });
    const nameIn = h('input', { class: 'field', id: 'new-name', value: st.name, autocomplete: 'off' });
    const abRow = h('div', { class: 'row gap wrap' });
    const draw = () => {
      grid.innerHTML = ''; bgRow.innerHTML = ''; subjRow.innerHTML = ''; abRow.innerHTML = '';
      const seg1 = h('div', { class: 'seg' }, ...[['none', 'None'], ['a4', 'A4'], ['letter', 'Letter'], ['wide', '16:9']].map(([v, l]) => h('button', { class: st.artboard === v ? 'on' : '', onclick: () => { st.artboard = v; draw(); } }, l)));
      abRow.append(seg1);
      if (st.artboard !== 'none') abRow.append(h('div', { class: 'seg' }, ...[['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([v, l]) => h('button', { class: st.abOrient === v ? 'on' : '', onclick: () => { st.abOrient = v; draw(); } }, l))));
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
    const create = () => close({ kind: 'canvas', name: nameIn.value.trim() || 'Untitled canvas', t: st.t, bg: st.t.bg || st.bg, subject: st.subject, artboard: st.artboard, abOrient: st.abOrient });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    back.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'New canvas' },
      h('h3', null, 'New canvas'),
      h('h5', null, 'Name'), nameIn,
      h('h5', null, 'Course'), subjRow,
      h('h5', null, 'Grid'), grid,
      h('h5', null, 'Background'), bgRow,
      h('h5', null, 'Artboard'), abRow,
      h('div', { class: 'row end gap', style: { marginTop: '22px' } }, h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: create }, 'Create'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.body.append(back);
  });

  /* "New notebook": paper template, colour, size, orientation, scrolling */
  UI.notebookPapers = ['#ffffff', '#fbf8ef', '#f4efe1', '#eef3f8', '#f0f4ec', '#fdf1f1', '#2a2e36', '#15171c'];
  const drawPageThumb = (cv, tpl, color, fmt, orient) => {
    const [pw, ph] = D.formatSize(fmt, orient);
    const H = 150, W = Math.round((H * pw) / ph);
    cv.width = W * 2; cv.height = H * 2;
    const ctx = cv.getContext('2d');
    const k = (H * 2) / ph;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = color; ctx.fillRect(0, 0, pw, ph);
    R.drawTemplate(ctx, [0, 0, pw, ph], tpl, color, 1.2 / k);
  };
  UI.newNotebookSheet = (opts = {}) => new Promise((res) => {
    const last = S.lastNotebook || {};
    const st = { tpl: last.tpl || 'lined', color: last.color || '#ffffff', size: last.size || 'a4', orient: last.orient || 'portrait', scroll: last.scroll || 'vertical', name: opts.name || 'Untitled notebook', subject: opts.subject ?? (A.SU.get(S.galleryFilter) ? S.galleryFilter : null) };
    const back = h('div', { class: 'modal-back' });
    const close = (v) => { back.remove(); res(v); };
    const grid = h('div', { class: 'paper-grid tpl-grid' });
    const colorRow = h('div', { class: 'bg-row' });
    const subjRow = h('div', { class: 'chips' });
    const sizeRow = h('div', { class: 'seg' });
    const orientSeg = h('div', { class: 'seg' });
    const scrollSeg = h('div', { class: 'seg' });
    const nameIn = h('input', { class: 'field', id: 'nb-name', value: st.name, autocomplete: 'off' });
    const draw = () => {
      [grid, colorRow, subjRow, sizeRow, orientSeg, scrollSeg].forEach((e) => (e.innerHTML = ''));
      const COMMON = ['blank', 'lined', 'grid', 'dot', 'graph', 'cornell'];
      R.templates.filter((t) => st.more || COMMON.includes(t.id) || t.id === st.tpl).forEach((t) => {
        const cv = h('canvas');
        drawPageThumb(cv, t.id, st.color, st.size, st.orient);
        grid.append(h('button', { class: 'paper-opt page' + (t.id === st.tpl ? ' on' : ''), onclick: () => { st.tpl = t.id; draw(); } }, cv, t.name));
      });
      if (!st.more) grid.append(h('button', { class: 'paper-opt page more', onclick: () => { st.more = true; draw(); } }, h('span', { class: 'more-ic', html: A.icon('more') }), 'More papers'));
      UI.notebookPapers.forEach((c) => colorRow.append(h('button', { class: c === st.color ? 'on' : '', style: { background: c }, 'aria-label': 'Paper ' + c, onclick: () => { st.color = c; draw(); } })));
      ['a4', 'letter', 'a5'].forEach((f) => sizeRow.append(h('button', { class: st.size === f ? 'on' : '', onclick: () => { st.size = f; draw(); } }, D.formats[f].name.replace('US ', ''))));
      [['portrait', 'Portrait'], ['landscape', 'Landscape']].forEach(([v, l]) => orientSeg.append(h('button', { class: st.orient === v ? 'on' : '', onclick: () => { st.orient = v; draw(); } }, l)));
      subjRow.append(h('button', { class: 'chip' + (!st.subject ? ' on' : ''), onclick: () => { st.subject = null; draw(); } }, 'None'));
      A.SU.list().forEach((sj) => subjRow.append(h('button', { class: 'chip' + (st.subject === sj.id ? ' on' : ''), onclick: () => { st.subject = sj.id; draw(); } }, h('i', { class: 'dot', style: { background: sj.color } }), sj.name)));
      subjRow.append(h('button', { class: 'chip ghost', onclick: async () => { const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); const sj = n && A.SU.add(n); if (sj) { st.subject = sj.id; draw(); } } }, '+ Course'));
    };
    draw();
    const create = () => {
      S.lastNotebook = { tpl: st.tpl, color: st.color, size: st.size, orient: st.orient, scroll: st.scroll }; A.saveSettings();
      close({ kind: 'notebook', name: nameIn.value.trim() || 'Untitled notebook', tpl: st.tpl, bg: st.color, size: st.size, orient: st.orient, scroll: st.scroll, subject: st.subject });
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    back.append(h('div', { class: 'modal wide', role: 'dialog', 'aria-label': 'New notebook' },
      h('h3', null, 'New notebook'),
      h('div', { class: 'nb-form' },
        h('div', null, h('h5', null, 'Name'), nameIn, h('h5', null, 'Course'), subjRow),
        h('div', null, h('h5', null, 'Page'), h('div', { class: 'row gap wrap' }, sizeRow, orientSeg))),
      h('h5', null, 'Paper'), grid,
      h('h5', null, 'Paper colour'), colorRow,
      h('div', { class: 'row end gap', style: { marginTop: '22px' } }, h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: create }, 'Create notebook'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.body.append(back);
    setTimeout(() => nameIn.select(), 50);
  });

  UI.createFromSheet = (r) => {
    if (r.kind === 'notebook') {
      const doc = D.create({ name: r.name, bg: r.bg, kind: 'notebook', page: { template: r.tpl, color: r.bg, size: r.size, orient: r.orient, scroll: r.scroll } });
      doc.subject = r.subject || null;
      return doc;
    }
    const doc = D.create({ name: r.name, bg: r.bg, grid: r.t.grid });
    if (r.artboard && r.artboard !== 'none') {
      const [w, hh] = D.formatSize(r.artboard, r.abOrient || 'portrait');
      doc.artboards = [{ id: A.uid(), name: D.formats[r.artboard].name + ' 1', fmt: r.artboard, orient: r.abOrient || 'portrait', x: -w / 2, y: -hh / 2, w, h: hh }];
    }
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
    if (filter === 'all') filter = 'canvases';
    if (!['home', 'notebooks', 'canvases', 'favorites', 'library', 'none'].includes(filter) && !A.SU.get(filter)) filter = 'home';
    const isNb = (m) => m.kind === 'notebook';
    const notebooks = metas.filter(isNb), canvases = metas.filter((m) => !isNb(m));
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
    side.append(item('home', 'Home', null, null, 'spark'), item('library', 'Books', docs.length, null, 'book'), item('notebooks', 'Notebooks', notebooks.length, null, 'notebook'), item('canvases', 'Canvases', canvases.length, null, 'canvas'));
    if (metas.some((m) => m.fav)) side.append(item('favorites', 'Favorites', metas.filter((m) => m.fav).length, null, 'fav'));
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
    const newBtn = () => h('button', { class: 'btn', onclick: newDrawing }, A.iconEl('canvas'), 'New canvas');
    const newNbBtn = () => h('button', { class: 'btn primary', onclick: newNotebook }, A.iconEl('plus'), 'New notebook');
    /* one primary "New" with the choices behind it */
    const newMenuBtn = (label = 'New') => {
      const b = h('button', { class: 'btn primary' }, A.iconEl('plus'), label);
      b.addEventListener('click', () => {
        const box = h('div', { class: 'menu' });
        const it = (icon, l, sub, fn) => box.append(h('button', { onclick: () => { A.closePopovers(); fn(); } }, A.iconEl(icon), h('span', { class: 'grow' }, l, h('small', null, sub))));
        it('notebook', 'Notebook', 'Pages to write on', newNotebook);
        it('canvas', 'Canvas', 'Infinite space to think', newDrawing);
        it('book', 'Book or PDF', 'Read with the tutor', importDocs);
        box.append(h('hr'));
        it('import', 'Import Axiom file', '.axiom project', importProject);
        A.popover(box, b, { side: 'down' });
      });
      return b;
    };
    const sortBtn = () => {
      const labels = { updated: 'Last edited', created: 'Date created', name: 'Name' };
      const b = h('button', { class: 'btn ghost-btn', title: 'Sort' }, A.iconEl('chevdown'), labels[S.sort] || labels.updated);
      b.addEventListener('click', () => {
        const box = h('div', { class: 'menu' });
        Object.entries(labels).forEach(([v, l]) => box.append(h('button', { class: (S.sort || 'updated') === v ? 'on' : '', onclick: () => { A.closePopovers(); S.sort = v; A.saveSettings(); render(); } }, A.iconEl((S.sort || 'updated') === v ? 'check' : 'minus'), l)));
        A.popover(box, b, { side: 'down' });
      });
      return b;
    };
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
        h('div', { class: 'g-actions' }, newMenuBtn())));
      const lastNb = notebooks.slice().sort(sorters.updated)[0];
      const lastCv = canvases.slice().sort(sorters.updated)[0];
      const lastBook = docs.filter((d) => d.lastRead).sort((a, b) => b.lastRead - a.lastRead)[0];
      if (lastNb || lastCv || lastBook) {
        const row = h('div', { class: 'cont-row' });
        if (lastBook) row.append(continueBook(lastBook));
        if (lastNb) row.append(continueDrawing(lastNb));
        if (lastCv && row.childElementCount < 3) row.append(continueDrawing(lastCv));
        main.append(section('Continue', null, row));
      }
      const recentNb = notebooks.slice().sort(sorters.updated).slice(0, 5);
      main.append(section('Notebooks', h('button', { class: 'link-btn', onclick: () => go('notebooks') }, recentNb.length ? 'See all' : ''),
        recentNb.length ? (() => { const g = h('div', { class: 'g-grid nb-grid' }); recentNb.forEach((m) => g.append(card(m))); return g; })()
          : h('div', { class: 'lib-empty slim' }, h('div', { class: 'lib-empty-art', html: A.icon('notebook') }), h('div', null, h('h3', null, 'Take notes like on paper'), h('p', null, 'Notebooks are pages you scroll through: lined, grid, dot, Cornell and more, with lecture recording, tape for active recall, text boxes and the tutor.')), newNbBtn())));
      const recentCv = canvases.slice().sort(sorters.updated).slice(0, 4);
      if (recentCv.length) { const g = h('div', { class: 'g-grid' }); recentCv.forEach((m) => g.append(card(m))); main.append(section('Canvases', h('button', { class: 'link-btn', onclick: () => go('canvases') }, 'See all'), g)); }
      const shelfDocs = docs.slice().sort((a, b) => (b.lastRead || b.added) - (a.lastRead || a.added)).slice(0, 8);
      main.append(section('Books', h('button', { class: 'link-btn', onclick: () => go('library') }, shelfDocs.length ? 'Open Books' : ''), shelfDocs.length ? shelf(shelfDocs) : emptyLibrary()));
      if (A.SU.list().length) {
        const cg = h('div', { class: 'course-grid' });
        A.SU.list().forEach((s) => cg.append(h('button', { class: 'course-tile', style: { '--c': s.color }, onclick: () => go(s.id) },
          h('span', { class: 'ct-band', style: { background: s.color } }), h('span', { class: 'ct-name' }, s.name),
          h('span', { class: 'ct-meta num' }, `${count((m) => m.subject === s.id && isNb(m))} notebooks · ${count((m) => m.subject === s.id && !isNb(m))} canvases · ${docs.filter((d) => d.subject === s.id).length} books`))));
        main.append(section('Courses', null, cg));
      }
      return;
    }

    if (filter === 'library') {
      main.append(h('header', { class: 'page-hero' }, h('div', null, h('h1', { class: 'page-title' }, 'Books'), h('p', { class: 'home-sub' }, 'Textbooks, problem sets and notes (PDF or EPUB). Open one to read with the tutor beside you.')), h('div', { class: 'g-actions' }, goalRing(), h('button', { class: 'btn primary', onclick: importDocs }, A.iconEl('plus'), 'Add'))));
      if (!docs.length) { main.append(emptyLibrary()); return; }
      const reading = docs.filter((d) => !d.finished && d.lastRead && ((d.lastPage || 1) > 1 || d.progress > 0.01)).sort((a, b) => b.lastRead - a.lastRead);
      if (reading.length) main.append(section('Continue reading', null, shelf(reading.slice(0, 8))));
      const books = docs.filter((d) => !d.finished && (d.kind || 'book') === 'book').sort((a, b) => a.name.localeCompare(b.name));
      const sheets = docs.filter((d) => !d.finished && d.kind === 'sheet').sort((a, b) => b.added - a.added);
      const done = docs.filter((d) => d.finished).sort((a, b) => b.finished - a.finished);
      if (books.length) main.append(section('Books', null, shelf(books, true)));
      if (sheets.length) main.append(section('Problem sets & notes', null, shelf(sheets, true)));
      if (done.length) main.append(section('Finished', null, shelf(done, true)));
      return;
    }

    // notebooks / canvases / favorites / course / no course
    const subj = A.SU.get(filter);
    const title = { notebooks: 'Notebooks', canvases: 'Canvases', favorites: 'Favorites', none: 'No course' }[filter] || subj.name;
    const search = h('input', { type: 'search', id: 'g-search', placeholder: 'Search ' + (filter === 'notebooks' ? 'notebooks' : filter === 'canvases' ? 'canvases' : 'notebooks and canvases'), value: query, 'aria-label': 'Search' });
    const acts = filter === 'notebooks' ? [h('button', { class: 'btn primary', onclick: newNotebook }, A.iconEl('plus'), 'New')] : filter === 'canvases' ? [h('button', { class: 'btn primary', onclick: newDrawing }, A.iconEl('plus'), 'New')] : [newMenuBtn()];
    main.append(h('header', { class: 'page-hero' },
      h('div', null, h('h1', { class: 'page-title' }, subj ? h('i', { class: 'dot big', style: { background: subj.color } }) : null, title)),
      h('div', { class: 'g-actions' }, ...acts)));
    main.append(h('div', { class: 'g-tools' }, h('div', { class: 'g-search' }, A.iconEl('search'), search), sortBtn()));
    const body = h('div');
    main.append(body);
    const renderGrid = () => {
      const q = query.trim().toLowerCase();
      body.innerHTML = '';
      let list = metas.filter((m) => filter === 'notebooks' ? isNb(m) : filter === 'canvases' ? !isNb(m) : filter === 'favorites' ? m.fav : filter === 'none' ? !m.subject : m.subject === filter);
      list = list.filter((m) => !q || m.name.toLowerCase().includes(q)).sort(sorters[S.sort] || sorters.updated);
      const grid = (items, nb, withNew) => {
        const g = h('div', { class: 'g-grid' + (nb ? ' nb-grid' : ''), id: 'g-grid' });
        if (withNew && !q && !items.length) g.append(h('button', { class: 'card new' + (nb ? ' nbcard' : ''), onclick: nb ? newNotebook : newDrawing, 'aria-label': nb ? 'New notebook' : 'New canvas' }, h('span', { class: 'thumb', html: A.icon('plus') }), h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, nb ? 'New notebook' : 'New canvas'), h('div', { class: 'date' }, nb ? 'Choose a paper' : 'Infinite canvas')))));
        items.forEach((m) => g.append(card(m)));
        return g;
      };
      if (filter === 'notebooks' || filter === 'canvases') body.append(grid(list, filter === 'notebooks', true));
      else {
        const nbs = list.filter(isNb), cvs = list.filter((m) => !isNb(m));
        if (nbs.length || subj) body.append(section('Notebooks', null, grid(nbs, true, !!subj)));
        if (cvs.length || subj) body.append(section('Canvases', null, grid(cvs, false, !!subj)));
      }
      if (!list.length && q) body.append(h('p', { class: 'empty-note' }, `Nothing matches “${query}”.`));
    };
    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    renderGrid();
    if (subj) {
      const cd = docs.filter((d) => d.subject === subj.id);
      main.append(section('Books for ' + subj.name, addDocBtn(), cd.length ? shelf(cd) : h('p', { class: 'muted small' }, 'No books or problem sets in this course yet.')));
    }
  }
  /* daily reading goal ring (minutes read today vs goal) */
  function goalRing() {
    const day = new Date().toISOString().slice(0, 10);
    const mins = Math.round(((S.readLog || {})[day] || 0) + (S.readStart ? (Date.now() - S.readStart) / 60000 : 0));
    const goal = S.readGoal || 15;
    const p = Math.min(1, mins / goal), R0 = 15, C = 2 * Math.PI * R0;
    const b = h('button', { class: 'goal', title: 'Daily reading goal (tap to change)', onclick: async () => { const v = await A.dialog({ title: 'Daily reading goal (minutes)', input: String(goal), okText: 'Save' }); const n = parseInt(v, 10); if (n > 0) { S.readGoal = Math.min(600, n); A.saveSettings(); render(); } } });
    b.innerHTML = `<svg viewBox="0 0 36 36" width="36" height="36"><circle cx="18" cy="18" r="${R0}" fill="none" stroke="var(--line-strong)" stroke-width="3.5"/><circle cx="18" cy="18" r="${R0}" fill="none" stroke="${p >= 1 ? 'var(--ok)' : 'var(--accent)'}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 18 18)"/></svg>`;
    b.append(h('span', null, h('b', { class: 'num' }, `${mins} min`), h('small', null, `of your ${goal}-minute goal today`)));
    return b;
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
    const nb = m.kind === 'notebook';
    const thumb = h('span', { class: 'thumb', style: { background: m.paper || '#fff' } });
    if (m.thumb) thumb.append(h('img', { src: m.thumb, alt: '' }));
    if (m.fav) thumb.append(h('i', { class: 'fav-badge', html: A.icon('fav') }));
    if (nb && m.pages) thumb.append(h('span', { class: 'pg-badge num' }, m.pages + (m.pages === 1 ? ' page' : ' pages')));
    if (m.rec) thumb.append(h('span', { class: 'rec-badge', html: A.icon('mic') }));
    const open = h('button', { class: 'card-open', style: { display: 'contents' }, onclick: () => A.emit('open', m.id), 'aria-label': 'Open ' + m.name }, thumb);
    const more = h('button', { class: 'ibtn', 'aria-label': 'More for ' + m.name, html: A.icon('more') });
    more.addEventListener('click', (e) => { e.stopPropagation(); cardMenu(m, more); });
    const subj = m.subject && A.SU.get(m.subject);
    const el = h('div', { class: 'card' + (nb ? ' nbcard' : '') }, open, h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, m.name),
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
    it('fav', m.fav ? 'Remove from favourites' : 'Add to favourites', async () => { const doc = await A.store.loadDoc(m.id); if (!doc) return; doc.fav = !m.fav; await A.store.saveDoc(doc, m.thumb); render(); });
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
      const ok = await A.dialog({ title: `Delete “${m.name}”?`, body: 'It moves to Recently Deleted in Settings, where you can restore it for 30 days.', okText: 'Delete', danger: true });
      if (ok) { await UI.trashDoc(m); render(); }
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
          h('div', { class: 'book-sub' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, d.finished ? '✓ Finished' : d.type === 'epub' ? (d.progress ? `${Math.round(d.progress * 100)}% read` : (d.author || 'EPUB')) : d.pages ? (d.lastRead && (d.lastPage || 1) > 1 ? `Page ${d.lastPage} of ${d.pages}` : `${d.pages} page${d.pages === 1 ? '' : 's'}`) : fmtSize(d.size || 0))),
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
    const thumb = h('span', { class: 'cont-thumb' + (m.kind === 'notebook' ? ' nb' : ''), style: { background: m.paper || '#fff' } });
    if (m.thumb) thumb.append(h('img', { src: m.thumb, alt: '' }));
    return h('button', { class: 'cont-card cont-draw', onclick: () => A.emit('open', m.id) }, thumb,
      h('div', { class: 'cont-info' }, h('span', { class: 'cont-kicker' }, m.kind === 'notebook' ? 'Notebook' : 'Canvas'), h('span', { class: 'cont-title' }, m.name),
        h('span', { class: 'cont-sub' }, (A.SU.name(m.subject) ? A.SU.name(m.subject) + ' · ' : '') + 'edited ' + A.fmtDate(m.updated)),
        h('span', { class: 'cont-cta' }, 'Open', A.iconEl('chev'))));
  }
  function docMenu(d, anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('book', 'Read', () => A.emit('read', d.id));
    it('rename', 'Work on it beside a drawing', () => studyDoc(d));
    it('folder', 'Course: ' + (A.SU.name(d.subject) || 'none'), () => A.SU.pickMenu(anchor, d.subject, (sid) => { A.ST.updateDoc(d.id, { subject: sid }); render(); }));
    it('check', d.finished ? 'Mark as unfinished' : 'Mark as finished', () => { A.ST.updateDoc(d.id, { finished: d.finished ? null : Date.now() }); render(); });
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

  async function newNotebook() {
    const r = await UI.newNotebookSheet();
    if (!r) return;
    const doc = UI.createFromSheet(r);
    await A.store.saveDoc(doc, null);
    A.emit('open', doc.id);
  }
  UI.newNotebook = newNotebook;
  /* Recently Deleted: drawings are kept for 30 days before they are removed */
  UI.trashDoc = async (m) => {
    const doc = await A.store.loadDoc(m.id);
    if (doc) {
      const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
      await A.store.saveFile('trash_' + m.id, blob);
      S.trash = (S.trash || []).filter((t) => t.id !== m.id).concat([{ id: m.id, name: m.name, kind: m.kind, deleted: Date.now(), thumb: m.thumb }]);
      A.saveSettings();
    }
    await A.store.deleteDoc(m.id);
  };
  UI.restoreDoc = async (id) => {
    const b = await A.store.loadFile('trash_' + id, 'application/json');
    if (!b) return false;
    const doc = JSON.parse(await b.text());
    await A.store.saveDoc(doc, (S.trash.find((t) => t.id === id) || {}).thumb || null);
    await A.store.deleteFile('trash_' + id);
    S.trash = S.trash.filter((t) => t.id !== id); A.saveSettings();
    return true;
  };
  UI.purgeTrash = async (all = false) => {
    const keep = [];
    for (const t of S.trash || []) {
      if (all || Date.now() - t.deleted > 30 * 864e5) { try { await A.store.deleteFile('trash_' + t.id); } catch (e) { /* ignore */ } } else keep.push(t);
    }
    S.trash = keep; A.saveSettings();
  };
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
