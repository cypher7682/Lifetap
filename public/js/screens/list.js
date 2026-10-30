import { html, useState } from "../../vendor/preact-htm.js";
import * as store from "../store.js";
import * as E from "../engine.js";
import { Icon } from "../icons.js";
import { usePress, Sheet, confirm, snack } from "../ui.js";
import { IconPicker, ColorPicker } from "./pickers.js";

function DashCard({ dash, onOpen, onHold }) {
  const v = E.view(dash);
  const nc = E.counters(v).length;
  const nm = v.macros.length;
  const press = usePress({ onTap: onOpen, onLong: onHold });
  return html`
    <button class="card" ...${press} aria-label=${`${dash.name}, ${nc} counters, ${nm} macros. Hold for options.`}>
      <span class=${"card-icon tint-" + dash.color}><${Icon} name=${dash.icon} size=${38} /></span>
      <span class="card-name">${dash.name}</span>
      <span class="card-meta">${nc} counter${nc === 1 ? "" : "s"} · ${nm} macro${nm === 1 ? "" : "s"}</span>
    </button>`;
}

function DashOptions({ dash, onClose }) {
  const [name, setName] = useState(dash.name);
  const [icon, setIcon] = useState(dash.icon);
  const [color, setColor] = useState(dash.color);
  const err = !name.trim();
  const save = () => {
    if (err) return;
    store.update(dash.id, (d) => ({ ...d, name: name.trim(), icon, color }));
    onClose();
  };
  return html`
    <${Sheet} onClose=${save} label="Dash options">
      <h2 class="sheet-title">Dash options</h2>
      <label class="field-label" for="dn">Name</label>
      <input id="dn" class=${"input" + (err ? " invalid" : "")} value=${name} onInput=${(e) => setName(e.currentTarget.value)} maxlength="40" />
      ${err && html`<div class="field-err">Give the dash a name.</div>`}
      <div class="field-label">Icon</div>
      <${IconPicker} value=${icon} color=${color} onChange=${setIcon} />
      <div class="field-label">Colour</div>
      <${ColorPicker} value=${color} onChange=${setColor} />
      <div class="sheet-row">
        <button class="btn btn-plain" onClick=${() => {
          const copy = E.duplicateDash(dash, dash.name + " copy");
          store.put(copy);
          onClose();
          snack(`Duplicated as “${copy.name}”`);
        }}><${Icon} name="copy" size=${20} /> Duplicate</button>
        <button class="btn btn-danger-soft" onClick=${async () => {
          if (await confirm(`Delete “${dash.name}”?`, "Its counters, macros and history will be gone for good.", "Delete", true)) {
            store.remove(dash.id);
            onClose();
          }
        }}><${Icon} name="trash" size=${20} /> Delete</button>
      </div>
      <button class="btn btn-primary btn-block" disabled=${err} onClick=${save}>Done</button>
    <//>`;
}

export function DashList({ nav }) {
  const dashes = store.list();
  const [opts, setOpts] = useState(null);
  return html`
    <div class="page list-page">
      <h1 class="page-title">Dashes</h1>
      <p class="hint">${dashes.length ? "Tap to open · hold to rename, duplicate or delete" : "A dash is a grid of counters plus one-tap macros. Make your first one."}</p>
      <div class="cards">
        ${dashes.map((d) => html`<${DashCard} key=${d.id} dash=${d} onOpen=${() => nav.push({ name: "dash", id: d.id })} onHold=${() => setOpts(d.id)} />`)}
        <button class="card card-add" onClick=${() => nav.push({ name: "new" })}>
          <${Icon} name="plus" size=${44} />
          <span class="card-name">Add new</span>
        </button>
      </div>
      ${opts && store.get(opts) && html`<${DashOptions} dash=${store.get(opts)} onClose=${() => setOpts(null)} />`}
    </div>`;
}
