/* Axiom persistence: IndexedDB for drawings, localStorage for app settings */
'use strict';
(() => {
  const DB_NAME = 'axiom', DB_VER = 1;
  let dbp = null;
  const mem = { docs: new Map(), meta: new Map() }; // fallback when IndexedDB is unavailable
  let useMem = false;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const rq = indexedDB.open(DB_NAME, DB_VER);
        rq.onupgradeneeded = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
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
      await open();
      if (useMem) return [...mem.meta.values()];
      return tx('meta', 'readonly', (s) => req(s.getAll()));
    },
    async loadDoc(id) {
      await open();
      if (useMem) return mem.docs.get(id) || null;
      return tx('docs', 'readonly', (s) => req(s.get(id)));
    },
    async saveDoc(doc, thumb) {
      const meta = { id: doc.id, name: doc.name, created: doc.created, updated: doc.updated, thumb: thumb || null, paper: doc.paper.bg };
      await open();
      if (useMem) { mem.docs.set(doc.id, JSON.parse(JSON.stringify(doc))); mem.meta.set(doc.id, meta); return; }
      await tx('docs', 'readwrite', (s) => s.put(doc));
      await tx('meta', 'readwrite', (s) => s.put(meta));
    },
    async saveMeta(meta) {
      await open();
      if (useMem) { mem.meta.set(meta.id, meta); return; }
      await tx('meta', 'readwrite', (s) => s.put(meta));
    },
    async deleteDoc(id) {
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
  });
  let S = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) S = Object.assign(defaults(), JSON.parse(raw));
  } catch (e) { /* storage blocked */ }
  A.settings = S;
  A.saveSettings = A.debounce(() => {
    try { localStorage.setItem(KEY, JSON.stringify(A.settings)); } catch (e) { /* ignore */ }
  }, 250);
})();
