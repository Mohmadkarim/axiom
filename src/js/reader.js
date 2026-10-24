/* Axiom reader: a quiet reading room for books and problem sets, with the tutor beside the page.
   Pencil drag = focus box / lasso around any passage → Ask, Explain, Hint, Highlight, Copy text.
   The tutor receives the page text with line ids and cites lines back ([[p34:L3-L5]]), which highlight here. */
'use strict';
(() => {
  const h = A.h;
  const S = A.settings;
  const RD = (A.RD = {});
  let host, st = null;

  const ann0 = () => ({ highlights: [], chats: [], chatActive: null, ink: {} });
  const saveAnn = A.debounce(() => {
    if (!st) return;
    A.store.saveFile('ann_' + st.meta.id, new Blob([JSON.stringify(st.ann)], { type: 'application/json' })).catch(() => {});
  }, 600);
  const loadAnn = async (id) => {
    try { const b = await A.store.loadFile('ann_' + id, 'application/json'); if (b) return Object.assign(ann0(), JSON.parse(await b.text())); } catch (e) { /* none yet */ }
    return ann0();
  };

  /* ---------- text lines (for selection text, search and citations) ---------- */
  const lineCache = new Map();
  RD.lines = async (n) => {
    const key = st.meta.id + ':' + n;
    if (lineCache.has(key)) return lineCache.get(key);
    let lines = [];
    try {
      const lib = window.pdfjsLib;
      const page = await st.pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
        const t = lib.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(t[2], t[3]) || 10;
        return { x: t[4], y: t[5] - fh, w: Math.abs(it.width * (vp.scale || 1)), h: fh, s: it.str };
      }).sort((a, b) => a.y - b.y || a.x - b.x);
      const rows = [];
      for (const it of items) {
        const r = rows.find((row) => Math.abs(row.cy - (it.y + it.h / 2)) < Math.max(row.h, it.h) * 0.55);
        if (r) { r.items.push(it); r.h = Math.max(r.h, it.h); } else rows.push({ cy: it.y + it.h / 2, h: it.h, items: [it] });
      }
      rows.sort((a, b) => a.cy - b.cy);
      lines = rows.map((r, i) => {
        r.items.sort((a, b) => a.x - b.x);
        let text = '', last = null;
        for (const it of r.items) { if (last && it.x - (last.x + last.w) > it.h * 0.25 && !/\s$/.test(text)) text += ' '; text += it.s; last = it; }
        const x0 = Math.min(...r.items.map((t) => t.x)), x1 = Math.max(...r.items.map((t) => t.x + t.w));
        const y0 = Math.min(...r.items.map((t) => t.y)), y1 = Math.max(...r.items.map((t) => t.y + t.h));
        return { id: i + 1, text: text.replace(/\s+/g, ' ').trim(), fs: r.h, r: [x0 / vp.width, y0 / vp.height, x1 / vp.width, y1 / vp.height] };
      }).filter((l) => l.text);
      lines.forEach((l, i) => (l.id = i + 1));
    } catch (e) { lines = []; }
    lineCache.set(key, lines);
    return lines;
  };
  const linesIn = (lines, r) => lines.filter((l) => { const cx = (l.r[0] + l.r[2]) / 2, cy = (l.r[1] + l.r[3]) / 2; return cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]; });

  /* ---------- book index: Axiom reads the whole book once, finds its structure and every stated result ----------
     Works without a table of contents, running headers or printed page numbers. Cached per book in idx_<docId>. */
  const IDX_V = 5;
  const RESULT_RE = /^(Definition|Theorem|Lemma|Corollary|Proposition|Axiom|Postulate|Law|Principle|Claim|Example|Exercise|Remark)s?\s*((?:[0-9]+[.\-])*[0-9]+[a-z]?)?\s*[.:]?\s*(\([^)]{1,60}\))?\s*[.:]?/;
  const KEEP_KINDS = new Set(['Definition', 'Theorem', 'Lemma', 'Corollary', 'Proposition', 'Axiom', 'Postulate', 'Law', 'Principle', 'Claim', 'Term', 'Equation']);
  /* material books state without announcing it */
  const DEF_CUE = /\b(is called|are called|is said to be|are said to be|we say that|we call|we define|is defined (?:as|to be|by)|are defined (?:as|to be|by)|denoted by|let us call|is known as|is termed|we refer to)\b/i;
  const LAW_CUE = /\b([A-Z][a-zà-ÿ]+(?:[-–][A-Z][a-zà-ÿ]+)?['’]s (?:[a-z]+ ){0,2}(?:law|principle|equation|theorem|rule|lemma|identity|inequality|formula)s?|(?:law|principle) of (?:the )?(?:conservation of )?[a-z]+(?: [a-z]+)?)/;
  const EQ_NUM = /\((\d+[.\-]\d+[a-z]?|\d{1,3})\)\s*$/;
  const headingOf = (l, body) => {
    const t = l.text.trim();
    if (t.length < 3 || t.length > 90) return null;
    let m;
    if ((m = t.match(/^(chapter|part|lecture|unit)\s+([0-9]+|[IVXLC]+)\b[.:]?\s*(.*)$/i))) return { level: 0, title: t };
    if ((m = t.match(/^(§|sec\.?|section)\s*\d+(\.\d+)*\.?\s+\S/i))) return { level: 1, title: t };
    const big = l.fs >= body * 1.18;
    if ((m = t.match(/^(\d+(\.\d+){0,2})\.?\s+([A-Z][^]{2,80})$/)) && big && !/[.;,]$/.test(t)) return { level: (m[1].match(/\./g) || []).length ? 1 : 0, title: t };
    const words = t.split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w)).length;
    if (l.fs >= body * 1.25 && words >= 1 && /[A-Za-z]{3}/.test(t) && !/[.;,=]$/.test(t) && !/^\d+$/.test(t) && !RESULT_RE.test(t)) return { level: l.fs >= body * 1.7 ? 0 : 1, title: t };
    return null;
  };
  const normHead = (t) => t.toLowerCase().replace(/[0-9ivxlc]+$/i, '').replace(/^[0-9ivxlc]+/i, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  RD.index = null;
  let indexing = null;
  RD.buildIndex = async () => {
    if (!st || !st.pdf) return null;
    const id = st.meta.id, token = st.token, N = st.pdf.numPages;
    if (RD.index && RD.index.id === id && RD.index.done >= N) return RD.index;
    if (indexing && indexing.id === id) return indexing.p;
    const run = async () => {
      let idx = null;
      try { const b = await A.store.loadFile('idx_' + id, 'application/json'); if (b) idx = JSON.parse(await b.text()); } catch (e) { /* none yet */ }
      if (!idx || idx.v !== IDX_V || idx.pages !== N) idx = { v: IDX_V, id, pages: N, done: 0, labels: null, body: 0, raw: [], heads: [], results: [], scans: [], tops: {} };
      idx.id = id;
      RD.index = idx;
      if (idx.done >= N) return idx;
      try { const labels = await st.pdf.getPageLabels(); if (labels && labels.some((x, i) => x && x !== String(i + 1))) idx.labels = labels; } catch (e) { /* no labels */ }
      const sizes = [];
      for (let n = idx.done + 1; n <= N; n++) {
        if (!st || st.token !== token) return idx; // book closed
        const lines = await RD.lines(n);
        if (!lines.length) { idx.scans.push(n); idx.done = n; continue; }
        lines.forEach((l) => sizes.push(l.fs));
        if (!idx.body && sizes.length > 400) { const ss = sizes.slice().sort((a, b) => a - b); idx.body = ss[Math.floor(ss.length / 2)]; }
        const body = idx.body || (() => { const ss = sizes.slice().sort((a, b) => a - b); return ss[Math.floor(ss.length / 2)] || 10; })();
        // the first and last line of each page are candidates for running headers / footers
        const edge = [lines[0], lines[lines.length - 1]].filter(Boolean).map((l) => normHead(l.text)).filter((x) => x.length > 2);
        idx.tops[n] = (lines[0] || {}).text ? lines[0].text.slice(0, 100) : '';
        edge.forEach((e) => { idx.raw.push({ n, edge: e }); });
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const hd = i < lines.length * 0.6 ? headingOf(l, body) : null;
          if (hd) {
            const gist = lines.slice(i + 1, i + 4).filter((x) => !headingOf(x, body)).map((x) => x.text).join(' ').slice(0, 260);
            idx.heads.push({ page: n, level: hd.level, title: hd.title, norm: normHead(hd.title), gist });
          }
          if (!RESULT_RE.test(l.text)) {
            const two = (l.text + ' ' + ((lines[i + 1] && lines[i + 1].text) || '')).slice(0, 320);
            if (DEF_CUE.test(l.text) && idx.results.filter((r) => r.page === n && r.kind === 'Term').length < 5) idx.results.push({ page: n, kind: 'Term', num: '', name: '', text: two });
            const lm = l.text.match(LAW_CUE);
            if (lm && !idx.results.some((r) => r.kind === 'Law' && r.name === lm[1])) idx.results.push({ page: n, kind: 'Law', num: '', name: lm[1], text: two });
            const em = l.text.match(EQ_NUM);
            if (em && /[=<>≤≥∫∑∂]/.test(l.text) && l.text.length < 160) idx.results.push({ page: n, kind: 'Equation', num: em[1], name: '', text: l.text.slice(0, 200) });
          }
          const m = l.text.match(RESULT_RE);
          if (m && (i === 0 || !RESULT_RE.test(lines[i - 1].text) || true)) {
            const kind = m[1];
            if (!KEEP_KINDS.has(kind) && kind !== 'Example' && kind !== 'Exercise') continue;
            let text = l.text;
            for (let j = i + 1; j < lines.length && j < i + 9 && text.length < 520; j++) {
              const t = lines[j].text;
              if (RESULT_RE.test(t) || /^proof\b/i.test(t) || headingOf(lines[j], body)) break;
              text += ' ' + t;
            }
            idx.results.push({ page: n, kind, num: m[2] || '', name: m[3] || '', text: text.slice(0, 560) });
          }
        }
        idx.done = n;
        if (n % 40 === 0) { A.emit('index:progress', idx); await saveIndex(idx); }
        if (n % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // stay responsive
      }
      // drop running headers that were mistaken for headings
      const freq = new Map();
      idx.raw.forEach((r) => freq.set(r.edge, (freq.get(r.edge) || 0) + 1));
      const running = new Set([...freq].filter(([, c]) => c >= Math.max(4, N * 0.04)).map(([k]) => k));
      idx.heads = idx.heads.filter((hd, i, arr) => !running.has(hd.norm) && !(i && arr[i - 1].norm === hd.norm && arr[i - 1].page >= hd.page - 1));
      idx.running = [...running].slice(0, 40);
      idx.raw = [];
      await saveIndex(idx);
      A.emit('index:progress', idx);
      return idx;
    };
    indexing = { id, p: run().finally(() => { indexing = null; }) };
    return indexing.p;
  };
  const saveIndex = (idx) => A.store.saveFile('idx_' + idx.id, new Blob([JSON.stringify(idx)], { type: 'application/json' })).catch(() => {});
  const resultLabel = (r) => (r.kind === 'Term' ? 'Defined in the text' : r.kind === 'Equation' ? `Equation (${r.num})` : r.kind === 'Law' && !r.num ? r.name : `${r.kind}${r.num ? ' ' + r.num : ''}${r.name ? ' ' + r.name : ''}`);
  /* structure for a page: from the outline when the PDF has one, otherwise from detected headings */
  RD.trailOf = async (n) => {
    const map = await RD.sectionMap();
    const trail = [];
    const src = map.length ? map : ((RD.index && RD.index.heads) || []).map((x) => ({ page: x.page, depth: x.level, title: x.title }));
    for (const e of src) { if (e.page > n) break; trail[e.depth] = e.title; trail.length = e.depth + 1; }
    return { trail: trail.filter(Boolean), from: map.length ? 'contents' : src.length ? 'headings' : '' };
  };
  /* what the book has covered up to page n, sized to a character budget */
  RD.coveredSoFar = async (n, budget = 22000, focusText = '') => {
    const idx = RD.index;
    if (!idx || !idx.done) return '';
    const map = await RD.sectionMap();
    const heads = map.length ? map.map((x) => ({ page: x.page, level: x.depth, title: x.title })) : idx.heads;
    const out = [];
    // outline so far
    const before = heads.filter((x) => x.page <= n && x.level <= 1);
    if (before.length) out.push('Outline of the book up to here (with how each section opens):\n' + before.map((x) => `${x.level ? '  ' : ''}${x.title} (p. ${x.page})${x.gist ? ' — ' + x.gist.slice(0, x.page >= n - 40 ? 220 : 90) : ''}`).join('\n').slice(-7000));
    // results: the current chapter in full, earlier chapters shortened
    const chapStart = (heads.filter((x) => x.page <= n && x.level === 0).pop() || { page: 1 }).page;
    const res = idx.results.filter((r) => r.page < n || (r.page === n && false)).filter((r) => KEEP_KINDS.has(r.kind));
    const cur = res.filter((r) => r.page >= chapStart), old = res.filter((r) => r.page < chapStart);
    let left = budget * 0.55;
    const curTxt = [];
    for (let i = cur.length - 1; i >= 0 && left > 0; i--) { const t = `- ${resultLabel(cur[i])} (p. ${cur[i].page}): ${cur[i].text}`; curTxt.unshift(t); left -= t.length; }
    const oldTxt = [];
    for (let i = old.length - 1; i >= 0 && left > 0; i--) { if (old[i].kind === 'Equation' || old[i].kind === 'Claim') continue; const t = `- ${resultLabel(old[i])} (p. ${old[i].page}): ${old[i].text.slice(0, 150)}`; oldTxt.unshift(t); left -= t.length; }
    if (oldTxt.length) out.push('Results stated in earlier chapters (shortened):\n' + oldTxt.join('\n'));
    if (curTxt.length) out.push('Results stated so far in the current chapter:\n' + curTxt.join('\n'));
    // results the passage refers to by number, in full, wherever they are in the book
    const refs = new Set();
    String(focusText).replace(/(Theorem|Lemma|Corollary|Proposition|Definition|Exercise|Example|Law|Principle|Postulate|Axiom)\s+((?:\d+[.\-])*\d+[a-z]?)/g, (_, k, num) => refs.add(k + ' ' + num));
    String(focusText).replace(/(?:Eqs?\.?|equations?|Equations?)\s*\(?((?:\d+[.\-])?\d+[a-z]?)\)?/g, (_, num) => refs.add('Equation ' + num));
    String(focusText).replace(/\((\d+[.\-]\d+[a-z]?)\)/g, (_, num) => refs.add('Equation ' + num));
    const refTxt = [];
    for (const key of refs) {
      const hit = idx.results.find((r) => `${r.kind} ${r.num}` === key);
      if (hit && !refTxt.some((t) => t.includes(`(p. ${hit.page}): ${hit.text.slice(0, 30)}`))) refTxt.push(`- ${resultLabel(hit)} (p. ${hit.page}): ${hit.text}`);
    }
    // terms the passage uses that were defined earlier in prose
    const lower = String(focusText).toLowerCase();
    idx.results.filter((r) => r.kind === 'Term' && r.page < n).forEach((r) => {
      const m = r.text.match(/(?:is called|are called|is said to be|are said to be|we call|known as|is termed)\s+(?:an?\s+|the\s+)?([a-z][a-z\- ]{2,30}?)(?:[.,;:]|\s+if|\s+when|$)/i);
      const term = m && m[1].trim().toLowerCase();
      if (term && term.length > 3 && lower.includes(term) && refTxt.length < 24) refTxt.push(`- Definition of "${term}" (p. ${r.page}): ${r.text}`);
    });
    if (refTxt.length) out.push('Results this passage refers to (full statements):\n' + refTxt.join('\n'));
    // the current section's text up to this page
    const secStart = (heads.filter((x) => x.page <= n).pop() || { page: Math.max(1, n - 3) }).page;
    let secTxt = '';
    for (let p = Math.max(secStart, n - 6); p < n; p++) secTxt += `[p. ${p}]\n` + (await RD.lines(p)).map((l) => l.text).join('\n') + '\n';
    if (secTxt) out.push('Text of the current section before this page:\n' + secTxt.slice(-Math.max(3000, budget * 0.4)));
    if (idx.scans.length > idx.pages * 0.5) out.push('(Most pages of this PDF are scanned images without a text layer, so the outline and results above are incomplete.)');
    return out.join('\n\n');
  };

  /* a whole-book digest from the cached index, for tutor scopes (works without the book being open) */
  RD.bookDigest = async (docId, budget = 60000) => {
    const meta = A.ST.doc(docId);
    const name = meta ? meta.title || meta.name : 'Book';
    let idx = RD.index && RD.index.id === docId ? RD.index : null;
    if (!idx) { try { const b = await A.store.loadFile('idx_' + docId, 'application/json'); if (b) idx = JSON.parse(await b.text()); } catch (e) { /* none */ } }
    if (!idx || !idx.done) return { name, text: `Book "${name}": not read yet (open it once in Axiom so it can be indexed).`, ready: false };
    const out = [`Book "${name}" (${idx.pages} pages${idx.done < idx.pages ? `, ${idx.done} indexed so far` : ''}).`];
    const heads = idx.heads || [];
    if (heads.length) out.push('Outline:\n' + heads.filter((x) => x.level <= 1).map((x) => `${x.level ? '  ' : ''}${x.title} (p. ${x.page})${x.gist ? ' — ' + x.gist.slice(0, 120) : ''}`).join('\n').slice(0, budget * 0.3));
    let left = budget - out.join('\n').length;
    const res = (idx.results || []).filter((r) => KEEP_KINDS.has(r.kind));
    // named results first in full, then equations and prose definitions as space allows
    const rank = (r) => (r.kind === 'Equation' || r.kind === 'Claim' ? 2 : r.kind === 'Term' ? 1 : 0);
    const chosen = [];
    for (const tier of [0, 1, 2]) for (const r of res) { if (rank(r) !== tier || left <= 0) continue; const t = `- ${resultLabel(r)} (p. ${r.page}): ${r.text.slice(0, tier ? 220 : 600)}`; chosen.push([r.page, t]); left -= t.length; }
    if (chosen.length) out.push('Definitions and results:\n' + chosen.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('\n'));
    return { name, text: out.join('\n\n'), ready: true };
  };

  /* ---------- where am I: book, chapter, section, printed page (sent to the tutor automatically) ---------- */
  RD.bookInfo = async () => {
    if (!st || !st.pdf) return {};
    if (st.info) return st.info;
    const info = { title: st.meta.name, author: '' };
    try { const md = await st.pdf.getMetadata(); const I = (md && md.info) || {}; if (I.Title && I.Title.length > 3) info.title = I.Title; if (I.Author) info.author = I.Author; } catch (e) { /* none */ }
    st.info = info;
    return info;
  };
  /* flatten the outline into [{page, depth, title}] sorted by page */
  RD.sectionMap = async () => {
    if (!st || !st.pdf) return [];
    if (st.secMap) return st.secMap;
    const out = [];
    try {
      if (!st.outline) st.outline = (await st.pdf.getOutline()) || [];
      const walk = async (items, depth) => {
        for (const it of items) {
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await st.pdf.getDestination(dest);
            if (dest && dest[0]) out.push({ page: (await st.pdf.getPageIndex(dest[0])) + 1, depth, title: String(it.title || '').trim() });
          } catch (e) { /* entry without a page */ }
          if (it.items && it.items.length && depth < 3) await walk(it.items, depth + 1);
        }
      };
      await walk(st.outline, 0);
    } catch (e) { /* no outline */ }
    out.sort((a, b) => a.page - b.page || a.depth - b.depth);
    st.secMap = out;
    return out;
  };
  /* "Chapter 3 Connectedness and Compactness › §29 Local Compactness" for a page */
  RD.locationOf = async (n) => {
    const { trail } = await RD.trailOf(n);
    let printed = null, header = '';
    if (RD.index && RD.index.labels && RD.index.labels[n - 1]) printed = RD.index.labels[n - 1];
    try {
      const lines = await RD.lines(n);
      const top = (lines[0] && lines[0].text.length < 90 ? lines[0].text : lines.slice(0, 1).map((l) => l.text.slice(0, 90)).join('')) || '';
      header = top.slice(0, 120);
      const m = top.match(/^\s*(\d{1,4})\b/) || top.match(/\b(\d{1,4})\s*$/);
      if (m && printed == null) printed = +m[1];
    } catch (e) { /* scanned page */ }
    return { trail: trail.filter(Boolean), printed, header };
  };

  /* ---------- rendering ---------- */
  const themeFilter = { paper: '', sepia: 'sepia(.38) saturate(1.1) brightness(.97)', night: 'invert(.92) hue-rotate(180deg) contrast(.92)' };
  function layout(keep = true) {
    if (st && st.rendition) { host.classList.toggle('rd-narrow', st.main.clientWidth < 760); clearTimeout(st._rz); st._rz = setTimeout(() => { try { st.rendition.resize(); } catch (e) { /* ignore */ } }, 60); return; }
    if (!st || !st.pages.length) return;
    const main = st.main;
    host.classList.toggle('rd-narrow', main.clientWidth < 760);
    const anchor = keep ? anchorAt(main.getBoundingClientRect().left + main.clientWidth / 2, main.getBoundingClientRect().top + main.clientHeight * 0.35) : null;
    const availW = Math.max(240, main.clientWidth - 64), availH = Math.max(240, main.clientHeight - 48);
    st.pages.forEach((p) => {
      let w = st.fit === 'page' ? Math.min(availW, availH / p.aspect) : Math.min(availW, 980);
      w *= st.zoom;
      p.el.style.width = Math.round(w) + 'px';
      p.el.style.height = Math.round(w * p.aspect) + 'px';
      // keep the current bitmap (it stretches with the page) and re-render sharply behind it
      if (p.canvas && Math.abs(p.w - w) > 2 && p.visible) renderPage(p);
      if (p.ink) drawInkPage(p);
    });
    if (anchor) restoreAnchor(anchor);
  }
  /* "this point of this page stays where it is on screen" — for zooming, fitting and rotating without losing the place */
  function anchorAt(cx, cy) {
    let best = null, bd = Infinity;
    for (const p of st.pages) {
      const r = p.el.getBoundingClientRect();
      const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      if (d < bd) { bd = d; best = { p, rx: (cx - r.left) / r.width, ry: (cy - r.top) / r.height, cx, cy }; }
      if (d === 0) break;
    }
    return best;
  }
  function restoreAnchor(a) {
    const r = a.p.el.getBoundingClientRect();
    st.main.scrollLeft += r.left + a.rx * r.width - a.cx;
    st.main.scrollTop += r.top + a.ry * r.height - a.cy;
  }
  /* two passes: an instant low-resolution preview, then the sharp page; the old bitmap stays until the new one is ready */
  async function renderPage(p) {
    if (!st) return;
    const w = parseFloat(p.el.style.width);
    if (p.canvas && Math.abs(p.w - w) < 2 && !p.low) return;
    if (p.busy) { p.again = true; return; }
    p.busy = true;
    const token = st.token;
    try {
      const page = await st.pdf.getPage(p.n);
      const vp1 = page.getViewport({ scale: 1 });
      if (Math.abs(vp1.height / vp1.width - p.aspect) > 0.01) { p.aspect = vp1.height / vp1.width; p.el.style.height = Math.round(w * p.aspect) + 'px'; }
      const draw = async (scale) => {
        scale = Math.min(scale, 4096 / vp1.width, 4096 / vp1.height, Math.sqrt(10e6 / (vp1.width * vp1.height)));
        const vp = page.getViewport({ scale });
        const c = h('canvas', { class: 'rd-canvas' });
        c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        return c;
      };
      const swap = (c, low) => {
        if (!st || token !== st.token) return;
        const old = p.canvas;
        p.el.insertBefore(c, p.ink || p.ov);
        if (old) { c.classList.add('rd-fade'); setTimeout(() => old.remove(), 140); }
        p.canvas = c; p.w = w; p.low = low;
        p.el.classList.add('rendered');
      };
      if (!p.canvas) swap(await draw((w / vp1.width) * 0.45), true);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      swap(await draw((w / vp1.width) * dpr), false);
      drawInkPage(p);
      st.pages.forEach((q) => { if (q.canvas && Math.abs(q.n - st.page) > 6) { q.canvas.remove(); q.canvas = null; q.el.classList.remove('rendered'); } });
    } catch (e) { /* keep what is there */ }
    p.busy = false;
    if (p.again) { p.again = false; if (p.visible) renderPage(p); }
  }
  const regionImage = async (n, r, maxPx = 1500) => {
    const page = await st.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const rw = (r[2] - r[0]) * vp1.width, rh = (r[3] - r[1]) * vp1.height;
    const scale = Math.min(4, maxPx / Math.max(rw, rh, 1));
    const vp = page.getViewport({ scale });
    const full = h('canvas'); full.width = Math.round(vp.width); full.height = Math.round(vp.height);
    const fctx = full.getContext('2d'); fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, full.width, full.height);
    await page.render({ canvasContext: fctx, viewport: vp }).promise;
    const c = h('canvas'); c.width = Math.max(1, Math.round(rw * scale)); c.height = Math.max(1, Math.round(rh * scale));
    const cctx = c.getContext('2d');
    cctx.drawImage(full, -r[0] * full.width, -r[1] * full.height);
    const ink = (st.ann.ink && st.ann.ink[n]) || [];
    if (ink.length) drawStrokes(cctx, ink, full.width, full.height, -r[0] * full.width, -r[1] * full.height);
    return c.toDataURL('image/jpeg', 0.9);
  };
  RD.pageImage = async (n) => regionImage(n, [0, 0, 1, 1], 1600);

  /* ---------- overlays: highlights, focus box, citations ---------- */
  const box = (r, cls, extra = {}) => h('div', Object.assign({ class: cls, style: { left: r[0] * 100 + '%', top: r[1] * 100 + '%', width: (r[2] - r[0]) * 100 + '%', height: (r[3] - r[1]) * 100 + '%' } }, extra));
  function drawOverlays(n) {
    const p = st.pages[n - 1];
    if (!p) return;
    p.ov.innerHTML = '';
    st.ann.highlights.filter((hl) => hl.page === n).forEach((hl) => {
      (hl.rects || [hl.rect]).forEach((rc) => {
        const el = box(rc, 'rd-hl ' + (hl.color || 'yellow'), { title: 'Highlight · tap for options' });
        el.addEventListener('click', (e) => { e.stopPropagation(); highlightMenu(el, hl); });
        p.ov.append(el);
      });
    });
    (st.cites || []).filter((c) => c.page === n).forEach((c) => c.rects.forEach((r) => p.ov.append(box(r, 'rd-cite' + (c.flash ? ' flash' : '')))));
    if (st.focus && st.focus.page === n) {
      if (st.focus.path) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'rd-lasso'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M' + st.focus.path.map(([x, y]) => `${x * 100} ${y * 100}`).join('L') + 'Z');
        svg.append(path); p.ov.append(svg);
      } else p.ov.append(box(st.focus.rect, 'rd-focus'));
    }
  }
  const redrawAll = () => st && st.pages.forEach((p) => drawOverlays(p.n));
  function highlightMenu(anchor, hl) {
    const m = h('div', { class: 'menu' });
    const it = (icon, label, fn, cls) => { const b = h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }); b.innerHTML = A.icon(icon); b.append(label); m.append(b); };
    const colors = h('div', { class: 'rd-colors' });
    ['yellow', 'green', 'blue', 'pink'].forEach((c) => colors.append(h('button', { class: 'rd-sw ' + c + (hl.color === c ? ' on' : ''), 'aria-label': c, onclick: () => { hl.color = c; saveAnn(); drawOverlays(hl.page); A.closePopovers(); } })));
    m.append(colors);
    it('spark', 'Ask the tutor about this', () => ask('ask', hl.page, hl.rect));
    if (hl.text) it('copy', 'Copy text', () => copyText(hl.text));
    it('trash', 'Remove highlight', () => { st.ann.highlights = st.ann.highlights.filter((x) => x !== hl); saveAnn(); drawOverlays(hl.page); renderRail(); }, 'danger');
    A.popover(m, anchor, { side: 'down' });
  }

  /* ---------- selecting with the Pencil (box or lasso) ---------- */
  const pageAt = (x, y) => { for (const p of st.pages) { const r = p.el.getBoundingClientRect(); if (y >= r.top && y <= r.bottom && x >= r.left - 20 && x <= r.right + 20) return { p, r }; } return null; };
  /* ---------- handwriting on pages (stored as page-relative vector strokes) ---------- */
  const INK = { black: '#1b1d22', blue: '#1f4fbf', red: '#c43c35', green: '#1e8449' };
  const inkOf = (n) => ((st.ann.ink = st.ann.ink || {})[n] = st.ann.ink[n] || []);
  /* Ink is drawn as round-capped segments whose width follows the pressure. The same renderer runs live and afterwards,
     so a stroke never changes shape when the pen lifts; nothing is straightened or smoothed unless "Smooth" is on. */
  const drawStroke = (ctx, s, W, H, ox = 0, oy = 0, from = 1) => {
    const p = s.pts, n = p.length / 3;
    if (!n) return;
    const base = Math.max(0.6, s.w * W);
    const X = (i) => p[i * 3] * W + ox, Y = (i) => p[i * 3 + 1] * H + oy, Wd = (i) => base * (0.35 + 0.65 * p[i * 3 + 2]);
    ctx.globalAlpha = s.o || 1; ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (n === 1) { ctx.beginPath(); ctx.arc(X(0), Y(0), Wd(0) / 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; return; }
    for (let i = Math.max(1, from); i < n; i++) {
      // a quadratic from the previous midpoint to this midpoint, bending through the previous sample (passes near every point)
      const sx = i === 1 ? X(0) : (X(i - 2) + X(i - 1)) / 2, sy = i === 1 ? Y(0) : (Y(i - 2) + Y(i - 1)) / 2;
      const ex = (X(i - 1) + X(i)) / 2, ey = (Y(i - 1) + Y(i)) / 2;
      ctx.lineWidth = (Wd(i - 1) + Wd(i)) / 2;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(X(i - 1), Y(i - 1), ex, ey); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const drawTail = (ctx, s, W, H, ox = 0, oy = 0) => {
    const p = s.pts, n = p.length / 3;
    if (n < 2) return;
    const base = Math.max(0.6, s.w * W), k = n - 1;
    ctx.strokeStyle = s.c; ctx.lineCap = 'round'; ctx.globalAlpha = s.o || 1;
    ctx.lineWidth = base * (0.35 + 0.65 * p[k * 3 + 2]);
    ctx.beginPath(); ctx.moveTo((p[k * 3 - 3] + p[k * 3]) / 2 * W + ox, (p[k * 3 - 2] + p[k * 3 + 1]) / 2 * H + oy); ctx.lineTo(p[k * 3] * W + ox, p[k * 3 + 1] * H + oy); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const drawStrokes = (ctx, strokes, W, H, ox = 0, oy = 0) => { for (const s of strokes) { drawStroke(ctx, s, W, H, ox, oy); drawTail(ctx, s, W, H, ox, oy); } };
  const sizeCanvas = (p, c) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(p.el.clientWidth * dpr), H = Math.round(p.el.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c.getContext('2d');
  };
  function drawInkPage(p) {
    const strokes = (st.ann.ink && st.ann.ink[p.n]) || [];
    if (!strokes.length && !p.ink) return;
    if (!p.ink) { p.ink = h('canvas', { class: 'rd-ink' }); p.el.insertBefore(p.ink, p.ov); }
    const ctx = sizeCanvas(p, p.ink);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.ink.width, p.ink.height);
    drawStrokes(ctx, strokes, p.ink.width, p.ink.height);
  }
  /* the stroke being written lives on its own small layer and only its new segments are painted each frame */
  const liveLayer = (p) => {
    if (!p.live) { p.live = h('canvas', { class: 'rd-ink rd-live' }); p.el.insertBefore(p.live, p.ov); }
    return sizeCanvas(p, p.live);
  };
  const paintLive = (c) => {
    const ctx = liveLayer(c.p), n = c.stroke.pts.length / 3;
    drawStroke(ctx, c.stroke, c.p.live.width, c.p.live.height, 0, 0, c.drawn || 1);
    c.drawn = n;
  };
  const commitStroke = (p, s) => {
    if (!p.ink) drawInkPage(p);
    if (!p.ink) { p.ink = h('canvas', { class: 'rd-ink' }); p.el.insertBefore(p.ink, p.ov); }
    const ctx = sizeCanvas(p, p.ink);
    drawStroke(ctx, s, p.ink.width, p.ink.height); drawTail(ctx, s, p.ink.width, p.ink.height);
    if (p.live) { const lc = p.live.getContext('2d'); lc.clearRect(0, 0, p.live.width, p.live.height); }
  };
  RD.inkUndo = () => {
    const last = st.inkHist.pop();
    if (!last) return A.toast('Nothing to undo');
    const arr = inkOf(last.page);
    if (last.type === 'add') arr.splice(arr.indexOf(last.stroke), 1); else arr.push(...last.strokes);
    saveAnn(); drawInkPage(st.pages[last.page - 1]);
  };
  const eraseAt = (p, fx, fy) => {
    const arr = inkOf(p.n), rr = 0.012, gone = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      for (let k = 0; k < s.pts.length; k += 3) if (Math.hypot(s.pts[k] - fx, (s.pts[k + 1] - fy) * p.aspect) < rr + s.w) { gone.push(arr.splice(i, 1)[0]); break; }
    }
    if (gone.length) { st.inkHist.push({ type: 'erase', page: p.n, strokes: gone }); drawInkPage(p); saveAnn(); }
  };

  function bindSelect(main) {
    let cur = null;
    const fingerSelects = () => st.tool !== 'read' && !S.penSeen;
    main.addEventListener('touchstart', (e) => {
      const stylus = [...e.changedTouches].some((t) => t.touchType === 'stylus');
      if (stylus || fingerSelects()) e.preventDefault(); // keep the Pencil from scrolling
    }, { passive: false });
    const down = (e) => {
      if (e.target.closest('.rd-hl') && st.tool !== 'write') return;
      const selecting = e.pointerType === 'pen' || e.pointerType === 'mouse' || fingerSelects();
      if (!selecting || e.button > 0) return;
      if (e.pointerType === 'pen' && !S.penSeen) { S.penSeen = true; A.saveSettings(); }
      const [ex, ey] = A.IN.penXY(e);
      const hit = pageAt(ex, ey);
      if (!hit) return;
      e.preventDefault();
      clearActions();
      const fx = (ex - hit.r.left) / hit.r.width, fy = (ey - hit.r.top) / hit.r.height;
      cur = { p: hit.p, r: hit.r, pts: [[fx, fy]], id: e.pointerId };
      if (st.tool === 'write') {
        if (st.inkTool === 'eraser') { cur.erase = true; eraseAt(hit.p, fx, fy); }
        else cur.stroke = { id: A.uid(), c: INK[st.inkColor] || INK.black, w: st.inkWidth, pts: [fx, fy, e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.6] };
      }
      try { main.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    const move = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      e.preventDefault();
      const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
      if (cur.erase) { for (const ev of list) eraseAt(cur.p, (ev.clientX - cur.r.left) / cur.r.width, (ev.clientY - cur.r.top) / cur.r.height); return; }
      if (cur.stroke) {
        const sp = cur.stroke.pts;
        cur.r = cur.p.el.getBoundingClientRect(); // the page can move under the pen (scroll, chrome); measure it every time
        cur.fresh = cur.fresh || A.IN.freshFilter();
        for (const ev of list) {
          if (!cur.fresh(ev.timeStamp || 0, ev.clientX, ev.clientY)) continue;
          const [qx, qy] = A.IN.penXY(ev);
          const fx = (qx - cur.r.left) / cur.r.width, fy = (qy - cur.r.top) / cur.r.height, m = ev.pointerType === 'pen' ? Math.max(0.05, ev.pressure) : 0.6, k = sp.length - 3;
          // keep samples at least ~0.6 px apart; closer ones just move the last point (no jitter, no lag)
          if (Math.hypot((fx - sp[k]) * cur.r.width, (fy - sp[k + 1]) * cur.r.height) > 0.6) sp.push(fx, fy, m);
          else { sp[k] = fx; sp[k + 1] = fy; sp[k + 2] = Math.max(sp[k + 2], m); }
        }
        if (!cur.raf) { const c = cur; cur.raf = requestAnimationFrame(() => { c.raf = 0; if (cur === c) paintLive(c); }); }
        return;
      }
      for (const ev of list) cur.pts.push([A.clamp((ev.clientX - cur.r.left) / cur.r.width, 0, 1), A.clamp((ev.clientY - cur.r.top) / cur.r.height, 0, 1)]);
      const sh = shapeOf(cur.pts);
      st.focus = Object.assign({ page: cur.p.n }, sh);
      drawOverlays(cur.p.n);
    };
    const up = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      if (cur.erase) { cur = null; return; }
      if (cur.stroke) {
        const s = cur.stroke, p = cur.p;
        if (cur.raf) cancelAnimationFrame(cur.raf);
        cur = null;
        if (S.readerSmooth) s.pts = A.IN.smoothStroke(s.pts, 0.5);
        s.pts = A.G.simplify(s.pts, 0.00015, 0.03); // sub-pixel: drops only redundant samples
        inkOf(p.n).push(s);
        st.inkHist.push({ type: 'add', page: p.n, stroke: s });
        commitStroke(p, s); saveAnn();
        return;
      }
      const sh = shapeOf(cur.pts);
      const n = cur.p.n;
      cur = null;
      const wpx = (sh.rect[2] - sh.rect[0]) * st.pages[n - 1].el.clientWidth, hpx = (sh.rect[3] - sh.rect[1]) * st.pages[n - 1].el.clientHeight;
      if (wpx < 14 || hpx < 10) { st.focus = null; drawOverlays(n); return; }
      st.focus = Object.assign({ page: n }, sh);
      drawOverlays(n);
      if (st.tool === 'highlight') { addHighlight(n, sh.rect); st.focus = null; drawOverlays(n); return; }
      showActions(n, sh.rect);
    };
    main.addEventListener('pointerdown', down);
    main.addEventListener('pointermove', move);
    main.addEventListener('pointerup', up);
    main.addEventListener('pointercancel', up);
  }
  /* a closed loop is a lasso; otherwise the drag's corners define a box */
  function shapeOf(pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const w = bb[2] - bb[0], hh = bb[3] - bb[1], big = Math.max(w, hh) || 1;
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    // a loop ends near where it started and travels around its box (works for wide, flat loops around text lines)
    const closed = pts.length > 10 && Math.hypot(ex - sx, ey - sy) < big * 0.35 && L > (w + hh) * 1.2;
    if (closed) return { rect: bb, path: pts.filter((_, i) => i % 2 === 0) };
    return { rect: [Math.min(sx, ex), Math.min(sy, ey), Math.max(sx, ex), Math.max(sy, ey)] };
  }

  /* ---------- selection actions ---------- */
  function clearActions() { const a = host && host.querySelector('.rd-actions'); if (a) a.remove(); }
  function showActions(n, r) {
    clearActions();
    const p = st.pages[n - 1], pr = p.el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const bar = h('div', { class: 'rd-actions ask-bar', role: 'dialog', 'aria-label': 'Ask about the selection' });
    const inp = h('input', { class: 'ab-in', placeholder: 'Ask about this…', enterkeyhint: 'send', autocomplete: 'off' });
    const go = () => { const q = inp.value.trim(); if (q) ask('ask', n, r, q); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') { st.focus = null; drawOverlays(n); clearActions(); } });
    const send = h('button', { class: 'ab-send', 'aria-label': 'Send question', html: A.icon('send'), onclick: go });
    const chip = (label, fn) => h('button', { class: 'ab-chip', onclick: fn }, label);
    bar.append(
      h('div', { class: 'ab-head' }, h('span', null, 'Ask about this selection'),
        h('button', { class: 'ab-ic', title: 'Highlight', 'aria-label': 'Highlight', html: A.icon('b-highlighter'), onclick: () => { addHighlight(n, r); st.focus = null; drawOverlays(n); clearActions(); } }),
        h('button', { class: 'ab-ic', title: 'Copy text', 'aria-label': 'Copy text', html: A.icon('copy'), onclick: async () => { const t = linesIn(await RD.lines(n), r).map((l) => l.text).join('\n'); copyText(t); } }),
        h('button', { class: 'ab-ic', title: 'Close', 'aria-label': 'Close', html: A.icon('close'), onclick: () => { st.focus = null; drawOverlays(n); clearActions(); } })),
      h('div', { class: 'ab-row' }, inp, send),
      h('div', { class: 'ab-chips' },
        chip('Explain', () => ask('explain', n, r)),
        chip('Fill in steps', () => ask('prove', n, r)),
        chip('Hint', () => ask('hint', n, r)),
        chip('Solve beside', () => solveFrom(n, r))));
    host.append(bar);
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = pr.left + ((r[0] + r[2]) / 2) * pr.width - bw / 2 - hr.left;
    let y = pr.top + r[3] * pr.height + 12 - hr.top;
    if (y + bh > hr.height - 70) y = pr.top + r[1] * pr.height - bh - 12 - hr.top;
    const maxX = st.main.clientWidth + (st.main.getBoundingClientRect().left - hr.left) - bw - 8;
    bar.style.left = A.clamp(x, 8, Math.max(8, maxX)) + 'px';
    bar.style.top = A.clamp(y, 64, hr.height - bh - 60) + 'px';
  }
  /* take the selected problem to a notebook or canvas, with the book docked beside it */
  async function solveFrom(n, r) {
    clearActions();
    const url = await regionImage(n, r, 1800);
    const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = url; });
    const meta = st.meta;
    const loc = await RD.locationOf(n);
    A.UI.solveBeside(meta, n, { url, w: im.naturalWidth, h: im.naturalHeight, label: `${meta.name}, p. ${loc.printed || n}` });
  }
  const copyText = (t) => {
    if (!t) return A.toast('No text found here. This page may be a scan.');
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => A.toast('Text copied'), () => A.toast('Copy is not allowed here'));
  };
  async function addHighlight(n, r) {
    const sel = linesIn(await RD.lines(n), r);
    const text = sel.map((l) => l.text).join(' ');
    const rects = sel.map((l) => [Math.max(r[0], l.r[0]) - 0.003, l.r[1] - 0.002, Math.min(r[2], l.r[2]) + 0.003, l.r[3] + 0.002]);
    st.ann.highlights.push({ id: A.uid(), page: n, rect: r, rects: rects.length ? rects : null, color: 'yellow', text, created: Date.now() });
    saveAnn(); drawOverlays(n); renderRail();
    A.toast('Highlighted');
  }
  async function ask(kind, n, r, question) {
    clearActions();
    toggleTutor(true);
    const url = await regionImage(n, r);
    const text = linesIn(await RD.lines(n), r).map((l) => l.text).join('\n');
    const loc = await RD.locationOf(n);
    const where = loc.trail.length ? loc.trail[loc.trail.length - 1] : `p. ${n}`;
    const att = { kind: 'image', label: `${where} · p. ${loc.printed || n}`, url, page: n, rect: r, text };
    if (question) A.AI.ask(question, { mode: 'explain', attachments: [att] });
    else if (kind === 'explain') A.AI.ask('Explain this passage rigorously, step by step.', { mode: 'explain', attachments: [att] });
    else if (kind === 'hint') A.AI.ask('Give me a hint for this. Not the solution.', { mode: 'hint', attachments: [att] });
    else if (kind === 'prove') A.AI.ask('Fill in the details of this argument: justify every step that the book skips.', { mode: 'explain', attachments: [att] });
    else A.AI.ask('', { send: false, attachments: [att] });
  }

  /* ---------- tutor context for the reader ---------- */
  const readerCtx = {
    kind: 'reader',
    docId: () => st.meta.id,
    store: () => st.ann,
    chats: () => st.ann.chats,
    save: () => saveAnn(),
    subject: () => st.meta.subject,
    emptyTitle: () => 'Ask about this ' + (st.meta.kind === 'sheet' ? 'problem set' : 'book'),
    get emptyText() { return st && st.kind === 'epub' ? 'Select any passage, then tap Ask. The tutor reads the chapter with you.' : 'Draw a box or a loop around any passage with the Apple Pencil, then tap Ask. The tutor reads the page with you and highlights the lines it refers to.'; },
    tips: ['Explain the main idea of this page', 'What do I need to know before reading this section?', 'Give me a hint for the problem on this page', 'Quiz me on this chapter so far'],
    placeholder: () => 'Ask about this page or your selection…',
    attachButtons: () => (st.kind === 'epub' ? [] : [{ icon: 'pdf', label: 'This page', fn: async () => A.AI.attach({ kind: 'image', label: `p. ${st.page}`, url: await RD.pageImage(st.page), page: st.page }) }]),
    onRemoveAtt: (a) => { if (st.focus && a.page === st.focus.page) { st.focus = null; drawOverlays(a.page); } },
    systemExtra: () => (st.kind === 'epub'
      ? `The student is reading the EPUB book "${st.meta.name}" in Axiom's reader. The text of the chapter on screen is provided. When you refer to a passage, quote it briefly in a > blockquote; line citations are not available in EPUBs.`
      : `The student is reading "${st.meta.name}" (${st.pdf ? st.pdf.numPages + ' pages' : ''}) in Axiom's reader. Each message comes with the book, chapter and section, an outline of the book so far (with how each section opens), the definitions and results stated earlier (including definitions written in prose, named laws and numbered equations) (in full for the current chapter, shortened before that), the full statements of any results the passage cites by number, the text of the current section before this page, the page text as numbered lines, and the region they selected (as an image plus its text). Lean on that material: when the book uses an earlier result, name it (e.g. Theorem 26.3) and state what it gives. Their own handwriting on the page may appear in those images. Use the book's own notation and the results stated earlier in the chapter; if the question depends on something defined earlier that you were not shown, say what you are assuming.`),
    contextText: async (atts) => {
      if (st.kind === 'epub') {
        const chap = epubChapterText();
        const where = st.loc && st.toc ? (st.toc.find((t) => st.loc.start.href && st.loc.start.href.split('#')[0].endsWith(t.href.split('#')[0])) || {}).label : '';
        return `[Reader context: "${st.meta.name}"${where ? ', chapter: ' + where.trim() : ''}.]\n\nChapter text (may be truncated):\n${chap.slice(0, 9000)}`;
      }
      const pages = new Set([st.page]);
      atts.forEach((a) => a.page && pages.add(a.page));
      const focusPage = (atts.find((a) => a.page) || {}).page || st.page;
      const info = await RD.bookInfo();
      const loc = await RD.locationOf(focusPage);
      const parts = [[
        `[Book: "${info.title}"${info.author ? ' by ' + info.author : ''}, ${st.pdf.numPages} PDF pages.`,
        loc.trail.length ? `Location: ${loc.trail.join(' › ')}.` : (loc.header ? `Running header of the page: "${loc.header}".` : ''),
        `The student is on PDF page ${focusPage}${loc.printed && loc.printed !== focusPage ? ` (printed page number ${loc.printed})` : ''}.]`,
      ].filter(Boolean).join(' ')];
      // what the book has covered so far (structure, earlier results, referenced results, current section)
      const focusText = atts.map((a) => a.text || '').join('\n') + '\n' + (await RD.lines(focusPage)).map((l) => l.text).join('\n');
      const covered = await RD.coveredSoFar(focusPage, A.settings.aiMode === 'app' ? 9000 : 22000, focusText);
      if (covered) parts.push(covered);
      else if (RD.index && RD.index.done < st.pdf.numPages) parts.push(`(Axiom is still reading the book: ${RD.index.done} of ${st.pdf.numPages} pages indexed.)`);
      // a little of the previous page, so arguments that start there are not cut off
      if (focusPage > 1 && atts.some((a) => a.page && a.rect && a.rect[1] < 0.3)) {
        const prev = await RD.lines(focusPage - 1);
        if (prev.length) parts.push(`End of the previous page (p. ${focusPage - 1}), for continuity:\n` + prev.slice(-18).map((l) => `L${l.id}: ${l.text}`).join('\n'));
      }
      for (const n of pages) {
        const lines = await RD.lines(n);
        if (!lines.length) { parts.push(`p. ${n}: (no extractable text; this page is probably a scan)`); continue; }
        let body = '', count = 0;
        for (const l of lines) { const row = `L${l.id}: ${l.text}\n`; if (body.length + row.length > 7000 || count > 140) { body += '…\n'; break; } body += row; count++; }
        parts.push(`p. ${n} (text lines):\n${body}`);
      }
      for (const a of atts) if (a.page && a.rect) {
        const sel = linesIn(await RD.lines(a.page), a.rect);
        if (sel.length) parts.push(`The selected region on p. ${a.page} covers lines L${sel[0].id}–L${sel[sel.length - 1].id}.`);
      }
      return parts.join('\n\n');
    },
    onCite: async (p, a, b) => {
      if (st.kind === 'epub') return;
      const lines = await RD.lines(p);
      const sel = lines.filter((l) => l.id >= a && l.id <= b);
      st.cites = [{ page: p, rects: sel.length ? sel.map((l) => [l.r[0] - 0.004, l.r[1] - 0.003, l.r[2] + 0.004, l.r[3] + 0.003]) : [], flash: true }];
      goto(p, sel.length ? sel[0].r[1] : 0);
      drawOverlays(p);
      setTimeout(() => { if (st && st.cites[0]) { st.cites[0].flash = false; drawOverlays(p); } }, 1600);
      if (!sel.length) A.toast('Couldn\'t find those lines on this page');
    },
    onAttClick: (a) => { if (!a.page) return; st.focus = a.rect ? { page: a.page, rect: a.rect } : null; goto(a.page, a.rect ? a.rect[1] : 0); drawOverlays(a.page); },
    onAnswer: async (text) => {
      if (st.kind === 'epub') return;
      const re = /\[\[p(\d+):L(\d+)(?:\s*[-–]\s*L?(\d+))?\]\]/g; let m; const by = new Map();
      while ((m = re.exec(text))) { const p = +m[1]; if (!by.has(p)) by.set(p, []); by.get(p).push([+m[2], +(m[3] || m[2])]); }
      const cites = [];
      for (const [p, ranges] of by) { const lines = await RD.lines(p); const rects = []; ranges.forEach(([a, b]) => lines.filter((l) => l.id >= a && l.id <= b).forEach((l) => rects.push([l.r[0] - 0.004, l.r[1] - 0.003, l.r[2] + 0.004, l.r[3] + 0.003]))); cites.push({ page: p, rects }); }
      if (cites.length) { st.cites = cites; redrawAll(); }
    },
  };
  RD.ctx = readerCtx;
  A.on('index:progress', () => { if (st && st.railTab === 'toc' && st.rail && !st.rail.hidden) renderRail(); });

  /* ---------- navigation ---------- */
  function goto(n, frac = 0, smooth = true) {
    if (!st) return;
    n = A.clamp(n, 1, st.pages.length);
    const p = st.pages[n - 1];
    st.main.scrollTo({ top: p.el.offsetTop + frac * p.el.offsetHeight - 80, behavior: smooth ? 'smooth' : 'auto' });
  }
  RD.goto = goto;
  function onScroll() {
    const mid = st.main.scrollTop + st.main.clientHeight * 0.4;
    let n = 1;
    for (const p of st.pages) { if (p.el.offsetTop <= mid) n = p.n; else break; }
    // reading chrome: hide while scrolling down, show on scroll up
    const y = st.main.scrollTop, dy = y - (st._lastY || 0);
    st._lastY = y;
    // only the reader's own scrolling hides the bars: layout changes (pages rendering, zoom, restoring the position) must not
    const byUser = performance.now() - (st._touchAt || 0) < 1600;
    if (byUser && Math.abs(dy) > 6 && !st.tool.startsWith('w')) host.classList.toggle('chrome-hidden', dy > 0 && y > 120 && !host.querySelector('.rd-actions'));
    if (n !== st.page) {
      st.page = n;
      setPageLabel(n);
      st.scrub.value = n;
      clearTimeout(st._sv);
      st._sv = setTimeout(() => { const d = A.ST.doc(st.meta.id); if (d) { d.lastPage = n; d.lastRead = Date.now(); A.saveSettings(); } }, 600);
      const th = st.rail && st.rail.querySelector(`.rd-th[data-n="${n}"]`);
      st.rail && st.rail.querySelectorAll('.rd-th.on').forEach((x) => x.classList.remove('on'));
      if (th) th.classList.add('on');
    }
  }

  function setPageLabel(n) {
    if (!st || !st.pdf) { if (st) st.pageLbl.textContent = String(n); return; }
    const lab = RD.index && RD.index.labels && RD.index.labels[n - 1];
    st.pageLbl.textContent = lab && lab !== String(n) ? 'p. ' + lab : 'Page ' + n;
    st.totalEl.textContent = `${n} of ${st.pdf.numPages}`;
    clearTimeout(st._loc);
    st._loc = setTimeout(async () => {
      if (!st) return;
      const loc = await RD.locationOf(n);
      if (!lab && loc.printed && loc.printed !== n) st.pageLbl.textContent = 'p. ' + loc.printed;
      const ch = loc.trail[loc.trail.length - 1];
      if (ch && st.subEl) { st.subEl.textContent = ch; st.subEl.title = loc.trail.join(' › '); }
    }, 250);
  }
  RD.setPageLabel = setPageLabel;
  /* title from the PDF's own metadata when the file name is just a file name */
  function cleanTitle(t) {
    return String(t || '').replace(/[_]+/g, ' ').replace(/\s*\(?z-?lib(?:rary)?(?:\.org)?\)?.*$/i, '').replace(/\s*-\s*(libgen|annas?-archive).*$/i, '').replace(/\s+/g, ' ').trim();
  }
  RD.cleanTitle = cleanTitle;

  /* ---------- side rail: pages, contents, highlights ---------- */
  function renderRail() {
    if (!st || !st.rail || st.rail.hidden) return;
    const rail = st.rail;
    rail.innerHTML = '';
    const tabs = h('div', { class: 'seg rd-rail-tabs' });
    (st.kind === 'epub' ? [['toc', 'Contents'], ['hl', 'Highlights']] : [['pages', 'Pages'], ['toc', 'Contents'], ['hl', 'Highlights']]).forEach(([id, l]) => tabs.append(h('button', { class: st.railTab === id ? 'on' : '', onclick: () => { st.railTab = id; renderRail(); } }, l)));
    const body = h('div', { class: 'rd-rail-body' });
    rail.append(tabs, body);
    if (st.railTab === 'pages') {
      const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
        if (!en.isIntersecting || en.target.dataset.done) return;
        en.target.dataset.done = '1';
        try {
          const page = await st.pdf.getPage(+en.target.dataset.n);
          const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 220 / vp1.width });
          const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          en.target.querySelector('.rd-th-img').append(c);
        } catch (e) { /* ignore */ }
      }), { root: body, rootMargin: '400px 0px' });
      st.pages.forEach((p) => {
        const t = h('button', { class: 'rd-th' + (p.n === st.page ? ' on' : ''), dataset: { n: p.n }, onclick: () => goto(p.n, 0, false) }, h('span', { class: 'rd-th-img', style: { aspectRatio: String(1 / p.aspect) } }), h('span', { class: 'rd-th-n num' }, String(p.n)));
        body.append(t); io.observe(t);
      });
      requestAnimationFrame(() => { const on = body.querySelector('.rd-th.on'); if (on) on.scrollIntoView({ block: 'center' }); });
    } else if (st.railTab === 'toc' && st.kind === 'epub') {
      if (!st.toc) { body.append(h('p', { class: 'muted small rd-pad' }, 'Loading contents…')); return; }
      if (!st.toc.length) body.append(h('p', { class: 'muted small rd-pad' }, 'This book has no table of contents.'));
      st.toc.forEach((t) => body.append(h('button', { class: 'rd-toc', style: { paddingLeft: 10 + t.depth * 14 + 'px' }, onclick: () => st.rendition.display(t.href) }, t.label.trim())));
    } else if (st.railTab === 'toc') {
      if (!st.outline) {
        body.append(h('p', { class: 'muted small rd-pad' }, 'Loading contents…'));
        st.pdf.getOutline().then(async (ol) => { st.outline = ol || []; renderRail(); }).catch(() => { st.outline = []; renderRail(); });
        return;
      }
      const status = () => {
        const ix = RD.index;
        if (!ix) return null;
        const res = ix.results.filter((r) => KEEP_KINDS.has(r.kind)).length;
        return h('p', { class: 'rd-index-status' }, ix.done < ix.pages ? `Reading the book for the tutor… ${ix.done} of ${ix.pages} pages` : `The tutor has read all ${ix.pages} pages · ${res} definitions and results`);
      };
      if (!st.outline.length) {
        const heads = (RD.index && RD.index.heads) || [];
        if (!heads.length) { body.append(h('p', { class: 'muted small rd-pad' }, RD.index && RD.index.done >= RD.index.pages ? 'No chapters were found in this PDF. Use Pages or search instead.' : 'Finding the chapters in this book…')); const s0 = status(); if (s0) body.append(s0); return; }
        body.append(h('p', { class: 'muted small rd-pad', style: { paddingBottom: '2px' } }, 'Chapters found by reading the book'));
        heads.forEach((x) => body.append(h('button', { class: 'rd-toc', style: { paddingLeft: 10 + x.level * 14 + 'px' }, onclick: () => goto(x.page, 0, false) }, h('span', { class: 'grow' }, x.title), h('span', { class: 'num muted small' }, String(x.page)))));
        const s1 = status(); if (s1) body.append(s1);
        return;
      }
      const walk = (items, depth) => items.forEach((it) => {
        const b = h('button', { class: 'rd-toc', style: { paddingLeft: 10 + depth * 14 + 'px' } }, it.title);
        b.addEventListener('click', async () => {
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await st.pdf.getDestination(dest);
            if (dest) goto((await st.pdf.getPageIndex(dest[0])) + 1, 0, false);
          } catch (e) { A.toast('That entry has no page'); }
        });
        body.append(b);
        if (it.items && it.items.length && depth < 3) walk(it.items, depth + 1);
      });
      walk(st.outline, 0);
      { const ix = RD.index; if (ix) body.append(h('p', { class: 'rd-index-status' }, ix.done < ix.pages ? `Reading the book for the tutor… ${ix.done} of ${ix.pages} pages` : `The tutor has read all ${ix.pages} pages · ${ix.results.filter((r) => KEEP_KINDS.has(r.kind)).length} definitions and results`)); }
    } else {
      const hls = st.ann.highlights.slice().sort((a, b) => (a.page || 0) - (b.page || 0) || a.created - b.created);
      if (!hls.length) body.append(h('p', { class: 'muted small rd-pad' }, 'Switch to the highlighter in the top bar, or draw a box and tap Highlight. Your highlights collect here.'));
      hls.forEach((hl) => body.append(h('button', { class: 'rd-hl-item', onclick: () => { if (hl.cfi) st.rendition.display(hl.cfi); else goto(hl.page, hl.rect[1]); } }, h('i', { class: 'rd-sw ' + (hl.color || 'yellow') }), h('span', { class: 'grow' }, hl.text || 'Highlighted region'), hl.page ? h('span', { class: 'num muted small' }, 'p. ' + hl.page) : null)));
    }
  }

  /* ---------- search ---------- */
  function openSearch(anchor) {
    const boxEl = h('div', { class: 'rd-search' });
    const inp = h('input', { class: 'field', type: 'search', id: 'rd-search-in', placeholder: 'Search in this book', style: { margin: 0 } });
    const res = h('div', { class: 'rd-search-res' });
    let token = 0;
    const run = async () => {
      const q = inp.value.trim().toLowerCase();
      const my = ++token;
      res.innerHTML = '';
      if (q.length < 2) return;
      const status = h('p', { class: 'muted small' }, 'Searching…'); res.append(status);
      let found = 0;
      for (let n = 1; n <= st.pages.length && my === token; n++) {
        const lines = await RD.lines(n);
        for (const l of lines) {
          const i = l.text.toLowerCase().indexOf(q);
          if (i < 0) continue;
          found++;
          const snip = l.text.slice(Math.max(0, i - 40), i + q.length + 60);
          res.append(h('button', { class: 'rd-hit', onclick: () => { A.closePopovers(); st.cites = [{ page: n, rects: [[l.r[0] - 0.004, l.r[1] - 0.003, l.r[2] + 0.004, l.r[3] + 0.003]], flash: true }]; goto(n, l.r[1]); drawOverlays(n); } }, h('span', { class: 'num muted small' }, 'p. ' + n), h('span', null, snip)));
          if (found > 60) break;
        }
        if (found > 60) break;
        if (n % 20 === 0) status.textContent = `Searching… page ${n} of ${st.pages.length}`;
      }
      if (my === token) status.textContent = found ? `${found}${found > 60 ? '+' : ''} matches` : 'No matches. Scanned pages have no searchable text.';
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    boxEl.append(inp, res);
    A.popover(boxEl, anchor, { side: 'down' });
    setTimeout(() => inp.focus(), 50);
  }

  /* ---------- tutor panel ---------- */
  function toggleTutor(open = host.querySelector('.rd-tutor').hidden) {
    const t = host.querySelector('.rd-tutor');
    t.hidden = !open;
    host.classList.toggle('with-tutor', open);
    host.querySelector('#rd-btn-tutor').classList.toggle('on', open);
    host.classList.remove('chrome-hidden');
    S.readerTutor = open; A.saveSettings();
    if (open && !t.querySelector('.tutor')) { t.querySelector('.rd-tutor-body').innerHTML = ''; A.AI.mount(t.querySelector('.rd-tutor-body'), readerCtx); }
    requestAnimationFrame(() => layout());
  }
  function toggleRail(open = st.rail.hidden) {
    st.rail.hidden = !open;
    host.classList.toggle('with-rail', open);
    host.querySelector('#rd-btn-rail').classList.toggle('on', open);
    S.readerRail = open; A.saveSettings();
    renderRail();
    requestAnimationFrame(() => layout());
  }
  const applyWidth = () => host.style.setProperty('--rdw', Math.round(A.clamp(S.readerTutorW || innerWidth * 0.36, Math.min(320, innerWidth * 0.45), innerWidth * (innerWidth < 1000 ? 0.5 : 0.6))) + 'px');

  /* ---------- EPUB (reflowable books, paginated like Apple Books) ---------- */
  const EPUB_THEMES = {
    paper: { body: { color: '#1b1d22', background: '#ffffff' } },
    sepia: { body: { color: '#3b3021', background: '#f4ecd8' } },
    night: { body: { color: '#d9dce2', background: '#16171a' } },
  };
  function applyEpubTheme() {
    if (!st || !st.rendition) return;
    st.rendition.themes.select(S.readerTheme || 'paper');
    st.rendition.themes.fontSize(Math.round((S.epubFont || 1) * 108) + '%');
  }
  RD.applyEpubTheme = applyEpubTheme;
  async function openEpub(meta, token, main, bottomParts) {
    const ePub = await A.ST.epubLib();
    const blob = await A.store.loadFile('doc_' + meta.id, 'application/epub+zip');
    if (!blob) throw new Error('missing');
    const book = ePub(await blob.arrayBuffer());
    if (!st || st.token !== token) return;
    st.book = book;
    main.classList.add('rd-epub-main');
    const stage = h('div', { class: 'rd-epub-stage' });
    const view = h('div', { class: 'rd-epub' });
    const prev = h('button', { class: 'rd-turn prev', 'aria-label': 'Previous page', html: A.icon('chev') });
    const next = h('button', { class: 'rd-turn next', 'aria-label': 'Next page', html: A.icon('chev') });
    stage.append(prev, view, next);
    main.append(stage);
    const rendition = book.renderTo(view, { width: '100%', height: '100%', flow: 'paginated', spread: 'auto', allowScriptedContent: false });
    st.rendition = rendition;
    Object.entries(EPUB_THEMES).forEach(([k, v]) => rendition.themes.register(k, Object.assign({}, v, {
      'p, li, blockquote': { 'line-height': '1.6' }, body: Object.assign({}, v.body, { 'font-family': '"Iowan Old Style", "Palatino", Georgia, serif', padding: '0 8px !important' }),
      '::selection': { background: 'rgba(80,140,255,.35)' },
    })));
    applyEpubTheme();
    prev.addEventListener('click', () => rendition.prev());
    next.addEventListener('click', () => rendition.next());
    // swipe and tap zones inside the book's frames
    rendition.hooks.content.register((contents) => {
      const doc = contents.document;
      let sx = 0, sy = 0, t0 = 0;
      doc.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now(); }, { passive: true });
      doc.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (Date.now() - t0 < 600 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !doc.getSelection().toString()) (dx < 0 ? rendition.next() : rendition.prev());
      }, { passive: true });
      doc.addEventListener('keyup', (e) => { if (e.key === 'ArrowRight') rendition.next(); if (e.key === 'ArrowLeft') rendition.prev(); });
    });
    // highlights saved by CFI
    const paintHl = (hl) => { try { rendition.annotations.highlight(hl.cfi, { id: hl.id }, () => {}, 'rd-epub-hl', { fill: { yellow: '#ffd60a', green: '#4bd27a', blue: '#4d9bff', pink: '#ff5fa8' }[hl.color || 'yellow'], 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' }); } catch (e) { /* stale cfi */ } };
    st.paintHl = paintHl;
    // selection → actions
    rendition.on('selected', async (cfi, contents) => {
      let text = '';
      try { text = (await book.getRange(cfi)).toString(); } catch (e) { text = contents.window.getSelection().toString(); }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      let rect = null;
      try { const rr = contents.window.getSelection().getRangeAt(0).getBoundingClientRect(); const fr = contents.document.defaultView.frameElement.getBoundingClientRect(); rect = { left: fr.left + rr.left, top: fr.top + rr.top, right: fr.left + rr.right, bottom: fr.top + rr.bottom }; } catch (e) { /* position fallback */ }
      showEpubActions(cfi, text, rect, contents);
    });
    const [lbl, total, scrub] = bottomParts;
    scrub.min = 0; scrub.max = 1000; scrub.value = 0;
    scrub.addEventListener('change', () => { if (st.locReady) rendition.display(book.locations.cfiFromPercentage(+scrub.value / 1000)); });
    rendition.on('relocated', (loc) => {
      if (!st) return;
      st.loc = loc;
      const pct = st.locReady ? book.locations.percentageFromCfi(loc.start.cfi) : (loc.start.percentage || 0);
      lbl.textContent = Math.round(pct * 100) + '%';
      if (st.locReady) scrub.value = Math.round(pct * 1000);
      const item = st.toc && st.toc.find((t) => loc.start.href && loc.start.href.split('#')[0].endsWith(t.href.split('#')[0]));
      total.textContent = item ? item.label.trim() : '';
      clearTimeout(st._sv);
      st._sv = setTimeout(() => { const d = A.ST.doc(meta.id); if (d) { d.cfi = loc.start.cfi; d.progress = pct; d.lastRead = Date.now(); A.saveSettings(); } }, 500);
      clearActions();
    });
    book.loaded.navigation.then((nav) => { if (st) { st.toc = flattenToc(nav.toc || []); renderRail(); } }).catch(() => {});
    book.loaded.metadata.then((md) => { if (md && md.title && st) host.querySelector('.rd-title-main').textContent = md.title; }).catch(() => {});
    await rendition.display(meta.cfi || undefined);
    (st.ann.highlights || []).filter((x) => x.cfi).forEach(paintHl);
    book.ready.then(() => book.locations.generate(1400)).then(() => { if (!st) return; st.locReady = true; if (st.loc) rendition.reportLocation ? rendition.reportLocation() : null; }).catch(() => {});
    const d = A.ST.doc(meta.id); if (d) { d.lastRead = Date.now(); A.saveSettings(); }
  }
  const flattenToc = (items, depth = 0, out = []) => { items.forEach((it) => { out.push({ label: it.label, href: it.href, depth }); if (it.subitems && it.subitems.length) flattenToc(it.subitems, depth + 1, out); }); return out; };
  function showEpubActions(cfi, text, rect, contents) {
    clearActions();
    const hr = host.getBoundingClientRect();
    const bar = h('div', { class: 'rd-actions', role: 'toolbar', 'aria-label': 'Selection' });
    const b = (icon, label, fn, primary) => { const x = h('button', { class: primary ? 'primary' : '', onclick: fn }); x.innerHTML = A.icon(icon); x.append(label); bar.append(x); };
    const att = { kind: 'text', label: '“' + text.slice(0, 32) + (text.length > 32 ? '…”' : '”'), text, cfi };
    const done = () => { clearActions(); try { contents.window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } };
    b('spark', 'Ask', () => { done(); toggleTutor(true); A.AI.ask('', { send: false, attachments: [att] }); }, true);
    b('book', 'Explain', () => { done(); toggleTutor(true); A.AI.ask('Explain this passage rigorously.', { mode: 'explain', attachments: [att] }); });
    b('help', 'Hint', () => { done(); toggleTutor(true); A.AI.ask('Give me a hint for this. Not the solution.', { mode: 'hint', attachments: [att] }); });
    b('rename', 'Highlight', () => { const hl = { id: A.uid(), cfi, color: 'yellow', text, created: Date.now() }; st.ann.highlights.push(hl); st.paintHl(hl); saveAnn(); renderRail(); done(); A.toast('Highlighted'); });
    b('copy', 'Copy', () => { copyText(text); done(); });
    host.append(bar);
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const x = rect ? (rect.left + rect.right) / 2 - bw / 2 - hr.left : hr.width / 2 - bw / 2;
    let y = rect ? rect.top - bh - 12 - hr.top : 80;
    if (y < 70 && rect) y = rect.bottom + 12 - hr.top;
    bar.style.left = A.clamp(x, 8, hr.width - bw - 8) + 'px';
    bar.style.top = A.clamp(y, 64, hr.height - bh - 60) + 'px';
  }
  const epubChapterText = () => {
    try { const c = st.rendition.getContents()[0]; return (c && c.document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim(); } catch (e) { return ''; }
  };

  /* ---------- open / close ---------- */
  RD.open = async (meta) => {
    if (st) RD.close(true);
    host.innerHTML = '';
    const token = Math.random();
    const isEpub = meta.type === 'epub';
    st = { meta, kind: isEpub ? 'epub' : 'pdf', pages: [], zoom: 1, fit: S.readerFit || 'width', tool: 'read', page: meta.lastPage || 1, ann: ann0(), cites: [], focus: null, railTab: isEpub ? 'toc' : 'pages', token, inkTool: 'pen', inkColor: 'black', inkWidth: 0.0026, inkHist: [] };
    const ib = (icon, title, fn, id) => { const b = h('button', { class: 'ibtn', title, 'aria-label': title, id, html: A.icon(icon) }); b.addEventListener('click', fn); return b; };
    const subj = meta.subject && A.SU.get(meta.subject);
    const toolSeg = h('div', { class: 'seg rd-tools' });
    const inkBar = h('div', { class: 'rd-group panel rd-inkbar', hidden: true });
    const setTool = (t) => { st.tool = t; [...toolSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.t === t)); host.dataset.tool = t; inkBar.hidden = t !== 'write'; clearActions(); };
    [['read', 'Read', 'book', 'Read: circle any passage with the Pencil to ask about it'], ['highlight', 'Highlight', 'b-highlighter', 'Highlight passages with the Pencil'], ['write', 'Write', 'b-pen', 'Write on the page with the Pencil']].forEach(([t, l, ic, tip]) => { const b = h('button', { dataset: { t }, title: tip }); b.innerHTML = A.icon(ic); b.append(l); b.addEventListener('click', () => setTool(t)); toolSeg.append(b); });
    const drawInkBar = () => {
      inkBar.innerHTML = '';
      Object.entries(INK).forEach(([k, c]) => inkBar.append(h('button', { class: 'rd-ink-c' + (st.inkTool === 'pen' && st.inkColor === k ? ' on' : ''), style: { background: c }, 'aria-label': k + ' pen', onclick: () => { st.inkTool = 'pen'; st.inkColor = k; drawInkBar(); } })));
      inkBar.append(h('div', { class: 'sb-sep' }));
      [[0.0018, 'Fine'], [0.0026, 'Medium'], [0.0042, 'Bold']].forEach(([w, l]) => inkBar.append(h('button', { class: 'rd-ink-w' + (Math.abs(st.inkWidth - w) < 1e-6 ? ' on' : ''), title: l, 'aria-label': l + ' line', onclick: () => { st.inkWidth = w; st.inkTool = 'pen'; drawInkBar(); } }, h('i', { style: { height: Math.round(w * 900) + 'px' } }))));
      inkBar.append(h('div', { class: 'sb-sep' }));
      const er = ib('b-eraser', 'Eraser', () => { st.inkTool = st.inkTool === 'eraser' ? 'pen' : 'eraser'; drawInkBar(); }); er.classList.toggle('on', st.inkTool === 'eraser'); inkBar.append(er);
      inkBar.append(ib('undo', 'Undo', () => RD.inkUndo()));
      const opts = ib('more', 'Pen options', () => {
        const m = h('div', { class: 'menu' });
        m.append(h('button', { class: S.readerSmooth ? 'on' : '', onclick: () => { A.closePopovers(); S.readerSmooth = !S.readerSmooth; A.saveSettings(); A.toast(S.readerSmooth ? 'New strokes are smoothed' : 'Strokes stay exactly as written', 1600); } }, A.iconEl(S.readerSmooth ? 'check' : 'minus'), 'Smooth strokes'));
        m.append(h('button', { onclick: () => { A.closePopovers(); A.IN.calibratePen(); } }, A.iconEl('target'), 'Calibrate Apple Pencil…'));
        A.popover(m, opts, { side: 'down' });
      });
      inkBar.append(opts);
    };
    drawInkBar();
    const moreBtn = { _open: null };
    moreBtn._open = ((e) => {
      const m = h('div', { class: 'menu' });
      const val = h('span', { class: 'rd-zoomval num' }, isEpub ? Math.round((S.epubFont || 1) * 100) + '%' : Math.round(st.zoom * 100) + '%');
      const bump = (dir) => { if (isEpub) { S.epubFont = A.clamp((S.epubFont || 1) + dir * 0.1, 0.7, 2); A.saveSettings(); applyEpubTheme(); val.textContent = Math.round(S.epubFont * 100) + '%'; } else { st.zoom = A.clamp(st.zoom * (dir > 0 ? 1.2 : 1 / 1.2), 0.5, 3); layout(); val.textContent = Math.round(st.zoom * 100) + '%'; } };
      m.classList.add('rd-aa');
      m.append(h('div', { class: 'sub' }, isEpub ? 'Text size' : 'Zoom'),
        h('div', { class: 'rd-zoomrow' }, h('button', { class: 'ibtn', 'aria-label': 'Smaller', html: A.icon('minus'), onclick: () => bump(-1) }), val, h('button', { class: 'ibtn', 'aria-label': 'Larger', html: A.icon('plus'), onclick: () => bump(1) })));
      if (!isEpub) m.append(h('div', { class: 'seg rd-fitseg' }, ...[['width', 'Fit width'], ['page', 'Fit page']].map(([v, l]) => h('button', { class: st.fit === v ? 'on' : '', onclick: () => { st.fit = v; S.readerFit = v; A.saveSettings(); st.zoom = 1; layout(); val.textContent = '100%'; [...m.querySelectorAll('.rd-fitseg button')].forEach((b) => b.classList.toggle('on', b.textContent === l)); } }, l))));
      m.append(h('div', { class: 'sub' }, 'Page'));
      const sw = h('div', { class: 'rd-swatches' });
      [['paper', 'Paper'], ['sepia', 'Sepia'], ['night', 'Night']].forEach(([id, l]) => sw.append(h('button', { class: 'rd-swatch ' + id + ((S.readerTheme || 'paper') === id ? ' on' : ''), onclick: () => { S.readerTheme = id; A.saveSettings(); host.dataset.theme = id; applyEpubTheme(); sw.querySelectorAll('.rd-swatch').forEach((b) => b.classList.toggle('on', b.classList.contains(id))); } }, h('i', { html: A.icon('check') }), h('span', null, l))));
      m.append(sw);
      if (false) m.append(h('hr'));
      if (!isEpub) {
        m.append(h('hr'), h('button', { onclick: () => { A.closePopovers(); A.UI.solveBeside(A.ST.doc(meta.id), st.page); } }, A.iconEl('rename'), 'Solve beside this page…'));
      }
      A.popover(m, e.currentTarget, { side: 'down' });
    });
    const pageLbl = h('span', { class: 'num rd-page-n' }, String(st.page));
    const scrub = h('input', { type: 'range', class: 'rd-scrub', id: 'rd-scrub', min: 1, max: 1, value: st.page, 'aria-label': 'Page' });
    scrub.addEventListener('input', () => { pageLbl.textContent = scrub.value; });
    scrub.addEventListener('change', () => goto(+scrub.value, 0, false));
    const total = h('span', { class: 'num' }, '');
    const titleEl = h('div', { class: 'rd-title-main' }, cleanTitle(meta.title || meta.name));
    const subEl = h('div', { class: 'rd-title-sub' }, subj ? h('i', { class: 'dot', style: { background: subj.color } }) : null, meta.author || (subj ? subj.name : (meta.kind === 'sheet' ? 'Problem set' : '')));
    const top = h('header', { class: 'rd-top rd-bar' },
      h('div', { class: 'rd-slot rd-left' },
        ib('chev', 'Back to library', () => { RD.close(); A.emit('go:gallery'); }, 'rd-back'),
        h('div', { class: 'rd-title' }, titleEl, subEl)),
      h('div', { class: 'rd-slot rd-center' }, isEpub ? null : h('div', { class: 'rd-group-wrap' }, toolSeg, inkBar)),
      h('div', { class: 'rd-slot rd-right' },
        isEpub ? null : ib('search', 'Search', (e) => openSearch(e.currentTarget)),
        ib('gallery', isEpub ? 'Contents and highlights' : 'Pages, contents and highlights', () => toggleRail(), 'rd-btn-rail'),
        (() => { const b = h('button', { class: 'ibtn rd-aa-btn', title: 'Appearance', 'aria-label': 'Appearance' }, 'Aa'); b.addEventListener('click', (e) => moreBtn._open(e)); return b; })(),
        ib('spark', 'Tutor', () => toggleTutor(), 'rd-btn-tutor')));
    const main = h('main', { class: 'rd-main', tabindex: 0 });
    const pagesWrap = h('div', { class: 'rd-pages' });
    main.append(pagesWrap);
    const rail = h('aside', { class: 'rd-rail', hidden: true });
    const tutor = h('aside', { class: 'rd-tutor', hidden: true }, h('div', { class: 'rd-grip', title: 'Drag to resize' }),
      h('div', { class: 'rd-tutor-h' }, h('span', { class: 'rd-tutor-t' }, A.iconEl('spark'), 'Tutor'), h('button', { class: 'ibtn', 'aria-label': 'Close tutor', html: A.icon('close'), onclick: () => toggleTutor(false) })),
      h('div', { class: 'rd-tutor-body' }));
    const bottom = h('footer', { class: 'rd-bottom rd-bar' }, h('span', { class: 'rd-pg' }, pageLbl, h('span', { class: 'rd-pg-of' }, total)), scrub);
    host.append(top, rail, main, tutor, bottom);
    host.dataset.theme = S.readerTheme || 'paper';
    host.style.setProperty('--rd-filter', '');
    Object.assign(st, { main, rail, pageLbl, scrub, titleEl, subEl, totalEl: total });
    setTool('read');
    applyWidth();
    // resize tutor
    const grip = tutor.querySelector('.rd-grip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const mv = (ev) => { S.readerTutorW = Math.round(innerWidth - ev.clientX); applyWidth(); };
      const upg = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', upg); A.saveSettings(); layout(); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', upg);
    });
    host.hidden = false;
    // content
    st.ann = await loadAnn(meta.id);
    if (isEpub) {
      try { await openEpub(meta, token, main, [pageLbl, total, scrub]); }
      catch (e) { console.error(e); main.append(h('p', { class: 'muted rd-pad' }, 'This EPUB could not be opened. It may be protected by DRM (books bought in Apple Books usually are).')); }
      if (st && S.readerRail) toggleRail(true);
      if (st && S.readerTutor) toggleTutor(true);
      return;
    }
    if (meta.type === 'image') {
      pagesWrap.append(h('p', { class: 'muted rd-pad' }, 'Photos open on the canvas. Use “Work on this page on the canvas”.'));
      return;
    }
    try {
      await A.ST.pdfLib();
      st.pdf = await A.ST.loadPdf(meta);
    } catch (e) {
      console.error(e);
      pagesWrap.append(h('p', { class: 'muted rd-pad' }, A.ST.pdfError(e)));
      return;
    }
    if (!st || st.token !== token) return;
    const n = st.pdf.numPages;
    RD.index = null;
    setTimeout(() => { if (st && st.token === token) RD.buildIndex().then(() => { if (st && st.railTab === 'toc') renderRail(); if (st) setPageLabel(st.page); }); }, 1200);
    RD.bookInfo().then((info) => {
      if (!st || st.token !== token) return;
      const good = info.title && info.title.length > 2 && info.title.length < 90 && !/untitled|microsoft|\.(pdf|docx?|tex)$|^document$/i.test(info.title);
      const patch = {};
      if (good && !meta.title) patch.title = cleanTitle(info.title);
      if (info.author && !meta.author && info.author.length < 80) patch.author = info.author;
      if (Object.keys(patch).length) { A.ST.updateDoc(meta.id, patch); if (patch.title) titleEl.textContent = patch.title; if (patch.author) subEl.textContent = patch.author; }
    }).catch(() => {});
    total.textContent = '';
    scrub.max = n;
    const p1 = await st.pdf.getPage(1), vp = p1.getViewport({ scale: 1 });
    for (let i = 1; i <= n; i++) {
      const ov = h('div', { class: 'rd-ov' });
      const el = h('div', { class: 'rd-page', dataset: { n: i } }, ov);
      pagesWrap.append(el);
      st.pages.push({ n: i, el, ov, aspect: vp.height / vp.width, canvas: null, w: 0 });
    }
    st.io = new IntersectionObserver((ents) => ents.forEach((en) => { const p = st.pages[+en.target.dataset.n - 1]; if (!p) return; p.visible = en.isIntersecting; if (en.isIntersecting) { renderPage(p); drawOverlays(p.n); } }), { root: main, rootMargin: '1200px 0px' });
    st.pages.forEach((p) => st.io.observe(p.el));
    main.addEventListener('scroll', onScroll, { passive: true });
    const touched = () => { if (st) st._touchAt = performance.now(); };
    ['touchmove', 'touchend', 'wheel'].forEach((t) => main.addEventListener(t, touched, { passive: true }));
    let tap = null;
    main.addEventListener('pointerdown', (e) => { tap = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
    main.addEventListener('pointerup', (e) => {
      if (!tap || e.pointerType !== 'touch') return;
      const still = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8 && performance.now() - tap.t < 320;
      tap = null;
      if (still && !e.target.closest('.rd-hl, .rd-actions, .cite')) host.classList.toggle('chrome-hidden');
    });
    bindSelect(main);
    bindPinch(main, pagesWrap);
    layout(false);
    if (S.readerRail) toggleRail(true);
    if (S.readerTutor) toggleTutor(true);
    requestAnimationFrame(() => goto(st.page, 0, false));
    // record reading
    const d = A.ST.doc(meta.id); if (d) { d.lastRead = Date.now(); d.pages = n; A.saveSettings(); }
  };
  /* two-finger zoom around the point between the fingers (and pan while pinching); the page under the fingers stays put */
  function bindPinch(main, inner) {
    const pts = new Map();
    let g = null;
    main.addEventListener('touchmove', (e) => { if (e.touches.length >= 2) e.preventDefault(); }, { passive: false });
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; };
    main.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const m = mid(), ir = inner.getBoundingClientRect();
        g = { d0: Math.max(20, m.d), x0: m.x, y0: m.y, z0: st.zoom, z: st.zoom, x: m.x, y: m.y, anchor: anchorAt(m.x, m.y) };
        inner.style.transformOrigin = `${m.x - ir.left}px ${m.y - ir.top}px`;
        inner.style.willChange = 'transform';
      }
    });
    main.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (!g || pts.size !== 2) return;
      const m = mid();
      g.z = A.clamp(g.z0 * m.d / g.d0, 0.5, 4); g.x = m.x; g.y = m.y;
      inner.style.transform = `translate(${m.x - g.x0}px, ${m.y - g.y0}px) scale(${g.z / g.z0})`;
    });
    const end = (e) => {
      if (!pts.delete(e.pointerId) || !g || pts.size >= 2) return;
      const done = g; g = null; pts.clear();
      inner.style.transform = ''; inner.style.willChange = '';
      if (Math.abs(done.z - done.z0) < 0.02 && Math.hypot(done.x - done.x0, done.y - done.y0) < 4) return;
      st.zoom = done.z;
      layout(false);
      if (done.anchor) restoreAnchor(Object.assign({}, done.anchor, { cx: done.x, cy: done.y }));
    };
    main.addEventListener('pointerup', end); main.addEventListener('pointercancel', end);
  }
  RD.close = (silent) => {
    if (!st) return;
    try { st.io && st.io.disconnect(); } catch (e) { /* ignore */ }
    try { if (st.rendition) st.rendition.destroy(); } catch (e) { /* ignore */ }
    if (st.book) { const bk = st.book; Promise.resolve(bk.ready).catch(() => {}).then(() => { try { bk.destroy(); } catch (e) { /* ignore */ } }); }
    saveAnn.flush && saveAnn.flush();
    const d = A.ST.doc(st.meta.id); if (d) { d.lastPage = st.page; d.lastRead = Date.now(); A.saveSettings(); }
    st = null;
    host.hidden = true;
    host.innerHTML = '';
    void silent;
  };
  RD.isOpen = () => !!st;
  RD.mount = (el) => {
    host = el;
    addEventListener('resize', () => { if (st) { applyWidth(); layout(); } });
    addEventListener('keydown', (e) => {
      if (!st || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { goto(st.page + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { goto(st.page - 1); e.preventDefault(); }
      if (e.key === 'Escape') { st.focus = null; clearActions(); redrawAll(); }
    });
  };
})();
