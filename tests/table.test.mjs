import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../public/js/table.js";

const mk = (names = ["Tim", "Uyop", "Sam"], startLife = 40) => T.createTable({ names, startLife, by: "A", now: 0, code: "ab12" });
const ids = (t) => T.state(t).seats.map((p) => p.id);
const life = (t, i) => T.state(t).seats[i].life;

test("create: players at starting life, owner is first", () => {
  const t = mk();
  const s = T.state(t);
  assert.equal(s.seats.length, 3);
  assert.deepEqual(s.seats.map((p) => p.life), [40, 40, 40]);
  assert.equal(t.owner, s.seats[0].id);
  assert.match(T.newCode(), /^[a-z0-9]{4}$/);
});

test("taps from one device within 4s bundle into one event; undo takes the lot", () => {
  let t = mk();
  const [a] = ids(t);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 1000);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 3000);
  t = T.act(t, [{ op: "life", p: a, d: -5 }], "A", 6500); // 3.5s after the last tap: still open
  assert.equal(t.events.length, 2);
  assert.equal(life(t, 0), 33);
  assert.equal(T.describe(t, t.events[1]), "Tim −7");
  t = T.undo(t, "A", 7000);
  assert.equal(life(t, 0), 40);
  t = T.redo(t, "A", 7100);
  assert.equal(life(t, 0), 33);
});

test("bundles close after 4s, on another device's tap, and on non-life actions", () => {
  let t = mk();
  const [a, b] = ids(t);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 1000);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 5001);
  assert.equal(t.events.length, 3);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "B", 5100);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 5200);
  assert.equal(t.events.length, 5);
  t = T.act(t, [{ op: "monarch", p: b, was: null }], "A", 5300);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 5400);
  assert.equal(t.events.length, 7);
});

test("a bundle that nets to zero disappears", () => {
  let t = mk();
  const [a] = ids(t);
  t = T.act(t, [{ op: "life", p: a, d: 1 }], "A", 1000);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 1500);
  assert.equal(t.events.length, 1);
});

test("commander damage comes off life, can't go below 0, and splits for partners", () => {
  let t = mk();
  const [a, b] = ids(t);
  t = T.act(t, [{ op: "cmdr", to: a, from: b, part: 0, d: 5 }], "A", 1000);
  let s = T.state(t);
  assert.equal(s.byId[a].life, 35);
  assert.deepEqual(T.cmdrOf(s, a, b), [5, 0]);
  t = T.act(t, [{ op: "cmdr", to: a, from: b, part: 0, d: -9 }], "B", 2000);
  s = T.state(t);
  assert.deepEqual(T.cmdrOf(s, a, b), [0, 0]);
  assert.equal(s.byId[a].life, 40);
  t = T.act(t, [{ op: "partners", p: b, on: true }], "A", 3000);
  t = T.act(t, [{ op: "cmdr", to: a, from: b, part: 1, d: 3 }], "A", 4000);
  s = T.state(t);
  assert.ok(s.byId[b].partners);
  assert.deepEqual(T.cmdrOf(s, a, b), [0, 3]);
  assert.match(T.describe(t, t.events[t.events.length - 1]), /Tim took 3 from Uyop’s commander II/);
});

test("undo is an event: history only grows, and a new action clears redo", () => {
  let t = mk();
  const [a] = ids(t);
  t = T.act(t, [{ op: "life", p: a, d: -3 }], "A", 1000);
  t = T.undo(t, "B", 9000);
  assert.equal(t.events.length, 3);
  assert.equal(T.state(t).redoable.seq, 2);
  t = T.act(t, [{ op: "life", p: a, d: -1 }], "A", 20000);
  assert.equal(T.state(t).redoable, null);
  assert.equal(life(t, 0), 39);
  // undo walks back past the start? never
  t = T.undo(t, "A", 20100);
  t = T.undo(t, "A", 20200);
  assert.equal(T.state(t).seats.length, 3);
});

test("monarch moves with a 'was', kill/revive, reset", () => {
  let t = mk();
  const [a, b] = ids(t);
  t = T.act(t, [{ op: "monarch", p: a, was: null }], "A", 1);
  t = T.act(t, [{ op: "monarch", p: b, was: a }], "A", 2);
  assert.equal(T.state(t).monarch, b);
  assert.equal(T.describe(t, t.events[t.events.length - 1]), "Uyop is Monarch (was Tim)");
  t = T.act(t, [{ op: "dead", p: a, on: true }], "A", 3);
  t = T.act(t, [{ op: "life", p: a, d: -340 }], "A", 4);
  assert.equal(life(t, 0), -300);
  t = T.act(t, [{ op: "reset" }], "A", 5);
  const s = T.state(t);
  assert.equal(s.byId[a].life, 40);
  assert.equal(s.byId[a].dead, false);
  assert.equal(s.monarch, null);
});

test("removed players keep their names in history; undoing an add skips their later ops", () => {
  let t = mk(["Tim"]);
  const p = T.newPlayer(t, "Dave");
  t = T.act(t, [{ op: "add", p }], "A", 1);
  t = T.act(t, [{ op: "life", p: p.id, d: -2 }], "A", 2);
  t = T.act(t, [{ op: "remove", p: p.id }], "A", 3);
  assert.equal(T.state(t).seats.length, 1);
  assert.equal(T.describe(t, t.events[2]), "Dave −2");
});

test("seat grid: rows = ceil(n/2), odd last player full width, two face each other", () => {
  assert.deepEqual(T.seatGrid(2).cells.map((c) => c.span), [2, 2]);
  const g3 = T.seatGrid(3);
  assert.equal(g3.rows, 2);
  assert.deepEqual(g3.cells[2], { row: 1, col: 0, span: 2 });
  assert.equal(T.seatGrid(16).rows, 8);
  // portrait phone, 428 × 700 table area
  const f = (n) => { const g = T.seatGrid(n); return g.cells.map((c) => T.facing(c, g.rows, 428, 700)); };
  assert.deepEqual(f(2), [180, 0]);
  assert.deepEqual(f(3), [90, -90, 0]); // the sketch: two sideways, the full-width one at the end
  assert.deepEqual(f(4), [90, -90, 90, -90]);
});

test("TTL", () => {
  const t = mk();
  assert.equal(T.expired(t, T.TTL_MS), false);
  assert.equal(T.expired(t, T.TTL_MS + 1), true);
});

test("first player: picked at the start, re-picked on reset, undo restores the old one", () => {
  let t = T.createTable({ names: ["A", "B", "C"], by: "A", now: 0, code: "ab12", rand: () => 0.5 });
  const [a, b, c] = ids(t);
  assert.equal(T.state(t).first, b);
  assert.match(T.describe(t, t.events[0]), /Table started · B goes first/);
  t = T.act(t, T.resetOps(t, () => 0.9), "A", 10);
  assert.equal(T.state(t).first, c);
  assert.equal(T.describe(t, t.events[1]), "Table reset · C goes first");
  t = T.undo(t, "A", 20);
  assert.equal(T.state(t).first, b);
  t = T.act(t, [{ op: "remove", p: b }], "A", 30);
  assert.equal(T.state(t).first, null);
  assert.deepEqual(T.clockwise(5), [1, 3, 4, 2, 0]);
});
