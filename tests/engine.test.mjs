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
  assert.deepEqual([1, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 16, 20, 21, 24, 25, 40].map((n) => E.gridKey(E.bestGrid(n))),
    ["2x2", "2x2", "2x3", "2x3", "2x4", "2x4", "3x3", "3x4", "3x4", "3x5", "3x5", "4x5", "4x5", "4x6", "4x6", "5x6", "5x8"]);
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

test("recordingSteps captures only direct taps", () => {
  const d = altarDash();
  const steps = E.recordingSteps(d, { mana: 2, elves: -4, nad: 0 });
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

// ---------------------------------------------------------------- toggles & dash vars

function cmdrDash() {
  let d = E.createDash({ name: "Cmdr", count: 1, grid: { cols: 2, rows: 2 } });
  const mana = { ...d.cells[0], id: "mana", name: "Mana", value: 6 };
  const box = { kind: "toggles", id: "tb", toggles: [{ id: "out", name: "Cmdr out", value: 0 }, { id: "out2", name: "Partner out", value: 0 }] };
  const tax = { id: "tax", name: "Cmdr tax", initial: 0, value: 2 };
  const casts = { id: "casts", name: "Cmdr casts", initial: 0, value: 1 };
  const cast = {
    id: "cast", name: "Cast cmdr", icon: "altar", repeats: false, vars: [],
    steps: [
      { target: tile("mana"), op: "-", value: 4 },
      { target: tile("mana"), op: "-", value: { kind: "dvar", varId: "tax" } },
      { target: { kind: "dvar", varId: "tax" }, op: "+", value: 2 },
      { target: { kind: "dvar", varId: "casts" }, op: "+", value: 1 },
      { target: { kind: "toggle", toggleId: "out" }, op: "=", value: 1 },
    ],
  };
  return { ...d, cells: [mana, box, E.newVarsBox(["tax", "casts"]), null], vars: [tax, casts], macros: [cast] };
}

test("dash vars persist across runs; toggles read and write as 0/1", () => {
  let d = cmdrDash();
  let r = E.macroEvent(d, d.macros[0], 1);
  assert.equal(r.blocked, null);
  d = E.commitEvent(d, r.event);
  assert.equal(E.findTile(d, "mana").value, 0);
  assert.equal(E.findDashVar(d, "tax").value, 4);
  assert.equal(E.findDashVar(d, "casts").value, 2);
  assert.equal(E.findToggle(d, "out").value, 1);
  // second cast can't be afforded: 0 - 4 → blocked, nothing changes
  r = E.macroEvent(d, d.macros[0], 1);
  assert.equal(r.blocked.name, "Mana");
  // undo restores counters, vars and toggles in one go
  d = E.undo(d);
  assert.equal(E.findTile(d, "mana").value, 6);
  assert.equal(E.findDashVar(d, "tax").value, 2);
  assert.equal(E.findToggle(d, "out").value, 0);
});

test("toggle writes clamp to 0/1 and toggles can be a value source", () => {
  const d = cmdrDash();
  const mac = { vars: [{ name: "x", initial: 0 }], steps: [
    { target: { kind: "toggle", toggleId: "out2" }, op: "+", value: 5 },
    { target: { kind: "var", name: "x" }, op: "=", value: { kind: "toggle", toggleId: "out2" } },
    { target: tile("mana"), op: "+", value: { kind: "var", name: "x" } },
  ] };
  const ch = Object.fromEntries(E.runMacro(d, mac).changes.map((c) => [c.tileId, c.to]));
  assert.deepEqual(ch, { out2: 1, mana: 7 });
});

test("toggleEvent, reset, delete var, duplicate", () => {
  let d = cmdrDash();
  d = E.commitEvent(d, E.toggleEvent(E.findToggle(d, "out")));
  assert.equal(E.findToggle(d, "out").value, 1);
  assert.equal(d.log[0].label, "Cmdr out on");
  d = E.resetDash(d);
  assert.equal(E.findToggle(d, "out").value, 0);
  assert.equal(E.findDashVar(d, "tax").value, 0);
  const s = E.deleteDashVar(E.structureOf(d), "tax");
  assert.deepEqual(s.cells[2].show, ["casts"]);
  assert.equal(E.stepBroken(s, d.macros[0], d.macros[0].steps[1]), true);
  assert.equal(E.refLabel(s, { kind: "dvar", varId: "tax" }), "Var removed");
  const c = E.duplicateDash(cmdrDash(), "Copy");
  assert.equal(E.runMacro(c, c.macros[0]).changes.length, 4);
  assert.notEqual(c.vars[0].id, "tax");
  assert.equal(c.cells[2].show[0], c.vars[0].id);
});

test("recording captures toggle flips as = steps", () => {
  const d = cmdrDash();
  const start = Object.fromEntries(E.holderValues(d));
  assert.deepEqual(E.recordingSteps(d, {}, { out: 1 }, start), [{ target: { kind: "toggle", toggleId: "out" }, op: "=", value: 1 }]);
  assert.deepEqual(E.recordingSteps(d, {}, { out: 0 }, start), []); // flipped back
});

test("draft vars: new var lives in draft, values write through", () => {
  let d = cmdrDash();
  d = E.editDraft(d, (s) => E.upsertDashVar(s, { id: "new", name: "Storm", initial: 3 }));
  assert.equal(E.findDashVar(E.view(d), "new").value, 3);
  assert.equal(E.findDashVar(d, "new"), null);
  d = E.commitEvent(d, E.makeEvent("macro", "x", [{ tileId: "tax", from: 2, to: 9 }]));
  assert.equal(E.findDashVar(d, "tax").value, 9);
  assert.equal(E.findDashVar(E.view(d), "tax").value, 9);
  assert.equal(E.findDashVar(E.saveDraft(d), "new").value, 3);
});

test("moveSlot: swap cells, move into empties, macros between grid and bar", () => {
  const C = (id) => ({ kind: "counter", id, name: id, value: 0 });
  const s = { cells: [C("a"), C("b"), null, { kind: "macro", id: "mt", macroId: "m2" }], bar: ["m1", null, null, null], macros: [] };
  const cell = (index) => ({ zone: "cell", index }), slot = (index) => ({ zone: "bar", index });
  assert.deepEqual(E.moveSlot(s, cell(0), cell(1)).cells.map((c) => c && c.id), ["b", "a", null, "mt"]);
  assert.deepEqual(E.moveSlot(s, cell(0), cell(2)).cells.map((c) => c && c.id), [null, "b", "a", "mt"]);
  assert.equal(E.moveSlot(s, cell(2), cell(0)), null); // nothing to move
  assert.equal(E.moveSlot(s, cell(0), cell(0)), null);
  assert.equal(E.moveSlot(s, cell(0), slot(1)), null); // counters can't go on the bar
  assert.equal(E.moveSlot(s, slot(0), cell(0)), null); // ...or be swapped onto it
  // macro tile -> empty bar slot
  let r = E.moveSlot(s, cell(3), slot(1));
  assert.deepEqual(r.bar, ["m1", "m2", null, null]);
  assert.equal(r.cells[3], null);
  // bar macro <-> macro tile swap
  r = E.moveSlot(s, slot(0), cell(3));
  assert.deepEqual(r.bar, ["m2", null, null, null]);
  assert.deepEqual(E.cellMacroIds(r.cells[3]), ["m1"]);
  assert.ok(r.cells[3].id);
  // bar -> empty cell, bar -> bar
  assert.deepEqual(E.cellMacroIds(E.moveSlot(s, slot(0), cell(2)).cells[2]), ["m1"]);
  assert.deepEqual(E.moveSlot(s, slot(0), slot(3)).bar, [null, null, null, "m1"]);
});

// ---------------------------------------------------------------- triggers

function triggerDash() {
  // Treasure: whenever it goes down, Cmdr + $change.  Elves: whenever it goes down, Cmdr + 1 per point.
  const mk = (id, name, value, triggers) => ({ kind: "counter", id, name, icon: "heart", color: "teal", start: 0, value, allowNegative: false, triggers });
  const cmdrPlus = (value) => ({ target: tile("cmdr"), op: "+", value });
  const cells = [
    mk("treasure", "Treasure", 3, [{ id: "t1", when: "down", perPoint: false, vars: [], steps: [cmdrPlus({ kind: "var", name: "change" })] }]),
    mk("elves", "Elves", 4, [{ id: "t2", when: "down", perPoint: true, vars: [], steps: [cmdrPlus(1)] }]),
    mk("cmdr", "Cmdr", 2, []),
    mk("held", "Held", 0, []),
  ];
  return { ...E.createDash({ name: "T", count: 1, grid: { cols: 2, rows: 2 } }), cells };
}

test("triggers fire mid-macro, before the next step", () => {
  const d = triggerDash();
  // sac 2 treasure, then sacrifice the commander and hold its counters
  const mac = { vars: [], steps: [
    { target: tile("treasure"), op: "-", value: 2 },
    { target: tile("held"), op: "+", value: tile("cmdr") },
    { target: tile("cmdr"), op: "=", value: 0 },
  ] };
  const ch = Object.fromEntries(E.runMacro(d, mac).changes.map((c) => [c.tileId, c.to]));
  assert.deepEqual(ch, { treasure: 1, held: 4, cmdr: 0 }); // held got 2 + 2 from the trigger
});

test("taps fire triggers; per-point runs once per point; up-changes don't fire 'down'", () => {
  const d = triggerDash();
  let r = E.tapAction(d, E.findTile(d, "elves"), -3);
  assert.deepEqual(Object.fromEntries(r.changes.map((c) => [c.tileId, c.to])), { elves: 1, cmdr: 5 });
  assert.equal(r.event.label, "Elves −3");
  r = E.tapAction(d, E.findTile(d, "treasure"), 1);
  assert.deepEqual(r.changes.map((c) => c.tileId), ["treasure"]);
});

test("a trigger that would go negative is skipped on its own; the action still happens", () => {
  const d = triggerDash();
  d.cells[0].triggers.push({ id: "t3", when: "down", perPoint: false, vars: [], steps: [{ target: tile("held"), op: "-", value: 5 }, { target: tile("cmdr"), op: "+", value: 100 }] });
  const r = E.tapAction(d, E.findTile(d, "treasure"), -1);
  assert.deepEqual(Object.fromEntries(r.changes.map((c) => [c.tileId, c.to])), { treasure: 2, cmdr: 3 });
  assert.equal(r.skippedTriggers.length, 1);
  assert.equal(r.skippedTriggers[0].blocked.name, "Held");
});

test("trigger loops are stopped and nothing changes", () => {
  const d = triggerDash();
  // Cmdr going up bumps Held; Held going up bumps Cmdr → forever
  d.cells[2].triggers = [{ id: "a", when: "up", perPoint: false, vars: [], steps: [{ target: tile("held"), op: "+", value: 1 }] }];
  d.cells[3].triggers = [{ id: "b", when: "up", perPoint: false, vars: [], steps: [{ target: tile("cmdr"), op: "+", value: 1 }] }];
  const r = E.tapAction(d, E.findTile(d, "cmdr"), 1);
  assert.equal(r.loop, true);
  assert.deepEqual(r.changes, []);
});

test("$change is a built-in inside triggers only", () => {
  const d = triggerDash();
  const tr = d.cells[0].triggers[0];
  assert.equal(E.stepBroken(d, tr, tr.steps[0]), false);
  assert.equal(E.stepBroken(d, { vars: [], steps: [] }, tr.steps[0]), true);
  const c = E.duplicateDash(d, "copy");
  assert.notEqual(c.cells[0].triggers[0].steps[0].target.tileId, "cmdr");
  assert.equal(c.cells[0].triggers[0].steps[0].target.tileId, c.cells[2].id);
});

test("toggle triggers fire on a flip and when a macro sets the toggle", () => {
  const d = cmdrDash();
  // Cmdr out turning on: @Cmdr casts + 1 ; turning off: Mana + 2
  d.cells[1].toggles[0].triggers = [
    { id: "on", when: "up", perPoint: false, vars: [], steps: [{ target: { kind: "dvar", varId: "casts" }, op: "+", value: { kind: "var", name: "change" } }] },
    { id: "off", when: "down", perPoint: false, vars: [], steps: [{ target: tile("mana"), op: "+", value: 2 }] },
  ];
  let r = E.toggleAction(d, E.findToggle(d, "out"));
  assert.deepEqual(Object.fromEntries(r.changes.map((c) => [c.tileId, c.to])), { out: 1, casts: 2 });
  assert.equal(r.event.label, "Cmdr out on");
  const on = E.commitEvent(d, r.event);
  r = E.toggleAction(on, E.findToggle(on, "out"));
  assert.deepEqual(Object.fromEntries(r.changes.map((c) => [c.tileId, c.to])), { out: 0, mana: 8 });
  // setting it to what it already is doesn't fire
  const same = E.runMacro(on, { vars: [], steps: [{ target: { kind: "toggle", toggleId: "out" }, op: "=", value: 5 }] });
  assert.deepEqual(same.changes, []);
  // the cast macro sets Cmdr out = 1 as its last step → the "on" trigger fires
  const cast = E.runMacro(d, d.macros[0]);
  assert.equal(Object.fromEntries(cast.changes.map((c) => [c.tileId, c.to])).casts, 3);
  // duplicate keeps toggle triggers, with fresh ids
  const c = E.duplicateDash(d, "copy");
  assert.equal(c.cells[1].toggles[0].triggers.length, 2);
  assert.notEqual(c.cells[1].toggles[0].triggers[0].id, "on");
});

test("macro tiles hold several macros", () => {
  const C = (id) => ({ kind: "counter", id, name: id, value: 0 });
  let s = { cells: [C("a"), { kind: "macro", id: "mt", macroId: "m1" }, null, null], bar: [null, null, null, "m3"], macros: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] };
  s = { ...s, cells: E.normalizeCells(s.cells) };
  assert.deepEqual(s.cells[1].macroIds, ["m1"]);
  s = E.addMacroToCell(s, 1, "m2");
  s = E.addMacroToCell(s, 1, "m3");
  assert.deepEqual(E.cellMacroIds(s.cells[1]), ["m1", "m2", "m3"]);
  for (const id of ["x1", "x2", "x3"]) s = E.addMacroToCell(s, 1, id);
  assert.equal(E.cellMacroIds(s.cells[1]).length, E.MAX_CELL_MACROS);
  assert.equal(E.macroPlacements(s, "m2").cell, 1);
  // a multi-macro tile can't go on the bar
  assert.equal(E.moveSlot(s, { zone: "cell", index: 1 }, { zone: "bar", index: 0 }), null);
  assert.equal(E.moveSlot(s, { zone: "bar", index: 3 }, { zone: "cell", index: 1 }), null);
  // removing one macro deletes it (not on the bar); m3 is on the bar so it survives
  let r = E.removeMacroFromCell(s, 1, "m2");
  assert.ok(!E.findMacro(r, "m2"));
  r = E.removeMacroFromCell(r, 1, "m3");
  assert.ok(E.findMacro(r, "m3"));
  // deleting a macro shrinks the tile; removing the whole tile prunes its macros
  r = E.deleteMacro(s, "m1");
  assert.deepEqual(E.cellMacroIds(r.cells[1]), ["m2", "m3", "x1"]);
  r = E.removeCell(s, 1);
  assert.deepEqual(r.macros.map((m) => m.id), ["m3"]);
  // a tile's last macro moving to the bar empties the cell
  const one = { cells: [{ kind: "macro", id: "t", macroIds: ["m1"] }], bar: [null, null, null, null], macros: [{ id: "m1" }] };
  assert.equal(E.moveMacroToBar(one, "m1").structure.cells[0], null);
});

test("custom grids: any size within limits, tiles never deleted", () => {
  const d = E.createDash({ name: "X", count: 7, grid: { cols: 1, rows: 7 } });
  assert.equal(d.cells.length, 7);
  assert.deepEqual(E.changeGrid(d, { cols: 2, rows: 3 }), { ok: false, mustRemove: 1 });
  const r = E.changeGrid(d, { cols: 5, rows: 2 });
  assert.equal(r.structure.cells.length, 10);
  assert.equal(E.counters(r.structure).length, 7);
  assert.equal(E.MAX_COUNTERS, 40);
});
