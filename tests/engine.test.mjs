import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/js/engine.js";

const T = (id, value, name = id, allowNegative = true) => ({ kind: "counter", id, name, icon: "heart", color: "teal", start: 0, value, allowNegative });
const tile = (id) => ({ kind: "tile", tileId: id });
const v = (name) => ({ kind: "var", name });

function altarDash() {
  const cells = [T("mana", 7, "Mana"), T("nad", 12, "Nadier +1/+1"), T("elves", 5, "Elves"), T("milled", 34, "Milled"), T("casts", 0, "Casts"), T("held", 0, "Held ctrs")];
  const macro = {
    id: "m1", name: "Altar sac", icon: "altar", repeats: false,
    vars: [{ name: "power", initial: 0 }],
    steps: [
      { target: tile("mana"), op: "+", value: 1 },
      { target: tile("milled"), op: "+", value: 2 },
      { target: v("power"), op: "=", value: tile("nad") },
      { target: v("power"), op: "+", value: 3 },
      { target: tile("elves"), op: "+", value: v("power") },
      { target: tile("held"), op: "+", value: tile("nad") },
      { target: tile("nad"), op: "=", value: 0 },
      { target: tile("casts"), op: "+", value: 1 },
    ],
  };
  return { ...E.createDash({ name: "Nadier", count: 1, grid: { cols: 2, rows: 3 } }), cells, macros: [macro], bar: ["m1", null, null, null] };
}

test("bestGrid", () => {
  assert.deepEqual([1, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => E.gridKey(E.bestGrid(n))), ["2x2", "2x2", "2x3", "2x3", "2x4", "2x4", "3x3", "3x4", "3x4"]);
});

test("createDash", () => {
  const d = E.createDash({ name: "X", count: 5, grid: { cols: 2, rows: 4 } });
  assert.equal(d.cells.length, 8);
  assert.equal(E.counters(d).length, 5);
  assert.equal(d.cells[0].name, "Counter 1");
  assert.equal(d.bar.length, 4);
  assert.throws(() => E.createDash({ name: "X", count: 5, grid: { cols: 2, rows: 2 } }));
  const big = E.createDash({ name: "Big", count: 12, grid: { cols: 3, rows: 4 } });
  assert.equal(E.counters(big).length, 12);
  assert.equal(new Set(big.cells.map((c) => c.id)).size, 12);
});

test("spec §6.3 Altar sac example", () => {
  const d = altarDash();
  const { changes, skippedBroken, divByZero } = E.runMacro(d, d.macros[0], 1);
  const m = Object.fromEntries(changes.map((c) => [c.tileId, c.to]));
  assert.deepEqual(m, { mana: 8, milled: 36, elves: 20, held: 12, nad: 0, casts: 1 });
  assert.equal(skippedBroken, 0);
  assert.equal(divByZero, false);
});

test("repeats: vars reset each run, N runs in sequence", () => {
  const d = altarDash();
  const { changes } = E.runMacro(d, d.macros[0], 2);
  const m = Object.fromEntries(changes.map((c) => [c.tileId, c.to]));
  // second run: power = 0 + 3 (nad was zeroed), elves 20 + 3
  assert.equal(m.elves, 23);
  assert.equal(m.held, 12);
  assert.equal(m.mana, 9);
  assert.equal(m.casts, 2);
});

test("division floors and skips divide by zero", () => {
  const s = { cells: [T("a", -7), T("z", 0)], macros: [] };
  const mac = { vars: [], steps: [{ target: tile("a"), op: "/", value: 2 }] };
  assert.equal(E.runMacro(s, mac).changes[0].to, -4);
  const r = E.runMacro(s, { vars: [], steps: [{ target: tile("a"), op: "/", value: tile("z") }, { target: tile("a"), op: "*", value: 3 }] });
  assert.equal(r.divByZero, true);
  assert.equal(r.changes[0].to, -21);
});

test("broken references are skipped and counted", () => {
  const s = { cells: [T("a", 1)], macros: [] };
  const mac = { vars: [], steps: [{ target: tile("gone"), op: "+", value: 1 }, { target: tile("a"), op: "+", value: tile("gone") }, { target: tile("a"), op: "+", value: 1 }] };
  const r = E.runMacro(s, mac, 3);
  assert.equal(r.skippedBroken, 2);
  assert.equal(r.changes[0].to, 4);
  assert.equal(E.stepBroken(s, mac, mac.steps[0]), true);
  assert.equal(E.stepBroken(s, mac, mac.steps[2]), false);
});

test("one macro run (with repeats) is one undoable event", () => {
  let d = altarDash();
  const { event } = E.macroEvent(d, d.macros[0], 3);
  d = E.commitEvent(d, event);
  assert.equal(d.log.length, 1);
  assert.equal(d.log[0].label, "Altar sac ×3");
  d = E.undo(d);
  assert.equal(E.findTile(d, "mana").value, 7);
  assert.equal(E.findTile(d, "nad").value, 12);
  d = E.redo(d);
  assert.equal(E.findTile(d, "mana").value, 10);
  // a new action clears redo
  d = E.undo(d);
  d = E.commitEvent(d, E.tapEvent(E.findTile(d, "mana"), 1));
  assert.equal(d.redo.length, 0);
  assert.equal(E.findTile(d, "mana").value, 8);
});

test("long undo history is kept", () => {
  let d = altarDash();
  for (let i = 0; i < 3000; i++) d = E.commitEvent(d, E.tapEvent(E.findTile(d, "mana"), 1));
  assert.equal(d.log.length, 3000);
  for (let i = 0; i < 3000; i++) d = E.undo(d);
  assert.equal(E.findTile(d, "mana").value, 7);
});

test("values write through to the pending draft; draft structure stays pending", () => {
  let d = altarDash();
  d = E.editDraft(d, (s) => E.updateCell(s, 0, { name: "Mana!" }));
  d = E.commitEvent(d, E.tapEvent(E.findTile(E.view(d), "mana"), 5));
  assert.equal(E.findTile(d, "mana").value, 12);
  assert.equal(E.findTile(d, "mana").name, "Mana");
  assert.equal(E.findTile(E.view(d), "mana").value, 12);
  assert.equal(E.findTile(E.view(d), "mana").name, "Mana!");
  const discarded = E.discardDraft(d);
  assert.equal(E.findTile(discarded, "mana").name, "Mana");
  const saved = E.saveDraft(d);
  assert.equal(saved.draft, null);
  assert.equal(E.findTile(saved, "mana").name, "Mana!");
  assert.equal(E.findTile(saved, "mana").value, 12);
});

test("changeGrid blocks when tiles don't fit, keeps order otherwise", () => {
  const d = altarDash(); // 6 tiles in 2x3
  const r = E.changeGrid(d, { cols: 2, rows: 2 });
  assert.deepEqual(r, { ok: false, mustRemove: 2 });
  const g = E.changeGrid(d, { cols: 3, rows: 3 });
  assert.equal(g.structure.cells.length, 9);
  const s2 = E.removeCell(E.removeCell(g.structure, 1), 3);
  const back = E.changeGrid(s2, { cols: 2, rows: 2 });
  assert.equal(back.ok, true);
  assert.deepEqual(back.structure.cells.map((c) => c && c.id), ["mana", "elves", "casts", "held"]);
});

test("macro tile removal deletes macro unless on bar; deleteMacro clears everywhere", () => {
  let s = E.structureOf(altarDash());
  s = E.changeGrid(s, { cols: 3, rows: 3 }).structure;
  const m2 = E.newMacro("Two");
  s = E.upsertMacro(s, m2);
  s = E.moveMacroToGrid(s, m2.id).structure;
  const idx = s.cells.findIndex((c) => c && c.kind === "macro");
  assert.equal(E.removeCell(s, idx).macros.length, 1);
  // put m1 on grid too (it's on the bar) — removing the tile keeps the macro
  s = { ...s, cells: s.cells.map((c, i) => (i === idx ? { kind: "macro", id: "x", macroId: "m1" } : c)) };
  assert.ok(E.findMacro(E.removeCell(s, idx), "m1"));
  const del = E.deleteMacro(s, "m1");
  assert.equal(del.bar[0], null);
  assert.equal(del.cells[idx], null);
});

test("recordingSteps captures net literal deltas", () => {
  const d = altarDash();
  const start = { mana: 5, nad: 12, elves: 9, milled: 34, casts: 0, held: 0 };
  const steps = E.recordingSteps(d, start);
  assert.deepEqual(steps, [
    { target: tile("mana"), op: "+", value: 2 },
    { target: tile("elves"), op: "-", value: 4 },
  ]);
});

test("duplicateDash remaps ids and refs", () => {
  const d = altarDash();
  const c = E.duplicateDash(d, "Copy");
  assert.notEqual(c.id, d.id);
  assert.notEqual(c.cells[0].id, "mana");
  const { changes } = E.runMacro(c, c.macros[0], 1);
  assert.equal(changes.length, 6);
  assert.equal(c.bar[0], c.macros[0].id);
});

test("resetDash restores start and clears history", () => {
  let d = altarDash();
  d = E.commitEvent(d, E.tapEvent(E.findTile(d, "mana"), 1));
  d = E.resetDash(d);
  assert.equal(E.findTile(d, "mana").value, 0);
  assert.equal(d.log.length, 0);
});

test("renameVar updates refs; toInt", () => {
  const m = E.renameVar(altarDash().macros[0], "power", "p");
  assert.equal(m.steps[2].target.name, "p");
  assert.equal(m.steps[4].value.name, "p");
  assert.equal(E.toInt("−12"), -12);
  assert.equal(E.toInt("abc", 3), 3);
  assert.equal(E.toInt("4.5", 0), 0);
});

test("tiles that don't allow negatives reject the whole macro", () => {
  const s = { cells: [T("mana", 3, "Mana", false), T("elves", 1, "Elves")], macros: [] };
  const mac = { vars: [], steps: [
    { target: tile("elves"), op: "+", value: 5 },
    { target: tile("mana"), op: "-", value: 5 },
    { target: tile("mana"), op: "+", value: 10 },
  ] };
  const r = E.runMacro(s, mac);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.blocked, { tileId: "mana", name: "Mana", value: -2 });
  assert.equal(E.blockedMessage(r.blocked), "Would take Mana to −2. Couldn't execute.");
  // repeats: blocked on the run that would go negative
  const pay = { vars: [], steps: [{ target: tile("mana"), op: "-", value: 1 }] };
  assert.equal(E.runMacro(s, pay, 3).changes[0].to, 0);
  assert.equal(E.runMacro(s, pay, 4).blocked.value, -1);
  // variables and negative-allowed tiles can go below zero freely
  const ok = { vars: [{ name: "x", initial: 0 }], steps: [{ target: v("x"), op: "-", value: 9 }, { target: tile("elves"), op: "-", value: 9 }] };
  assert.equal(E.runMacro(s, ok).blocked, null);
});

test("tapBlocked", () => {
  assert.equal(E.tapBlocked(T("a", 0, "A", false), -1).value, -1);
  assert.equal(E.tapBlocked(T("a", 0, "A", false), 1), null);
  assert.equal(E.tapBlocked(T("a", 0, "A", true), -1), null);
  assert.equal(E.newCounter(0).allowNegative, false);
});
