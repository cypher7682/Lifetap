import { html, useState } from "../../vendor/preact-htm.js";
import * as tables from "../tablestore.js";
import * as T from "../table.js";
import { Icon } from "../icons.js";
import { usePress, Sheet } from "../ui.js";

// The dash's Damage tile: change life at the live table without leaving your counters.
// Amounts are life changes (−2 = two damage, +1 = gain one). Done hands them to the dash,
// which runs them as #life steps (so random picks and recording work like macros).

const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
const tone = (n) => (n < 0 ? " neg" : n > 0 ? " pos" : "");

/** Play-mode tile. */
export function DamageTile({ turn, onOpen }) {
  const t = tables.current();
  const press = usePress({ onTap: onOpen });
  return html`
    <div class=${"tile damage-tile" + (turn ? " turned" : "")}>
      <button class="tc dmg-btn" style=${turn ? { "--turn": turn + "deg" } : null} aria-label=${t ? `Damage: change life at table ${t.code}` : "Damage: no table yet"} ...${press}>
        <span class="dmg-icon"><${Icon} name="lightning" size=${26} /></span>
        <span class="dmg-name">Damage</span>
        <span class="dmg-sub">${t ? html`Table <span class="tbl-code">#${t.code}</span>` : "No table"}</span>
      </button>
    </div>`;
}

function DmgCard({ p, n, self, cell, onStep }) {
  const minus = usePress({ onTap: () => onStep(-1) });
  const plus = usePress({ onTap: () => onStep(1) });
  return html`
    <div class=${"dmg-card c-" + p.color + (self ? " self" : "") + (p.dead ? " dead" : "") + (n ? " on" : "")}
      style=${{ gridRow: cell.row + 1, gridColumn: cell.span === 2 ? "1 / span 2" : cell.col + 1 }}>
      <div class="dmg-card-name">${self ? `${p.name} (you)` : p.name}</div>
      <div class="dmg-main">
        <button class="dmg-pm" aria-label=${`${p.name} loses one more`} ...${minus}>−</button>
        <span class=${"dmg-val" + tone(n)} aria-live="polite">${signed(n)}</span>
        <button class="dmg-pm" aria-label=${`${p.name} gains one more`} ...${plus}>+</button>
      </div>
      <div class="dmg-tens">
        ${[-100, -10, 10, 100].map((d) => html`<button class="dmg-ten" onClick=${() => onStep(d)}>${signed(d)}</button>`)}
      </div>
    </div>`;
}

function RandomRow({ label, n, onStep }) {
  return html`
    <div class=${"dmg-rand" + (n ? " on" : "")}>
      <span class="dmg-rand-label">${label}</span>
      <div class="dmg-rand-ctl">
        ${[-10, -1].map((d) => html`<button class="dmg-ten" onClick=${() => onStep(d)}>${signed(d)}</button>`)}
        <span class=${"dmg-rand-val" + tone(n)} aria-live="polite">${signed(n)}</span>
        ${[1, 10].map((d) => html`<button class="dmg-ten" onClick=${() => onStep(d)}>${signed(d)}</button>`)}
      </div>
    </div>`;
}

/**
 * "Damage allocation": random opponent / random player rows, then the table's seats.
 * onDone([{key, d}]): key "opponentRandom" | "playerRandom" | "me" | "name:<player>", d = life change.
 */
export function DamageSheet({ turn = 0, onClose, onDone }) {
  const t = tables.current();
  const [amt, setAmt] = useState({});
  if (!t) return null;
  const s = T.state(t);
  const grid = T.seatGrid(s.seats.length);
  const keyOf = (p) => (p.id === t.me ? "me" : "name:" + p.name);
  const step = (key, d) => setAmt((a) => ({ ...a, [key]: (a[key] || 0) + d }));
  const alloc = Object.entries(amt).filter(([, d]) => d).map(([key, d]) => ({ key, d }));
  const hurts = alloc.some((a) => a.d < 0);
  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label="Damage allocation" class="dmg-sheet">
      <h2 class="sheet-title">Damage allocation <span class="muted small">Table <span class="tbl-code">#${t.code}</span></span></h2>
      <${RandomRow} label="Random opponent" n=${amt.opponentRandom || 0} onStep=${(d) => step("opponentRandom", d)} />
      <${RandomRow} label="Random player" n=${amt.playerRandom || 0} onStep=${(d) => step("playerRandom", d)} />
      <div class="dmg-grid" style=${{ gridTemplateRows: `repeat(${grid.rows}, auto)` }}>
        ${s.seats.map((p, i) => html`<${DmgCard} key=${p.id} p=${p} n=${amt[keyOf(p)] || 0} self=${p.id === t.me} cell=${grid.cells[i]} onStep=${(d) => step(keyOf(p), d)} />`)}
      </div>
      <div class="sheet-row dmg-actions">
        <button class="btn btn-plain" onClick=${onClose}>Cancel</button>
        <button class=${"btn " + (hurts ? "btn-take" : "btn-primary")} disabled=${!alloc.length} onClick=${() => onDone(alloc)}>Done</button>
      </div>
    <//>`;
}
