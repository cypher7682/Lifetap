// Pure data logic for Lifetap. No DOM, no storage — everything here is
// unit-tested in tests/engine.test.mjs.

export const ICONS = ["droplet", "hexplus", "person", "layers", "heart", "lightning", "skull", "spiral", "chest", "altar"];
// Every colour a tile or dash can use. New counters cycle through the first five.
export const COLORS = ["teal", "purple", "green", "amber", "red", "blue", "orange", "pink", "grey"];
const DEFAULT_COLORS = COLORS.slice(0, 5);
export const GRIDS = [
  { cols: 2, rows: 2 },
  { cols: 2, rows: 3 },
  { cols: 2, rows: 4 },
  { cols: 3, rows: 3 },
  { cols: 3, rows: 4 },
];
export const OPS = ["+", "-", "*", "/", "="];
export const OP_GLYPH = { "+": "+", "-": "−", "*": "×", "/": "÷", "=": "=" };
// Undo history per dash. Effectively unlimited for a game (events are ~150 bytes).
export const LOG_LIMIT = 10000;
export const BAR_SLOTS = 4;

let idCounter = 0;
export function uid() {
  idCounter = (idCounter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + idCounter.toString(36);
}

export const gridCap = (g) => g.cols * g.rows;
export const gridKey = (g) => `${g.cols}x${g.rows}`;
export const sameGrid = (a, b) => a.cols === b.cols && a.rows === b.rows;

/** Best-fit layout for a number of counters (spec §3). */
export function bestGrid(n) {
  if (n <= 4) return GRIDS[0];
  if (n <= 6) return GRIDS[1];
  if (n <= 8) return GRIDS[2];
  if (n <= 9) return GRIDS[3];
  return GRIDS[4];
}

export function toInt(v, fallback = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : fallback;
  const s = String(v ?? "").trim().replace(/[−–]/g, "-");
  if (!/^[-+]?\d+$/.test(s)) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------- structure

/** A dash with pending edits is shown as dash.draft layered over dash. */
export function view(dash) {
  return dash.draft ? { ...dash, ...dash.draft } : dash;
}

export function structureOf(d) {
  return { grid: d.grid, cells: d.cells, bar: d.bar, macros: d.macros, vars: d.vars || [] };
}

export const MAX_TOGGLES = 2;
export const MAX_BOX_VARS = 4;

export function counters(s) {
  return s.cells.filter((c) => c && c.kind === "counter");
}

export function findTile(s, tileId) {
  return s.cells.find((c) => c && c.kind === "counter" && c.id === tileId) || null;
}

/** Every on/off switch in the grid (toggle boxes hold one or two). */
export function toggles(s) {
  return s.cells.flatMap((c) => (c && c.kind === "toggles" ? c.toggles : []));
}

export function findToggle(s, id) {
  return toggles(s).find((t) => t.id === id) || null;
}

/** Dash-wide variables: [{ id, name, initial, value }]. Values persist between macro runs. */
export function dashVars(s) {
  return s.vars || [];
}

export function findDashVar(s, id) {
  return dashVars(s).find((v) => v.id === id) || null;
}

/**
 * Everything with a persistent value, keyed by id: counters, toggles (0/1) and
 * dash vars. Undo events and macro runs work over this one map.
 */
export function holderValues(s) {
  const m = new Map();
  for (const t of counters(s)) m.set(t.id, t.value);
  for (const t of toggles(s)) m.set(t.id, t.value ? 1 : 0);
  for (const v of dashVars(s)) m.set(v.id, v.value);
  return m;
}

/** The id of the persistent value a ref points at, or null for a per-run $var. */
export function holderId(ref) {
  if (!ref) return null;
  if (ref.kind === "tile") return ref.tileId;
  if (ref.kind === "toggle") return ref.toggleId;
  if (ref.kind === "dvar") return ref.varId;
  return null;
}

export function findMacro(s, macroId) {
  return s.macros.find((m) => m.id === macroId) || null;
}

/** Ids of macros that are visible somewhere (bar or grid). */
export function macroPlacements(s, macroId) {
  return {
    bar: s.bar.indexOf(macroId),
    cell: s.cells.findIndex((c) => c && c.kind === "macro" && c.macroId === macroId),
  };
}

export function newCounter(i, overrides = {}) {
  return {
    kind: "counter",
    id: uid(),
    name: `Counter ${i + 1}`,
    icon: ICONS[i % 9],
    color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    start: 0,
    allowNegative: false,
    value: 0,
    ...overrides,
  };
}

export function newToggleBox(names = ["Toggle"]) {
  return { kind: "toggles", id: uid(), toggles: names.map((name) => ({ id: uid(), name, value: 0 })) };
}

export function newVarsBox(show = []) {
  return { kind: "vars", id: uid(), show: show.slice(0, MAX_BOX_VARS) };
}

export function newMacro(name, overrides = {}) {
  return { id: uid(), name, icon: "altar", repeats: false, vars: [], steps: [], ...overrides };
}

export function createDash({ name, count, grid, index = 0 }) {
  const cap = gridCap(grid);
  if (count < 1 || count > cap) throw new Error("count does not fit grid");
  const cells = [];
  for (let i = 0; i < cap; i++) cells.push(i < count ? newCounter(i) : null);
  const now = Date.now();
  return {
    id: uid(),
    name,
    icon: ICONS[index % ICONS.length],
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    grid: { ...grid },
    cells,
    bar: Array(BAR_SLOTS).fill(null),
    macros: [],
    vars: [],
    log: [],
    redo: [],
    turn: 0,
    draft: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Deep copy with fresh ids everywhere (tiles, macros, refs remapped). */
export function duplicateDash(dash, name) {
  const src = view(dash);
  const tileMap = new Map(); // counters, toggles and dash vars
  const macroMap = new Map();
  for (const c of src.cells) if (c && c.kind === "counter") tileMap.set(c.id, uid());
  for (const t of toggles(src)) tileMap.set(t.id, uid());
  for (const v of dashVars(src)) tileMap.set(v.id, uid());
  for (const m of src.macros) macroMap.set(m.id, uid());
  const re = (id) => tileMap.get(id) ?? id;
  const remapRef = (r) => {
    if (!r) return r;
    if (r.kind === "tile") return { ...r, tileId: re(r.tileId) };
    if (r.kind === "toggle") return { ...r, toggleId: re(r.toggleId) };
    if (r.kind === "dvar") return { ...r, varId: re(r.varId) };
    return r;
  };
  const remapStep = (st) => ({ target: remapRef(st.target), op: st.op, value: typeof st.value === "number" ? st.value : remapRef(st.value) });
  const cells = src.cells.map((c) => {
    if (!c) return null;
    if (c.kind === "counter") {
      const out = { ...c, id: tileMap.get(c.id) };
      if (c.triggers) out.triggers = c.triggers.map((tr) => ({ ...tr, id: uid(), vars: tr.vars.map((v) => ({ ...v })), steps: tr.steps.map(remapStep) }));
      return out;
    }
    if (c.kind === "toggles") return { ...c, id: uid(), toggles: c.toggles.map((t) => ({ ...t, id: re(t.id) })) };
    if (c.kind === "vars") return { ...c, id: uid(), show: c.show.map(re) };
    return { ...c, id: uid(), macroId: macroMap.get(c.macroId) };
  });
  const macros = src.macros.map((m) => ({
    ...m,
    id: macroMap.get(m.id),
    vars: m.vars.map((v) => ({ ...v })),
    steps: m.steps.map(remapStep),
  }));
  const now = Date.now();
  return {
    ...dash,
    id: uid(),
    name,
    grid: { ...src.grid },
    cells,
    bar: src.bar.map((id) => (id ? macroMap.get(id) : null)),
    macros,
    vars: dashVars(src).map((v) => ({ ...v, id: re(v.id) })),
    log: [],
    redo: [],
    draft: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Change layout. Never deletes tiles: refuses if they don't fit. */
export function changeGrid(s, grid) {
  const cap = gridCap(grid);
  const used = s.cells.filter(Boolean).length;
  if (used > cap) return { ok: false, mustRemove: used - cap };
  const cells = s.cells.slice();
  while (cells.length > cap) {
    // drop empty cells from the end first so tiles keep their order
    let i = cells.lastIndexOf(null);
    cells.splice(i, 1);
  }
  while (cells.length < cap) cells.push(null);
  return { ok: true, structure: { ...s, grid: { ...grid }, cells } };
}

/** Remove whatever is in a cell. Removing a macro tile deletes its macro unless it's also on the bar. */
export function removeCell(s, index) {
  const cell = s.cells[index];
  const cells = s.cells.slice();
  cells[index] = null;
  let macros = s.macros;
  if (cell && cell.kind === "macro" && !s.bar.includes(cell.macroId)) {
    macros = macros.filter((m) => m.id !== cell.macroId);
  }
  return { ...s, cells, macros };
}

/** Delete a macro everywhere it appears. */
export function deleteMacro(s, macroId) {
  return {
    ...s,
    macros: s.macros.filter((m) => m.id !== macroId),
    bar: s.bar.map((id) => (id === macroId ? null : id)),
    cells: s.cells.map((c) => (c && c.kind === "macro" && c.macroId === macroId ? null : c)),
  };
}

export function upsertMacro(s, macro) {
  const exists = s.macros.some((m) => m.id === macro.id);
  return { ...s, macros: exists ? s.macros.map((m) => (m.id === macro.id ? macro : m)) : [...s.macros, macro] };
}

export function updateCell(s, index, patch) {
  const cells = s.cells.slice();
  cells[index] = { ...cells[index], ...patch };
  return { ...s, cells };
}

export function moveMacroToBar(s, macroId) {
  const slot = s.bar.indexOf(null);
  if (slot < 0) return { ok: false, reason: "The macro bar is full." };
  const bar = s.bar.slice();
  bar[slot] = macroId;
  const cells = s.cells.map((c) => (c && c.kind === "macro" && c.macroId === macroId ? null : c));
  return { ok: true, structure: { ...s, bar, cells } };
}

export function moveMacroToGrid(s, macroId) {
  const idx = s.cells.indexOf(null);
  if (idx < 0) return { ok: false, reason: "No empty grid cell. Remove a tile or change the grid first." };
  const cells = s.cells.slice();
  cells[idx] = { kind: "macro", id: uid(), macroId };
  const bar = s.bar.map((id) => (id === macroId ? null : id));
  return { ok: true, structure: { ...s, bar, cells } };
}

/** Add or update a dash var definition (name/initial); a new var starts at its initial value. */
export function upsertDashVar(s, v) {
  const vars = dashVars(s);
  const cur = vars.find((x) => x.id === v.id);
  return {
    ...s,
    vars: cur ? vars.map((x) => (x.id === v.id ? { ...x, name: v.name, initial: v.initial } : x)) : [...vars, { id: v.id || uid(), name: v.name, initial: v.initial, value: v.initial }],
  };
}

/** Delete a dash var and drop it from every vars box. Macro steps using it become broken. */
export function deleteDashVar(s, id) {
  return {
    ...s,
    vars: dashVars(s).filter((v) => v.id !== id),
    cells: s.cells.map((c) => (c && c.kind === "vars" && c.show.includes(id) ? { ...c, show: c.show.filter((x) => x !== id) } : c)),
  };
}

/**
 * Move whatever is at `from` to `to`, swapping with anything already there.
 * Positions are { zone: "cell" | "bar", index }. The macro bar only holds
 * macros, so a counter/toggles/vars box can't go there (or be swapped onto it).
 * Returns the new structure, or null if the move isn't allowed.
 */
export function moveSlot(s, from, to) {
  if (from.zone === to.zone && from.index === to.index) return null;
  const cells = s.cells.slice();
  const bar = s.bar.slice();
  const get = (p) => (p.zone === "cell" ? cells[p.index] : bar[p.index] ? { kind: "macro", macroId: bar[p.index] } : null);
  const a = get(from);
  const b = get(to);
  if (!a) return null;
  if (to.zone === "bar" && a.kind !== "macro") return null;
  if (from.zone === "bar" && b && b.kind !== "macro") return null;
  const put = (p, item) => {
    if (p.zone === "bar") bar[p.index] = item ? item.macroId : null;
    else cells[p.index] = !item ? null : item.id ? item : { kind: "macro", id: uid(), macroId: item.macroId };
  };
  put(to, a);
  put(from, b);
  return { ...s, cells, bar };
}

/** Next unused "Macro N" name. */
export function nextMacroName(s) {
  const used = new Set(s.macros.map((m) => m.name));
  for (let i = 1; ; i++) if (!used.has(`Macro ${i}`)) return `Macro ${i}`;
}

// ---------------------------------------------------------------- refs & steps

export function refBroken(s, macro, ref) {
  if (!ref || typeof ref !== "object") return false;
  if (ref.kind === "tile") return !findTile(s, ref.tileId);
  if (ref.kind === "toggle") return !findToggle(s, ref.toggleId);
  if (ref.kind === "dvar") return !findDashVar(s, ref.varId);
  if (ref.kind === "var") return !(macro.vars.some((v) => v.name === ref.name) || (macro.when && ref.name === "change"));
  return true;
}

export function stepBroken(s, macro, step) {
  return refBroken(s, macro, step.target) || (typeof step.value === "object" && refBroken(s, macro, step.value));
}

export function refLabel(s, ref) {
  if (!ref) return "?";
  if (ref.kind === "var") return "$" + ref.name;
  if (ref.kind === "dvar") {
    const v = findDashVar(s, ref.varId);
    return v ? "@" + v.name : "Var removed";
  }
  if (ref.kind === "toggle") {
    const t = findToggle(s, ref.toggleId);
    return t ? t.name : "Toggle removed";
  }
  const t = findTile(s, ref.tileId);
  return t ? t.name : "Tile removed";
}

/** Rename a variable and every step reference to it. */
export function renameVar(macro, from, to) {
  const fix = (r) => (r && r.kind === "var" && r.name === from ? { kind: "var", name: to } : r);
  return {
    ...macro,
    vars: macro.vars.map((v) => (v.name === from ? { ...v, name: to } : v)),
    steps: macro.steps.map((st) => ({ ...st, target: fix(st.target), value: typeof st.value === "number" ? st.value : fix(st.value) })),
  };
}

// ---------------------------------------------------------------- execution

function applyOp(cur, op, v) {
  switch (op) {
    case "+": return cur + v;
    case "-": return cur - v;
    case "*": return cur * v;
    case "/": return Math.floor(cur / v);
    case "=": return v;
  }
  return cur;
}

// Safety cap on trigger runs per action, so triggers that set each other off can't hang the app.
export const MAX_TRIGGER_RUNS = 500;

class Blocked {
  constructor(info) { this.info = info; }
}
class TriggerLoop {}

/**
 * Run a macro `times` times against the structure's current values.
 *
 * Counter triggers fire immediately: when a step changes a counter that has
 * triggers, those run right there (and any triggers they set off, depth-first)
 * before the next step. Each trigger run is all-or-nothing: if it would take a
 * no-negatives tile below zero, its own changes are rolled back and it's listed
 * in skippedTriggers, while the rest of the action carries on.
 *
 * Returns { changes: [{tileId, from, to}], skippedBroken, divByZero, blocked, loop, skippedTriggers }.
 * If the macro's own steps would take a no-negatives tile below zero, the whole
 * run is rejected: changes is empty and blocked = { tileId, name, value }.
 * If triggers run more than MAX_TRIGGER_RUNS times, loop is true and nothing changes.
 */
export function runMacro(s, macro, times = 1) {
  const ctx = {
    values: holderValues(s),
    tiles: new Map(counters(s).map((t) => [t.id, t])),
    isToggle: new Set(toggles(s).map((t) => t.id)),
    broken: new Set(),
    divByZero: false,
    triggerRuns: 0,
    skippedTriggers: [],
  };
  const before = new Map(ctx.values);
  const result = (extra) => ({
    changes: [], skippedBroken: ctx.broken.size, divByZero: ctx.divByZero, blocked: null, loop: false,
    skippedTriggers: ctx.skippedTriggers, ...extra,
  });
  try {
    for (let run = 0; run < times; run++) execSteps(ctx, macro, null);
  } catch (e) {
    if (e instanceof Blocked) return result({ blocked: e.info });
    if (e instanceof TriggerLoop) return result({ loop: true, skippedTriggers: [] });
    throw e;
  }
  const changes = [];
  for (const [id, from] of before) {
    const to = ctx.values.get(id);
    if (to !== from) changes.push({ tileId: id, from, to });
  }
  return result({ changes });
}

/** One run of a step list. `change` is the built-in $change for triggers (null for macros). */
function execSteps(ctx, macro, change) {
  const vars = new Map(macro.vars.map((v) => [v.name, toInt(v.initial)]));
  if (change != null) vars.set("change", change);
  const read = (ref) => (ref.kind === "var" ? vars.get(ref.name) : ctx.values.get(holderId(ref)));
  const has = (ref) => ref && (ref.kind === "var" ? vars.has(ref.name) : ctx.values.has(holderId(ref)));

  for (const step of macro.steps) {
    const literal = typeof step.value === "number";
    if (!has(step.target) || (!literal && !has(step.value))) {
      ctx.broken.add(step);
      continue;
    }
    const v = literal ? toInt(step.value) : read(step.value);
    if (step.op === "/" && v === 0) {
      ctx.divByZero = true;
      continue;
    }
    if (step.target.kind === "var") {
      vars.set(step.target.name, applyOp(read(step.target), step.op, v));
      continue;
    }
    const id = holderId(step.target);
    const prev = ctx.values.get(id);
    let next = applyOp(prev, step.op, v);
    if (ctx.isToggle.has(id)) next = next !== 0 ? 1 : 0;
    const tile = ctx.tiles.get(id);
    if (tile && next < 0 && !tile.allowNegative) throw new Blocked({ tileId: id, name: tile.name, value: next });
    ctx.values.set(id, next);
    if (tile && next !== prev) fireTriggers(ctx, tile, prev, next);
  }
}

function fireTriggers(ctx, tile, prev, next) {
  if (!tile.triggers || !tile.triggers.length) return;
  const delta = next - prev;
  for (const tr of tile.triggers) {
    if ((tr.when === "down" && delta >= 0) || (tr.when === "up" && delta <= 0)) continue;
    const size = Math.abs(delta);
    const runs = tr.perPoint ? size : 1;
    const snap = new Map(ctx.values);
    try {
      for (let k = 0; k < runs; k++) {
        if (++ctx.triggerRuns > MAX_TRIGGER_RUNS) throw new TriggerLoop();
        execSteps(ctx, tr, tr.perPoint ? 1 : size);
      }
    } catch (e) {
      if (!(e instanceof Blocked)) throw e;
      ctx.values.clear();
      for (const [k, val] of snap) ctx.values.set(k, val);
      ctx.skippedTriggers.push({ tile: tile.name, blocked: e.info });
    }
  }
}

/** A +/− on one tile, run through the macro engine so its triggers fire. */
export function tapAction(s, tile, delta) {
  const mac = { vars: [], steps: [{ target: { kind: "tile", tileId: tile.id }, op: delta > 0 ? "+" : "-", value: Math.abs(delta) }] };
  const r = runMacro(s, mac, 1);
  const sign = delta > 0 ? "+" : "−";
  return { ...r, event: makeEvent(Math.abs(delta) === 1 ? "tap" : "bulk", `${tile.name} ${sign}${Math.abs(delta)}`, r.changes) };
}

export const TRIGGER_WHEN = { down: "goes down", up: "goes up", change: "changes" };

export function newTrigger(when = "down") {
  return { id: uid(), when, perPoint: false, vars: [], steps: [] };
}

/** For a direct +/− on a tile: the blocked info if it would go below zero, else null. */
export function tapBlocked(tile, delta) {
  const to = tile.value + delta;
  return to < 0 && !tile.allowNegative ? { tileId: tile.id, name: tile.name, value: to } : null;
}

export function blockedMessage(b) {
  return `Would take ${b.name} to −${Math.abs(b.value)}. Couldn't execute.`;
}

/**
 * Steps captured by a recording: one +/− per tile you tapped (net), and one "="
 * per toggle you left changed. Only direct taps count; what triggers did is
 * left out, since the triggers will fire again when the macro runs.
 * direct: { tileId: net delta }, toggled: { toggleId: final 0/1 }, start: values when recording began.
 */
export function recordingSteps(s, direct, toggled = {}, start = {}) {
  const steps = [];
  for (const t of counters(s)) {
    const d = direct[t.id] || 0;
    if (d) steps.push({ target: { kind: "tile", tileId: t.id }, op: d > 0 ? "+" : "-", value: Math.abs(d) });
  }
  for (const t of toggles(s)) {
    if (t.id in toggled && toggled[t.id] !== start[t.id]) steps.push({ target: { kind: "toggle", toggleId: t.id }, op: "=", value: toggled[t.id] });
  }
  return steps;
}

// ---------------------------------------------------------------- values & log

function setValues(cells, map) {
  let changed = false;
  const out = cells.map((c) => {
    if (c && c.kind === "counter" && map.has(c.id) && c.value !== map.get(c.id)) {
      changed = true;
      return { ...c, value: map.get(c.id) };
    }
    if (c && c.kind === "toggles" && c.toggles.some((t) => map.has(t.id) && t.value !== map.get(t.id))) {
      changed = true;
      return { ...c, toggles: c.toggles.map((t) => (map.has(t.id) ? { ...t, value: map.get(t.id) } : t)) };
    }
    return c;
  });
  return changed ? out : cells;
}

function setVarValues(vars, map) {
  if (!vars || !vars.some((v) => map.has(v.id) && v.value !== map.get(v.id))) return vars;
  return vars.map((v) => (map.has(v.id) ? { ...v, value: map.get(v.id) } : v));
}

/**
 * Write values (counters, toggles, dash vars — keyed by id) into both the saved
 * structure and the pending draft.
 */
export function withValues(dash, map) {
  const next = { ...dash, cells: setValues(dash.cells, map) };
  if (dash.vars) next.vars = setVarValues(dash.vars, map);
  if (dash.draft) {
    next.draft = { ...dash.draft, cells: setValues(dash.draft.cells, map) };
    if (dash.draft.vars) next.draft.vars = setVarValues(dash.draft.vars, map);
  }
  return next;
}

function eventMap(ev, dir) {
  return new Map(ev.changes.map((c) => [c.tileId, dir === "undo" ? c.from : c.to]));
}

export function makeEvent(kind, label, changes) {
  return { id: uid(), at: Date.now(), kind, label, changes };
}

/** Apply a new event: write values, append to the log, clear redo. */
export function commitEvent(dash, ev) {
  if (!ev.changes.length) return dash;
  const next = withValues(dash, eventMap(ev, "redo"));
  const log = [...dash.log, ev];
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
  return { ...next, log, redo: [] };
}

export function undo(dash) {
  if (!dash.log.length) return dash;
  const ev = dash.log[dash.log.length - 1];
  return { ...withValues(dash, eventMap(ev, "undo")), log: dash.log.slice(0, -1), redo: [...dash.redo, ev] };
}

export function redo(dash) {
  if (!dash.redo.length) return dash;
  const ev = dash.redo[dash.redo.length - 1];
  return { ...withValues(dash, eventMap(ev, "redo")), log: [...dash.log, ev], redo: dash.redo.slice(0, -1) };
}

export function tapEvent(tile, delta) {
  const sign = delta > 0 ? "+" : "−";
  return makeEvent(Math.abs(delta) === 1 ? "tap" : "bulk", `${tile.name} ${sign}${Math.abs(delta)}`, [
    { tileId: tile.id, from: tile.value, to: tile.value + delta },
  ]);
}

export function toggleEvent(t) {
  const to = t.value ? 0 : 1;
  return makeEvent("tap", `${t.name} ${to ? "on" : "off"}`, [{ tileId: t.id, from: t.value ? 1 : 0, to }]);
}

export function macroEvent(s, macro, times) {
  const r = runMacro(s, macro, times);
  const ev = makeEvent("macro", times > 1 ? `${macro.name} ×${times}` : macro.name, r.changes);
  return { ...r, event: ev };
}

/** Reset / New game: counters back to start, toggles off, dash vars to their initial value, history cleared. */
export function resetDash(dash) {
  const map = new Map();
  for (const s of [dash, view(dash)]) {
    for (const t of counters(s)) map.set(t.id, t.start);
    for (const t of toggles(s)) map.set(t.id, 0);
    for (const v of dashVars(s)) map.set(v.id, v.initial);
  }
  return { ...withValues(dash, map), log: [], redo: [] };
}

// ---------------------------------------------------------------- pending edits

/** Apply a structural edit to the dash's pending draft. */
export function editDraft(dash, fn) {
  const base = dash.draft || structureOf(dash);
  return { ...dash, draft: fn(base) };
}

export function saveDraft(dash) {
  if (!dash.draft) return dash;
  const { draft, ...rest } = dash;
  return { ...rest, ...draft, draft: null };
}

export function discardDraft(dash) {
  return { ...dash, draft: null };
}

export const hasPending = (dash) => !!dash.draft;
