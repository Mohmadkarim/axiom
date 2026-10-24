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

  /* ---------- folders, one set per section (notebooks, canvases, books) ---------- */
  const FD = (UI.folders = {
    list: (section) => (S.folders || []).filter((f) => f.section === section),
    get: (id) => (S.folders || []).find((f) => f.id === id),
    add: (section, name) => { const f = { id: A.uid(), section, name: name.slice(0, 40), created: Date.now() }; S.folders = (S.folders || []).concat([f]); A.saveSettings(); return f; },
    rename: (id, name) => { const f = FD.get(id); if (f) { f.name = name.slice(0, 40); A.saveSettings(); } },
    remove: (id) => { S.folders = (S.folders || []).filter((f) => f.id !== id); if (S.openFolder === id) S.openFolder = null; A.saveSettings(); },
  });
  const sectionOf = (m) => (m.type ? 'books' : m.kind === 'notebook' ? 'notebooks' : 'canvases');
  /* move a notebook/canvas (meta from listMeta) or a book (doc meta) into a folder */
  async function moveToFolder(m, folderId) {
    if (m.type) { A.ST.updateDoc(m.id, { folder: folderId }); return; }
    const doc = await A.store.loadDoc(m.id);
    if (!doc) return;
    doc.folder = folderId;
    await A.store.saveDoc(doc, m.thumb);
  }
  function folderMenu(m, anchor, after) {
    const section = sectionOf(m);
    const box = h('div', { class: 'menu' });
    box.append(h('div', { class: 'sub' }, 'Move to folder'));
    const it = (icon, label, fn, on) => box.append(h('button', { class: on ? 'on' : '', onclick: async () => { A.closePopovers(); await fn(); after(); } }, A.iconEl(icon), label));
    it('minus', 'No folder', () => moveToFolder(m, null), !m.folder);
    FD.list(section).forEach((f) => it('folder', f.name, () => moveToFolder(m, f.id), m.folder === f.id));
    box.append(h('hr'));
    it('plus', 'New folder…', async () => { const n = await A.dialog({ title: 'New folder', input: '', okText: 'Create' }); if (n && n.trim()) { const f = FD.add(section, n.trim()); await moveToFolder(m, f.id); } });
    A.popover(box, anchor, { side: 'down' });
  }
  UI.folderMenu = folderMenu;
  /* folder tiles row + breadcrumb for a section page */
  function folderBar(section, items, rerender) {
    const open = S.openFolder && FD.get(S.openFolder) && FD.get(S.openFolder).section === section ? FD.get(S.openFolder) : null;
    if (open) {
      return h('div', { class: 'fd-crumb' },
        h('button', { class: 'fd-back', onclick: () => { S.openFolder = null; A.saveSettings(); rerender(); } }, A.iconEl('chev'), { notebooks: 'Notebooks', canvases: 'Canvases', books: 'Books' }[section]),
        h('span', { class: 'fd-sep' }, '/'),
        h('span', { class: 'fd-cur' }, A.iconEl('folder'), open.name),
        (() => { const b = h('button', { class: 'ibtn fd-more', 'aria-label': 'Folder options', html: A.icon('more') }); b.addEventListener('click', () => {
          const box = h('div', { class: 'menu' });
          box.append(h('button', { onclick: async () => { A.closePopovers(); const n = await A.dialog({ title: 'Rename folder', input: open.name, okText: 'Rename' }); if (n && n.trim()) { FD.rename(open.id, n.trim()); rerender(); } } }, A.iconEl('rename'), 'Rename'));
          box.append(h('button', { class: 'danger', onclick: async () => { A.closePopovers(); if (!(await A.dialog({ title: `Delete the folder “${open.name}”?`, body: 'Everything inside moves back to the section. Nothing is deleted.', okText: 'Delete folder', danger: true }))) return; for (const m of items.filter((x) => x.folder === open.id)) await moveToFolder(m, null); FD.remove(open.id); rerender(); } }, A.iconEl('trash'), 'Delete folder'));
          A.popover(box, b, { side: 'down' });
        }); return b; })());
    }
    const row = h('div', { class: 'fd-row' });
    FD.list(section).forEach((f) => {
      const n = items.filter((x) => x.folder === f.id).length;
      row.append(h('button', { class: 'fd-tile', onclick: () => { S.openFolder = f.id; A.saveSettings(); rerender(); } }, h('span', { class: 'fd-ic', html: A.icon('folder') }), h('span', { class: 'fd-name' }, f.name), h('span', { class: 'fd-n num' }, String(n))));
    });
    row.append(h('button', { class: 'fd-tile add', onclick: async () => { const n = await A.dialog({ title: 'New folder', input: '', okText: 'Create' }); if (n && n.trim()) { FD.add(section, n.trim()); rerender(); } } }, h('span', { class: 'fd-ic', html: A.icon('plus') }), h('span', { class: 'fd-name' }, 'New folder')));
    return row;
  }
  const inFolderView = (section, m) => {
    const open = S.openFolder && FD.get(S.openFolder) && FD.get(S.openFolder).section === section ? S.openFolder : null;
    return open ? m.folder === open : !m.folder || !FD.get(m.folder);
  };

  /* long-press that never fires while scrolling: cancelled by movement, pointercancel or scroll */
  UI.longPress = (el, fn, clickEl = el) => {
    let t = 0, fired = false, x0 = 0, y0 = 0;
    const cancel = () => { clearTimeout(t); t = 0; el.classList.remove('pressing'); removeEventListener('scroll', cancel, true); };
    el.addEventListener('pointerdown', (e) => {
      fired = false; x0 = e.clientX; y0 = e.clientY;
      el.classList.add('pressing');
      addEventListener('scroll', cancel, { capture: true, passive: true });
      t = setTimeout(() => { t = 0; fired = true; el.classList.remove('pressing'); fn(); }, 600);
    });
    el.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => el.addEventListener(n, cancel));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    clickEl.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
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
    const go = (id) => { S.galleryFilter = id; S.openFolder = null; A.saveSettings(); query = ''; render(); };

    // sidebar
    const side = h('nav', { class: 'g-side', 'aria-label': 'Sections' });
    side.append(h('div', { class: 'g-brand' }, h('span', { class: 'wordmark' }, 'Axiom', h('i', null, '.'))));
    const item = (id, label, n, dotColor, icon) => {
      const b = h('button', { class: 'g-nav' + (filter === id ? ' on' : ''), onclick: () => go(id) },
        dotColor ? h('i', { class: 'dot', style: { background: dotColor } }) : A.iconEl(icon || 'gallery'), h('span', { class: 'grow' }, label), n != null ? h('span', { class: 'g-count num' }, String(n)) : null);
      return b;
    };
    side.append(item('home', 'Home', null, null, 'home'), item('library', 'Books', docs.length, null, 'book'), item('notebooks', 'Notebooks', notebooks.length, null, 'notebook'), item('canvases', 'Canvases', canvases.length, null, 'infinite'));
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
    if (A.SU.list().length && none) side.append(item('none', 'Unfiled', none, null, 'tray'));
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
      const b = h('button', { class: 'btn ghost-btn sort-btn', title: 'Sort' }, labels[S.sort] || labels.updated, A.iconEl('chevdown'));
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
      main.append(A.PL.todaySection());
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
      main.append(section('Books', h('button', { class: 'link-btn', onclick: () => go('library') }, shelfDocs.length ? 'See all' : ''), shelfDocs.length ? shelf(shelfDocs) : emptyLibrary()));
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
      main.append(h('header', { class: 'page-hero' }, h('div', null, h('h1', { class: 'page-title' }, 'Books')), h('div', { class: 'g-actions' }, goalRing(), h('button', { class: 'btn primary', onclick: importDocs }, A.iconEl('plus'), 'Add'))));
      if (!docs.length) { main.append(emptyLibrary()); return; }
      const bf = S.booksFilter || 'all';
      const search = h('input', { type: 'search', placeholder: 'Search', value: query, 'aria-label': 'Search books' });
      const seg = h('div', { class: 'seg' }, ...[['all', 'All'], ['book', 'Books'], ['sheet', 'Problem sets'], ['done', 'Finished']].map(([v, l]) => h('button', { class: bf === v ? 'on' : '', onclick: () => { S.booksFilter = v; A.saveSettings(); render(); } }, l)));
      main.append(h('div', { class: 'g-tools' }, h('div', { class: 'g-search' }, A.iconEl('search'), search), seg));
      const body = h('div');
      main.append(body);
      const draw = () => {
        body.innerHTML = '';
        const q = query.trim().toLowerCase();
        const atRoot = !(S.openFolder && FD.get(S.openFolder));
        if (!q && bf === 'all' && atRoot) {
          const reading = docs.filter((d) => !d.finished && d.lastRead && ((d.lastPage || 1) > 1 || d.progress > 0.01)).sort((x, y) => y.lastRead - x.lastRead);
          if (reading.length) {
            body.append(h('div', { class: 'bk-hero' }, continueBook(reading[0]), reading.length > 1 ? h('div', { class: 'bk-up' }, h('div', { class: 'bk-up-h' }, 'Also reading'), ...reading.slice(1, 4).map((d) => h('button', { class: 'bk-mini', onclick: () => A.emit('read', d.id) }, cover(d), h('span', { class: 'grow' }, h('b', null, d.title || d.name), h('small', { class: 'num' }, d.type === 'epub' ? `${Math.round((d.progress || 0) * 100)}%` : `p. ${d.lastPage || 1} of ${d.pages || '?'}`))))) : null));
          }
        }
        body.append(folderBar('books', docs, draw));
        let list = docs.filter((d) => (bf === 'done' ? d.finished : bf === 'all' ? true : !d.finished && (d.kind || 'book') === bf));
        if (!q) list = list.filter((d) => inFolderView('books', d));
        if (q) list = list.filter((d) => d.name.toLowerCase().includes(q) || (d.author || '').toLowerCase().includes(q));
        list.sort((x, y) => (y.lastRead || y.added) - (x.lastRead || x.added));
        const grid = h('div', { class: 'bk-grid' });
        list.forEach((d) => grid.append(bookCard(d)));
        if (!list.length) body.append(h('p', { class: 'empty-note' }, q ? `Nothing matches “${query}”.` : bf === 'done' ? 'Books you mark as finished appear here.' : 'Nothing here yet.'));
        else body.append(grid);
      };
      search.addEventListener('input', () => { query = search.value; draw(); });
      draw();
      return;
    }

    // notebooks / canvases / favorites / course / no course
    const subj = A.SU.get(filter);
    const title = { notebooks: 'Notebooks', canvases: 'Canvases', favorites: 'Favorites', none: 'Unfiled' }[filter] || subj.name;
    const search = h('input', { type: 'search', id: 'g-search', placeholder: 'Search', value: query, 'aria-label': 'Search' });
    const acts = filter === 'notebooks' ? [h('button', { class: 'btn primary', onclick: newNotebook }, A.iconEl('plus'), 'New')] : filter === 'canvases' ? [h('button', { class: 'btn primary', onclick: newDrawing }, A.iconEl('plus'), 'New')] : (subj && !metas.some((m) => m.subject === filter) && !docs.some((d) => d.subject === filter)) ? [] : [newMenuBtn()];
    main.append(h('header', { class: 'page-hero' },
      h('div', null, h('h1', { class: 'page-title' }, subj ? h('i', { class: 'dot big', style: { background: subj.color } }) : null, title)),
      h('div', { class: 'g-actions' }, ...acts)));
    if (subj) main.append(A.PL.courseSection(subj.id));
    const anyHere = metas.some((m) => filter === 'notebooks' ? isNb(m) : filter === 'canvases' ? !isNb(m) : filter === 'favorites' ? m.fav : filter === 'none' ? !m.subject : m.subject === filter);
    if (anyHere) main.append(h('div', { class: 'g-tools' }, h('div', { class: 'g-search' }, A.iconEl('search'), search), sortBtn()));
    const body = h('div');
    main.append(body);
    const renderGrid = () => {
      const q = query.trim().toLowerCase();
      body.innerHTML = '';
      let list = metas.filter((m) => filter === 'notebooks' ? isNb(m) : filter === 'canvases' ? !isNb(m) : filter === 'favorites' ? m.fav : filter === 'none' ? !m.subject : m.subject === filter);
      if (filter === 'notebooks' || filter === 'canvases') {
        const sectionAll = list;
        body.append(folderBar(filter, sectionAll, renderGrid));
        if (!q) list = list.filter((m) => inFolderView(filter, m));
      }
      list = list.filter((m) => !q || m.name.toLowerCase().includes(q)).sort(sorters[S.sort] || sorters.updated);
      const grid = (items, nb, withNew) => {
        const g = h('div', { class: 'g-grid' + (nb ? ' nb-grid' : ''), id: 'g-grid' });
        if (withNew && !q && !items.length) g.append(h('button', { class: 'card new' + (nb ? ' nbcard' : ''), onclick: nb ? newNotebook : newDrawing, 'aria-label': nb ? 'New notebook' : 'New canvas' }, h('span', { class: 'thumb', html: A.icon('plus') }), h('div', { class: 'meta' }, h('div', { class: 't' }, h('div', { class: 'name' }, nb ? 'New notebook' : 'New canvas'), h('div', { class: 'date' }, nb ? 'Choose a paper' : 'Infinite canvas')))));
        items.forEach((m) => g.append(card(m)));
        return g;
      };
      if (filter === 'notebooks' || filter === 'canvases') body.append(grid(list, filter === 'notebooks', !S.openFolder));
      else if (!list.length && !q) {
        body.append(h('div', { class: 'course-empty' },
          h('h3', null, subj ? `Nothing in ${subj.name} yet` : filter === 'favorites' ? 'No favourites yet' : 'Everything has a course'),
          h('p', null, subj ? 'Start a notebook for lectures, a canvas for problem solving, or add the course textbook.' : filter === 'favorites' ? 'Mark notebooks and canvases as favourites from their ••• menu.' : 'Notebooks and canvases without a course appear here.'),
          subj ? h('div', { class: 'ce-acts' },
            h('button', { class: 'btn primary', onclick: newNotebook }, A.iconEl('notebook'), 'New notebook'),
            h('button', { class: 'btn', onclick: newDrawing }, A.iconEl('infinite'), 'New canvas'),
            h('button', { class: 'btn', onclick: importDocs }, A.iconEl('book'), 'Add textbook')) : null));
      } else {
        const nbs = list.filter(isNb), cvs = list.filter((m) => !isNb(m));
        if (nbs.length) body.append(section('Notebooks', null, grid(nbs, true, false)));
        if (cvs.length) body.append(section('Canvases', null, grid(cvs, false, false)));
      }
      if (!list.length && q) body.append(h('p', { class: 'empty-note' }, `Nothing matches “${query}”.`));
    };
    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    renderGrid();
    if (subj) {
      const cd = docs.filter((d) => d.subject === subj.id);
      if (cd.length) main.append(section('Books for ' + subj.name, null, shelf(cd)));
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
    UI.longPress(thumb, () => cardMenu(m, thumb), open);
    return el;
  }

  function cardMenu(m, anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('chev', 'Open', () => A.emit('open', m.id));
    it('folder', 'Move to folder…', () => folderMenu(m, anchor, render));
    it('fav', m.fav ? 'Remove from favourites' : 'Add to favourites', async () => { const doc = await A.store.loadDoc(m.id); if (!doc) return; doc.fav = !m.fav; await A.store.saveDoc(doc, m.thumb); render(); });
    it('moveto', 'Course: ' + (A.SU.name(m.subject) || 'none'), () => A.SU.pickMenu(anchor, m.subject, async (sid) => {
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
    else c.append(h('span', { class: 'cover-ph' }, h('span', { class: 'cover-ph-t' }, d.title || d.name)));
    return c;
  }
  function bookCard(d) {
    const subj = d.subject && A.SU.get(d.subject);
    const p = progressOf(d);
    const more = h('button', { class: 'ibtn bk-more', 'aria-label': 'More for ' + d.name, html: A.icon('more') });
    more.addEventListener('click', (e) => { e.stopPropagation(); docMenu(d, more); });
    const openBtn = h('button', { class: 'book-open', onclick: () => A.emit('read', d.id), 'aria-label': 'Read ' + d.name }, cover(d));
    UI.longPress(openBtn, () => docMenu(d, openBtn));
    const el = h('div', { class: 'book', dataset: { id: d.id } },
      openBtn,
      h('div', { class: 'book-meta' },
        h('div', { class: 'grow' }, h('div', { class: 'book-title' }, d.title || d.name),
          h('div', { class: 'book-sub' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, d.finished ? '✓ Finished' : d.type === 'epub' ? (d.progress ? `${Math.round(d.progress * 100)}% read` : (d.author || 'EPUB')) : d.pages ? (d.lastRead && (d.lastPage || 1) > 1 ? `Page ${d.lastPage} of ${d.pages}` : `${d.pages} page${d.pages === 1 ? '' : 's'}`) : fmtSize(d.size || 0))),
        more),
      p > 0 && d.lastRead ? h('div', { class: 'book-progress' }, h('span', { style: { width: Math.round(p * 100) + '%' } })) : null);
    return el;
  }
  const shelf = (list, wrap) => { const s = h('div', { class: 'shelf' + (wrap ? ' wrap' : '') }); list.forEach((d) => s.append(bookCard(d))); return s; };
  function continueBook(d) {
    const p = progressOf(d);
    return h('button', { class: 'cont-card cont-book', onclick: () => A.emit('read', d.id) }, cover(d),
      h('div', { class: 'cont-info' }, h('span', { class: 'cont-kicker' }, 'Reading'), h('span', { class: 'cont-title' }, d.title || d.name),
        h('span', { class: 'cont-sub num' }, d.type === 'epub' ? `${Math.round(p * 100)}% read` : d.pages ? `Page ${d.lastPage || 1} of ${d.pages} · ${Math.round(p * 100)}%` : ''),
        h('span', { class: 'book-progress wide' }, h('span', { style: { width: Math.round(p * 100) + '%' } })),
        h('span', { class: 'cont-cta' }, 'Continue reading', A.iconEl('chev'))));
  }
  function continueDrawing(m) {
    const thumb = h('span', { class: 'cont-thumb' + (m.kind === 'notebook' ? ' nb' : ''), style: { background: m.paper || '#fff' } });
    if (m.thumb) thumb.append(h('img', { src: m.thumb, alt: '' }));
    return h('button', { class: 'cont-card cont-draw', onclick: () => A.emit('open', m.id) }, thumb,
      h('div', { class: 'cont-info' }, h('span', { class: 'cont-kicker' }, m.kind === 'notebook' ? 'Notebook' : 'Canvas'), h('span', { class: 'cont-title' }, m.name),
        h('span', { class: 'cont-sub' }, (A.SU.name(m.subject) ? A.SU.name(m.subject) + ' · ' : '') + 'Edited ' + A.fmtDate(m.updated).replace(/^Today, /, 'today, ').replace(/^Yesterday, /, 'yesterday, ')),
        h('span', { class: 'cont-cta' }, 'Open', A.iconEl('chev'))));
  }
  function docMenu(d, anchor) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('book', 'Read', () => A.emit('read', d.id));
    it('rename', 'Solve beside it…', () => UI.solveBeside(d, d.lastPage || 1));
    it('folder', 'Move to folder…', () => folderMenu(d, anchor, render));
    it('moveto', 'Course: ' + (A.SU.name(d.subject) || 'none'), () => A.SU.pickMenu(anchor, d.subject, (sid) => { A.ST.updateDoc(d.id, { subject: sid }); render(); }));
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
  UI.studyDoc = (d) => UI.solveBeside(d, d.lastPage || 1);

  /* "Solve beside this page": open a notebook or canvas with the book docked at that page;
     with a problem image, it is also placed on the paper ready to write under */
  UI.solveBeside = async (book, page, problem) => {
    const metas = (await A.store.listMeta()).filter(Boolean).sort((a, b) => b.updated - a.updated);
    const same = metas.filter((m) => book.subject && m.subject === book.subject);
    const recent = same.concat(metas.filter((m) => !same.includes(m))).slice(0, 6);
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    const go = async (target) => {
      close();
      let id = target;
      if (target === 'notebook' || target === 'canvas') {
        const ln = S.lastNotebook || {};
        const name = (problem ? 'Problems · ' : 'Notes · ') + book.name.slice(0, 40);
        const doc = target === 'notebook'
          ? D.create({ name, bg: ln.color || '#ffffff', kind: 'notebook', page: { template: ln.tpl || 'grid', color: ln.color || '#ffffff', size: ln.size || 'a4', orient: 'portrait', scroll: 'vertical' } })
          : UI.createFromSheet({ kind: 'canvas', name, t: UI.templates[1], bg: D.papers.white, subject: book.subject });
        doc.subject = book.subject || null;
        await A.store.saveDoc(doc, null);
        id = doc.id;
      }
      A.ST.pendingDoc = { id: book.id, page };
      UI.pendingInsert = problem || null;
      A.emit('open', id);
    };
    const opt = (icon, title, sub, fn) => h('button', { class: 'sb-opt', onclick: fn }, h('span', { class: 'sb-ic', html: A.icon(icon) }), h('span', { class: 'grow' }, h('b', null, title), h('small', null, sub)));
    const list = h('div', { class: 'sb-list' });
    recent.forEach((m) => list.append(opt(m.kind === 'notebook' ? 'notebook' : 'canvas', m.name, (A.SU.name(m.subject) ? A.SU.name(m.subject) + ' · ' : '') + 'Edited ' + A.fmtDate(m.updated).replace(/^Today, /, 'today, ').replace(/^Yesterday, /, 'yesterday, '), () => go(m.id))));
    back.append(h('div', { class: 'modal solve-modal', role: 'dialog', 'aria-label': 'Solve beside this page' },
      h('h3', null, 'Solve beside page ' + page),
      h('p', { class: 'muted small' }, problem ? 'The problem goes on a fresh page, with the book open beside it at this page.' : 'The book stays open beside your work, at this page.'),
      h('div', { class: 'sb-new' }, opt('notebook', 'New notebook', 'Pages to write on', () => go('notebook')), opt('canvas', 'New canvas', 'Infinite space', () => go('canvas'))),
      recent.length ? h('h5', null, 'Or continue in') : null, recent.length ? list : null,
      h('div', { class: 'row end', style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: close }, 'Cancel'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  };
  A.on('doc:open', () => {
    const pi = UI.pendingInsert;
    if (!pi) return;
    UI.pendingInsert = null;
    setTimeout(() => {
      if (!D.doc) return;
      if (D.isNotebook()) A.NB.placeReference(pi.url, pi.w, pi.h, { label: pi.label });
      else { const [x, y] = R.toWorld(R.w * 0.12, R.h * 0.16); A.UI.placeImage(pi.url, pi.w, pi.h, { at: [x, y], width: Math.min(pi.w, (R.w * 0.45) / D.doc.view.zoom) }); }
    }, 350);
  });
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
