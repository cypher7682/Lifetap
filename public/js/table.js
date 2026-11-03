// Shared life table: pure, event-sourced logic (see docs/table-architecture.md).
// A table is its event log; everything on screen is a replay of it. No DOM here,
// so the same file can run on the phase 3 server.

export const MAX_PLAYERS = 16;
export const BUNDLE_MS = 4000;
export const TTL_MS = 60 * 60 * 1000;
export const DEFAULT_LIFE = 40;
export const CMDR_LETHAL = 21;
export const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export const PLAYER_COLORS = ["teal", "purple", "amber", "red", "green", "blue", "orange", "pink"];

const rid = () => Math.random().toString(36).slice(2, 10);

export function newCode(rand = cryptoRandom) {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

function cryptoRandom() {
  if (globalThis.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return Math.random();
}

/** names[0] is this device's player and the owner. */
export function createTable({ names, startLife = DEFAULT_LIFE, by, now = Date.now(), code = newCode() }) {
  const players = names.map((name, i) => ({ id: "p" + rid(), name, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }));
  const ops = [{ op: "settings", startLife }, ...players.map((p) => ({ op: "add", p }))];
  return {
    id: "t" + rid(),
    code,
    createdAt: now,
    updatedAt: now,
    owner: players[0]?.id || null,
    me: players[0]?.id || null,
    myDash: null,
    events: [{ seq: 1, t: now, tEnd: now, by, kind: "start", ops }],
  };
}

export function newPlayer(table, name) {
  const used = new Set(state(table).players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[state(table).players.length % PLAYER_COLORS.length];
  return { id: "p" + rid(), name, color };
}

export const expired = (table, now = Date.now()) => now - table.updatedAt > TTL_MS;

// ---------------------------------------------------------------- replay

const cache = new WeakMap();

/** Walk the log: which action events currently count, and which are undone (in order). */
function stacks(events) {
  const done = [];
  const undone = [];
  for (const e of events) {
    if (e.kind === "undo") {
      const i = done.findIndex((x) => x.seq === e.target);
      if (i >= 0) undone.push(done.splice(i, 1)[0]);
    } else if (e.kind === "redo") {
      const i = undone.findIndex((x) => x.seq === e.target);
      if (i >= 0) done.push(undone.splice(i, 1)[0]);
    } else {
      done.push(e);
      if (e.kind === "action") undone.length = 0;
    }
  }
  return { done, undone };
}

/** The table as it stands. Memoised per event log. */
export function state(table) {
  const hit = cache.get(table.events);
  if (hit) return hit;
  const { done, undone } = stacks(table.events);
  const s = { startLife: DEFAULT_LIFE, byId: {}, order: [], monarch: null };
  for (const e of [...done].sort((a, b) => a.seq - b.seq)) for (const op of e.ops) applyOp(s, op);
  const players = s.order.map((id) => s.byId[id]);
  const out = {
    startLife: s.startLife,
    players, // every player ever added, including removed ones (for history names)
    seats: players.filter((p) => !p.removed),
    byId: s.byId,
    monarch: s.monarch,
    done,
    undone,
    undoable: [...done].reverse().find((e) => e.kind === "action") || null,
    redoable: undone.length ? undone[undone.length - 1] : null,
  };
  cache.set(table.events, out);
  return out;
}

function applyOp(s, o) {
  const P = s.byId;
  switch (o.op) {
    case "settings":
      s.startLife = o.startLife;
      return;
    case "add":
      if (P[o.p.id]) {
        P[o.p.id].removed = false;
        return;
      }
      P[o.p.id] = { ...o.p, life: s.startLife, cmdr: {}, partners: false, dead: false, removed: false };
      s.order.push(o.p.id);
      return;
    case "reset":
      for (const id of s.order) Object.assign(P[id], { life: s.startLife, cmdr: {}, dead: false });
      s.monarch = null;
      return;
    case "monarch":
      if (o.p && !live(P, o.p)) return;
      s.monarch = o.p || null;
      return;
  }
  const p = P[o.p || o.to];
  if (!p || p.removed) return;
  switch (o.op) {
    case "remove":
      p.removed = true;
      if (s.monarch === p.id) s.monarch = null;
      return;
    case "rename":
      p.name = o.name;
      return;
    case "life":
      p.life += o.d;
      return;
    case "cmdr": {
      if (!P[o.from]) return;
      const pair = (p.cmdr[o.from] ||= [0, 0]);
      const d = Math.max(-pair[o.part], o.d); // commander damage stops at 0
      pair[o.part] += d;
      p.life -= d;
      return;
    }
    case "partners":
      p.partners = !!o.on;
      return;
    case "dead":
      p.dead = !!o.on;
      return;
  }
}
const live = (P, id) => P[id] && !P[id].removed;

/** Commander damage `to` has taken from `from`: [I, II]. */
export function cmdrOf(s, to, from) {
  return s.byId[to]?.cmdr[from] || [0, 0];
}

// ---------------------------------------------------------------- writing

const BUNDLED = new Set(["life", "cmdr"]);
const opKey = (o) => (o.op === "life" ? "l:" + o.p : `c:${o.to}:${o.from}:${o.part}`);

function append(table, ev, now) {
  const seq = (table.events.length ? table.events[table.events.length - 1].seq : 0) + 1;
  return { ...table, updatedAt: now, events: [...table.events, { seq, t: now, tEnd: now, ...ev }] };
}

/** Is the last event an open bundle from this device? */
export function openBundle(table, by, now = Date.now()) {
  const last = table.events[table.events.length - 1];
  if (!last || last.kind !== "action" || last.by !== by || now - last.tEnd > BUNDLE_MS) return null;
  if (!last.ops.every((o) => BUNDLED.has(o.op))) return null;
  if (!state(table).done.includes(last)) return null;
  return last;
}

/** Record an action. Life / commander-damage taps merge into this device's open bundle. */
export function act(table, ops, by, now = Date.now()) {
  ops = ops.filter((o) => !(BUNDLED.has(o.op) && !o.d));
  if (!ops.length) return table;
  const last = ops.every((o) => BUNDLED.has(o.op)) ? openBundle(table, by, now) : null;
  if (!last) return append(table, { by, kind: "action", ops }, now);
  const merged = last.ops.map((o) => ({ ...o }));
  for (const o of ops) {
    const m = merged.find((x) => opKey(x) === opKey(o));
    if (m) m.d += o.d;
    else merged.push({ ...o });
  }
  const kept = merged.filter((o) => o.d);
  const events = table.events.slice(0, -1);
  if (kept.length) events.push({ ...last, tEnd: now, ops: kept });
  return { ...table, updatedAt: now, events };
}

export function undo(table, by, now = Date.now()) {
  const e = state(table).undoable;
  return e ? append(table, { by, kind: "undo", target: e.seq }, now) : table;
}

export function redo(table, by, now = Date.now()) {
  const e = state(table).redoable;
  return e ? append(table, { by, kind: "redo", target: e.seq }, now) : table;
}

/** Net life change per player in this device's open bundle, for the delta badges. */
export function bundleDeltas(table, by, now = Date.now()) {
  const last = openBundle(table, by, now);
  const out = {};
  if (!last) return out;
  for (const o of last.ops) {
    const id = o.op === "life" ? o.p : o.to;
    out[id] = (out[id] || 0) + (o.op === "life" ? o.d : -o.d);
  }
  return out;
}

// ---------------------------------------------------------------- labels

const sgn = (n) => (n > 0 ? "+" + n : "−" + Math.abs(n));

export function describeOp(s, o) {
  const name = (id) => (id && s.byId[id] ? s.byId[id].name : "someone");
  switch (o.op) {
    case "settings": return `Starting life ${o.startLife}`;
    case "add": return `${o.p.name} joined`;
    case "remove": return `${name(o.p)} removed`;
    case "rename": return `${o.was} is now ${o.name}`;
    case "life": return `${name(o.p)} ${sgn(o.d)}`;
    case "cmdr": {
      const src = name(o.from) + "’s commander" + (s.byId[o.from]?.partners || o.part ? (o.part ? " II" : " I") : "");
      return o.d > 0 ? `${name(o.to)} took ${o.d} from ${src}` : `${name(o.to)} ${Math.abs(o.d)} back from ${src}`;
    }
    case "partners": return `${name(o.p)}’s commander ${o.on ? "split (partners)" : "unsplit"}`;
    case "dead": return o.on ? `${name(o.p)} died` : `${name(o.p)} is back`;
    case "monarch":
      return o.p ? `${name(o.p)} is Monarch${o.was ? ` (was ${name(o.was)})` : ""}` : `Nobody is Monarch${o.was ? ` (was ${name(o.was)})` : ""}`;
    case "reset": return "Table reset";
  }
  return o.op;
}

export function describe(table, e) {
  const s = state(table);
  if (e.kind === "start") return "Table started";
  if (e.kind === "undo" || e.kind === "redo") {
    const t = table.events.find((x) => x.seq === e.target);
    return `${e.kind === "undo" ? "Undid" : "Redid"}: ${t ? describe(table, t) : "#" + e.target}`;
  }
  return e.ops.map((o) => describeOp(s, o)).join(", ");
}

// ---------------------------------------------------------------- layout

/**
 * Seat grid: two per row, rows = ceil(n / 2); an odd last player gets a full-width row.
 * Two (or one) players get a full-width row each, facing each other.
 * Returns [{row, col, span}] in seat order, plus the row count.
 */
export function seatGrid(n) {
  if (n <= 2) return { rows: n, cells: Array.from({ length: n }, (_, i) => ({ row: i, col: 0, span: 2 })) };
  const rows = Math.ceil(n / 2);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 2);
    cells.push(n % 2 && i === n - 1 ? { row, col: 0, span: 2 } : { row, col: i % 2, span: 1 });
  }
  return { rows, cells };
}

/**
 * Which way a card faces: toward the edge of the table area it shares the most length with
 * (ties go to the side edges). Returns the CSS rotation: 0 bottom, 180 top, 90 left, −90 right.
 */
export function facing(cell, rows, w, h) {
  const cw = (w / 2) * cell.span;
  const ch = h / rows;
  const edges = [];
  if (cell.col === 0) edges.push([ch, 90]);
  if (cell.col + cell.span === 2) edges.push([ch, -90]);
  if (cell.row === 0) edges.push([cw, 180]);
  if (cell.row === rows - 1) edges.push([cw, 0]);
  edges.sort((a, b) => b[0] - a[0]);
  return edges.length ? edges[0][1] : 0;
}
