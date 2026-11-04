import { html, useState } from "../../vendor/preact-htm.js";
import * as tables from "../tablestore.js";
import * as T from "../table.js";
import { Icon } from "../icons.js";
import { usePress, Sheet } from "../ui.js";

// The dash's Table Life and Table Counter tiles: change life (or a player counter like poison)
// at the live table without leaving your counters. Amounts are changes (−2 = lose two, +1 = gain one).
// Done hands them to the dash, which runs them as #<stat> steps, so random picks and recording
// work exactly like macros.

const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
const tone = (n) => (n < 0 ? " neg" : n > 0 ? " pos" : "");

/** Play-mode tile. */
export function DamageTile({ turn, onOpen }) {
  const t = tables.current();
  const press = usePress({ onTap: onOpen });
  return html`
    <div class=${"tile damage-tile" + (turn ? " turned" : "")}>
      <button class="tc dmg-btn" style=${turn ? { "--turn": turn + "deg" } : null} aria-label=${t ? `Table Life: change life at table ${t.code}` : "Table Life: no table yet"} ...${press}>
        <span class="dmg-icon"><${Icon} name="heart" size=${26} /></span>
        <span class="dmg-name">Table Life</span>
        <span class="dmg-sub">${t ? html`Table <span class="tbl-code">#${t.code}</span>` : "No table"}</span>
      </button>
    </div>`;
}

/**
 * Table Counter tile: the counter's name and a little copy of the table with each player's count
 * (yours greyed). Away from a table it's just your box, holding the tile's own count. Tap to change.
 */
export function TableCounterTile({ cell, turn, onOpen }) {
  const t = tables.current();
  const press = usePress({ onTap: onOpen });
  const s = t && T.state(t);
  const seats = s ? s.seats.map((p) => ({ id: p.id, me: p.id === t.me, n: T.counterOf(p, cell.name), name: p.name })) : [{ id: "me", me: true, n: cell.value || 0, name: "You" }];
  const grid = T.seatGrid(seats.length);
  return html`
    <div class=${"tile tcounter-tile" + (turn ? " turned" : "")}>
      <button class="tc tcn-btn" style=${turn ? { "--turn": turn + "deg" } : null}
        aria-label=${`${cell.name}: ${seats.map((p) => `${p.name} ${p.n}`).join(", ")}. Tap to change.`} ...${press}>
        <span class="tcn-head"><${Icon} name="table" size=${15} /><span>${cell.name}</span></span>
        <span class="tcn-map" style=${{ gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}>
          ${seats.map((p, i) => {
            const c = grid.cells[i];
            return html`<span key=${p.id} class=${"tcn-cell" + (p.me ? " self" : "")}
              style=${{ gridRow: c.row + 1, gridColumn: c.span === 2 ? "1 / span 2" : c.col + 1 }}><b>${p.n}</b></span>`;
          })}
        </span>
      </button>
    </div>`;
}

function DmgCard({ p, n, self, cell, onStep, now, floor }) {
  const minus = usePress({ onTap: () => onStep(-1) });
  const plus = usePress({ onTap: () => onStep(1) });
  return html`
    <div class=${"dmg-card c-" + p.color + (self ? " self" : "") + (p.dead ? " dead" : "") + (n ? " on" : "")}
      style=${{ gridRow: cell.row + 1, gridColumn: cell.span === 2 ? "1 / span 2" : cell.col + 1 }}>
      <div class="dmg-card-name">${self && p.name !== "You" ? `${p.name} (you)` : p.name} <span class="dmg-now">${now}${n ? ` → ${Math.max(floor, now + n)}` : ""}</span></div>
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
export function DamageSheet({ turn = 0, stat = "life", local = 0, onClose, onDone }) {
  const tt = tables.current();
  const [amt, setAmt] = useState({});
  const isLife = stat === "life";
  if (!tt && isLife) return null;
  // away from a table a counter sheet is just you, holding the tile's own count
  const t = tt || { code: null, me: "me" };
  const seats = tt ? T.state(tt).seats : [{ id: "me", name: "You", color: "grey", counters: {} }];
  const grid = T.seatGrid(seats.length);
  const pre = stat + "|";
  const keyOf = (p) => pre + (p.id === t.me ? "me" : "name:" + p.name);
  const now = (p) => (isLife ? p.life : tt ? T.counterOf(p, stat) : local);
  const step = (key, d) => setAmt((a) => ({ ...a, [key]: (a[key] || 0) + d }));
  const alloc = Object.entries(amt).filter(([, d]) => d).map(([key, d]) => ({ key, d }));
  const hurts = alloc.some((a) => a.d < 0);
  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label=${isLife ? "Table life" : stat} class="dmg-sheet">
      <h2 class="sheet-title">${isLife ? "Table life" : stat} <span class="muted small">${tt ? html`Table <span class="tbl-code">#${t.code}</span>` : "not at a table"}</span></h2>
      ${tt && html`
        <${RandomRow} label="Random opponent" n=${amt[pre + "opponentRandom"] || 0} onStep=${(d) => step(pre + "opponentRandom", d)} />
        <${RandomRow} label="Random player" n=${amt[pre + "playerRandom"] || 0} onStep=${(d) => step(pre + "playerRandom", d)} />`}
      <div class="dmg-grid" style=${{ gridTemplateRows: `repeat(${grid.rows}, auto)` }}>
        ${seats.map((p, i) => html`<${DmgCard} key=${p.id} p=${p} n=${amt[keyOf(p)] || 0} now=${now(p)} floor=${isLife ? -Infinity : 0} self=${p.id === t.me} cell=${grid.cells[i]} onStep=${(d) => step(keyOf(p), d)} />`)}
      </div>
      <div class="sheet-row dmg-actions">
        <button class="btn btn-plain" onClick=${onClose}>Cancel</button>
        <button class=${"btn " + (hurts ? "btn-take" : "btn-primary")} disabled=${!alloc.length} onClick=${() => onDone(alloc)}>Done</button>
      </div>
    <//>`;
}
