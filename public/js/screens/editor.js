import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import * as store from "../store.js";
import * as E from "../engine.js";
import { Icon } from "../icons.js";
import { Sheet, Segmented, IntInput, confirm, snack, toast } from "../ui.js";
import { IconPicker } from "./pickers.js";

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const withKeys = (m) => ({ ...m, vars: m.vars.map((x) => ({ ...x })), steps: m.steps.map((s) => ({ ...s, _k: E.uid() })) });
const stripKeys = (m) => ({ ...m, steps: m.steps.map(({ _k, ...s }) => s) });
const refKey = (r) =>
  r.kind === "tile" ? "t:" + r.tileId : r.kind === "toggle" ? "g:" + r.toggleId : r.kind === "dvar" ? "d:" + r.varId : "v:" + r.name;
function keyRef(k) {
  const v = k.slice(2);
  if (k.startsWith("t:")) return { kind: "tile", tileId: v };
  if (k.startsWith("g:")) return { kind: "toggle", toggleId: v };
  if (k.startsWith("d:")) return { kind: "dvar", varId: v };
  return { kind: "var", name: v };
}
/** $vars offered in dropdowns: a trigger also gets the built-in $change. */
const varsFor = (m) => (m.when ? [{ name: "change" }, ...m.vars] : m.vars);
const isVarRef = (r) => r.kind === "var" || r.kind === "dvar";
const removedLabel = (r) => (r.kind === "var" || r.kind === "dvar" ? "Var removed" : r.kind === "toggle" ? "Toggle removed" : "Tile removed");

function RefOptions({ s, vars }) {
  const tiles = E.counters(s), tgs = E.toggles(s), dvars = E.dashVars(s);
  return html`
    ${tiles.length > 0 && html`<optgroup label="Tiles">${tiles.map((t) => html`<option value=${"t:" + t.id}>${t.name}</option>`)}</optgroup>`}
    ${tgs.length > 0 && html`<optgroup label="Toggles (1 = on, 0 = off)">${tgs.map((t) => html`<option value=${"g:" + t.id}>${t.name}</option>`)}</optgroup>`}
    ${dvars.length > 0 && html`<optgroup label="Dash variables">${dvars.map((x) => html`<option value=${"d:" + x.id}>@${x.name}</option>`)}</optgroup>`}
    ${vars.length > 0 && html`<optgroup label="Macro variables">${vars.map((x) => html`<option value=${"v:" + x.name}>$${x.name}</option>`)}</optgroup>`}`;
}

function TargetSelect({ s, macro, step, onChange }) {
  const broken = E.refBroken(s, macro, step.target);
  const isVar = isVarRef(step.target);
  return html`
    <div class=${"sel" + (isVar ? " is-var" : "") + (step.target.kind === "dvar" ? " is-dvar" : "") + (broken ? " broken" : "")}>
      <span class="sel-label">${broken ? removedLabel(step.target) : E.refLabel(s, step.target)}</span>
      <${Icon} name="updown" size=${16} />
      <select aria-label="Target" value=${broken ? "" : refKey(step.target)} onChange=${(e) => onChange(keyRef(e.currentTarget.value))}>
        ${broken && html`<option value="" disabled>${removedLabel(step.target)}</option>`}
        <${RefOptions} s=${s} vars=${varsFor(macro)} />
      </select>
    </div>`;
}

function OpSelect({ op, onChange }) {
  return html`
    <div class=${"sel op-sel " + (op === "=" ? "op-set" : "op-arith")}>
      <span class="op-glyph">${E.OP_GLYPH[op]}</span>
      <${Icon} name="updown" size=${14} />
      <select aria-label="Action" value=${op} onChange=${(e) => onChange(e.currentTarget.value)}>
        <option value="+">+ add</option>
        <option value="-">− take</option>
        <option value="*">× multiply</option>
        <option value="/">÷ divide</option>
        <option value="=">= set</option>
      </select>
    </div>`;
}

/** One control: type a number, or pick a tile/toggle (⌁), @dash var or $macro var from the list. */
function ValueBox({ s, macro, step, onChange }) {
  const lit = typeof step.value === "number";
  const lastNum = useRef(lit ? step.value : 1);
  if (lit) lastNum.current = step.value;
  const broken = !lit && E.refBroken(s, macro, step.value);
  const picker = html`
    <select class="valpick" aria-label="Pick a tile, toggle or variable as the value" value=${lit ? "#" : broken ? "" : refKey(step.value)}
      onChange=${(e) => { const k = e.currentTarget.value; onChange(k === "#" ? lastNum.current : keyRef(k)); }}>
      ${broken && html`<option value="" disabled>removed</option>`}
      <option value="#">Type a number</option>
      <${RefOptions} s=${s} vars=${varsFor(macro)} />
    </select>`;
  if (lit) {
    return html`
      <div class="valbox">
        <${IntInput} class="val-input" label="Value" value=${step.value} onChange=${onChange} />
        <span class="val-chev"><${Icon} name="chevdown" size=${16} />${picker}</span>
      </div>`;
  }
  const isVar = isVarRef(step.value);
  return html`
    <div class=${"sel valbox-ref" + (isVar ? " is-var" : " is-tile") + (step.value.kind === "dvar" ? " is-dvar" : "") + (broken ? " broken" : "")}>
      <span class="sel-label">${broken ? removedLabel(step.value) : isVar ? E.refLabel(s, step.value) : "⌁ " + E.refLabel(s, step.value)}</span>
      <${Icon} name="chevdown" size=${16} />
      ${picker}
    </div>`;
}

/**
 * Name + starting value sheet, for $macro vars and @dash vars.
 * names: names already taken (excluding the one being edited).
 */
export function VarSheet({ sigil = "$", current, names, onClose, onSave, onDelete, hint }) {
  const [name, setName] = useState(current ? current.name : "");
  const [initial, setInitial] = useState(current ? current.initial : 0);
  const clean = name.trim().replace(sigil === "$" ? /^\$/ : /^@/, "");
  const err = !clean ? "Give the variable a name." :
    sigil === "$" && !VAR_RE.test(clean) ? "Letters, digits and _ only, not starting with a digit." :
    names.includes(clean) ? "There's already a variable with that name." : "";
  const [tried, setTried] = useState(false);
  const save = () => { setTried(true); if (!err) onSave(clean, initial); };
  const title = (current ? "Edit " : "New ") + (sigil === "@" ? "dash variable" : "variable");
  return html`
    <${Sheet} onClose=${onClose} label=${title}>
      <h2 class="sheet-title">${title}</h2>
      <div class="row-2">
        <div class="grow">
          <label class="field-label" for="vn">Name</label>
          <div class="var-name-wrap"><span class="var-dollar">${sigil}</span>
            <input id="vn" class=${"input" + (sigil === "$" ? " mono" : "")} value=${name} maxlength="20" autocapitalize=${sigil === "$" ? "off" : "sentences"} autocomplete="off" spellcheck="false"
              onInput=${(e) => setName(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && save()} />
          </div>
        </div>
        <div class="start-col">
          <label class="field-label" for="vi">Starts at</label>
          <div class="start-wrap">
            <${IntInput} id="vi" label="Initial value" value=${initial} onChange=${setInitial} />
            <button class="icon-btn sign-btn" aria-label="Flip sign" onClick=${() => setInitial(-initial)}>±</button>
          </div>
        </div>
      </div>
      ${tried && err && html`<div class="field-err" role="alert">${err}</div>`}
      <p class="hint">${hint || "Resets to this value at the start of every run."}</p>
      <div class="sheet-row">
        ${current && html`<button class="btn btn-danger-soft" onClick=${onDelete}>Delete</button>`}
        <button class="btn btn-primary grow" onClick=${save}>${current ? "Done" : "Add variable"}</button>
      </div>
    <//>`;
}

/**
 * Step editor for a macro, or (with tileId + triggerId) for a counter's trigger.
 * Triggers have no name/icon/repeats; instead "when" and "per point".
 */
export function MacroEditor({ id, macroId, tileId, triggerId, nav }) {
  const dash = store.get(id);
  const s = E.view(dash);
  const isTrigger = !!triggerId;
  const owner = isTrigger ? E.findTile(s, tileId) || E.findToggle(s, tileId) : null;
  const ownerIsToggle = !!(owner && !E.findTile(s, tileId));
  const orig = isTrigger ? (owner && (owner.triggers || []).find((t) => t.id === triggerId)) || null : E.findMacro(s, macroId);
  const [m, setM] = useState(() => (orig ? withKeys(orig) : null));
  const [sheet, setSheet] = useState(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const listRef = useRef(null);
  const origJson = useRef(orig ? JSON.stringify(orig) : "");

  const dirty = m && JSON.stringify(stripKeys(m)) !== origJson.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    nav.setGuard(dirty ? async () => confirm("Discard changes?", `Your edits to this ${isTrigger ? "trigger" : "macro"} haven't been saved.`, "Discard", true) : null);
  }, [dirty]);

  if (!m) {
    return html`<div class="page"><header class="bar-head"><button class="icon-btn round" aria-label="Back" onClick=${() => nav.back()}><${Icon} name="back" /></button><h1 class="head-title">${isTrigger ? "Trigger" : "Macro"} not found</h1></header></div>`;
  }

  const set = (patch) => setM((x) => ({ ...x, ...patch }));
  const setStep = (i, patch) => setM((x) => ({ ...x, steps: x.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const tiles = E.counters(s);

  const save = () => {
    if (!dirty) return;
    if (isTrigger) {
      const out = stripKeys(m);
      store.update(id, (d) => E.editDraft(d, (st) => {
        const upsert = (trs = []) => (trs.some((t) => t.id === out.id) ? trs.map((t) => (t.id === out.id ? out : t)) : [...trs, out]);
        const idx = st.cells.findIndex((c) => c && (c.id === tileId || (c.kind === "toggles" && c.toggles.some((t) => t.id === tileId))));
        if (idx < 0) return st;
        const cell = st.cells[idx];
        if (cell.kind === "toggles") {
          return E.updateCell(st, idx, { toggles: cell.toggles.map((t) => (t.id === tileId ? { ...t, triggers: upsert(t.triggers) } : t)) });
        }
        return E.updateCell(st, idx, { triggers: upsert(cell.triggers) });
      }));
      toast("Trigger updated — tap Save on the dash to keep it");
      nav.forceBack();
      return;
    }
    const out = stripKeys({ ...m, name: m.name.trim() || "Macro" });
    store.update(id, (d) => E.editDraft(d, (st) => E.upsertMacro(st, out)));
    toast("Macro updated — tap Save on the dash to keep it");
    nav.forceBack();
  };

  const addStep = () => {
    if (!tiles.length) return toast("Add a counter tile first");
    set({ steps: [...m.steps, { target: { kind: "tile", tileId: tiles[0].id }, op: "+", value: 1, _k: E.uid() }] });
  };

  const delStep = (i) => {
    const before = m.steps;
    set({ steps: m.steps.filter((_, j) => j !== i) });
    snack(`Deleted step ${i + 1}`, "Undo", () => setM((x) => ({ ...x, steps: before })));
  };

  const saveVar = (name, initial) => {
    if (sheet.editing) {
      let next = sheet.editing !== name ? E.renameVar(m, sheet.editing, name) : m;
      next = { ...next, vars: next.vars.map((x) => (x.name === name ? { ...x, initial } : x)) };
      setM({ ...next, steps: next.steps.map((st, j) => ({ ...st, _k: m.steps[j]._k })) });
    } else {
      set({ vars: [...m.vars, { name, initial }] });
    }
    setSheet(null);
  };

  const delVar = () => {
    const name = sheet.editing;
    const before = m;
    set({ vars: m.vars.filter((x) => x.name !== name) });
    setSheet(null);
    const uses = m.steps.filter((st) => (st.target.kind === "var" && st.target.name === name) || (typeof st.value === "object" && st.value.kind === "var" && st.value.name === name)).length;
    snack(uses ? `Deleted $${name} — ${uses} step${uses === 1 ? "" : "s"} now broken` : `Deleted $${name}`, "Undo", () => setM(before));
  };

  // ---------- drag to reorder (handle on the step number)
  const onDragStart = (e, i) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rows = [...listRef.current.querySelectorAll(".step-row")];
    dragRef.current = { from: i, cur: i, grabY: e.clientY, tops: rows.map((r) => r.offsetTop), hs: rows.map((r) => r.offsetHeight) };
    setDrag({ i, dy: 0 });
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.grabY;
    const center = d.tops[d.from] + d.hs[d.from] / 2 + dy;
    let k = d.tops.findIndex((t, j) => center >= t && center < t + d.hs[j] + 8);
    if (k < 0) k = center < d.tops[0] ? 0 : d.tops.length - 1;
    if (k !== d.cur) {
      const from = d.cur;
      setM((x) => {
        const steps = x.steps.slice();
        const [it] = steps.splice(from, 1);
        steps.splice(k, 0, it);
        return { ...x, steps };
      });
      d.cur = k;
    }
    setDrag({ i: d.cur, dy: d.tops[d.from] + dy - d.tops[d.cur] });
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDrag(null);
  };

  return html`
    <div class="page editor-page">
      <header class="bar-head">
        <button class="icon-btn round" aria-label="Back" onClick=${() => nav.back()}><${Icon} name="back" /></button>
        <h1 class="head-title">${isTrigger ? "Edit trigger" : "Edit macro"}</h1>
        <button class=${"btn btn-save" + (dirty ? " on" : "")} disabled=${!dirty} onClick=${save}>Save</button>
      </header>
      <div class="scroll">
        ${isTrigger ? html`
          <div class="field-label">When ${owner ? owner.name : "this tile"}…</div>
          ${ownerIsToggle
            ? html`<${Segmented} label="When" value=${m.when} options=${[{ value: "up", label: "Turns on" }, { value: "down", label: "Turns off" }, { value: "change", label: "Changes" }]} onChange=${(w) => set({ when: w })} />
              <p class="hint">Fires straight away when the switch flips, whether you tapped it or a macro set it. <span class="dvar-inline mono">$change</span> is 1.</p>`
            : html`<${Segmented} label="When" value=${m.when} options=${[{ value: "down", label: "Goes down" }, { value: "up", label: "Goes up" }, { value: "change", label: "Changes" }]} onChange=${(w) => set({ when: w })} />
          <div class="field-label">Run</div>
          <${Segmented} label="Run" value=${m.perPoint} options=${[{ value: false, label: "Once" }, { value: true, label: "Once per point" }]} onChange=${(pp) => set({ perPoint: pp })} />
          <p class="hint">${m.perPoint
            ? html`Taking 3 off runs the steps 3 times, with <span class="dvar-inline mono">$change</span> = 1 each time.`
            : html`Runs once, with <span class="dvar-inline mono">$change</span> = how much it moved (always positive). Fires straight away, even in the middle of a macro.`}</p>`}
        ` : html`
          <div class="name-row">
            <button class="macro-icon-btn" aria-label="Change icon" onClick=${() => setSheet({ type: "icon" })}><${Icon} name=${m.icon} size=${26} /></button>
            <div class="grow">
              <label class="field-label" for="mn">Name</label>
              <input id="mn" class="input" value=${m.name} maxlength="24" onInput=${(e) => set({ name: e.currentTarget.value })} />
            </div>
          </div>

          <div class="field-label">Repeats</div>
          <${Segmented} label="Repeats" value=${m.repeats} options=${[{ value: false, label: "No" }, { value: true, label: "Yes" }]} onChange=${(r) => set({ repeats: r })} />
          <p class="hint">‘Yes’ will ask you how many times to run when you run it.</p>
        `}

        <div class="field-label">${isTrigger ? "Variables · reset every run" : "Macro variables · reset every run"}</div>
        <div class="chips">
          ${isTrigger && html`<span class="chip var-chip builtin" title="Built in">$change</span>`}
          ${m.vars.map((x) => html`<button class="chip var-chip" onClick=${() => setSheet({ type: "var", editing: x.name })}>$${x.name} = ${x.initial}</button>`)}
          <button class="chip chip-new" onClick=${() => setSheet({ type: "var", editing: null })}>+ New var</button>
        </div>
        <p class="hint">${E.dashVars(s).length
          ? html`Dash variables keep their value between runs: ${E.dashVars(s).map((x) => html`<span class="dvar-inline">@${x.name}</span> `)}`
          : "Need a value that lasts between runs, like commander tax? Add an @dash variable in the dash's edit mode."}</p>

        <div class="steps-head"><span class="field-label">Steps · drag to reorder</span><span class="muted small">Target · action · value or source</span></div>
        <ol class="steps" ref=${listRef}>
          ${m.steps.map((st, i) => {
            const broken = E.stepBroken(s, m, st);
            const dragging = drag && drag.i === i;
            return html`
              <li key=${st._k} class=${"step-row" + (dragging ? " dragging" : "") + (broken ? " is-broken" : "")} style=${dragging ? { transform: `translateY(${drag.dy}px)` } : null}>
                <div class="step-grid">
                  <button class="step-num" aria-label=${`Step ${i + 1}. Drag to reorder`}
                    onPointerDown=${(e) => onDragStart(e, i)} onPointerMove=${onDragMove} onPointerUp=${onDragEnd} onPointerCancel=${onDragEnd}
                    onKeyDown=${(e) => {
                      const k = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                      if (k < 0 || k >= m.steps.length) return;
                      e.preventDefault();
                      const steps = m.steps.slice();
                      const [it] = steps.splice(i, 1);
                      steps.splice(k, 0, it);
                      set({ steps });
                    }}>${i + 1}</button>
                  <${TargetSelect} s=${s} macro=${m} step=${st} onChange=${(target) => setStep(i, { target })} />
                  <${OpSelect} op=${st.op} onChange=${(op) => setStep(i, { op })} />
                  <${ValueBox} s=${s} macro=${m} step=${st} onChange=${(value) => setStep(i, { value })} />
                  <button class="step-del" aria-label=${`Delete step ${i + 1}`} onClick=${() => delStep(i)}><${Icon} name="x" size=${20} /></button>
                </div>
              </li>`;
          })}
        </ol>
        ${!m.steps.length && html`<p class="hint center">No steps yet. Add one, or record the macro from the dash.</p>`}
        <button class="btn btn-dashed btn-block" onClick=${addStep}><${Icon} name="plus" size=${20} />Add step</button>

        <div class="key-box">
          <div class="key-title">Key</div>
          <div class="key-ops"><span class="t-teal">+ add</span><span class="t-teal">− take</span><span class="t-teal">× multiply</span><span class="t-teal">÷ divide</span><span class="t-purple">= set</span></div>
          <p class="muted small">Right-hand box: type a number, or pick a tile or toggle (⌁), an @dash variable or a $macro variable. Toggles read as 1 (on) or 0 (off); setting one to anything but 0 turns it on. Steps run top to bottom; ÷ rounds down.</p>
        </div>
      </div>
      ${sheet && sheet.type === "icon" && html`
        <${Sheet} onClose=${() => setSheet(null)} label="Macro icon">
          <h2 class="sheet-title">Icon</h2>
          <${IconPicker} value=${m.icon} color="green" onChange=${(icon) => { set({ icon }); setSheet(null); }} />
        <//>`}
      ${sheet && sheet.type === "var" && html`<${VarSheet} current=${sheet.editing ? m.vars.find((x) => x.name === sheet.editing) : null}
        names=${[...(isTrigger ? ["change"] : []), ...m.vars.map((x) => x.name).filter((n) => n !== sheet.editing)]} onClose=${() => setSheet(null)} onSave=${saveVar} onDelete=${delVar} />`}
    </div>`;
}
