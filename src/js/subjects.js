/* Axiom studies: majors, courses (subjects), onboarding */
'use strict';
(() => {
  const h = A.h;
  const S = A.settings;
  const SU = (A.SU = {});

  SU.majors = [
    { id: 'math', name: 'Mathematics', courses: ['Calculus', 'Linear Algebra', 'Real Analysis', 'Abstract Algebra', 'Topology', 'Differential Geometry', 'Complex Analysis', 'Number Theory', 'Probability'] },
    { id: 'physics', name: 'Physics', courses: ['Classical Mechanics', 'Electromagnetism', 'Optics', 'Quantum Mechanics', 'Thermodynamics', 'Statistical Mechanics', 'Special Relativity'] },
    { id: 'ee', name: 'Electrical Eng.', courses: ['Circuit Analysis', 'Signals & Systems', 'Electronics', 'Control Systems', 'Electromagnetics'] },
    { id: 'me', name: 'Mechanical Eng.', courses: ['Statics', 'Dynamics', 'Mechanics of Materials', 'Fluid Mechanics', 'Heat Transfer'] },
    { id: 'chem', name: 'Chemistry', courses: ['General Chemistry', 'Organic Chemistry', 'Physical Chemistry', 'Inorganic Chemistry'] },
    { id: 'cs', name: 'Computer Science', courses: ['Discrete Math', 'Algorithms', 'Data Structures', 'Theory of Computation', 'Machine Learning'] },
    { id: 'bio', name: 'Biology', courses: ['Cell Biology', 'Genetics', 'Biochemistry', 'Physiology'] },
  ];
  SU.colors = ['#3f7be0', '#e0574a', '#2f9e6b', '#d99a22', '#8e5bd6', '#1fa3b3', '#d4549a', '#6b7a8f', '#c26b2e', '#4a5bd4'];

  SU.list = () => S.subjects || [];
  SU.get = (id) => SU.list().find((s) => s.id === id) || null;
  SU.name = (id) => (SU.get(id) || {}).name || '';
  SU.color = (id) => (SU.get(id) || {}).color || 'var(--faint)';
  SU.add = (name, color) => {
    name = String(name || '').trim().slice(0, 48);
    if (!name) return null;
    const ex = SU.list().find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (ex) return ex;
    const s = { id: A.uid(), name, color: color || SU.colors[SU.list().length % SU.colors.length] };
    S.subjects = SU.list().concat([s]);
    A.saveSettings();
    A.emit('subjects');
    return s;
  };
  SU.remove = (id) => { S.subjects = SU.list().filter((s) => s.id !== id); A.saveSettings(); A.emit('subjects'); };
  SU.rename = (id, name) => { const s = SU.get(id); if (s && name) { s.name = name.slice(0, 48); A.saveSettings(); A.emit('subjects'); } };
  SU.majorNames = () => (S.majors || []).map((m) => (SU.majors.find((x) => x.id === m) || {}).name).filter(Boolean);

  /* "What do you study?" sheet: majors + courses */
  SU.openSetup = (first = false) => new Promise((res) => {
    const picked = new Set(S.majors || []);
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal wide', role: 'dialog', 'aria-label': 'Your studies' });
    const close = () => { back.remove(); res(); };
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const chips = h('div', { class: 'chips' });
      SU.majors.forEach((m) => chips.append(h('button', { class: 'chip' + (picked.has(m.id) ? ' on' : ''), onclick: () => { picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id); draw(); } }, m.name)));
      body.append(h('h5', null, 'Majors'), chips);
      const mine = h('div', { class: 'chips' });
      SU.list().forEach((s) => mine.append(h('span', { class: 'chip on' }, h('i', { class: 'dot', style: { background: s.color } }), s.name,
        h('button', { class: 'chip-x', 'aria-label': 'Remove ' + s.name, html: A.icon('close'), onclick: () => { SU.remove(s.id); draw(); } }))));
      const inp = h('input', { class: 'field', id: 'course-input', placeholder: 'Add a course, e.g. Differential Geometry', autocomplete: 'off', style: { margin: '0' } });
      const add = () => { if (SU.add(inp.value)) { inp.value = ''; draw(); setTimeout(() => A.$('#course-input')?.focus(), 0); } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      body.append(h('h5', null, 'Your courses'), SU.list().length ? mine : h('p', { class: 'muted small' }, 'Courses become folders for your drawings and documents, and the tutor knows which course you are working on.'),
        h('div', { class: 'row gap', style: { marginTop: '8px' } }, inp, h('button', { class: 'btn', onclick: add }, 'Add')));
      const sugg = h('div', { class: 'chips' });
      const have = new Set(SU.list().map((s) => s.name.toLowerCase()));
      SU.majors.filter((m) => picked.has(m.id)).forEach((m) => m.courses.forEach((c) => {
        if (!have.has(c.toLowerCase())) sugg.append(h('button', { class: 'chip ghost', onclick: () => { SU.add(c); draw(); } }, '+ ' + c));
      }));
      if (sugg.childElementCount) body.append(h('h5', null, 'Suggestions'), sugg);
    };
    draw();
    const done = h('button', { class: 'btn primary', onclick: () => { S.majors = [...picked]; A.saveSettings(); A.emit('subjects'); close(); } }, first ? 'Start' : 'Done');
    box.append(h('h3', null, first ? 'What do you study?' : 'Your studies'),
      h('p', { class: 'muted' }, 'Axiom shows the visual tools for your majors first and organizes your work by course. You can change this any time in Settings.'),
      body,
      h('div', { class: 'row end gap', style: { marginTop: '22px' } }, first ? h('button', { class: 'btn', onclick: () => { S.majors = S.majors || []; A.saveSettings(); close(); } }, 'Skip') : null, done));
    back.append(box);
    document.body.append(back);
  });

  /* compact subject picker used in menus */
  SU.pickMenu = (anchor, current, onPick) => {
    const box = h('div', { class: 'menu' });
    box.append(h('div', { class: 'sub' }, 'Course'));
    const it = (id, name, color) => {
      const b = h('button', { class: id === current ? 'on' : '', onclick: () => { A.closePopovers(); onPick(id); } }, h('i', { class: 'dot', style: { background: color } }), name);
      box.append(b);
    };
    it(null, 'No course', 'transparent');
    SU.list().forEach((s) => it(s.id, s.name, s.color));
    box.append(h('hr'), h('button', { onclick: async () => { A.closePopovers(); const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); const s = n && SU.add(n); if (s) onPick(s.id); } }, '+ New course'));
    A.popover(box, anchor, { side: 'down' });
  };
})();
