// In-memory dash store backed by IndexedDB. Every update persists the changed
// dash (coalesced per animation frame) and notifies subscribers.

const DB_NAME = "counter-dash";
const STORE = "dashes";

let db = null;
const dashes = new Map();
const listeners = new Set();
const dirty = new Set();
const deleted = new Set();
let flushScheduled = false;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Fill in fields added after a dash was first saved. */
function normalize(d) {
  const out = { redo: [], turn: 0, draft: null, vars: [], ...d };
  if (out.draft && !out.draft.vars) out.draft = { ...out.draft, vars: out.vars };
  return out;
}

export async function load() {
  try {
    db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const d of all) dashes.set(d.id, normalize(d));
  } catch (e) {
    console.warn("IndexedDB unavailable, falling back to localStorage", e);
    db = null;
    const raw = localStorage.getItem(DB_NAME);
    if (raw) for (const d of JSON.parse(raw)) dashes.set(d.id, normalize(d));
  }
  navigator.storage?.persist?.().catch(() => {});
  // flush pending writes before the page is hidden (iOS can kill PWAs abruptly)
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

function flush() {
  flushScheduled = false;
  if (!dirty.size && !deleted.size) return;
  if (!db) {
    localStorage.setItem(DB_NAME, JSON.stringify([...dashes.values()]));
    dirty.clear();
    deleted.clear();
    return;
  }
  const tx = db.transaction(STORE, "readwrite");
  const os = tx.objectStore(STORE);
  for (const id of dirty) if (dashes.has(id)) os.put(dashes.get(id));
  for (const id of deleted) os.delete(id);
  dirty.clear();
  deleted.clear();
}

function schedule() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flush, 50);
}

function emit() {
  for (const l of listeners) l();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function list() {
  return [...dashes.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function get(id) {
  return dashes.get(id) || null;
}

export function put(dash) {
  dashes.set(dash.id, { ...dash, updatedAt: Date.now() });
  dirty.add(dash.id);
  deleted.delete(dash.id);
  schedule();
  emit();
}

export function update(id, fn) {
  const cur = dashes.get(id);
  if (!cur) return;
  const next = fn(cur);
  if (next !== cur) put(next);
}

export function remove(id) {
  dashes.delete(id);
  dirty.delete(id);
  deleted.add(id);
  schedule();
  emit();
}
