import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import * as store from "../store.js";
import * as E from "../engine.js";
import { Icon } from "../icons.js";
import { usePress, Sheet, Popover, MenuItem, Segmented, IntInput, dialog, confirm, snack, toast } from "../ui.js";
import { IconPicker, ColorPicker, GridPicker } from "./pickers.js";

// Edit mode survives a trip to the step editor and back.
const session = new Map();

function layoutFor(grid) {
  if (grid.cols === 3) return "compact";
  if (grid.rows === 4) return "row";
  return "full";
}

/** Restore a draft snapshot (undo of a structural edit) without losing counter values changed since. */
function restoreDraft(d, snap) {
  const cur = new Map(E.counters(E.view(d)).map((t) => [t.id, t.value]));
  for (const t of E.counters(d)) cur.set(t.id, t.value);
  return E.withValues({ ...d, draft: snap }, cur);
}

function fmt(n) {
  return n < 0 ? "−" + Math.abs(n) : String(n);
}
function signed(n) {
  return n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0";
}

// ---------------------------------------------------------------- tiles

function CounterTile({ tile, layout, turn, badge, rec, onStep, onHold }) {
  const minus = usePress({ onTap: () => onStep(tile, -1), onLong: () => onHold(tile, -1) });
  const plus = usePress({ onTap: () => onStep(tile, 1), onLong: () => onHold(tile, 1) });
  const lay = turn ? "row" : layout;
  const len = Math.max(1, fmt(tile.value).length);
  return html`
    <div class=${`tile counter-tile lay-${lay}` + (turn ? " turned" : "")} role="group" aria-label=${`${tile.name}, ${tile.value}`}>
      <div class="tc" style=${turn ? { "--turn": turn + "deg" } : null}>
        <div class="tile-head">
          <span class=${"tile-icon c-" + tile.color}><${Icon} name=${tile.icon} size=${lay === "full" ? 24 : 20} /></span>
          <span class="tile-name">${tile.name}</span>
        </div>
        <div class="tile-body">
          <button class="pm minus" aria-label=${`${tile.name} minus one. Hold to take more.`} ...${minus}><${Icon} name="minus" /></button>
          <span class="tile-val" style=${{ "--len": len }} aria-hidden="true">${fmt(tile.value)}</span>
          <button class="pm plus" aria-label=${`${tile.name} plus one. Hold to add more.`} ...${plus}><${Icon} name="plus" /></button>
        </div>
        ${rec != null && rec !== 0 && html`<span class="badge rec-badge">REC ${signed(rec)}</span>`}
        ${rec == null && badge && html`<span key=${badge.k} class=${"badge delta-badge " + (badge.n < 0 ? "neg" : "pos")}>${signed(badge.n)}</span>`}
      </div>
    </div>`;
}

function MacroTile({ macro, turn, recording, inert, onRun, onHold, onStop }) {
  const press = usePress({ onTap: recording ? onStop : onRun, onLong: recording ? null : onHold, disabled: inert });
  const tileHold = usePress({ onLong: inert || recording ? null : onHold });
  return html`
    <div class=${"tile macro-tile" + (turn ? " turned" : "") + (inert ? " inert" : "")} ...${tileHold}>
      <div class="tc" style=${turn ? { "--turn": turn + "deg" } : null}>
        <div class="tile-head">
          <span class="tile-icon c-green"><${Icon} name=${macro.icon} size=${20} /></span>
          <span class="tile-name">${macro.name}</span>
        </div>
        <div class="macro-tile-mid">
          ${recording
            ? html`<button class="stop-sq" aria-label="Stop recording" ...${press}><${Icon} name="stop" size=${30} /></button>`
            : html`<button class="play-btn" aria-label=${`Run ${macro.name}${macro.repeats ? ", asks how many times" : ""}. Hold for options.`} ...${press}><${Icon} name="play" size=${28} /></button>`}
        </div>
        <div class="macro-tile-foot">${recording ? "recording" : macro.repeats ? "asks ×N" : "once"}</div>
      </div>
    </div>`;
}

function MacroSlot({ macro, index, turn, state, hint, onRun, onHold, onEmptyHold, onStop }) {
  // state: "idle" | "recording" | "dim"
  const press = usePress({
    disabled: state === "dim",
    onTap: state === "recording" ? onStop : macro ? onRun : () => toast("Hold an empty slot to record a macro"),
    onLong: state === "recording" ? null : macro ? onHold : onEmptyHold,
  });
  const iconStyle = turn ? { transform: `rotate(${turn}deg)` } : null;
  if (state === "recording") {
    return html`
      <div class="slot">
        <button class="slot-btn slot-stop" aria-label="Stop recording" ...${press}><${Icon} name="stop" size=${30} style=${iconStyle} /></button>
        <span class="slot-label rec">Stop</span>
      </div>`;
  }
  return html`
    <div class=${"slot" + (state === "dim" ? " dim" : "")}>
      ${macro
        ? html`<button class="slot-btn slot-set" aria-label=${`${macro.name}${macro.repeats ? ", asks how many times" : ""}. Hold for options.`} ...${press}>
            <${Icon} name=${macro.icon} size=${26} style=${iconStyle} /></button>
            <span class="slot-label">${macro.name}${macro.repeats ? " ×N" : ""}</span>`
        : html`<button class="slot-btn slot-empty" aria-label=${`Empty macro slot ${index + 1}. Hold to record.`} ...${press}>
            <${Icon} name="plus" size=${22} style=${iconStyle} /></button>
            <span class="slot-label muted">${state === "idle" && hint ? "Hold to record" : "\u00a0"}</span>`}
    </div>`;
}

// ---------------------------------------------------------------- how-many sheet

function HowMany({ kind, tile, macro, dir, turn, onDone, onClose }) {
  const isMacro = kind === "macro";
  const floor = isMacro ? 1 : 0;
  const [n, setN] = useState(floor);
  const [touched, setTouched] = useState(false);
  const bump = (d) => {
    setTouched(true);
    setN((x) => Math.max(floor, x + d));
  };
  const preview = tile ? tile.value + dir * n : 0;
  const title = isMacro ? `Run ${macro.name}` : `${dir > 0 ? "Add to" : "Take from"} ${tile.name}`;
  const cls = isMacro ? (touched ? "hm-macro on" : "hm-macro") : dir > 0 ? "hm-add" : "hm-take";
  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label=${title} class="howmany">
      <div class="hm-head">
        <span class=${"hm-icon " + (isMacro ? "macro" : "tint-" + tile.color)}><${Icon} name=${isMacro ? macro.icon : tile.icon} size=${24} /></span>
        <div>
          <div class="hm-title">${title}</div>
          <div class="hm-sub">${isMacro
            ? `${macro.steps.length} step${macro.steps.length === 1 ? "" : "s"} each run`
            : html`${fmt(tile.value)} → <b class=${dir > 0 ? "t-teal" : "t-red"}>${fmt(preview)}</b>`}</div>
        </div>
      </div>
      <div class=${"hm-big " + cls} aria-live="polite">${isMacro ? "×" + n : (dir > 0 ? "+" : "−") + n}</div>
      <div class="hm-cap">${isMacro && !touched ? "use the buttons below to change how many times" : "running total"}</div>
      <div class="hm-btns">
        <button class="btn btn-num" disabled=${n <= floor} onClick=${() => bump(-10)}>−10</button>
        <button class="btn btn-num" disabled=${n <= floor} onClick=${() => bump(-1)}>−1</button>
        <button class="btn btn-num" onClick=${() => bump(1)}>+1</button>
        <button class="btn btn-num" onClick=${() => bump(10)}>+10</button>
      </div>
      <div class="hm-actions">
        <button class="btn btn-cancel" aria-label="Cancel" onClick=${onClose}><${Icon} name="x" /></button>
        <button class=${"btn btn-block " + (isMacro ? "btn-green" : "btn-primary")} disabled=${n < Math.max(1, floor)} onClick=${() => onDone(n)}>
          <${Icon} name="check" size=${22} />
          ${isMacro ? (n === 1 ? "Run once" : `Run ×${n}`) : `${dir > 0 ? "Add" : "Take"} ${n}`}
        </button>
      </div>
    <//>`;
}

// ---------------------------------------------------------------- edit-mode sheets

function EditTileSheet({ dash, index, onClose, onRemove, onGrid }) {
  const tile = E.view(dash).cells[index];
  if (!tile) return null;
  const set = (patch) => store.update(dash.id, (d) => E.editDraft(d, (s) => E.updateCell(s, index, patch)));
  return html`
    <${Sheet} onClose=${onClose} label="Edit tile">
      <h2 class="sheet-title">Edit tile</h2>
      <div class="row-2">
        <div class="grow">
          <label class="field-label" for="et-name">Name</label>
          <input id="et-name" class="input" value=${tile.name} maxlength="32" onInput=${(e) => set({ name: e.currentTarget.value })}
            onBlur=${(e) => !e.currentTarget.value.trim() && set({ name: "Counter" })} />
        </div>
        <div class="start-col">
          <label class="field-label" for="et-start">Start at</label>
          <div class="start-wrap">
            <${IntInput} id="et-start" label="Start value" value=${tile.start} onChange=${(v) => set({ start: v })} />
            <button class="icon-btn sign-btn" aria-label="Flip sign" onClick=${() => set({ start: -tile.start })}>±</button>
          </div>
        </div>
      </div>
      <div class="field-label">Icon</div>
      <${IconPicker} value=${tile.icon} color=${tile.color} onChange=${(icon) => set({ icon })} />
      <div class="field-label">Colour</div>
      <${ColorPicker} value=${tile.color} onChange=${(color) => set({ color })} />
      <div class="sheet-row">
        <button class="btn btn-danger-soft" onClick=${onRemove}>Remove tile</button>
        <button class="btn btn-plain" onClick=${onGrid}>Change grid</button>
      </div>
    <//>`;
}

function GridSheet({ dash, onClose }) {
  const v = E.view(dash);
  const used = v.cells.filter(Boolean).length;
  const [msg, setMsg] = useState("");
  const pick = (g) => {
    const r = E.changeGrid(v, g);
    if (!r.ok) {
      setMsg(`Remove ${r.mustRemove} tile${r.mustRemove === 1 ? "" : "s"} first — that layout only fits ${E.gridCap(g)}.`);
      return;
    }
    store.update(dash.id, (d) => E.editDraft(d, () => r.structure));
    onClose();
  };
  return html`
    <${Sheet} onClose=${onClose} label="Change grid">
      <h2 class="sheet-title">Change grid</h2>
      <p class="hint">${used} cell${used === 1 ? "" : "s"} in use. Tiles are never deleted by a grid change.</p>
      <${GridPickerAll} value=${v.grid} used=${used} onChange=${pick} />
      ${msg && html`<div class="field-err" role="alert">${msg}</div>`}
    <//>`;
}

/** Like GridPicker but too-small layouts stay tappable so we can say why they're blocked. */
function GridPickerAll({ value, used, onChange }) {
  return html`
    <div class="grid-picker" role="radiogroup" aria-label="Layout">
      ${E.GRIDS.map((g) => {
        const cap = E.gridCap(g);
        const on = E.sameGrid(g, value);
        return html`
          <button role="radio" aria-checked=${on} class=${"grid-opt" + (on ? " on" : "") + (cap < used ? " small" : "")} onClick=${() => onChange(g)}>
            <span class="grid-mini" style=${{ gridTemplateColumns: `repeat(${g.cols}, 1fr)` }}>
              ${Array.from({ length: cap }, (_, i) => html`<span class=${i < used ? "used" : ""}></span>`)}
            </span>
            <span class="grid-name">${g.cols} × ${g.rows}</span>
            <span class="grid-note">${cap < used ? `remove ${used - cap}` : cap > used ? `${cap - used} spare` : "full"}</span>
          </button>`;
      })}
    </div>`;
}

// ---------------------------------------------------------------- screen

export function DashScreen({ id, nav, autoTurn }) {
  const dash = store.get(id);
  const v = E.view(dash);
  const ss = session.get(id) || { mode: "play" };
  const [mode, setModeState] = useState(ss.mode);
  const setMode = (m) => { session.set(id, { mode: m }); setModeState(m); };
  const [rec, setRec] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [badges, setBadges] = useState({});
  const [flash, setFlash] = useState(0);
  const [selected, setSelected] = useState(null);
  const timers = useRef({});
  const recRef = useRef(rec);
  recRef.current = rec;

  const pending = E.hasPending(dash);
  const turn = mode === "play" ? autoTurn || dash.turn || 0 : 0;
  const layout = layoutFor(v.grid);

  // ---------- leaving with unsaved edits
  useEffect(() => {
    if (!pending && !rec) {
      nav.setGuard(null);
      return;
    }
    nav.setGuard(async () => {
      if (recRef.current) {
        toast("Stop or cancel the recording first");
        return false;
      }
      const r = await dialog({
        title: "Save changes?",
        body: "You have unsaved tile or macro edits on this dash.",
        buttons: [
          { label: "Cancel", value: "cancel", kind: "plain" },
          { label: "Discard", value: "discard", kind: "danger" },
          { label: "Save", value: "save", kind: "amber" },
        ],
      });
      if (r === "cancel") return false;
      store.update(id, (d) => (r === "save" ? E.saveDraft(d) : E.discardDraft(d)));
      session.delete(id);
      return true;
    });
  }, [pending, !!rec]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // ---------- values
  const bumpBadges = (changes) => {
    setBadges((b) => {
      const next = { ...b };
      for (const c of changes) {
        const prev = next[c.tileId];
        next[c.tileId] = { n: (prev ? prev.n : 0) + (c.to - c.from), k: Math.random() };
        clearTimeout(timers.current[c.tileId]);
        timers.current[c.tileId] = setTimeout(() => {
          setBadges((bb) => {
            const { [c.tileId]: _, ...rest } = bb;
            return rest;
          });
        }, 5300);
      }
      return next;
    });
  };

  const commit = (ev) => {
    if (!ev.changes.length) return;
    store.update(id, (d) => E.commitEvent(d, ev));
    bumpBadges(ev.changes);
    if (recRef.current) setRec((r) => ({ ...r, taps: r.taps + 1 }));
  };

  const step = (tile, delta) => commit(E.tapEvent(tile, delta));

  const runMacro = (macroId, times = 1) => {
    const s = E.view(store.get(id));
    const m = E.findMacro(s, macroId);
    if (!m) return;
    const r = E.macroEvent(s, m, times);
    commit(r.event);
    const warn = [];
    if (r.skippedBroken) warn.push(`skipped ${r.skippedBroken} broken step${r.skippedBroken === 1 ? "" : "s"}`);
    if (r.divByZero) warn.push("skipped a divide by zero");
    if (warn.length) toast(`${m.name}: ${warn.join(", ")}`);
    else if (!r.changes.length) toast(m.steps.length ? `${m.name}: nothing changed` : `${m.name} has no steps yet`);
  };

  const tapMacro = (macroId) => {
    const m = E.findMacro(v, macroId);
    if (!m) return;
    if (m.repeats) setSheet({ type: "howmany", kind: "macro", macroId });
    else runMacro(macroId);
  };

  const doUndo = () => {
    const ev = dash.log[dash.log.length - 1];
    if (!ev) return;
    store.update(id, E.undo);
    toast(`Undid ${ev.label}`);
  };
  const doRedo = () => {
    const ev = dash.redo[dash.redo.length - 1];
    if (!ev) return;
    store.update(id, E.redo);
    toast(`Redid ${ev.label}`);
  };

  // ---------- recording
  const startRecording = async (target) => {
    setSheet(null);
    if (target.macroId) {
      const m = E.findMacro(v, target.macroId);
      if (m && m.steps.length && !(await confirm(`Re-record “${m.name}”?`, `Its ${m.steps.length} step${m.steps.length === 1 ? "" : "s"} will be replaced when you stop.`, "Record"))) return;
    }
    const d = store.get(id);
    const s = E.view(d);
    const start = {};
    for (const t of E.counters(s)) start[t.id] = t.value;
    setMode("play");
    setBadges({});
    setRec({ target, start, logLen: d.log.length, redo: d.redo, taps: 0 });
    setFlash((f) => f + 1);
  };

  const stopRecording = () => {
    const r = recRef.current;
    if (!r) return;
    const d = store.get(id);
    const s = E.view(d);
    const steps = E.recordingSteps(s, r.start);
    setRec(null);
    setFlash((f) => f + 1);
    if (!steps.length) {
      toast("Nothing recorded — no counters changed");
      return;
    }
    let macro;
    if (r.target.macroId) {
      macro = { ...E.findMacro(s, r.target.macroId), steps };
      store.update(id, (dd) => E.editDraft(dd, (st) => E.upsertMacro(st, macro)));
    } else {
      macro = E.newMacro(E.nextMacroName(s), { steps });
      store.update(id, (dd) => E.editDraft(dd, (st) => {
        const bar = st.bar.slice();
        bar[r.target.slot] = macro.id;
        return { ...E.upsertMacro(st, macro), bar };
      }));
    }
    snack(`Saved “${macro.name}” · ${steps.length} step${steps.length === 1 ? "" : "s"}`, "Edit steps", () => nav.push({ name: "macro", id, macroId: macro.id }));
  };

  const cancelRecording = () => {
    const r = recRef.current;
    if (!r) return;
    store.update(id, (d) => ({
      ...E.withValues(d, new Map(Object.entries(r.start))),
      log: d.log.slice(0, r.logLen),
      redo: r.redo,
    }));
    setRec(null);
    setBadges({});
    toast("Recording cancelled — counters reverted");
  };

  // ---------- structural edits (pending until Save)
  const editWithUndo = (label, fn) => {
    const snap = store.get(id).draft;
    store.update(id, (d) => E.editDraft(d, fn));
    snack(label, "Undo", () => store.update(id, (d) => restoreDraft(d, snap)));
  };

  const deleteMacro = (macroId) => {
    const m = E.findMacro(v, macroId);
    setSheet(null);
    editWithUndo(`Deleted “${m ? m.name : "macro"}”`, (s) => E.deleteMacro(s, macroId));
  };

  const removeCell = (index) => {
    const c = v.cells[index];
    const name = c ? (c.kind === "counter" ? c.name : E.findMacro(v, c.macroId)?.name || "macro") : "";
    setSheet(null);
    setSelected(null);
    editWithUndo(`Removed “${name}”`, (s) => E.removeCell(s, index));
  };

  const removeFromBar = (macroId) => {
    const m = E.findMacro(v, macroId);
    setSheet(null);
    editWithUndo(`Removed “${m ? m.name : "macro"}”`, (s) => {
      const bar = s.bar.map((x) => (x === macroId ? null : x));
      const onGrid = s.cells.some((c) => c && c.kind === "macro" && c.macroId === macroId);
      return { ...s, bar, macros: onGrid ? s.macros : s.macros.filter((mm) => mm.id !== macroId) };
    });
  };

  const addCounter = (index) => {
    const n = E.counters(v).length;
    store.update(id, (d) => E.editDraft(d, (s) => {
      const cells = s.cells.slice();
      cells[index] = E.newCounter(n, { name: `Counter ${n + 1}` });
      return { ...s, cells };
    }));
    setSelected(index);
    setSheet({ type: "tile", index });
  };

  const addMacroCell = (index) => {
    const s0 = E.view(store.get(id));
    const macro = E.newMacro(E.nextMacroName(s0));
    store.update(id, (d) => E.editDraft(d, (s) => {
      const cells = s.cells.slice();
      cells[index] = { kind: "macro", id: E.uid(), macroId: macro.id };
      return { ...E.upsertMacro(s, macro), cells };
    }));
    setSheet({ type: "newmacro", macroId: macro.id });
  };

  const addMacroSlot = (slot) => {
    const s0 = E.view(store.get(id));
    const macro = E.newMacro(E.nextMacroName(s0));
    store.update(id, (d) => E.editDraft(d, (s) => {
      const bar = s.bar.slice();
      bar[slot] = macro.id;
      return { ...E.upsertMacro(s, macro), bar };
    }));
    nav.push({ name: "macro", id, macroId: macro.id });
  };

  const moveMacro = (macroId, where) => {
    const s = E.view(store.get(id));
    const r = where === "bar" ? E.moveMacroToBar(s, macroId) : E.moveMacroToGrid(s, macroId);
    if (!r.ok) return toast(r.reason);
    store.update(id, (d) => E.editDraft(d, () => r.structure));
    setSheet(null);
  };

  const save = () => {
    if (!pending) return;
    store.update(id, E.saveDraft);
    toast("Saved");
  };

  const resetGame = async () => {
    setSheet(null);
    if (await confirm("Reset / New game?", "Every counter goes back to its start value and the undo history is cleared.", "Reset", true)) {
      store.update(id, E.resetDash);
      setBadges({});
    }
  };

  // ---------- render helpers
  const holdMacro = (macroId) => (el) => setSheet({ type: "hold", macroId, anchor: el.closest(".slot, .macro-tile") || el });
  const recTargetIsCell = (cell) => rec && rec.target.macroId && cell.macroId === rec.target.macroId;

  const renderPlayCell = (cell, i) => {
    if (!cell) return html`<div class="cell-empty" key=${"e" + i} aria-hidden="true"></div>`;
    if (cell.kind === "counter") {
      return html`<${CounterTile} key=${cell.id} tile=${cell} layout=${layout} turn=${turn}
        badge=${badges[cell.id]} rec=${rec ? cell.value - (rec.start[cell.id] ?? cell.value) : null}
        onStep=${step} onHold=${(tile, dir) => setSheet({ type: "howmany", kind: "tile", tileId: tile.id, dir })} />`;
    }
    const m = E.findMacro(v, cell.macroId);
    if (!m) return html`<div class="cell-empty" key=${"e" + i}></div>`;
    const isRec = recTargetIsCell(cell);
    return html`<${MacroTile} key=${cell.id} macro=${m} turn=${turn} recording=${isRec} inert=${rec && !isRec}
      onRun=${() => tapMacro(m.id)} onHold=${holdMacro(m.id)} onStop=${stopRecording} />`;
  };

  const renderEditCell = (cell, i) => {
    if (!cell) {
      return html`<button key=${"e" + i} class="tile edit-tile edit-empty" aria-label="Empty cell. Add a counter or macro." onClick=${() => setSheet({ type: "add", index: i })}>
        <${Icon} name="plus" size=${28} /></button>`;
    }
    const isMacro = cell.kind === "macro";
    const m = isMacro ? E.findMacro(v, cell.macroId) : null;
    const name = isMacro ? (m ? m.name : "?") : cell.name;
    const icon = isMacro ? (m ? m.icon : "altar") : cell.icon;
    const color = isMacro ? "green" : cell.color;
    return html`
      <button key=${cell.id} class=${"tile edit-tile" + (isMacro ? " edit-macro" : "") + (selected === i ? " picked" : "")}
        aria-label=${`Edit ${isMacro ? "macro" : "tile"} ${name}`}
        onClick=${() => { setSelected(i); setSheet(isMacro ? { type: "macrocell", macroId: cell.macroId, index: i } : { type: "tile", index: i }); }}>
        <span class=${"c-" + color}><${Icon} name=${icon} size=${24} /></span>
        <span class="edit-name">${name}</span>
        ${isMacro && html`<span class="edit-kind">macro</span>`}
      </button>`;
  };

  const header = rec
    ? html`
      <header class="dash-head rec-head">
        <span class="rec-dot big" aria-hidden="true"></span>
        <div class="rec-text">
          <div class="rec-title">${rec.target.macroId ? `Recording “${E.findMacro(v, rec.target.macroId)?.name || "macro"}”` : `Recording macro ${rec.target.slot + 1}`}</div>
          <div class="rec-sub">${rec.taps} tap${rec.taps === 1 ? "" : "s"} so far · tap <${Icon} name="stop" size=${12} /> to finish</div>
        </div>
        <button class="btn btn-plain btn-sm" onClick=${cancelRecording}>Cancel</button>
      </header>`
    : mode === "edit"
    ? html`
      <header class="dash-head edit-head">
        <div class="edit-titles">
          <div class="head-title">${dash.name}</div>
          <div class="head-sub">Editing · tap a tile to change it</div>
        </div>
        <button class=${"btn btn-save" + (pending ? " on" : "")} disabled=${!pending} onClick=${save}><${Icon} name="save" size=${20} />Save</button>
        <button class="btn btn-primary btn-done" onClick=${() => { setMode("play"); setSelected(null); setSheet(null); }}>Done</button>
      </header>`
    : html`
      <header class="dash-head">
        <button class="icon-btn" aria-label="Back to dashes" onClick=${() => nav.back()}><${Icon} name="back" class="hrot" style=${turn ? { transform: `rotate(${turn}deg)` } : null} /></button>
        <button class="head-title title-btn" aria-label=${`${dash.name}. Menu`} onClick=${(e) => setSheet({ type: "title", anchor: e.currentTarget })}>${dash.name}</button>
        <button class="icon-btn round" aria-label=${dash.log.length ? `Undo ${dash.log[dash.log.length - 1].label}` : "Nothing to undo"} disabled=${!dash.log.length} onClick=${doUndo}>
          <${Icon} name="undo" size=${22} style=${turn ? { transform: `rotate(${turn}deg)` } : null} /></button>
        <button class="icon-btn round" aria-label=${dash.redo.length ? `Redo ${dash.redo[dash.redo.length - 1].label}` : "Nothing to redo"} disabled=${!dash.redo.length} onClick=${doRedo}>
          <${Icon} name="redo" size=${22} style=${turn ? { transform: `rotate(${turn}deg)` } : null} /></button>
        <button class="icon-btn round" aria-label="Edit dash" onClick=${() => { setBadges({}); setMode("edit"); }}>
          <${Icon} name="pencil" size=${20} style=${turn ? { transform: `rotate(${turn}deg)` } : null} /></button>
        <button class=${"btn btn-save" + (pending ? " on" : "")} disabled=${!pending} aria-label=${pending ? "Save changes" : "Nothing to save"} onClick=${save}>
          <${Icon} name="save" size=${18} style=${turn ? { transform: `rotate(${turn}deg)` } : null} />Save</button>
      </header>`;

  const gridStyle = {
    gridTemplateColumns: `repeat(${v.grid.cols}, minmax(0, 1fr))`,
    gridTemplateRows: mode === "edit" ? null : `repeat(${v.grid.rows}, minmax(0, 1fr))`,
  };

  const slotState = (i) => (rec ? (rec.target.slot === i || (rec.target.macroId && v.bar[i] === rec.target.macroId) ? "recording" : "dim") : "idle");

  // ---------- sheets
  let sheetEl = null;
  if (sheet) {
    const close = () => { setSheet(null); setSelected(null); };
    if (sheet.type === "howmany") {
      if (sheet.kind === "tile") {
        const tile = E.findTile(v, sheet.tileId);
        if (tile) sheetEl = html`<${HowMany} kind="tile" tile=${tile} dir=${sheet.dir} turn=${turn} onClose=${close}
          onDone=${(n) => { close(); commit(E.tapEvent(E.findTile(E.view(store.get(id)), tile.id), sheet.dir * n)); }} />`;
      } else {
        const m = E.findMacro(v, sheet.macroId);
        if (m) sheetEl = html`<${HowMany} kind="macro" macro=${m} turn=${turn} onClose=${close} onDone=${(n) => { close(); runMacro(m.id, n); }} />`;
      }
    } else if (sheet.type === "hold") {
      const m = E.findMacro(v, sheet.macroId);
      if (m) sheetEl = html`
        <${Popover} anchor=${sheet.anchor} onClose=${close}>
          <div class="pop-title">${m.name}</div>
          <div class="pop-sub">${m.steps.length} step${m.steps.length === 1 ? "" : "s"} · ${m.repeats ? "repeats" : "runs once"}</div>
          <${MenuItem} dot label="Record" onClick=${() => startRecording({ macroId: m.id })} />
          <${MenuItem} icon="pencil" label="Edit" onClick=${() => { close(); nav.push({ name: "macro", id, macroId: m.id }); }} />
          <${MenuItem} icon="trash" label="Delete" kind="danger" onClick=${() => deleteMacro(m.id)} />
        <//>`;
    } else if (sheet.type === "title") {
      sheetEl = html`
        <${Popover} anchor=${sheet.anchor} onClose=${close} highlight=${false}>
          <div class="pop-title">${dash.name}</div>
          <div class="pop-sub">${E.counters(v).length} counters · ${v.macros.length} macros · ${dash.log.length} in history</div>
          <${MenuItem} icon="reset" label="Reset / New game" kind="danger" onClick=${resetGame} />
          <${MenuItem} icon="pencil" label="Edit dash" onClick=${() => { close(); setBadges({}); setMode("edit"); }} />
          <${MenuItem} icon="list" label="All dashes" onClick=${() => { close(); nav.back(); }} />
        <//>`;
    } else if (sheet.type === "tile") {
      sheetEl = html`<${EditTileSheet} dash=${dash} index=${sheet.index} onClose=${close}
        onRemove=${() => removeCell(sheet.index)} onGrid=${() => setSheet({ type: "grid" })} />`;
    } else if (sheet.type === "grid") {
      sheetEl = html`<${GridSheet} dash=${dash} onClose=${close} />`;
    } else if (sheet.type === "add") {
      sheetEl = html`
        <${Sheet} onClose=${close} label="Add to this cell">
          <h2 class="sheet-title">Add to this cell</h2>
          <div class="choice-row">
            <button class="choice" onClick=${() => addCounter(sheet.index)}><${Icon} name="hexplus" size=${30} /><b>Counter</b><span>A tile with − and +</span></button>
            <button class="choice choice-macro" onClick=${() => addMacroCell(sheet.index)}><${Icon} name="play" size=${30} /><b>Macro</b><span>A big ▶ button that runs steps</span></button>
          </div>
        <//>`;
    } else if (sheet.type === "newmacro" || sheet.type === "macrocell" || sheet.type === "macroslot") {
      const m = E.findMacro(v, sheet.macroId);
      if (m) {
        const place = E.macroPlacements(v, m.id);
        const onBar = place.bar >= 0;
        const onGrid = place.cell >= 0;
        sheetEl = html`
          <${Sheet} onClose=${close} label=${m.name}>
            <div class="hm-head">
              <span class="hm-icon macro"><${Icon} name=${m.icon} size=${24} /></span>
              <div><div class="hm-title">${m.name}</div><div class="hm-sub">${m.steps.length} step${m.steps.length === 1 ? "" : "s"} · ${m.repeats ? "repeats" : "runs once"}${onBar ? " · on the bar" : ""}${onGrid ? " · in the grid" : ""}</div></div>
            </div>
            <div class="menu-list">
              <${MenuItem} icon="pencil" label="Edit steps" onClick=${() => { close(); nav.push({ name: "macro", id, macroId: m.id }); }} />
              <${MenuItem} dot label=${sheet.type === "newmacro" ? "Record now" : "Record"} onClick=${() => startRecording({ macroId: m.id })} />
              ${sheet.type === "macroslot"
                ? !onGrid && html`<${MenuItem} icon="grid" label="Move to grid" onClick=${() => moveMacro(m.id, "grid")} />`
                : !onBar && html`<${MenuItem} icon="bar" label="Move to macro bar" onClick=${() => moveMacro(m.id, "bar")} />`}
              <${MenuItem} icon="trash" kind="danger" label="Remove" onClick=${() => (sheet.type === "macroslot" ? removeFromBar(m.id) : removeCell(sheet.index ?? place.cell))} />
            </div>
          <//>`;
      }
    }
  }

  return html`
    <div class=${"page dash-page mode-" + mode + (rec ? " recording" : "")}>
      ${header}
      ${mode === "edit"
        ? html`
          <div class="scroll edit-scroll">
            <div class=${"grid edit-grid g-" + E.gridKey(v.grid)} style=${gridStyle}>${v.cells.map(renderEditCell)}</div>
            <button class="btn btn-plain btn-block btn-sm-gap" onClick=${() => setSheet({ type: "grid" })}><${Icon} name="grid" size=${20} />Change grid · ${v.grid.cols} × ${v.grid.rows}</button>
            <div class="field-label">Macro bar</div>
            <div class="macro-bar edit-bar">
              ${v.bar.map((mid, i) => {
                const m = mid && E.findMacro(v, mid);
                return html`<div class="slot" key=${i}>
                  ${m
                    ? html`<button class="slot-btn slot-set" aria-label=${`Edit ${m.name}`} onClick=${() => setSheet({ type: "macroslot", macroId: m.id })}><${Icon} name=${m.icon} size=${26} /></button>
                      <span class="slot-label">${m.name}</span>`
                    : html`<button class="slot-btn slot-empty" aria-label=${`New macro in slot ${i + 1}`} onClick=${() => addMacroSlot(i)}><${Icon} name="plus" size=${22} /></button>
                      <span class="slot-label muted">${i === v.bar.indexOf(null) ? "New macro" : "\u00a0"}</span>`}
                </div>`;
              })}
            </div>
            <div class="field-label">Horizontal view</div>
            <${Segmented} label="Horizontal view" value=${dash.turn || 0}
              options=${[{ value: 0, label: "Upright" }, { value: 90, label: "Turned left" }, { value: -90, label: "Turned right" }]}
              onChange=${(t) => store.update(id, (d) => ({ ...d, turn: t }))} />
            <p class="hint">For a rotation-locked phone held sideways during play. Tile contents turn; nothing moves. If your phone rotates the screen itself, this happens automatically.</p>
          </div>`
        : html`
          <main class=${"grid play-grid g-" + E.gridKey(v.grid)} style=${gridStyle}>${v.cells.map(renderPlayCell)}</main>
          <nav class="macro-bar" aria-label="Macros">
            ${v.bar.map((mid, i) => html`<${MacroSlot} key=${i} index=${i} macro=${mid && E.findMacro(v, mid)} turn=${turn} state=${slotState(i)} hint=${i === v.bar.indexOf(null)}
              onRun=${() => tapMacro(mid)} onHold=${holdMacro(mid)} onEmptyHold=${() => startRecording({ slot: i })} onStop=${stopRecording} />`)}
          </nav>`}
      ${rec && html`<div class="rec-border" aria-hidden="true"></div>`}
      ${flash > 0 && html`<div class="flash" key=${flash} aria-hidden="true" onAnimationEnd=${(e) => (e.currentTarget.style.display = "none")}></div>`}
      ${sheetEl}
    </div>`;
}
