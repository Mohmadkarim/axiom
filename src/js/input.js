/* Axiom input: pointer routing, Apple Pencil, gestures, and tool actions */
'use strict';
(() => {
  const G = A.G, B = A.B, D = A.D, R = A.R, M = A.M, GU = A.GU;
  const IN = (A.IN = {});
  const hyp = Math.hypot;

  const pointers = new Map();
  let action = null;
  let penSeen = false;
  let touchSession = null;
  let spaceDown = false;
  let lastCenterTap = 0;
  IN.hover = null;
  IN.eyedrop = false;
  IN.selMode = 'lasso';      // lasso | picker
  IN.selPartial = false;
  IN.selLayerOnly = false;
  IN.scaleMode = 'scale';    // scale | stretch | off
  IN.allowSelRotate = true;

  /* ---------- selection model ---------- */
  const SEL = (A.SEL = {
    get ids() { return R.sel; },
    set(ids) {
      R.sel = new Set(ids);
      R.fadeOthers = R.sel.size > 0;
      SEL.box = SEL.computeBox();
      R.render();
      A.emit('selection');
    },
    clear() { if (!R.sel.size) return; SEL.set([]); },
    items() {
      const out = [];
      for (const l of D.doc.layers) for (const it of l.items) if (R.sel.has(it.id)) out.push({ it, layer: l });
      return out;
    },
    computeBox() {
      let bb = null;
      for (const { it } of SEL.items()) bb = G.bbUnion(bb, B.isBox(it) ? B.imageBB(it) : G.bbox(it.pts, it.t === 's' ? Math.min(it.w * (it.mm || 1) / 2, 40) : 0));
      return bb;
    },
    box: null,
  });
  A.on('selection:clear', () => { R.sel = new Set(); R.fadeOthers = false; SEL.box = null; R.selPreview = null; A.emit('selection'); });

  /* corners of the (possibly previewed) selection box in screen space */
  SEL.screenCorners = () => {
    const bb = SEL.box;
    if (!bb) return null;
    const pad = 8 / D.doc.view.zoom;
    const T = R.selPreview || M.id();
    return [[bb[0] - pad, bb[1] - pad], [bb[2] + pad, bb[1] - pad], [bb[2] + pad, bb[3] + pad], [bb[0] - pad, bb[3] + pad]]
      .map(([x, y]) => M.apply(T, x, y)).map(([x, y]) => R.toScreen(x, y));
  };
  /* the rotation knob sits above the selection, or below it when the top runs under the toolbar */
  SEL.rotHandle = (c) => {
    let top = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
    const ctr = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
    let dx = top[0] - ctr[0], dy = top[1] - ctr[1], L = hyp(dx, dy) || 1;
    let rh = [top[0] + (dx / L) * 30, top[1] + (dy / L) * 30];
    if (rh[1] < 78) { top = [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2]; dx = top[0] - ctr[0]; dy = top[1] - ctr[1]; L = hyp(dx, dy) || 1; rh = [top[0] + (dx / L) * 30, top[1] + (dy / L) * 30]; }
    return { top, rh };
  };
  SEL.hit = (sx, sy) => {
    const c = SEL.screenCorners();
    if (!c) return null;
    for (let i = 0; i < 4; i++) if (hyp(c[i][0] - sx, c[i][1] - sy) < 24) return { kind: 'corner', i };
    const { top, rh } = SEL.rotHandle(c);
    if (IN.allowSelRotate && hyp(rh[0] - sx, rh[1] - sy) < 22) return { kind: 'rotate', rh };
    if (G.pointInPoly(sx, sy, c.flat())) return { kind: 'move' };
    return null;
  };

  /* ---------- helpers ---------- */
  const rectOf = () => R.overlay.getBoundingClientRect();
  const sampleOf = (e, rect) => {
    let tilt = 0;
    if (e.pointerType === 'pen') {
      if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0) tilt = 1 - e.altitudeAngle / (Math.PI / 2);
      else if (e.tiltX || e.tiltY) {
        const tx = Math.tan(A.rad(e.tiltX || 0)), ty = Math.tan(A.rad(e.tiltY || 0));
        tilt = Math.atan(Math.sqrt(tx * tx + ty * ty)) / (Math.PI / 2);
      }
    }
    const [px, py] = IN.penXY(e);
    return { x: px - rect.left, y: py - rect.top, p: e.pressure, tilt, t: e.timeStamp || performance.now(), type: e.pointerType };
  };
  /* WebKit can hand the same Pencil samples over twice (overlapping coalesced lists) or slightly out of order;
     replaying them makes the line jump back each frame: doubled tracks on fast strokes and loops at the ends */
  IN.freshFilter = () => {
    const seen = [];
    return (t, x, y) => {
      const k = t + ':' + x + ':' + y;
      if (seen.includes(k)) return false;
      seen.push(k); if (seen.length > 128) seen.shift();
      return true;
    };
  };
  const fresh = new Map();
  const samplesOf = (e, rect) => {
    const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    let f = fresh.get(e.pointerId);
    if (!f) { f = IN.freshFilter(); fresh.set(e.pointerId, f); }
    const out = (list.length ? list : [e]).filter((ev) => f(ev.timeStamp || 0, ev.clientX, ev.clientY)).map((ev) => sampleOf(ev, rect));
    return out.length ? out : [sampleOf(e, rect)];
  };
  const targetLayers = (activeOnly) => D.doc.layers.filter((l) => l.visible && !l.locked && (!activeOnly || l.id === D.doc.activeLayerId));
  const pickItem = (wx, wy, tolW) => {
    const L = D.doc.layers;
    for (let li = L.length - 1; li >= 0; li--) {
      const l = L[li];
      if (!l.visible || l.locked || (IN.selLayerOnly && l.id !== D.doc.activeLayerId)) continue;
      for (let i = l.items.length - 1; i >= 0; i--) {
        const it = l.items[i];
        if (B.isBox(it) ? B.imageHit(it, wx, wy) : (!B.catalog[it.b].mask && G.strokeHitCircle(it, wx, wy, tolW))) return it;
      }
    }
    return null;
  };
  IN.pickItem = pickItem;

  /* ================= actions ================= */

  /* ---- drawing ---- */
  class DrawAction {
    constructor(rec, s, opts) {
      this.rec = rec; this.opts = opts;
      this.slot = Object.assign({}, B.slot());
      this.cat = B.catalog[this.slot.b];
      this.zoom = D.doc.view.zoom;
      this.guide = GU.active();
      this.pts = [];
      this.raw = [];
      this.hasPressure = s.type === 'pen';
      this.lastS = null;
      this.pm = null;
      this.vel = 0;
      this.shape = null;
      this.hold = { x: s.x, y: s.y, t: s.t };
      this.lengthScreen = 0;
      this.t0 = performance.now(); this.holdAt = this.t0;
      this.nSamples = 0; this.coalesced = false; this.tFirst = s.t; this.tLast = s.t;
      if (this.guide) this.gctx = GU.begin(this.guide, ...R.toWorld(s.x, s.y));
      this.add(s);
      this.armHold();
      IN.liveDraw = this;
    }
    armHold() {
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => this.onHold(), A.settings.holdTime || 500);
    }
    onHold() {
      if (this.done || this.shape) return;
      if (this.lengthScreen < 5 && A.settings.tapHoldSelect && this.rec.type !== 'touch' && !D.isNotebook()) {
        // Concepts-style tap+hold: switch to lasso selection
        this.done = true;
        IN.liveDraw = null;
        action = new LassoAction(this.rec, this.lastS, { temp: true });
        action.owner = this.rec.id;
        R.renderOverlay();
        return;
      }
      if (!D.doc.precision.recog || this.guide || this.cat.mask) return;
      const need = Math.max(700, (A.settings.holdTime || 500) + 200);
      const still = performance.now() - (this.holdAt || this.t0);
      if (still < need) { clearTimeout(this.holdTimer); this.holdTimer = setTimeout(() => this.onHold(), need - still); return; }
      const bb = G.bbox(this.pts), z = D.doc.view.zoom;
      if (this.lengthScreen < 70 || Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) * z < 45) return; // handwriting-sized: leave it alone
      const r = G.recognize(this.pts);
      if (r) {
        this.shape = r;
        const [hx, hy] = R.toWorld(this.lastS.x, this.lastS.y);
        this.shapeHold = [hx, hy];
        if (r.kind === 'line' || r.kind === 'arc' || r.kind === 'polyline') this.shapePivot = [r.pts[0], r.pts[1]];
        else { const bb = G.bbox(r.pts); this.shapePivot = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]; }
        this.shapeM = M.id();
        R.renderOverlay();
      }
    }
    pressureOf(s) {
      if (this.hasPressure && s.p > 0) return s.p;
      // simulate pressure from velocity (finger/mouse)
      if (this.lastS) {
        const dt = Math.max(1, s.t - this.lastS.t), v = hyp(s.x - this.lastS.x, s.y - this.lastS.y) / dt;
        this.vel = this.vel * 0.7 + v * 0.3;
      }
      return A.clamp(1.1 - this.vel * 0.42, 0.32, 1);
    }
    add(s) {
      if (this.lastS) this.lengthScreen += hyp(s.x - this.lastS.x, s.y - this.lastS.y);
      let [wx, wy] = R.toWorld(s.x, s.y);
      if (this.guide) [wx, wy] = GU.project(this.guide, wx, wy, this.gctx);
      const p = this.pressureOf(s);
      let m = B.widthMul(this.slot.b, p, s.tilt, this.hasPressure);
      this.pm = this.pm == null ? m : this.pm + (m - this.pm) * (this.hasPressure ? 0.55 : 0.3);
      m = this.pm;
      this.raw.push(wx, wy, m);
      // keep the real pen positions (no lagging filter): smoothing happens symmetrically in finalPts,
      // so the ink stays exactly under the Pencil and the stroke never drifts off the path
      const n = this.pts.length;
      if (!n || this.guide) { this.pts.push(wx, wy, m); }
      else {
        const lx = this.pts[n - 3], ly = this.pts[n - 2];
        if (hyp(wx - lx, wy - ly) * this.zoom > 0.6) this.pts.push(wx, wy, m);
        else { this.pts[n - 3] = wx; this.pts[n - 2] = wy; this.pts[n - 1] = Math.max(this.pts[n - 1], m); }
      }
      this.lastS = s;
    }
    move(e, rect) {
      const ss = samplesOf(e, rect);
      this.nSamples += ss.length; if (ss.length > 1) this.coalesced = true; this.tLast = ss[ss.length - 1].t;
      if (this.shape) {
        const s = ss[ss.length - 1];
        const [x, y] = R.toWorld(s.x, s.y);
        const [px, py] = this.shapePivot, [hx, hy] = this.shapeHold;
        const a0 = Math.atan2(hy - py, hx - px), a1 = Math.atan2(y - py, x - px);
        const d0 = hyp(hx - px, hy - py) || 1, d1 = hyp(x - px, y - py);
        const sc = d1 / d0;
        if (hyp(x - hx, y - hy) * this.zoom > 3) this.shapeM = M.about(M.mul(M.rotate(a1 - a0), M.scale(sc)), px, py);
        this.lastS = s;
        R.renderOverlay();
        return;
      }
      for (const s of ss) this.add(s);
      const s = ss[ss.length - 1];
      if (hyp(s.x - this.hold.x, s.y - this.hold.y) > 3) { this.hold = { x: s.x, y: s.y, t: s.t }; this.holdAt = performance.now(); this.armHold(); }
      // predicted samples for lower perceived latency
      this.predicted = null;
      if (e.getPredictedEvents) {
        const pe = e.getPredictedEvents();
        if (pe && pe.length) {
          const last = pe[pe.length - 1];
          if (hyp(last.clientX - rect.left - s.x, last.clientY - rect.top - s.y) > 24) { R.renderOverlay(); return; }
          let [wx, wy] = R.toWorld(last.clientX - rect.left, last.clientY - rect.top);
          if (this.guide) [wx, wy] = GU.project(this.guide, wx, wy, this.gctx);
          this.predicted = [wx, wy, this.pm];
        }
      }
      R.renderOverlay();
    }
    /* turn live points into final points (snap/align/straight/shape) */
    finalPts(live = false) {
      const doc = D.doc;
      let pts = this.guide ? this.pts.slice() : IN.smoothStroke(this.pts, this.slot.smoothing);
      if (live && this.predicted) pts = pts.concat(this.predicted);
      let sharp = false, closed = false;
      if (this.shape) {
        const T = this.shapeM;
        const sp = this.shape.pts.slice();
        for (let i = 0; i < sp.length; i += 3) { const [x, y] = M.apply(T, sp[i], sp[i + 1]); sp[i] = x; sp[i + 1] = y; }
        return { pts: sp, sharp: !!this.shape.sharp, closed: this.shape.closed };
      }
      const np = G.count(pts);
      const avgm = () => { let s = 0; for (let i = 2; i < pts.length; i += 3) s += pts[i]; return s / Math.max(1, np); };
      const g = doc.paper.grid;
      if (!this.guide && np >= 2 && doc.precision.snap && doc.precision.grid && g.type !== 'none') {
        const m = avgm();
        let a = [pts[0], pts[1]], b = [pts[pts.length - 3], pts[pts.length - 2]];
        if (doc.precision.snapMode === 'grid') {
          const sp = g.type === 'graph' || g.type === 'eng' ? g.spacing / Math.max(1, g.divisions) * (this.zoom * g.spacing / Math.max(1, g.divisions) < 10 ? Math.max(1, g.divisions) : 1) : g.spacing;
          a = G.snapLattice(g.type, sp, a[0], a[1]); b = G.snapLattice(g.type, sp, b[0], b[1]);
        } else {
          const ang = G.alignDir(g.type, Math.atan2(b[1] - a[1], b[0] - a[0]));
          const L = (b[0] - a[0]) * Math.cos(ang) + (b[1] - a[1]) * Math.sin(ang);
          b = [a[0] + Math.cos(ang) * L, a[1] + Math.sin(ang) * L];
        }
        pts = [a[0], a[1], m, b[0], b[1], m];
        sharp = true;
      } else if (!this.guide && this.slot.smoothing >= 0.97 && np >= 2) {
        const m = avgm();
        pts = [pts[0], pts[1], m, pts[pts.length - 3], pts[pts.length - 2], m];
        sharp = true;
      } else if (!live && !this.guide && np > 2) {
        if (this.slot.smoothing > 0.12) pts = G.chaikin(pts, 1);
        pts = G.simplify(pts, 0.1 / this.zoom, 0.025);
      }
      // connect endpoints to nearby stroke ends
      if (!live && doc.precision.snap && doc.precision.connect && G.count(pts) >= 2) {
        const tol = 14 / this.zoom;
        const ends = [];
        for (const it of D.active().items) if (it.t === 's' && !B.catalog[it.b].mask && it.pts.length >= 6) {
          ends.push([it.pts[0], it.pts[1]], [it.pts[it.pts.length - 3], it.pts[it.pts.length - 2]]);
        }
        const fix = (i) => {
          let best = null, bd = tol;
          for (const e of ends) { const d = hyp(e[0] - pts[i], e[1] - pts[i + 1]); if (d < bd) { bd = d; best = e; } }
          if (best) { pts[i] = best[0]; pts[i + 1] = best[1]; }
        };
        fix(0); fix(pts.length - 3);
      }
      return { pts, sharp, closed };
    }
    liveItem() {
      const { pts, sharp, closed } = this.finalPts(true);
      const cat = this.cat;
      if (cat.mask) {
        return { t: 's', b: cat.soft ? 'airbrush' : 'pen', c: R.displayBg(), raw: true, w: this.slot.size, o: 0.92, pts, sharp, closed };
      }
      return { t: 's', b: this.slot.b, c: this.slot.color, w: this.slot.size, o: this.slot.opacity, pts, sharp, closed, live: true };
    }
    up(e, rect) {
      if (this.done) return;
      this.done = true;
      clearTimeout(this.holdTimer);
      IN.liveDraw = null;
      if (e && !this.shape) for (const s of samplesOf(e, rect)) this.add(s);
      const { pts, sharp, closed } = this.finalPts(false);
      const dur = (this.tLast - this.tFirst) / 1000;
      if (dur > 0.3 && this.rec.type === 'pen') IN.inputStats = { rate: Math.round(this.nSamples / dur), coalesced: this.coalesced };
      R.renderOverlay();
      if (this.cat.kind === 'fill' && G.count(pts) < 3) return;
      const layer = D.targetLayerFor(this.slot.b);
      if (layer.locked) { A.toast('This layer is locked'); return; }
      if (!layer.visible) { A.toast('This layer is hidden'); }
      const extra = {};
      if (sharp) extra.sharp = true;
      if (closed) extra.closed = true;
      const stamp = IN.stamp && IN.stamp();
      if (stamp) Object.assign(extra, stamp);
      const item = D.makeStroke(this.slot.b, this.slot.color, this.slot.size, this.slot.opacity, pts, extra);
      D.begin();
      D.addItems([item], layer);
      D.commit();
      R.appendItem(item, layer);
      R.renderOverlayNow();
      if (D.doc.precision.measure && G.count(pts) >= 2 && !this.cat.mask) {
        IN.lastMeasure = { item, until: performance.now() + 2200 };
        setTimeout(() => R.renderOverlay(), 2300);
      }
      A.emit('layers:thumbs');
    }
    cancel() { this.done = true; clearTimeout(this.holdTimer); IN.liveDraw = null; R.renderOverlay(); }
  }

  /* ---- slice eraser / stroke eraser ---- */
  class EraseAction {
    constructor(rec, s, kind) {
      this.kind = kind; this.rec = rec;
      this.slot = B.slot();
      this.changed = false;
      D.begin();
      this.last = R.toWorld(s.x, s.y);
      IN.cursor = { x: s.x, y: s.y, r: this.radiusScreen() };
      this.apply(this.last, this.last);
    }
    radiusScreen() { return Math.max(this.kind === 'slice' ? 2 : 4, (this.slot.size / 2) * D.doc.view.zoom); }
    apply(a, b) {
      const zoom = D.doc.view.zoom;
      const r = Math.max(this.kind === 'slice' ? 1.2 / zoom : 3 / zoom, this.slot.size / 2);
      const seg = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r];
      const map = new Map();
      const remove = [];
      for (const l of targetLayers(false)) {
        for (const it of l.items) {
          if (it.t !== 's' || !G.bbHit(it.bb, seg)) continue;
          if (!G.strokeHitSeg(it, a[0], a[1], b[0], b[1], r)) continue;
          if (this.kind === 'eraser') { remove.push(it.id); continue; }
          // slice: cut along the segment
          const half = (it.w * (it.mm || 1)) / 2;
          const cutR = r + (B.catalog[it.b].kind === 'fill' ? 0 : half * 0.5);
          let pieces = [it.pts];
          const d = hyp(b[0] - a[0], b[1] - a[1]);
          const steps = Math.max(1, Math.ceil(d / Math.max(cutR * 0.5, 0.3)));
          for (let k = 0; k <= steps; k++) {
            const t = k / steps, cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t;
            const next = [];
            for (const p of pieces) {
              const res = G.slice(p, cx, cy, cutR, Math.max(cutR * 0.4, 0.25));
              if (res) next.push(...res); else next.push(p);
            }
            pieces = next;
          }
          map.set(it.id, pieces.filter((p) => p.length >= 6).map((p) => D.withPts(it, p)));
        }
      }
      if (remove.length) { D.removeIds(remove); this.changed = true; }
      if (map.size) { D.replace(map); this.changed = true; }
      if (remove.length || map.size) R.render();
    }
    move(e, rect) {
      for (const s of samplesOf(e, rect)) {
        const w = R.toWorld(s.x, s.y);
        this.apply(this.last, w);
        this.last = w;
        IN.cursor = { x: s.x, y: s.y, r: this.radiusScreen() };
      }
      R.renderOverlay();
    }
    up() {
      IN.cursor = null;
      if (this.changed) { D.commit(); A.emit('layers:thumbs'); }
      else D.history.pending = null;
      R.renderOverlay();
    }
    cancel() { this.up(); }
  }

  /* ---- nudge ---- */
  class NudgeAction {
    constructor(rec, s) {
      this.rec = rec;
      this.slot = B.slot();
      this.last = R.toWorld(s.x, s.y);
      this.done = new Set();
      this.changed = false;
      D.begin();
      IN.cursor = { x: s.x, y: s.y, r: this.slot.size, nudge: true };
    }
    move(e, rect) {
      const s = samplesOf(e, rect).pop();
      const w = R.toWorld(s.x, s.y);
      const dx = w[0] - this.last[0], dy = w[1] - this.last[1];
      const Rw = this.slot.size / D.doc.view.zoom;
      const l = D.active();
      if (l.locked) { A.toast('This layer is locked'); return; }
      const box = [this.last[0] - Rw, this.last[1] - Rw, this.last[0] + Rw, this.last[1] + Rw];
      const map = new Map();
      for (const it of l.items) {
        if (it.t !== 's' || !G.bbHit(it.bb, box)) continue;
        let pts = this.done.has(it.id) ? it.pts.slice() : G.resample(it.pts, Math.max(Rw / 10, 0.5));
        let moved = false;
        for (let i = 0; i < pts.length; i += 3) {
          const d = hyp(pts[i] - this.last[0], pts[i + 1] - this.last[1]);
          if (d < Rw) { const f = (1 - d / Rw) ** 2; pts[i] += dx * f; pts[i + 1] += dy * f; moved = true; }
        }
        if (moved) { const n = D.withPts(it, pts); this.done.add(n.id); map.set(it.id, [n]); }
      }
      if (map.size) { D.replace(map); this.changed = true; R.render(); }
      this.last = w;
      IN.cursor = { x: s.x, y: s.y, r: this.slot.size, nudge: true };
      R.renderOverlay();
    }
    up() { IN.cursor = null; if (this.changed) { D.commit(); A.emit('layers:thumbs'); } else D.history.pending = null; R.renderOverlay(); }
    cancel() { this.up(); }
  }

  /* ---- lasso / item picker ---- */
  class LassoAction {
    constructor(rec, s, opts = {}) {
      this.rec = rec; this.opts = opts;
      this.poly = [];
      this.start = { x: s.x, y: s.y };
      this.moved = 0;
      this.mode = opts.forceLasso ? 'lasso' : IN.selMode;
      if (this.mode === 'lasso') this.poly.push(...R.toWorld(s.x, s.y));
      IN.lasso = this;
      A.emit('selmenu:show');
    }
    move(e, rect) {
      for (const s of samplesOf(e, rect)) {
        this.moved = Math.max(this.moved, hyp(s.x - this.start.x, s.y - this.start.y));
        if (this.mode === 'lasso') this.poly.push(...R.toWorld(s.x, s.y));
        this.cur = { x: s.x, y: s.y };
      }
      R.renderOverlay();
    }
    up(e, rect) {
      IN.lasso = null;
      const zoom = D.doc.view.zoom;
      const end = this.cur || this.start;
      if (this.mode === 'picker' || this.moved < 8 || this.poly.length < 8) {
        const [wx, wy] = R.toWorld(end.x, end.y);
        const it = pickItem(wx, wy, 10 / zoom);
        if (it) {
          const ids = new Set(R.sel);
          if (ids.has(it.id)) ids.delete(it.id); else ids.add(it.id);
          SEL.set(ids);
        } else if (this.mode === 'lasso' || this.moved < 8) SEL.clear();
        R.renderOverlay();
        return;
      }
      const poly = [];
      for (let i = 0; i < this.poly.length; i += 2) poly.push(this.poly[i], this.poly[i + 1]);
      const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
      const pbb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const found = [];
      for (const l of targetLayers(IN.selLayerOnly)) {
        for (const it of l.items) {
          if (!G.bbHit(it.bb, pbb)) continue;
          if (B.isBox(it)) {
            const cs = B.imageCorners(it);
            const inside = cs.filter(([x, y]) => G.pointInPoly(x, y, poly)).length;
            if (IN.selPartial ? inside > 0 : inside === 4) found.push(it.id);
            continue;
          }
          if (B.catalog[it.b].mask) continue;
          const p = it.pts, n = G.count(p), step = Math.max(1, Math.floor(n / 40));
          let ins = 0, tot = 0;
          for (let i = 0; i < n; i += step) { tot++; if (G.pointInPoly(p[i * 3], p[i * 3 + 1], poly)) ins++; }
          if (IN.selPartial ? ins > 0 : ins >= tot * 0.85) found.push(it.id);
        }
      }
      const ids = new Set(R.sel);
      if (found.length && found.every((id) => ids.has(id))) found.forEach((id) => ids.delete(id));
      else found.forEach((id) => ids.add(id));
      SEL.set(ids);
      R.renderOverlay();
    }
    cancel() { IN.lasso = null; R.renderOverlay(); }
  }

  /* ---- transforming the selection ---- */
  class SelTransformAction {
    constructor(rec, s, hit) {
      this.rec = rec; this.hit = hit;
      this.start = R.toWorld(s.x, s.y);
      this.T0 = R.selPreview || M.id();
      const bb = SEL.box;
      const c = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => M.apply(this.T0, x, y));
      this.corners = c;
      this.center = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
      this.theta = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]);
      A.emit('selpopup:hide');
    }
    move(e, rect) {
      const s = samplesOf(e, rect).pop();
      const [x, y] = R.toWorld(s.x, s.y);
      let T;
      if (this.hit.kind === 'move') T = M.mul(M.translate(x - this.start[0], y - this.start[1]), this.T0);
      else if (this.hit.kind === 'rotate') {
        let r = Math.atan2(y - this.center[1], x - this.center[0]) - Math.atan2(this.start[1] - this.center[1], this.start[0] - this.center[0]);
        const st = Math.PI / 12, k = Math.round(r / st) * st;
        if (Math.abs(r - k) < A.rad(2.5)) r = k;
        T = M.mul(M.about(M.rotate(r), this.center[0], this.center[1]), this.T0);
        this.angle = r;
      } else {
        if (IN.scaleMode === 'off') return;
        const i = this.hit.i, piv = this.corners[(i + 2) % 4], c0 = this.corners[i];
        if (IN.scaleMode === 'scale') {
          const d0 = hyp(c0[0] - piv[0], c0[1] - piv[1]) || 1;
          // project the pointer onto the diagonal for a stable uniform scale
          const ux = (c0[0] - piv[0]) / d0, uy = (c0[1] - piv[1]) / d0;
          const d1 = Math.max(0.02 * d0, (x - piv[0]) * ux + (y - piv[1]) * uy);
          T = M.mul(M.about(M.scale(d1 / d0), piv[0], piv[1]), this.T0);
        } else {
          const th = this.theta, rot = M.rotate(-th);
          const [l0x, l0y] = M.apply(rot, c0[0] - piv[0], c0[1] - piv[1]);
          const [l1x, l1y] = M.apply(rot, x - piv[0], y - piv[1]);
          const sx = Math.abs(l0x) > 1e-6 ? l1x / l0x : 1, sy = Math.abs(l0y) > 1e-6 ? l1y / l0y : 1;
          const S = M.mul(M.rotate(th), M.mul(M.scale(sx, sy), M.rotate(-th)));
          T = M.mul(M.about(S, piv[0], piv[1]), this.T0);
        }
      }
      R.selPreview = T;
      R.render();
      A.emit('selection:preview');
    }
    up() { IN.commitSelTransform(); }
    cancel() { this.up(); }
  }
  IN.commitSelTransform = () => {
    const T = R.selPreview;
    if (!T) return A.emit('selection');
    const isId = T.every((v, i) => Math.abs(v - M.id()[i]) < 1e-9);
    if (!isId) {
      D.begin();
      const map = new Map(), ids = [];
      for (const { it } of SEL.items()) {
        const n = D.transformItem(it, T, IN.scaleMode !== 'stretch');
        map.set(it.id, [n]); ids.push(n.id);
      }
      D.replace(map);
      R.selPreview = null;
      D.commit();
      SEL.set(ids);
      A.emit('layers:thumbs');
    } else { R.selPreview = null; R.render(); A.emit('selection'); }
  };

  /* ---- two-finger gesture (canvas or selection) ---- */
  class GestureAction {
    constructor(recs, selection = false) {
      this.ids = recs.map((r) => r.id);
      const [a, b] = recs;
      this.a0 = [a.x, a.y]; this.b0 = [b.x, b.y];
      this.d0 = hyp(b.x - a.x, b.y - a.y) || 1;
      this.ang0 = Math.atan2(b.y - a.y, b.x - a.x);
      this.mid0 = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      this.v0 = Object.assign({}, D.doc.view);
      this.w0 = R.toWorld(this.mid0[0], this.mid0[1]);
      this.selection = selection;
      this.rotUnlocked = false;
      Glide.reset();
      if (selection) { this.T0 = R.selPreview || M.id(); A.emit('selpopup:hide'); }
      else R.gesturing = true;
    }
    move() {
      const a = pointers.get(this.ids[0]), b = pointers.get(this.ids[1]);
      if (!a || !b) return;
      const d = hyp(b.x - a.x, b.y - a.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      let dr = ang - this.ang0;
      while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
      const sc = d / this.d0;
      if (this.selection) {
        const w0 = R.toWorld(this.mid0[0], this.mid0[1]), w1 = R.toWorld(mid[0], mid[1]);
        const s = IN.scaleMode === 'off' ? 1 : sc;
        const r = IN.allowSelRotate ? dr : 0;
        const T = M.mul(M.translate(w1[0] - w0[0], w1[1] - w0[1]), M.mul(M.about(M.mul(M.rotate(r), M.scale(s)), w0[0], w0[1]), this.T0));
        R.selPreview = T;
        R.render();
        return;
      }
      if (!this.rotUnlocked && Math.abs(dr) > 0.18 && A.settings.allowRotate && !A.settings.rotLock && !D.isNotebook()) this.rotUnlocked = true;
      let rot = this.v0.rot + (this.rotUnlocked ? dr : 0);
      const near = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
      if (this.rotUnlocked && Math.abs(rot - near) < A.rad(4)) rot = near;
      const zoom = A.settings.zoomLock ? this.v0.zoom : A.clamp(this.v0.zoom * sc, R.ZMIN, R.ZMAX);
      const c = Math.cos(rot) * zoom, s = Math.sin(rot) * zoom;
      const [wx, wy] = this.w0;
      R.setView({ zoom, rot, tx: mid[0] - (c * wx - s * wy), ty: mid[1] - (s * wx + c * wy) });
      Glide.track(mid[0], mid[1]);
      if (touchSession) touchSession.gestureMoved = true;
    }
    up() { this.end(); }
    end() {
      if (this.ended) return;
      this.ended = true;
      if (this.selection) IN.commitSelTransform();
      else if (!Glide.release()) { R.gesturing = false; R.render(); }
    }
    cancel() { this.end(); }
  }

  /* ---- text tool: tap to type, tap a text box to edit it, drag to set the box width ---- */
  class TextAction {
    constructor(rec, s) { this.start = s; this.cur = s; IN.textDrag = null; }
    move(e, rect) {
      const r = samplesOf(e, rect).pop();
      this.cur = r;
      if (hyp(r.x - this.start.x, r.y - this.start.y) > 10) { IN.textDrag = { x0: this.start.x, y0: this.start.y, x1: r.x, y1: r.y }; R.renderOverlay(); }
    }
    up() {
      const drag = IN.textDrag;
      IN.textDrag = null; R.renderOverlay();
      const [wx, wy] = R.toWorld(this.start.x, this.start.y);
      if (!drag) {
        const hit = pickItem(wx, wy, 6 / D.doc.view.zoom);
        if (hit && hit.t === 'x') return A.TE.edit(hit);
      }
      const width = drag ? Math.abs(drag.x1 - drag.x0) / D.doc.view.zoom : null;
      const [ax, ay] = drag ? R.toWorld(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1)) : [wx, wy];
      A.TE.create(ax, ay, width);
    }
    cancel() { IN.textDrag = null; R.renderOverlay(); }
  }
  /* ---- laser pointer: a glowing trail that fades, nothing is saved ---- */
  IN.laser = [];
  class LaserAction {
    constructor(rec, s) { this.color = B.slot().color || '#ff3b30'; this.trail = { pts: [{ x: s.x, y: s.y, t: performance.now() }], color: this.color, end: 0 }; IN.laser.push(this.trail); IN.tickLaser(); }
    move(e, rect) { for (const s of samplesOf(e, rect)) this.trail.pts.push({ x: s.x, y: s.y, t: performance.now() }); R.renderOverlay(); }
    up() { this.trail.end = performance.now(); IN.tickLaser(); }
    cancel() { this.up(); }
  }
  IN.tickLaser = () => {
    if (IN._laserRaf) return;
    const step = () => {
      const now = performance.now();
      IN.laser = IN.laser.filter((tr) => !tr.end || now - tr.end < 1400);
      R.renderOverlay();
      IN._laserRaf = IN.laser.length ? requestAnimationFrame(step) : 0;
    };
    IN._laserRaf = requestAnimationFrame(step);
  };
  R.painters.push((ctx) => {
    if (!IN.laser.length) return;
    const now = performance.now();
    for (const tr of IN.laser) {
      const p = tr.pts;
      if (p.length < 1) continue;
      const fade = tr.end ? Math.max(0, 1 - (now - tr.end) / 1400) : 1;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = tr.color; ctx.shadowBlur = 14;
      for (const [w, a, col] of [[9, 0.35, tr.color], [3.2, 1, '#ffffff']]) {
        ctx.globalAlpha = a * fade; ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.beginPath();
        // only the last ~1.5 s of the trail stays bright while drawing
        let started = false;
        for (const q of p) { if (!tr.end && now - q.t > 1500) continue; if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y); }
        if (p.length === 1) ctx.lineTo(p[0].x + 0.1, p[0].y);
        ctx.stroke();
      }
      ctx.restore();
    }
  });
  R.painters.push((ctx) => {
    const d = IN.textDrag;
    if (!d) return;
    ctx.save();
    ctx.strokeStyle = R.accent(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.max(28, Math.abs(d.y1 - d.y0)));
    ctx.restore();
  });
  /* tap a strip of tape to hide or reveal what is under it */
  IN.toggleTapeAt = (sx, sy) => {
    const [wx, wy] = R.toWorld(sx, sy);
    const zoom = D.doc.view.zoom;
    for (let li = D.doc.layers.length - 1; li >= 0; li--) {
      const l = D.doc.layers[li];
      if (!l.visible) continue;
      for (let i = l.items.length - 1; i >= 0; i--) {
        const it = l.items[i];
        if (it.b === 'tape' && G.strokeHitCircle(it, wx, wy, 4 / zoom)) {
          const n = Object.assign({}, it, { rv: !it.rv });
          l.items = l.items.slice(); l.items[i] = n;
          D.changed('items'); R.render();
          return true;
        }
      }
    }
    return false;
  };

  /* ---- artboards: labels above each frame; drag a label to move the artboard, tap it for options ---- */
  const abLabels = () => {
    if (!D.doc || D.isNotebook() || !(D.doc.artboards || []).length) return [];
    const out = [];
    for (const a of D.doc.artboards) {
      const [sx, sy] = R.toScreen(a.x, a.y);
      const txt = `${a.name}  ${(a.w / D.MM / 10).toFixed(1)} × ${(a.h / D.MM / 10).toFixed(1)} cm`;
      out.push({ a, x: sx, y: sy - 24, w: Math.min(260, 14 + txt.length * 6.6), h: 20, txt });
    }
    return out;
  };
  R.painters.push((ctx) => {
    for (const L of abLabels()) {
      ctx.save();
      ctx.font = '600 11.5px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = R.darkActive() ? 'rgba(255,255,255,0.62)' : 'rgba(30,40,60,0.62)';
      ctx.fillText(L.txt, L.x + 2, L.y + 14);
      ctx.restore();
    }
  });
  IN.artboardLabelHit = (x, y) => abLabels().find((L) => x >= L.x - 6 && x <= L.x + L.w && y >= L.y - 6 && y <= L.y + L.h + 4);
  class ArtboardAction {
    constructor(rec, s, L) { this.L = L; this.start = s; this.a0 = Object.assign({}, L.a); this.moved = 0; }
    move(e, rect) {
      const r = samplesOf(e, rect).pop();
      this.moved = Math.max(this.moved, hyp(r.x - this.start.x, r.y - this.start.y));
      if (this.moved < 6) return;
      const [w0x, w0y] = R.toWorld(this.start.x, this.start.y), [w1x, w1y] = R.toWorld(r.x, r.y);
      if (!this.begun) { D.begin(); this.begun = true; }
      D.doc.artboards = D.doc.artboards.map((a) => (a.id === this.a0.id ? Object.assign({}, a, { x: this.a0.x + w1x - w0x, y: this.a0.y + w1y - w0y }) : a));
      R.render();
    }
    up() {
      if (this.begun) { D.commit('all'); return; }
      A.UI.artboardOptions(this.L.a, { x: this.L.x + 40, y: this.L.y + 20 });
    }
    cancel() { if (this.begun) D.cancel(); }
  }

  /* zero-lag smoothing (Taubin λ|μ): removes jitter without pulling the line inward or behind the pen;
     the first and last points stay exactly where the Pencil touched */
  IN.smoothStroke = (src, strength) => {
    const n = src.length / 3;
    if (n < 4 || strength <= 0.01) return src.slice();
    let a = src.slice(), b = src.slice();
    const passes = Math.round(1 + strength * 5);
    for (let it = 0; it < passes; it++) {
      for (const f of [0.5, -0.53]) {
        for (let i = 1; i < n - 1; i++) {
          const j = i * 3;
          b[j] = a[j] + f * ((a[j - 3] + a[j + 3]) / 2 - a[j]);
          b[j + 1] = a[j + 1] + f * ((a[j - 2] + a[j + 4]) / 2 - a[j + 1]);
        }
        const t = a; a = b; b = t;
        b[0] = a[0]; b[1] = a[1]; b[(n - 1) * 3] = a[(n - 1) * 3]; b[(n - 1) * 3 + 1] = a[(n - 1) * 3 + 1];
      }
    }
    return a;
  };

  /* ---- momentum: a flick keeps the page gliding and eases out, like native scrolling ---- */
  const Glide = {
    raf: 0, samples: [],
    track(x, y) { const t = performance.now(); this.samples.push([t, x, y]); while (this.samples.length > 2 && t - this.samples[0][0] > 90) this.samples.shift(); },
    reset() { this.samples = []; this.stop(); },
    stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; },
    release() {
      const sm = this.samples; this.samples = [];
      if (sm.length < 2) return false;
      const a = sm[0], b = sm[sm.length - 1], dt = Math.max(8, b[0] - a[0]);
      if (performance.now() - b[0] > 60) return false; // finger stopped before lifting
      let vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt;
      if (Math.hypot(vx, vy) < 0.25) return false;
      if (D.isNotebook()) vx *= 0.25; // pages scroll vertically
      const max = 4.5; const sp = Math.hypot(vx, vy); if (sp > max) { vx *= max / sp; vy *= max / sp; }
      let last = performance.now();
      R.gesturing = true;
      const step = (now) => {
        const dtm = Math.min(32, now - last); last = now;
        const v = D.doc.view;
        const tx0 = v.tx, ty0 = v.ty;
        R.setView({ tx: v.tx + vx * dtm, ty: v.ty + vy * dtm });
        // stop at notebook edges instead of pushing against them
        if (Math.abs(v.tx - tx0) < 0.01 && Math.abs(vx) > 0.01) vx = 0;
        if (Math.abs(v.ty - ty0) < 0.01 && Math.abs(vy) > 0.01) vy = 0;
        const k = Math.pow(0.9945, dtm); vx *= k; vy *= k;
        if (Math.hypot(vx, vy) < 0.02) { this.raf = 0; R.gesturing = false; R.render(); return; }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
      return true;
    },
  };
  IN.glide = Glide;

  /* ---- one finger: drag pans; long-press then move = lasso; long-press and lift = context menu ---- */
  class FingerAction {
    constructor(rec, s) {
      this.rec = rec;
      this.start = { x: s.x, y: s.y };
      this.last = [s.x, s.y];
      this.moved = 0;
      this.v0 = { tx: D.doc.view.tx, ty: D.doc.view.ty };
      R.gesturing = true;
      Glide.reset(); Glide.track(s.x, s.y);
      this.timer = setTimeout(() => this.onHold(), A.settings.holdTime || 500);
    }
    onHold() {
      if (this.ended || this.moved > 10) return;
      R.setView({ tx: this.v0.tx, ty: this.v0.ty }); // undo tiny drift
      R.gesturing = false;
      this.held = true;
      this.holdPt = { x: this.rec.x, y: this.rec.y, t: performance.now(), type: 'touch' };
      this.lasso = new LassoAction(this.rec, this.holdPt, { forceLasso: true, temp: true });
      IN.holdRing = { x: this.holdPt.x, y: this.holdPt.y };
      R.renderOverlay();
    }
    move(e, rect) {
      const r = this.rec;
      this.moved = Math.max(this.moved, hyp(r.x - this.start.x, r.y - this.start.y));
      if (this.held) {
        if (hyp(r.x - this.holdPt.x, r.y - this.holdPt.y) > 6) IN.holdRing = null;
        this.lasso.move(e, rect);
        return;
      }
      if (this.moved > 10) clearTimeout(this.timer);
      const v = D.doc.view;
      R.setView({ tx: v.tx + r.x - this.last[0], ty: v.ty + r.y - this.last[1] });
      this.last = [r.x, r.y];
      Glide.track(r.x, r.y);
    }
    up(e, rect) {
      this.ended = true;
      clearTimeout(this.timer);
      IN.holdRing = null;
      if (!this.held) {
        if (this.moved > 10 && Glide.release()) return;
        R.gesturing = false; R.render();
        if (this.moved < 8) { if (!IN.toggleTapeAt(this.start.x, this.start.y)) A.emit('canvas:tap', this.start); }
        return;
      }
      if (this.lasso.moved >= 8 && this.lasso.poly.length >= 8) { this.lasso.up(e, rect); return; }
      this.lasso.cancel();
      A.emit('canvas:menu', { x: this.holdPt.x, y: this.holdPt.y });
    }
    cancel() {
      this.ended = true; clearTimeout(this.timer); IN.holdRing = null;
      if (this.lasso) this.lasso.cancel();
      R.gesturing = false; R.render();
    }
  }

  class PanAction {
    constructor(rec) { this.rec = rec; this.last = [rec.x, rec.y]; R.gesturing = true; Glide.reset(); Glide.track(rec.x, rec.y); }
    move() {
      const r = this.rec;
      const v = D.doc.view;
      R.setView({ tx: v.tx + r.x - this.last[0], ty: v.ty + r.y - this.last[1] });
      this.last = [r.x, r.y];
      Glide.track(r.x, r.y);
    }
    up() { if (Glide.release()) return; R.gesturing = false; R.render(); }
    cancel() { this.up(); }
  }

  class GuideAction {
    constructor(rec, s, g, h) {
      this.g = g; this.h = h; this.last = R.toWorld(s.x, s.y); this.moved = 0; this.start = [s.x, s.y];
    }
    move(e, rect) {
      const s = samplesOf(e, rect).pop();
      const w = R.toWorld(s.x, s.y);
      this.moved = Math.max(this.moved, hyp(s.x - this.start[0], s.y - this.start[1]));
      GU.drag(this.g, this.h, w[0], w[1], w[0] - this.last[0], w[1] - this.last[1]);
      this.last = w;
      R.renderOverlay();
    }
    up() {
      if (this.h.center && this.moved < 6) {
        const now = performance.now();
        if (now - lastCenterTap < 350) { GU.special(this.g); lastCenterTap = 0; } else lastCenterTap = now;
      }
      D.changed('guides');
      R.renderOverlay();
    }
    cancel() { this.up(); }
  }

  class EyedropAction {
    constructor(rec, s) { this.sample(s.x, s.y); }
    sample(x, y) {
      const [wx, wy] = R.toWorld(x, y);
      const hit = pickItem(wx, wy, 6 / D.doc.view.zoom);
      if (hit && hit.t === 's') { this.color = hit.c; IN.loupe = { x, y, color: B.col(hit.c) }; R.renderOverlay(); return; }
      try {
        const px = R.mctx.getImageData(Math.round(x * A.dpr), Math.round(y * A.dpr), 1, 1).data;
        this.color = A.C.rgbToHex(px[0], px[1], px[2]);
      } catch (e) { this.color = null; }
      IN.loupe = { x, y, color: this.color };
      R.renderOverlay();
    }
    move(e, rect) { const s = samplesOf(e, rect).pop(); this.sample(s.x, s.y); }
    up() {
      IN.loupe = null; IN.eyedrop = false;
      if (this.color) A.emit('color:pick', this.color);
      A.emit('eyedrop:end');
      R.renderOverlay();
    }
    cancel() { IN.loupe = null; IN.eyedrop = false; A.emit('eyedrop:end'); R.renderOverlay(); }
  }

  /* ================= routing ================= */
  const fingerMode = () => {
    const f = A.settings.fingerAction;
    if (f === 'auto') return penSeen || A.settings.penSeen ? 'pan' : 'draw';
    return f;
  };

  function startPrimary(rec, s, e) {
    const isFinger = rec.type === 'touch';
    if (IN.eyedrop) return new EyedropAction(rec, s);
    const g = GU.active();
    if (g) { const h = GU.hitHandle(g, s.x, s.y); if (h) return new GuideAction(rec, s, g, h); }
    if (R.sel.size) {
      const hit = SEL.hit(s.x, s.y);
      if (hit) return new SelTransformAction(rec, s, hit);
    }
    const abl = IN.artboardLabelHit(s.x, s.y);
    if (abl) return new ArtboardAction(rec, s, abl);
    let tool = B.slot().b;
    // a Pencil touch right next to the tool bar is almost always a stray dab while reaching for a tool
    if (rec.type === 'pen') { const tb = A.$('#tools .toolbar'); if (tb && !D.isNotebook()) { const r = tb.getBoundingClientRect(), o = R.overlay.getBoundingClientRect(); if (s.x + o.left < r.right + 14 && s.y + o.top > r.top - 10 && s.y + o.top < r.bottom + 10) return null; } }
    if (isFinger) {
      const fm = fingerMode();
      if (fm === 'pan') return new FingerAction(rec, s);
      if (fm === 'none') return null;
      if (fm === 'select') tool = 'select';
    }
    if (tool !== 'select' && R.sel.size) SEL.clear();
    if (tool === 'select') return new LassoAction(rec, s);
    if (tool === 'slice' || tool === 'eraser') return new EraseAction(rec, s, tool);
    if (tool === 'nudge') return new NudgeAction(rec, s);
    if (tool === 'text') return new TextAction(rec, s);
    if (tool === 'laser') return new LaserAction(rec, s);
    if (tool === 'pan') return new PanAction(rec);
    if (B.isDrawing(tool) || B.catalog[tool].mask) {
      const l = D.doc.layerMode === 'auto' ? null : D.active();
      if (l && l.locked) { A.toast('This layer is locked'); return null; }
      return new DrawAction(rec, s, { finger: isFinger });
    }
    return null;
  }

  function onDown(e) {
    fresh.delete(e.pointerId);
    if (IN.nativePen && e.pointerType === 'pen' && !e.__native) return;
    if (e.button > 0 && e.pointerType === 'mouse' && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    if (Glide.raf) { Glide.stop(); R.gesturing = false; }
    A.closePopovers();
    A.emit('canvas:down');
    const rect = rectOf();
    const s = sampleOf(e, rect);
    const rec = { id: e.pointerId, type: e.pointerType, x: s.x, y: s.y, sx: s.x, sy: s.y, t0: performance.now(), moved: 0 };
    pointers.set(e.pointerId, rec);
    try { R.overlay.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    IN.hover = null;

    if (rec.type === 'pen') {
      penSeen = true;
      if (!A.settings.penSeen) { A.settings.penSeen = true; A.saveSettings(); }
      if (action && action.rec && action.rec.type === 'touch' && action instanceof DrawAction) action.cancel();
      if (action instanceof GestureAction || action instanceof PanAction) action.cancel();
      action = startPrimary(rec, s, e);
      if (action) action.owner = rec.id;
      return;
    }
    if (rec.type === 'mouse') {
      if (e.button === 1 || e.button === 2 || spaceDown) { action = new PanAction(rec); action.owner = rec.id; return; }
      action = startPrimary(rec, s, e);
      if (action) action.owner = rec.id;
      return;
    }
    // touch
    const penBusy = action && action.owner != null && pointers.get(action.owner) && pointers.get(action.owner).type === 'pen';
    if (penBusy) { rec.ignored = true; return; }
    const touches = [...pointers.values()].filter((p) => p.type === 'touch' && !p.ignored);
    if (!touchSession || touches.length === 1) touchSession = { t0: performance.now(), max: 1, moved: 0, gestureMoved: false };
    touchSession.max = Math.max(touchSession.max, touches.length);
    if (touches.length === 1) {
      action = startPrimary(rec, s, e);
      if (action) action.owner = rec.id;
    } else if (touches.length === 2) {
      if (action) {
        const young = performance.now() - touches[0].t0 < 260 && touches[0].moved < 40;
        if (action instanceof DrawAction && young) action.cancel();
        else if (action instanceof EraseAction || action instanceof NudgeAction) { action.up(); if (D.history.undo.length && young) { /* keep */ } }
        else if (action instanceof LassoAction) action.cancel();
        else if (action instanceof DrawAction) { action.up(); }
        else if (action.cancel) action.cancel();
      }
      let inSel = false;
      if (R.sel.size) {
        const c = SEL.screenCorners();
        const xs = c ? c.map((p) => p[0]) : [], ys = c ? c.map((p) => p[1]) : [];
        const big = c && (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) > R.w * R.h * 0.5;
        inSel = c && !big && touches.every((t) => G.pointInPoly(t.x, t.y, c.flat()));
      }
      action = new GestureAction(touches, inSel);
      action.owner = null;
      action.multi = true;
    }
  }

  function onMove(e) {
    if (IN.nativePen && e.pointerType === 'pen' && !e.__native && (e.buttons || e.pressure > 0 || pointers.has(7777))) return;
    const rect = rectOf();
    const rec = pointers.get(e.pointerId);
    if (!rec) {
      if (e.pointerType === 'pen' && A.settings.hoverCursor) {
        const s = sampleOf(e, rect);
        IN.hover = { x: s.x, y: s.y };
        R.renderOverlay();
      } else if (e.pointerType === 'mouse' && A.settings.hoverCursor) {
        const s = sampleOf(e, rect);
        IN.hover = { x: s.x, y: s.y, mouse: true };
        R.renderOverlay();
      }
      return;
    }
    if (rec.ignored) return;
    e.preventDefault();
    const s = sampleOf(e, rect);
    rec.x = s.x; rec.y = s.y;
    rec.moved = Math.max(rec.moved, hyp(s.x - rec.sx, s.y - rec.sy));
    if (touchSession && rec.type === 'touch') touchSession.moved = Math.max(touchSession.moved, rec.moved);
    if (!action) return;
    if (action.multi) { if (action.ids.includes(rec.id)) action.move(e, rect); return; }
    if (action.owner === rec.id) action.move(e, rect);
  }

  function onUp(e) {
    if (IN.nativePen && e.pointerType === 'pen' && !e.__native) return;
    const rect = rectOf();
    const rec = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!rec) return;
    if (rec.ignored) return;
    if (action) {
      if (action.multi) {
        if (action.ids.includes(rec.id)) { action.up(e, rect); action = null; }
      } else if (action.owner === rec.id) {
        const a = action; action = null;
        if (e.type === 'pointercancel' && a.cancel && a instanceof DrawAction) a.up(null, rect); else a.up(e, rect);
      }
    }
    if (rec.type === 'touch') {
      const touches = [...pointers.values()].filter((p) => p.type === 'touch' && !p.ignored);
      if (!touches.length && touchSession) {
        const ts = touchSession; touchSession = null;
        const dt = performance.now() - ts.t0;
        if (dt < 320 && ts.moved < 14) {
          if (ts.max === 2 && A.settings.twoFingerUndo) { if (D.undo()) A.toast('Undo', 700); }
          else if (ts.max === 3 && A.settings.threeFingerRedo) { if (D.redo()) A.toast('Redo', 700); }
        }
      }
    }
  }

  /* ---------- native Apple Pencil stream (iPad app): every coalesced and predicted sample ---------- */
  IN.nativePen = !!(window.AXIOM_NATIVE && window.AXIOM_NATIVE.pen);
  const nativeEv = (s, type) => ({
    __native: true, type, pointerId: 7777, pointerType: 'pen', button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: s[0], clientY: s[1], pressure: Math.max(0.01, s[2]), altitudeAngle: s[3], azimuthAngle: s[4], tiltX: 0, tiltY: 0, timeStamp: s[5],
    preventDefault() {},
  });
  window.__axiomPen = (phase, samples, predicted) => {
    if (!samples || !samples.length) return;
    if (!D.doc || A.$('#canvas-view').hidden) return;
    const last = samples[samples.length - 1];
    const withLists = (ev, list, pred) => { ev.getCoalescedEvents = () => list.map((s) => nativeEv(s, 'pointermove')); ev.getPredictedEvents = () => (pred || []).map((s) => nativeEv(s, 'pointermove')); return ev; };
    if (phase === 'b') {
      onDown(nativeEv(samples[0], 'pointerdown'));
      if (samples.length > 1) onMove(withLists(nativeEv(last, 'pointermove'), samples.slice(1), []));
    } else if (phase === 'm') {
      onMove(withLists(nativeEv(last, 'pointermove'), samples, predicted));
    } else {
      if (samples.length) onMove(withLists(nativeEv(last, 'pointermove'), samples, []));
      onUp(nativeEv(last, phase === 'c' ? 'pointercancel' : 'pointerup'));
    }
  };


  /* ---------- Apple Pencil calibration: the user taps targets; the average gap becomes a correction for every pen sample ---------- */
  IN.penXY = (e) => {
    const o = (e.pointerType === 'pen' && A.settings.penOffset) || null;
    return o ? [e.clientX + o.x, e.clientY + o.y] : [e.clientX, e.clientY];
  };
  IN.calibratePen = () => {
    const spots = [[0.5, 0.42], [0.22, 0.25], [0.78, 0.25], [0.22, 0.75], [0.78, 0.75]];
    const back = A.h('div', { class: 'pc-back' });
    const target = A.h('div', { class: 'pc-target' });
    const msg = A.h('p', { class: 'pc-msg' }, 'Touch the centre of the cross with the tip of your Apple Pencil.');
    const cancel = A.h('button', { class: 'btn', onclick: () => back.remove() }, 'Cancel');
    back.append(target, A.h('div', { class: 'pc-panel' }, A.h('h3', null, 'Calibrate Apple Pencil'), msg, A.h('div', { class: 'row gap' }, cancel)));
    document.body.append(back);
    const got = [];
    let k = 0, tx = 0, ty = 0, ready = false;
    const place = () => { tx = Math.round(innerWidth * spots[k][0]); ty = Math.round(innerHeight * spots[k][1]); target.style.left = tx + 'px'; target.style.top = ty + 'px'; target.classList.remove('hit'); setTimeout(() => { ready = true; }, 320); };
    place();
    back.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      if (!ready) return;
      if (e.pointerType !== 'pen' && A.settings.penSeen) { msg.textContent = 'Use the Apple Pencil, not your finger.'; return; }
      if (Math.hypot(tx - e.clientX, ty - e.clientY) > 40) { msg.textContent = 'That was too far from the cross. Touch its centre.'; return; }
      ready = false;
      got.push([tx - e.clientX, ty - e.clientY]);
      target.classList.add('hit');
      k++;
      if (k < spots.length) { setTimeout(place, 220); msg.textContent = `Good. ${spots.length - k} more.`; return; }
      // drop the worst tap, average the rest
      const mean = (arr) => [arr.reduce((a, v) => a + v[0], 0) / arr.length, arr.reduce((a, v) => a + v[1], 0) / arr.length];
      let [mx, my] = mean(got);
      const kept = got.slice().sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my)).slice(0, got.length - 1);
      [mx, my] = mean(kept);
      const small = Math.hypot(mx, my) < 1.5;
      A.settings.penOffset = small ? null : { x: Math.round(mx * 10) / 10, y: Math.round(my * 10) / 10 };
      A.saveSettings();
      target.remove();
      const dir = (v, a, b) => (Math.abs(v) < 0.5 ? '' : `${Math.abs(v).toFixed(1)} pt ${v > 0 ? a : b}`);
      msg.textContent = small ? 'Your Pencil already lines up (under 1.5 pt). No correction needed.'
        : `Ink was landing ${[dir(-mx, 'to the right of', 'to the left of'), dir(-my, 'below', 'above')].filter(Boolean).join(' and ')} the tip. It is now corrected to sit under the tip.`;
      cancel.textContent = 'Done';
    });
  };

  IN.cancelAll = () => { if (action && action.cancel) action.cancel(); action = null; pointers.clear(); };

  /* ================= overlay painter ================= */
  const paint = (ctx) => {
    const doc = D.doc;
    const accent = R.accent();
    // live stroke
    if (IN.liveDraw) {
      const d = IN.liveDraw;
      const it = d.liveItem();
      if (it.pts.length) {
        ctx.save();
        ctx.setTransform(...M.mul(M.scale(A.dpr), R.matrix()));
        B.render(ctx, it, 1);
        ctx.restore();
        if (doc.precision.measure && G.count(it.pts) >= 2) {
          const p = it.pts, n = p.length;
          const straight = it.sharp || d.shape;
          let txt;
          if (d.shape && (d.shape.kind === 'circle')) {
            const bb = G.bbox(it.pts); txt = 'r ' + A.fmtLen((bb[2] - bb[0]) / 2);
          } else if (d.shape && d.shape.closed) { const bb = G.bbox(it.pts); txt = `${A.fmtLen(bb[2] - bb[0])} × ${A.fmtLen(bb[3] - bb[1])}`; }
          else txt = A.fmtLen(straight ? hyp(p[n - 3] - p[0], p[n - 2] - p[1]) : G.length(p));
          const [sx, sy] = R.toScreen(p[n - 3], p[n - 2]);
          R.label(ctx, txt, sx + 40, sy - 26, accent);
        }
        if (d.shape) {
          const p = it.pts; const [sx, sy] = R.toScreen(p[0], p[1]);
          R.label(ctx, d.shape.kind, sx, sy - 26, '#5b6474');
        }
      }
    }
    // last measured stroke label
    if (IN.lastMeasure && performance.now() < IN.lastMeasure.until && doc.precision.measure) {
      const it = IN.lastMeasure.item, p = it.pts, n = p.length;
      const [sx, sy] = R.toScreen((p[0] + p[n - 3]) / 2, (p[1] + p[n - 2]) / 2);
      R.label(ctx, A.fmtLen(it.sharp ? hyp(p[n - 3] - p[0], p[n - 2] - p[1]) : G.length(p)), sx, sy - 18, accent);
    }
    // lasso
    if (IN.lasso && IN.lasso.poly.length > 2) {
      const pl = IN.lasso.poly;
      ctx.beginPath();
      for (let i = 0; i < pl.length; i += 2) { const [x, y] = R.toScreen(pl[i], pl[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = A.C.rgba(accent.startsWith('#') ? accent : '#2f6fdb', 0.1); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = accent; ctx.stroke(); ctx.setLineDash([]);
    }
    // selection box
    const c = SEL.screenCorners();
    if (c && R.sel.size) {
      ctx.beginPath(); c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.lineWidth = 1.25; ctx.strokeStyle = accent; ctx.stroke();
      if (IN.scaleMode !== 'off') for (const [x, y] of c) {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
      }
      if (IN.allowSelRotate) {
        const { top, rh } = SEL.rotHandle(c);
        ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(rh[0], rh[1]); ctx.lineWidth = 1.25; ctx.stroke();
        ctx.beginPath(); ctx.arc(rh[0], rh[1], 8, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(rh[0], rh[1], 4, -0.4, 4.2); ctx.stroke();
      }
    }
    // long-press ring
    if (IN.holdRing) {
      ctx.beginPath(); ctx.arc(IN.holdRing.x, IN.holdRing.y, 30, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // eraser / nudge cursor
    if (IN.cursor) {
      ctx.beginPath(); ctx.arc(IN.cursor.x, IN.cursor.y, IN.cursor.r, 0, Math.PI * 2);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(30,35,45,.55)'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(IN.cursor.x, IN.cursor.y, IN.cursor.r + 1.2, 0, Math.PI * 2); ctx.stroke();
    }
    // hover cursor (Apple Pencil hover / mouse)
    if (IN.hover && !IN.liveDraw && !IN.cursor) {
      const slot = B.slot();
      const cat = B.catalog[slot.b];
      let r = cat.kind === 'tool' ? (slot.b === 'select' ? 0 : (slot.b === 'nudge' ? slot.size : (slot.size / 2) * doc.view.zoom)) : Math.max(1.5, (slot.size * (cat.wire ? 1 / doc.view.zoom : 1) / 2) * doc.view.zoom);
      if (cat.kind === 'fill') r = 3;
      if (r > 0) {
        ctx.beginPath(); ctx.arc(IN.hover.x, IN.hover.y, r, 0, Math.PI * 2);
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(30,35,45,.5)'; ctx.stroke();
        if (cat.kind !== 'tool') { ctx.globalAlpha = 0.25; ctx.fillStyle = slot.color; ctx.fill(); ctx.globalAlpha = 1; }
      }
    }
    // eyedropper loupe
    if (IN.loupe) {
      const { x, y, color } = IN.loupe;
      const ly = y - 70;
      ctx.beginPath(); ctx.arc(x, ly, 30, 0, Math.PI * 2); ctx.fillStyle = color || '#fff'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.strokeStyle = '#000'; ctx.stroke();
      if (color) R.label(ctx, color.toUpperCase(), x, ly + 46, '#30343c');
    }
  };

  /* ================= keyboard ================= */
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
  function onKey(e) {
    if (!D.doc || !A.$('#canvas-view') || A.$('#canvas-view').hidden || typing()) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? D.redo() : D.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); D.redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); A.emit('cmd', 'selectAll'); return; }
    if (mod && k === 'c') { e.preventDefault(); A.emit('cmd', 'copy'); return; }
    if (mod && k === 'x') { e.preventDefault(); A.emit('cmd', 'cut'); return; }
    if (mod && k === 'v') { return; } // handled by paste event (images) and fallback below
    if (mod && k === 'd') { e.preventDefault(); A.emit('cmd', 'duplicate'); return; }
    if (mod && k === 'e') { e.preventDefault(); A.emit('cmd', 'export'); return; }
    if (mod) return;
    if (k === 'backspace' || k === 'delete') { if (R.sel.size) { e.preventDefault(); A.emit('cmd', 'delete'); } return; }
    if (k === 'escape') { SEL.clear(); A.closePopovers(); return; }
    if (k === ' ') { spaceDown = true; return; }
    if (/^[1-8]$/.test(k)) { A.emit('slot:select', +k - 1); return; }
    if (k === '[' || k === ']') { A.emit('slot:size', k === ']' ? 1.15 : 1 / 1.15); return; }
    if (k === '0') { A.emit('cmd', 'resetView'); return; }
    if (k === 'f') { A.emit('cmd', 'fit'); return; }
    if (k === 'g') { A.emit('cmd', 'toggleGrid'); return; }
    if (k === 'h') { A.emit('cmd', 'toggleUI'); return; }
    if (k === 'l') { A.emit('cmd', 'toggleLayers'); return; }
    if (k === 'p') { A.emit('cmd', 'togglePrecision'); return; }
    if (k === '=' || k === '+') { R.zoomAt(R.w / 2, R.h / 2, 1.25); return; }
    if (k === '-') { R.zoomAt(R.w / 2, R.h / 2, 0.8); return; }
  }

  IN.init = (el) => {
    el.addEventListener('pointerdown', onDown, { passive: false });
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', (e) => { if (!pointers.has(e.pointerId)) { IN.hover = null; R.renderOverlay(); } });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = rectOf();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) R.zoomAt(x, y, Math.exp(-e.deltaY * 0.012));
      else { const v = D.doc.view; R.setView({ tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }); }
      R.gesturing = true; clearTimeout(IN._wt); IN._wt = setTimeout(() => { R.gesturing = false; R.render(); }, 140);
    }, { passive: false });
    // Safari trackpad / iOS page-level gestures
    let gs = 1;
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => document.addEventListener(n, (e) => {
      e.preventDefault();
      if (!el.isConnected || A.$('#canvas-view').hidden) return;
      if (pointers.size) return; // touch pinch handled by pointer events
      if (n === 'gesturestart') gs = 1;
      if (n === 'gesturechange' && e.scale) { R.zoomAt(e.clientX || R.w / 2, e.clientY || R.h / 2, e.scale / gs); gs = e.scale; }
    }, { passive: false }));
    document.addEventListener('touchmove', (e) => { if (e.target === el) e.preventDefault(); }, { passive: false });
    addEventListener('keydown', onKey);
    addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
    R.painters.push(GU.paint, paint);
  };
})();
