import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import * as store from "../store.js";
import * as E from "../engine.js";
import { Icon } from "../icons.js";
import { Sheet, Segmented, IntInput, confirm, snack, toast } from "../ui.js";
import { IconPicker } from "./pickers.js";

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const withKeys = (m) => ({ ...m, vars: m.vars.map((x) => ({ ...x })), steps: m.steps.map((s) => ({ ...s, _k: E.uid() })) });
const stripKeys = (m) => ({ ...m, steps: m.steps.map(({ _k, ...s }) => s) });
const refKey = (r) => (r.kind === "tile" ? "t:" + r.tileId : "v:" + r.name);
const keyRef = (k) => (k.startsWith("t:") ? { kind: "tile", tileId: k.slice(2) } : { kind: "var", name: k.slice(2) });

function RefOptions({ tiles, vars }) {
  return html`
    ${tiles.length > 0 && html`<optgroup label="Tiles">${tiles.map((t) => html`<option value=${"t:" + t.id}>${t.name}</option>`)}</optgroup>`}
    ${vars.length > 0 && html`<optgroup label="Variables">${vars.map((x) => html`<option value=${"v:" + x.name}>$${x.name}</option>`)}</optgroup>`}`;
}

function TargetSelect({ s, macro, step, onChange }) {
  const broken = E.refBroken(s, macro, step.target);
  const isVar = step.target.kind === "var";
  return html`
    <div class=${"sel" + (isVar ? " is-var" : "") + (broken ? " broken" : "")}>
      <span class="sel-label">${broken ? (isVar ? "Var removed" : "Tile removed") : E.refLabel(s, step.target)}</span>
      <${Icon} name="updown" size=${16} />
      <select aria-label="Target" value=${broken ? "" : refKey(step.target)} onChange=${(e) => onChange(keyRef(e.currentTarget.value))}>
        ${broken && html`<option value="" disabled>${isVar ? "Var removed" : "Tile removed"}</option>`}
        <${RefOptions} tiles=${E.counters(s)} vars=${macro.vars} />
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

/** One control: type a number, or pick a tile (⌁) / $variable from the list. */
function ValueBox({ s, macro, step, onChange }) {
  const lit = typeof step.value === "number";
  const lastNum = useRef(lit ? step.value : 1);
  if (lit) lastNum.current = step.value;
  const picker = html`
    <select class="valpick" aria-label="Pick a tile or variable as the value" value=${lit ? "#" : E.refBroken(s, macro, step.value) ? "" : refKey(step.value)}
      onChange=${(e) => { const k = e.currentTarget.value; onChange(k === "#" ? lastNum.current : keyRef(k)); }}>
      ${!lit && E.refBroken(s, macro, step.value) && html`<option value="" disabled>removed</option>`}
      <option value="#">Type a number</option>
      <${RefOptions} tiles=${E.counters(s)} vars=${macro.vars} />
    </select>`;
  if (lit) {
    return html`
      <div class="valbox">
        <${IntInput} class="val-input" label="Value" value=${step.value} onChange=${onChange} />
        <span class="val-chev"><${Icon} name="chevdown" size=${16} />${picker}</span>
      </div>`;
  }
  const broken = E.refBroken(s, macro, step.value);
  const isVar = step.value.kind === "var";
  return html`
    <div class=${"sel valbox-ref" + (isVar ? " is-var" : " is-tile") + (broken ? " broken" : "")}>
      <span class="sel-label">${broken ? "Tile removed" : isVar ? "$" + step.value.name : "⌁ " + E.refLabel(s, step.value)}</span>
      <${Icon} name="chevdown" size=${16} />
      ${picker}
    </div>`;
}

function VarSheet({ macro, editing, onClose, onSave, onDelete }) {
  const cur = editing ? macro.vars.find((x) => x.name === editing) : null;
  const [name, setName] = useState(cur ? cur.name : "");
  const [initial, setInitial] = useState(cur ? cur.initial : 0);
  const clean = name.trim().replace(/^\$/, "");
  const err = !clean ? "Give the variable a name." : !VAR_RE.test(clean) ? "Letters, digits and _ only, not starting with a digit." :
    macro.vars.some((x) => x.name === clean && x.name !== editing) ? "There's already a variable with that name." : "";
  const [tried, setTried] = useState(false);
  const save = () => { setTried(true); if (!err) onSave(clean, initial); };
  return html`
    <${Sheet} onClose=${onClose} label=${cur ? "Edit variable" : "New variable"}>
      <h2 class="sheet-title">${cur ? "Edit variable" : "New variable"}</h2>
      <div class="row-2">
        <div class="grow">
          <label class="field-label" for="vn">Name</label>
          <div class="var-name-wrap"><span class="var-dollar">$</span>
            <input id="vn" class="input mono" value=${name} maxlength="20" autocapitalize="off" autocomplete="off" spellcheck="false"
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
      <p class="hint">Resets to this value at the start of every run.</p>
      <div class="sheet-row">
        ${cur && html`<button class="btn btn-danger-soft" onClick=${onDelete}>Delete</button>`}
        <button class="btn btn-primary grow" onClick=${save}>${cur ? "Done" : "Add variable"}</button>
      </div>
    <//>`;
}

export function MacroEditor({ id, macroId, nav }) {
  const dash = store.get(id);
  const s = E.view(dash);
  const orig = E.findMacro(s, macroId);
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
    nav.setGuard(dirty ? async () => confirm("Discard changes?", "Your edits to this macro haven't been saved.", "Discard", true) : null);
  }, [dirty]);

  if (!m) {
    return html`<div class="page"><header class="bar-head"><button class="icon-btn round" aria-label="Back" onClick=${() => nav.back()}><${Icon} name="back" /></button><h1 class="head-title">Macro not found</h1></header></div>`;
  }

  const set = (patch) => setM((x) => ({ ...x, ...patch }));
  const setStep = (i, patch) => setM((x) => ({ ...x, steps: x.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const tiles = E.counters(s);

  const save = () => {
    if (!dirty) return;
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
        <h1 class="head-title">Edit macro</h1>
        <button class=${"btn btn-save" + (dirty ? " on" : "")} disabled=${!dirty} onClick=${save}>Save</button>
      </header>
      <div class="scroll">
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

        <div class="field-label">Variables · usable as a target or a source</div>
        <div class="chips">
          ${m.vars.map((x) => html`<button class="chip var-chip" onClick=${() => setSheet({ type: "var", editing: x.name })}>$${x.name} = ${x.initial}</button>`)}
          <button class="chip chip-new" onClick=${() => setSheet({ type: "var", editing: null })}>+ New var</button>
        </div>

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
                <div class=${"step-preview" + (broken ? " broken" : "")}>${broken ? "Tile removed — this step is skipped when the macro runs" : E.describeStep(s, m, st)}</div>
              </li>`;
          })}
        </ol>
        ${!m.steps.length && html`<p class="hint center">No steps yet. Add one, or record the macro from the dash.</p>`}
        <button class="btn btn-dashed btn-block" onClick=${addStep}><${Icon} name="plus" size=${20} />Add step</button>

        <div class="key-box">
          <div class="key-title">Key</div>
          <div class="key-ops"><span class="t-teal">+ add</span><span class="t-teal">− take</span><span class="t-teal">× multiply</span><span class="t-teal">÷ divide</span><span class="t-purple">= set</span></div>
          <p class="muted small">Right-hand box: type a number, or pick a tile (⌁) or a $variable. Steps run top to bottom; ÷ rounds down.</p>
        </div>
      </div>
      ${sheet && sheet.type === "icon" && html`
        <${Sheet} onClose=${() => setSheet(null)} label="Macro icon">
          <h2 class="sheet-title">Icon</h2>
          <${IconPicker} value=${m.icon} color="green" onChange=${(icon) => { set({ icon }); setSheet(null); }} />
        <//>`}
      ${sheet && sheet.type === "var" && html`<${VarSheet} macro=${m} editing=${sheet.editing} onClose=${() => setSheet(null)} onSave=${saveVar} onDelete=${delVar} />`}
    </div>`;
}
