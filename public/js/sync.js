import * as tables from "./tablestore.js";
import * as T from "./table.js";
import { API_URL } from "./config.js";
import { snack, toast } from "./ui.js";
// Keeps online tables in step with the table server. The server's event log is the truth;
// this phone's own unsent actions are replayed on top of it so taps show up instantly.

const conns = new Map(); // tableId → {es, server, pending: [{cid, ops | kind}], inflight, status, members, requests}
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const info = (id) => conns.get(id) || null;

async function call(path, body) {
  let r;
  try {
    r = await fetch(API_URL + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  } catch {
    throw Object.assign(new Error("Couldn't reach the table server."), { network: true });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "The table server said no."), { status: r.status });
  return j;
}

const cid = () => Math.random().toString(36).slice(2, 12);

/** Write the server's table plus our unsent actions into the local copy. */
function mirror(id) {
  const c = conns.get(id);
  const local = tables.get(id);
  if (!c || !c.server || !local) return;
  let t = { ...local, code: c.server.code, owner: c.server.owner, createdAt: c.server.createdAt, updatedAt: c.server.updatedAt, events: c.server.events };
  for (const p of c.pending) t = p.kind === "undo" ? T.undo(t, tables.deviceId) : p.kind === "redo" ? T.redo(t, tables.deviceId) : T.act(t, p.ops, tables.deviceId);
  tables.put(t);
}

function merge(c, m) {
  if (m.from != null) c.server = { ...c.server, events: [...c.server.events.filter((e) => e.seq < m.from), ...m.events] };
  if (m.owner !== undefined) c.server = { ...c.server, owner: m.owner };
  if (m.updatedAt) c.server = { ...c.server, updatedAt: m.updatedAt };
  if (m.members) c.members = m.members;
  if (m.requests) c.requests = m.requests;
}

function drop(id, why) {
  const c = conns.get(id);
  if (c) c.es.close();
  conns.delete(id);
  tables.remove(id);
  if (why) toast(why);
  emit();
}

export function connect(id) {
  const t = tables.get(id);
  if (!t || !t.online || conns.has(id)) return;
  const es = new EventSource(`${API_URL}/api/tables/${id}/stream?token=${encodeURIComponent(t.online.token)}`);
  const c = { es, server: null, pending: [], inflight: false, status: "connecting", members: [], requests: [] };
  conns.set(id, c);
  es.onopen = () => { c.status = "live"; emit(); flush(id); };
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "gone") return drop(id, m.why === "expired" ? "The table closed after an hour with nothing happening." : "The table has closed.");
    if (m.type === "snapshot") {
      c.server = m.table;
      c.members = m.members;
      c.requests = m.requests || [];
      const local = tables.get(id);
      if (local && local.me !== m.me) tables.put({ ...local, me: m.me });
    } else {
      merge(c, m);
      if (m.cids) c.pending = c.pending.filter((p) => !m.cids.includes(p.cid));
      const me = tables.get(id)?.me;
      if (m.newOwner && m.newOwner === me) snack("You're the table owner now");
    }
    c.status = "live";
    mirror(id);
    emit();
  };
  es.onerror = async () => {
    c.status = "reconnecting";
    emit();
    if (es.readyState !== EventSource.CLOSED) return; // the browser retries by itself
    // it gave up: the table may have gone, or we were removed
    try {
      await call(`/api/tables/${id}?token=${encodeURIComponent(t.online.token)}`);
      conns.delete(id);
      setTimeout(() => connect(id), 3000);
    } catch (e) {
      if (e.status === 404) drop(id, "That table has closed.");
      else if (e.status === 403) drop(id, "You're no longer at that table.");
      else { conns.delete(id); setTimeout(() => connect(id), 5000); }
    }
  };
  emit();
}

/** Send queued actions one at a time, in order. */
async function flush(id) {
  const c = conns.get(id);
  const t = tables.get(id);
  if (!c || !t || c.inflight || !c.pending.length) return;
  const p = c.pending[0];
  c.inflight = true;
  c.sending = p;
  try {
    const res = await call(`/api/tables/${id}/act`, { token: t.online.token, cid: p.cid, ops: p.ops, kind: p.kind });
    merge(c, res);
    c.pending = c.pending.filter((x) => x.cid !== p.cid);
  } catch (e) {
    if (e.network) {
      c.inflight = false;
      c.sending = null;
      c.status = "offline";
      emit();
      setTimeout(() => flush(id), 3000);
      return;
    }
    c.pending = c.pending.filter((x) => x.cid !== p.cid);
    toast(e.message);
  }
  c.inflight = false;
  c.sending = null;
  mirror(id);
  emit();
  flush(id);
}

/** Do something at an online table: shows straight away, then goes to the server. */
export function act(id, payload) {
  const c = conns.get(id);
  if (!c) return;
  c.pending.push({ cid: cid(), ...payload });
  mirror(id);
  flush(id);
}

export async function create({ names, startLife }) {
  const res = await call("/api/tables", { names, startLife, device: tables.deviceId });
  tables.put({ ...res.table, me: res.me, myDash: null, online: { token: res.token } });
  connect(res.table.id);
  return res.table.id;
}

/** Seats still free at a table, for the joiner to pick from. */
export const lookup = (code) => call("/api/lookup", { code: code.trim().toLowerCase() });

export async function askToJoin(code, name, seat) {
  return call("/api/join", { code: code.trim().toLowerCase(), name, seat, device: tables.deviceId });
}
export const joinStatus = (reqId) => call(`/api/join/${reqId}`);

/** After the owner lets us in: fetch the table and start following it. */
export async function enter(tableId, token) {
  const snap = await call(`/api/tables/${tableId}?token=${encodeURIComponent(token)}`);
  tables.put({ ...snap.table, me: snap.me, myDash: null, online: { token } });
  connect(tableId);
}

export async function answer(id, reqId, approve, seat = null) {
  const t = tables.get(id);
  await call(`/api/tables/${id}/requests/${reqId}`, { token: t.online.token, approve, seat });
}

export async function leave(id) {
  const t = tables.get(id);
  try { await call(`/api/tables/${id}/leave`, { token: t.online.token }); } catch {}
  drop(id);
}

/** Follow every online table on this phone. */
export function start() {
  for (const t of tables.all()) if (t.online) connect(t.id);
}
