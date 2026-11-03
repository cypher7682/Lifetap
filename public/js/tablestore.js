import { expired } from "./table.js";
// Tables on this device, in their own IndexedDB database so dash data is never touched.
// Phase 1 keeps the whole event log here; phase 3 mirrors the server's copy.

const DB_NAME = "lifetap-tables";
const STORE = "tables";
const DEVICE_KEY = "lifetap:device";

let db = null;
const tables = new Map();
const listeners = new Set();

export const deviceId = (() => {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) localStorage.setItem(DEVICE_KEY, (id = "d" + Math.random().toString(36).slice(2, 12)));
  return id;
})();

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function load() {
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
    db = await req(open);
    for (const t of await req(db.transaction(STORE).objectStore(STORE).getAll())) tables.set(t.id, t);
  } catch (e) {
    console.warn("tables: IndexedDB unavailable, falling back to localStorage", e);
    db = null;
    for (const t of JSON.parse(localStorage.getItem(DB_NAME) || "[]")) tables.set(t.id, t);
  }
  sweep();
  setInterval(sweep, 60 * 1000);
}

/** Drop tables nobody has touched for an hour. */
function sweep() {
  for (const t of [...tables.values()]) if (expired(t)) remove(t.id);
}

function persist(id) {
  if (!db) return localStorage.setItem(DB_NAME, JSON.stringify([...tables.values()]));
  const os = db.transaction(STORE, "readwrite").objectStore(STORE);
  tables.has(id) ? os.put(tables.get(id)) : os.delete(id);
}

const emit = () => listeners.forEach((l) => l());

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const get = (id) => tables.get(id) || null;
export const all = () => [...tables.values()];

/** The live table on this device (one at a time), if any. */
export function current() {
  let best = null;
  for (const t of tables.values()) if (!expired(t) && (!best || t.updatedAt > best.updatedAt)) best = t;
  return best;
}

export function put(t) {
  tables.set(t.id, t);
  persist(t.id);
  emit();
}

export function update(id, fn) {
  const cur = tables.get(id);
  if (!cur) return;
  const next = fn(cur);
  if (next !== cur) put(next);
}

export function remove(id) {
  if (!tables.delete(id)) return;
  persist(id);
  emit();
}
