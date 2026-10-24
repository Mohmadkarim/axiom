/* Axiom planner: classes, exams, deadlines and study blocks; the iPad's calendars; reminders; syllabus import */
'use strict';
(() => {
  const h = A.h, S = A.settings;
  const PL = (A.PL = {});
  const HOUR = 36e5, DAY = 864e5;
  const KINDS = {
    class: { label: 'Class', icon: 'clock' },
    exam: { label: 'Exam', icon: 'flag' },
    deadline: { label: 'Deadline', icon: 'target' },
    study: { label: 'Study', icon: 'book' },
  };
  const NATIVE = () => !!(window.AXIOM_NATIVE && window.AXIOM_NATIVE.planner && A.native);

  /* ---------- data ---------- */
  const plan = () => (S.plan = S.plan || { items: [], mirror: false, remind: true, hiddenCals: [], calOn: false });
  PL.items = () => plan().items;
  const save = (ask) => { A.saveSettings(); A.emit('plan'); scheduleSync(ask === true); };
  PL.add = (it) => { it.id = it.id || A.uid(); plan().items.push(it); save(true); return it; };
  PL.update = (id, patch) => { const it = PL.items().find((x) => x.id === id); if (it) { Object.assign(it, patch); save(); } return it; };
  PL.remove = (id) => { plan().items = PL.items().filter((x) => x.id !== id); save(); };

  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const weekStart = (t) => { const d = new Date(dayStart(t)); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const isoDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const at = (dateStr, timeStr) => { const [y, m, d] = dateStr.split('-').map(Number); const [hh, mm] = (timeStr || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh || 0, mm || 0).getTime(); };
  PL.util = { dayStart, weekStart, addDays, fmtTime, fmtDay, isoDate, hm, at };

  /* every occurrence of every item between from and to (weekly items repeat until their end date) */
  PL.occ = (from, to) => {
    const out = [];
    for (const it of PL.items()) {
      const len = Math.max(0, (it.end || it.start) - it.start);
      if (!it.weekly) { if (it.start < to && (it.start + len) >= from) out.push({ it, start: it.start, end: it.start + len, key: it.id }); continue; }
      const until = it.until || it.start + 16 * 7 * DAY;
      let k = Math.max(0, Math.floor((from - it.start) / (7 * DAY)) - 1);
      for (; ; k++) {
        const s = addDays(it.start, 7 * k);
        if (s >= to || s > until) break;
        if (s + len < from || (it.skip || []).includes(dayStart(s))) continue;
        out.push({ it, start: s, end: s + len, key: it.id + '@' + dayStart(s) });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  };

  /* ---------- the iPad's calendars ---------- */
  let calCache = { from: 0, to: 0, at: 0, events: [] };
  PL.calAvailable = NATIVE;
  PL.calEnabled = () => NATIVE() && plan().calOn;
  PL.connectCalendar = async () => {
    if (!NATIVE()) { A.toast('Your iPad calendars appear in the Axiom app on iPad.'); return false; }
    const ok = await A.native.post({ op: 'calAccess' }).catch(() => false);
    if (!ok) { A.toast('Calendar access is off. Turn it on in Settings › Axiom › Calendars.', 4200); return false; }
    plan().calOn = true; calCache.at = 0; save();
    return true;
  };
  PL.calEvents = async (from, to) => {
    if (!PL.calEnabled()) return [];
    if (calCache.at > Date.now() - 60e3 && from >= calCache.from && to <= calCache.to) return calCache.events.filter((e) => e.start < to && e.end > from);
    const pad = 14 * DAY;
    const events = await A.native.post({ op: 'calEvents', from: from - pad, to: to + pad, hidden: plan().hiddenCals || [] }).catch(() => []);
    calCache = { from: from - pad, to: to + pad, at: Date.now(), events: events || [] };
    return calCache.events.filter((e) => e.start < to && e.end > from);
  };
  A.on('plan', () => { calCache.at = 0; });

  /* ---------- reminders (iPad notifications) and the "Axiom" calendar ---------- */
  let syncT = 0;
  let askNext = false;
  const scheduleSync = (ask) => { if (ask) askNext = true; clearTimeout(syncT); syncT = setTimeout(PL.sync, 1200); };
  PL.sync = async () => {
    if (!NATIVE()) return;
    const now = Date.now(), list = [];
    if (plan().remind !== false) {
      for (const o of PL.occ(now, now + 21 * DAY)) {
        const it = o.it, course = A.SU.name(it.course);
        const title = (course ? course + ': ' : '') + it.title;
        const push = (t, body, tag) => { if (t > now) list.push({ id: `${o.key}#${tag}`, title, body, at: t }); };
        if (it.kind === 'exam') { push(o.start - DAY, `Exam tomorrow at ${fmtTime(o.start)}${it.room ? ' · ' + it.room : ''}${it.covers ? ' · ' + it.covers : ''}`, 'd'); push(o.start - HOUR, `Exam in 1 hour${it.room ? ' · ' + it.room : ''}`, 'h'); }
        if (it.kind === 'deadline' && !it.done) { push(o.start - DAY, `Due tomorrow at ${fmtTime(o.start)}`, 'd'); push(o.start - 3 * HOUR, `Due in 3 hours`, 'h'); }
        if (it.kind === 'study') push(o.start, 'Study block starting now', 's');
        if (it.kind === 'class' && plan().remindClasses) push(o.start - 10 * 6e4, `In 10 minutes${it.room ? ' · ' + it.room : ''}`, 'c');
      }
      list.sort((a, b) => a.at - b.at);
    }
    const ask = askNext; askNext = false;
    A.native.post({ op: 'notifSync', list: list.slice(0, 60), ask }).catch(() => {});
    if (plan().mirror && plan().calOn) {
      const items = PL.occ(now - 7 * DAY, now + 120 * DAY).map((o) => ({
        key: o.key, title: (o.it.kind === 'deadline' ? 'Due: ' : o.it.kind === 'exam' ? 'Exam: ' : '') + o.it.title + (A.SU.name(o.it.course) ? ` (${A.SU.name(o.it.course)})` : ''),
        start: o.it.kind === 'deadline' ? o.start - 30 * 6e4 : o.start, end: o.it.kind === 'deadline' ? o.start : Math.max(o.end, o.start + 15 * 6e4),
        location: o.it.room || '', notes: [o.it.covers ? 'Covers: ' + o.it.covers : '', o.it.notes || '', 'Added by Axiom.'].filter(Boolean).join('\n'),
      }));
      A.native.post({ op: 'calMirror', items, from: now - 7 * DAY, to: now + 120 * DAY }).catch(() => {});
    }
  };
  setTimeout(() => { if (NATIVE() && PL.items().length) PL.sync(); }, 4000);

  /* ---------- what is on a day / coming up ---------- */
  PL.day = async (t) => {
    const from = dayStart(t), to = addDays(from, 1);
    const own = PL.occ(from, to).map((o) => ({ ...o, own: true }));
    const cal = (await PL.calEvents(from, to)).map((e) => ({ ev: e, start: e.start, end: e.end, allDay: e.allDay, key: e.id }));
    return own.concat(cal).sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.start - b.start);
  };
  PL.upcoming = (days = 21, course = null) => {
    const now = Date.now();
    return PL.occ(now - HOUR, now + days * DAY).filter((o) => (o.it.kind === 'exam' || (o.it.kind === 'deadline' && !o.it.done)) && (!course || o.it.course === course));
  };
  const daysLeft = (t) => { const d = Math.round((dayStart(t) - dayStart(Date.now())) / DAY); return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`; };
  const colorOf = (it) => (it.course ? A.SU.color(it.course) : 'var(--accent)');
  const withC = (el, c) => { el.style.setProperty('--c', c); return el; };

  /* ---------- Home: Today ---------- */
  PL.todaySection = () => {
    const sec = h('section', { class: 'g-sec pl-today' });
    const weekBtn = h('button', { class: 'link-btn', onclick: () => PL.openWeek() }, 'Week');
    const addBtn = h('button', { class: 'ibtn', title: 'Add to your plan', 'aria-label': 'Add to your plan', html: A.icon('plus') });
    addBtn.addEventListener('click', () => addMenu(addBtn));
    sec.append(h('div', { class: 'g-sec-h' }, h('h2', null, 'Today'), h('div', { class: 'row', style: { gap: '4px' } }, weekBtn, addBtn)));
    const body = h('div', { class: 'pl-today-body' });
    sec.append(body);
    const fill = async () => {
      const items = await PL.day(Date.now());
      const up = PL.upcoming(21).filter((o) => dayStart(o.start) > dayStart(Date.now()) || o.it.kind === 'exam');
      body.innerHTML = '';
      if (!PL.items().length && !PL.calEnabled()) { body.append(emptyCard()); return; }
      const agenda = h('div', { class: 'pl-agenda' });
      const now = Date.now();
      if (!items.length) agenda.append(h('p', { class: 'pl-none' }, 'Nothing scheduled today.'));
      items.forEach((o) => agenda.append(row(o, now)));
      const next = h('div', { class: 'pl-next' }, h('div', { class: 'pl-sub' }, 'Coming up'));
      if (!up.length) next.append(h('p', { class: 'pl-none' }, 'No exams or deadlines in the next three weeks.'));
      up.slice(0, 6).forEach((o) => next.append(h('button', { class: 'pl-up', onclick: () => PL.edit(o.it) },
        h('span', { class: 'pl-when num' }, daysLeft(o.start)),
        h('span', { class: 'grow pl-up-t' }, h('b', null, o.it.title), h('small', null, [A.SU.name(o.it.course), KINDS[o.it.kind].label + ' · ' + fmtDay(o.start) + ' ' + fmtTime(o.start), o.it.covers].filter(Boolean).join(' · '))),
        h('i', { class: 'dot', style: { background: colorOf(o.it) } }))));
      body.append(agenda, next);
    };
    fill();
    const off = A.on('plan', () => { if (!sec.isConnected) return off && off(); fill(); });
    return sec;
  };
  const row = (o, now) => {
    if (o.ev) {
      const e = o.ev;
      return h('div', { class: 'pl-row cal' + (e.end < now ? ' past' : '') },
        h('span', { class: 'pl-time num' }, e.allDay ? 'All day' : fmtTime(e.start), e.allDay ? null : h('small', null, fmtTime(e.end))),
        h('span', { class: 'pl-bar', style: { background: e.color } }),
        h('span', { class: 'grow pl-row-t' }, h('b', null, e.title || 'Busy'), h('small', null, [e.location, e.calendar].filter(Boolean).join(' · '))));
    }
    const it = o.it, dl = it.kind === 'deadline';
    const r = h('div', { class: 'pl-row' + (o.end < now && !dl ? ' past' : '') + (dl && it.done ? ' done' : ''), role: 'button', tabindex: 0 },
      h('span', { class: 'pl-time num' }, dl ? 'Due' : fmtTime(o.start), h('small', null, dl ? fmtTime(o.start) : fmtTime(o.end))),
      h('span', { class: 'pl-bar', style: { background: colorOf(it) } }),
      h('span', { class: 'grow pl-row-t' }, h('b', null, it.title), h('small', null, [KINDS[it.kind].label, A.SU.name(it.course), it.room, it.covers].filter(Boolean).join(' · '))));
    if (dl) {
      const ck = h('button', { class: 'pl-check' + (it.done ? ' on' : ''), 'aria-label': it.done ? 'Mark not done' : 'Mark done', html: A.icon('check') });
      ck.addEventListener('click', (e) => { e.stopPropagation(); PL.update(it.id, { done: !it.done }); });
      r.append(ck);
    }
    r.addEventListener('click', () => PL.edit(it, o.start));
    return r;
  };
  const emptyCard = () => h('div', { class: 'pl-empty' },
    h('div', { class: 'pl-empty-art', html: A.icon('calendar') }),
    h('div', { class: 'grow' }, h('h3', null, 'Plan your week'), h('p', null, 'Add a syllabus or a timetable and Axiom fills in your classes, exams and deadlines, with reminders before each one.')),
    h('div', { class: 'pl-empty-acts' },
      h('button', { class: 'btn primary', onclick: () => PL.importSyllabus() }, A.iconEl('doc'), 'Import syllabus or timetable'),
      h('button', { class: 'btn', onclick: () => PL.edit(null, null, { kind: 'class' }) }, 'Add manually'),
      NATIVE() ? h('button', { class: 'btn', onclick: async () => { if (await PL.connectCalendar()) A.emit('plan'); } }, A.iconEl('calendar'), 'Show my calendar') : null));
  function addMenu(anchor, defaults = {}) {
    const box = h('div', { class: 'menu' });
    const it = (icon, label, fn) => box.append(h('button', { onclick: () => { A.closePopovers(); fn(); } }, A.iconEl(icon), label));
    it('clock', 'Class', () => PL.edit(null, null, { kind: 'class', ...defaults }));
    it('flag', 'Exam', () => PL.edit(null, null, { kind: 'exam', ...defaults }));
    it('target', 'Deadline', () => PL.edit(null, null, { kind: 'deadline', ...defaults }));
    it('book', 'Study block', () => PL.edit(null, null, { kind: 'study', ...defaults }));
    box.append(h('hr'));
    it('doc', 'Import syllabus or timetable…', () => PL.importSyllabus(defaults.course));
    A.popover(box, anchor, { side: 'down' });
  }
  PL.addMenu = addMenu;

  /* ---------- course page: its schedule ---------- */
  PL.courseSection = (courseId) => {
    const sec = h('section', { class: 'g-sec pl-course' });
    const fill = () => {
      sec.innerHTML = '';
      const add = h('button', { class: 'ibtn', 'aria-label': 'Add to this course', html: A.icon('plus') });
      add.addEventListener('click', () => addMenu(add, { course: courseId }));
      sec.append(h('div', { class: 'g-sec-h' }, h('h2', null, 'Schedule'), add));
      const classes = PL.items().filter((x) => x.course === courseId && x.kind === 'class');
      const up = PL.upcoming(120, courseId);
      if (!classes.length && !up.length) {
        sec.append(h('div', { class: 'pl-course-empty' }, h('p', null, 'Add the syllabus and Axiom lists the class times, exams with what they cover, and every deadline.'),
          h('button', { class: 'btn', onclick: () => PL.importSyllabus(courseId) }, A.iconEl('doc'), 'Import syllabus')));
        return;
      }
      const grid = h('div', { class: 'pl-course-grid' });
      if (classes.length) grid.append(h('div', { class: 'pl-card' }, h('div', { class: 'pl-sub' }, 'Every week'), ...classes.map((c) => h('button', { class: 'pl-up', onclick: () => PL.edit(c) },
        h('span', { class: 'pl-when' }, new Date(c.start).toLocaleDateString([], { weekday: 'short' })),
        h('span', { class: 'grow pl-up-t' }, h('b', null, c.title), h('small', null, [fmtTime(c.start) + '–' + fmtTime(c.end), c.room].filter(Boolean).join(' · ')))))));
      grid.append(h('div', { class: 'pl-card' }, h('div', { class: 'pl-sub' }, 'Exams and deadlines'),
        ...(up.length ? up.slice(0, 8).map((o) => h('button', { class: 'pl-up', onclick: () => PL.edit(o.it) },
          h('span', { class: 'pl-when num' }, daysLeft(o.start)),
          h('span', { class: 'grow pl-up-t' }, h('b', null, o.it.title), h('small', null, [fmtDay(o.start) + ' ' + fmtTime(o.start), o.it.covers].filter(Boolean).join(' · '))))) : [h('p', { class: 'pl-none' }, 'Nothing coming up.')])));
      const subj = A.SU.get(courseId);
      if (subj && (subj.grading || subj.attendance)) grid.append(h('div', { class: 'pl-card' }, h('div', { class: 'pl-sub' }, 'From the syllabus'),
        subj.grading ? h('p', { class: 'pl-note' }, h('b', null, 'Grading '), subj.grading) : null,
        subj.attendance ? h('p', { class: 'pl-note' }, h('b', null, 'Attendance '), subj.attendance) : null));
      sec.append(grid);
    };
    fill();
    const off = A.on('plan', () => { if (!sec.isConnected) return off && off(); fill(); });
    return sec;
  };

  /* ---------- editor ---------- */
  PL.edit = (item, occStart, defaults = {}) => {
    const isNew = !item;
    const base = item || { kind: defaults.kind || 'study', title: '', course: defaults.course || null, start: defaults.start || (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d.getTime(); })(), weekly: (defaults.kind || 'study') === 'class' };
    const st = { ...base };
    if (!st.end) st.end = st.start + (st.kind === 'exam' ? 2 * HOUR : st.kind === 'class' ? 110 * 6e4 : HOUR);
    const back = h('div', { class: 'modal-back' });
    const close = () => back.remove();
    const box = h('div', { class: 'modal pl-edit', role: 'dialog', 'aria-label': isNew ? 'Add to plan' : 'Edit' });
    const draw = () => {
      box.innerHTML = '';
      const seg = h('div', { class: 'seg full' }, ...Object.entries(KINDS).map(([k, v]) => h('button', { class: st.kind === k ? 'on' : '', onclick: () => { st.kind = k; if (k === 'class') st.weekly = true; else if (isNew) st.weekly = false; draw(); } }, v.label)));
      const title = h('input', { class: 'field', value: st.title, placeholder: { class: 'e.g. Linear Algebra lecture', exam: 'e.g. Midterm 1', deadline: 'e.g. Problem set 3', study: 'What will you study?' }[st.kind] });
      title.addEventListener('input', () => { st.title = title.value; });
      const course = h('select', { class: 'field' }, h('option', { value: '' }, 'No course'), ...A.SU.list().map((s) => h('option', { value: s.id, selected: st.course === s.id }, s.name)), h('option', { value: '__new' }, 'New course…'));
      course.addEventListener('change', async () => { if (course.value === '__new') { const n = await A.dialog({ title: 'New course', input: '', okText: 'Add' }); const s = n && A.SU.add(n); st.course = s ? s.id : st.course; draw(); } else st.course = course.value || null; });
      const date = h('input', { class: 'field', type: 'date', value: isoDate(st.start) });
      const t1 = h('input', { class: 'field', type: 'time', value: hm(st.start) });
      const t2 = h('input', { class: 'field', type: 'time', value: hm(st.end) });
      const dl = st.kind === 'deadline';
      const lab = (t, el) => h('label', { class: 'pl-f' }, h('span', null, t), el);
      const rows = [seg, lab('Title', title), lab('Course', course), h('div', { class: 'pl-f3' }, lab(st.weekly ? 'First day' : 'Date', date), lab(dl ? 'Due' : 'Starts', t1), dl ? null : lab('Ends', t2))];
      let weekly = null, until = null;
      if (st.kind !== 'deadline') {
        weekly = h('input', { type: 'checkbox', checked: !!st.weekly });
        weekly.addEventListener('change', () => { st.weekly = weekly.checked; sync(); draw(); });
        rows.push(h('label', { class: 'pl-chk' }, weekly, h('span', null, 'Every week')));
        if (st.weekly) { until = h('input', { class: 'field', type: 'date', value: isoDate(st.until || st.start + 15 * 7 * DAY) }); rows.push(lab('Until', until)); }
      }
      const room = h('input', { class: 'field', value: st.room || '', placeholder: 'Room or link' });
      const covers = h('input', { class: 'field', value: st.covers || '', placeholder: 'e.g. Chapters 3–5' });
      const notes = h('textarea', { class: 'field', rows: 2, placeholder: 'Notes' }); notes.value = st.notes || '';
      if (st.kind === 'class' || st.kind === 'exam') rows.push(lab('Where', room));
      if (st.kind === 'exam' || st.kind === 'deadline') rows.push(lab(st.kind === 'exam' ? 'Covers' : 'What to hand in', covers));
      rows.push(lab('Notes', notes));
      const sync = () => {
        st.title = title.value.trim(); st.room = room.value.trim() || undefined; st.covers = covers.value.trim() || undefined; st.notes = notes.value.trim() || undefined;
        if (date.value) { st.start = at(date.value, t1.value || '09:00'); st.end = dl ? st.start : at(date.value, t2.value || hm(st.start + HOUR)); if (st.end <= st.start && !dl) st.end = st.start + HOUR; }
        if (until && until.value) st.until = at(until.value, '23:59');
        if (!st.weekly) delete st.until;
      };
      const saveBtn = h('button', { class: 'btn primary', onclick: () => {
        sync();
        if (!st.title) { title.focus(); title.classList.add('err'); return; }
        if (isNew) PL.add(st); else PL.update(item.id, st);
        close();
        if (isNew) A.toast(KINDS[st.kind].label + ' added', 1400);
      } }, isNew ? 'Add' : 'Save');
      const acts = h('div', { class: 'row gap pl-acts' });
      if (!isNew) {
        acts.append(h('button', { class: 'btn ghost-btn danger-text', onclick: async () => {
          if (item.weekly && occStart) {
            const box2 = h('div', { class: 'menu' });
            box2.append(h('button', { onclick: () => { A.closePopovers(); PL.update(item.id, { skip: (item.skip || []).concat([dayStart(occStart)]) }); close(); } }, 'Only this week'));
            box2.append(h('button', { class: 'danger', onclick: () => { A.closePopovers(); PL.remove(item.id); close(); } }, 'Every week'));
            A.popover(box2, acts.firstChild, { side: 'up' });
            return;
          }
          if (await A.dialog({ title: 'Delete this?', okText: 'Delete', danger: true })) { PL.remove(item.id); close(); }
        } }, 'Delete'));
      }
      acts.append(h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), saveBtn);
      box.append(h('h3', null, isNew ? 'Add to your plan' : 'Edit'), ...rows, acts);
      if (isNew && !st.title) setTimeout(() => title.focus(), 60);
    };
    draw();
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    document.body.append(back);
  };

  /* ---------- week view ---------- */
  PL.openWeek = (t = Date.now()) => {
    let ws = weekStart(t);
    const back = h('div', { class: 'pl-week', role: 'dialog', 'aria-label': 'Week' });
    const title = h('div', { class: 'pl-wk-title' });
    const grid = h('div', { class: 'pl-wk-grid' });
    const close = () => { back.remove(); A.emit('plan'); };
    const ib = (icon, label, fn) => h('button', { class: 'ibtn', title: label, 'aria-label': label, html: A.icon(icon), onclick: fn });
    const prev = ib('chev', 'Previous week', () => { ws = addDays(ws, -7); draw(); }); prev.classList.add('flip');
    const optsBtn = ib('more', 'Calendar options', () => calOptions(optsBtn, draw));
    const addBtn = ib('plus', 'Add', () => addMenu(addBtn));
    back.append(h('div', { class: 'pl-wk-bar' },
      ib('close', 'Close', close), title, h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost-btn', onclick: () => { ws = weekStart(Date.now()); draw(); } }, 'Today'),
      prev, ib('chev', 'Next week', () => { ws = addDays(ws, 7); draw(); }), optsBtn, addBtn), grid);
    document.body.append(back);
    const draw = async () => {
      const we = addDays(ws, 7);
      title.textContent = `${new Date(ws).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(addDays(ws, 6)).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      const own = PL.occ(ws, we), cal = await PL.calEvents(ws, we);
      const timed = own.map((o) => (o.it.kind === 'deadline' ? { o, s: Math.max(dayStart(o.start), o.start - 30 * 6e4), e: o.start } : { o, s: o.start, e: Math.max(o.end, o.start + 20 * 6e4) })).concat(cal.filter((e) => !e.allDay).map((e) => ({ ev: e, s: e.start, e: e.end })));
      let h0 = 8, h1 = 20;
      timed.forEach((b) => { const d = new Date(b.s); h0 = Math.min(h0, d.getHours()); const de = new Date(b.e); h1 = Math.max(h1, dayStart(b.e) > dayStart(b.s) ? 24 : de.getHours() + (de.getMinutes() ? 1 : 0)); });
      h1 = Math.min(24, Math.max(h1, h0 + 6));
      const PX = 52; // px per hour
      grid.innerHTML = '';
      grid.style.setProperty('--rows', h1 - h0);
      const head = h('div', { class: 'pl-wk-head' }, h('span'));
      const cols = h('div', { class: 'pl-wk-cols' });
      const hours = h('div', { class: 'pl-wk-hours' });
      for (let k = h0; k < h1; k++) hours.append(h('span', { class: 'num', style: { top: (k - h0) * PX + 'px' } }, `${String(k).padStart(2, '0')}:00`));
      cols.append(hours);
      const today = dayStart(Date.now());
      for (let d = 0; d < 7; d++) {
        const ds = addDays(ws, d);
        head.append(h('span', { class: 'pl-wk-day' + (ds === today ? ' on' : '') }, new Date(ds).toLocaleDateString([], { weekday: 'short' }), h('b', { class: 'num' }, new Date(ds).getDate())));
        const col = h('div', { class: 'pl-wk-col' + (ds === today ? ' today' : ''), style: { height: (h1 - h0) * PX + 'px' } });
        col.addEventListener('click', (e) => {
          if (e.target !== col) return;
          const y = e.offsetY, hr = h0 + Math.floor(y / PX * 2) / 2;
          const start = ds + hr * HOUR;
          PL.edit(null, null, { kind: 'study', start: new Date(ds).setHours(Math.floor(hr), (hr % 1) * 60, 0, 0) || start });
        });
        // lay out overlapping blocks side by side
        const blocks = timed.filter((b) => dayStart(b.s) === ds).sort((a, b) => a.s - b.s);
        const lanes = [];
        blocks.forEach((b) => { let L = lanes.findIndex((end) => end <= b.s); if (L < 0) { L = lanes.length; lanes.push(0); } lanes[L] = b.e; b.lane = L; });
        blocks.forEach((b) => {
          const top = (new Date(b.s).getHours() + new Date(b.s).getMinutes() / 60 - h0) * PX, height = Math.max(22, (b.e - b.s) / HOUR * PX - 2);
          const w = 100 / Math.max(1, lanes.length);
          const st = { top: top + 'px', height: height + 'px', left: `calc(${b.lane * w}% + 2px)`, width: `calc(${w}% - 4px)` };
          if (b.ev) {
            col.append(withC(h('div', { class: 'pl-blk cal', style: st, title: b.ev.title }, h('b', null, b.ev.title || 'Busy'), h('small', { class: 'num' }, fmtTime(b.s))), b.ev.color));
          } else {
            const it = b.o.it;
            const el = withC(h('button', { class: 'pl-blk k-' + it.kind + (it.done ? ' done' : ''), style: st }, h('b', null, it.title), h('small', { class: 'num' }, (it.kind === 'deadline' ? 'Due ' + fmtTime(b.e) : fmtTime(b.s)) + (it.room ? ' · ' + it.room : ''))), colorOf(it));
            el.addEventListener('click', () => PL.edit(it, b.o.start));
            col.append(el);
          }
        });
        if (ds === today) { const n = new Date(); const y = (n.getHours() + n.getMinutes() / 60 - h0) * PX; if (y > 0 && y < (h1 - h0) * PX) col.append(h('i', { class: 'pl-now', style: { top: y + 'px' } })); }
        cols.append(col);
      }
      const allDay = cal.filter((e) => e.allDay);
      const ad = h('div', { class: 'pl-wk-allday' }, h('span'));
      for (let d = 0; d < 7; d++) { const ds = addDays(ws, d); ad.append(h('div', null, ...allDay.filter((e) => e.start < addDays(ds, 1) && e.end > ds).map((e) => withC(h('span', { class: 'pl-ad' }, e.title), e.color)))); }
      grid.append(...[head, allDay.length ? ad : null, h('div', { class: 'pl-wk-scroll' }, cols)].filter(Boolean));
      const sc = grid.querySelector('.pl-wk-scroll');
      const n = new Date();
      if (ws === weekStart(Date.now())) sc.scrollTop = Math.max(0, (n.getHours() - h0 - 1) * PX);
    };
    const off = A.on('plan', () => { if (!back.isConnected) return off && off(); draw(); });
    draw();
  };
  async function calOptions(anchor, redraw) {
    const p = plan();
    const box = h('div', { class: 'menu pl-calmenu' });
    const toggle = (label, sub, on, fn) => box.append(h('button', { class: 'pl-tg', onclick: async () => { await fn(!on); A.closePopovers(); redraw(); } }, h('span', { class: 'grow' }, h('b', null, label), sub ? h('small', null, sub) : null), h('span', { class: 'sw' + (on ? ' on' : '') })));
    if (NATIVE()) {
      toggle('Show my iPad calendars', 'Google, iCloud or Outlook calendars added to this iPad', !!p.calOn, async (v) => { if (v) await PL.connectCalendar(); else { p.calOn = false; save(); } });
      if (p.calOn) {
        toggle('Add my plan to the Calendar app', 'Classes, exams, deadlines and study blocks go to a calendar named “Axiom”', !!p.mirror, (v) => { p.mirror = v; save(); });
        const cals = await A.native.post({ op: 'calCalendars' }).catch(() => []);
        if (cals && cals.length) {
          box.append(h('hr'), h('div', { class: 'sub' }, 'Calendars shown'));
          cals.forEach((c) => {
            const shown = !(p.hiddenCals || []).includes(c.id);
            box.append(h('button', { class: 'pl-cal', onclick: () => { p.hiddenCals = shown ? (p.hiddenCals || []).concat([c.id]) : (p.hiddenCals || []).filter((x) => x !== c.id); save(); A.closePopovers(); redraw(); } },
              h('i', { class: 'dot', style: { background: c.color } }), h('span', { class: 'grow' }, c.title, h('small', null, ' ' + c.source)), shown ? A.iconEl('check') : null));
          });
        }
      }
      box.append(h('hr'));
      toggle('Reminders', 'A day and an hour before exams; before deadlines; when study blocks start', p.remind !== false, (v) => { p.remind = v; save(v); });
      toggle('Remind me before classes', '10 minutes before each class', !!p.remindClasses, (v) => { p.remindClasses = v; save(); });
    } else {
      box.append(h('p', { class: 'muted small', style: { padding: '8px 12px', margin: 0 } }, 'Your iPad calendars and reminders work in the Axiom app on iPad.'));
    }
    A.popover(box, anchor, { side: 'down' });
  }

  /* ---------- syllabus / timetable import, read by Claude ---------- */
  const SCHEMA = {
    type: 'object',
    properties: {
      course: { type: 'string', description: 'Course code and name if the document is about one course, else empty' },
      term_start: { type: 'string', description: 'YYYY-MM-DD first day of classes if stated, else empty' },
      term_end: { type: 'string', description: 'YYYY-MM-DD last day of classes if stated, else empty' },
      grading: { type: 'string', description: 'Grading weights in one short line, else empty' },
      attendance: { type: 'string', description: 'Attendance rule in one short line (minimum % or allowed absences), else empty' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['class', 'exam', 'deadline'] },
            title: { type: 'string' },
            course: { type: 'string', description: 'Course code or name this belongs to' },
            weekday: { type: 'string', enum: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], description: 'For weekly classes' },
            date: { type: 'string', description: 'YYYY-MM-DD for exams and deadlines; empty for weekly classes unless a first date is stated' },
            start: { type: 'string', description: 'HH:MM 24-hour; for deadlines the due time (23:59 if none)' },
            end: { type: 'string', description: 'HH:MM 24-hour or empty' },
            room: { type: 'string' },
            covers: { type: 'string', description: 'For exams: chapters/sections/topics covered. For deadlines: what to submit and where' },
          },
          required: ['kind', 'title', 'course', 'weekday', 'date', 'start', 'end', 'room', 'covers'],
          additionalProperties: false,
        },
      },
    },
    required: ['course', 'term_start', 'term_end', 'grading', 'attendance', 'items'],
    additionalProperties: false,
  };
  const readFileB64 = (f) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(f); });
  PL.importSyllabus = async (courseId = null) => {
    if (!S.aiKey) {
      const go = await A.dialog({ title: 'Reading a syllabus uses the tutor', body: 'Axiom sends the document to Claude to read the dates. Add your Anthropic API key in Settings › Tutor first.', okText: 'Open Settings' });
      if (go) A.UI.openSettings && A.UI.openSettings();
      return;
    }
    const f = await A.ST.pickFile('application/pdf,.pdf,image/*');
    if (!f) return;
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal wide pl-imp', role: 'dialog', 'aria-label': 'Import syllabus' }, h('h3', null, 'Reading ' + f.name.slice(0, 60)), h('p', { class: 'muted' }, h('span', { class: 'thinking' }, 'Finding classes, exams and deadlines', h('i', null, '.'), h('i', null, '.'), h('i', null, '.'))));
    back.append(box); document.body.append(back);
    const close = () => back.remove();
    let data;
    try {
      const b64 = await readFileB64(f);
      const pdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
      const doc = pdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } : { type: 'image', source: { type: 'base64', media_type: f.type || 'image/jpeg', data: b64 } };
      const Anthropic = await A.AI.sdk();
      const client = new Anthropic({ apiKey: S.aiKey, dangerouslyAllowBrowser: true });
      const today = new Date();
      const res = await client.messages.create({
        model: S.aiModel || 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: `You read university syllabi, course schedules and timetables and extract the student's schedule. Today is ${isoDate(today)} (${today.toLocaleDateString('en', { weekday: 'long' })}). Only include what the document states. Weekly lectures, recitations and labs are kind "class" with a weekday and times. Midterms, finals, quizzes with a date are "exam"; homework, projects, reports with a due date are "deadline". If a year is missing, use the academic year that contains today. Keep titles short (e.g. "Lecture", "Recitation", "Midterm 1", "Homework 3"). Courses the student might have: ${A.SU.list().map((s) => s.name).join(', ') || 'unknown'}.`,
        messages: [{ role: 'user', content: [doc, { type: 'text', text: 'Extract the schedule from this document.' }] }],
      });
      const txt = (res.content.find((c) => c.type === 'text') || {}).text || '{}';
      data = JSON.parse(txt);
    } catch (e) {
      box.innerHTML = '';
      box.append(h('h3', null, 'Couldn’t read that document'), h('p', { class: 'muted' }, String(e && e.message || e).slice(0, 300)), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Close')));
      return;
    }
    importPreview(box, close, data, courseId);
  };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchCourse = (name) => {
    const n = norm(name);
    if (!n) return null;
    const code = (String(name).match(/[A-Za-z]{2,5}\s?\d{3,4}/) || [''])[0];
    return A.SU.list().find((s) => norm(s.name) === n || (code && norm(s.name).includes(norm(code))) || (n.length > 4 && (norm(s.name).includes(n) || n.includes(norm(s.name))))) || null;
  };
  function importPreview(box, close, data, courseId) {
    const items = (data.items || []).filter((x) => x.title);
    box.innerHTML = '';
    if (!items.length) { box.append(h('h3', null, 'No dates found'), h('p', { class: 'muted' }, 'Axiom couldn’t find class times, exams or deadlines in this document.'), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Close'))); return; }
    // course mapping: one select per course name found
    const names = [...new Set(items.map((x) => x.course || data.course || '').map((x) => x.trim()))];
    const map = {};
    names.forEach((n) => { const m = (courseId && names.length === 1) ? A.SU.get(courseId) : matchCourse(n || data.course); map[n] = m ? m.id : (n ? '__new:' + n : ''); });
    const termStart = data.term_start ? at(data.term_start, '00:00') : dayStart(Date.now());
    const termEnd = data.term_end ? at(data.term_end, '23:59') : null;
    const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    const toItem = (x) => {
      let start;
      if (x.kind === 'class' && x.weekday && !x.date) {
        const d = new Date(Math.max(termStart, weekStart(Date.now()))); while (d.getDay() !== WD[x.weekday]) d.setDate(d.getDate() + 1);
        start = at(isoDate(d.getTime()), x.start || '09:00');
      } else if (x.date) start = at(x.date, x.start || (x.kind === 'deadline' ? '23:59' : '09:00'));
      else return null;
      const end = x.end ? at(isoDate(start), x.end) : start + (x.kind === 'deadline' ? 0 : x.kind === 'exam' ? 2 * HOUR : 110 * 6e4);
      return { kind: x.kind, title: x.title, start, end: Math.max(end, start), weekly: x.kind === 'class', until: x.kind === 'class' ? (termEnd || start + 15 * 7 * DAY) : undefined, room: x.room || undefined, covers: x.covers || undefined, src: 'syllabus', _course: (x.course || data.course || '').trim() };
    };
    const rows = items.map(toItem).filter(Boolean).map((it) => ({ it, on: true }));
    const list = h('div', { class: 'pl-imp-list' });
    rows.forEach((r) => {
      const ck = h('input', { type: 'checkbox', checked: true });
      ck.addEventListener('change', () => { r.on = ck.checked; });
      list.append(h('label', { class: 'pl-imp-row' }, ck,
        h('span', { class: 'pl-chip k-' + r.it.kind }, KINDS[r.it.kind].label),
        h('span', { class: 'grow' }, h('b', null, r.it.title), h('small', null, [r.it._course, r.it.weekly ? 'Every ' + new Date(r.it.start).toLocaleDateString([], { weekday: 'long' }) + ' ' + fmtTime(r.it.start) + '–' + fmtTime(r.it.end) : fmtDay(r.it.start) + ' ' + fmtTime(r.it.start), r.it.room, r.it.covers].filter(Boolean).join(' · ')))));
    });
    const maps = h('div', { class: 'pl-imp-maps' });
    names.forEach((n) => {
      const sel = h('select', { class: 'field' }, h('option', { value: '' }, 'No course'), ...A.SU.list().map((s) => h('option', { value: s.id, selected: map[n] === s.id }, s.name)), n ? h('option', { value: '__new:' + n, selected: map[n] === '__new:' + n }, 'New course: ' + n) : null);
      sel.addEventListener('change', () => { map[n] = sel.value; });
      // a new course takes the document's full name ("MATH 261 Linear Algebra") when the items only gave the code
      const full = data.course && n && norm(data.course).includes(norm(n)) ? data.course : n;
      if (full !== n) { const o = sel.querySelector(`option[value="__new:${CSS.escape(n)}"]`); if (o) { o.value = '__new:' + full; o.textContent = 'New course: ' + full; if (map[n] === '__new:' + n) { map[n] = o.value; sel.value = o.value; } } }
      maps.append(h('label', { class: 'pl-f' }, h('span', null, n ? `“${n}” goes to` : 'Course'), sel));
    });
    const extra = [data.grading ? 'Grading: ' + data.grading : '', data.attendance ? 'Attendance: ' + data.attendance : ''].filter(Boolean);
    box.append(...[h('h3', null, `Found ${rows.length} item${rows.length === 1 ? '' : 's'}`), h('p', { class: 'muted small' }, 'Check them, then add. You can edit anything later.'), maps, list,
      extra.length ? h('p', { class: 'pl-note muted small' }, extra.join(' · ')) : null,
      h('div', { class: 'row gap end pl-acts' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        const ids = {};
        Object.entries(map).forEach(([n, v]) => { if (v && v.startsWith('__new:')) { const s = A.SU.add(v.slice(6)); ids[n] = s && s.id; } else ids[n] = v || null; });
        let n = 0;
        rows.filter((r) => r.on).forEach((r) => { const it = { ...r.it, course: ids[r.it._course] || null }; delete it._course; plan().items.push(Object.assign(it, { id: A.uid() })); n++; });
        const target = ids[names[0]];
        const s = target && A.SU.get(target);
        if (s && names.length === 1) { if (data.grading) s.grading = data.grading; if (data.attendance) s.attendance = data.attendance; }
        save(true);
        close();
        A.toast(`Added ${n} item${n === 1 ? '' : 's'} to your plan`, 2000);
      } }, 'Add to my plan'))].filter(Boolean));
  }
})();
