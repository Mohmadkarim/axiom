/* Axiom persistence: IndexedDB for drawings, localStorage for app settings */
'use strict';
(() => {
  const DB_NAME = 'axiom', DB_VER = 2;
  let dbp = null;
  const mem = { docs: new Map(), meta: new Map(), files: new Map() }; // fallback when IndexedDB is unavailable
  let useMem = false;
  // native iPad app: drawings are files managed by the app (see ios/Axiom/DrawingStore.swift)
  const NATIVE = !!(window.AXIOM_NATIVE && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.axiom);
  const post = (m) => window.webkit.messageHandlers.axiom.postMessage(m);
  A.native = NATIVE ? { post } : null;
  // the app serves stored files as raw bytes at axiom://app/_files/<id> (see ios/Axiom/AppSchemeHandler.swift)
  const RAW = NATIVE && location.protocol === 'axiom:';
  const rawURL = (id) => '_files/' + encodeURIComponent(id);

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const rq = indexedDB.open(DB_NAME, DB_VER);
        rq.onupgradeneeded = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => { useMem = true; res(null); };
        rq.onblocked = () => { useMem = true; res(null); };
      } catch (e) { useMem = true; res(null); }
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then((db) => {
      if (!db || useMem) return fn(null);
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let out;
        Promise.resolve(fn(s)).then((v) => (out = v));
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    });
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  A.store = {
    get usingMemory() { return useMem; },
    async listMeta() {
      if (NATIVE) return JSON.parse((await post({ op: 'list' })) || '[]');
      await open();
      if (useMem) return [...mem.meta.values()];
      return tx('meta', 'readonly', (s) => req(s.getAll()));
    },
    async loadDoc(id) {
      if (NATIVE) { const s = await post({ op: 'load', id }); return s ? JSON.parse(s) : null; }
      await open();
      if (useMem) return mem.docs.get(id) || null;
      return tx('docs', 'readonly', (s) => req(s.get(id)));
    },
    async saveDoc(doc, thumb) {
      const meta = { id: doc.id, name: doc.name, created: doc.created, updated: doc.updated, thumb: thumb || null, paper: doc.paper.bg, subject: doc.subject || null };
      if (NATIVE) { await post({ op: 'save', id: doc.id, doc: JSON.stringify(doc), meta: JSON.stringify(meta) }); return; }
      await open();
      if (useMem) { mem.docs.set(doc.id, JSON.parse(JSON.stringify(doc))); mem.meta.set(doc.id, meta); return; }
      await tx('docs', 'readwrite', (s) => s.put(doc));
      await tx('meta', 'readwrite', (s) => s.put(meta));
    },
    async saveMeta(meta) {
      if (NATIVE) { await post({ op: 'saveMeta', id: meta.id, meta: JSON.stringify(meta) }); return; }
      await open();
      if (useMem) { mem.meta.set(meta.id, meta); return; }
      await tx('meta', 'readwrite', (s) => s.put(meta));
    },
    /* binary files: PDFs, photos, saved visuals (Blob in, Blob out) */
    async saveFile(id, blob) {
      if (RAW) {
        try { const r = await fetch(rawURL(id), { method: 'POST', body: blob }); if (r.ok) return; } catch (e) { /* fall back to the message bridge */ }
      }
      if (NATIVE) {
        const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
        await post({ op: 'fileSave', id, data });
        return;
      }
      await open();
      if (useMem) { mem.files.set(id, blob); return; }
      const buf = await blob.arrayBuffer(); // raw bytes: Safari can't store Blob objects in IndexedDB
      await tx('files', 'readwrite', (s) => s.put({ id, buf, type: blob.type }));
    },
    async loadFile(id, type = 'application/octet-stream') {
      if (RAW) {
        try {
          const r = await fetch(rawURL(id));
          if (r.status === 404) return null;
          if (r.ok) return new Blob([await r.arrayBuffer()], { type });
        } catch (e) { /* fall back to the message bridge */ }
      }
      if (NATIVE) {
        const b64 = await post({ op: 'fileLoad', id });
        if (!b64) return null;
        return (await fetch('data:' + type + ';base64,' + b64)).blob();
      }
      await open();
      if (useMem) return mem.files.get(id) || null;
      const r = await tx('files', 'readonly', (s) => req(s.get(id)));
      if (!r) return null;
      return r.buf ? new Blob([r.buf], { type: r.type || type }) : r.blob || null;
    },
    async deleteFile(id) {
      if (NATIVE) { await post({ op: 'fileDelete', id }); return; }
      await open();
      if (useMem) { mem.files.delete(id); return; }
      await tx('files', 'readwrite', (s) => s.delete(id));
    },
    async deleteDoc(id) {
      if (NATIVE) { await post({ op: 'delete', id }); return; }
      await open();
      if (useMem) { mem.docs.delete(id); mem.meta.delete(id); return; }
      await tx('docs', 'readwrite', (s) => s.delete(id));
      await tx('meta', 'readwrite', (s) => s.delete(id));
    },
  };

  /* ---------- settings (per device) ---------- */
  const KEY = 'axiom.settings.v1';
  const defaults = () => ({
    theme: 'system',            // system | light | dark
    toolSetup: 'bar',           // bar | wheel
    toolSide: 'left',           // left | right
    toolPos: null,              // {x,y} for the wheel / bar offset
    fingerAction: 'auto',       // auto | draw | pan | select
    twoFingerUndo: true,
    threeFingerRedo: true,
    tapHoldSelect: true,
    holdTime: 500,
    pressure: 1.0,              // exponent: <1 softer, >1 firmer
    allowRotate: true,
    hoverCursor: true,
    highlightSelection: true,
    showPalette: true,
    activeSlot: 0,
    slots: null,                // filled by brushes.js
    recentColors: [],
    palettes: null,             // filled by color UI
    activePalette: 0,
    sort: 'updated',
    seenWelcome: false,
    majors: null,               // e.g. ['math','physics']; null until onboarding
    subjects: [],               // courses: {id, name, color}
    documents: [],              // study library meta: {id, name, kind, type, subject, size, added, lastPage}
    visuals: [],                // saved visuals meta: {id, name, subject, thumb}
    aiKey: '',
    aiModel: 'claude-opus-5-5',
    panelW: 0,
    galleryFilter: 'home',
    darkCanvas: true,
    penSeen: false,
  });
  let S = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) S = Object.assign(defaults(), JSON.parse(raw));
  } catch (e) { /* storage blocked */ }
  if (NATIVE && window.AXIOM_SETTINGS && typeof window.AXIOM_SETTINGS === 'object') S = Object.assign(defaults(), window.AXIOM_SETTINGS);
  A.settings = S;
  A.saveSettings = A.debounce(() => {
    try { localStorage.setItem(KEY, JSON.stringify(A.settings)); } catch (e) { /* ignore */ }
    if (NATIVE) post({ op: 'settings', json: JSON.stringify(A.settings) }).catch(() => {});
  }, 250);
})();
