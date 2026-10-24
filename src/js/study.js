/* Axiom study panel: docked side panel with the tutor and any number of PDFs / problem photos */
'use strict';
(() => {
  const D = A.D, R = A.R, h = A.h;
  const S = A.settings;
  const ST = (A.ST = {});
  let host, tabsEl, bodyEl, view = null;
  const views = new Map(); // docId -> DocView (kept alive while the tab is open)
  const pdfCache = new Map();

  /* ---------- pdf.js loader (bundled copy first, CDN fallback) ---------- */
  const loadScript = (src) => new Promise((res, rej) => { const s = h('script', { src }); s.onload = res; s.onerror = rej; document.head.append(s); });
  ST.pdfLib = async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    try {
      await loadScript('vendor/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    } catch (e) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return window.pdfjsLib;
  };
  ST.epubLib = async () => {
    if (window.ePub) return window.ePub;
    try { if (!window.JSZip) await loadScript('vendor/jszip.min.js'); await loadScript('vendor/epub.min.js'); }
    catch (e) { if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'); await loadScript('https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js'); }
    return window.ePub;
  };
  ST.loadPdf = async (meta) => {
    if (pdfCache.has(meta.id)) return pdfCache.get(meta.id);
    const lib = await ST.pdfLib();
    const blob = await A.store.loadFile('doc_' + meta.id, 'application/pdf');
    if (!blob) throw new Error('missing file');
    const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    pdfCache.set(meta.id, pdf);
    if (pdfCache.size > 5) { const k = pdfCache.keys().next().value; try { pdfCache.get(k).destroy(); } catch (e) { /* ignore */ } pdfCache.delete(k); }
    return pdf;
  };
  ST.pdfError = (e) => {
    const n = (e && (e.name || '')) + ' ' + (e && (e.message || ''));
    if (/missing file/.test(n)) return 'This PDF\'s file is missing. Remove it and import it again.';
    if (/Password/i.test(n)) return 'This PDF is password-protected. Remove the password and import it again.';
    if (/Invalid|Missing PDF|corrupt/i.test(n)) return 'This file does not look like a valid PDF, or it is damaged.';
    return 'This PDF could not be opened (' + (n.trim() || 'unknown error') + ').';
  };
  ST.renderPage = async (meta, n, scale = 2, type = 'image/jpeg') => {
    const pdf = await ST.loadPdf(meta);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale });
    const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas: c, url: c.toDataURL(type, 0.86), w1: page.getViewport({ scale: 1 }).width };
  };

  /* ---------- documents library ---------- */
  ST.docs = () => S.documents || [];
  ST.doc = (id) => ST.docs().find((d) => d.id === id);
  ST.updateDoc = (id, patch) => { const d = ST.doc(id); if (d) { Object.assign(d, patch); A.saveSettings(); } };
  ST.importFile = async (file, subject) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isEpub = file.type === 'application/epub+zip' || /\.epub$/i.test(file.name);
    const isImg = file.type.startsWith('image/');
    if (!isPdf && !isImg && !isEpub) { A.toast('Choose a PDF, an EPUB book or an image'); return null; }
    const id = A.uid();
    A.toast('Adding ' + file.name + '…', 1500);
    await A.store.saveFile('doc_' + id, file);
    const meta = { id, name: file.name.replace(/\.(pdf|epub|png|jpe?g|heic|webp)$/i, '').slice(0, 80) || 'Document', type: isPdf ? 'pdf' : isEpub ? 'epub' : 'image', kind: isEpub ? 'book' : undefined, mime: file.type || (isPdf ? 'application/pdf' : isEpub ? 'application/epub+zip' : 'image/jpeg'), subject: subject ?? (D.doc && D.doc.subject) ?? null, size: file.size, added: Date.now(), lastPage: 1 };
    S.documents = ST.docs().concat([meta]);
    A.saveSettings();
    A.emit('documents');
    ST.makeCover(meta).catch(() => {});
    return meta;
  };
  /* cover image (page 1) + book/problem-set guess from the page count */
  const coverBusy = new Set();
  ST.makeCover = async (meta) => {
    if (meta.cover || coverBusy.has(meta.id)) return;
    coverBusy.add(meta.id);
    try {
      if (meta.type === 'pdf') {
        const pdf = await ST.loadPdf(meta);
        const page = await pdf.getPage(1);
        const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 360 / vp1.width });
        const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        ST.updateDoc(meta.id, { cover: c.toDataURL('image/jpeg', 0.8), pages: pdf.numPages, kind: meta.kind || (pdf.numPages >= 30 ? 'book' : 'sheet') });
      } else if (meta.type === 'epub') {
        const ePub = await ST.epubLib();
        const blob = await A.store.loadFile('doc_' + meta.id, 'application/epub+zip');
        const book = ePub(await blob.arrayBuffer());
        const md = await book.loaded.metadata.catch(() => null);
        let cover = null;
        try { const url = await book.coverUrl(); if (url) cover = await blobToJpeg(await (await fetch(url)).blob(), 360); } catch (e) { /* no cover image */ }
        const patch = { kind: 'book', pages: null };
        if (cover) patch.cover = cover;
        if (md && md.title && /[_.-]|^\w+$/.test(meta.name)) patch.name = md.title.slice(0, 80);
        if (md && md.creator) patch.author = String(md.creator).slice(0, 60);
        ST.updateDoc(meta.id, patch);
        Promise.resolve(book.ready).catch(() => {}).then(() => { try { book.destroy(); } catch (e) { /* ignore */ } });
        if (!cover) { coverBusy.delete(meta.id); A.emit('cover', meta.id); return; }
      } else {
        const blob = await A.store.loadFile('doc_' + meta.id, meta.mime);
        ST.updateDoc(meta.id, { cover: await blobToJpeg(blob, 360), pages: 1, kind: meta.kind || 'sheet' });
      }
      A.emit('cover', meta.id);
    } catch (e) { /* leave the placeholder cover */ }
    coverBusy.delete(meta.id);
  };
  ST.deleteDoc = async (id) => {
    S.documents = ST.docs().filter((d) => d.id !== id); A.saveSettings();
    try { await A.store.deleteFile('doc_' + id); } catch (e) { /* ignore */ }
    pdfCache.delete(id); views.delete(id);
    A.emit('documents');
  };
  ST.pickFile = (accept = 'application/pdf,.pdf,application/epub+zip,.epub,image/*') => new Promise((res) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { res(inp.files && inp.files[0]); inp.remove(); });
    document.body.append(inp); inp.click();
  });

  /* ---------- panel open/close/resize ---------- */
  const cv = () => A.$('#canvas-view');
  ST.isOpen = () => cv().classList.contains('split');
  const applyWidth = () => {
    const max = Math.max(320, innerWidth * 0.7);
    const w = A.clamp(S.panelW || Math.round(innerWidth * 0.42), 300, max);
    cv().style.setProperty('--spw', w + 'px');
  };
  ST.toggle = (open = !ST.isOpen()) => {
    if (!D.doc) return;
    cv().classList.toggle('split', open);
    host.hidden = !open;
    D.doc.studyOpen = open;
    const b = A.$('#btn-study'); if (b) b.classList.toggle('on', open);
    applyWidth();
    requestAnimationFrame(() => { R.resize(); R.render(); A.UI.renderTools && A.UI.renderTools(); });
    if (open) renderTabs();
  };
  const bindResize = (grip) => {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const mv = (ev) => { S.panelW = Math.round(innerWidth - ev.clientX); applyWidth(); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); A.saveSettings(); R.resize(); R.render(); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
  };

  /* ---------- tabs ---------- */
  const tabState = () => {
    const doc = D.doc;
    if (!doc.studyTabs) doc.studyTabs = [];
    doc.studyTabs = doc.studyTabs.filter((id) => ST.doc(id));
    if (!doc.studyActive || (doc.studyActive !== 'ai' && !ST.doc(doc.studyActive))) doc.studyActive = 'ai';
    return doc;
  };
  ST.activeDoc = () => { if (!D.doc) return null; const d = tabState(); return d.studyActive !== 'ai' ? ST.doc(d.studyActive) : (d.studyTabs.length ? ST.doc(d.lastDocTab) || ST.doc(d.studyTabs[d.studyTabs.length - 1]) : null); };
  ST.openDoc = (id, page) => {
    if (page) {
      ST.updateDoc(id, { lastPage: page });
      const v = views.get(id);
      if (v) v.ready.then(() => v.goto(page, true));
    }
    const doc = tabState();
    if (!doc.studyTabs.includes(id)) doc.studyTabs.push(id);
    doc.studyActive = id; doc.lastDocTab = id;
    D.changed('meta');
    if (!ST.isOpen()) ST.toggle(true); else renderTabs();
  };
  ST.showTutor = () => { const doc = tabState(); doc.studyActive = 'ai'; if (!ST.isOpen()) ST.toggle(true); else renderTabs(); };
  const closeTab = (id) => {
    const doc = tabState();
    doc.studyTabs = doc.studyTabs.filter((x) => x !== id);
    views.delete(id);
    if (doc.studyActive === id) doc.studyActive = doc.studyTabs[doc.studyTabs.length - 1] || 'ai';
    D.changed('meta');
    renderTabs();
  };
  function renderTabs() {
    if (!host || host.hidden || !D.doc) return;
    const doc = tabState();
    tabsEl.innerHTML = '';
    const tab = (id, label, icon, closable) => {
      const t = h('div', { class: 'sp-tab' + (doc.studyActive === id ? ' on' : ''), role: 'tab', tabindex: 0 });
      t.append(A.iconEl(icon), h('span', { class: 'sp-tab-name' }, label));
      if (closable) t.append(h('button', { class: 'sp-x', 'aria-label': 'Close ' + label, html: A.icon('close'), onclick: (e) => { e.stopPropagation(); closeTab(id); } }));
      t.addEventListener('click', () => { doc.studyActive = id; if (id !== 'ai') doc.lastDocTab = id; renderTabs(); });
      tabsEl.append(t);
    };
    tab('ai', 'Tutor', 'spark', false);
    doc.studyTabs.forEach((id) => { const m = ST.doc(id); tab(id, m.name, m.type === 'pdf' ? 'pdf' : 'image', true); });
    const plus = h('button', { class: 'ibtn sp-plus', title: 'Open a document', 'aria-label': 'Open a document', html: A.icon('plus') });
    plus.addEventListener('click', () => openMenu(plus));
    tabsEl.append(plus);
    // body
    if (view && view.detach) view.detach();
    bodyEl.innerHTML = '';
    if (doc.studyActive === 'ai') { view = null; A.AI.mount(bodyEl, A.AI.canvasCtx); }
    else {
      const meta = ST.doc(doc.studyActive);
      let v = views.get(meta.id);
      if (!v) { v = new DocView(meta); views.set(meta.id, v); }
      view = v;
      v.attach(bodyEl);
    }
  }
  ST.renderTabs = renderTabs;

  function openMenu(anchor) {
    const box = h('div', { class: 'menu doc-menu' });
    const it = (icon, label, fn) => { const b = h('button', { onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
    it('pdf', 'Import PDF or photo…', async () => { const f = await ST.pickFile(); if (!f) return; const m = await ST.importFile(f); if (m) ST.openDoc(m.id); });
    const subj = D.doc.subject;
    const docs = ST.docs().slice().sort((a, b) => (b.subject === subj) - (a.subject === subj) || b.added - a.added);
    if (docs.length) box.append(h('hr'), h('div', { class: 'sub' }, 'Library'));
    docs.slice(0, 30).forEach((m) => {
      const b = h('button', { onclick: () => { A.closePopovers(); ST.openDoc(m.id); } });
      b.innerHTML = A.icon(m.type === 'pdf' ? 'pdf' : 'image');
      b.append(h('span', { class: 'grow' }, m.name), m.subject ? h('i', { class: 'dot', style: { background: A.SU.color(m.subject) } }) : '');
      box.append(b);
    });
    A.popover(box, anchor, { side: 'down' });
  }

  /* ---------- document viewer ---------- */
  class DocView {
    constructor(meta) {
      this.meta = meta;
      this.zoom = 1;
      this.page = meta.lastPage || 1;
      this.el = h('div', { class: 'docview' });
      this.bar = h('div', { class: 'dv-bar' });
      this.scroller = h('div', { class: 'dv-scroll' });
      this.inner = h('div', { class: 'dv-inner' });
      this.scroller.append(this.inner);
      this.el.append(this.bar, this.scroller);
      this.pages = [];
      this.ready = this.init();
    }
    attach(parent) {
      parent.append(this.el);
      this.ready.then(() => { this.layout(true); });
    }
    detach() { this.meta.lastPage = this.page; ST.updateDoc(this.meta.id, { lastPage: this.page }); }
    async init() {
      const m = this.meta;
      const pageLbl = h('input', { class: 'dv-page num', id: 'dv-page-' + m.id, value: String(this.page), inputmode: 'numeric', 'aria-label': 'Page' });
      this.pageLbl = pageLbl;
      this.countLbl = h('span', { class: 'muted small num' }, '');
      pageLbl.addEventListener('change', () => this.goto(parseInt(pageLbl.value, 10) || 1));
      const ib = (icon, title, fn) => { const b = h('button', { class: 'ibtn', title, 'aria-label': title, html: A.icon(icon) }); b.addEventListener('click', fn); return b; };
      this.bar.append(
        m.type === 'pdf' ? h('div', { class: 'row', style: { gap: '4px' } }, ib('chevup', 'Previous page', () => this.goto(this.page - 1)), pageLbl, this.countLbl, ib('chevdown', 'Next page', () => this.goto(this.page + 1))) : h('span', { class: 'muted small' }, 'Photo'),
        h('div', { class: 'grow' }),
        ib('minus', 'Zoom out', () => this.setZoom(this.zoom / 1.25)),
        ib('plus', 'Zoom in', () => this.setZoom(this.zoom * 1.25)),
        ib('spark', 'Ask the tutor about this page', () => this.askTutor()),
        ib('more', 'More', (e) => this.more(e.currentTarget)));
      if (m.type === 'epub') {
        this.inner.append(h('div', { class: 'dv-epub-note' }, h('p', { class: 'muted' }, 'EPUB books open in the reader, with the tutor beside the text.'), h('button', { class: 'btn primary', onclick: () => A.emit('read', m.id) }, 'Open in the reader')));
        return;
      }
      if (m.type === 'image') {
        const blob = await A.store.loadFile('doc_' + m.id, m.mime || 'image/jpeg');
        this.imgUrl = blob ? URL.createObjectURL(blob) : '';
        const img = h('img', { src: this.imgUrl, class: 'dv-img', alt: m.name });
        this.inner.append(img);
        this.imgEl = img;
        return;
      }
      try {
        this.pdf = await ST.loadPdf(m);
      } catch (e) {
        console.error(e);
        this.inner.append(h('p', { class: 'muted', style: { padding: '20px' } }, ST.pdfError(e)));
        return;
      }
      const n = this.pdf.numPages;
      this.countLbl.textContent = '/ ' + n;
      const p1 = await this.pdf.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      this.aspect = vp.height / vp.width;
      for (let i = 1; i <= n; i++) {
        const d = h('div', { class: 'dv-pg', dataset: { n: i } }, h('span', { class: 'dv-pgnum num' }, String(i)));
        this.inner.append(d);
        this.pages.push({ el: d, n: i, canvas: null, scale: 0, aspect: this.aspect });
      }
      this.io = new IntersectionObserver((ents) => ents.forEach((en) => { const p = this.pages[+en.target.dataset.n - 1]; p.visible = en.isIntersecting; if (en.isIntersecting) this.renderPage(p); }), { root: this.scroller, rootMargin: '800px 0px' });
      this.pages.forEach((p) => this.io.observe(p.el));
      this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
      this.bindPinch();
    }
    width() { return Math.max(200, (this.scroller.clientWidth || 400) - 24) * this.zoom; }
    layout(restore) {
      if (this.imgEl) { this.imgEl.style.width = this.width() + 'px'; return; }
      if (!this.pages.length) return;
      const w = this.width();
      this.inner.style.width = w + 'px';
      this.pages.forEach((p) => { p.el.style.width = w + 'px'; p.el.style.height = Math.round(w * p.aspect) + 'px'; if (p.canvas && Math.abs(p.scale - w) > 2) { p.canvas.remove(); p.canvas = null; if (p.visible) this.renderPage(p); } });
      if (restore) requestAnimationFrame(() => this.goto(this.page, true));
    }
    setZoom(z) {
      const frac = this.scroller.scrollTop / Math.max(1, this.scroller.scrollHeight);
      this.zoom = A.clamp(z, 0.5, 4);
      this.layout(false);
      this.scroller.scrollTop = frac * this.scroller.scrollHeight;
    }
    async renderPage(p) {
      if (!this.pdf || p.busy) return;
      const w = this.width();
      if (p.canvas && Math.abs(p.scale - w) < 2) return;
      p.busy = true;
      try {
        const page = await this.pdf.getPage(p.n);
        const vp1 = page.getViewport({ scale: 1 });
        p.aspect = vp1.height / vp1.width;
        p.el.style.height = Math.round(w * p.aspect) + 'px';
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (w / vp1.width) * dpr });
        const c = h('canvas', { class: 'dv-canvas' });
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (p.canvas) p.canvas.remove();
        p.canvas = c; p.scale = w;
        p.el.append(c);
        // free far-away pages
        const near = this.page;
        this.pages.forEach((q) => { if (q.canvas && Math.abs(q.n - near) > 6) { q.canvas.remove(); q.canvas = null; } });
      } catch (e) { /* page render failed; keep placeholder */ }
      p.busy = false;
    }
    onScroll() {
      const mid = this.scroller.scrollTop + this.scroller.clientHeight * 0.35;
      let n = 1;
      for (const p of this.pages) { if (p.el.offsetTop <= mid) n = p.n; else break; }
      if (n !== this.page) { this.page = n; this.pageLbl.value = String(n); clearTimeout(this._st); this._st = setTimeout(() => ST.updateDoc(this.meta.id, { lastPage: n }), 500); }
    }
    goto(n, instant) {
      if (!this.pages.length) return;
      n = A.clamp(n, 1, this.pages.length);
      this.page = n; this.pageLbl.value = String(n);
      this.scroller.scrollTo({ top: this.pages[n - 1].el.offsetTop - 8, behavior: instant ? 'auto' : 'smooth' });
    }
    bindPinch() {
      const pts = new Map(); let d0 = 0, z0 = 1;
      this.scroller.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = this.zoom; } });
      this.scroller.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2 && d0) { const [a, b] = [...pts.values()]; const k = Math.hypot(a[0] - b[0], a[1] - b[1]) / d0; this.inner.style.transformOrigin = 'top center'; this.inner.style.transform = `scale(${A.clamp(z0 * k, 0.5, 4) / this.zoom})`; this._pz = A.clamp(z0 * k, 0.5, 4); }
      });
      const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2 && this._pz) { this.inner.style.transform = ''; this.setZoom(this._pz); this._pz = 0; d0 = 0; } };
      this.scroller.addEventListener('pointerup', end); this.scroller.addEventListener('pointercancel', end);
    }
    async pageImage(scale = 1.6) {
      if (this.meta.type === 'image') return blobToJpeg(await A.store.loadFile('doc_' + this.meta.id, this.meta.mime), 1600);
      const r = await ST.renderPage(this.meta, this.page, scale);
      return r.url;
    }
    async askTutor() {
      const url = await this.pageImage();
      A.AI.attach({ kind: 'image', label: this.meta.type === 'pdf' ? `${this.meta.name} · p. ${this.page}` : this.meta.name, url });
      ST.showTutor();
    }
    more(anchor) {
      const box = h('div', { class: 'menu' });
      const it = (icon, label, fn) => { const b = h('button', { onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); box.append(b); };
      const nb = D.isNotebook();
      it('image', nb ? 'Put this page in the notebook' : 'Put this page on the canvas', async () => {
        if (this.meta.type === 'pdf') {
          const r = await ST.renderPage(this.meta, this.page, 2);
          if (nb) A.NB.placeReference(r.url, r.canvas.width, r.canvas.height); else A.UI.placeImage(r.url, r.canvas.width, r.canvas.height, { width: r.w1 * (96 / 72) });
        } else { const url = await this.pageImage(); const im = new Image(); im.onload = () => (nb ? A.NB.placeReference(url, im.naturalWidth, im.naturalHeight) : A.UI.placeImage(url, im.naturalWidth, im.naturalHeight)); im.src = url; }
        A.toast(nb ? 'Page added to your notebook: write on it with the Pencil' : 'Page placed on the canvas: write on it with the Pencil');
      });
      if (this.meta.type === 'pdf') it('layers', 'Import all pages to annotate', async () => {
        const blob = await A.store.loadFile('doc_' + this.meta.id, 'application/pdf');
        A.UI.importPdf(new File([blob], this.meta.name + '.pdf', { type: 'application/pdf' }));
      });
      if (this.meta.type === 'pdf') it('spark', 'Give the whole document to the tutor', async () => {
        if (this.meta.size > 30e6) return A.toast('This PDF is too large to send whole. Ask about single pages instead.');
        const blob = await A.store.loadFile('doc_' + this.meta.id, 'application/pdf');
        const b64 = await blobToB64(blob);
        A.AI.attach({ kind: 'pdf', label: this.meta.name + ' (whole PDF)', b64 });
        ST.showTutor();
      });
      it('moveto', 'Course: ' + (A.SU.name(this.meta.subject) || 'none'), () => A.SU.pickMenu(anchor, this.meta.subject, (sid) => { ST.updateDoc(this.meta.id, { subject: sid }); A.emit('documents'); }));
      it('rename', 'Rename', async () => { const n = await A.dialog({ title: 'Rename document', input: this.meta.name, okText: 'Rename' }); if (n) { ST.updateDoc(this.meta.id, { name: n.slice(0, 80) }); renderTabs(); } });
      A.popover(box, anchor, { side: 'down' });
    }
  }
  const blobToB64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
  const blobToJpeg = (blob, max) => new Promise((res) => {
    const url = URL.createObjectURL(blob); const im = new Image();
    im.onload = () => { const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const c = h('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.86)); };
    im.onerror = () => res(null); im.src = url;
  });
  ST.blobToB64 = blobToB64;

  /* current page of the most recent document tab (for tutor context) */
  ST.currentPage = async () => {
    const m = ST.activeDoc();
    if (!m) return null;
    let v = views.get(m.id);
    if (!v) { v = new DocView(m); views.set(m.id, v); await v.ready; }
    const url = await v.pageImage();
    return url ? { kind: 'image', label: m.type === 'pdf' ? `${m.name} · p. ${v.page}` : m.name, url } : null;
  };

  ST.mount = (el) => {
    host = el;
    const grip = h('div', { class: 'sp-grip', title: 'Drag to resize' });
    bindResize(grip);
    tabsEl = h('div', { class: 'sp-tabs', role: 'tablist' });
    const close = h('button', { class: 'ibtn', title: 'Close panel', 'aria-label': 'Close study panel', html: A.icon('close'), onclick: () => ST.toggle(false) });
    bodyEl = h('div', { class: 'sp-body' });
    host.append(grip, h('div', { class: 'sp-head' }, tabsEl, close), bodyEl);
    addEventListener('resize', () => { if (ST.isOpen()) { applyWidth(); if (view) view.layout(false); } });
    A.on('doc:open', () => {
      views.clear();
      const open = !!(D.doc && D.doc.studyOpen);
      cv().classList.toggle('split', open);
      host.hidden = !open;
      const b = A.$('#btn-study'); if (b) b.classList.toggle('on', open);
      applyWidth();
      R.resize(); R.render(); // the stage width depends on the panel
      if (open) renderTabs();
      const pd = ST.pendingDoc && (typeof ST.pendingDoc === 'object' ? ST.pendingDoc : { id: ST.pendingDoc });
      if (pd && ST.doc(pd.id)) { ST.pendingDoc = null; setTimeout(() => ST.openDoc(pd.id, pd.page), 50); }
    });
    A.on('go:gallery', () => { if (view && view.detach) view.detach(); });
  };
})();
