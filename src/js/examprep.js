/* Axiom exam prep: give it the syllabus, past exams, problem sets, book chapters and your notes; it maps the topics,
   transcribes every past question, plans each day until the test, writes a layered study guide per topic and makes practice. */
'use strict';
(() => {
  const h = A.h, S = A.settings;
  const EX = (A.EX = {});
  const DAY = 864e5;
  const KINDS = { exam: 'Exam', quiz: 'Quiz', lab: 'Lab', other: 'Other' };
  const ROLES = { syllabus: 'Syllabus', past: 'Past exam', problems: 'Problem set', notes: 'Notes or slides' };

  /* ---------- storage: metadata in settings, the big prep data and the files in the file store ---------- */
  const list = () => (S.exams = S.exams || []);
  EX.list = list;
  EX.get = (id) => list().find((e) => e.id === id);
  const saveMeta = () => { A.saveSettings(); A.emit('exams'); };
  const cache = new Map();
  const loadPrep = async (id) => {
    if (cache.has(id)) return cache.get(id);
    let p = null;
    try { const b = await A.store.loadFile('exprep_' + id, 'application/json'); if (b) p = JSON.parse(await b.text()); } catch (e) { /* none yet */ }
    p = p || { topics: [], questions: [], gaps: [], plan: [], guides: {}, answers: {}, practice: [], done: {} };
    p.guides = p.guides || {}; p.answers = p.answers || {}; p.practice = p.practice || []; p.done = p.done || {};
    cache.set(id, p);
    return p;
  };
  let saveT = 0;
  const savePrep = (id) => { clearTimeout(saveT); saveT = setTimeout(() => { const p = cache.get(id); if (p) A.store.saveFile('exprep_' + id, new Blob([JSON.stringify(p)], { type: 'application/json' })).catch(() => {}); }, 300); };

  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const isoDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const daysLeft = (t) => Math.round((dayStart(t) - dayStart(Date.now())) / DAY);
  const leftLabel = (t) => { const d = daysLeft(t); return d < 0 ? 'Done' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`; };
  const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const sessions = (p) => p.plan.flatMap((d) => d.sessions.map((s, i) => ({ ...s, key: d.day + ':' + i, day: d.day })));
  const progressOf = (p) => { const all = sessions(p); return all.length ? all.filter((s) => p.done[s.key]).length / all.length : 0; };

  /* ---------- Home and course pages: what you are preparing for ---------- */
  EX.homeSection = (course = null) => {
    const items = list().filter((e) => (!course || e.course === course) && daysLeft(e.date) >= -1).sort((a, b) => a.date - b.date);
    if (!items.length) return null;
    const sec = h('section', { class: 'g-sec ex-home' });
    sec.append(h('div', { class: 'g-sec-h' }, h('h2', null, 'Preparing for'), h('button', { class: 'ibtn', 'aria-label': 'New exam prep', html: A.icon('plus'), onclick: () => EX.create({ course }) })));
    const row = h('div', { class: 'ex-cards' });
    items.forEach((e) => {
      const card = h('button', { class: 'ex-card', onclick: () => EX.open(e.id) },
        h('div', { class: 'ex-card-top' }, h('i', { class: 'dot', style: { background: A.SU.color(e.course) } }), h('span', { class: 'ex-kind' }, KINDS[e.kind] || 'Exam'), h('span', { class: 'grow' }), h('span', { class: 'ex-left num' }, leftLabel(e.date))),
        h('b', { class: 'ex-title' }, e.title),
        h('small', { class: 'ex-sub' }, [A.SU.name(e.course), fmtDay(e.date)].filter(Boolean).join(' · ')),
        h('div', { class: 'ex-bar' }, h('i', { style: { width: '0%' } })),
        h('small', { class: 'ex-today' }, e.built ? '' : 'Add materials to build your plan'));
      row.append(card);
      if (e.built) loadPrep(e.id).then((p) => {
        card.querySelector('.ex-bar i').style.width = Math.round(progressOf(p) * 100) + '%';
        const today = sessions(p).filter((s) => s.day === isoDate(Date.now()) && !p.done[s.key]);
        card.querySelector('.ex-today').textContent = today.length ? 'Today: ' + today[0].task.replace(/[*_`#]/g, '').replace(/\$([^$]*)\$/g, '$1') : daysLeft(e.date) > 0 ? 'Nothing left for today' : '';
      });
    });
    sec.append(row);
    return sec;
  };

  /* ---------- create / edit: what the test is and what to learn from ---------- */
  EX.create = (defaults = {}) => editSheet(null, defaults);
  function editSheet(exam, defaults = {}) {
    const isNew = !exam;
    const st = exam ? JSON.parse(JSON.stringify(exam)) : { id: A.uid(), title: '', kind: 'exam', course: defaults.course || null, date: dayStart(Date.now() + 7 * DAY) + 9.5 * 36e5, files: [], books: [], notebooks: [], notes: '', created: Date.now() };
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal ex-edit', role: 'dialog', 'aria-label': 'Exam prep' });
    back.append(box); document.body.append(back);
    const close = () => back.remove();
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    const lab = (t, el) => h('label', { class: 'fx-f' }, h('span', null, t), el);
    const draw = async () => {
      box.innerHTML = '';
      const title = h('input', { class: 'field', value: st.title, placeholder: { exam: 'e.g. Midterm 1', quiz: 'e.g. Quiz 4', lab: 'e.g. Lab 3: Kirchhoff’s laws', other: 'e.g. Oral presentation' }[st.kind] });
      title.addEventListener('input', () => { st.title = title.value; });
      const seg = h('div', { class: 'seg full' }, ...Object.entries(KINDS).map(([k, v]) => h('button', { class: st.kind === k ? 'on' : '', onclick: () => { st.title = title.value; st.kind = k; draw(); } }, v)));
      const course = h('select', { class: 'field' }, h('option', { value: '' }, 'No course'), ...A.SU.list().map((s) => h('option', { value: s.id, selected: st.course === s.id }, s.name)), h('option', { value: '__new' }, 'New course…'));
      course.addEventListener('change', async () => { if (course.value === '__new') { const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); const s = n && A.SU.add(n); if (s) st.course = s.id; st.title = title.value; draw(); } else st.course = course.value || null; });
      const d = new Date(st.date);
      const date = h('input', { class: 'field', type: 'date', value: isoDate(st.date) });
      const time = h('input', { class: 'field', type: 'time', value: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` });
      const readDate = () => { if (date.value) { const [y, m, dd] = date.value.split('-').map(Number); const [hh, mm] = (time.value || '09:00').split(':').map(Number); st.date = new Date(y, m - 1, dd, hh, mm).getTime(); } };
      date.addEventListener('change', readDate); time.addEventListener('change', readDate);
      // materials
      const mats = h('div', { class: 'ex-mats' });
      st.files.forEach((f, i) => mats.append(h('div', { class: 'ex-mat' }, A.iconEl(/pdf/.test(f.type) ? 'pdf' : 'image'), h('span', { class: 'grow' }, h('b', null, f.name), h('small', null, ROLES[f.role])), h('button', { class: 'ibtn', 'aria-label': 'Remove ' + f.name, html: A.icon('close'), onclick: () => { st.files.splice(i, 1); st.title = title.value; draw(); } }))));
      st.books.forEach((b, i) => { const m = A.ST.doc(b.docId); mats.append(h('div', { class: 'ex-mat' }, A.iconEl('book'), h('span', { class: 'grow' }, h('b', null, m ? m.title || m.name : 'Book'), h('small', null, `Pages ${b.from}–${b.to}`)), h('button', { class: 'ibtn', 'aria-label': 'Remove book', html: A.icon('close'), onclick: () => { st.books.splice(i, 1); st.title = title.value; draw(); } }))); });
      if (st.notebooks.length) {
        const metas = (await A.store.listMeta()).filter(Boolean);
        st.notebooks.forEach((id, i) => { const m = metas.find((x) => x.id === id); mats.append(h('div', { class: 'ex-mat' }, A.iconEl(m && m.kind === 'notebook' ? 'notebook' : 'canvas'), h('span', { class: 'grow' }, h('b', null, m ? m.name : 'Notebook'), h('small', null, 'Your handwritten notes')), h('button', { class: 'ibtn', 'aria-label': 'Remove notes', html: A.icon('close'), onclick: () => { st.notebooks.splice(i, 1); st.title = title.value; draw(); } }))); });
      }
      if (!mats.children.length) mats.append(h('p', { class: 'ex-mats-empty' }, 'Add the syllabus or topic list, past exams, problem sets, the book chapters and your notes. The more you add, the sharper the plan.'));
      const addBtn = h('button', { class: 'btn ex-add' }, A.iconEl('plus'), 'Add material');
      addBtn.addEventListener('click', () => { st.title = title.value; materialMenu(addBtn, st, draw); });
      const notes = h('textarea', { class: 'field', rows: 3, placeholder: st.kind === 'lab' ? 'Which experiment, what the lab sheet asks, what the TA said…' : 'What the instructor said is covered, the format (e.g. 4 proofs, 2 hours, closed book)…' });
      notes.value = st.notes || '';
      notes.addEventListener('input', () => { st.notes = notes.value; });
      const save = (andBuild) => {
        st.title = title.value.trim(); readDate();
        if (!st.title) { title.classList.add('err'); title.focus(); return; }
        const i = list().findIndex((e) => e.id === st.id);
        if (i >= 0) list()[i] = Object.assign(list()[i], st); else list().push(st);
        saveMeta(); close();
        EX.open(st.id, andBuild);
      };
      box.append(
        h('h3', null, isNew ? 'Prepare for a test' : 'Edit'),
        seg, lab('What is it', title), h('div', { class: 'fx-f3 ex-f2' }, lab('Course', course), lab('Date', date), lab('Time', time)),
        h('div', { class: 'fx-f' }, h('span', null, 'Materials'), mats, addBtn),
        lab('Anything else', notes),
        h('div', { class: 'row gap end fx-acts' }, h('button', { class: 'btn', onclick: close }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => save(true) }, isNew ? 'Build my prep' : 'Save and rebuild'),
          isNew ? null : h('button', { class: 'btn', onclick: () => save(false) }, 'Save')));
      if (isNew && !st.title) setTimeout(() => title.focus(), 60);
    };
    draw();
  }
  function materialMenu(anchor, st, redraw) {
    const box = h('div', { class: 'menu' });
    const file = (role, icon, sub) => box.append(h('button', { onclick: async () => {
      A.closePopovers();
      const f = await A.ST.pickFile('application/pdf,.pdf,image/*');
      if (!f) return;
      if (f.size > 25e6) return A.toast('That file is over 25 MB. Split it or add the relevant pages.');
      const id = A.uid();
      await A.store.saveFile('exf_' + id, f);
      st.files.push({ id, name: f.name.replace(/\.[a-z]+$/i, '').slice(0, 60), type: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg'), role, size: f.size });
      redraw();
    } }, A.iconEl(icon), h('span', { class: 'grow' }, ROLES[role], h('small', null, sub))));
    file('syllabus', 'doc', 'Or the topic list');
    file('past', 'flag', 'PDF or photos, one at a time');
    file('problems', 'quiz', 'Homework, recitation sheets');
    file('notes', 'image', 'Lecture slides or photos of notes');
    box.append(h('hr'));
    box.append(h('button', { onclick: () => { A.closePopovers(); pickBook(anchor, st, redraw); } }, A.iconEl('book'), h('span', { class: 'grow' }, 'Chapters from a book', h('small', null, 'From your library'))));
    box.append(h('button', { onclick: () => { A.closePopovers(); pickNotebook(anchor, st, redraw); } }, A.iconEl('notebook'), h('span', { class: 'grow' }, 'One of your notebooks', h('small', null, 'Handwritten notes'))));
    A.popover(box, anchor, { side: 'up' });
  }
  async function pickBook(anchor, st, redraw) {
    const docs = A.ST.docs().filter((d) => d.type === 'pdf');
    if (!docs.length) return A.toast('Add the textbook in Books first.');
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    let sel = docs.find((d) => d.subject === st.course) || docs[0];
    const book = h('select', { class: 'field' }, ...docs.map((d) => h('option', { value: d.id, selected: d === sel }, d.title || d.name)));
    const from = h('input', { class: 'field', type: 'number', min: 1, value: 1, inputmode: 'numeric' });
    const to = h('input', { class: 'field', type: 'number', min: 1, value: Math.min(sel.pages || 30, 40), inputmode: 'numeric' });
    book.addEventListener('change', () => { sel = docs.find((d) => d.id === book.value); to.value = Math.min(sel.pages || 30, 40); });
    back.append(h('div', { class: 'modal small ex-edit' }, h('h3', null, 'Chapters from a book'),
      h('label', { class: 'fx-f' }, h('span', null, 'Book'), book),
      h('div', { class: 'fx-f3 ex-f2' }, h('label', { class: 'fx-f' }, h('span', null, 'From PDF page'), from), h('label', { class: 'fx-f' }, h('span', null, 'To page'), to)),
      h('p', { class: 'muted small' }, 'Up to 80 pages. Use the page numbers the reader shows at the bottom.'),
      h('div', { class: 'row gap end fx-acts' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        const a = Math.max(1, parseInt(from.value, 10) || 1), b = Math.max(a, Math.min(a + 79, parseInt(to.value, 10) || a));
        st.books.push({ docId: sel.id, from: a, to: b }); close(); redraw();
      } }, 'Add'))));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  }
  async function pickNotebook(anchor, st, redraw) {
    const metas = (await A.store.listMeta()).filter((m) => m && !st.notebooks.includes(m.id)).sort((a, b) => (b.subject === st.course) - (a.subject === st.course) || b.updated - a.updated);
    if (!metas.length) return A.toast('No notebooks yet.');
    const box = h('div', { class: 'menu' });
    metas.slice(0, 20).forEach((m) => box.append(h('button', { onclick: () => { A.closePopovers(); st.notebooks.push(m.id); redraw(); } }, A.iconEl(m.kind === 'notebook' ? 'notebook' : 'canvas'), h('span', { class: 'grow' }, m.name, h('small', null, A.SU.name(m.subject) || '')))));
    A.popover(box, anchor, { side: 'up' });
  }

  /* ---------- Claude ---------- */
  const needKey = async () => {
    if (S.aiKey) return true;
    const go = await A.dialog({ title: 'Exam prep uses the tutor', body: 'Axiom sends your materials to Claude to build the plan. Add your Anthropic API key in Settings › Tutor first.', okText: 'Open Settings' });
    if (go && A.UI.openSettings) A.UI.openSettings();
    return false;
  };
  const client = async () => { const Anthropic = await A.AI.sdk(); return new Anthropic({ apiKey: S.aiKey, dangerouslyAllowBrowser: true }); };
  const model = () => S.aiModel || 'claude-opus-5-5';
  const b64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
  const STYLE = 'The student is a university STEM student (mathematics and physics). Use precise mathematical language; give structural reasons (definitions, hypotheses of theorems, why a step is valid), not recipes; no analogies unless asked. Write all mathematics in LaTeX ($...$ inline, $$...$$ display). Markdown formatting.';
  async function bookText(b, budget) {
    const meta = A.ST.doc(b.docId);
    if (!meta) return '';
    try {
      const pdf = await A.ST.loadPdf(meta);
      let out = '';
      for (let n = b.from; n <= Math.min(b.to, pdf.numPages) && out.length < budget; n++) {
        const tc = await (await pdf.getPage(n)).getTextContent();
        out += `\n[p. ${n}]\n` + tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ');
      }
      return `Book "${meta.title || meta.name}", PDF pages ${b.from}–${b.to}:${out.slice(0, budget)}`;
    } catch (e) { return ''; }
  }
  const shotNotebook = async (id, max = 8) => {
    const doc = await A.store.loadDoc(id).catch(() => null);
    if (!doc || !doc.layers) return [];
    const out = [];
    const shoot = (bb) => { const w = bb[2] - bb[0], hh = bb[3] - bb[1]; const k = Math.min(2, 900 / Math.max(w, hh)); out.push(A.R.renderRegion(doc, bb, k, { bg: true, grid: false }).toDataURL('image/jpeg', 0.8).split(',')[1]); };
    if (doc.kind === 'notebook') A.D.pageRects(doc).forEach((rc) => { if (out.length < max && doc.layers.some((l) => l.items.some((it) => A.G.bbHit(it.bb, rc)))) shoot(rc); });
    else { let bb = null; doc.layers.forEach((l) => l.items.forEach((it) => { bb = bb ? [Math.min(bb[0], it.bb[0]), Math.min(bb[1], it.bb[1]), Math.max(bb[2], it.bb[2]), Math.max(bb[3], it.bb[3])] : it.bb.slice(); })); if (bb) shoot(bb); }
    return out.map((data) => ({ name: doc.name, data }));
  };
  async function materialBlocks(e) {
    const blocks = [], index = [];
    for (const [i, f] of e.files.entries()) {
      const blob = await A.store.loadFile('exf_' + f.id, f.type).catch(() => null);
      if (!blob) continue;
      const data = await b64(blob);
      index.push(`File ${i + 1}: "${f.name}" (${ROLES[f.role]})`);
      blocks.push({ type: 'text', text: `File ${i + 1}: "${f.name}" — ${ROLES[f.role]}` });
      blocks.push(/pdf/.test(f.type) ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.name } : { type: 'image', source: { type: 'base64', media_type: f.type || 'image/jpeg', data } });
    }
    for (const b of e.books) { const t = await bookText(b, 90000); if (t) { blocks.push({ type: 'text', text: t }); index.push(t.split(':')[0]); } }
    for (const id of e.notebooks) {
      const shots = await shotNotebook(id);
      shots.forEach((s, k) => { if (!k) blocks.push({ type: 'text', text: `The student's handwritten notes "${s.name}":` }); blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: s.data } }); });
      if (shots.length) index.push(`Notes "${shots[0].name}" (${shots.length} pages)`);
    }
    return { blocks, index };
  }
  const SCHEMA = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two or three sentences: what this test is about and how to win it' },
      format: { type: 'string', description: 'The expected format (length, number and type of questions) if it can be inferred, else empty' },
      topics: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string', description: 'short id like t1' }, title: { type: 'string' }, weight: { type: 'string', enum: ['high', 'medium', 'low'] },
        why: { type: 'string', description: 'What exactly gets asked about it (from past exams / syllabus)' }, sources: { type: 'string', description: 'Where to learn it: book pages, files, notes' },
        subtopics: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title', 'weight', 'why', 'sources', 'subtopics'], additionalProperties: false } },
      questions: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string', description: 'q1, q2…' }, source: { type: 'string', description: 'e.g. "Midterm 2023, Q3" or "Problem set 2, #4"' },
        file: { type: 'integer', description: 'File number it comes from (1-based), 0 if none' }, page: { type: 'integer', description: 'Page within that file (1-based), 0 if unknown' },
        text: { type: 'string', description: 'The full question, transcribed faithfully in Markdown with LaTeX' }, topics: { type: 'array', items: { type: 'string' } },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] } }, required: ['id', 'source', 'file', 'page', 'text', 'topics', 'difficulty'], additionalProperties: false } },
      gaps: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, note: { type: 'string' } }, required: ['topic', 'note'], additionalProperties: false }, description: 'Topics in the syllabus or chapters that past exams never asked about' },
      plan: { type: 'array', items: { type: 'object', properties: {
        day: { type: 'string', description: 'YYYY-MM-DD' },
        sessions: { type: 'array', items: { type: 'object', properties: {
          minutes: { type: 'integer' }, kind: { type: 'string', enum: ['learn', 'practice', 'review', 'mock'] },
          topics: { type: 'array', items: { type: 'string' } }, task: { type: 'string', description: 'One concrete instruction, e.g. "Work past questions q3, q7 without notes"' } },
          required: ['minutes', 'kind', 'topics', 'task'], additionalProperties: false } } }, required: ['day', 'sessions'], additionalProperties: false } },
    },
    required: ['summary', 'format', 'topics', 'questions', 'gaps', 'plan'],
    additionalProperties: false,
  };
  async function build(e, onStatus) {
    const p = await loadPrep(e.id);
    onStatus('Gathering your materials…');
    const { blocks, index } = await materialBlocks(e);
    if (!blocks.length && !e.notes) throw new Error('Add at least one material (a syllabus, past exam, chapters or notes) first.');
    const today = new Date(), left = Math.max(0, daysLeft(e.date));
    const doneNote = Object.keys(p.done).length ? `\nThe student has already completed these sessions: ${sessions(p).filter((s) => p.done[s.key]).map((s) => s.task).join('; ').slice(0, 2000)}` : '';
    onStatus(`Reading ${index.length || 'your'} material${index.length === 1 ? '' : 's'} and planning ${left} day${left === 1 ? '' : 's'}… this takes a minute or two.`);
    const c = await client();
    const stream = c.messages.stream({
      model: model(), max_tokens: 48000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: `You prepare a university student for a ${KINDS[e.kind].toLowerCase()}: "${e.title}"${A.SU.name(e.course) ? ` in ${A.SU.name(e.course)}` : ''}, on ${new Date(e.date).toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' })}. Today is ${today.toLocaleDateString('en', { dateStyle: 'full' })}, so there ${left === 1 ? 'is 1 day' : `are ${left} days`} left.
${STYLE}
Work from the materials only (and standard knowledge of the subject to fill gaps):
1. Topics: exactly what will be tested, specific (named theorems, techniques, derivations, lab procedures), weighted by how often past exams and problem sets use them. Use ids t1, t2, …
2. Questions: transcribe EVERY question from the past exams and problem sets faithfully (all parts), with its file number and page, tagged with topic ids.
3. Gaps: syllabus or chapter topics that past exams never asked; they still need preparation.
4. Plan: one entry per day from today until the day before the test (today included${left === 0 ? '; the test is today, so make a short plan for the remaining hours' : ''}). 1–4 sessions per day of 25–50 minutes. Start with high-weight topics, alternate learning with practice on real past questions (name them by id), use spaced review, and end with a timed mock exam built from past questions the day before. ${e.kind === 'lab' ? 'For a lab: theory, the procedure step by step, the pre-lab questions, error analysis and the report format.' : ''}${doneNote}`,
      messages: [{ role: 'user', content: blocks.concat([{ type: 'text', text: (e.notes ? `Notes from the student: ${e.notes}\n\n` : '') + 'Build the preparation.' }]) }],
    });
    let chars = 0;
    stream.on('text', (t) => { chars += t.length; if (chars % 400 < t.length) onStatus(`Writing your plan… ${Math.round(chars / 1000)}k characters`); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('The tutor declined this request.');
    const txt = (msg.content.find((x) => x.type === 'text') || {}).text || '';
    let data;
    try { data = JSON.parse(txt); } catch (err) { throw new Error(msg.stop_reason === 'max_tokens' ? 'The materials were too long to finish in one go. Remove a file and try again.' : 'The answer could not be read. Try again.'); }
    // a new plan starts today: ticks belonged to the old sessions (they were sent to Claude above as already done)
    Object.assign(p, { summary: data.summary, format: data.format, topics: data.topics, questions: data.questions, gaps: data.gaps, plan: data.plan, builtAt: Date.now(), done: {} });
    e.built = true; saveMeta(); savePrep(e.id);
    return p;
  }

  /* ---------- the prep view ---------- */
  let view = null;
  EX.open = async (id, buildNow = false) => {
    const e = EX.get(id);
    if (!e) return;
    const p = await loadPrep(id);
    if (view) view.remove();
    view = h('div', { class: 'ex-view', role: 'dialog', 'aria-label': e.title });
    const st = { tab: e.built ? 'plan' : 'plan', stack: [] };
    const titleEl = h('div', { class: 'ex-v-title' });
    const leftEl = h('span', { class: 'ex-v-left num' });
    const body = h('div', { class: 'ex-v-body' });
    const tabs = h('div', { class: 'seg ex-tabs' });
    const close = () => { view.remove(); view = null; A.emit('exams'); };
    const backBtn = h('button', { class: 'ibtn flip', 'aria-label': 'Back', html: A.icon('chev'), onclick: () => { if (st.stack.length) { st.stack.pop(); draw(); } else close(); } });
    const more = h('button', { class: 'ibtn', 'aria-label': 'More', html: A.icon('more') });
    more.addEventListener('click', () => {
      const box = h('div', { class: 'menu' });
      const it = (icon, label, fn, cls) => box.append(h('button', { class: cls || '', onclick: () => { A.closePopovers(); fn(); } }, A.iconEl(icon), label));
      it('rename', 'Edit details and materials', () => { close(); editSheet(e); });
      if (e.built) it('restore', 'Re-plan from today', () => runBuild());
      it('trash', 'Delete this prep', async () => {
        if (!(await A.dialog({ title: `Delete “${e.title}”?`, body: 'The plan, guides, practice and the files you added to it are deleted. Your books and notebooks stay.', okText: 'Delete', danger: true }))) return;
        e.files.forEach((f) => A.store.deleteFile('exf_' + f.id).catch(() => {}));
        A.store.deleteFile('exprep_' + e.id).catch(() => {});
        cache.delete(e.id);
        S.exams = list().filter((x) => x.id !== e.id); saveMeta(); close();
      }, 'danger');
      A.popover(box, more, { side: 'down' });
    });
    view.append(h('div', { class: 'ex-v-bar' }, backBtn, titleEl, h('div', { class: 'grow' }), leftEl, more), tabs, body);
    document.body.append(view);
    await A.AI.katex();
    const md = (s) => { const d = h('div', { class: 'md' }); d.innerHTML = A.AI.md(s || '', window.katex); return d; };
    const topicName = (tid) => (p.topics.find((t) => t.id === tid) || {}).title || tid;
    const chips = (ids) => h('div', { class: 'ex-chips' }, ...(ids || []).map((tid) => h('button', { class: 'ex-chip', onclick: (ev) => { ev.stopPropagation(); st.stack.push({ topic: tid }); draw(); } }, topicName(tid))));

    async function runBuild() {
      if (!(await needKey())) return;
      st.building = 'Starting…'; st.error = null; st.stack = []; st.tab = 'plan'; draw();
      try { await build(e, (s) => { st.building = s; const el = body.querySelector('.ex-building p'); if (el) el.textContent = s; }); st.building = null; }
      catch (err) { st.building = null; st.error = String(err && err.message || err); }
      draw();
    }

    function draw() {
      titleEl.innerHTML = '';
      titleEl.append(h('b', null, e.title), h('small', null, [A.SU.name(e.course), KINDS[e.kind], fmtDay(e.date) + ' ' + new Date(e.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')));
      leftEl.textContent = leftLabel(e.date);
      tabs.innerHTML = '';
      const top = st.stack[st.stack.length - 1];
      tabs.hidden = !!top || !e.built;
      [['plan', 'Plan'], ['topics', 'Topics'], ['questions', 'Past questions'], ['practice', 'Practice']].forEach(([k, l]) => tabs.append(h('button', { class: st.tab === k ? 'on' : '', onclick: () => { st.tab = k; draw(); } }, l)));
      body.innerHTML = '';
      body.scrollTop = 0;
      if (st.building) { body.append(h('div', { class: 'ex-building' }, h('div', { class: 'ex-spin' }), h('p', null, st.building))); return; }
      if (top && top.topic) return drawGuide(top.topic);
      if (!e.built) return drawStart();
      ({ plan: drawPlan, topics: drawTopics, questions: drawQuestions, practice: drawPractice })[st.tab]();
    }
    function drawStart() {
      const mats = e.files.length + e.books.length + e.notebooks.length;
      body.append(h('div', { class: 'ex-start' },
        h('div', { class: 'fx-art', html: A.icon('flag') }),
        h('h3', null, mats ? 'Ready to build your prep' : 'Add your materials'),
        h('p', null, mats ? `${mats} material${mats === 1 ? '' : 's'} added. Axiom maps the topics, transcribes every past question, and plans each day until ${fmtDay(e.date)}.` : 'Past exams, problem sets, the syllabus, book chapters and your notes make the plan specific to this test.'),
        st.error ? h('p', { class: 'ex-err' }, st.error) : null,
        h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => { close(); editSheet(e); } }, mats ? 'Edit materials' : 'Add materials'), mats || e.notes ? h('button', { class: 'btn primary', onclick: runBuild }, 'Build my prep') : null)));
    }
    function drawPlan() {
      if (st.error) body.append(h('p', { class: 'ex-err' }, st.error));
      body.append(h('div', { class: 'ex-summary' }, md(p.summary || ''), p.format ? h('p', { class: 'ex-format' }, h('b', null, 'Format '), p.format) : null,
        h('div', { class: 'ex-prog' }, h('div', { class: 'ex-bar' }, h('i', { style: { width: Math.round(progressOf(p) * 100) + '%' } })), h('small', { class: 'num' }, `${Math.round(progressOf(p) * 100)}% of the plan done`))));
      const today = isoDate(Date.now());
      const missed = sessions(p).filter((s) => s.day < today && !p.done[s.key]);
      if (missed.length) body.append(h('div', { class: 'ex-missed' }, h('span', { class: 'grow' }, `${missed.length} session${missed.length === 1 ? '' : 's'} from earlier days not done.`), h('button', { class: 'btn', onclick: runBuild }, 'Re-plan from today')));
      p.plan.forEach((d) => {
        const isToday = d.day === today, past = d.day < today;
        const [y, m, dd] = d.day.split('-').map(Number);
        const day = h('div', { class: 'ex-day' + (isToday ? ' today' : '') + (past ? ' past' : '') }, h('div', { class: 'ex-day-h' }, isToday ? 'Today' : new Date(y, m - 1, dd).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })));
        d.sessions.forEach((s, i) => {
          const key = d.day + ':' + i, done = !!p.done[key];
          const ck = h('button', { class: 'fx-check' + (done ? ' on' : ''), 'aria-label': done ? 'Mark not done' : 'Mark done', html: A.icon('check') });
          ck.addEventListener('click', () => { if (p.done[key]) delete p.done[key]; else p.done[key] = Date.now(); savePrep(e.id); draw(); });
          day.append(h('div', { class: 'ex-sess' + (done ? ' done' : '') }, ck, h('div', { class: 'grow' }, h('div', { class: 'ex-sess-t' }, h('span', { class: 'ex-k k-' + s.kind }, s.kind), h('span', { class: 'num ex-min' }, s.minutes + ' min')), md(s.task), chips(s.topics))));
        });
        body.append(day);
      });
    }
    function drawTopics() {
      const count = (tid) => p.questions.filter((q) => (q.topics || []).includes(tid)).length;
      const listEl = h('div', { class: 'ex-list' });
      p.topics.forEach((t) => listEl.append(h('button', { class: 'ex-topic', onclick: () => { st.stack.push({ topic: t.id }); draw(); } },
        h('div', { class: 'ex-topic-h' }, h('b', null, t.title), h('span', { class: 'ex-w w-' + t.weight }, t.weight), count(t.id) ? h('span', { class: 'ex-n num' }, count(t.id) + ' past Q') : null, p.guides[t.id] ? h('span', { class: 'ex-n' }, 'Guide') : null),
        h('small', null, t.why), t.sources ? h('small', { class: 'ex-src' }, t.sources) : null)));
      body.append(listEl);
      if (p.gaps && p.gaps.length) body.append(h('div', { class: 'ex-gaps' }, h('div', { class: 'fx-sub' }, 'Never asked in past exams, still to know'), ...p.gaps.map((g) => h('p', null, h('b', null, g.topic + ' '), g.note))));
    }

    /* layered study guide per topic: big picture, numbered parts; tap any block to ask, the answer goes right under it */
    async function drawGuide(tid) {
      const t = p.topics.find((x) => x.id === tid) || { id: tid, title: tid, why: '', sources: '', subtopics: [] };
      const head = h('div', { class: 'ex-guide-h' }, h('h2', null, t.title), h('p', { class: 'muted' }, t.why));
      body.append(head);
      let g = p.guides[tid];
      if (!g) {
        if (!(await needKey())) return;
        const wrap = h('div', { class: 'ex-guide' }), live = md('');
        wrap.append(live); body.append(wrap);
        live.innerHTML = '<span class="thinking">Writing the guide<i>.</i><i>.</i><i>.</i></span>';
        try {
          const c = await client();
          const qs = p.questions.filter((q) => (q.topics || []).includes(tid)).slice(0, 8).map((q) => `- (${q.id}, ${q.source}) ${q.text}`).join('\n');
          let text = '';
          const stream = c.messages.stream({ model: model(), max_tokens: 16000, output_config: { effort: 'medium' },
            system: `You write one living study guide for a topic, read top-down. ${STYLE}
Format exactly:
## Big picture
4–7 numbered one-line statements; line k maps to part k.
## 1. <title>
Start with the main idea in one sentence, then the core content: definitions with hypotheses, key results, the formula in a $$ block, short bullets, one small worked example. Every symbol defined before use. Mark approximations and assumptions explicitly.
(continue ## 2., ## 3. …)
## Quick reference
A small table of the rules and formulas needed in the exam.
Keep the big picture and the parts short; depth comes later as follow-up blocks. Separate paragraphs with blank lines.`,
            messages: [{ role: 'user', content: `Topic: ${t.title}\nWhat gets asked: ${t.why}\nSubtopics: ${(t.subtopics || []).join('; ')}\nWhere it is in the student's materials: ${t.sources}\nPast questions on it:\n${qs || '(none)'}\nTest: ${e.title} (${KINDS[e.kind]}).` }] });
          stream.on('text', (d) => { text += d; live.innerHTML = A.AI.md(text, window.katex); });
          await stream.finalMessage();
          g = p.guides[tid] = { blocks: splitBlocks(text), at: Date.now() };
          savePrep(e.id);
        } catch (err) { live.innerHTML = ''; live.append(h('p', { class: 'ex-err' }, 'Could not write the guide: ' + (err.message || err))); return; }
        if (st.stack[st.stack.length - 1] !== undefined && st.stack[st.stack.length - 1].topic === tid) draw();
        return;
      }
      const wrap = h('div', { class: 'ex-guide' });
      g.blocks.forEach((b, i) => {
        const el = h('div', { class: 'ex-block' + (/^#/.test(b.md) ? ' heading' : '') }, md(b.md));
        el.addEventListener('click', (ev) => { if (ev.target.closest('a, button, input, textarea')) return; askUnder(el, i); });
        wrap.append(el);
        (b.deeper || []).forEach((d) => wrap.append(h('div', { class: 'ex-deeper' }, h('div', { class: 'ex-deeper-h' }, 'Deeper: ' + d.q), md(d.md))));
      });
      body.append(h('p', { class: 'ex-hint' }, 'Tap any line to ask about it. The answer appears right under it.'), wrap);
      const qs = p.questions.filter((q) => (q.topics || []).includes(tid));
      if (qs.length) { body.append(h('div', { class: 'fx-sub ex-qs-h' }, 'Past questions on this')); qs.forEach((q) => body.append(questionCard(q))); }

      function askUnder(el, i) {
        const open = wrap.querySelector('.ex-ask'); if (open) open.remove();
        const inp = h('textarea', { class: 'field', rows: 1, placeholder: 'What is unclear about this part?' });
        const go = h('button', { class: 'send-btn', 'aria-label': 'Ask', html: A.icon('send') });
        const box = h('div', { class: 'ex-ask' }, inp, go);
        let after = el; while (after.nextElementSibling && after.nextElementSibling.classList.contains('ex-deeper')) after = after.nextElementSibling;
        after.after(box);
        setTimeout(() => inp.focus(), 30);
        const send = async () => {
          const q = inp.value.trim(); if (!q || !(await needKey())) return;
          const ans = h('div', { class: 'ex-deeper' }, h('div', { class: 'ex-deeper-h' }, 'Deeper: ' + q), md(''));
          box.replaceWith(ans);
          const live = ans.lastChild; live.innerHTML = '<span class="thinking">Thinking<i>.</i><i>.</i><i>.</i></span>';
          const above = g.blocks.slice(0, i + 1).map((b) => b.md + (b.deeper || []).map((d) => `\n\n### Deeper: ${d.q}\n${d.md}`).join('')).join('\n\n');
          try {
            const c = await client(); let text = '';
            const stream = c.messages.stream({ model: model(), max_tokens: 8000, output_config: { effort: 'medium' },
              system: `You answer a follow-up question about one line of a study guide. The answer is inserted directly under that line. ${STYLE}
Rules: assume ONLY what appears in the guide above the line (given below). If you need a term not defined above, define it first. Build from definitions: what the objects are, which assumptions are made where, which step is an approximation. Give the structural reason. Include one tiny concrete example or numeric check when it makes the step obvious. Be concise; do not repeat the guide. No heading.`,
              messages: [{ role: 'user', content: `The guide up to and including the line:\n"""\n${above.slice(-14000)}\n"""\n\nThe line the student asks about:\n"""\n${g.blocks[i].md}\n"""\n\nQuestion: ${q}` }] });
            stream.on('text', (d) => { text += d; live.innerHTML = A.AI.md(text, window.katex); });
            await stream.finalMessage();
            (g.blocks[i].deeper = g.blocks[i].deeper || []).push({ q, md: text, at: Date.now() });
            savePrep(e.id);
          } catch (err) { live.innerHTML = ''; live.append(h('p', { class: 'ex-err' }, String(err.message || err))); }
        };
        go.addEventListener('click', send);
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } });
      }
    }
    const splitBlocks = (text) => {
      const out = []; let cur = [];
      const flush = () => { const s = cur.join('\n').trim(); if (s) out.push({ md: s }); cur = []; };
      let inMath = false, inCode = false;
      text.split('\n').forEach((line) => {
        if (/^```/.test(line)) inCode = !inCode;
        if ((line.match(/\$\$/g) || []).length % 2) inMath = !inMath;
        if (!inMath && !inCode && /^#{1,3}\s/.test(line)) { flush(); out.push({ md: line.trim() }); return; }
        if (!inMath && !inCode && !line.trim()) { flush(); return; }
        cur.push(line);
      });
      flush();
      return out;
    };

    function questionCard(q) {
      const ans = p.answers[q.id] || {};
      const card = h('div', { class: 'ex-q' }, h('div', { class: 'ex-q-h' }, h('b', null, q.source), h('span', { class: 'ex-w w-' + (q.difficulty === 'hard' ? 'high' : q.difficulty === 'easy' ? 'low' : 'medium') }, q.difficulty)), md(q.text), chips(q.topics));
      const out = h('div', { class: 'ex-q-out' });
      const showStored = () => { out.innerHTML = ''; if (ans.hint) out.append(h('div', { class: 'ex-deeper' }, h('div', { class: 'ex-deeper-h' }, 'Hint'), md(ans.hint))); if (ans.solution) out.append(h('div', { class: 'ex-deeper sol' }, h('div', { class: 'ex-deeper-h' }, 'Solution'), md(ans.solution))); };
      showStored();
      const gen = (kind) => async () => {
        if (ans[kind]) { showStored(); return; }
        if (!(await needKey())) return;
        const box = h('div', { class: 'ex-deeper' + (kind === 'solution' ? ' sol' : '') }, h('div', { class: 'ex-deeper-h' }, kind === 'hint' ? 'Hint' : 'Solution'), md(''));
        out.append(box);
        const live = box.lastChild; live.innerHTML = '<span class="thinking">Thinking<i>.</i><i>.</i><i>.</i></span>';
        try {
          const c = await client(); let text = '';
          const stream = c.messages.stream({ model: model(), max_tokens: 16000, output_config: { effort: kind === 'hint' ? 'low' : 'high' },
            system: `${STYLE} ${kind === 'hint' ? 'Give one hint that unlocks the next step. Do not solve it. Two to four sentences.' : 'Give a complete, rigorous solution: state what is used (with hypotheses checked), every step justified, and end with what the examiner looks for and common mistakes.'}`,
            messages: [{ role: 'user', content: `Question (${q.source}):\n${q.text}` }] });
          stream.on('text', (d) => { text += d; live.innerHTML = A.AI.md(text, window.katex); });
          await stream.finalMessage();
          ans[kind] = text; p.answers[q.id] = ans; savePrep(e.id);
        } catch (err) { live.innerHTML = ''; live.append(h('p', { class: 'ex-err' }, String(err.message || err))); }
      };
      const acts = h('div', { class: 'ex-q-acts' },
        h('button', { class: 'btn', onclick: gen('hint') }, 'Hint'),
        h('button', { class: 'btn', onclick: gen('solution') }, 'Solution'),
        q.file > 0 && e.files[q.file - 1] ? h('button', { class: 'btn', onclick: () => solveInNotebook(q) }, A.iconEl('notebook'), 'Solve in a notebook') : null);
      card.append(acts, out);
      return card;
    }
    async function solveInNotebook(q) {
      const f = e.files[q.file - 1];
      try {
        const blob = await A.store.loadFile('exf_' + f.id, f.type);
        let url, w, hh;
        if (/pdf/.test(f.type)) {
          const lib = await A.ST.pdfLib();
          const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
          const page = await pdf.getPage(Math.min(Math.max(1, q.page || 1), pdf.numPages));
          const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(2.5, 1800 / vp1.width) });
          const c = h('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          url = c.toDataURL('image/jpeg', 0.88); w = c.width; hh = c.height;
        } else {
          url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
          const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = url; }); w = im.naturalWidth; hh = im.naturalHeight;
        }
        // one practice notebook per test, so all the worked questions live together
        let nbId = e.notebookId;
        const metas = (await A.store.listMeta()).filter(Boolean);
        if (!nbId || !metas.some((m) => m.id === nbId)) {
          const ln = S.lastNotebook || {};
          const doc = A.D.create({ name: e.title + ' · practice', bg: ln.color || '#ffffff', kind: 'notebook', page: { template: ln.tpl || 'grid', color: ln.color || '#ffffff', size: ln.size || 'a4', orient: 'portrait', scroll: 'vertical' } });
          doc.subject = e.course || null;
          await A.store.saveDoc(doc, null);
          nbId = e.notebookId = doc.id; saveMeta();
        }
        A.UI.pendingInsert = { url, w, h: hh, label: q.source };
        close();
        A.emit('open', nbId);
      } catch (err) { A.toast('Could not open that page: ' + (err.message || err)); }
    }
    function drawQuestions() {
      if (!p.questions.length) { body.append(h('p', { class: 'fx-none' }, 'No past questions were found. Add past exams or problem sets and re-plan.')); return; }
      const by = new Map();
      p.questions.forEach((q) => { const k = q.source.replace(/,?\s*(Q|#|Problem|Question)\s*\d+.*$/i, '') || 'Questions'; if (!by.has(k)) by.set(k, []); by.get(k).push(q); });
      for (const [k, qs] of by) { body.append(h('div', { class: 'fx-sub ex-qs-h' }, k)); qs.forEach((q) => body.append(questionCard(q))); }
    }

    /* practice: new problems in the style of the past exams, and a timed mock exam */
    function drawPractice() {
      const pick = new Set(p.topics.filter((t) => t.weight === 'high').slice(0, 3).map((t) => t.id));
      const tbox = h('div', { class: 'ex-chips pick' });
      p.topics.forEach((t) => { const b = h('button', { class: 'ex-chip' + (pick.has(t.id) ? ' on' : ''), onclick: () => { if (pick.has(t.id)) pick.delete(t.id); else pick.add(t.id); b.classList.toggle('on'); } }, t.title); tbox.append(b); });
      body.append(h('div', { class: 'ex-practice-new' }, h('div', { class: 'fx-sub' }, 'Make practice problems'), tbox,
        h('div', { class: 'row gap' }, h('button', { class: 'btn primary', onclick: () => makeSet('set', [...pick]) }, 'Five problems on these'), h('button', { class: 'btn', onclick: () => makeSet('mock', p.topics.map((t) => t.id)) }, A.iconEl('timer'), 'Mock exam'))));
      p.practice.slice().reverse().forEach((set) => body.append(drawSet(set)));
    }
    const SET_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, minutes: { type: 'integer', description: 'Suggested time limit' }, problems: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } }, solution: { type: 'string' } }, required: ['text', 'topics', 'solution'], additionalProperties: false } } }, required: ['title', 'minutes', 'problems'], additionalProperties: false };
    async function makeSet(kind, tids) {
      if (!(await needKey())) return;
      if (!tids.length) return A.toast('Pick at least one topic.');
      const holder = h('div', { class: 'ex-building small' }, h('div', { class: 'ex-spin' }), h('p', null, kind === 'mock' ? 'Writing a mock exam in the style of your past exams…' : 'Writing five problems…'));
      body.querySelector('.ex-practice-new').after(holder);
      try {
        const c = await client();
        const examples = p.questions.slice(0, 14).map((q) => `- ${q.source}: ${q.text}`).join('\n').slice(0, 12000);
        const res = await c.messages.stream({ model: model(), max_tokens: 24000, output_config: { effort: 'medium', format: { type: 'json_schema', schema: SET_SCHEMA } },
          system: `${STYLE} You write new practice problems for "${e.title}". Match the style, length and difficulty of the past questions; never copy them. Every problem gets a complete rigorous solution.`,
          messages: [{ role: 'user', content: `${kind === 'mock' ? `A full mock ${KINDS[e.kind].toLowerCase()} with the expected format${p.format ? ` (${p.format})` : ''}, covering the topics in proportion to their weight.` : 'Five problems, from easier to harder.'}\nTopics: ${tids.map((tid) => { const t = p.topics.find((x) => x.id === tid); return t ? `${t.id}: ${t.title} (${t.why})` : tid; }).join('\n')}\nPast questions for style:\n${examples || '(none given)'}` }] }).finalMessage();
        const data = JSON.parse((res.content.find((x) => x.type === 'text') || {}).text || '{}');
        p.practice.push({ id: A.uid(), kind, title: data.title, minutes: data.minutes, problems: data.problems || [], at: Date.now() });
        savePrep(e.id); draw();
      } catch (err) { holder.innerHTML = ''; holder.append(h('p', { class: 'ex-err' }, 'Could not make the problems: ' + (err.message || err))); }
    }
    function drawSet(set) {
      const card = h('div', { class: 'ex-set' }, h('div', { class: 'ex-set-h' }, h('b', null, set.title || (set.kind === 'mock' ? 'Mock exam' : 'Practice')), h('small', { class: 'num' }, `${set.problems.length} problem${set.problems.length === 1 ? '' : 's'} · ${set.minutes} min · ${A.fmtDate(set.at)}`)));
      if (set.kind === 'mock') {
        const timer = h('button', { class: 'btn' }, A.iconEl('timer'), `Start ${set.minutes}-minute timer`);
        timer.addEventListener('click', () => {
          const end = Date.now() + set.minutes * 6e4;
          const tick = () => { const s = Math.max(0, Math.round((end - Date.now()) / 1000)); timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`; if (s > 0 && timer.isConnected) setTimeout(tick, 1000); else if (timer.isConnected) { timer.textContent = 'Time is up'; A.toast('Time is up. Check your answers against the solutions.', 3000); } };
          tick();
        });
        card.append(timer);
      }
      set.problems.forEach((pr, i) => {
        const sol = h('div', { class: 'ex-deeper sol', hidden: true }, h('div', { class: 'ex-deeper-h' }, 'Solution'), md(pr.solution));
        card.append(h('div', { class: 'ex-q' }, h('div', { class: 'ex-q-h' }, h('b', null, `Problem ${i + 1}`)), md(pr.text), chips(pr.topics),
          h('div', { class: 'ex-q-acts' }, h('button', { class: 'btn', onclick: (ev) => { sol.hidden = !sol.hidden; ev.currentTarget.textContent = sol.hidden ? 'Show solution' : 'Hide solution'; } }, 'Show solution')), sol));
      });
      return card;
    }

    draw();
    if (buildNow && (e.files.length || e.books.length || e.notebooks.length || e.notes)) runBuild();
  };
})();
