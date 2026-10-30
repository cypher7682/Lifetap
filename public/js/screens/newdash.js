import { html, useState } from "../../vendor/preact-htm.js";
import * as store from "../store.js";
import * as E from "../engine.js";
import { Icon } from "../icons.js";
import { GridPicker } from "./pickers.js";

export function NewDash({ nav }) {
  const [name, setName] = useState("");
  const [count, setCount] = useState(4);
  const [grid, setGrid] = useState(E.bestGrid(4));
  const [tried, setTried] = useState(false);
  const err = tried && !name.trim();

  const setN = (n) => {
    n = Math.max(1, Math.min(9, n));
    setCount(n);
    setGrid(E.bestGrid(n));
  };

  const create = () => {
    setTried(true);
    if (!name.trim()) {
      document.getElementById("nd-name")?.focus();
      return;
    }
    const dash = E.createDash({ name: name.trim(), count, grid, index: store.list().length });
    store.put(dash);
    nav.replace({ name: "dash", id: dash.id });
  };

  return html`
    <div class="page new-page">
      <header class="bar-head">
        <button class="icon-btn round" aria-label="Back" onClick=${() => nav.back()}><${Icon} name="back" /></button>
        <h1 class="head-title center">New dash</h1>
        <span class="icon-btn-spacer"></span>
      </header>
      <div class="scroll">
        <label class="field-label" for="nd-name">Name</label>
        <input id="nd-name" class=${"input input-lg" + (err ? " invalid" : "")} value=${name} maxlength="40" placeholder="e.g. Combo turn"
          aria-invalid=${err} aria-describedby=${err ? "nd-err" : null}
          onInput=${(e) => setName(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && e.currentTarget.blur()} />
        ${err && html`<div class="field-err" id="nd-err">Give the dash a name.</div>`}

        <div class="field-label">How many counters?</div>
        <div class="stepper">
          <button class="step-btn" aria-label="Fewer counters" disabled=${count <= 1} onClick=${() => setN(count - 1)}><${Icon} name="minus" size=${28} /></button>
          <span class="stepper-val" aria-live="polite">${count}</span>
          <button class="step-btn" aria-label="More counters" disabled=${count >= 9} onClick=${() => setN(count + 1)}><${Icon} name="plus" size=${28} /></button>
        </div>

        <div class="field-label">Layout</div>
        <${GridPicker} value=${grid} used=${count} best=${E.bestGrid(count)} onChange=${setGrid} />

        <div class="field-label">Macro slots</div>
        <div class="slot-preview">
          ${[0, 1, 2, 3].map(() => html`<span class="slot-ghost"></span>`)}
          <span class="muted">4, empty</span>
        </div>
      </div>
      <div class="foot">
        <button class="btn btn-primary btn-block btn-xl" onClick=${create}>Create dash</button>
      </div>
    </div>`;
}
