import { html, useState } from "../../vendor/preact-htm.js";
import * as tables from "../tablestore.js";
import * as sync from "../sync.js";
import * as T from "../table.js";
import { Icon } from "../icons.js";
import { usePress, Sheet, toast } from "../ui.js";

// The dash's Damage tile: hand out damage to the live table without leaving your counters.

const signedDmg = (n) => (n ? "−" + n : "0");

/** Play-mode tile. */
export function DamageTile({ turn, onOpen }) {
  const t = tables.current();
  const press = usePress({ onTap: onOpen });
  return html`
    <div class=${"tile damage-tile" + (turn ? " turned" : "")}>
      <button class="tc dmg-btn" style=${turn ? { "--turn": turn + "deg" } : null} aria-label=${t ? `Damage: send damage to table ${t.code}` : "Damage: no table yet"} ...${press}>
        <span class="dmg-icon"><${Icon} name="lightning" size=${26} /></span>
        <span class="dmg-name">Damage</span>
        <span class="dmg-sub">${t ? html`Table <span class="tbl-code">#${t.code}</span>` : "No table"}</span>
      </button>
    </div>`;
}

function DmgCard({ p, n, self, cell, onStep }) {
  const minus = usePress({ onTap: () => onStep(-1), disabled: n <= 0 });
  const plus = usePress({ onTap: () => onStep(1) });
  return html`
    <div class=${"dmg-card c-" + p.color + (self ? " self" : "") + (p.dead ? " dead" : "") + (n ? " on" : "")}
      style=${{ gridRow: cell.row + 1, gridColumn: cell.span === 2 ? "1 / span 2" : cell.col + 1 }}>
      <div class="dmg-card-name">${self ? `${p.name} (you)` : p.name}</div>
      <div class="dmg-main">
        <button class="dmg-pm" aria-label=${`One less damage to ${p.name}`} ...${minus}>−</button>
        <span class="dmg-val" aria-live="polite">${n}</span>
        <button class="dmg-pm" aria-label=${`One more damage to ${p.name}`} ...${plus}>+</button>
      </div>
      <div class="dmg-tens">
        ${[-100, -10, 10, 100].map((d) => html`
          <button class="dmg-ten" disabled=${d < 0 && n <= 0} onClick=${() => onStep(d)}>${d < 0 ? "−" + -d : "+" + d}</button>`)}
      </div>
    </div>`;
}

/** "Damage allocation": the table's seats and how much each takes; Done sends it as life loss. (Commander damage is combat, so it lives on the table view.) */
export function DamageSheet({ turn = 0, onClose }) {
  const t = tables.current();
  const [amt, setAmt] = useState({});
  if (!t) return null;
  const s = T.state(t);
  const grid = T.seatGrid(s.seats.length);
  const step = (pid, d) => setAmt((a) => ({ ...a, [pid]: Math.max(0, (a[pid] || 0) + d) }));
  const total = Object.values(amt).reduce((x, y) => x + y, 0);

  const done = () => {
    const ops = s.seats
      .filter((p) => amt[p.id] > 0)
      .map((p) => ({ op: "life", p: p.id, d: -amt[p.id] }));
    if (ops.length) {
      if (t.online) sync.act(t.id, { ops });
      else tables.update(t.id, (x) => T.act(x, ops, tables.deviceId));
      toast(s.seats.filter((p) => amt[p.id] > 0).map((p) => `${p.name} ${signedDmg(amt[p.id])}`).join(", "));
    }
    onClose();
  };

  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label="Damage allocation" class="dmg-sheet">
      <h2 class="sheet-title">Damage allocation <span class="muted small">Table <span class="tbl-code">#${t.code}</span></span></h2>
      <div class="dmg-grid" style=${{ gridTemplateRows: `repeat(${grid.rows}, auto)` }}>
        ${s.seats.map((p, i) => html`<${DmgCard} key=${p.id} p=${p} n=${amt[p.id] || 0} self=${p.id === t.me} cell=${grid.cells[i]} onStep=${(d) => step(p.id, d)} />`)}
      </div>
      <div class="sheet-row dmg-actions">
        <button class="btn btn-plain" onClick=${onClose}>Cancel</button>
        <button class=${"btn " + (total ? "btn-take" : "btn-primary")} disabled=${!total} onClick=${done}>Done${total ? ` · ${total}` : ""}</button>
      </div>
    <//>`;
}
