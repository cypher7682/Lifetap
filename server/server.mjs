// Lifetap table server. Zero dependencies: node:http, node:sqlite, and the same
// pure table engine the app uses (table.js is copied next to this file on deploy).
// See docs/table-architecture.md for the design.
//
//   POST /api/tables                      create a table          {names, startLife, device} → {table, token, me}
//   GET  /api/tables/:id?token=           snapshot                → {table, me, members, requests}
//   GET  /api/tables/:id/stream?token=    live updates (SSE)
//   POST /api/tables/:id/act              {token, cid, ops} | {token, cid, kind: "undo" | "redo"}
//   POST /api/tables/:id/leave            {token}
//   POST /api/tables/:id/requests/:req    owner answers a join    {token, approve, seat}
//   POST /api/join                        ask to join             {code, name, device} → {reqId}
//   GET  /api/join/:req                   poll the answer         → {status, tableId?, token?, me?}
//   GET  /api/health

import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import * as T from "./table.js";

const PORT = +process.env.PORT || 8080;
const MAX_BODY = 64 * 1024;
const REQUEST_TTL = 2 * 60 * 1000;

// ---------------------------------------------------------------- storage

const db = new DatabaseSync(process.env.DB_PATH || "lifetap.db");
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, owner TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE IF NOT EXISTS events (table_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (table_id, seq));
  CREATE TABLE IF NOT EXISTS members (table_id TEXT NOT NULL, token_hash TEXT NOT NULL, device TEXT, player_id TEXT, name TEXT, joined_at INTEGER, PRIMARY KEY (table_id, token_hash));
`);
const q = {
  insTable: db.prepare("INSERT INTO tables (id, code, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
  updTable: db.prepare("UPDATE tables SET owner = ?, updated_at = ? WHERE id = ?"),
  delTable: db.prepare("DELETE FROM tables WHERE id = ?"),
  putEvent: db.prepare("INSERT OR REPLACE INTO events (table_id, seq, data) VALUES (?, ?, ?)"),
  delEvent: db.prepare("DELETE FROM events WHERE table_id = ? AND seq = ?"),
  delEvents: db.prepare("DELETE FROM events WHERE table_id = ?"),
  insMember: db.prepare("INSERT INTO members (table_id, token_hash, device, player_id, name, joined_at) VALUES (?, ?, ?, ?, ?, ?)"),
  delMember: db.prepare("DELETE FROM members WHERE table_id = ? AND token_hash = ?"),
  delMembers: db.prepare("DELETE FROM members WHERE table_id = ?"),
};

/** Live tables: id → {table, members: [{hash, device, player, name, joinedAt}], requests: Map, streams: Set} */
const live = new Map();
const byCode = new Map();

function loadAll() {
  for (const r of db.prepare("SELECT * FROM tables").all()) {
    const events = db.prepare("SELECT data FROM events WHERE table_id = ? ORDER BY seq").all(r.id).map((e) => JSON.parse(e.data));
    const members = db.prepare("SELECT * FROM members WHERE table_id = ? ORDER BY joined_at").all(r.id)
      .map((m) => ({ hash: m.token_hash, device: m.device, player: m.player_id, name: m.name, joinedAt: m.joined_at }));
    const table = { id: r.id, code: r.code, owner: r.owner, createdAt: r.created_at, updatedAt: r.updated_at, events };
    live.set(r.id, { table, members, requests: new Map(), streams: new Set() });
    byCode.set(r.code, r.id);
  }
}
loadAll();

/** Write whatever changed in the event log (appends, an amended bundle, a bundle that netted to zero). */
function persist(entry, before) {
  const t = entry.table;
  const was = new Map(before.events.map((e) => [e.seq, e]));
  const now = new Map(t.events.map((e) => [e.seq, e]));
  let from = Infinity;
  db.exec("BEGIN");
  try {
    for (const e of t.events.slice(-3)) {
      if (was.get(e.seq) !== e) { q.putEvent.run(t.id, e.seq, JSON.stringify(e)); from = Math.min(from, e.seq); }
    }
    for (const e of before.events.slice(-3)) {
      if (!now.has(e.seq)) { q.delEvent.run(t.id, e.seq); from = Math.min(from, e.seq); }
    }
    q.updTable.run(t.owner, t.updatedAt, t.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return from;
}

// ---------------------------------------------------------------- helpers

const token = () => randomBytes(16).toString("hex");
const hash = (s) => createHash("sha256").update(String(s)).digest("hex");
const clean = (s, n = 24) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);

function uniqueCode() {
  for (let i = 0; i < 200; i++) {
    const c = T.newCode();
    if (!byCode.has(c)) return c;
  }
  throw new Error("out of codes");
}

const buckets = new Map();
/** Allow `n` hits per `ms` for `key`. */
function limited(key, n, ms) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < ms);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > n;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) if (!hits.some((t) => now - t < 5 * 60 * 1000)) buckets.delete(k);
}, 60 * 1000).unref();

function member(entry, tok) {
  if (!tok) return null;
  const h = hash(tok);
  return entry.members.find((m) => m.hash === h) || null;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

// ---------------------------------------------------------------- broadcasting

function pendingRequests(entry) {
  const now = Date.now();
  return [...entry.requests.values()].filter((r) => r.status === "pending" && now - r.created < REQUEST_TTL).map((r) => ({ reqId: r.reqId, name: r.name }));
}

function snapshot(entry, m) {
  const t = entry.table;
  return {
    table: { id: t.id, code: t.code, owner: t.owner, createdAt: t.createdAt, updatedAt: t.updatedAt, events: t.events },
    me: m.player,
    members: entry.members.map((x) => ({ player: x.player, name: x.name })),
    requests: m.player === t.owner ? pendingRequests(entry) : [],
  };
}

function write(entry, s, text) {
  if (s.res.writableEnded || s.res.destroyed) return entry.streams.delete(s);
  s.res.write(text);
}

function push(entry, msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const s of [...entry.streams]) write(entry, s, data);
}

/** Tell everyone what changed: the event log from `from` on, plus owner/members/requests. */
function broadcast(entry, from, extra = {}) {
  const t = entry.table;
  const events = from === Infinity ? [] : t.events.filter((e) => e.seq >= from);
  const base = { type: "update", from: from === Infinity ? null : from, events, owner: t.owner, updatedAt: t.updatedAt, members: entry.members.map((x) => ({ player: x.player, name: x.name })), ...extra };
  for (const s of [...entry.streams]) {
    const msg = { ...base, requests: s.member.player === t.owner ? pendingRequests(entry) : undefined };
    write(entry, s, `data: ${JSON.stringify(msg)}\n\n`);
  }
}

function apply(entry, by, fn, extra) {
  const before = entry.table;
  const next = fn(before);
  if (next === before) return null;
  entry.table = next;
  const from = persist(entry, before);
  broadcast(entry, from, extra);
  return from === Infinity ? null : from;
}

function closeTable(entry, why) {
  push(entry, { type: "gone", why });
  for (const s of entry.streams) s.res.end();
  q.delEvents.run(entry.table.id);
  q.delMembers.run(entry.table.id);
  q.delTable.run(entry.table.id);
  live.delete(entry.table.id);
  byCode.delete(entry.table.code);
}

// tables die after an hour with no events
setInterval(() => {
  for (const entry of [...live.values()]) if (T.expired(entry.table)) closeTable(entry, "expired");
}, 60 * 1000).unref();

// keep streams open through proxies
setInterval(() => {
  for (const entry of live.values()) for (const s of [...entry.streams]) write(entry, s, ": ping\n\n");
}, 25 * 1000).unref();

// ---------------------------------------------------------------- routes

async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (parts[0] !== "api") return send(res, 404, { error: "not found" });
  const [, a, id, b, c] = parts;

  if (a === "health") return send(res, 200, { ok: true, tables: live.size });

  if (req.method === "POST" && a === "tables" && !id) {
    if (limited("create:" + ip(req), 20, 60 * 60 * 1000)) return send(res, 429, { error: "Too many tables. Try later." });
    const body = await readBody(req);
    const names = (Array.isArray(body.names) ? body.names : []).map((n, i) => clean(n) || `Player ${i + 1}`).slice(0, T.MAX_PLAYERS);
    if (!names.length) names.push("Player 1");
    const startLife = Math.max(1, Math.min(9999, parseInt(body.startLife, 10) || T.DEFAULT_LIFE));
    const device = clean(body.device, 40) || "d" + token().slice(0, 8);
    const table = T.createTable({ names, startLife, by: device, code: uniqueCode() });
    const tok = token();
    const m = { hash: hash(tok), device, player: table.owner, name: names[0], joinedAt: Date.now() };
    const entry = { table: { ...table, me: undefined, myDash: undefined }, members: [m], requests: new Map(), streams: new Set() };
    delete entry.table.me;
    delete entry.table.myDash;
    q.insTable.run(table.id, table.code, table.owner, table.createdAt, table.updatedAt);
    for (const e of table.events) q.putEvent.run(table.id, e.seq, JSON.stringify(e));
    q.insMember.run(table.id, m.hash, m.device, m.player, m.name, m.joinedAt);
    live.set(table.id, entry);
    byCode.set(table.code, table.id);
    return send(res, 200, { ...snapshot(entry, m), token: tok });
  }

  if (req.method === "POST" && a === "join" && !id) {
    const body = await readBody(req);
    const code = clean(body.code, 8).toLowerCase();
    if (limited("join:" + ip(req), 10, 60 * 1000) || limited("joincode:" + code, 30, 60 * 1000)) return send(res, 429, { error: "Too many tries. Wait a minute." });
    const entry = live.get(byCode.get(code));
    if (!entry) return send(res, 404, { error: "No table with that code." });
    const r = { reqId: token(), name: clean(body.name) || "", device: clean(body.device, 40), status: "pending", created: Date.now() };
    entry.requests.set(r.reqId, r);
    broadcast(entry, Infinity);
    return send(res, 200, { reqId: r.reqId, tableId: entry.table.id });
  }

  if (req.method === "GET" && a === "join" && id) {
    for (const entry of live.values()) {
      const r = entry.requests.get(id);
      if (!r) continue;
      if (r.status === "pending" && Date.now() - r.created > REQUEST_TTL) r.status = "expired";
      const out = { status: r.status, tableId: entry.table.id };
      if (r.status === "approved") Object.assign(out, { token: r.token, me: r.player });
      return send(res, 200, out);
    }
    return send(res, 404, { status: "gone" });
  }

  const entry = id && live.get(id);
  if (a === "tables" && !entry) return send(res, 404, { error: "That table has closed." });

  if (req.method === "GET" && a === "tables" && !b) {
    const m = member(entry, url.searchParams.get("token"));
    if (!m) return send(res, 403, { error: "Not at this table." });
    return send(res, 200, snapshot(entry, m));
  }

  if (req.method === "GET" && a === "tables" && b === "stream") {
    const m = member(entry, url.searchParams.get("token"));
    if (!m) return send(res, 403, { error: "Not at this table." });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...CORS });
    res.write("retry: 2000\n\n");
    res.write(`data: ${JSON.stringify({ type: "snapshot", ...snapshot(entry, m) })}\n\n`);
    const s = { res, member: m };
    entry.streams.add(s);
    req.on("close", () => entry.streams.delete(s));
    return;
  }

  if (req.method !== "POST" || a !== "tables") return send(res, 404, { error: "not found" });
  const body = await readBody(req);
  const m = member(entry, body.token);
  if (!m) return send(res, 403, { error: "Not at this table." });

  if (b === "act") {
    if (limited("act:" + m.hash, 40, 1000)) return send(res, 429, { error: "Slow down." });
    const cid = clean(body.cid, 40);
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 40) : [];
    const fn = body.kind === "undo" ? (t) => T.undo(t, m.device) : body.kind === "redo" ? (t) => T.redo(t, m.device) : (t) => T.act(t, ops, m.device);
    const from = apply(entry, m.device, fn, { cids: cid ? [cid] : [] });
    // the reply carries the change too, so the sender doesn't wait on (or race) its stream
    const t = entry.table;
    return send(res, 200, { ok: true, cid, from: from ?? null, events: from == null ? [] : t.events.filter((e) => e.seq >= from), owner: t.owner, updatedAt: t.updatedAt });
  }

  if (b === "requests" && c) {
    if (m.player !== entry.table.owner) return send(res, 403, { error: "Only the table owner can let people in." });
    const r = entry.requests.get(c);
    if (!r || r.status !== "pending") return send(res, 404, { error: "That request has gone." });
    if (!body.approve) {
      r.status = "denied";
      broadcast(entry, Infinity);
      return send(res, 200, { ok: true });
    }
    const s = T.state(entry.table);
    let player = body.seat && s.seats.find((p) => p.id === body.seat && !entry.members.some((x) => x.player === p.id));
    if (!player && s.seats.length >= T.MAX_PLAYERS) return send(res, 409, { error: `${T.MAX_PLAYERS} players is the limit.` });
    const tok = token();
    const ops = [];
    if (player) {
      if (r.name && r.name !== player.name) ops.push({ op: "rename", p: player.id, name: r.name, was: player.name });
    } else {
      player = T.newPlayer(entry.table, r.name || `Player ${s.seats.length + 1}`);
      ops.push({ op: "add", p: player });
    }
    const nm = { hash: hash(tok), device: r.device || "d" + token().slice(0, 8), player: player.id, name: r.name || player.name, joinedAt: Date.now() };
    entry.members.push(nm);
    q.insMember.run(entry.table.id, nm.hash, nm.device, nm.player, nm.name, nm.joinedAt);
    Object.assign(r, { status: "approved", token: tok, player: player.id });
    if (!ops.length || !apply(entry, m.device, (t) => T.act(t, ops, m.device))) broadcast(entry, Infinity);
    return send(res, 200, { ok: true });
  }

  if (b === "leave") {
    entry.members = entry.members.filter((x) => x !== m);
    q.delMember.run(entry.table.id, m.hash);
    for (const s of [...entry.streams]) if (s.member === m) { entry.streams.delete(s); s.res.end(); }
    let notice;
    if (entry.table.owner === m.player) {
      const next = entry.members.find((x) => x.player !== m.player);
      entry.table = { ...entry.table, owner: next ? next.player : null };
      q.updTable.run(entry.table.owner, entry.table.updatedAt, entry.table.id);
      if (next) notice = { newOwner: next.player };
    }
    broadcast(entry, Infinity, notice);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "not found" });
}

http
  .createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : "Server error" });
      if (!err.status) console.error(err);
    });
  })
  .listen(PORT, () => console.log(`lifetap table server on :${PORT}, ${live.size} live tables`));
