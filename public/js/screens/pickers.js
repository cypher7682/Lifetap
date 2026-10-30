import { html } from "../../vendor/preact-htm.js";
import { ICONS, COLORS, GRIDS, gridCap, gridKey, sameGrid } from "../engine.js";
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

/** Layout picker used by New dash and Change grid. `used` = cells that must fit. */
export function GridPicker({ value, used, best, onChange }) {
  return html`
    <div class="grid-picker" role="radiogroup" aria-label="Layout">
      ${GRIDS.map((g) => {
        const cap = gridCap(g);
        const tooSmall = cap < used;
        const on = sameGrid(g, value);
        const isBest = best && sameGrid(g, best);
        return html`
          <button role="radio" aria-checked=${on} disabled=${tooSmall} class=${"grid-opt" + (on ? " on" : "")} onClick=${() => onChange(g)}>
            <span class="grid-mini" style=${{ gridTemplateColumns: `repeat(${g.cols}, 1fr)` }}>
              ${Array.from({ length: cap }, (_, i) => html`<span class=${i < used ? "used" : ""}></span>`)}
            </span>
            <span class="grid-name">${g.cols} × ${g.rows}</span>
            <span class="grid-note">${tooSmall ? "too small" : isBest ? "BEST FIT" : cap > used ? `${cap - used} spare` : "full"}</span>
          </button>`;
      })}
    </div>`;
}

export { gridKey };
