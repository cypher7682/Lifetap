// Pure data logic for Counter Dash. No DOM, no storage — everything here is
// unit-tested in tests/engine.test.mjs.

export const ICONS = ["droplet", "hexplus", "person", "layers", "heart", "lightning", "skull", "spiral", "chest", "altar"];
export const COLORS = ["teal", "purple", "green", "amber", "red"];
export const GRIDS = [
  { cols: 2, rows: 2 },
  { cols: 2, rows: 3 },
  { cols: 2, rows: 4 },
  { cols: 3, rows: 3 },
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
  return GRIDS[3];
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
  return { grid: d.grid, cells: d.cells, bar: d.bar, macros: d.macros };
}

export function counters(s) {
  return s.cells.filter((c) => c && c.kind === "counter");
}

export function findTile(s, tileId) {
  return s.cells.find((c) => c && c.kind === "counter" && c.id === tileId) || null;
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
    color: COLORS[i % COLORS.length],
    start: 0,
    value: 0,
    ...overrides,
  };
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
    color: COLORS[index % COLORS.length],
    grid: { ...grid },
    cells,
    bar: Array(BAR_SLOTS).fill(null),
    macros: [],
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
  const tileMap = new Map();
  const macroMap = new Map();
  for (const c of src.cells) if (c && c.kind === "counter") tileMap.set(c.id, uid());
  for (const m of src.macros) macroMap.set(m.id, uid());
  const remapRef = (r) => (r && r.kind === "tile" ? { ...r, tileId: tileMap.get(r.tileId) ?? r.tileId } : r);
  const cells = src.cells.map((c) => {
    if (!c) return null;
    if (c.kind === "counter") return { ...c, id: tileMap.get(c.id) };
    return { ...c, id: uid(), macroId: macroMap.get(c.macroId) };
  });
  const macros = src.macros.map((m) => ({
    ...m,
    id: macroMap.get(m.id),
    vars: m.vars.map((v) => ({ ...v })),
    steps: m.steps.map((st) => ({
      target: remapRef(st.target),
      op: st.op,
      value: typeof st.value === "number" ? st.value : remapRef(st.value),
    })),
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

/** Next unused "Macro N" name. */
export function nextMacroName(s) {
  const used = new Set(s.macros.map((m) => m.name));
  for (let i = 1; ; i++) if (!used.has(`Macro ${i}`)) return `Macro ${i}`;
}

// ---------------------------------------------------------------- refs & steps

export function refBroken(s, macro, ref) {
  if (!ref || typeof ref !== "object") return false;
  if (ref.kind === "tile") return !findTile(s, ref.tileId);
  if (ref.kind === "var") return !macro.vars.some((v) => v.name === ref.name);
  return true;
}

export function stepBroken(s, macro, step) {
  return refBroken(s, macro, step.target) || (typeof step.value === "object" && refBroken(s, macro, step.value));
}

export function refLabel(s, ref) {
  if (!ref) return "?";
  if (ref.kind === "var") return "$" + ref.name;
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

/**
 * Run a macro `times` times against the structure's current values.
 * Returns { changes: [{tileId, from, to}], skippedBroken, divByZero }.
 */
export function runMacro(s, macro, times = 1) {
  const values = new Map();
  for (const t of counters(s)) values.set(t.id, t.value);
  const before = new Map(values);
  let skippedBroken = 0;
  let divByZero = false;

  for (let run = 0; run < times; run++) {
    const vars = new Map(macro.vars.map((v) => [v.name, toInt(v.initial)]));
    const read = (ref) => (ref.kind === "tile" ? values.get(ref.tileId) : vars.get(ref.name));
    const write = (ref, v) => (ref.kind === "tile" ? values.set(ref.tileId, v) : vars.set(ref.name, v));
    const has = (ref) => ref && (ref.kind === "tile" ? values.has(ref.tileId) : vars.has(ref.name));

    for (const step of macro.steps) {
      const literal = typeof step.value === "number";
      if (!has(step.target) || (!literal && !has(step.value))) {
        if (run === 0) skippedBroken++;
        continue;
      }
      const v = literal ? toInt(step.value) : read(step.value);
      if (step.op === "/" && v === 0) {
        divByZero = true;
        continue;
      }
      write(step.target, applyOp(read(step.target), step.op, v));
    }
  }

  const changes = [];
  for (const [id, from] of before) {
    const to = values.get(id);
    if (to !== from) changes.push({ tileId: id, from, to });
  }
  return { changes, skippedBroken, divByZero };
}

/** Steps captured by a recording: one +/− per tile with a non-zero net change. */
export function recordingSteps(s, startValues) {
  const steps = [];
  for (const t of counters(s)) {
    if (!(t.id in startValues)) continue;
    const d = t.value - startValues[t.id];
    if (d === 0) continue;
    steps.push({ target: { kind: "tile", tileId: t.id }, op: d > 0 ? "+" : "-", value: Math.abs(d) });
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
    return c;
  });
  return changed ? out : cells;
}

/** Write values into both the saved structure and the pending draft. */
export function withValues(dash, map) {
  const next = { ...dash, cells: setValues(dash.cells, map) };
  if (dash.draft) next.draft = { ...dash.draft, cells: setValues(dash.draft.cells, map) };
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

export function macroEvent(s, macro, times) {
  const r = runMacro(s, macro, times);
  const ev = makeEvent("macro", times > 1 ? `${macro.name} ×${times}` : macro.name, r.changes);
  return { ...r, event: ev };
}

/** Reset / New game: every counter back to start, history cleared. */
export function resetDash(dash) {
  const map = new Map();
  for (const t of counters(view(dash))) map.set(t.id, t.start);
  for (const t of counters(dash)) map.set(t.id, t.start);
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
