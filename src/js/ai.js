/* Axiom tutor: Claude beside your canvas or your book.
   A "context" supplies where conversations live, which attach buttons appear, hidden page text,
   and what happens when the tutor cites a line ([[p12:L3-L5]]). */
'use strict';
(() => {
  const D = A.D, R = A.R, G = A.G, h = A.h;
  const S = A.settings;
  const AI = (A.AI = {});
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
  const KATEX = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/';

  AI.models = [
    { id: 'claude-opus-5-5', name: 'Opus 5.5', note: 'Most capable' },
    { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', note: 'Faster, lower cost' },
    { id: 'claude-haiku-5-5', name: 'Haiku 5.5', note: 'Quick answers' },
  ];
  AI.modes = [
    { id: 'explain', name: 'Explain', effort: 'medium' },
    { id: 'hint', name: 'Hint', effort: 'low' },
    { id: 'check', name: 'Check my work', effort: 'high' },
    { id: 'quiz', name: 'Quiz me', effort: 'medium' },
  ];
  const MODE_TEXT = {
    explain: 'Mode: EXPLAIN. Explain clearly and rigorously. Give intuition, then the precise definitions and argument. End by checking understanding with one short question when it helps.',
    hint: 'Mode: HINT (guided learning). Do not give the full solution or the final answer. Give the smallest useful next hint or a guiding question, and let the student do the work. Reveal more only when the student asks for it.',
    check: 'Mode: CHECK MY WORK. Read the student\'s handwritten work in the attached images and check it step by step against the problem (and the official solution if one is attached). Say which steps are correct. For the first error, quote the line, explain exactly why it is wrong and how to fix it. Do not rewrite the whole solution unless asked.',
    quiz: 'Mode: QUIZ. Ask one question at a time about the current material, wait for the student\'s answer, then give precise feedback and the next question. Increase difficulty gradually.',
  };

  /* ---------- lazy libraries ---------- */
  let sdkP = null, katexP = null;
  const sdk = () => (sdkP = sdkP || import(SDK_URL).then((m) => m.default || m.Anthropic));
  const katex = () => {
    if (katexP) return katexP;
    katexP = new Promise((res) => {
      document.head.append(h('link', { rel: 'stylesheet', href: KATEX + 'katex.min.css' }));
      const s = h('script', { src: KATEX + 'katex.min.js' });
      s.onload = () => res(window.katex); s.onerror = () => res(null);
      document.head.append(s);
    });
    return katexP;
  };
  AI.katex = katex;

  /* ---------- markdown + math + citations ---------- */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  AI.md = (src, kx) => {
    const math = [], code = [], cites = [];
    const keep = (tex, display) => { math.push({ tex, display }); return `\u0000${math.length - 1}\u0000`; };
    let s = String(src || '');
    s = s.replace(/```([\w-]*)\n?([\s\S]*?)(```|$)/g, (_, lang, body, end) => { code.push({ lang, body, done: !!end }); return `\u0001${code.length - 1}\u0001`; });
    s = s.replace(/\[\[p(\d+):L(\d+)(?:\s*[-–]\s*L?(\d+))?\]\]/g, (_, p, a, b) => { cites.push([+p, +a, +(b || a)]); return `\u0002${cites.length - 1}\u0002`; });
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
      .replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g, (_, pre, t) => pre + keep(t, false));
    s = esc(s);
    const inline = (t) => t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = [];
    let list = null, para = [];
    const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
    for (const raw of s.split('\n')) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushP(); flushL(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushP(); flushL(); const n = Math.min(5, m[1].length + 2); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { flushP(); flushL(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      if (/^\s*---+\s*$/.test(line)) { flushP(); flushL(); out.push('<hr>'); continue; }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    let html = out.join('');
    html = html.replace(/\u0001(\d+)\u0001/g, (_, i) => studyBlock(code[+i], kx) || '<pre><code>' + esc(code[+i].body) + '</code></pre>');
    html = html.replace(/\u0002(\d+)\u0002/g, (_, i) => { const [p, a, b] = cites[+i]; return `<button class="cite" data-p="${p}" data-a="${a}" data-b="${b}" title="Show in the book">p. ${p}${a ? ` · ${a === b ? 'line ' + a : 'lines ' + a + '–' + b}` : ''}</button>`; });
    html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
      const { tex, display } = math[+i];
      if (kx) { try { return kx.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch (e) { /* fall through */ } }
      return display ? `<div class="mathraw">${esc(tex)}</div>` : `<code class="mathraw">${esc(tex)}</code>`;
    });
    return html;
  };

  /* interactive study blocks: ```quiz [{q, options, answer, explain}]``` and ```flashcards [{front, back}]``` */
  const studyBlock = (c, kx) => {
    if (c.lang !== 'quiz' && c.lang !== 'flashcards') return null;
    if (!c.done) return `<div class="study-wait">${c.lang === 'quiz' ? 'Writing practice questions…' : 'Making flashcards…'}</div>`;
    let data;
    try { data = JSON.parse(c.body); } catch (e) { return null; }
    if (!Array.isArray(data)) return null;
    const md = (t) => AI.md(String(t || ''), kx).replace(/^<p>|<\/p>$/g, '');
    if (c.lang === 'quiz') {
      return '<div class="quiz">' + data.map((q, qi) => `<div class="qz" data-ans="${+q.answer || 0}"><div class="qz-n">Question ${qi + 1} of ${data.length}</div><div class="qz-q">${md(q.q)}</div>` +
        (q.options || []).map((o, oi) => `<button class="qz-o" data-i="${oi}"><span class="qz-l">${String.fromCharCode(65 + oi)}</span><span>${md(o)}</span></button>`).join('') +
        `<div class="qz-ex" hidden>${md(q.explain || '')}</div></div>`).join('') + '</div>';
    }
    return '<div class="fc-deck">' + data.map((f, i) => `<button class="fc" aria-label="Flashcard ${i + 1}"><span class="fc-k">${i + 1} / ${data.length}</span><span class="fc-f">${md(f.front)}</span><span class="fc-b">${md(f.back)}</span></button>`).join('') + '</div>';
  };
  document.addEventListener('click', (e) => {
    const o = e.target.closest && e.target.closest('.qz-o');
    if (o) {
      const q = o.closest('.qz');
      if (q.classList.contains('done')) return;
      const ans = +q.dataset.ans;
      q.classList.add('done');
      q.querySelectorAll('.qz-o').forEach((b) => { const i = +b.dataset.i; if (i === ans) b.classList.add('right'); else if (b === o) b.classList.add('wrong'); });
      const ex = q.querySelector('.qz-ex'); if (ex && ex.textContent.trim()) ex.hidden = false;
      return;
    }
    const f = e.target.closest && e.target.closest('.fc');
    if (f) f.classList.toggle('flip');
  });

  /* ---------- canvas snapshots ---------- */
  const regionShot = (bb, onlyIds, maxPx = 1500) => {
    const w = bb[2] - bb[0], hh = bb[3] - bb[1];
    const scale = Math.min(3, maxPx / Math.max(w, hh));
    return R.renderRegion(D.doc, bb, scale, { bg: true, grid: false, onlyIds }).toDataURL('image/jpeg', 0.86);
  };
  AI.shotCanvas = () => ({ kind: 'image', label: 'Canvas view', url: regionShot(R.visibleBB(), null) });
  AI.shotSelection = () => {
    if (!R.sel.size || !A.SEL.box) return null;
    const p = 20 / D.doc.view.zoom, b = A.SEL.box;
    return { kind: 'image', label: `Selection (${R.sel.size})`, url: regionShot([b[0] - p, b[1] - p, b[2] + p, b[3] + p], new Set(R.sel)) };
  };
  const shrink = (url, max = 900) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const c = h('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.82)); };
    im.onerror = () => res(url); im.src = url;
  });
  AI.shrink = shrink;

  /* ---------- the canvas context (conversations saved with the drawing) ---------- */
  AI.canvasCtx = {
    kind: 'canvas',
    store: () => D.doc,
    chats: () => (D.doc.chats = D.doc.chats || []),
    save: () => D.changed('meta'),
    subject: () => D.doc.subject,
    emptyTitle: () => (A.SU.name(D.doc.subject) ? `Tutor for ${A.SU.name(D.doc.subject)}` : 'Your tutor'),
    emptyText: 'Ask about a concept, a page of your PDF, or your own handwritten solution. Add your canvas, a selection or the current page with the buttons below, so you never need screenshots.',
    attachButtons: () => {
      if (D.isNotebook()) {
        const b = [{ icon: 'template', label: 'This page', fn: () => AI.attach(AI.shotPage(R.currentPage())) }];
        if (R.sel.size) b.push({ icon: 'selectall', label: 'Selection', fn: () => AI.attach(AI.shotSelection()) });
        return b;
      }
      const b = [{ icon: 'image', label: 'Canvas', fn: () => AI.attach(AI.shotCanvas()) }];
      if (R.sel.size) b.push({ icon: 'selectall', label: 'Selection', fn: () => AI.attach(AI.shotSelection()) });
      if (A.ST.activeDoc()) b.push({ icon: 'pdf', label: 'Current page', fn: async () => AI.attach(await A.ST.currentPage()) });
      return b;
    },
    autoAttach: (mode, atts) => { if (mode === 'check' && !atts.some((a) => a.kind === 'image')) atts.unshift(D.isNotebook() ? AI.shotPage(R.currentPage()) : AI.shotCanvas()); },
    get tips() {
      return D.isNotebook() ? ['Summarize this notebook as smart notes', 'Make 5 practice questions from my notes', 'Make flashcards from my notes', 'Check my work on this page'] : undefined;
    },
    systemExtra: () => (D.isNotebook() ? `They are in a notebook called "${D.doc.name}" with ${D.doc.pages.length} pages of handwritten notes (page images are attached when relevant).` : ''),
  };
  /* notebook pages as images for the tutor */
  AI.shotPage = (i) => {
    const rc = D.pageRect(D.doc, i);
    return { kind: 'image', label: `Page ${i + 1}`, url: regionShot(rc, null, 1400) };
  };
  AI.notePages = () => {
    const doc = D.doc;
    return D.pageRects(doc).map((rc, i) => i).filter((i) => doc.layers.some((l) => l.items.some((it) => G.bbHit(it.bb, D.pageRect(doc, i)))));
  };
  AI.shotPages = (max = 12) => {
    let pages = AI.notePages();
    if (pages.length > max) { const cur = R.currentPage(); pages = pages.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur)).slice(0, max).sort((a, b) => a - b); }
    return pages.map((i) => Object.assign(AI.shotPage(i), { keep: false }));
  };

  /* ---------- conversation state ---------- */
  AI.pending = [];
  const sessionPdf = new Map();
  let ctx = AI.canvasCtx, mode = 'explain', busy = false, root = null, abortCtl = null;
  const chats = () => ctx.chats();
  const chat = () => {
    const st = ctx.store();
    let c = chats().find((x) => x.id === st.chatActive);
    if (!c) { c = { id: A.uid(), title: 'New conversation', created: Date.now(), msgs: [] }; chats().push(c); st.chatActive = c.id; }
    return c;
  };
  AI.attach = (att) => { if (!att) return; att.id = att.id || A.uid(); AI.pending.push(att); if (root && root.isConnected) drawChips(); };
  AI.setMode = (m) => { mode = m; if (root && root.isConnected) draw(); };
  AI.ask = (text, opts = {}) => {
    if (opts.mode) mode = opts.mode;
    (opts.attachments || []).forEach(AI.attach);
    if (!root || !root.isConnected) return;
    draw();
    if (!S.aiKey && S.aiMode !== 'app') return;
    els.ta.value = text || '';
    if (opts.send !== false && text) send(); else els.ta.focus();
  };

  /* ---------- context scope: what the tutor keeps in mind besides what is on screen ---------- */
  const scopeOf = () => { const st = ctx.store(); return (st.scope = st.scope || { src: 'here', books: [], web: false }); };
  const here = () => {
    if (ctx.kind === 'reader') { const id = ctx.docId && ctx.docId(); const m = id && A.ST.doc(id); return { kind: 'book', id, folder: m && m.folder, subject: ctx.subject(), name: m ? m.title || m.name : '' }; }
    return { kind: D.isNotebook() ? 'notebook' : 'canvas', id: D.doc.id, folder: D.doc.folder || null, subject: D.doc.subject || null, name: D.doc.name };
  };
  const folderName = (id) => { const f = (S.folders || []).find((x) => x.id === id); return f ? f.name : ''; };
  const scopeChoices = () => {
    const cur = here(), out = [{ src: 'here', label: 'On screen', hint: cur.kind === 'canvas' ? 'What you attach · fastest' : 'The page you’re on · fastest' }];
    if (cur.kind === 'book') out.push({ src: 'book', label: 'Whole book', hint: 'Every chapter’s definitions and results' });
    if (cur.kind === 'notebook') out.push({ src: 'notebook', label: 'Whole notebook', hint: 'Every written page' });
    if (cur.folder) out.push({ src: 'folder', label: 'Folder · ' + folderName(cur.folder), hint: 'Its books and notes' });
    if (cur.subject && A.SU.name(cur.subject)) out.push({ src: 'course', label: 'Course · ' + A.SU.name(cur.subject), hint: 'All books and notes in the course' });
    out.push({ src: 'pick', label: 'Choose books…', hint: 'Any books from your library' });
    return out;
  };
  const scopeLabel = () => { const sc = scopeOf(); const c = scopeChoices().find((x) => x.src === sc.src) || { label: 'On screen' }; return sc.src === 'pick' ? (sc.books.length === 1 ? (A.ST.doc(sc.books[0]) || {}).name || '1 book' : sc.books.length + ' books') : c.label.replace(/^(Folder|Course) · /, ''); };
  const scopeCache = new Map();
  A.on('doc:open', () => scopeCache.clear());
  /* gather the scope: text (outlines, definitions, results) goes in the cached system prompt; note pages go as images */
  const gatherScope = async () => {
    const sc = scopeOf(), cur = here();
    if (sc.src === 'here') return { text: '', images: [], tokens: 0 };
    const key = JSON.stringify([sc.src, sc.books, cur.id]);
    if (scopeCache.has(key)) return scopeCache.get(key);
    let books = [], notes = [];
    const metas = sc.src === 'folder' || sc.src === 'course' ? await A.store.listMeta() : [];
    if (sc.src === 'book') books = [cur.id];
    if (sc.src === 'pick') books = sc.books.slice();
    if (sc.src === 'folder') { books = A.ST.docs().filter((d) => d.folder === cur.folder).map((d) => d.id); notes = metas.filter((m) => m.folder === cur.folder); }
    if (sc.src === 'course') { books = A.ST.docs().filter((d) => d.subject === cur.subject).map((d) => d.id); notes = metas.filter((m) => m.subject === cur.subject); }
    if (sc.src === 'notebook') notes = [{ id: cur.id, kind: 'notebook', name: cur.name }];
    if (cur.kind === 'book' && sc.src !== 'book') books = books.filter((id) => id !== cur.id); // the open book already comes with the page context
    const budget = sc.src === 'book' ? 90000 : Math.max(14000, Math.floor(140000 / Math.max(1, books.length)));
    const parts = [];
    for (const id of books.slice(0, 12)) { const d = await A.RD.bookDigest(id, budget); parts.push(d.text); }
    const images = [];
    const MAXIMG = 16;
    for (const m of notes) {
      if (images.length >= MAXIMG) break;
      const doc = cur.kind !== 'book' && m.id === D.doc.id ? D.doc : await A.store.loadDoc(m.id).catch(() => null);
      if (!doc) continue;
      const shot = (bb, label) => { try { const w = bb[2] - bb[0], hh = bb[3] - bb[1]; const k = Math.min(2, 760 / Math.max(w, hh)); images.push({ kind: 'image', label, url: R.renderRegion(doc, bb, k, { bg: true, grid: false }).toDataURL('image/jpeg', 0.8) }); } catch (e) { /* skip */ } };
      if (doc.kind === 'notebook') {
        D.pageRects(doc).forEach((rc, i) => { if (images.length < MAXIMG && doc.layers.some((l) => l.items.some((it) => G.bbHit(it.bb, rc)))) shot(rc, `${doc.name} · page ${i + 1}`); });
      } else {
        let bb = null;
        doc.layers.forEach((l) => l.items.forEach((it) => { bb = bb ? [Math.min(bb[0], it.bb[0]), Math.min(bb[1], it.bb[1]), Math.max(bb[2], it.bb[2]), Math.max(bb[3], it.bb[3])] : it.bb.slice(); }));
        if (bb) shot([bb[0] - 20, bb[1] - 20, bb[2] + 20, bb[3] + 20], `${doc.name} (canvas)`);
      }
    }
    const scopeName = scopeChoices().find((x) => x.src === sc.src);
    const text = parts.length || images.length ? [
      `The student asked you to keep this wider context in mind (${scopeName ? scopeName.label : 'chosen books'}). Use it to connect the question to what they have read and written; cite page numbers when you rely on it.`,
      ...parts,
      images.length ? `Their handwritten notes are attached as ${images.length} page image${images.length > 1 ? 's' : ''} (${images.map((i) => i.label).join('; ')}).` : '',
    ].filter(Boolean).join('\n\n') : '';
    const res = { text, images, tokens: Math.round(text.length / 3.6 + images.length * 900) };
    scopeCache.set(key, res);
    return res;
  };
  const estimate = (src) => {
    const cur = here();
    const nb = (n) => n * 900, bk = (n, per) => n * per;
    if (src === 'here') return '';
    if (src === 'book') return '≈ 25k tokens';
    if (src === 'notebook') return '≈ ' + Math.max(1, Math.round(nb(Math.min(16, AI.notePages().length)) / 1000)) + 'k tokens';
    if (src === 'folder' || src === 'course') {
      const n = A.ST.docs().filter((d) => (src === 'folder' ? d.folder === cur.folder : d.subject === cur.subject)).length;
      return '≈ ' + Math.max(1, Math.round((bk(Math.min(n, 12), Math.min(25000, 40000 / Math.max(1, n))) + nb(8)) / 1000)) + 'k+ tokens';
    }
    return '';
  };
  function scopeMenu(anchor) {
    const sc = scopeOf();
    const box = h('div', { class: 'menu scope-menu' });
    box.append(h('div', { class: 'sub' }, 'The tutor keeps in mind'));
    scopeChoices().forEach((c) => {
      const b = h('button', { class: sc.src === c.src ? 'on' : '', onclick: () => {
        if (c.src === 'pick') { pickBooks(anchor); return; }
        A.closePopovers(); sc.src = c.src; ctx.save(); drawChips();
      } }, h('span', { class: 'sc-l' }, h('b', null, c.label), h('i', null, [c.hint, estimate(c.src)].filter(Boolean).join(' · '))), sc.src === c.src ? A.iconEl('check') : '');
      box.append(b);
    });
    if (S.aiMode !== 'app') {
      box.append(h('hr'));
      const web = h('button', { class: 'sc-web' + (sc.web ? ' on' : ''), onclick: () => { sc.web = !sc.web; ctx.save(); web.classList.toggle('on', sc.web); web.querySelector('.sw').classList.toggle('on', sc.web); drawChips(); } },
        A.iconEl('globe'), h('span', { class: 'sc-l' }, h('b', null, 'Search the web'), h('i', null, 'For sources, data and anything beyond your books')), h('span', { class: 'sw' + (sc.web ? ' on' : '') }));
      box.append(web);
    }
    A.popover(box, anchor, { side: 'up' });
  }
  function pickBooks(anchor) {
    const sc = scopeOf();
    const chosen = new Set(sc.src === 'pick' ? sc.books : []);
    const box = h('div', { class: 'menu scope-menu' });
    box.append(h('div', { class: 'sub' }, 'Choose books'));
    const list = h('div', { class: 'sc-books' });
    A.ST.docs().filter((d) => d.type !== 'image').sort((a, b) => (b.lastRead || b.added) - (a.lastRead || a.added)).forEach((d) => {
      const b = h('button', { class: chosen.has(d.id) ? 'on' : '', onclick: () => { if (chosen.has(d.id)) chosen.delete(d.id); else chosen.add(d.id); b.classList.toggle('on'); b.querySelector('.ck').classList.toggle('on'); } },
        h('span', { class: 'ck' + (chosen.has(d.id) ? ' on' : ''), html: A.icon('check') }), h('span', { class: 'grow' }, d.title || d.name));
      list.append(b);
    });
    if (!list.children.length) list.append(h('p', { class: 'muted small', style: { padding: '8px 12px' } }, 'Add books in the Books section first.'));
    box.append(list, h('div', { class: 'sc-done' }, h('button', { class: 'btn primary', onclick: () => { A.closePopovers(); sc.books = [...chosen]; sc.src = sc.books.length ? 'pick' : 'here'; ctx.save(); drawChips(); } }, 'Done')));
    A.closePopovers();
    A.popover(box, anchor, { side: 'up' });
  }

  /* ---------- UI ---------- */
  let els = {};
  AI.mount = (container, context) => {
    if (context && context !== ctx) { ctx = context; AI.pending = AI.pending.filter((a) => a.keep); }
    ctx = context || ctx;
    root = h('div', { class: 'tutor' + (ctx.kind === 'reader' ? ' reader-tutor' : '') });
    container.append(root);
    katex();
    draw();
  };
  const draw = () => {
    if (!root) return;
    root.innerHTML = '';
    if (!S.aiKey && S.aiMode !== 'app') { root.append(setupCard()); return; }
    const c = chat();
    const convBtn = h('button', { class: 'conv-btn', title: 'Conversations' }, h('span', { class: 'grow' }, c.title), A.iconEl('chevdown'));
    convBtn.addEventListener('click', () => convMenu(convBtn));
    const modeSeg = h('div', { class: 'seg mode-seg' });
    AI.modes.filter((m) => ctx.kind !== 'reader' || m.id !== 'check').forEach((m) => modeSeg.append(h('button', { class: m.id === mode ? 'on' : '', onclick: () => { mode = m.id; draw(); } }, m.name)));
    let model;
    if (S.aiMode === 'app') {
      model = h('button', { class: 'model-sel app-mode', title: 'Answers open in your Claude or ChatGPT app' }, 'Your AI app', A.iconEl('chevdown'));
      model.addEventListener('click', () => {
        const box = h('div', { class: 'menu' });
        box.append(h('div', { class: 'sub' }, 'Questions open in your Claude or ChatGPT app, using your subscription.'));
        box.append(h('button', { onclick: () => { A.closePopovers(); S.aiMode = S.aiKey ? 'key' : null; A.saveSettings(); draw(); } }, A.iconEl('spark'), S.aiKey ? 'Answer inside Axiom (API key)' : 'Use an API key instead'));
        A.popover(box, model, { side: 'down' });
      });
    } else {
      model = h('select', { class: 'model-sel', id: 'ai-model', 'aria-label': 'Model' }, ...AI.models.map((m) => h('option', { value: m.id, selected: S.aiModel === m.id }, m.name)));
      model.addEventListener('change', () => { S.aiModel = model.value; A.saveSettings(); });
    }
    const list = h('div', { class: 'msgs', 'aria-live': 'polite' });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.cite');
      if (b && ctx.onCite) ctx.onCite(+b.dataset.p, +b.dataset.a, +b.dataset.b);
      const im = e.target.closest('[data-att]');
      if (im && ctx.onAttClick) { const m = c.msgs.find((x) => (x.att || []).some((a) => a.id === im.dataset.att)); const a = m && m.att.find((x) => x.id === im.dataset.att); if (a) ctx.onAttClick(a); }
    });
    els.list = list;
    if (!c.msgs.length) list.append(emptyState());
    c.msgs.forEach((m) => list.append(msgEl(m)));
    const chipsRow = h('div', { class: 'att-row' });
    els.chips = chipsRow;
    const ta = h('textarea', { class: 'composer-in', id: 'ai-input', rows: 1, placeholder: S.aiMode === 'app' ? 'Ask… (opens in your AI app)' : ctx.placeholder ? ctx.placeholder(mode) : (mode === 'check' ? 'What should I check? (your canvas is attached)' : 'Ask about your work, a page, or a concept…') });
    els.ta = ta;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    const sendBtn = h('button', { class: 'send-btn', 'aria-label': busy ? 'Stop' : 'Send', html: A.icon(busy ? 'close' : 'send') });
    sendBtn.addEventListener('click', () => (busy ? stop() : send()));
    els.send = sendBtn;
    root.append(h('div', { class: 'tutor-head' }, h('div', { class: 'tutor-mark', html: A.icon('spark') }), convBtn, model), modeSeg, list, h('div', { class: 'composer' }, chipsRow, h('div', { class: 'composer-row' }, ta, sendBtn)));
    drawChips();
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  };
  const emptyState = () => h('div', { class: 'tutor-empty' },
    h('div', { class: 'te-mark', html: A.icon('spark') }),
    h('h4', null, ctx.emptyTitle()),
    h('p', null, ctx.emptyText),
    h('div', { class: 'te-tips' }, ...(ctx.tips || ['Check my solution on the canvas', 'Give me a hint for this problem, not the answer', 'Explain this page more rigorously', 'Quiz me on what I just read']).map((t) => h('button', { class: 'chip ghost', onclick: () => {
      if (/check/i.test(t)) mode = 'check'; else if (/hint/i.test(t)) mode = 'hint'; else if (/quiz/i.test(t)) mode = 'quiz'; else mode = 'explain';
      draw(); els.ta.value = t; els.ta.focus();
    } }, t))));
  const drawChips = () => {
    const row = els.chips;
    if (!row) return;
    row.innerHTML = '';
    AI.pending.forEach((a) => {
      row.append(h('span', { class: 'att-chip' }, a.url ? h('img', { src: a.url, alt: '' }) : A.iconEl(a.kind === 'text' ? 'book' : 'pdf'), h('span', { class: 'att-l' }, a.label),
        h('button', { class: 'chip-x', 'aria-label': 'Remove ' + a.label, html: A.icon('close'), onclick: () => { AI.pending = AI.pending.filter((x) => x !== a); if (ctx.onRemoveAtt) ctx.onRemoveAtt(a); drawChips(); } })));
    });
    const btns = (ctx.attachButtons ? ctx.attachButtons() : []).concat([{ icon: 'import', label: 'Photo', fn: async () => {
      const f = await A.ST.pickFile('image/*');
      if (!f) return;
      const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
      AI.attach({ kind: 'image', label: f.name.slice(0, 24), url: await shrink(url, 1600) });
    } }]);
    btns.forEach((b) => row.append(h('button', { class: 'att-add', onclick: b.fn }, A.iconEl(b.icon), b.label)));
    const sc = scopeOf();
    const pill = h('button', { class: 'scope-pill' + (sc.src !== 'here' || sc.web ? ' on' : ''), title: 'What the tutor keeps in mind' }, A.iconEl('layers'), h('span', null, scopeLabel()), sc.web ? h('span', { class: 'sc-webtag' }, A.iconEl('globe'), 'Web') : '', A.iconEl('chevdown'));
    pill.addEventListener('click', () => scopeMenu(pill));
    row.prepend(pill);
  };
  const msgEl = (m) => {
    if (m.role === 'user') {
      const atts = (m.att || []).map((a) => (a.url ? h('img', { class: 'msg-img' + (a.page ? ' linked' : ''), src: a.url, alt: a.label, title: a.label, dataset: { att: a.id } }) : a.kind === 'text' ? h('blockquote', { class: 'msg-quote' }, a.text.slice(0, 280) + (a.text.length > 280 ? '…' : '')) : h('span', { class: 'att-chip small' }, A.iconEl('pdf'), a.label)));
      return h('div', { class: 'msg user' }, atts.length ? h('div', { class: 'msg-atts' }, ...atts) : null, m.text ? h('div', { class: 'bubble' }, m.text) : null);
    }
    const body = h('div', { class: 'md' });
    body.innerHTML = AI.md(m.text, window.katex);
    if (!window.katex) katex().then((kx) => { if (kx) body.innerHTML = AI.md(m.text, kx); });
    const el = h('div', { class: 'msg bot' + (m.error ? ' err' : '') }, body);
    if (!m.error && m.text) {
      const copy = h('button', { class: 'msg-act', title: 'Copy', html: A.icon('copy') });
      copy.addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(m.text).then(() => A.toast('Copied'), () => {}); });
      el.append(h('div', { class: 'msg-acts' }, copy));
    }
    return el;
  };
  const convMenu = (anchor) => {
    const box = h('div', { class: 'menu' });
    const st = ctx.store();
    box.append(h('button', { onclick: () => { A.closePopovers(); const c = { id: A.uid(), title: 'New conversation', created: Date.now(), msgs: [] }; chats().push(c); st.chatActive = c.id; ctx.save(); draw(); } }, A.iconEl('plus'), 'New conversation'));
    if (chats().length) box.append(h('hr'));
    chats().slice().reverse().forEach((c) => box.append(h('button', { class: c.id === st.chatActive ? 'on' : '', onclick: () => { A.closePopovers(); st.chatActive = c.id; draw(); } }, h('span', { class: 'grow' }, c.title), h('span', { class: 'muted small num' }, A.fmtDate(c.created)))));
    if (chat().msgs.length) box.append(h('hr'), h('button', { class: 'danger', onclick: async () => {
      A.closePopovers();
      if (!(await A.dialog({ title: 'Delete this conversation?', okText: 'Delete', danger: true }))) return;
      const arr = chats(); arr.splice(arr.findIndex((c) => c.id === st.chatActive), 1); st.chatActive = null; ctx.save(); draw();
    } }, A.iconEl('trash'), 'Delete conversation'));
    A.popover(box, anchor, { side: 'down' });
  };
  const setupCard = () => {
    const inp = h('input', { class: 'field', id: 'ai-key', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false' });
    const save = h('button', { class: 'btn', onclick: () => { const v = inp.value.trim(); if (!/^sk-ant-/.test(v)) return A.toast('That doesn\'t look like an Anthropic API key (it starts with sk-ant-)'); S.aiKey = v; S.aiMode = 'key'; A.saveSettings(); A.toast('Tutor connected'); draw(); } }, 'Connect');
    const keyBox = h('div', { class: 'ts-key', hidden: true }, h('p', { class: 'small muted' }, 'Create a key at console.anthropic.com › API Keys. You pay Anthropic per use; the key stays on this device.'), h('div', { class: 'row gap' }, inp, save));
    return h('div', { class: 'tutor-setup' },
      h('div', { class: 'te-mark', html: A.icon('spark') }),
      h('h4', null, 'Choose how the tutor answers'),
      h('button', { class: 'ts-opt', onclick: () => { S.aiMode = 'app'; A.saveSettings(); draw(); } },
        h('b', null, 'My Claude or ChatGPT app'),
        h('span', null, 'Uses your existing subscription. Axiom sends your pages and question to the app, and the chat is saved in your account there.')),
      h('button', { class: 'ts-opt', onclick: () => { keyBox.hidden = !keyBox.hidden; if (!keyBox.hidden) setTimeout(() => inp.focus(), 50); } },
        h('b', null, 'Inside Axiom with an API key'),
        h('span', null, 'Answers appear right here, with tappable citations that highlight the exact lines in your book.')),
      keyBox);
  };
  /* ---------- hand-off to the Claude or ChatGPT app (no API key needed) ---------- */
  const handoffPrompt = (text, att, extra) => {
    const cur = A.SU.name(ctx.subject());
    const majors = A.SU.majorNames();
    const lines = [
      `I'm a university student${majors.length ? ' in ' + majors.join(', ') : ''}${cur ? `, working on ${cur}` : ''}. Please answer with precise mathematical language (LaTeX for math), no analogies unless I ask.`,
      MODE_TEXT[mode] ? MODE_TEXT[mode].replace(/\[\[p\d+[^\]]*\]\]/g, '') : '',
      att.some((a) => a.kind === 'image') ? `The attached image${att.filter((a) => a.kind === 'image').length > 1 ? 's are' : ' is'} from my notes or textbook (${att.filter((a) => a.kind === 'image').map((a) => a.label).join(', ')}).` : '',
      ...att.filter((a) => a.kind === 'text' && a.text).map((a) => `Selected passage:\n"""\n${a.text.slice(0, 3000)}\n"""`),
      extra ? 'Context from the page:\n' + String(extra).replace(/L\d+: /g, '').slice(0, 16000) : '',
      '',
      text || 'Please help me with this.',
    ];
    return lines.filter((x, i) => x || i === lines.length - 2).join('\n\n').trim();
  };
  AI.handoff = async (text, att, extra) => {
    const prompt = handoffPrompt(text, att, extra);
    const images = att.filter((a) => a.kind === 'image' && a.url).map((a) => a.url.split(',')[1]);
    try { await navigator.clipboard.writeText(prompt); } catch (e) { /* the native side copies it too */ }
    if (A.native) { await A.native.post({ op: 'shareItems', text: prompt, images }); return true; }
    try {
      const files = await Promise.all(images.map(async (b64, i) => new File([await (await fetch('data:image/jpeg;base64,' + b64)).blob()], `axiom-${i + 1}.jpg`, { type: 'image/jpeg' })));
      const data = files.length ? { files, text: prompt } : { text: prompt };
      if (navigator.canShare && navigator.canShare(data)) { await navigator.share(data); return true; }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    A.toast('Question copied. Paste it into Claude or ChatGPT.', 3200);
    return true;
  };

  /* ---------- request ---------- */
  const systemPrompt = () => {
    const majors = A.SU.majorNames();
    const courses = A.SU.list().map((s) => s.name);
    const cur = A.SU.name(ctx.subject());
    return [
      'You are the tutor built into Axiom, a notebook and reading room for university STEM students. The student writes by hand with Apple Pencil and reads textbooks and problem sets inside the app.',
      majors.length ? `The student studies: ${majors.join(', ')}.` : '',
      courses.length ? `Their courses: ${courses.join(', ')}.` : '',
      cur ? `They are working in the course "${cur}" right now.` : '',
      ctx.systemExtra ? ctx.systemExtra() : '',
      'Attached images are snapshots of their handwritten work, regions they selected in a book or problem set, photos, or whole pages. If handwriting or a scan is ambiguous, say what you read before relying on it.',
      'When page text with line ids is provided (lines like "L12: …" under a page header "p. 34"), cite the exact places you refer to with markers like [[p34:L12-L14]] or [[p34:L7]] placed right after the claim. The app turns them into links that highlight those lines. Only cite line ids you were given.',
      'Use precise mathematical language. Do not replace arguments with analogies or metaphors unless the student asks for intuition. Be direct about mistakes and concise; no filler or praise.',
      'Format with Markdown. Write all mathematics in LaTeX: $...$ inline and $$...$$ for display equations.',
      'When the student asks for practice questions or a quiz, give them as a fenced block with the language "quiz" containing a JSON array: [{"q": "...", "options": ["...", "..."], "answer": <index of the correct option>, "explain": "..."}]. When they ask for flashcards, use a fenced block with the language "flashcards" containing [{"front": "...", "back": "..."}]. Inside those JSON strings write LaTeX with escaped backslashes (\\\\frac). The app renders them as interactive cards; you may add a short sentence before the block.',
      MODE_TEXT[mode],
    ].filter(Boolean).join('\n');
  };
  const toBlocks = (m, keepImages) => {
    const blocks = [];
    for (const a of m.att || []) {
      if (a.kind === 'image' && a.url) {
        if (keepImages.has(a.id)) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a.url.split(',')[1] } });
        else blocks.push({ type: 'text', text: `[Earlier image omitted: ${a.label}]` });
      } else if (a.kind === 'text' && a.text) {
        blocks.push({ type: 'text', text: `Selected passage:\n"""\n${a.text.slice(0, 6000)}\n"""` });
      } else if (a.kind === 'pdf') {
        const b64 = a.b64 || sessionPdf.get(a.id);
        if (b64) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: a.label });
        else blocks.push({ type: 'text', text: `[The PDF "${a.label}" was attached earlier; re-attach it if you need its contents.]` });
      }
    }
    if (m.ctx) blocks.push({ type: 'text', text: m.ctx });
    blocks.push({ type: 'text', text: (m.att && m.att.length ? `(Attached: ${m.att.map((a) => a.label).join('; ')})\n\n` : '') + (m.text || '(no message)') });
    return blocks;
  };
  const buildMessages = (msgs) => {
    const ids = [];
    msgs.forEach((m) => (m.att || []).forEach((a) => { if (a.kind === 'image' && a.url) ids.push(a.id); }));
    const keep = new Set(ids.slice(-6));
    const out = [];
    for (const m of msgs.filter((x) => !x.error)) {
      const msg = m.role === 'user' ? { role: 'user', content: toBlocks(m, keep) } : { role: 'assistant', content: [{ type: 'text', text: m.text || '…' }] };
      const prev = out[out.length - 1];
      if (prev && prev.role === msg.role) prev.content = prev.content.concat(msg.content);
      else out.push(msg);
    }
    return out;
  };

  async function send() {
    if (busy) return;
    const text = els.ta.value.trim();
    if (!text && !AI.pending.length) return;
    const c = chat();
    const att = AI.pending.slice();
    if (ctx.autoAttach) ctx.autoAttach(mode, att);
    att.forEach((a) => { a.id = a.id || A.uid(); if (a.kind === 'pdf' && a.b64) sessionPdf.set(a.id, a.b64); });
    AI.pending = [];
    const extra = ctx.contextText ? await ctx.contextText(att) : '';
    const sc = scopeOf();
    const wide = sc.src !== 'here' ? await gatherScope() : { text: '', images: [] };
    const um = { role: 'user', text, att: att.map((a) => ({ id: a.id, kind: a.kind, label: a.label, url: a.url, page: a.page, rect: a.rect, text: a.kind === 'text' ? a.text : undefined, cfi: a.cfi })), ctx: extra || undefined, t: Date.now() };
    c.msgs.push(um);
    if (c.title === 'New conversation') c.title = (text || att[0].label).slice(0, 48);
    if (S.aiMode === 'app') {
      c.msgs.push({ role: 'assistant', text: '_Sent to your AI app. The answer and the conversation are saved there. The question was also copied, in case the app only takes the pictures._', t: Date.now() });
      ctx.save(); draw();
      AI.handoff(text, att.concat(wide.images), [extra, wide.text].filter(Boolean).join('\n\n'));
      return;
    }
    const bm = { role: 'assistant', text: '', t: Date.now() };
    c.msgs.push(bm);
    busy = true;
    draw();
    const body = els.list.lastElementChild.querySelector('.md');
    body.innerHTML = '<span class="thinking">Thinking<i>.</i><i>.</i><i>.</i></span>';
    let raf = 0;
    const paint = () => { raf = 0; body.innerHTML = AI.md(bm.text, window.katex); if (els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight < 160) els.list.scrollTop = els.list.scrollHeight; };
    try {
      const Anthropic = await sdk();
      const client = new Anthropic({ apiKey: S.aiKey, dangerouslyAllowBrowser: true });
      const modelId = S.aiModel || 'claude-opus-5-5';
      const effort = (AI.modes.find((m) => m.id === mode) || {}).effort || 'medium';
      let messages = buildMessages(c.msgs.slice(0, -1)); // without the empty reply placeholder
      if (wide.images.length) {
        // wider-scope note pages ride on this request only (they are not saved into the conversation)
        const last = messages[messages.length - 1];
        last.content = wide.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.url.split(',')[1] } })).concat(last.content);
      }
      const system = [{ type: 'text', text: systemPrompt() + (sc.web ? '\nYou can search the web. Use it when the question needs sources, data, recent results or material beyond the student\'s books; link the sources you rely on in Markdown.' : '') }];
      if (wide.text) system.push({ type: 'text', text: wide.text });
      const params = {
        model: modelId,
        max_tokens: 64000,
        system,
        output_config: { effort },
        cache_control: { type: 'ephemeral' },
      };
      if (sc.web) params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];
      if (modelId !== 'claude-haiku-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
      abortCtl = new AbortController();
      let final = null;
      for (let round = 0; round < 4; round++) {
        const stream = client.beta.messages.stream(Object.assign({}, params, { messages }), { signal: abortCtl.signal });
        for await (const ev of stream) {
          if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'server_tool_use' && !bm.text) body.innerHTML = '<span class="thinking">Searching the web<i>.</i><i>.</i><i>.</i></span>';
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
            bm.text += ev.delta.text;
            if (!raf) raf = requestAnimationFrame(paint);
          }
        }
        final = await stream.finalMessage();
        if (final.stop_reason !== 'pause_turn') break;
        messages = messages.concat([{ role: 'assistant', content: final.content }]); // a long search turn: let the server resume it
      }
      if (final.stop_reason === 'refusal') bm.text += (bm.text ? '\n\n' : '') + '_The tutor declined to answer this request._';
      if (final.stop_reason === 'max_tokens') bm.text += '\n\n_(The answer was cut off. Ask the tutor to continue.)_';
      if (!bm.text.trim()) bm.text = '_No answer was returned. Try again._';
    } catch (err) {
      const Anthropic = await sdk().catch(() => null);
      let msg = 'Something went wrong: ' + (err && err.message ? err.message : err);
      if ((err && err.name === 'AbortError') || (Anthropic && err instanceof Anthropic.APIUserAbortError)) msg = bm.text ? '' : '_Stopped._';
      else if (Anthropic && err instanceof Anthropic.AuthenticationError) msg = 'Your API key was rejected. Check it in Settings › Tutor.';
      else if (Anthropic && err instanceof Anthropic.PermissionDeniedError) msg = 'This API key does not have access to that model. Pick another model or check your Anthropic account.';
      else if (Anthropic && err instanceof Anthropic.RateLimitError) msg = 'You have hit your API rate limit. Wait a moment and try again.';
      else if (Anthropic && err instanceof Anthropic.BadRequestError) msg = 'The request was rejected: ' + (err.message || '') + (/too large|size/i.test(err.message || '') ? ' Try attaching fewer or smaller pages.' : '');
      else if (Anthropic && err instanceof Anthropic.InternalServerError) msg = 'Anthropic\'s servers had a problem (or are overloaded). Try again in a moment.';
      else if ((Anthropic && err instanceof Anthropic.APIConnectionError) || !navigator.onLine) msg = 'The tutor needs an internet connection.';
      if (msg) { if (bm.text) bm.text += '\n\n' + msg; else { bm.text = msg; bm.error = true; } }
    }
    busy = false; abortCtl = null;
    for (const a of um.att) if (a.url) a.url = await shrink(a.url, 900);
    ctx.save();
    draw();
    if (ctx.onAnswer) ctx.onAnswer(bm.text);
  }
  function stop() { if (abortCtl) abortCtl.abort(); }

  A.on('doc:open', () => { if (ctx === AI.canvasCtx) { AI.pending = []; sessionPdf.clear(); mode = 'explain'; } });
  A.on('selection', () => { if (root && root.isConnected && els.chips && ctx === AI.canvasCtx) drawChips(); });
})();
