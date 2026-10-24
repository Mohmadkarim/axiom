/* Axiom tutor: Claude inside the study panel. Sees your canvas, selections and document pages on request. */
'use strict';
(() => {
  const D = A.D, R = A.R, h = A.h;
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
      const css = h('link', { rel: 'stylesheet', href: KATEX + 'katex.min.css' });
      document.head.append(css);
      const s = h('script', { src: KATEX + 'katex.min.js' });
      s.onload = () => res(window.katex); s.onerror = () => res(null);
      document.head.append(s);
    });
    return katexP;
  };

  /* ---------- markdown + math ---------- */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  AI.md = (src, kx) => {
    const math = [];
    const keep = (tex, display) => { math.push({ tex, display }); return `\u0000${math.length - 1}\u0000`; };
    let s = String(src || '');
    const code = [];
    s = s.replace(/```([\w-]*)\n?([\s\S]*?)(```|$)/g, (_, lang, body) => { code.push(body); return `\u0001${code.length - 1}\u0001`; });
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
    const lines = s.split('\n');
    const out = [];
    let list = null, para = [];
    const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushP(); flushL(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushP(); flushL(); const n = Math.min(4, m[1].length + 2); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      if (/^\s*---+\s*$/.test(line)) { flushP(); flushL(); out.push('<hr>'); continue; }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    let html = out.join('');
    html = html.replace(/\u0001(\d+)\u0001/g, (_, i) => '<pre><code>' + esc(code[+i]) + '</code></pre>');
    html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
      const { tex, display } = math[+i];
      if (kx) { try { return kx.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch (e) { /* fall through */ } }
      return display ? `<div class="mathraw">${esc(tex)}</div>` : `<code class="mathraw">${esc(tex)}</code>`;
    });
    return html;
  };

  /* ---------- snapshots ---------- */
  const regionShot = (bb, onlyIds, maxPx = 1500) => {
    const w = bb[2] - bb[0], hh = bb[3] - bb[1];
    const scale = Math.min(3, maxPx / Math.max(w, hh));
    const c = R.renderRegion(D.doc, bb, scale, { bg: true, grid: false, onlyIds });
    return c.toDataURL('image/jpeg', 0.86);
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

  /* ---------- conversation state (saved with the drawing) ---------- */
  AI.pending = [];
  const sessionPdf = new Map(); // attachment id -> base64, kept in memory only
  let mode = 'explain', busy = false, root = null, abortCtl = null;
  const chats = () => { if (!D.doc.chats) D.doc.chats = []; return D.doc.chats; };
  const chat = () => {
    let c = chats().find((x) => x.id === D.doc.chatActive);
    if (!c) { c = { id: A.uid(), title: 'New conversation', created: Date.now(), msgs: [] }; chats().push(c); D.doc.chatActive = c.id; }
    return c;
  };
  AI.attach = (att) => { if (!att) return; att.id = att.id || A.uid(); AI.pending.push(att); if (root) drawChips(); };

  /* ---------- UI ---------- */
  let els = {};
  AI.mount = (container) => {
    root = h('div', { class: 'tutor' });
    container.append(root);
    katex();
    draw();
  };
  const draw = () => {
    if (!root) return;
    root.innerHTML = '';
    if (!S.aiKey) { root.append(setupCard()); return; }
    const c = chat();
    const convBtn = h('button', { class: 'conv-btn', title: 'Conversations' }, h('span', { class: 'grow' }, c.title), A.iconEl('chevdown'));
    convBtn.addEventListener('click', () => convMenu(convBtn));
    const modeSeg = h('div', { class: 'seg mode-seg' });
    AI.modes.forEach((m) => modeSeg.append(h('button', { class: m.id === mode ? 'on' : '', onclick: () => { mode = m.id; draw(); } }, m.name)));
    const model = h('select', { class: 'model-sel', id: 'ai-model', 'aria-label': 'Model' }, ...AI.models.map((m) => h('option', { value: m.id, selected: S.aiModel === m.id }, m.name)));
    model.addEventListener('change', () => { S.aiModel = model.value; A.saveSettings(); });
    const list = h('div', { class: 'msgs', 'aria-live': 'polite' });
    els.list = list;
    if (!c.msgs.length) list.append(emptyState());
    c.msgs.forEach((m) => list.append(msgEl(m)));
    const chipsRow = h('div', { class: 'att-row' });
    els.chips = chipsRow;
    const ta = h('textarea', { class: 'composer-in', id: 'ai-input', rows: 1, placeholder: mode === 'check' ? 'What should I check? (your canvas is attached)' : 'Ask about your work, a page, or a concept…' });
    els.ta = ta;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    const sendBtn = h('button', { class: 'send-btn', 'aria-label': busy ? 'Stop' : 'Send', html: A.icon(busy ? 'close' : 'send') });
    sendBtn.addEventListener('click', () => (busy ? stop() : send()));
    els.send = sendBtn;
    root.append(h('div', { class: 'tutor-head' }, convBtn, model), modeSeg, list, h('div', { class: 'composer' }, chipsRow, h('div', { class: 'composer-row' }, ta, sendBtn)));
    drawChips();
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  };
  const emptyState = () => {
    const subj = A.SU.name(D.doc.subject);
    return h('div', { class: 'tutor-empty' },
      h('div', { class: 'te-mark', html: A.icon('spark') }),
      h('h4', null, subj ? `Tutor for ${subj}` : 'Your tutor'),
      h('p', null, 'Ask about a concept, a page of your PDF, or your own handwritten solution. Add your canvas, a selection or the current page with the buttons below, so you never need screenshots.'),
      h('div', { class: 'te-tips' },
        ...['Check my solution on the canvas', 'Give me a hint for this problem, not the answer', 'Explain this page more rigorously', 'Quiz me on what I just read'].map((t) => h('button', { class: 'chip ghost', onclick: () => { if (/check/i.test(t)) mode = 'check'; else if (/hint/i.test(t)) mode = 'hint'; else if (/quiz/i.test(t)) mode = 'quiz'; else mode = 'explain'; draw(); els.ta.value = t; els.ta.focus(); } }, t))));
  };
  const drawChips = () => {
    const row = els.chips;
    if (!row) return;
    row.innerHTML = '';
    AI.pending.forEach((a) => {
      const chip = h('span', { class: 'att-chip' }, a.url ? h('img', { src: a.url, alt: '' }) : A.iconEl('pdf'), h('span', { class: 'att-l' }, a.label),
        h('button', { class: 'chip-x', 'aria-label': 'Remove ' + a.label, html: A.icon('close'), onclick: () => { AI.pending = AI.pending.filter((x) => x !== a); drawChips(); } }));
      row.append(chip);
    });
    const add = (icon, label, fn) => row.append(h('button', { class: 'att-add', onclick: fn }, A.iconEl(icon), label));
    add('image', 'Canvas', () => AI.attach(AI.shotCanvas()));
    if (R.sel.size) add('selectall', 'Selection', () => AI.attach(AI.shotSelection()));
    if (A.ST.activeDoc()) add('pdf', 'Current page', async () => AI.attach(await A.ST.currentPage()));
    add('import', 'Photo', async () => {
      const f = await A.ST.pickFile('image/*');
      if (!f) return;
      const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
      AI.attach({ kind: 'image', label: f.name.slice(0, 24), url: await shrink(url, 1600) });
    });
  };
  const msgEl = (m) => {
    if (m.role === 'user') {
      const atts = (m.att || []).map((a) => (a.url ? h('img', { class: 'msg-img', src: a.url, alt: a.label, title: a.label }) : h('span', { class: 'att-chip small' }, A.iconEl('pdf'), a.label)));
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
    box.append(h('button', { onclick: () => { A.closePopovers(); const c = { id: A.uid(), title: 'New conversation', created: Date.now(), msgs: [] }; chats().push(c); D.doc.chatActive = c.id; D.changed('meta'); draw(); } }, A.iconEl('plus'), 'New conversation'));
    if (chats().length) box.append(h('hr'));
    chats().slice().reverse().forEach((c) => box.append(h('button', { class: c.id === D.doc.chatActive ? 'on' : '', onclick: () => { A.closePopovers(); D.doc.chatActive = c.id; draw(); } }, h('span', { class: 'grow' }, c.title), h('span', { class: 'muted small num' }, A.fmtDate(c.created)))));
    if (chat().msgs.length) box.append(h('hr'), h('button', { class: 'danger', onclick: async () => {
      A.closePopovers();
      if (!(await A.dialog({ title: 'Delete this conversation?', okText: 'Delete', danger: true }))) return;
      D.doc.chats = chats().filter((c) => c.id !== D.doc.chatActive); D.doc.chatActive = null; D.changed('meta'); draw();
    } }, A.iconEl('trash'), 'Delete conversation'));
    A.popover(box, anchor, { side: 'down' });
  };
  const setupCard = () => {
    const inp = h('input', { class: 'field', id: 'ai-key', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false' });
    const save = h('button', { class: 'btn primary', onclick: () => { const v = inp.value.trim(); if (!/^sk-ant-/.test(v)) return A.toast('That doesn\'t look like an Anthropic API key (it starts with sk-ant-)'); S.aiKey = v; A.saveSettings(); A.toast('Tutor connected'); draw(); } }, 'Connect');
    return h('div', { class: 'tutor-setup' },
      h('div', { class: 'te-mark', html: A.icon('spark') }),
      h('h4', null, 'Connect the tutor'),
      h('p', null, 'The tutor runs on Claude using your own Anthropic API key. You pay Anthropic directly for what you use. The key is stored only on this device.'),
      h('ol', null, h('li', null, 'Go to console.anthropic.com, open API Keys and create a key.'), h('li', null, 'Paste it below.')),
      inp, h('div', { class: 'row end' }, save),
      h('p', { class: 'small muted' }, 'You can remove the key any time in Settings › Tutor.'));
  };

  /* ---------- request ---------- */
  const systemPrompt = () => {
    const majors = A.SU.majorNames();
    const courses = A.SU.list().map((s) => s.name);
    const cur = A.SU.name(D.doc.subject);
    return [
      'You are the tutor built into Axiom, an infinite-canvas notebook for university STEM students. The student writes and draws by hand with Apple Pencil.',
      majors.length ? `The student studies: ${majors.join(', ')}.` : '',
      courses.length ? `Their courses: ${courses.join(', ')}.` : '',
      cur ? `They are working in the course "${cur}" right now.` : '',
      'Attached images are snapshots of their handwritten canvas, a selection of it, photos, or pages from their problem sheets, solution sets and textbooks. If handwriting is ambiguous, say what you read before relying on it.',
      'Use precise mathematical language. Do not replace arguments with analogies or metaphors unless the student asks for intuition. Be direct about mistakes and concise; no filler or praise.',
      'Format with Markdown. Write all mathematics in LaTeX: $...$ inline and $$...$$ for display equations.',
      MODE_TEXT[mode],
    ].filter(Boolean).join('\n');
  };
  const toBlocks = (m, keepImages) => {
    const blocks = [];
    for (const a of m.att || []) {
      if (a.kind === 'image' && a.url) {
        if (keepImages.has(a.id)) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a.url.split(',')[1] } });
        else blocks.push({ type: 'text', text: `[Earlier image omitted: ${a.label}]` });
      } else if (a.kind === 'pdf') {
        const b64 = a.b64 || sessionPdf.get(a.id);
        if (b64) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: a.label });
        else blocks.push({ type: 'text', text: `[The PDF "${a.label}" was attached earlier; re-attach it if you need its contents.]` });
      }
    }
    blocks.push({ type: 'text', text: (m.att && m.att.length ? `(Attached: ${m.att.map((a) => a.label).join('; ')})\n\n` : '') + (m.text || '(no message)') });
    return blocks;
  };
  const buildMessages = (c) => {
    // keep only the 6 most recent images; older ones become notes
    const ids = [];
    c.msgs.forEach((m) => (m.att || []).forEach((a) => { if (a.kind === 'image' && a.url) ids.push(a.id); }));
    const keep = new Set(ids.slice(-6));
    const out = [];
    for (const m of c.msgs.filter((x) => !x.error)) {
      const msg = m.role === 'user' ? { role: 'user', content: toBlocks(m, keep) } : { role: 'assistant', content: [{ type: 'text', text: m.text || '…' }] };
      const prev = out[out.length - 1];
      if (prev && prev.role === msg.role) prev.content = prev.content.concat(msg.content); // e.g. after a failed reply
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
    if (mode === 'check' && !att.some((a) => a.kind === 'image')) att.unshift(AI.shotCanvas()); // checking needs to see the work
    att.forEach((a) => { a.id = a.id || A.uid(); if (a.kind === 'pdf' && a.b64) sessionPdf.set(a.id, a.b64); });
    AI.pending = [];
    const um = { role: 'user', text, att: att.map((a) => ({ id: a.id, kind: a.kind, label: a.label, url: a.url })), t: Date.now() };
    c.msgs.push(um);
    if (c.title === 'New conversation') c.title = (text || att[0].label).slice(0, 48);
    const bm = { role: 'assistant', text: '', t: Date.now() };
    c.msgs.push(bm);
    busy = true;
    draw();
    const botEl = els.list.lastElementChild;
    const body = botEl.querySelector('.md');
    body.innerHTML = '<span class="thinking">Thinking<i>.</i><i>.</i><i>.</i></span>';
    let raf = 0;
    const paint = () => { raf = 0; body.innerHTML = AI.md(bm.text, window.katex); if (els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight < 160) els.list.scrollTop = els.list.scrollHeight; };
    try {
      const Anthropic = await sdk();
      const client = new Anthropic({ apiKey: S.aiKey, dangerouslyAllowBrowser: true });
      const modelId = S.aiModel || 'claude-opus-5-5';
      const effort = (AI.modes.find((m) => m.id === mode) || {}).effort || 'medium';
      const params = {
        model: modelId,
        max_tokens: 64000,
        system: systemPrompt(),
        messages: buildMessages({ msgs: c.msgs.slice(0, -1) }), // without the empty reply placeholder
        output_config: { effort },
        cache_control: { type: 'ephemeral' },
      };
      if (modelId !== 'claude-haiku-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
      abortCtl = new AbortController();
      const stream = client.beta.messages.stream(params, { signal: abortCtl.signal });
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          bm.text += ev.delta.text;
          if (!raf) raf = requestAnimationFrame(paint);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') bm.text += (bm.text ? '\n\n' : '') + '_The tutor declined to answer this request._';
      if (final.stop_reason === 'max_tokens') bm.text += '\n\n_(The answer was cut off. Ask the tutor to continue.)_';
      if (!bm.text.trim()) bm.text = '_No answer was returned. Try again._';
    } catch (err) {
      const Anthropic = await sdk().catch(() => null);
      let msg = 'Something went wrong: ' + (err && err.message ? err.message : err);
      if (err && err.name === 'AbortError' || (Anthropic && err instanceof Anthropic.APIUserAbortError)) msg = bm.text ? '' : '_Stopped._';
      else if (Anthropic && err instanceof Anthropic.AuthenticationError) msg = 'Your API key was rejected. Check it in Settings › Tutor.';
      else if (Anthropic && err instanceof Anthropic.PermissionDeniedError) msg = 'This API key does not have access to that model. Pick another model or check your Anthropic account.';
      else if (Anthropic && err instanceof Anthropic.RateLimitError) msg = 'You have hit your API rate limit. Wait a moment and try again.';
      else if (Anthropic && err instanceof Anthropic.BadRequestError) msg = 'The request was rejected: ' + (err.message || '') + (/too large|size/i.test(err.message || '') ? ' Try attaching fewer or smaller pages.' : '');
      else if (Anthropic && err instanceof Anthropic.InternalServerError) msg = 'Anthropic\'s servers had a problem (or are overloaded). Try again in a moment.';
      else if (Anthropic && err instanceof Anthropic.APIConnectionError || !navigator.onLine) msg = 'The tutor needs an internet connection.';
      if (msg) { if (bm.text) bm.text += '\n\n' + msg; else { bm.text = msg; bm.error = true; } }
    }
    busy = false; abortCtl = null;
    // keep history light: store smaller copies of images
    for (const a of um.att) if (a.url) a.url = await shrink(a.url, 900);
    D.changed('meta');
    draw();
  }
  function stop() { if (abortCtl) abortCtl.abort(); }

  A.on('doc:open', () => { AI.pending = []; sessionPdf.clear(); mode = 'explain'; });
  A.on('selection', () => { if (root && root.isConnected && els.chips) drawChips(); });
})();
