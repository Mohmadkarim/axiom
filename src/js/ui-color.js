/* Axiom color picker: studio swatches, HSB wheel, RGB/HSL sliders, hex, recents, palettes, eyedropper */
'use strict';
(() => {
  const B = A.B, R = A.R, h = A.h, C = A.C;
  const UI = (A.UI = A.UI || {});
  const S = A.settings;

  /* studio marker swatches: 12 hue families × 6 values, plus three gray families */
  const HUES = [355, 14, 30, 45, 58, 88, 140, 172, 198, 218, 255, 300];
  const ROWS = [[0.9, 0.62], [0.79, 0.68], [0.66, 0.7], [0.53, 0.68], [0.41, 0.62], [0.29, 0.55]];
  UI.swatches = () => {
    const out = [];
    for (const [l, s] of ROWS) for (const hh of HUES) out.push(C.rgbToHex(...C.hslToRgb(hh, s, l)));
    for (let i = 0; i < 12; i++) { const v = 255 - Math.round((i / 11) * 255); out.push(C.rgbToHex(v, v, v)); }
    for (let i = 0; i < 12; i++) out.push(C.rgbToHex(...C.hslToRgb(215, 0.14, 0.94 - i * 0.075)));
    for (let i = 0; i < 12; i++) out.push(C.rgbToHex(...C.hslToRgb(32, 0.14, 0.94 - i * 0.075)));
    return out;
  };

  if (!Array.isArray(S.palettes) || !S.palettes.length) {
    S.palettes = [
      { name: 'Ink', colors: ['#16181d', '#1f4fbf', '#c0392b', '#1e8449', '#d35400', '#7d3c98', '#5d6d7e', '#ffffff'] },
      { name: 'Lecture', colors: ['#0b3d91', '#e4572e', '#29a35a', '#f2c94c', '#17bebb', '#8e44ad', '#2d3436', '#b2bec3'] },
      { name: 'Soft', colors: ['#f6c1c1', '#f8dcae', '#fdf3b0', '#c9ecc6', '#bfe3ef', '#c9cdf4', '#e6c9f2', '#e9e9ee'] },
    ];
  }
  UI.activePaletteColors = () => (S.palettes[S.activePalette] || S.palettes[0] || { colors: [] }).colors;
  UI.pushRecent = (c) => {
    c = c.toLowerCase();
    S.recentColors = [c].concat((S.recentColors || []).filter((x) => x !== c)).slice(0, 14);
    A.saveSettings();
  };

  let lastTab = 'swatches';
  UI.openColor = (anchor) => {
    const slot = B.slot();
    const original = slot.color;
    let [hh, ss, vv] = C.rgbToHsv(...(C.hexToRgb(original) || [0, 0, 0]));
    const box = h('div', { class: 'color-pop' });
    const cmpNew = h('span'), cmpOld = h('span', { style: { background: original }, title: 'Previous color' });
    cmpOld.addEventListener('click', () => setHex(original));
    const hex = h('input', { class: 'field', id: 'color-hex', value: original.toUpperCase(), maxlength: 7, autocomplete: 'off', 'aria-label': 'Hex color' });
    const eyed = h('button', { class: 'ibtn', title: 'Eyedropper', 'aria-label': 'Eyedropper', html: A.icon('eyedrop') });
    eyed.addEventListener('click', () => {
      A.closePopovers();
      A.IN.eyedrop = true;
      A.toast('Touch the canvas to pick a color');
    });
    box.append(h('div', { class: 'color-head' }, h('div', { class: 'color-cmp' }, cmpOld, cmpNew), hex, eyed));

    const tabs = h('div', { class: 'tabs' });
    const seg = h('div', { class: 'seg' });
    const body = h('div');
    const TABS = [['swatches', 'Swatches'], ['wheel', 'Wheel'], ['sliders', 'Sliders']];
    TABS.forEach(([id, l]) => seg.append(h('button', { class: id === lastTab ? 'on' : '', onclick: () => { lastTab = id; [...seg.children].forEach((b, i) => b.classList.toggle('on', TABS[i][0] === id)); show(); } }, l)));
    tabs.append(seg);
    box.append(tabs, body);
    const extra = h('div');
    box.append(extra);

    const current = () => C.rgbToHex(...C.hsvToRgb(hh, ss, vv));
    let commitT;
    const apply = (live = true) => {
      const c = current();
      cmpNew.style.background = c;
      if (document.activeElement !== hex) hex.value = c.toUpperCase();
      B.slot().color = c;
      R.renderOverlay();
      clearTimeout(commitT);
      commitT = setTimeout(() => { A.saveSettings(); A.emit('slot'); }, live ? 350 : 0);
      if (onSync) onSync();
    };
    let onSync = null;
    const setHex = (c) => {
      const rgb = C.hexToRgb(c);
      if (!rgb) return;
      [hh, ss, vv] = C.rgbToHsv(...rgb);
      apply(false);
      show(true);
    };

    hex.addEventListener('input', () => { const v = hex.value.trim(); if (C.hexToRgb(v)) { const rgb = C.hexToRgb(v); [hh, ss, vv] = C.rgbToHsv(...rgb); apply(); show(true); } });

    /* ---- swatches ---- */
    const renderSwatches = () => {
      const g = h('div', { class: 'swatch-grid' });
      const cur = current().toLowerCase();
      UI.swatches().forEach((c) => g.append(h('button', { class: c === cur ? 'on' : '', style: { background: c }, 'aria-label': c, onclick: () => { setHex(c); UI.pushRecent(c); } })));
      return g;
    };
    /* ---- HSB wheel ---- */
    const renderWheel = () => {
      const wrap = h('div', { class: 'hsb-wrap' });
      const cv = h('canvas'), ov = h('canvas');
      wrap.append(cv, ov);
      const SZ = 248, dpr = A.dpr || 2;
      [cv, ov].forEach((c) => { c.width = SZ * dpr; c.height = SZ * dpr; });
      const R0 = 102, R1 = 124, SQ = 136;
      const ctx = cv.getContext('2d'), octx = ov.getContext('2d');
      const drawBase = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SZ, SZ);
        for (let a = 0; a < 360; a += 1) {
          ctx.beginPath();
          ctx.arc(SZ / 2, SZ / 2, (R0 + R1) / 2, A.rad(a - 90.6), A.rad(a - 89.2));
          ctx.strokeStyle = `hsl(${a},100%,50%)`; ctx.lineWidth = R1 - R0; ctx.stroke();
        }
        const x0 = SZ / 2 - SQ / 2, y0 = SZ / 2 - SQ / 2;
        ctx.fillStyle = C.rgbToHex(...C.hsvToRgb(hh, 1, 1));
        ctx.fillRect(x0, y0, SQ, SQ);
        let g = ctx.createLinearGradient(x0, 0, x0 + SQ, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x0, y0, SQ, SQ);
        g = ctx.createLinearGradient(0, y0, 0, y0 + SQ); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
        ctx.fillStyle = g; ctx.fillRect(x0, y0, SQ, SQ);
      };
      const drawMarks = () => {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, SZ, SZ);
        const a = A.rad(hh - 90), rm = (R0 + R1) / 2;
        const mark = (x, y, fill) => { octx.beginPath(); octx.arc(x, y, 9, 0, Math.PI * 2); octx.fillStyle = fill; octx.fill(); octx.lineWidth = 3; octx.strokeStyle = '#fff'; octx.stroke(); octx.lineWidth = 1; octx.strokeStyle = 'rgba(0,0,0,.3)'; octx.stroke(); };
        mark(SZ / 2 + Math.cos(a) * rm, SZ / 2 + Math.sin(a) * rm, C.rgbToHex(...C.hsvToRgb(hh, 1, 1)));
        mark(SZ / 2 - SQ / 2 + ss * SQ, SZ / 2 - SQ / 2 + (1 - vv) * SQ, current());
      };
      drawBase(); drawMarks();
      let mode = null;
      const handle = (e) => {
        const r = wrap.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * SZ, y = ((e.clientY - r.top) / r.height) * SZ;
        const dx = x - SZ / 2, dy = y - SZ / 2, d = Math.hypot(dx, dy);
        if (!mode) mode = d > R0 - 8 ? 'hue' : 'sv';
        if (mode === 'hue') { hh = (A.deg(Math.atan2(dy, dx)) + 90 + 360) % 360; drawBase(); }
        else { ss = A.clamp((x - (SZ / 2 - SQ / 2)) / SQ, 0, 1); vv = A.clamp(1 - (y - (SZ / 2 - SQ / 2)) / SQ, 0, 1); }
        drawMarks(); apply();
      };
      wrap.addEventListener('pointerdown', (e) => { e.preventDefault(); mode = null; wrap.setPointerCapture(e.pointerId); handle(e); });
      wrap.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure > 0) handle(e); });
      wrap.addEventListener('pointerup', () => { mode = null; UI.pushRecent(current()); });
      return wrap;
    };
    /* ---- sliders ---- */
    const renderSliders = () => {
      const wrap = h('div');
      const rows = [];
      const mk = (lab, max, get, set, grad) => {
        const rg = h('input', { type: 'range', class: 'chan', min: 0, max, step: 1, id: 'chan-' + lab });
        const nm = h('input', { type: 'number', min: 0, max, id: 'num-' + lab });
        const row = h('div', { class: 'slider-row' }, h('label', null, lab), rg, nm);
        const sync = () => { const v = Math.round(get()); rg.value = v; nm.value = v; rg.style.background = grad(); };
        const on = (v) => { set(A.clamp(+v || 0, 0, max)); apply(); rows.forEach((r) => r()); };
        rg.addEventListener('input', () => on(rg.value));
        nm.addEventListener('change', () => on(nm.value));
        rows.push(sync);
        wrap.append(row);
      };
      const rgb = () => C.hsvToRgb(hh, ss, vv);
      const setRgb = (i, v) => { const c = rgb(); c[i] = v; [hh, ss, vv] = C.rgbToHsv(...c); };
      const gradRgb = (i) => () => { const a = rgb().map(Math.round), b = a.slice(); a[i] = 0; b[i] = 255; return `linear-gradient(90deg, rgb(${a}), rgb(${b}))`; };
      mk('R', 255, () => rgb()[0], (v) => setRgb(0, v), gradRgb(0));
      mk('G', 255, () => rgb()[1], (v) => setRgb(1, v), gradRgb(1));
      mk('B', 255, () => rgb()[2], (v) => setRgb(2, v), gradRgb(2));
      const hsl = () => C.rgbToHsl(...rgb());
      const setHsl = (i, v) => { const c = hsl(); c[i] = i === 0 ? v : v / 100; [hh, ss, vv] = C.rgbToHsv(...C.hslToRgb(...c)); if (i === 0) hh = v; };
      mk('H', 359, () => hh, (v) => setHsl(0, v), () => 'linear-gradient(90deg,' + [0, 60, 120, 180, 240, 300, 360].map((x) => `hsl(${x},90%,50%)`).join(',') + ')');
      mk('S', 100, () => hsl()[1] * 100, (v) => setHsl(1, v), () => { const [H, , L] = hsl(); return `linear-gradient(90deg,hsl(${H},0%,${L * 100}%),hsl(${H},100%,${L * 100}%))`; });
      mk('L', 100, () => hsl()[2] * 100, (v) => setHsl(2, v), () => { const [H, Sx] = hsl(); return `linear-gradient(90deg,#000,hsl(${H},${Sx * 100}%,50%),#fff)`; });
      rows.forEach((r) => r());
      onSync = () => rows.forEach((r) => r());
      return wrap;
    };

    /* ---- recents + palettes ---- */
    const renderExtra = () => {
      extra.innerHTML = '';
      const rec = S.recentColors || [];
      if (rec.length) {
        extra.append(h('h4', { style: { marginTop: '14px' } }, 'Recent'));
        const row = h('div', { class: 'color-row' });
        rec.forEach((c) => row.append(h('button', { class: 'c', style: { background: c }, 'aria-label': c, onclick: () => setHex(c) })));
        extra.append(row);
      }
      extra.append(h('h4', { style: { marginTop: '14px' } }, 'Palettes'));
      S.palettes.forEach((p, pi) => {
        const name = h('div', { class: 'pal-name' + (pi === S.activePalette ? ' on' : '') },
          h('button', { onclick: () => { S.activePalette = pi; A.saveSettings(); A.emit('palette'); renderExtra(); } }, p.name + (pi === S.activePalette ? ' · on toolbar' : '')),
          h('button', { class: 'ibtn', style: { width: '30px', height: '30px' }, 'aria-label': 'Delete palette', html: A.icon('close'), onclick: async () => {
            const ok = await A.dialog({ title: `Delete “${p.name}”?`, body: 'This removes the palette and its colors.', okText: 'Delete', danger: true });
            if (!ok) return;
            S.palettes.splice(pi, 1); S.activePalette = 0; A.saveSettings(); A.emit('palette'); renderExtra();
          } }));
        const row = h('div', { class: 'color-row' });
        p.colors.forEach((c, ci) => {
          const b = h('button', { class: 'c', style: { background: c }, 'aria-label': c, title: 'Tap to use · hold to remove' });
          let lp;
          b.addEventListener('pointerdown', () => { lp = setTimeout(() => { lp = null; p.colors.splice(ci, 1); A.saveSettings(); A.emit('palette'); renderExtra(); }, 550); });
          b.addEventListener('pointerup', () => { if (lp) { clearTimeout(lp); setHex(c); } });
          b.addEventListener('pointerleave', () => lp && clearTimeout(lp));
          row.append(b);
        });
        if (p.colors.length < 8) row.append(h('button', { class: 'add', title: 'Add current color', 'aria-label': 'Add current color', html: A.icon('plus'), onclick: () => { p.colors.push(current()); A.saveSettings(); A.emit('palette'); renderExtra(); } }));
        extra.append(name, row);
      });
      extra.append(h('button', { class: 'btn', style: { marginTop: '10px', width: '100%', justifyContent: 'center' }, onclick: async () => {
        const n = await A.dialog({ title: 'New palette', input: 'Palette ' + (S.palettes.length + 1), okText: 'Create' });
        if (!n) return;
        S.palettes.push({ name: n, colors: [current()] }); S.activePalette = S.palettes.length - 1; A.saveSettings(); A.emit('palette'); renderExtra();
      } }, 'New palette'));
    };

    const show = (keep) => {
      if (keep && lastTab === 'sliders' && onSync) { onSync(); return; }
      body.innerHTML = '';
      onSync = null;
      body.append(lastTab === 'swatches' ? renderSwatches() : lastTab === 'wheel' ? renderWheel() : renderSliders());
    };
    cmpNew.style.background = original;
    show();
    renderExtra();
    const pop = A.popover(box, anchor, { side: S.toolSide === 'right' ? 'left' : 'right', onClose: () => { clearTimeout(commitT); if (B.slot().color !== original) UI.pushRecent(B.slot().color); A.saveSettings(); A.emit('slot'); } });
    return pop;
  };
})();
