/* Axiom core: namespace, math, color, events, DOM helpers */
'use strict';
const A = (window.A = {});

A.VERSION = '0.4';
A.uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
A.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
A.lerp = (a, b, t) => a + (b - a) * t;
A.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
A.now = () => performance.now();
A.deg = (r) => (r * 180) / Math.PI;
A.rad = (d) => (d * Math.PI) / 180;

A.debounce = (fn, ms) => {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  f.cancel = () => clearTimeout(t);
  return f;
};

/* ---------- affine matrices [a,b,c,d,e,f] (canvas convention) ---------- */
A.M = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  inv: (m) => {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  },
  apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  translate: (x, y) => [1, 0, 0, 1, x, y],
  scale: (sx, sy = sx) => [sx, 0, 0, sy, 0, 0],
  rotate: (r) => { const c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; },
  // transform about a pivot
  about: (m, px, py) => A.M.mul(A.M.translate(px, py), A.M.mul(m, A.M.translate(-px, -py))),
  det: (m) => m[0] * m[3] - m[1] * m[2],
};

/* ---------- color ---------- */
A.C = {
  hexToRgb(hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => A.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  },
  rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx ? d / mx : 0, mx];
  },
  hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  },
  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  },
  hslToRgb(h, s, l) {
    const v = l + s * Math.min(l, 1 - l);
    const sv = v ? 2 * (1 - l / v) : 0;
    return A.C.hsvToRgb(((h % 360) + 360) % 360, sv, v);
  },
  luminance(hex) {
    const [r, g, b] = A.C.hexToRgb(hex) || [0, 0, 0];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  },
  rgba(hex, a) {
    const [r, g, b] = A.C.hexToRgb(hex) || [0, 0, 0];
    return `rgba(${r},${g},${b},${a})`;
  },
};

/* ---------- events ---------- */
const _ev = {};
A.on = (n, f) => ((_ev[n] = _ev[n] || []).push(f), () => A.off(n, f));
A.off = (n, f) => { _ev[n] = (_ev[n] || []).filter((x) => x !== f); };
A.emit = (n, d) => (_ev[n] || []).slice().forEach((f) => f(d));

/* ---------- DOM ---------- */
A.$ = (s, r = document) => r.querySelector(s);
A.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
A.h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

/* one toast at a time: a new message replaces the current one instead of stacking */
A.toast = (msg, ms = 1800) => {
  const host = A.$('#toasts');
  if (!host) return;
  let t = host.querySelector('.toast');
  if (!t) {
    t = A.h('div', { class: 'toast', role: 'status' });
    host.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
  } else t.classList.add('in');
  t.textContent = msg;
  clearTimeout(t._hide); clearTimeout(t._rm);
  t._hide = setTimeout(() => { t.classList.remove('in'); t._rm = setTimeout(() => t.remove(), 300); }, ms);
};

/* in-page confirm / prompt (native dialogs are unavailable in some hosts) */
A.dialog = ({ title, body, input, okText = 'OK', cancelText = 'Cancel', danger = false }) =>
  new Promise((res) => {
    const back = A.h('div', { class: 'modal-back' });
    let inp = null;
    if (input != null) inp = A.h('input', { class: 'field', id: 'dlg-input', value: input, autocomplete: 'off' });
    const close = (v) => { back.remove(); res(v); };
    const ok = A.h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => close(inp ? inp.value : true) }, okText);
    const box = A.h('div', { class: 'modal small', role: 'dialog', 'aria-modal': 'true' },
      A.h('h3', null, title),
      body ? A.h('p', { class: 'muted' }, body) : null,
      inp,
      A.h('div', { class: 'row end gap' },
        A.h('button', { class: 'btn', onclick: () => close(inp ? null : false) }, cancelText), ok));
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(inp ? null : false); });
    document.body.append(back);
    if (inp) {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') close(null); });
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
    }
  });

/* popover anchored to an element or point; closes on outside tap */
A.popover = (content, anchor, opts = {}) => {
  A.closePopovers();
  const pop = A.h('div', { class: 'popover ' + (opts.cls || '') });
  pop.append(content);
  document.body.append(pop);
  const place = () => {
    const pr = pop.getBoundingClientRect();
    let x, y;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      const side = opts.side || 'auto';
      if (side === 'right' || (side === 'auto' && r.left < innerWidth / 2 && r.width < 120 && r.height > r.width * 0.8)) {
        x = r.right + 10; y = r.top + r.height / 2 - pr.height / 2;
      } else if (side === 'left') {
        x = r.left - pr.width - 10; y = r.top + r.height / 2 - pr.height / 2;
      } else if (side === 'up') {
        x = r.left + r.width / 2 - pr.width / 2; y = r.top - pr.height - 10;
      } else {
        x = r.left + r.width / 2 - pr.width / 2; y = r.bottom + 10;
      }
    } else if (anchor) { x = anchor.x - pr.width / 2; y = anchor.y + 12; }
    else { x = innerWidth / 2 - pr.width / 2; y = innerHeight / 2 - pr.height / 2; }
    pop.style.left = A.clamp(x, 8, innerWidth - pr.width - 8) + 'px';
    pop.style.top = A.clamp(y, 8, innerHeight - pr.height - 8) + 'px';
  };
  place();
  pop._place = place;
  const outside = (e) => {
    if (pop.contains(e.target) || (anchor && anchor.contains && anchor.contains(e.target))) return;
    close();
  };
  const close = () => {
    document.removeEventListener('pointerdown', outside, true);
    pop.remove();
    opts.onClose && opts.onClose();
  };
  pop._close = close;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  requestAnimationFrame(() => pop.classList.add('in'));
  return pop;
};
A.closePopovers = () => A.$$('.popover').forEach((p) => (p._close ? p._close() : p.remove()));

/* downloads/sharing with graceful fallbacks */
A.deliverFile = async (blob, filename, previewUrl) => {
  if (A.native) {
    const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
    await A.native.post({ op: 'share', name: filename, mime: blob.type, data });
    return true;
  }
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  try {
    const url = URL.createObjectURL(blob);
    const a = A.h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { /* ignore */ }
  // Always also show a preview the user can long-press to save
  A.showFilePreview(blob, filename, previewUrl);
  return true;
};
A.showFilePreview = (blob, filename, previewUrl) => {
  const url = previewUrl || URL.createObjectURL(blob);
  const isImg = blob.type.startsWith('image/');
  const back = A.h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const body = isImg
    ? A.h('img', { src: url, class: 'export-preview', alt: filename })
    : A.h('p', { class: 'muted' }, `${filename} is ready (${Math.round(blob.size / 1024)} KB). If no download started, use Share from a full Safari window.`);
  back.append(A.h('div', { class: 'modal', role: 'dialog' },
    A.h('h3', null, filename),
    body,
    isImg ? A.h('p', { class: 'muted small' }, 'Tip: press and hold the image to save it to Photos or copy it.') : null,
    A.h('div', { class: 'row end gap' }, A.h('button', { class: 'btn primary', onclick: close }, 'Done'))));
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
};

A.fmtDate = (t) => {
  const d = new Date(t), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};
