import * as tables from "./tablestore.js";
import * as sync from "./sync.js";
import * as T from "./table.js";
// What the dash's macro engine needs to know about the table you're at, and how it sends life changes there.

/** {id, me, quick, seats: [{id, name, dead}], rand} for the live table, or null. quick = an offline counters-only table. */
export function tableContext() {
  const t = tables.current();
  if (!t) return null;
  const s = T.state(t);
  return { id: t.id, me: t.me, quick: !!t.quick, seats: s.seats.map((p) => ({ id: p.id, name: p.name, dead: p.dead })), rand: Math.random };
}

/** Send changes [{p, d, stat?}] to a table as one action (no stat = life; else a player counter). */
export function sendLife(tableId, ops) {
  const t = tables.get(tableId);
  const out = ops.filter((o) => o.d).map((o) => (o.stat && o.stat !== "life" ? { op: "counter", p: o.p, name: o.stat, d: o.d } : { op: "life", p: o.p, d: o.d }));
  if (!t || !out.length) return false;
  if (t.online) sync.act(tableId, { ops: out });
  else tables.update(tableId, (x) => T.act(x, out, tables.deviceId));
  return true;
}

/** "Dave −2, Tim +1, Alex Poison +1" for a toast. */
export function describeLife(tableId, ops) {
  const t = tables.get(tableId);
  const s = t && T.state(t);
  return ops.map((o) => `${s?.byId[o.p]?.name || "someone"}${o.stat && o.stat !== "life" ? " " + o.stat : ""} ${o.d > 0 ? "+" : "−"}${Math.abs(o.d)}`).join(", ");
}

/** Reverse of a set of changes (for dash undo). */
export const reverse = (ops) => ops.map((o) => ({ ...o, d: -o.d }));
