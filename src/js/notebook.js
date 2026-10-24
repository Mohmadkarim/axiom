/* Axiom notebooks: Notability-style chrome around paged documents.
   Tool rail with per-tool colours and sizes, page counter, page sidebar, note menu, templates,
   lecture recording with ink replay, study timer, version history and Learn (tutor) actions. */
'use strict';
(() => {
  const D = A.D, R = A.R, B = A.B, G = A.G, h = A.h;
  const S = A.settings;
  const NB = (A.NB = {});
  let host = null;
  const els = {};
  const on = () => !!D.doc && D.isNotebook();

  /* ---------- per-tool palettes and sizes (Notability-style fast colours, three sizes) ---------- */
  const PAL = {
    pen: ['#16181d', '#1f4fbf', '#c0392b', '#1e8449', '#7d3cff', '#e67e22'],
    highlighter: ['#ffd84d', '#ff7eb6', '#9cf26a', '#7ec8ff', '#5ef0e0', '#ffb15c'],
    tape: ['#f7c6d0', '#bfe6e0', '#ffd9b8', '#d9ccf5', '#eef0f3'],
    laser: ['#ff3b30', '#2f7bff', '#26c281', '#ffcc00'],
    text: ['#16181d', '#1f4fbf', '#c0392b', '#1e8449', '#7d3cff'],
  };
  const SIZES = {
    pen: [1.4, 2.5, 4.2], highlighter: [12, 18, 28], eraser: [8, 16, 34], tape: [14, 22, 34], laser: [4, 6, 10], text: [15, 20, 28],
  };
  const PEN_STYLES = [['pen', 'Pen'], ['fountain', 'Fountain'], ['pencil', 'Pencil'], ['fineliner', 'Fine liner'], ['brushpen', 'Brush pen'], ['dotted', 'Dotted']];
  const family = (b) => (b === 'highlighter' || b === 'marker' ? 'highlighter' : b === 'eraser' || b === 'slice' ? 'eraser' : b === 'tape' ? 'tape' : b === 'laser' ? 'laser' : b === 'text' ? 'text' : b === 'select' ? 'select' : 'pen');
  const iconFor = (slot) => {
    const f = family(slot.b);
    return f === 'pen' ? B.catalog[slot.b].icon : f === 'highlighter' ? 'b-highlighter' : f === 'eraser' ? 'b-eraser' : f === 'tape' ? 'tape' : f === 'laser' ? 'laser' : f === 'text' ? 'text' : 'lasso';
  };

  /* ---------- mount / lifecycle ---------- */
  NB.mount = (el) => {
    host = el;
    A.on('doc:open', () => { if (on()) build(); else teardown(); });
    A.on('doc:close', () => { AUD.stopAll(); timerStop(true); teardown(); });
    A.on('slot', () => { if (on()) renderRail(); });
    A.on('history', () => { if (on()) syncHistory(); });
    A.on('pages', () => { if (on()) { syncCounter(); thumbsDirty(); } });
    A.on('view', () => { if (on()) syncCounter(); });
    A.on('doc:changed', (k) => { if (!on() || k === 'view') return; ensurePage(); thumbsDirty(); });
    A.on('canvas:tap', (pt) => { if (on()) AUD.tapSeek(pt); });
    /* rotating the iPad or opening the tutor keeps the page fitted if it was fitted before */
    let lastFit = 0;
    A.on('view', () => { if (on()) { const f = R.fitPageZoom(); if (Math.abs(D.doc.view.zoom - f) < f * 0.02) lastFit = 1; else lastFit = 0; } });
    A.on('stage:resize', () => {
      if (!on()) return;
      const cur = R.currentPage();
      requestAnimationFrame(() => {
        D.doc.view.zoom = R.fitPageZoom(); // like Notability: the page refits whenever the space changes
        R.constrainNotebook(); R.showPage(cur); syncCounter();
      });
    });
    /* double-tap with a finger: back to a fitted, centred page */
    let lastTap = 0;
    A.on('canvas:tap', (pt) => {
      if (!on()) return;
      const now = performance.now();
      if (now - lastTap < 320) { const cur = R.currentPage(); D.doc.view.zoom = R.fitPageZoom(); R.constrainNotebook(); R.showPage(cur, true); lastTap = 0; return; }
      lastTap = now;
    });
  };
  const ensurePage = A.debounce(() => { if (on()) { const n = D.doc.pages.length; D.ensureTrailingPage(); if (D.doc.pages.length !== n) R.render(); } }, 300);
  function teardown() { R.nbInsetL = 0; if (host) host.innerHTML = ''; Object.keys(els).forEach((k) => delete els[k]); }

  function build() {
    host.innerHTML = '';
    const ib = (icon, title, fn, cls = '') => {
      const b = h('button', { class: 'ibtn ' + cls, title, 'aria-label': title, html: A.icon(icon) });
      b.addEventListener('click', (e) => fn(e.currentTarget));
      return b;
    };
    // top left: back, title, course
    els.title = h('button', { class: 'nb-title', title: 'Rename notebook', onclick: async () => {
      const n = await A.dialog({ title: 'Rename notebook', input: D.doc.name, okText: 'Rename' });
      if (n && n.trim()) { D.doc.name = n.trim().slice(0, 80); D.changed('meta'); els.title.firstChild.textContent = D.doc.name; }
    } }, h('span', null, D.doc.name), h('span', { class: 'nb-sub' }, courseLabel()));
    const left = h('div', { class: 'nb-tl panel' }, ib('chev', 'Back to library', () => A.emit('go:gallery'), 'flip'), els.title);
    // top right pill
    els.undo = ib('undo', 'Undo', () => A.emit('cmd', 'undo'));
    els.redo = ib('redo', 'Redo', () => A.emit('cmd', 'redo'));
    els.learn = ib('spark', 'Learn: tutor, smart notes, quizzes', (b) => learnMenu(b), 'accent-ic');
    els.pagesBtn = ib('pages', 'Pages', () => toggleSide());
    els.mic = ib('mic', 'Record audio', () => (AUD.recording ? AUD.stop() : AUD.record()));
    const right = h('div', { class: 'nb-tr panel' },
      els.undo, els.redo, h('i', { class: 'sb-sep' }),
      els.mic, els.learn, els.pagesBtn,
      ib('more', 'More', (b) => moreMenu(b)));
    // tool rail
    els.rail = h('div', { class: 'nb-rail panel', role: 'toolbar', 'aria-label': 'Tools' });
    els.fly = h('div', { class: 'nb-fly panel', hidden: true });
    // page counter
    els.count = h('button', { class: 'nb-count-n num', title: 'Go to page', onclick: goToPageDialog });
    els.counter = h('div', { class: 'nb-counter panel' },
      ib('chevup', 'Previous page', () => R.showPage(Math.max(0, R.currentPage() - 1), true)),
      els.count,
      ib('chevdown', 'Next page', () => R.showPage(Math.min(D.doc.pages.length - 1, R.currentPage() + 1), true)));
    // page sidebar
    els.side = h('aside', { class: 'nb-side panel', hidden: true });
    els.audio = h('div', { class: 'nb-audio panel', hidden: true });
    els.rec = h('div', { class: 'nb-rec', hidden: true });
    els.timer = h('div', { class: 'nb-timer panel', hidden: true });
    host.append(left, right, els.rail, els.fly, els.counter, els.side, els.audio, els.rec, els.timer);
    renderRail(); syncHistory(); syncCounter();
    R.notebookTop = 70;
    if (S.nbSide) toggleSide(true);
    AUD.renderBar();
    VER.autoSnapshot();
  }
  const courseLabel = () => { const n = A.SU.name(D.doc.subject); return (n ? n + ' · ' : '') + D.formats[D.doc.page.size].name; };
  function syncHistory() {
    if (!els.undo) return;
    els.undo.disabled = !D.history.undo.length && !D.history.pending;
    els.redo.disabled = !D.history.redo.length;
  }
  function syncCounter() {
    if (!els.count) return;
    const n = D.doc.pages.length, cur = R.currentPage() + 1;
    els.count.innerHTML = `<b>${cur}</b><span> / ${n}</span>`;
    const [up, down] = els.counter.querySelectorAll('.ibtn');
    if (up) up.disabled = cur <= 1;
    if (down) down.disabled = cur >= n;
    if (els.side && !els.side.hidden) els.side.querySelectorAll('.nb-th').forEach((t) => t.classList.toggle('on', +t.dataset.i === cur - 1));
  }
  async function goToPageDialog() {
    const v = await A.dialog({ title: 'Go to page', input: String(R.currentPage() + 1), okText: 'Go' });
    const n = parseInt(v, 10);
    if (n >= 1) R.showPage(Math.min(D.doc.pages.length, n) - 1, true);
  }

  /* ---------- tool rail: the writing tools only; everything else lives behind + ---------- */
  const ORDER = [0, 1, 2, 3, 4, 5, 6];
  function renderRail() {
    if (!els.rail) return;
    const rail = els.rail;
    rail.innerHTML = '';
    const tool = (i) => {
      const sl = S.slots[i];
      if (!sl) return null;
      const f = family(sl.b);
      const b = h('button', { class: 'nb-tool' + (i === S.activeSlot ? ' on' : ''), title: B.catalog[sl.b].name, 'aria-label': B.catalog[sl.b].name, 'aria-pressed': String(i === S.activeSlot) });
      b.innerHTML = A.icon(iconFor(sl));
      if (f !== 'eraser' && f !== 'select') b.append(h('i', { class: 'nb-dot', style: { background: sl.color } }));
      b.addEventListener('click', () => {
        if (S.activeSlot === i) { els.fly.hidden ? openFly(i, b) : closeFly(); return; }
        A.UI.setSlot(i);
        closeFly();
      });
      return b;
    };
    ORDER.forEach((i) => rail.append(tool(i)));
    if (S.activeSlot > 6) rail.append(tool(S.activeSlot)); // laser or tape while in use
    if (D.doc.precision.guide) rail.append(h('button', { class: 'nb-tool on', title: 'Ruler (tap to put away)', 'aria-label': 'Put the ruler away', html: A.icon('ruler'), onclick: () => toggleRuler() }));
    const plus = h('button', { class: 'nb-tool plus', title: 'Insert and more tools', 'aria-label': 'Insert and more tools', html: A.icon('plus') });
    plus.addEventListener('click', () => insertMenu(plus));
    rail.append(h('i', { class: 'nb-sep' }), plus);
    if (els.mic) { els.mic.innerHTML = A.icon(AUD.recording ? 'stop' : 'mic'); els.mic.classList.toggle('rec', !!AUD.recording); }
  }
  function toggleRuler() {
    const P = D.doc.precision;
    P.guide = !P.guide; P.guideType = 'line';
    D.changed('precision'); A.emit('precision'); R.render(); renderRail();
    if (P.guide) A.toast('Ruler on: drag its handles to place it, then draw along it', 2200);
  }
  function closeFly() { if (els.fly) els.fly.hidden = true; }
  const PEN_ICONS = { pen: 'b-pen', fountain: 'b-brushpen', pencil: 'b-pencil', fineliner: 'b-fineliner', brushpen: 'b-brushpen', dotted: 'b-dotted' };
  function openFly(i, anchor) {
    const sl = S.slots[i], f = family(sl.b);
    const fly = els.fly;
    fly.innerHTML = '';
    const set = (patch) => { Object.assign(S.slots[i], patch); A.saveSettings(); A.emit('slot'); openFly(i, anchor); };
    const seg = (opts, cur, fn) => h('div', { class: 'seg mini full' }, ...opts.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', onclick: () => fn(v) }, l)));
    if (f === 'pen') {
      fly.append(h('div', { class: 'nb-types' }, ...PEN_STYLES.map(([b, l]) => h('button', { class: 'nb-type' + (sl.b === b ? ' on' : ''), title: l, 'aria-label': l, html: A.icon(PEN_ICONS[b]), onclick: () => { const c = B.catalog[b]; set({ b, opacity: c.opacity, smoothing: c.smoothing, size: A.clamp(sl.size, c.min, c.max) }); } }))));
    }
    if (PAL[f]) {
      const sw = h('div', { class: 'nb-sw' });
      PAL[f].forEach((c) => sw.append(h('button', { class: 'nb-swatch' + (c.toLowerCase() === String(sl.color).toLowerCase() ? ' on' : ''), style: { background: c }, 'aria-label': 'Colour ' + c, onclick: () => set({ color: c }) })));
      const custom = h('button', { class: 'nb-swatch plus', 'aria-label': 'More colours', html: A.icon('plus') });
      custom.addEventListener('click', () => A.UI.openColor(custom));
      sw.append(custom);
      fly.append(sw);
    }
    if (SIZES[f]) {
      const sz = h('div', { class: 'nb-sizes' });
      SIZES[f].forEach((v, k) => sz.append(h('button', { class: 'nb-size' + (Math.abs(sl.size - v) < 0.01 ? ' on' : ''), 'aria-label': 'Size ' + (k + 1), onclick: () => set({ size: v }) }, h('i', { style: { width: 5 + k * 5 + 'px', height: 5 + k * 5 + 'px' } }))));
      fly.append(sz);
    }
    if (f === 'eraser') fly.append(seg([['slice', 'Partial'], ['eraser', 'Whole stroke']], sl.b, (b) => set({ b })));
    if (f === 'select') fly.append(seg([['lasso', 'Freehand'], ['picker', 'Tap items']], A.IN.selMode, (v) => { A.IN.selMode = v; openFly(i, anchor); }));
    if (f === 'tape') fly.append(seg([['cover', 'Cover all'], ['reveal', 'Reveal all']], null, (v) => tapeAll(v === 'reveal')));
    if (f === 'text') fly.append(seg(Object.keys(B.FONTS).map((k) => [k, { sans: 'Sans', serif: 'Serif', mono: 'Mono', round: 'Round' }[k]]), sl.font || 'sans', (k) => set({ font: k })));
    if (!fly.childElementCount) return;
    fly.hidden = false;
    const r = anchor.getBoundingClientRect(), hr = host.getBoundingClientRect();
    fly.style.top = Math.max(70, Math.min(r.top - hr.top - 12, hr.height - fly.offsetHeight - 20)) + 'px';
  }
  function tapeAll(reveal) {
    D.begin();
    for (const l of D.doc.layers) l.items = l.items.map((it) => (it.b === 'tape' && !!it.rv !== reveal ? Object.assign({}, it, { rv: reveal }) : it));
    D.commit(); R.render();
  }
  A.on('canvas:down', closeFly);
  /* go back to the previous tool after an erase, when asked to */
  A.on('history', () => {
    if (!on() || !S.autoDeselectEraser) return;
    const sl = S.slots[S.activeSlot];
    if (sl && family(sl.b) === 'eraser' && S.prevSlot != null) setTimeout(() => A.UI.setSlot(S.prevSlot), 60);
  });

  /* ---------- menus ---------- */
  const menu = (anchor, build, side = 'down') => {
    const box = h('div', { class: 'menu nb-menu' });
    const it = (icon, label, fn, cls = '', sub = '') => {
      const b = h('button', { class: cls, onclick: () => { A.closePopovers(); fn(); } });
      b.innerHTML = A.icon(icon);
      b.append(h('span', { class: 'grow' }, label, sub ? h('small', null, sub) : null));
      box.append(b);
      return b;
    };
    build(it, box);
    A.popover(box, anchor, { side });
  };
  function insertMenu(anchor) {
    menu(anchor, (it, box) => {
      it('image', 'Photo or image', async () => { const f = await pickFile('image/*'); if (f) A.UI.importImageFile(f); });
      it('camera', 'Camera', async () => { const f = await pickFile('image/*', true); if (f) A.UI.importImageFile(f); });
      it('sticky', 'Sticky note', () => { const [x, y] = R.toWorld(R.w / 2 - 110, R.h * 0.35); A.TE.create(x, y, 220, { bg: '#fff1a8', fs: 18 }); });
      it('pdf', 'PDF pages', async () => { const f = await pickFile('application/pdf,.pdf'); if (f) A.UI.importPdf(f); });
      it('addpage', 'New page', () => { const cur = R.currentPage(); D.insertPage(cur + 1, { template: D.pageTemplate(D.doc, cur) }); R.showPage(cur + 1, true); });
      it('shapes', 'Diagram', () => A.V.open(anchor));
      it('book', 'Book page beside…', () => bookBesideMenu(anchor));
      box.append(h('hr'));
      it('laser', 'Laser pointer', () => A.UI.setSlot(7));
      it('tape', 'Tape', () => A.UI.setSlot(8));
      it('ruler', D.doc.precision.guide ? 'Put ruler away' : 'Ruler', () => toggleRuler());
    }, 'left');
  }
  function learnMenu(anchor) {
    const ask = (text, mode = 'explain', pages = 'all') => {
      A.ST.showTutor();
      const atts = pages === 'all' ? A.AI.shotPages() : [A.AI.shotPage(R.currentPage())];
      setTimeout(() => A.AI.ask(text, { mode, attachments: atts }), 80);
    };
    menu(anchor, (it, box) => {
      box.append(h('div', { class: 'sub' }, 'Learn from this notebook'));
      it('spark', 'Chat with your notes', () => { A.ST.showTutor(); setTimeout(() => A.AI.ask('', { attachments: A.AI.shotPages(), send: false }), 80); });
      it('rename', 'Smart notes', () => ask('Turn my handwritten notes into clean, well-structured smart notes: headings, key definitions, theorems and formulas in LaTeX, and worked examples. Point out anything that looks wrong or incomplete.'));
      it('quiz', 'Practice questions', () => ask('Make 6 multiple-choice practice questions from my notes, from easier to harder, with explanations.', 'quiz'));
      it('cards', 'Flashcards', () => ask('Make 12 flashcards from my notes (definitions, theorems, formulas, key facts).'));
      it('check', 'Check this page', () => ask('Check my work on this page. Point out mistakes precisely and say what is correct.', 'check', 'page'));
    });
  }
  function moreMenu(anchor) {
    menu(anchor, (it, box) => {
      it('export', 'Export', () => A.UI.openExport());
      it('template', 'Paper and page size', () => templateDialog());
      it('timer', 'Study session', () => timerDialog());
      it('history', 'Version history', () => VER.open());
      box.append(h('hr'));
      it('fav', D.doc.fav ? 'Unfavourite' : 'Favourite', () => { D.doc.fav = !D.doc.fav; D.changed('meta'); });
      it(S.fingerAction === 'draw' ? 'hand' : 'nopen', S.fingerAction === 'draw' ? 'Finger draws' : 'Finger scrolls', () => { S.fingerAction = S.fingerAction === 'draw' ? 'pan' : 'draw'; A.saveSettings(); A.toast(S.fingerAction === 'draw' ? 'Your finger draws too' : 'Your finger scrolls; the Pencil writes', 1400); });
      it('settings', 'Settings', () => A.UI.openSettings());
    });
  }
  function noteInfo() {
    const d = D.doc, rec = (d.recordings || []).length;
    A.dialog({ title: d.name, body: [
      `Course: ${A.SU.name(d.subject) || 'none'}`,
      `Pages: ${d.pages.length} · ${D.formats[d.page.size].name} ${d.page.orient}`,
      `Paper: ${(R.templates.find((t) => t.id === d.page.template) || {}).name || d.page.template}`,
      `Recordings: ${rec}`,
      `Created ${new Date(d.created).toLocaleString()}`,
      `Edited ${new Date(d.updated).toLocaleString()}`,
    ].join('\n'), okText: 'Done' });
  }
  const pickFile = (accept, camera = false) => new Promise((res) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (camera) inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', () => { res(inp.files && inp.files[0]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
  /* a photo or scan becomes a full page (like a PDF page) */
  async function photoPage(file) {
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const im = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = url; });
    const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = h('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const at = R.currentPage() + 1;
    D.insertPage(at, { template: 'blank' });
    const doc = D.doc, [pw, ph] = D.pageSize(), rc = D.pageRect(doc, at);
    const s = Math.min(pw / c.width, ph / c.height);
    const it = { id: A.uid(), t: 'i', src: c.toDataURL('image/jpeg', 0.86), iw: c.width, ih: c.height, m: [s, 0, 0, s, rc[0] + (pw - c.width * s) / 2, rc[1] + (ph - c.height * s) / 2], o: 1 };
    it.bb = B.imageBB(it);
    let layer = doc.layers.find((l) => l.pdfLayer);
    D.begin();
    if (!layer) { layer = D.newLayer('Imported pages'); layer.pdfLayer = true; layer.locked = true; doc.layers.unshift(layer); }
    layer.items = layer.items.concat([it]);
    D.commit('all');
    A.emit('layers');
    R.showPage(at, true);
  }

  /* ---------- template settings ---------- */
  function setPageProp(patch) {
    D.begin();
    Object.assign(D.doc.page, patch);
    if (patch.color) { D.doc.paper.bg = patch.color; D.doc.pages.forEach((p) => delete p.color); }
    D.commit('all');
    A.emit('pages');
    R.constrainNotebook(); R.render();
    if (els.title) els.title.lastChild.textContent = courseLabel();
  }
  function templateDialog() {
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    const body = h('div');
    const st = { scope: 'all' };
    const draw = () => {
      body.innerHTML = '';
      const doc = D.doc, cur = R.currentPage();
      body.append(h('div', { class: 'seg', style: { marginBottom: '12px' } },
        h('button', { class: st.scope === 'all' ? 'on' : '', onclick: () => { st.scope = 'all'; draw(); } }, 'All pages'),
        h('button', { class: st.scope === 'page' ? 'on' : '', onclick: () => { st.scope = 'page'; draw(); } }, `Page ${cur + 1} only`)));
      const grid = h('div', { class: 'paper-grid tpl-grid' });
      const curTpl = st.scope === 'page' ? D.pageTemplate(doc, cur) : doc.page.template;
      R.templates.forEach((t) => {
        const cv = h('canvas');
        const [pw, ph] = D.pageSize();
        const H = 120, W = Math.round((H * pw) / ph);
        cv.width = W * 2; cv.height = H * 2;
        const ctx = cv.getContext('2d'); const k = (H * 2) / ph;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.fillStyle = doc.page.color; ctx.fillRect(0, 0, pw, ph);
        R.drawTemplate(ctx, [0, 0, pw, ph], t.id, doc.page.color, 1.2 / k);
        grid.append(h('button', { class: 'paper-opt page' + (t.id === curTpl ? ' on' : ''), onclick: () => {
          if (st.scope === 'page') D.setPage(cur, { template: t.id });
          else { D.begin(); doc.page.template = t.id; doc.pages.forEach((p) => delete p.template); D.commit('all'); A.emit('pages'); }
          R.render(); draw();
        } }, cv, t.name));
      });
      body.append(h('h5', null, 'Paper'), grid);
      const colors = h('div', { class: 'bg-row' });
      A.UI.notebookPapers.forEach((c) => colors.append(h('button', { class: c === doc.page.color ? 'on' : '', style: { background: c }, 'aria-label': 'Paper ' + c, onclick: () => { if (st.scope === 'page') D.setPage(cur, { color: c }); else setPageProp({ color: c }); R.render(); draw(); } })));
      body.append(h('h5', null, 'Paper colour'), colors);
      const sizes = h('div', { class: 'seg' });
      ['a4', 'letter', 'a5', 'a3'].forEach((f) => sizes.append(h('button', { class: doc.page.size === f ? 'on' : '', onclick: () => { setPageProp({ size: f }); draw(); } }, D.formats[f].name.replace('US ', ''))));
      body.append(h('h5', null, 'Page'),
        h('div', { class: 'row gap wrap' }, sizes,
          h('div', { class: 'seg' }, ...[['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([v, l]) => h('button', { class: doc.page.orient === v ? 'on' : '', onclick: () => { setPageProp({ orient: v }); draw(); } }, l))),
          h('div', { class: 'seg' }, ...[['vertical', 'Scroll'], ['horizontal', 'Pages']].map(([v, l]) => h('button', { class: doc.page.scroll === v ? 'on' : '', onclick: () => { setPageProp({ scroll: v }); draw(); } }, l)))));
    };
    draw();
    back.append(h('div', { class: 'modal wide', role: 'dialog', 'aria-label': 'Template settings' }, h('h3', null, 'Paper and page'), body,
      h('div', { class: 'row end', style: { marginTop: '18px' } }, h('button', { class: 'btn primary', onclick: close }, 'Done'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  }

  /* ---------- page sidebar (thumbnails, bookmarks, page actions) ---------- */
  let thumbTimer = 0;
  const thumbCache = new Map();
  function thumbsDirty() { if (!els.side || els.side.hidden) return; clearTimeout(thumbTimer); thumbTimer = setTimeout(renderSide, 500); }
  function toggleSide(force) {
    const show = force != null ? force : els.side.hidden;
    els.side.hidden = !show;
    els.pagesBtn.classList.toggle('on', show);
    host.classList.toggle('side-open', show);
    S.nbSide = show; A.saveSettings();
    const cur = R.currentPage();
    R.nbInsetL = show && R.w > 700 ? 210 : 0;
    const fit = R.fitPageZoom();
    if (D.doc.view.zoom > fit * 1.02 || Math.abs(D.doc.view.zoom - fit) < fit * 0.25) D.doc.view.zoom = fit;
    R.showPage(cur);
    if (show) renderSide();
  }
  function pageThumb(i) {
    const doc = D.doc, rc = D.pageRect(doc, i);
    const s = 116 / (rc[2] - rc[0]);
    return R.renderRegion(doc, rc, s, { bg: true, grid: false, maxPx: 400 });
  }
  function renderSide() {
    const side = els.side;
    if (!side || side.hidden) return;
    const doc = D.doc;
    const filter = S.nbSideFilter || 'all';
    const list = h('div', { class: 'nb-thumbs' });
    side.innerHTML = '';
    side.append(h('div', { class: 'nb-side-h' },
      h('div', { class: 'seg mini' }, h('button', { class: filter === 'all' ? 'on' : '', onclick: () => { S.nbSideFilter = 'all'; renderSide(); } }, 'All pages'), h('button', { class: filter === 'bm' ? 'on' : '', onclick: () => { S.nbSideFilter = 'bm'; renderSide(); } }, 'Bookmarked')),
      h('button', { class: 'ibtn', 'aria-label': 'Close pages', html: A.icon('close'), onclick: () => toggleSide(false) })), list);
    const cur = R.currentPage();
    doc.pages.forEach((p, i) => {
      if (filter === 'bm' && !p.bm) return;
      const th = h('div', { class: 'nb-th' + (i === cur ? ' on' : ''), dataset: { i } });
      const cv = pageThumb(i);
      cv.className = 'nb-th-img';
      const bm = h('button', { class: 'nb-bm' + (p.bm ? ' on' : ''), 'aria-label': p.bm ? 'Remove bookmark' : 'Bookmark page', html: A.icon('bookmark'), onclick: (e) => { e.stopPropagation(); D.setPage(i, { bm: !p.bm }); } });
      const more = h('button', { class: 'nb-thm', 'aria-label': 'Page actions', html: A.icon('more'), onclick: (e) => { e.stopPropagation(); pageMenu(i, more); } });
      th.append(h('button', { class: 'nb-th-open', 'aria-label': 'Go to page ' + (i + 1), onclick: () => R.showPage(i, true) }, cv), bm, more, h('div', { class: 'nb-th-n num' }, String(i + 1)));
      list.append(th);
    });
    if (filter === 'bm' && !doc.pages.some((p) => p.bm)) list.append(h('p', { class: 'nb-hint' }, 'Bookmark pages with the ribbon to find them here.'));
    list.append(h('button', { class: 'nb-th-add', onclick: () => { const n = doc.pages.length; D.insertPage(n, {}); R.showPage(n, true); } }, A.iconEl('plus'), 'Add page'));
    const on = list.querySelector('.nb-th.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function pageMenu(i, anchor) {
    menu(anchor, (it, box) => {
      const n = D.doc.pages.length;
      box.append(h('div', { class: 'sub' }, 'Page ' + (i + 1)));
      it('addpage', 'Insert page before', () => D.insertPage(i, { template: D.pageTemplate(D.doc, i) }));
      it('addpage', 'Insert page after', () => D.insertPage(i + 1, { template: D.pageTemplate(D.doc, i) }));
      it('duplicate', 'Duplicate page', () => D.duplicatePage(i));
      if (i > 0) it('chevup', 'Move up', () => D.movePage(i, i - 1));
      if (i < n - 1) it('chevdown', 'Move down', () => D.movePage(i, i + 1));
      it('bookmark', D.doc.pages[i].bm ? 'Remove bookmark' : 'Bookmark', () => D.setPage(i, { bm: !D.doc.pages[i].bm }));
      it('template', 'Change paper…', () => { R.showPage(i); templateDialog(); });
      it('image', 'Export page as image', () => { R.showPage(i); A.UI.openExport({ fmt: 'png', region: 'page' }); });
      box.append(h('hr'));
      it('clear', 'Clear page', () => { const rc = D.pageRect(D.doc, i); D.begin(); for (const l of D.doc.layers) if (!l.locked) l.items = l.items.filter((x) => !G.bbHit(x.bb, rc) || D.pageAt(D.doc, (x.bb[0] + x.bb[2]) / 2, (x.bb[1] + x.bb[3]) / 2) !== i); D.commit('all'); R.render(); });
      it('trash', 'Delete page', async () => { if (await A.dialog({ title: `Delete page ${i + 1}?`, body: 'Its writing and images are removed. You can undo this.', okText: 'Delete', danger: true })) { D.deletePage(i); R.constrainNotebook(); R.render(); } }, 'danger');
    }, 'right');
  }

  /* ---------- audio recording and replay ---------- */
  const AUD = (NB.audio = { recording: null, playing: null, t: 0, rate: 1, replay: true });
  const NATIVE_AUDIO = !!(window.AXIOM_NATIVE && window.AXIOM_NATIVE.audio && A.native);
  let webRec = null, webChunks = [], webPlayer = null, recT0 = 0, recTick = 0;
  const fmtT = (t) => { t = Math.max(0, Math.floor(t)); const m = Math.floor(t / 60), s = t % 60; return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  AUD.record = async () => {
    if (AUD.recording) return;
    AUD.pause();
    const id = A.uid();
    try {
      if (NATIVE_AUDIO) await A.native.post({ op: 'audioStart', id });
      else {
        if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Recording is not available in this browser. Use the installed Axiom app.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        webChunks = [];
        webRec = new MediaRecorder(stream);
        webRec.ondataavailable = (e) => { if (e.data && e.data.size) webChunks.push(e.data); };
        webRec.start(1000);
      }
    } catch (e) { A.toast(String(e.message || e).replace(/^Error: /, ''), 3200); return; }
    const n = (D.doc.recordings || []).length + 1;
    AUD.recording = { id, name: 'Recording ' + n, created: Date.now() };
    recT0 = performance.now();
    clearInterval(recTick);
    recTick = setInterval(renderRec, 500);
    renderRec(); renderRail();
    A.toast('Recording. Your writing is linked to the audio.', 1800);
  };
  AUD.stop = async () => {
    const r = AUD.recording;
    if (!r) return;
    let dur = (performance.now() - recT0) / 1000;
    try {
      if (NATIVE_AUDIO) dur = (await A.native.post({ op: 'audioStop' })) || dur;
      else if (webRec) {
        const stopped = new Promise((res) => (webRec.onstop = res));
        webRec.stop(); webRec.stream.getTracks().forEach((t) => t.stop());
        await stopped;
        await A.store.saveFile('rec_' + r.id, new Blob(webChunks, { type: webRec.mimeType || 'audio/mp4' }));
        webRec = null;
      }
    } catch (e) { console.error(e); }
    clearInterval(recTick);
    AUD.recording = null;
    if (D.doc) {
      D.doc.recordings = (D.doc.recordings || []).concat([{ id: r.id, name: r.name, created: r.created, dur }]);
      D.changed('meta');
    }
    renderRec(); renderRail(); AUD.renderBar();
    A.toast(`Saved ${r.name} (${fmtT(dur)}). Play it from the bar at the bottom.`, 2400);
  };
  AUD.stopAll = () => { if (AUD.recording) AUD.stop(); AUD.pause(); AUD.playing = null; R.replay = null; };
  /* strokes written while recording (or while playing back) are time-stamped to that recording */
  A.IN.stamp = () => {
    if (!on()) return null;
    if (AUD.recording) return { rid: AUD.recording.id, at: Math.round(((performance.now() - recT0) / 1000) * 10) / 10 };
    if (AUD.playing && AUD.isPlaying) return { rid: AUD.playing.id, at: Math.round(AUD.t * 10) / 10 };
    return null;
  };
  function renderRec() {
    const el = els.rec;
    if (!el) return;
    el.hidden = !AUD.recording;
    if (!AUD.recording) return;
    el.innerHTML = '';
    el.append(h('i', { class: 'rec-dot' }), h('span', { class: 'num' }, fmtT((performance.now() - recT0) / 1000)), h('button', { class: 'rec-stop', onclick: () => AUD.stop() }, A.iconEl('stop'), 'Stop'));
  }
  AUD.isPlaying = false;
  const onTick = (t, playing, d) => {
    AUD.t = t; AUD.isPlaying = !!playing;
    if (d && AUD.playing) AUD.playing.dur = d;
    R.replay = AUD.playing && AUD.replay ? { rid: AUD.playing.id, t: playing || t > 0 ? t : 1e9 } : null;
    R.render();
    AUD.renderBar(true);
  };
  window.__axiomAudio = (st) => { if (st && !st.rec) onTick(st.t, st.playing, st.d); };
  AUD.play = async (rec, at) => {
    if (AUD.recording) return;
    if (!rec) return;
    if (AUD.playing && AUD.playing.id !== rec.id) AUD.pause();
    AUD.playing = rec;
    const t = at != null ? at : AUD.t || 0;
    if (NATIVE_AUDIO) {
      try { await A.native.post({ op: 'audioPlay', id: rec.id, at: t }); await A.native.post({ op: 'audioRate', rate: AUD.rate }); } catch (e) { A.toast('This recording could not be played: ' + (e && e.message || e)); return; }
    } else {
      if (!webPlayer || webPlayer.dataset.id !== rec.id) {
        const blob = await A.store.loadFile('rec_' + rec.id, 'audio/mp4');
        if (!blob) { A.toast('This recording is missing'); return; }
        if (webPlayer) { webPlayer.pause(); URL.revokeObjectURL(webPlayer.src); }
        webPlayer = new Audio(URL.createObjectURL(blob));
        webPlayer.dataset.id = rec.id;
        webPlayer.addEventListener('timeupdate', () => onTick(webPlayer.currentTime, !webPlayer.paused, isFinite(webPlayer.duration) ? webPlayer.duration : 0));
        webPlayer.addEventListener('ended', () => onTick(webPlayer.currentTime, false));
      }
      webPlayer.currentTime = t; webPlayer.playbackRate = AUD.rate;
      try { await webPlayer.play(); } catch (e) { A.toast('Tap play again to start the audio'); }
    }
    AUD.isPlaying = true;
    onTick(t, true);
  };
  AUD.pause = () => {
    if (!AUD.playing) return;
    if (NATIVE_AUDIO) A.native.post({ op: 'audioPause' }).catch(() => {});
    else if (webPlayer) webPlayer.pause();
    AUD.isPlaying = false;
    AUD.renderBar(true);
  };
  AUD.seek = (t) => {
    if (!AUD.playing) return;
    t = A.clamp(t, 0, AUD.playing.dur || 1e6);
    if (NATIVE_AUDIO) A.native.post({ op: 'audioSeek', at: t }).catch(() => {});
    else if (webPlayer) webPlayer.currentTime = t;
    onTick(t, AUD.isPlaying);
  };
  /* during playback, tap a stroke to jump the audio to the moment it was written */
  AUD.tapSeek = (pt) => {
    if (!AUD.playing) return;
    const [wx, wy] = R.toWorld(pt.x, pt.y);
    const it = A.IN.pickItem(wx, wy, 10 / D.doc.view.zoom);
    if (it && it.rid === AUD.playing.id && it.at != null) { AUD.seek(Math.max(0, it.at - 1.5)); if (!AUD.isPlaying) AUD.play(AUD.playing); }
  };
  AUD.renderBar = (quick) => {
    const el = els.audio;
    if (!el) return;
    const recs = (D.doc && D.doc.recordings) || [];
    el.hidden = !recs.length || !!AUD.recording;
    if (el.hidden) return;
    const cur = AUD.playing || recs[recs.length - 1];
    if (quick && el.querySelector('.au-time')) {
      el.querySelector('.au-time').textContent = `${fmtT(AUD.t)} / ${fmtT(cur.dur || 0)}`;
      const sc = el.querySelector('.au-scrub'); if (sc && !sc.matches(':active')) { sc.max = String(cur.dur || 1); sc.value = String(AUD.t); }
      el.querySelector('.au-play').innerHTML = A.icon(AUD.isPlaying ? 'pause' : 'play');
      return;
    }
    el.innerHTML = '';
    const scrub = h('input', { type: 'range', class: 'au-scrub', min: '0', max: String(cur.dur || 1), step: '0.1', value: String(AUD.playing ? AUD.t : 0), 'aria-label': 'Playback position' });
    scrub.addEventListener('input', () => { if (!AUD.playing) AUD.playing = cur; AUD.seek(+scrub.value); });
    const name = h('button', { class: 'au-name', title: 'Recordings', onclick: (e) => recList(e.currentTarget) }, cur.name, A.iconEl('chevdown'));
    el.append(
      h('button', { class: 'ibtn au-play', 'aria-label': 'Play or pause', html: A.icon(AUD.isPlaying ? 'pause' : 'play'), onclick: () => (AUD.isPlaying ? AUD.pause() : AUD.play(cur)) }),
      scrub,
      h('span', { class: 'au-time num' }, `${fmtT(AUD.playing ? AUD.t : 0)} / ${fmtT(cur.dur || 0)}`),
      h('button', { class: 'chip au-rate', onclick: () => { const r = [0.75, 1, 1.25, 1.5, 2]; AUD.rate = r[(r.indexOf(AUD.rate) + 1) % r.length]; if (NATIVE_AUDIO) A.native.post({ op: 'audioRate', rate: AUD.rate }).catch(() => {}); else if (webPlayer) webPlayer.playbackRate = AUD.rate; AUD.renderBar(); } }, AUD.rate + '×'),
      name);
  };
  function recList(anchor) {
    menu(anchor, (it, box) => {
      box.append(h('div', { class: 'sub' }, 'Recordings'));
      (D.doc.recordings || []).forEach((r) => {
        it(AUD.playing && AUD.playing.id === r.id ? 'pause' : 'play', r.name, () => { AUD.t = 0; AUD.play(r, 0); }, '', `${fmtT(r.dur || 0)} · ${A.fmtDate(r.created)}`);
      });
      box.append(h('hr'));
      it('play', AUD.replay ? 'Replay ink: on' : 'Replay ink: off', () => { AUD.replay = !AUD.replay; onTick(AUD.t, AUD.isPlaying); });
      it('chev', 'Back 10 seconds', () => { if (!AUD.playing) AUD.playing = (D.doc.recordings || []).slice(-1)[0]; AUD.seek(AUD.t - 10); });
      if (AUD.playing) {
        it('rename', 'Rename this recording', async () => { const n = await A.dialog({ title: 'Rename recording', input: AUD.playing.name, okText: 'Rename' }); if (n) { AUD.playing.name = n.slice(0, 60); const r = D.doc.recordings.find((x) => x.id === AUD.playing.id); if (r) r.name = AUD.playing.name; D.changed('meta'); AUD.renderBar(); } });
        it('trash', 'Delete this recording', async () => {
          const r = AUD.playing;
          if (!(await A.dialog({ title: `Delete “${r.name}”?`, body: 'The audio is removed. Your writing stays.', okText: 'Delete', danger: true }))) return;
          AUD.pause(); AUD.playing = null; R.replay = null;
          D.doc.recordings = D.doc.recordings.filter((x) => x.id !== r.id);
          D.changed('meta');
          try { if (NATIVE_AUDIO) await A.native.post({ op: 'audioDelete', id: r.id }); else await A.store.deleteFile('rec_' + r.id); } catch (e) { /* ignore */ }
          AUD.renderBar(); R.render();
        }, 'danger');
      }
      it('mic', 'New recording', () => AUD.record());
    }, 'up');
  }

  /* ---------- study session timer ---------- */
  const TM = { left: 0, phase: 'focus', round: 1, rounds: 1, focus: 25, brk: 5, iv: 0, paused: false };
  function timerDialog() {
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    const st = { focus: S.studyFocus || 25, brk: S.studyBreak || 5, rounds: S.studyRounds || 2 };
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const seg = (vals, cur, fn, fmt) => h('div', { class: 'seg' }, ...vals.map((v) => h('button', { class: v === cur ? 'on' : '', onclick: () => { fn(v); draw(); } }, fmt(v))));
      body.append(h('h5', null, 'Study length'), seg([15, 25, 45, 60, 90], st.focus, (v) => (st.focus = v), (v) => v + ' min'),
        h('h5', null, 'Break length'), seg([5, 10, 15], st.brk, (v) => (st.brk = v), (v) => v + ' min'),
        h('h5', null, 'Sessions'), seg([1, 2, 3, 4], st.rounds, (v) => (st.rounds = v), (v) => String(v)));
    };
    draw();
    back.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Study session' }, h('h3', null, 'Start a study session'),
      h('p', { class: 'muted' }, 'A focus timer floats in the corner while you work. Breaks are announced when they start and end.'), body,
      h('div', { class: 'row end gap', style: { marginTop: '20px' } }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        S.studyFocus = st.focus; S.studyBreak = st.brk; S.studyRounds = st.rounds; A.saveSettings();
        Object.assign(TM, { focus: st.focus, brk: st.brk, rounds: st.rounds, round: 1, phase: 'focus', left: st.focus * 60, paused: false });
        clearInterval(TM.iv); TM.iv = setInterval(timerTick, 1000);
        renderTimer(); close();
      } }, 'Start'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  }
  function timerTick() {
    if (TM.paused) return;
    TM.left--;
    if (TM.left <= 0) {
      if (TM.phase === 'focus') {
        if (TM.round >= TM.rounds) { A.toast('Study session complete. Well done.', 4000); return timerStop(); }
        TM.phase = 'break'; TM.left = TM.brk * 60; A.toast(`Break: ${TM.brk} minutes`, 3000);
      } else { TM.phase = 'focus'; TM.round++; TM.left = TM.focus * 60; A.toast(`Session ${TM.round} of ${TM.rounds}: focus`, 3000); }
    }
    renderTimer();
  }
  function timerStop(silent) { clearInterval(TM.iv); TM.iv = 0; if (els.timer) els.timer.hidden = true; if (!silent) renderTimer(); }
  function renderTimer() {
    const el = els.timer;
    if (!el) return;
    el.hidden = !TM.iv;
    if (!TM.iv) return;
    el.innerHTML = '';
    el.classList.toggle('brk', TM.phase === 'break');
    el.append(h('span', { class: 'tm-k' }, TM.phase === 'break' ? 'Break' : `Focus ${TM.round}/${TM.rounds}`), h('b', { class: 'num' }, fmtT(TM.left)),
      h('button', { class: 'ibtn', 'aria-label': TM.paused ? 'Resume' : 'Pause', html: A.icon(TM.paused ? 'play' : 'pause'), onclick: () => { TM.paused = !TM.paused; renderTimer(); } }),
      h('button', { class: 'ibtn', 'aria-label': 'End session', html: A.icon('close'), onclick: () => timerStop() }));
  }

  /* ---------- version history (snapshots kept on this device) ---------- */
  const VER = (NB.versions = {});
  const verKey = (id) => 'ver_' + id;
  VER.list = async (id) => {
    try { const b = await A.store.loadFile(verKey(id), 'application/json'); return b ? JSON.parse(await b.text()) : []; } catch (e) { return []; }
  };
  VER.snapshot = async (label) => {
    const doc = D.doc;
    if (!doc) return;
    const list = await VER.list(doc.id);
    const data = JSON.stringify({ layers: doc.layers, pages: doc.pages, page: doc.page, artboards: doc.artboards, paper: doc.paper, recordings: doc.recordings });
    if (data.length > 25e6) return;
    if (list.length && list[list.length - 1].data === data) return;
    let thumb = null;
    try { thumb = R.thumbnail(doc, 180, 240).toDataURL('image/jpeg', 0.6); } catch (e) { /* ignore */ }
    list.push({ t: Date.now(), label: label || '', pages: doc.pages ? doc.pages.length : 0, thumb, data });
    while (list.length > 15) list.shift();
    await A.store.saveFile(verKey(doc.id), new Blob([JSON.stringify(list)], { type: 'application/json' }));
  };
  let lastSnap = 0;
  VER.autoSnapshot = () => { lastSnap = Date.now(); setTimeout(() => VER.snapshot('Opened'), 1500); };
  A.on('doc:changed', A.debounce(() => { if (D.doc && Date.now() - lastSnap > 10 * 60 * 1000) { lastSnap = Date.now(); VER.snapshot(); } }, 5000));
  VER.open = async () => {
    const doc = D.doc;
    const list = (await VER.list(doc.id)).slice().reverse();
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    const grid = h('div', { class: 'ver-grid' });
    if (!list.length) grid.append(h('p', { class: 'muted' }, 'No earlier versions yet. Axiom keeps a snapshot each time you open this notebook and every ten minutes while you edit.'));
    list.forEach((v) => grid.append(h('div', { class: 'ver' },
      v.thumb ? h('img', { src: v.thumb, alt: '' }) : h('span', { class: 'ver-ph' }),
      h('div', { class: 'ver-t' }, new Date(v.t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
      h('div', { class: 'ver-d muted small' }, `${v.pages ? v.pages + ' pages' : ''}${v.label ? ' · ' + v.label : ''}`),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await A.dialog({ title: 'Restore this version?', body: 'The current state is kept as a version too, so you can switch back.', okText: 'Restore' }))) return;
        await VER.snapshot('Before restore');
        const snap = JSON.parse(v.data);
        D.begin();
        Object.assign(doc, snap);
        D.commit('all');
        D.normalize(doc);
        A.emit('pages'); A.emit('layers'); R.render(); close();
        A.toast('Version restored. Undo brings the newer state back.', 2600);
      } }, 'Restore'))));
    back.append(h('div', { class: 'modal wide', role: 'dialog', 'aria-label': 'Version history' }, h('h3', null, 'Version history'),
      h('p', { class: 'muted' }, 'Snapshots of “' + doc.name + '” saved on this device (the last 15).'), grid,
      h('div', { class: 'row end', style: { marginTop: '18px' } }, h('button', { class: 'btn primary', onclick: close }, 'Done'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  };
  NB.timerDialog = timerDialog;

  /* put a book page or a problem at the top of the next free page, ready to solve under it */
  NB.placeReference = (url, iw, ih, opts = {}) => {
    const doc = D.doc;
    const pageUsed = (i) => { const rc = D.pageRect(doc, i); return doc.layers.some((l) => l.items.some((it) => G.bbHit(it.bb, rc) && D.pageAt(doc, (it.bb[0] + it.bb[2]) / 2, (it.bb[1] + it.bb[3]) / 2) === i)); };
    let at = R.currentPage();
    if (pageUsed(at)) { at += 1; if (at >= doc.pages.length || pageUsed(at)) D.insertPage(at, { template: D.pageTemplate(doc, at - 1) }); }
    const rc = D.pageRect(doc, at), [pw] = D.pageSize(doc);
    const margin = 14 * D.MM;
    const s = Math.min((pw - margin * 2) / iw, opts.full ? (rc[3] - rc[1] - margin * 2) / ih : (rc[3] - rc[1]) * 0.45 / ih);
    const it = { id: A.uid(), t: 'i', src: url, iw, ih, m: [s, 0, 0, s, rc[0] + (pw - iw * s) / 2, rc[1] + margin], o: 1, ref: opts.label || 'reference' };
    it.bb = B.imageBB(it);
    // pages and problems are the paper you write on: they live on a locked background layer, so the pen never picks them up
    D.begin();
    let l = doc.layers.find((x) => x.pdfLayer);
    if (!l) { l = D.newLayer('Imported pages'); l.pdfLayer = true; doc.layers.unshift(l); }
    l.locked = true;
    l.items = l.items.concat([it]);
    D.commit('all');
    A.emit('layers');
    R.showPage(at, true); R.render(); A.emit('layers:thumbs');
    return it;
  };
  function bookBesideMenu(anchor) {
    const docs = A.ST.docs().filter((d) => d.type !== 'epub').sort((a, b) => (b.lastRead || b.added) - (a.lastRead || a.added));
    menu(anchor, (it, box) => {
      box.append(h('div', { class: 'sub' }, 'Open beside your notes'));
      if (!docs.length) box.append(h('p', { class: 'nb-hint', style: { padding: '4px 14px 10px' } }, 'Add books or problem sets in Books first.'));
      docs.slice(0, 8).forEach((d) => it(d.kind === 'sheet' ? 'file' : 'book', d.name, () => A.ST.openDoc(d.id, d.lastPage || 1), '', d.pages ? `p. ${d.lastPage || 1} of ${d.pages}` : ''));
    }, 'left');
  }
})();
