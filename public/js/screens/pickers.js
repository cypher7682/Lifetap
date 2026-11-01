import { html } from "../../vendor/preact-htm.js";
import { ICONS, COLORS, GRID_MAX } from "../engine.js";
import { Icon, ICON_LABEL } from "../icons.js";

export function IconPicker({ value, onChange, color = "teal" }) {
  return html`
    <div class="icon-picker" role="radiogroup" aria-label="Icon">
      ${ICONS.map((name) => html`
        <button role="radio" aria-checked=${value === name} aria-label=${ICON_LABEL[name]}
          class=${"icon-opt" + (value === name ? " on c-" + color : "")} onClick=${() => onChange(name)}>
          <${Icon} name=${name} size=${22} />
        </button>`)}
    </div>`;
}

export function ColorPicker({ value, onChange }) {
  return html`
    <div class="swatches" role="radiogroup" aria-label="Colour">
      ${COLORS.map((c) => html`
        <button role="radio" aria-checked=${value === c} aria-label=${c} class=${"swatch" + (value === c ? " on" : "")} onClick=${() => onChange(c)}>
          <span class=${"swatch-dot bg-" + c}></span>
        </button>`)}
    </div>`;
}

/**
 * Columns × rows picker with a live preview, used by New dash and Change grid.
 * `used` cells must still fit, so steps that would make the grid too small are disabled.
 */
export function GridSizer({ value, used, onChange }) {
  const { cols, rows } = value;
  const cap = cols * rows;
  const set = (c, r) => onChange({ cols: c, rows: r });
  const colBlocked = cols > 1 && (cols - 1) * rows < used;
  const rowBlocked = rows > 1 && cols * (rows - 1) < used;
  const Stepper = ({ label, n, max, onMinus, onPlus, minusOff }) => html`
    <div class="sizer">
      <span class="sizer-label">${label}</span>
      <button class="step-btn sm" aria-label=${"Fewer " + label.toLowerCase()} disabled=${minusOff} onClick=${onMinus}><${Icon} name="minus" size=${22} /></button>
      <span class="sizer-val" aria-live="polite">${n}</span>
      <button class="step-btn sm" aria-label=${"More " + label.toLowerCase()} disabled=${n >= max} onClick=${onPlus}><${Icon} name="plus" size=${22} /></button>
    </div>`;
  return html`
    <div class="grid-sizer">
      <div class="sizer-controls">
        <${Stepper} label="Columns" n=${cols} max=${GRID_MAX.cols} minusOff=${cols <= 1 || colBlocked} onMinus=${() => set(cols - 1, rows)} onPlus=${() => set(cols + 1, rows)} />
        <${Stepper} label="Rows" n=${rows} max=${GRID_MAX.rows} minusOff=${rows <= 1 || rowBlocked} onMinus=${() => set(cols, rows - 1)} onPlus=${() => set(cols, rows + 1)} />
      </div>
      <div class="sizer-preview" aria-hidden="true">
        <span class="grid-mini" style=${{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          ${Array.from({ length: cap }, (_, i) => html`<span class=${i < used ? "used" : ""}></span>`)}
        </span>
      </div>
    </div>
    <p class="hint">${cols} × ${rows} · ${cap} cell${cap === 1 ? "" : "s"}${cap > used ? ` · ${cap - used} spare` : ""}${colBlocked || rowBlocked ? " · remove tiles to shrink it further" : ""}</p>`;
}
